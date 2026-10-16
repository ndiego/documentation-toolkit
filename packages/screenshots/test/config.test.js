import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, blueprintForSuite } from '../src/config.js';
import { defaultStyle } from '../src/style.js';

let root;
let counter = 0;

before( () => {
	root = fs.realpathSync(
		fs.mkdtempSync( path.join( os.tmpdir(), 'wp-screenshots-config-' ) )
	);
} );

after( () => {
	fs.rmSync( root, { recursive: true, force: true } );
} );

// Write a config module into a fresh project directory and return its path.
function writeConfig( source, name = 'shots.config.js' ) {
	// Each test gets its own directory: ESM imports are cached by URL, so a reused path would return stale config.
	const dir = path.join( root, `p${ counter++ }` );
	fs.mkdirSync( dir, { recursive: true } );
	const file = path.join( dir, name );
	fs.writeFileSync( file, source );
	return file;
}

// Run fn with process.cwd() set to dir, restoring it afterwards.
async function inDir( dir, fn ) {
	const previous = process.cwd();
	process.chdir( dir );
	let result;
	try {
		result = await fn();
	} finally {
		process.chdir( previous );
	}
	return result;
}

describe( 'loadConfig', () => {
	it( 'applies defaults and resolves every path against the config file directory', async () => {
		const file = writeConfig( 'export default {};\n' );
		const dir = path.dirname( file );
		const config = await loadConfig( file );
		assert.equal( config.root, dir );
		assert.equal( config.configFile, file );
		assert.equal( config.shotsDir, path.join( dir, 'shots' ) );
		assert.equal(
			config.outDir,
			path.resolve( dir, '../docs/assets/screenshots' )
		);
		assert.equal( config.docsDir, path.resolve( dir, '../docs' ) );
		assert.equal( config.docsManifest, null );
		assert.equal(
			config.blueprint,
			path.join( dir, 'blueprint/blueprint.json' )
		);
		assert.equal( config.suitesDir, path.join( dir, 'blueprint/suites' ) );
		assert.equal( config.workDir, path.join( dir, '.wp-screenshots' ) );
		assert.deepEqual( config.wordpress, { version: 'latest', php: '8.3' } );
		assert.deepEqual( config.user, {
			username: 'admin',
			password: 'password',
		} );
		assert.equal( config.host, '127.0.0.1' );
		assert.equal( config.port, 9400 );
		assert.equal( config.format, 'webp' );
		assert.match( config.dockerImage, /^mcr\.microsoft\.com\/playwright:/ );
	} );

	it( 'builds the style from the defaults plus the output format', async () => {
		const config = await loadConfig(
			writeConfig( 'export default {};\n' )
		);
		assert.deepEqual( config.style, { ...defaultStyle, format: 'webp' } );
	} );

	it( 'merges user overrides, one level deep for wordpress, user and style', async () => {
		const file = writeConfig( `export default {
	shotsDir: 'specs',
	outDir: 'public/img',
	docsDir: '../handbook',
	docsManifest: '../handbook/manifest.json',
	format: 'png',
	port: 9500,
	wordpress: { version: '6.8' },
	user: { username: 'editor' },
	style: { pad: 4, outline: { color: 'red' }, viewports: { wide: { width: 1920, height: 1080 } } },
};
` );
		const dir = path.dirname( file );
		const config = await loadConfig( file );
		assert.equal( config.shotsDir, path.join( dir, 'specs' ) );
		assert.equal( config.outDir, path.join( dir, 'public/img' ) );
		assert.equal( config.docsDir, path.resolve( dir, '../handbook' ) );
		assert.equal(
			config.docsManifest,
			path.resolve( dir, '../handbook/manifest.json' )
		);
		assert.equal( config.port, 9500 );
		assert.deepEqual( config.wordpress, { version: '6.8', php: '8.3' } );
		assert.deepEqual( config.user, {
			username: 'editor',
			password: 'password',
		} );
		assert.equal( config.style.format, 'png' );
		assert.equal( config.style.pad, 4 );
		assert.deepEqual( config.style.outline, {
			...defaultStyle.outline,
			color: 'red',
		} );
		assert.deepEqual(
			config.style.viewports.desktop,
			defaultStyle.viewports.desktop
		);
		assert.deepEqual( config.style.viewports.wide, {
			width: 1920,
			height: 1080,
		} );
	} );

	it( 'lets style.format win over the top-level format', async () => {
		const config = await loadConfig(
			writeConfig(
				"export default { format: 'webp', style: { format: 'png' } };\n"
			)
		);
		assert.equal( config.style.format, 'png' );
	} );

	it( 'accepts a relative config path, resolved from the current directory', async () => {
		const file = writeConfig( 'export default { port: 1234 };\n' );
		const config = await inDir( path.dirname( file ), () =>
			loadConfig( 'shots.config.js' )
		);
		assert.equal( config.port, 1234 );
		assert.equal( config.configFile, file );
	} );

	it( 'discovers shots.config.js from a subdirectory of the project', async () => {
		const file = writeConfig( 'export default { port: 4321 };\n' );
		const deep = path.join( path.dirname( file ), 'shots', 'blocks' );
		fs.mkdirSync( deep, { recursive: true } );
		const config = await inDir( deep, () => loadConfig() );
		assert.equal( config.port, 4321 );
		assert.equal( config.configFile, file );
		assert.equal( config.root, path.dirname( file ) );
	} );

	it( 'discovers shots.config.mjs too', async () => {
		const file = writeConfig(
			'export default { port: 1111 };\n',
			'shots.config.mjs'
		);
		const config = await inDir( path.dirname( file ), () => loadConfig() );
		assert.equal( config.port, 1111 );
		assert.equal( config.configFile, file );
	} );

	it( 'explains itself when no config exists', async () => {
		const empty = path.join( root, 'empty' );
		fs.mkdirSync( empty, { recursive: true } );
		await assert.rejects(
			inDir( empty, () => loadConfig() ),
			( e ) => {
				assert.match( e.message, /^Config not found: / );
				assert.ok(
					e.message.includes( path.join( empty, 'shots.config.js' ) )
				);
				assert.match(
					e.message,
					/Run from the project directory \(the one holding shots\.config\.js\) or pass --config\./
				);
				return true;
			}
		);
		await assert.rejects(
			loadConfig( path.join( empty, 'nope.config.js' ) ),
			/Config not found: .*nope\.config\.js/
		);
	} );
} );

describe( 'blueprintForSuite', () => {
	it( 'returns the main blueprint for the default suite', () => {
		const config = {
			blueprint: '/p/blueprint/blueprint.json',
			suitesDir: '/p/blueprint/suites',
		};
		assert.equal(
			blueprintForSuite( config ),
			'/p/blueprint/blueprint.json'
		);
		assert.equal(
			blueprintForSuite( config, 'default' ),
			'/p/blueprint/blueprint.json'
		);
	} );

	it( 'returns <suitesDir>/<suite>/blueprint.json when it exists', () => {
		const suitesDir = path.join( root, 'suites' );
		const file = path.join( suitesDir, 'woo', 'blueprint.json' );
		fs.mkdirSync( path.dirname( file ), { recursive: true } );
		fs.writeFileSync( file, '{}' );
		assert.equal(
			blueprintForSuite( { blueprint: '/x', suitesDir }, 'woo' ),
			file
		);
	} );

	it( 'throws for a suite with no blueprint', () => {
		const suitesDir = path.join( root, 'suites' );
		assert.throws(
			() =>
				blueprintForSuite( { blueprint: '/x', suitesDir }, 'missing' ),
			/Suite "missing" has no blueprint at .*suites\/missing\/blueprint\.json/
		);
	} );
} );

describe( 'zero-config fallback', () => {
	it( 'uses the bundled demo site when no config exists and fallback is requested', async () => {
		const empty = fs.mkdtempSync(
			path.join( os.tmpdir(), 'wp-screenshots-nocfg-' )
		);
		const cwd = process.cwd();
		process.chdir( empty );
		try {
			const config = await loadConfig( undefined, { fallback: true } );
			assert.equal( config.fallback, true );
			assert.equal( config.configFile, null );
			assert.ok(
				config.blueprint.endsWith(
					path.join( 'demo-site', 'blueprint.json' )
				)
			);
			assert.ok( fs.existsSync( config.blueprint ) );
			assert.equal( config.docsDir, null );
			assert.ok(
				config.outDir.startsWith( fs.realpathSync( os.tmpdir() ) ) ||
					config.outDir.startsWith( os.tmpdir() )
			);
			assert.equal( config.wordpress.version, '7.1.3' );
			await assert.rejects(
				() => loadConfig( undefined ),
				/Config not found/
			);
			await assert.rejects(
				() => loadConfig( 'nope.config.js', { fallback: true } ),
				/Config not found/
			);
		} finally {
			process.chdir( cwd );
			fs.rmSync( empty, { recursive: true, force: true } );
		}
	} );
} );
