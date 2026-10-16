import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { createRequire } from 'node:module';
import { presets, presetNames } from './presets.js';
import { loadSpec } from './spec.js';
import { runShots } from './runner.js';
import { ensureSupportedNode } from './runtime.js';

/**
 * Throw a user-facing error (printed without a stack trace by the CLI) when Playwright's Chromium is missing.
 * With `install: true`, download it first instead (unless WP_SCREENSHOTS_NO_AUTO_INSTALL is set, for CI).
 * @param {{install?: boolean}} [options]
 */
export async function ensureChromium( options = {} ) {
	const { chromium } = await import( '@playwright/test' );
	const exe = chromium.executablePath();
	if (
		( ! exe || ! fs.existsSync( exe ) ) &&
		options.install &&
		! process.env.WP_SCREENSHOTS_NO_AUTO_INSTALL
	) {
		// First run on a machine without the browser: fetch it (about 150 MB, a minute or two).
		const { spawnSync } = await import( 'node:child_process' );
		const cli = playwrightCliPath();
		const result = spawnSync(
			process.execPath,
			[ cli, 'install', 'chromium' ],
			{
				stdio: [ 'ignore', 'ignore', 'inherit' ],
			}
		);
		if ( result.status !== 0 ) {
			throw new Error(
				'Chromium download failed; run: npx playwright install chromium'
			);
		}
	}
	if ( ! exe || ! fs.existsSync( exe ) ) {
		throw userError(
			'Chromium is not installed for Playwright. Run once: npx playwright install chromium'
		);
	}
}

/**
 * A free TCP port on the config's host, for callers that may run several shoots at once.
 * @param {string} host
 * @return {Promise<number>} port
 */
export function freePort( host = '127.0.0.1' ) {
	return new Promise( ( resolve, reject ) => {
		const srv = net.createServer();
		srv.once( 'error', reject );
		srv.listen( 0, host, () => {
			const { port } = srv.address();
			srv.close( () => resolve( port ) );
		} );
	} );
}

/**
 * Render one image from a preset without a spec file: write a one-shot spec in a temp directory, run it into a
 * temp output directory, and copy the image to `out` (or return it in memory).
 *
 * @param {Object}             config           a loaded config (a project's, or the zero-config fallback)
 * @param {Object}             options
 * @param {string}             options.preset   preset name
 * @param {Object}             [options.params] preset parameters, for example { block: 'core/image', tab: 'styles' }
 * @param {string}             [options.id]     shot id (file name); defaults to the preset name
 * @param {string}             [options.alt]    alt text recorded in the manifest
 * @param {string}             [options.frame]  frame override (none | card | auto | wide | standard | portrait | banner)
 * @param {string|Object[]}    [options.setup]  site state to create first: a fixture name or a list of setup operations
 * @param {string}             [options.out]    where to copy the image; omit to keep it in memory only
 * @param {boolean}            [options.headed] show the browser
 * @param {number}             [options.port]   Playground port; 0 picks a free one
 * @param {(msg:string)=>void} [options.log]
 * @return {Promise<{file: string|null, buffer: Buffer, width: number, height: number, encoding: string, frame: string, alt: string}>} the image
 */
export async function shootPreset( config, options ) {
	const prepared = prepareShot( config, options );
	return renderShot( config, prepared, options );
}

/**
 * Validate a one-off shot and write its spec to a temp directory, without booting anything. Callers that keep a
 * warm session use this first so a bad request fails in milliseconds rather than after a boot.
 * @param {Object} config
 * @param {Object} options see shootPreset
 * @return {{spec: Object, tmp: string, id: string, alt: string, source: string, discard: () => void}} the loaded spec, its YAML source, its temp directory, and how to drop it when the shot is not rendered
 */
export function prepareShot( config, options ) {
	const name = options.preset || null;
	if ( name && ! presetNames.includes( name ) ) {
		throw userError(
			`unknown preset "${ name }". Known presets: ${ presetNames.join( ', ' ) }`
		);
	}
	if ( ! name && ! options.scene && ! options.steps?.length ) {
		throw userError(
			`give a preset (${ presetNames.join( ', ' ) }) or a scene and steps`
		);
	}
	const params = {};
	for ( const param of Object.keys( name ? presets[ name ].params : {} ) ) {
		const value = options.params?.[ param ];
		if ( value !== undefined && value !== null && value !== '' ) {
			params[ param ] = String( value );
		}
	}
	const id = String( options.id || name || 'shot' );
	const alt = String( options.alt || `${ name || 'WordPress' } screenshot` );
	const tmp = fs.mkdtempSync(
		path.join( os.tmpdir(), 'wp-screenshots-shoot-' )
	);
	const discard = () => fs.rmSync( tmp, { recursive: true, force: true } );
	const specFile = path.join( tmp, 'shoot.yaml' );
	// The YAML a spec file would carry for this shot; callers hand it back so a one-off becomes a committed spec.
	const source = YAML.stringify(
		buildAdhocSpec( name, params, id, alt, options )
	);
	fs.writeFileSync( specFile, source );
	try {
		const spec = loadSpec( specFile, { ...config, specsBase: tmp } );
		return { spec, tmp, id, alt, source, discard };
	} catch ( e ) {
		discard();
		if ( e.name !== 'SpecError' ) {
			throw e;
		}
		// The temp spec's path means nothing to the caller; keep the message about the shot itself.
		throw userError( e.message.replace( /^.*?shoot\.yaml: /, '' ) );
	}
}

/**
 * Render a prepared shot: boot (or reuse a session), run, copy the image out, clean up the temp directory.
 * @param {Object}                                                                    config
 * @param {{spec: Object, tmp: string, id: string, alt: string, discard: () => void}} prepared from prepareShot
 * @param {Object}                                                                    options  see shootPreset (session, out, headed, port, log)
 * @return {Promise<Object>} the image, as shootPreset describes
 */
export async function renderShot( config, prepared, options = {} ) {
	const { spec, tmp, id, alt } = prepared;
	try {
		if ( ! options.session ) {
			// Node before Chromium, so an unsupported Node gets its own message rather than a missing-browser one.
			// A passed-in session went through the same checks when it booted.
			ensureSupportedNode();
			await ensureChromium();
		}
		const adhoc = {
			...config,
			// A warm session already owns a port and a blueprint; a one-off run may pick a free port.
			port: await portFor( config, options ),
			outDir: path.join( tmp, 'out' ),
			workDir: path.join( tmp, 'work' ),
			docsDir: null,
			docsManifest: null,
		};
		const { summary, results } = await runShots( adhoc, {
			specs: [ spec ],
			mode: 'run',
			headed: Boolean( options.headed ),
			log: options.log,
			session: options.session,
		} );
		if ( summary.failed ) {
			const failure = ( results || [] ).find( ( r ) => r.error );
			throw new Error(
				`shoot failed: ${ failure?.error || 'see the log' }`
			);
		}
		const ext = config.style.format === 'png' ? 'png' : 'webp';
		const produced = path.join( adhoc.outDir, 'adhoc', `${ id }.${ ext }` );
		const buffer = fs.readFileSync( produced );
		const entry = JSON.parse(
			fs.readFileSync(
				path.join( adhoc.outDir, 'manifest.json' ),
				'utf8'
			)
		).shots[ `adhoc/${ id }` ];
		let file = null;
		if ( options.out ) {
			file = path.resolve( expandHome( String( options.out ) ) );
			fs.mkdirSync( path.dirname( file ), { recursive: true } );
			fs.copyFileSync( produced, file );
		}
		return {
			file,
			buffer,
			width: entry.width,
			height: entry.height,
			encoding: entry.encoding,
			frame: entry.frame,
			alt,
			mimeType: ext === 'png' ? 'image/png' : 'image/webp',
		};
	} finally {
		prepared.discard();
	}
}

function userError( message ) {
	return Object.assign( new Error( message ), { name: 'UserError' } );
}

async function portFor( config, options ) {
	if ( options.session ) {
		return options.session.config.port;
	}
	if ( options.port === 0 ) {
		return freePort( config.host );
	}
	return options.port || config.port;
}

/**
 * The one-shot spec document `shoot` renders, as plain data (serialised to YAML and validated by loadSpec).
 * @param {string|null} preset  a preset name, or null for a shot described by scene and steps
 * @param {Object}      params
 * @param {string}      id
 * @param {string}      alt
 * @param {Object}      options frame, annotate, include, pad, setup
 * @return {Object} spec data
 */
export function buildAdhocSpec( preset, params, id, alt, options = {} ) {
	const capture = {};
	if ( options.fit ) {
		capture.fit = String( options.fit );
	}
	if ( options.mask?.length ) {
		capture.mask = options.mask;
	}
	if ( options.target ) {
		capture.target = String( options.target );
	}
	if ( options.frame ) {
		capture.frame = String( options.frame );
	}
	if ( options.annotate?.length ) {
		capture.annotate = options.annotate;
	}
	if ( options.include?.length ) {
		capture.include = options.include;
	}
	if ( options.pad !== undefined && options.pad !== null ) {
		capture.pad = Number( options.pad );
	}
	const shot = { id, alt };
	if ( preset ) {
		shot.preset = preset;
		Object.assign( shot, params );
	}
	if ( options.scene ) {
		shot.scene = String( options.scene );
	}
	if ( options.viewport ) {
		shot.viewport = options.viewport;
	}
	if (
		options.setup !== undefined &&
		options.setup !== null &&
		! ( Array.isArray( options.setup ) && ! options.setup.length )
	) {
		// loadSpec validates it (a fixture name or a list of operations).
		shot.setup = options.setup;
	}
	if ( options.steps?.length ) {
		shot.steps = options.steps;
	}
	if ( Object.keys( capture ).length ) {
		shot.capture = capture;
	}
	return { article: 'adhoc', shots: [ shot ] };
}

/**
 * Expand a leading `~` the way a shell would; Node does not.
 * @param {string} p
 * @return {string} path
 */
export function expandHome( p ) {
	if ( p === '~' ) {
		return os.homedir();
	}
	if ( p.startsWith( '~/' ) || p.startsWith( '~\\' ) ) {
		return path.join( os.homedir(), p.slice( 2 ) );
	}
	return p;
}

/**
 * Playwright's command-line entry point, resolved through an export the package actually declares.
 * `playwright/cli.js` is not in the package's exports map (ERR_PACKAGE_PATH_NOT_EXPORTED on a fresh install);
 * `@playwright/test/cli` is.
 * @return {string} absolute path to the CLI script
 */
export function playwrightCliPath() {
	return createRequire( import.meta.url ).resolve( '@playwright/test/cli' );
}
