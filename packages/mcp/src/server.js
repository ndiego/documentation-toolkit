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
	shootPreset,
	openSession,
	ensureChromium,
} from '@wp-docs-toolkit/screenshots';
import { validateManifest } from '@wp-docs-toolkit/manifest';

const FRAMES = [
	'auto',
	'wide',
	'standard',
	'portrait',
	'banner',
	'none',
	'card',
];

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
		version: '0.3.0',
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
				'Render a reproducible screenshot of the WordPress UI from a preset: it boots a pinned WordPress (7.1, the Ipsum theme, demo content), drives the real interface, crops to the subject and puts it on a canonical frame. Returns the image inline; pass `out` to also save the WebP file. Takes 15-30 seconds. Use `list_presets` for the subjects. Block presets open a showcase post for the block (Image, Gallery and Table exist; set post to "new" for other blocks).',
			inputSchema: {
				preset: z
					.enum( presetNames )
					.describe(
						'The subject: block-canvas, block-toolbar, block-settings, site-editor, post-editor, admin-screen or front-end.'
					),
				block: z
					.string()
					.optional()
					.describe(
						'Block name for the block-* presets, for example core/image.'
					),
				post: z
					.string()
					.optional()
					.describe(
						'Post slug to open for block-* and post-editor presets; "new" inserts the block into a fresh post.'
					),
				tab: z
					.enum( [ 'content', 'settings', 'styles' ] )
					.optional()
					.describe( 'Inspector tab for block-settings.' ),
				panel: z
					.string()
					.optional()
					.describe(
						'A collapsed inspector panel to expand for block-settings, for example "Dimensions".'
					),
				view: z
					.string()
					.optional()
					.describe(
						'Site editor view for site-editor: templates, parts, patterns, navigation, pages, styles, template:<theme>//<slug>.'
					),
				screen: z
					.string()
					.optional()
					.describe(
						'wp-admin path for admin-screen, for example options-general.php or plugins.php.'
					),
				path: z
					.string()
					.optional()
					.describe(
						'Front-end path for front-end, for example /about/.'
					),
				frame: z
					.enum( FRAMES )
					.optional()
					.describe(
						'Override the frame: auto, wide (16:9), standard (4:3), portrait (3:4), banner (3:1), none, card.'
					),
				alt: z
					.string()
					.optional()
					.describe( 'Alt text to record for the image.' ),
				out: z
					.string()
					.optional()
					.describe(
						'File path to write the WebP image to. Omit to only get the image inline.'
					),
			},
		},
		async ( args ) => {
			const params = {};
			for ( const key of [
				'block',
				'post',
				'tab',
				'panel',
				'view',
				'screen',
				'path',
			] ) {
				if ( args[ key ] !== undefined ) {
					params[ key ] = args[ key ];
				}
			}
			// One WordPress session, one screenshot at a time: concurrent calls queue behind each other.
			const result = await warm.run( ( { config, session } ) =>
				shootPreset( config, {
					preset: args.preset,
					params,
					alt: args.alt,
					frame: args.frame,
					out: args.out,
					session,
					log: () => {},
				} )
			);
			const png = await sharp( result.buffer )
				.resize( { width: maxWidth, withoutEnlargement: true } )
				.png()
				.toBuffer();
			const summary = {
				preset: args.preset,
				params,
				width: result.width,
				height: result.height,
				frame: result.frame,
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
 * @return {{get: () => Promise<{config: Object, session: Object}>, run: (fn: ( env: Object ) => Promise<Object>) => Promise<Object>, touch: () => void, close: () => Promise<void>}} the holder
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
	const get = async () => {
		if ( ! config ) {
			config = await loadConfig( options.project, {
				fallback: ! options.project,
			} );
		}
		if ( ! session ) {
			await ensureChromium( { install: true } );
			if ( ! opening ) {
				opening = openSession( { config, log: () => {} } ).finally(
					() => {
						opening = null;
					}
				);
			}
			session = await opening;
		} else {
			await session.ensure();
		}
		armIdle();
		return { config, session };
	};
	return { get, run, touch: armIdle, close };
}
