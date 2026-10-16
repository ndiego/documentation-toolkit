import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	presets,
	presetNames,
	expandPreset,
	presetParamNames,
} from '../src/presets.js';

describe( 'presets', () => {
	it( 'lists every preset with a description and params', () => {
		assert.deepEqual( presetNames, [
			'block-canvas',
			'block-toolbar',
			'block-settings',
			'site-editor',
			'post-editor',
			'admin-screen',
			'front-end',
		] );
		for ( const name of presetNames ) {
			assert.ok( presets[ name ].description );
			assert.equal( typeof presets[ name ].expand, 'function' );
		}
	} );

	it( 'block-canvas opens the showcase post, selects the block and crops to it with its toolbar', () => {
		const out = expandPreset( 'block-canvas', { block: 'core/image' } );
		assert.equal( out.scene, 'post:block-image' );
		assert.deepEqual( out.steps, [ { selectBlock: 'core/image' } ] );
		assert.deepEqual( out.capture, {
			target: 'selected-block',
			include: [ 'block-toolbar' ],
			pad: 20,
			frame: 'auto',
		} );
	} );

	it( 'derives the showcase slug from namespaced block names', () => {
		assert.equal(
			expandPreset( 'block-toolbar', {
				block: 'woocommerce/product-price',
			} ).scene,
			'post:block-woocommerce-product-price'
		);
	} );

	it( 'post: new inserts the block into a fresh post instead', () => {
		const out = expandPreset( 'block-canvas', {
			block: 'core/table',
			post: 'new',
		} );
		assert.equal( out.scene, 'new-post' );
		assert.deepEqual( out.steps, [ { insertBlock: 'core/table' } ] );
	} );

	it( 'block-settings opens the inspector tab and an optional panel, portrait', () => {
		const out = expandPreset( 'block-settings', {
			block: 'core/image',
			tab: 'styles',
			panel: 'Dimensions',
		} );
		assert.deepEqual( out.steps, [
			{ selectBlock: 'core/image' },
			{ openInspector: 'styles' },
			{ openPanel: 'Dimensions' },
		] );
		assert.equal( out.capture.target, 'inspector' );
		assert.equal( out.capture.frame, 'portrait' );
		assert.equal(
			expandPreset( 'block-settings', { block: 'core/image' } ).steps[ 1 ]
				.openInspector,
			'settings'
		);
	} );

	it( 'site-editor, post-editor, admin-screen and front-end build their scenes', () => {
		assert.equal( expandPreset( 'site-editor', {} ).scene, 'site-editor' );
		assert.equal(
			expandPreset( 'site-editor', { view: 'styles' } ).scene,
			'site-editor:styles'
		);
		assert.equal( expandPreset( 'post-editor', {} ).scene, 'new-post' );
		assert.equal(
			expandPreset( 'post-editor', { post: 'post-long' } ).scene,
			'post:post-long'
		);
		assert.equal(
			expandPreset( 'admin-screen', { screen: 'plugins.php' } ).scene,
			'admin:plugins.php'
		);
		assert.equal( expandPreset( 'front-end', {} ).scene, 'front' );
		assert.equal(
			expandPreset( 'front-end', { path: '/about/' } ).scene,
			'front:/about/'
		);
	} );

	it( 'rejects missing required params, bad options and non-strings', () => {
		assert.throws(
			() => expandPreset( 'block-canvas', {} ),
			/needs `block`/
		);
		assert.throws(
			() => expandPreset( 'admin-screen', {} ),
			/needs `screen`/
		);
		assert.throws(
			() =>
				expandPreset( 'block-settings', {
					block: 'core/image',
					tab: 'layout',
				} ),
			/must be one of content \| settings \| styles/
		);
		assert.throws(
			() => expandPreset( 'block-canvas', { block: 7 } ),
			/must be a string/
		);
		assert.throws( () => expandPreset( 'nope', {} ), /unknown preset/ );
	} );

	it( 'exposes param names for key validation', () => {
		assert.deepEqual( presetParamNames( 'block-settings' ), [
			'block',
			'post',
			'tab',
			'panel',
		] );
		assert.deepEqual( presetParamNames( 'nope' ), [] );
	} );
} );
