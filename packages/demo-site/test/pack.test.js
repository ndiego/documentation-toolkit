import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'..'
);
const blueprint = JSON.parse(
	fs.readFileSync( path.join( root, 'blueprint.json' ), 'utf8' )
);
const content = JSON.parse(
	fs.readFileSync( path.join( root, 'content/content.json' ), 'utf8' )
);
const seed = fs.readFileSync( path.join( root, 'content/seed.php' ), 'utf8' );

describe( 'blueprint', () => {
	it( 'pins WordPress and PHP, logs in, and activates the vendored Ipsum theme', () => {
		assert.equal( blueprint.preferredVersions.wp, '7.1.3' );
		assert.equal( blueprint.preferredVersions.php, '8.3' );
		assert.equal( blueprint.features.networking, false );
		const steps = blueprint.steps.map( ( s ) => s.step );
		assert.ok( steps.includes( 'login' ) );
		const unzip = blueprint.steps.find( ( s ) => s.step === 'unzip' );
		assert.equal( unzip.zipFile.path, 'themes/ipsum.zip' );
		assert.equal( unzip.extractToPath, '/wordpress/wp-content/themes' );
		const activate = blueprint.steps.find(
			( s ) => s.step === 'activateTheme'
		);
		assert.equal( activate.themeFolderName, 'ipsum' );
		assert.ok(
			steps.indexOf( 'unzip' ) < steps.indexOf( 'activateTheme' )
		);
	} );

	it( 'bundles only files that exist', () => {
		for ( const step of blueprint.steps ) {
			const bundled = [ step.data, step.zipFile ].find(
				( d ) => d?.resource === 'bundled'
			);
			if ( bundled ) {
				assert.ok(
					fs.existsSync( path.join( root, bundled.path ) ),
					`${ bundled.path } is bundled but missing`
				);
			}
		}
	} );

	it( 'ships a theme zip whose root folder is ipsum/', () => {
		const listing = execFileSync(
			'unzip',
			[ '-Z1', path.join( root, 'themes/ipsum.zip' ) ],
			{ encoding: 'utf8' }
		)
			.trim()
			.split( '\n' );
		assert.ok( listing.includes( 'ipsum/style.css' ) );
		assert.ok( listing.includes( 'ipsum/theme.json' ) );
		assert.ok( listing.every( ( f ) => f.startsWith( 'ipsum/' ) ) );
		assert.ok( ! listing.some( ( f ) => f.includes( 'node_modules' ) ) );
		assert.match(
			fs.readFileSync( path.join( root, 'themes/IPSUM.md' ), 'utf8' ),
			/^Commit: [0-9a-f]{40}$/m
		);
	} );
} );

describe( 'content pack', () => {
	it( 'seeds every media slug the index promises, with a bundled file', () => {
		for ( const [ slug, item ] of Object.entries( content.media ) ) {
			assert.ok(
				fs.existsSync( path.join( root, 'content', item.file ) ),
				`${ slug }: ${ item.file } missing`
			);
			assert.ok(
				seed.includes( `'${ slug }'` ),
				`${ slug } not in seed.php`
			);
		}
	} );

	it( 'seeds the showcase posts the block presets rely on', () => {
		for ( const [ slug, item ] of Object.entries( content.blocks ) ) {
			assert.equal( slug, item.post );
			assert.ok(
				seed.includes( `'${ slug }'` ),
				`${ slug } not in seed.php`
			);
		}
		assert.ok( content.blocks[ 'block-image' ] );
	} );

	it( 'the mu-plugin exposes wp_screenshots on the REST index', () => {
		const plugin = fs.readFileSync(
			path.join( root, 'mu-plugins/wp-screenshots-demo.php' ),
			'utf8'
		);
		assert.ok( plugin.includes( "$data['wp_screenshots']" ) );
		assert.ok( ! /wp_shots\b/.test( plugin ) );
	} );
} );
