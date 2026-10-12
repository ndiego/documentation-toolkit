import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { mergeStyle } from './style.js';

const DEFAULTS = {
	shotsDir: 'shots',
	outDir: '../docs/assets/screenshots',
	docsDir: '../docs',
	docsManifest: null,
	blueprint: 'blueprint/blueprint.json',
	suitesDir: 'blueprint/suites',
	workDir: '.wp-shots',
	wordpress: { version: 'latest', php: '8.3' },
	host: '127.0.0.1',
	port: 9400,
	user: { username: 'admin', password: 'password' },
	format: 'webp',
	// Docker image used for canonical renders (`--docker`).
	dockerImage: 'mcr.microsoft.com/playwright:v1.64.0-noble',
	style: {},
};

/**
 * Load `shots.config.js` (or the file given) and resolve every path against its directory.
 * @param {string} [configPath]
 */
export async function loadConfig( configPath ) {
	const file = path.resolve( configPath || findConfig( process.cwd() ) );
	if ( ! fs.existsSync( file ) ) {
		throw new Error( `Config not found: ${ file }. Run from the screenshots/ directory or pass --config.` );
	}
	const mod = await import( pathToFileURL( file ).href );
	const user = mod.default || mod;
	const root = path.dirname( file );
	const merged = { ...DEFAULTS, ...user, wordpress: { ...DEFAULTS.wordpress, ...( user.wordpress || {} ) }, user: { ...DEFAULTS.user, ...( user.user || {} ) } };
	const style = mergeStyle( { format: merged.format, ...( merged.style || {} ) } );
	const resolve = ( p ) => ( p ? path.resolve( root, p ) : null );
	return {
		...merged,
		root,
		configFile: file,
		shotsDir: resolve( merged.shotsDir ),
		outDir: resolve( merged.outDir ),
		docsDir: resolve( merged.docsDir ),
		docsManifest: resolve( merged.docsManifest ),
		blueprint: resolve( merged.blueprint ),
		suitesDir: resolve( merged.suitesDir ),
		workDir: resolve( merged.workDir ),
		style,
	};
}

function findConfig( from ) {
	let dir = from;
	for ( let i = 0; i < 5; i++ ) {
		for ( const name of [ 'shots.config.js', 'shots.config.mjs' ] ) {
			const candidate = path.join( dir, name );
			if ( fs.existsSync( candidate ) ) {
				return candidate;
			}
		}
		const parent = path.dirname( dir );
		if ( parent === dir ) {
			break;
		}
		dir = parent;
	}
	return path.join( from, 'shots.config.js' );
}

/**
 * Blueprint path for a suite name.
 * @param {object} config
 * @param {string} suite
 */
export function blueprintForSuite( config, suite = 'default' ) {
	if ( suite === 'default' ) {
		return config.blueprint;
	}
	const file = path.join( config.suitesDir, suite, 'blueprint.json' );
	if ( ! fs.existsSync( file ) ) {
		throw new Error( `Suite "${ suite }" has no blueprint at ${ file }` );
	}
	return file;
}
