import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mergeStyle } from './style.js';

const DEFAULTS = {
	// Where the YAML specs are: glob patterns relative to the config file (`docs/**/*.shots.yaml` to keep a spec
	// next to its article, `shots/**/*.yaml` for a mirrored tree). Default: everything under `shotsDir`.
	specs: null,
	shotsDir: 'shots',
	outDir: '../docs/assets/screenshots',
	docsDir: '../docs',
	docsManifest: null,
	blueprint: 'blueprint/blueprint.json',
	suitesDir: 'blueprint/suites',
	workDir: '.wp-screenshots',
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
 *
 * With `fallback`, a missing config is not an error: the engine runs against the bundled demo site
 * (`@wporg-docs/demo-site`) with output and working files in a temp directory, which is what makes
 * `wp-screenshots shoot` work from any directory with nothing set up.
 * @param {string}  [configPath]
 * @param {Object}  [options]
 * @param {boolean} [options.fallback] use the bundled demo site when no config is found
 */
export async function loadConfig( configPath, options = {} ) {
	const file = path.resolve( configPath || findConfig( process.cwd() ) );
	let user;
	let root;
	let fallback = false;
	if ( fs.existsSync( file ) ) {
		const mod = await import( pathToFileURL( file ).href );
		user = mod.default || mod;
		root = path.dirname( file );
	} else if ( options.fallback && ! configPath ) {
		user = demoSiteConfig();
		root = process.cwd();
		fallback = true;
	} else {
		throw new Error(
			`Config not found: ${ file }. Run from the project directory (the one holding shots.config.js) or pass --config. For a one-off image with no project, \`wp-screenshots shoot --preset <name>\` needs no config.`
		);
	}
	const merged = {
		...DEFAULTS,
		...user,
		wordpress: { ...DEFAULTS.wordpress, ...( user.wordpress || {} ) },
		user: { ...DEFAULTS.user, ...( user.user || {} ) },
	};
	const style = mergeStyle( {
		format: merged.format,
		...( merged.style || {} ),
	} );
	const resolve = ( p ) => ( p ? path.resolve( root, p ) : null );
	const specs = merged.specs
		? ( Array.isArray( merged.specs )
				? merged.specs
				: [ merged.specs ]
			).map( String )
		: null;
	return {
		...merged,
		root,
		configFile: fallback ? null : file,
		fallback,
		specs,
		// Spec paths are reported relative to this directory.
		specsBase: specs ? root : resolve( merged.shotsDir ),
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

/**
 * The zero-config project: the bundled demo site, everything else in a temp directory.
 * @return {Object} user-level config values (resolved against the cwd by loadConfig)
 */
export function demoSiteConfig() {
	const require = createRequire( import.meta.url );
	const pkg = require.resolve( '@wporg-docs/demo-site/package.json' );
	const scratch = path.join( os.tmpdir(), 'wp-screenshots' );
	return {
		blueprint: path.join( path.dirname( pkg ), 'blueprint.json' ),
		suitesDir: path.join( path.dirname( pkg ), 'suites' ),
		shotsDir: path.join( scratch, 'shots' ),
		outDir: path.join( scratch, 'out' ),
		docsDir: null,
		docsManifest: null,
		workDir: path.join( scratch, 'work' ),
		wordpress: { version: '7.1.3', php: '8.3' },
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
 * @param {Object} config
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
