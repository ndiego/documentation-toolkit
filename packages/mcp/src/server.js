/**
 * MCP server for the WordPress documentation toolkit.
 *
 * Tools:
 *   list_presets       the subjects a screenshot can be taken of, with their parameters
 *   screenshot         render one subject from a preset (zero-config against the bundled demo site, or a project)
 *   validate_manifest  check a handbook manifest.json for the developer.wordpress.org importer
 *
 * The screenshot tool returns the image inline (PNG, scaled for display) and, when `out` is given, writes the
 * canonical WebP file there. Each call boots WordPress Playground, so expect 15-30 seconds per image.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import sharp from 'sharp';
import {
	loadConfig,
	presets,
	presetNames,
	prepareShot,
	renderShot,
	openSession,
	ensureChromium,
	ensureSupportedNode,
	sceneNames,
	sceneDocs,
	verbDocs,
	targetNames,
	defaultStyle,
	LOCATOR_KEYS,
	NAME_KEYS,
	OTHER_KEYS,
	MODIFIER_KEYS,
	ANNOTATION_TYPES,
	DIRECTIONS,
	BADGE_POSITIONS,
	captureFrameNames,
} from '@wp-docs-toolkit/screenshots';
import { validateManifest } from '@wp-docs-toolkit/manifest';

// The engine's vocabulary, as the tool descriptions state it. Nothing here is typed out twice: the names, the
// frames and their ratios, the viewports and their sizes all come from the engine.
const FRAMES = captureFrameNames();
const FRAME_HINT = FRAMES.map( ( name ) =>
	defaultStyle.frames[ name ]
		? `${ name } (${ ratioLabel( defaultStyle.frames[ name ] ) })`
		: name
).join( ', ' );
const TARGET_HINT = `${ targetNames.join( ', ' ) }, or a CSS selector`;
const VIEWPORT_NAMES = Object.keys( defaultStyle.viewports );
const VIEWPORT_HINT = VIEWPORT_NAMES.map( ( name ) => {
	const { width, height } = defaultStyle.viewports[ name ];
	return `${ name } (${ width }×${ height }${ name === 'desktop' ? ', default' : '' })`;
} ).join( ', ' );
const SCENE_HINT = Object.values( sceneDocs )
	.map( ( d ) => d.form )
	.join( ', ' );
// The keys that anchor an annotation to something: any locator key, or a named region.
const ANCHOR_KEYS = [ ...NAME_KEYS, ...OTHER_KEYS, 'target' ];

/**
 * A ratio as documentation writes it: 16/9 as "16:9".
 * @param {number} ratio width / height
 * @return {string} label
 */
function ratioLabel( ratio ) {
	for ( let d = 1; d <= 16; d++ ) {
		const n = ratio * d;
		if ( Math.abs( n - Math.round( n ) ) < 1e-6 ) {
			return `${ Math.round( n ) }:${ d }`;
		}
	}
	return `${ ratio.toFixed( 2 ) }:1`;
}

/**
 * One zod field per preset parameter, described from the presets that take it, so `screenshot` and
 * `list_presets` draw on the same definitions.
 * @return {Object<string, import('zod').ZodTypeAny>} fields keyed by parameter name
 */
function presetParamFields() {
	const names = [
		...new Set(
			presetNames.flatMap( ( n ) => Object.keys( presets[ n ].params ) )
		),
	];
	return Object.fromEntries(
		names.map( ( key ) => {
			const takers = presetNames.filter(
				( n ) => presets[ n ].params[ key ]
			);
			const byText = new Map();
			for ( const n of takers ) {
				const text = presets[ n ].params[ key ].description;
				byText.set( text, [ ...( byText.get( text ) || [] ), n ] );
			}
			const description = [ ...byText ]
				.map( ( [ text, ps ] ) => `${ ps.join( ', ' ) }: ${ text }` )
				.join( ' ' );
			const options = presets[ takers[ 0 ] ].params[ key ].options;
			const field = options ? z.enum( options ) : z.string();
			return [ key, field.optional().describe( description ) ];
		} )
	);
}
const PRESET_PARAM_FIELDS = presetParamFields();

// One annotation as a client states it: what to draw, and which element (by its accessible name) to anchor to.
const annotationSchema = z.object( {
	type: z
		.enum( ANNOTATION_TYPES )
		.describe(
			'outline (default choice), arrow (small or ambiguous targets), badge (numbered steps), dim (fade everything else).'
		),
	button: z
		.string()
		.optional()
		.describe(
			'Accessible name of a button, e.g. "Save draft", "Replace".'
		),
	control: z
		.string()
		.optional()
		.describe(
			'Label of a form control (textbox, select, checkbox, slider), e.g. "Resolution".'
		),
	menuitem: z.string().optional().describe( 'Name of a menu item.' ),
	tab: z.string().optional().describe( 'Name of a tab.' ),
	link: z.string().optional().describe( 'Name of a link.' ),
	text: z.string().optional().describe( 'Visible text to anchor to.' ),
	selector: z
		.string()
		.optional()
		.describe( 'CSS selector, when nothing else fits.' ),
	target: z
		.string()
		.optional()
		.describe(
			`A named region instead of an element (for dim, or to outline a whole panel): ${ TARGET_HINT }.`
		),
	exact: z
		.boolean()
		.optional()
		.describe(
			'Match the whole accessible name, case-sensitively. Default false here: a substring, case-insensitive, so "Save Draft" finds "Save draft".'
		),
	within: z
		.string()
		.optional()
		.describe(
			'Limit the search to a named region, e.g. block-toolbar or top-bar.'
		),
	from: z
		.enum( DIRECTIONS )
		.optional()
		.describe(
			'Arrow only: the direction it comes from (default top-right). Point at toolbar buttons from bottom or the side.'
		),
	label: z
		.string()
		.optional()
		.describe(
			'Badge only: the number or letter to show (default: counts up).'
		),
	position: z
		.enum( BADGE_POSITIONS )
		.optional()
		.describe( 'Badge only: which corner of the element.' ),
} );

/**
 * Translate a client annotation into the engine's spec form: `{ arrow: { button: 'Save draft', exact: false } }`.
 * @param {Object}      a
 * @param {string|null} [defaultWithin] region to search in when the annotation names none
 * @return {Object} spec annotation
 */
export function toSpecAnnotation( a, defaultWithin = null ) {
	const { type, exact, ...rest } = a;
	if (
		defaultWithin &&
		rest.within === undefined &&
		rest.target === undefined
	) {
		// Search the preset's own region first: "Options" exists in the block toolbar and in the top bar.
		rest.within = defaultWithin;
	}
	const value = {};
	for ( const [ key, v ] of Object.entries( rest ) ) {
		if ( v !== undefined && v !== null && v !== '' ) {
			value[ key ] = v;
		}
	}
	const hasAnchor = ANCHOR_KEYS.some( ( k ) => value[ k ] !== undefined );
	if ( ! hasAnchor ) {
		return { [ type ]: 'self' };
	}
	if ( value.target === undefined && value.selector === undefined ) {
		value.exact = exact === true;
	}
	return { [ type ]: value };
}

/**
 * Build the server. `options.project` points at a shots.config.js to render against a documentation project's
 * own demo site instead of the bundled one.
 * @param {Object} [options]
 * @param {string} [options.project]  path to a shots.config.js
 * @param {number} [options.maxWidth] width the inline PNG is scaled to (default 1400)
 * @return {McpServer} the server
 */
export function createServer( options = {} ) {
	const server = new McpServer( {
		name: 'wp-docs-toolkit',
		version: '0.3.4',
	} );
	const maxWidth = options.maxWidth ?? 1400;
	const warm = options.warm || createWarmSession( options );
	server.closeSession = () => warm.close();

	server.registerTool(
		'list_presets',
		{
			title: 'List screenshot presets',
			description:
				'The subjects a WordPress documentation screenshot can be taken of (a block on the canvas, its toolbar or settings, the site editor, an admin screen, the front end) with the parameters each one takes. Call this before `screenshot` when unsure what to ask for.',
			inputSchema: {},
		},
		async () => ( {
			content: [
				{
					type: 'text',
					text: JSON.stringify( describePresets(), null, 2 ),
				},
			],
		} )
	);

	server.registerTool(
		'screenshot',
		{
			title: 'Take a WordPress screenshot',
			description:
				'Render a reproducible screenshot of the WordPress UI from a preset: it boots a pinned WordPress (7.1, the Ipsum theme, demo content), drives the real interface, crops to the subject and puts it on a canonical frame. Highlight things with `annotate` (an arrow or outline on a named button or control, numbered badges, or dimming); annotations are sized for the displayed image automatically, so for a small control in a big screen prefer a tighter preset (block-settings, block-toolbar, admin-content region) over a bigger highlight. Returns the image inline; pass `out` to also save the WebP file on this machine. First call 15-30 seconds, then a few seconds. Use `list_presets` for the subjects. Block presets open a showcase post for the block (Image, Gallery and Table exist; set post to "new" for other blocks).',
			inputSchema: {
				preset: z
					.enum( presetNames )
					.optional()
					.describe(
						'The subject: block-canvas, block-toolbar, block-settings, site-editor, post-editor, admin-screen or front-end. Start here; leave it out only for a shot that no preset covers, and then give scene and steps.'
					),
				scene: z
					.string()
					.optional()
					.describe(
						`Starting state when not using a preset (a preset chooses its own; the two cannot be combined): ${ SCENE_HINT }. \`vocabulary\` explains each.`
					),
				steps: z
					.array(
						z.union( [
							z.string(),
							z.record( z.string(), z.unknown() ),
						] )
					)
					.optional()
					.describe(
						'Steps to run before capturing, after any preset steps: each a verb name or a single-key object, e.g. "openListView", { "searchInserter": "Gallery" }, { "click": { "button": "Replace" } }, { "openInspector": "styles" }, { "press": "Escape" }. Call `vocabulary` for the verbs and locator keys. Unknown verbs are rejected with a suggestion.'
					),
				viewport: z
					.union( [
						z.enum( VIEWPORT_NAMES ),
						z.object( { width: z.number(), height: z.number() } ),
					] )
					.optional()
					.describe(
						`Viewport: ${ VIEWPORT_HINT }, or {width, height}.`
					),
				...PRESET_PARAM_FIELDS,
				frame: z
					.enum( FRAMES )
					.optional()
					.describe(
						`Override the frame: ${ FRAME_HINT }. auto picks the ratio nearest the content; plain is the raw capture with no stage.`
					),
				annotate: z
					.array( annotationSchema )
					.optional()
					.describe(
						'Highlights drawn on the screenshot, anchored to UI elements so they stay correct. One type per image is the house style. Example: [ { "type": "arrow", "button": "Save draft", "from": "bottom" } ].'
					),
				target: z
					.string()
					.optional()
					.describe(
						`Crop to this region instead of the preset default, e.g. admin-content for a wp-admin screen without the menu and toolbar. One of: ${ TARGET_HINT }.`
					),
				include: z
					.array( z.string() )
					.optional()
					.describe(
						'Extra named regions to keep inside the crop, e.g. [ "block-toolbar" ].'
					),
				pad: z
					.number()
					.optional()
					.describe(
						'Padding around the crop in CSS pixels (preset default otherwise).'
					),
				fit: z
					.enum( [ 'content' ] )
					.optional()
					.describe(
						'content: clip a tall panel to its last visible child.'
					),
				mask: z
					.array( z.record( z.string(), z.unknown() ) )
					.optional()
					.describe(
						'Elements to cover with a neutral block (locator keys, e.g. { "selector": ".some-dynamic" }).'
					),
				alt: z
					.string()
					.optional()
					.describe( 'Alt text to record for the image.' ),
				out: z
					.string()
					.optional()
					.describe(
						'File path to write the WebP image to, on the machine running this server (a leading ~ is expanded). Omit to only get the image inline.'
					),
			},
		},
		async ( args ) => {
			const params = {};
			for ( const key of Object.keys( PRESET_PARAM_FIELDS ) ) {
				if ( args[ key ] !== undefined ) {
					params[ key ] = args[ key ];
				}
			}
			// Validate first, without booting: a bad preset, verb or locator fails in milliseconds.
			const config = await warm.config();
			const prepared = prepareShot( config, {
				preset: args.preset,
				params,
				alt: args.alt,
				frame: args.frame,
				scene: args.scene,
				steps: args.steps,
				viewport: args.viewport,
				fit: args.fit,
				mask: args.mask,
				target: args.target,
				pad: args.pad,
				annotate: ( args.annotate || [] ).map( ( a ) =>
					toSpecAnnotation(
						a,
						presets[ args.preset ]?.annotationScope ?? null
					)
				),
				include: args.include,
			} );
			// One WordPress session, one screenshot at a time: concurrent calls queue behind each other.
			const result = await warm
				.run( ( { session } ) =>
					renderShot( config, prepared, {
						out: args.out,
						session,
						log: () => {},
					} )
				)
				.catch( ( e ) => {
					// A boot failure means renderShot never ran, so nothing has cleaned up the prepared shot.
					prepared.discard();
					throw e;
				} );
			const png = await sharp( result.buffer )
				.resize( { width: maxWidth, withoutEnlargement: true } )
				.png()
				.toBuffer();
			const summary = {
				preset: args.preset || null,
				scene: args.scene || null,
				steps: ( args.steps || [] ).length,
				params,
				width: result.width,
				height: result.height,
				frame: result.frame,
				annotations: ( args.annotate || [] ).length,
				encoding: result.encoding,
				file: result.file,
				alt: result.alt,
				note: 'Local preview render from a warm WordPress session (restart_environment resets it). Canonical pixels for committing come from `wp-screenshots check --docker` in the documentation project.',
			};
			return {
				content: [
					{ type: 'text', text: JSON.stringify( summary, null, 2 ) },
					{
						type: 'image',
						data: png.toString( 'base64' ),
						mimeType: 'image/png',
					},
				],
			};
		}
	);

	server.registerTool(
		'vocabulary',
		{
			title: 'Screenshot vocabulary',
			description:
				'Everything a free-form screenshot can be built from: scenes (starting states), step verbs with their arguments, named capture targets, locator keys for naming elements, frames and arrow directions. Call it before writing `steps` for a subject no preset covers.',
			inputSchema: {},
		},
		async () => ( {
			content: [
				{
					type: 'text',
					text: JSON.stringify( describeVocabulary(), null, 2 ),
				},
			],
		} )
	);

	server.registerTool(
		'restart_environment',
		{
			title: 'Restart the WordPress environment',
			description:
				'Shut down the warm WordPress session so the next screenshot boots a fresh, unmodified site. Use after a screenshot that changed site state, or if a screenshot came back wrong. The next screenshot takes 10-20 seconds longer.',
			inputSchema: {},
		},
		async () => {
			await warm.close();
			return {
				content: [
					{
						type: 'text',
						text: 'Environment stopped. The next screenshot boots a fresh WordPress.',
					},
				],
			};
		}
	);

	server.registerTool(
		'validate_manifest',
		{
			title: 'Validate a handbook manifest',
			description:
				'Check a manifest.json for the wporg-markdown importer used on developer.wordpress.org: path keys, parents before children, no slug takeovers, GitHub blob sources, one H1 per file equal to the title, no raw block markup outside code fences, frozen keys kept. Returns the warnings and errors the CI action would.',
			inputSchema: {
				manifest: z.string().describe( 'Path to manifest.json.' ),
				docs: z
					.string()
					.optional()
					.describe(
						'Directory the markdown_source paths resolve under (usually the repo root). Enables the per-file checks.'
					),
				frozen: z
					.string()
					.optional()
					.describe(
						'Path to a JSON list (or object) of keys that must keep existing.'
					),
				allowMissingParent: z
					.array( z.string() )
					.optional()
					.describe( 'Keys whose parent is intentionally absent.' ),
				strict: z
					.boolean()
					.optional()
					.describe( 'Treat warnings as errors.' ),
			},
		},
		async ( args ) => {
			const file = path.resolve( args.manifest );
			const data = JSON.parse( fs.readFileSync( file, 'utf8' ) );
			const frozen = args.frozen
				? JSON.parse(
						fs.readFileSync( path.resolve( args.frozen ), 'utf8' )
					)
				: undefined;
			const result = validateManifest( data, {
				docs: args.docs ? path.resolve( args.docs ) : undefined,
				frozen,
				allowMissingParent: args.allowMissingParent || [],
			} );
			const ok =
				result.errors.length === 0 &&
				! ( args.strict && result.warnings.length );
			const lines = [
				...result.warnings.map( ( w ) => `warning: ${ w }` ),
				...result.errors.map( ( e ) => `error: ${ e }` ),
				`${ result.entries } entries, ${ result.errors.length } errors, ${ result.warnings.length } warnings`,
			];
			return {
				content: [ { type: 'text', text: lines.join( '\n' ) } ],
				structuredContent: { ok, ...result },
				isError: ! ok,
			};
		}
	);

	return server;
}

/**
 * Presets as plain data for the list tool.
 * @return {Object[]} one entry per preset
 */
export function describePresets() {
	return presetNames.map( ( name ) => ( {
		name,
		description: presets[ name ].description,
		params: Object.fromEntries(
			Object.entries( presets[ name ].params ).map( ( [ key, def ] ) => [
				key,
				{
					required: Boolean( def.required ),
					default: def.default ?? null,
					options: def.options ?? null,
					description: def.description,
				},
			] )
		),
	} ) );
}

/**
 * One WordPress session kept alive between tool calls, closed after `idleMs` without use (default 10 minutes)
 * or when the process ends. Calls that arrive while a boot is in flight wait for it.
 * @param {Object} [options]
 * @param {string} [options.project] path to a shots.config.js
 * @param {number} [options.idleMs]  idle timeout; 0 disables it
 * @return {{get: () => Promise<{config: Object, session: Object}>, config: () => Promise<Object>, run: (fn: ( env: Object ) => Promise<Object>) => Promise<Object>, touch: () => void, close: () => Promise<void>}} the holder
 */
export function createWarmSession( options = {} ) {
	const idleMs = options.idleMs ?? 10 * 60 * 1000;
	let config = null;
	let session = null;
	let opening = null;
	let timer = null;
	const armIdle = () => {
		if ( timer ) {
			clearTimeout( timer );
		}
		if ( idleMs > 0 ) {
			timer = setTimeout( () => close(), idleMs );
			timer.unref?.();
		}
	};
	const close = async () => {
		if ( timer ) {
			clearTimeout( timer );
			timer = null;
		}
		const current = session;
		session = null;
		if ( current ) {
			await current.close();
		}
	};
	let queue = Promise.resolve();
	/**
	 * Run `fn( { config, session } )` with exclusive use of the session; calls are serialized.
	 * @param {( env: {config: Object, session: Object} ) => Promise<Object>} fn
	 * @return {Promise<Object>} what `fn` resolves to
	 */
	const run = ( fn ) => {
		const job = queue.then( async () => fn( await get() ) );
		// Keep the chain alive after a failure so the next call still runs.
		queue = job.catch( () => {} ).then( armIdle );
		return job;
	};
	/** The config without booting anything; loaded once, concurrent callers share the load. */
	const getConfig = () => {
		if ( ! config ) {
			config = loadConfig( options.project, {
				fallback: ! options.project,
			} ).catch( ( e ) => {
				config = null;
				throw e;
			} );
		}
		return config;
	};
	const get = async () => {
		const loaded = await getConfig();
		if ( ! session ) {
			ensureSupportedNode();
			await ensureChromium( { install: true } );
			if ( ! opening ) {
				opening = openSession( {
					config: loaded,
					log: () => {},
				} ).finally( () => {
					opening = null;
				} );
			}
			session = await opening;
		} else {
			await session.ensure();
		}
		armIdle();
		return { config: loaded, session };
	};
	return { get, config: getConfig, run, touch: armIdle, close };
}

/**
 * The vocabulary as plain data for the tool.
 * @return {Object} scenes, verbs, targets, locator keys, frames, directions
 */
export function describeVocabulary() {
	return {
		scenes: {
			names: sceneNames,
			forms: Object.fromEntries(
				Object.entries( sceneDocs ).map( ( [ name, d ] ) => [
					name,
					`${ d.form }: ${ d.description }`,
				] )
			),
		},
		verbs: verbDocs,
		targets: targetNames,
		locatorKeys: {
			keys: LOCATOR_KEYS,
			note: `One of ${ NAME_KEYS.join( ', ' ) } (an accessible name or label), role (+ name), selector, block; modifiers ${ MODIFIER_KEYS.join( ', ' ) }: exact defaults to true in steps, within takes a target name, in is page | canvas.`,
		},
		frames: FRAMES,
		arrowDirections: DIRECTIONS,
		annotationTypes: ANNOTATION_TYPES,
		badgePositions: BADGE_POSITIONS,
	};
}
