import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { buildAdhocSpec, expandHome, playwrightCliPath } from '../src/shoot.js';
import { loadSpec } from '../src/spec.js';
import { mergeStyle } from '../src/style.js';

describe( 'buildAdhocSpec', () => {
	it( 'produces a spec that loadSpec accepts, with annotations and frame', () => {
		const data = buildAdhocSpec(
			'post-editor',
			{ post: 'block-image' },
			'draft',
			'The editor',
			{
				frame: 'wide',
				annotate: [
					{
						arrow: {
							button: 'Save draft',
							exact: false,
							from: 'bottom',
						},
					},
				],
				include: [ 'top-bar' ],
				pad: 12,
			}
		);
		const dir = fs.mkdtempSync(
			path.join( os.tmpdir(), 'wp-screenshots-adhoc-' )
		);
		const file = path.join( dir, 'shoot.yaml' );
		fs.writeFileSync( file, YAML.stringify( data ) );
		const spec = loadSpec( file, { style: mergeStyle(), specsBase: dir } );
		const [ shot ] = spec.shots;
		assert.equal( shot.preset, 'post-editor' );
		assert.equal( shot.scene, 'post:block-image' );
		assert.equal( shot.capture.frame, 'wide' );
		assert.deepEqual( shot.capture.include, [ 'top-bar' ] );
		assert.equal( shot.capture.pad, 12 );
		assert.deepEqual( shot.capture.annotate, [
			{
				type: 'arrow',
				button: 'Save draft',
				exact: false,
				from: 'bottom',
			},
		] );
		fs.rmSync( dir, { recursive: true, force: true } );
	} );

	it( 'leaves capture out when nothing is set', () => {
		const data = buildAdhocSpec( 'site-editor', {}, 'home', 'Home', {} );
		assert.equal( data.shots[ 0 ].capture, undefined );
	} );

	it( 'expands a leading tilde and nothing else', () => {
		assert.equal(
			expandHome( '~/x/y.webp' ),
			path.join( os.homedir(), 'x/y.webp' )
		);
		assert.equal( expandHome( '~' ), os.homedir() );
		assert.equal( expandHome( '/abs/~/keep' ), '/abs/~/keep' );
		assert.equal( expandHome( 'rel.webp' ), 'rel.webp' );
	} );

	it( 'resolves the Playwright CLI through a declared export', () => {
		const cli = playwrightCliPath();
		assert.ok( fs.existsSync( cli ), cli );
		assert.match( cli, /cli\.js$/ );
	} );

	it( 'builds a free-form shot from scene and steps without a preset', () => {
		const data = buildAdhocSpec( null, {}, 'inserter', 'The inserter', {
			scene: 'new-post',
			steps: [ { searchInserter: 'Gallery' } ],
			target: 'inserter',
			frame: 'portrait',
			viewport: 'narrow',
		} );
		const dir = fs.mkdtempSync(
			path.join( os.tmpdir(), 'wp-screenshots-adhoc-' )
		);
		const file = path.join( dir, 'shoot.yaml' );
		fs.writeFileSync( file, YAML.stringify( data ) );
		const [ shot ] = loadSpec( file, {
			style: mergeStyle(),
			specsBase: dir,
		} ).shots;
		assert.equal( shot.preset, null );
		assert.equal( shot.scene, 'new-post' );
		assert.equal( shot.viewport, 'narrow' );
		assert.deepEqual(
			shot.steps.map( ( s ) => s.verb ),
			[ 'searchInserter' ]
		);
		assert.equal( shot.capture.target, 'inserter' );
		fs.rmSync( dir, { recursive: true, force: true } );
	} );
} );
