import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { presets, presetNames } from './presets.js';
import { loadSpec } from './spec.js';
import { runShots } from './runner.js';

/**
 * Throw a user-facing error (printed without a stack trace by the CLI) when Playwright's Chromium is missing.
 */
export async function ensureChromium() {
	const { chromium } = await import( '@playwright/test' );
	const exe = chromium.executablePath();
	if ( ! exe || ! fs.existsSync( exe ) ) {
		throw Object.assign(
			new Error(
				'Chromium is not installed for Playwright. Run once: npx playwright install chromium'
			),
			{ name: 'UserError' }
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
 * @param {string}             [options.out]    where to copy the image; omit to keep it in memory only
 * @param {boolean}            [options.headed] show the browser
 * @param {number}             [options.port]   Playground port; 0 picks a free one
 * @param {(msg:string)=>void} [options.log]
 * @return {Promise<{file: string|null, buffer: Buffer, width: number, height: number, encoding: string, frame: string, alt: string}>} the image
 */
export async function shootPreset( config, options ) {
	const name = options.preset;
	if ( ! name || ! presetNames.includes( name ) ) {
		throw Object.assign(
			new Error(
				`unknown preset "${ name }". Known presets: ${ presetNames.join( ', ' ) }`
			),
			{ name: 'UserError' }
		);
	}
	await ensureChromium();
	const params = {};
	for ( const param of Object.keys( presets[ name ].params ) ) {
		const value = options.params?.[ param ];
		if ( value !== undefined && value !== null && value !== '' ) {
			params[ param ] = String( value );
		}
	}
	const id = String( options.id || name );
	const alt = String( options.alt || `${ name } screenshot` );
	const tmp = fs.mkdtempSync(
		path.join( os.tmpdir(), 'wp-screenshots-shoot-' )
	);
	try {
		const specFile = path.join( tmp, 'shoot.yaml' );
		const body = [
			'article: adhoc',
			'shots:',
			`  - id: ${ JSON.stringify( id ) }`,
			`    preset: ${ name }`,
			`    alt: ${ JSON.stringify( alt ) }`,
			...Object.entries( params ).map(
				( [ k, v ] ) => `    ${ k }: ${ JSON.stringify( v ) }`
			),
			...( options.frame
				? [
						`    capture: { frame: ${ JSON.stringify( String( options.frame ) ) } }`,
					]
				: [] ),
		].join( '\n' );
		fs.writeFileSync( specFile, body + '\n' );
		const adhoc = {
			...config,
			// A warm session already owns a port and a blueprint; a one-off run may pick a free port.
			port: await portFor( config, options ),
			outDir: path.join( tmp, 'out' ),
			workDir: path.join( tmp, 'work' ),
			docsDir: null,
			docsManifest: null,
		};
		const spec = loadSpec( specFile, { ...adhoc, specsBase: tmp } );
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
			file = path.resolve( String( options.out ) );
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
		fs.rmSync( tmp, { recursive: true, force: true } );
	}
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
