import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	resolveTarget,
	targetNames,
	validateTargetName,
	looksLikeSelector,
	isFullViewport,
} from '../src/targets.js';
import { fakeContext } from './fake-page.js';

const FULL = [ 'editor', 'admin-screen', 'front', 'viewport', 'page' ];
const REGIONS = [
	'canvas',
	'selected-block',
	'block-toolbar',
	'inspector',
	'document-sidebar',
	'inserter',
	'list-view',
	'top-bar',
	'options-menu',
	'popover',
	'modal',
	'site-editor-sidebar',
	'site-editor-canvas',
	'admin-content',
	'admin-menu',
];

describe( 'targetNames', () => {
	it( 'lists full-viewport names, regions and the inspector-panel form', () => {
		assert.deepEqual( targetNames, [
			...FULL,
			...REGIONS,
			'inspector-panel:<name>',
		] );
	} );
} );

describe( 'looksLikeSelector', () => {
	it( 'accepts strings that start like CSS or contain combinators', () => {
		for ( const s of [
			'.foo',
			'#bar',
			'[data-x]',
			'div > p',
			'li:first-child',
			'ul li',
			'a*',
		] ) {
			assert.ok( looksLikeSelector( s ), s );
		}
	} );

	it( 'rejects bare words', () => {
		for ( const s of [ 'inspector', 'inspectr', 'div', 'my-panel' ] ) {
			assert.ok( ! looksLikeSelector( s ), s );
		}
	} );
} );

describe( 'validateTargetName', () => {
	it( 'allows nothing (the whole viewport)', () => {
		assert.equal( validateTargetName( null ), null );
		assert.equal( validateTargetName( undefined ), null );
	} );

	it( 'allows every known name', () => {
		for ( const name of [ ...FULL, ...REGIONS ] ) {
			assert.equal( validateTargetName( name ), null, name );
		}
	} );

	it( 'allows inspector-panel:<name> and selector-looking strings', () => {
		assert.equal(
			validateTargetName( 'inspector-panel:Dimensions' ),
			null
		);
		assert.equal(
			validateTargetName( 'inspector-panel:Advanced settings' ),
			null
		);
		assert.equal( validateTargetName( '#the-list tr:first-child' ), null );
		assert.equal( validateTargetName( '.components-popover' ), null );
		assert.equal( validateTargetName( '[aria-label="Settings"]' ), null );
	} );

	it( 'rejects non-strings', () => {
		assert.equal( validateTargetName( 7 ), 'target must be a string' );
		assert.equal(
			validateTargetName( { name: 'inspector' } ),
			'target must be a string'
		);
	} );

	it( 'rejects typos that would otherwise become selectors, listing the known names', () => {
		for ( const bad of [
			'inspectr',
			'Inspector',
			'inspector-panel',
			'toolbar',
			'the-list',
		] ) {
			const problem = validateTargetName( bad );
			assert.ok( problem, bad );
			assert.match(
				problem,
				new RegExp(
					`^unknown target "${ bad }"\\. Known targets: editor, .*inspector-panel:<name>\\. A CSS selector must start with "\\.", "#" or "\\["\\.$`
				)
			);
		}
	} );
} );

describe( 'isFullViewport', () => {
	it( 'is true for no target and the full-viewport names only', () => {
		assert.equal( isFullViewport( null ), true );
		assert.equal( isFullViewport( '' ), true );
		for ( const name of FULL ) {
			assert.equal( isFullViewport( name ), true, name );
		}
		assert.equal( isFullViewport( 'inspector' ), false );
		assert.equal( isFullViewport( '.foo' ), false );
	} );
} );

describe( 'resolveTarget', () => {
	it( 'resolves nothing and full-viewport names to null without touching the page', async () => {
		const ctx = {};
		assert.equal( await resolveTarget( ctx, null ), null );
		assert.equal( await resolveTarget( ctx, undefined ), null );
		assert.equal( await resolveTarget( ctx, '' ), null );
		for ( const name of FULL ) {
			assert.equal( await resolveTarget( ctx, name ), null, name );
		}
	} );

	it( 'dispatches registry names to the page or the editor canvas', async () => {
		const ctx = fakeContext();
		assert.equal(
			( await resolveTarget( ctx, 'canvas' ) ).path,
			'page > locator(iframe[name="editor-canvas"])'
		);
		assert.equal(
			( await resolveTarget( ctx, 'selected-block' ) ).path,
			'canvas > locator(.block-editor-block-list__block.is-selected) > first'
		);
		assert.equal(
			( await resolveTarget( ctx, 'modal' ) ).path,
			'page > locator(.components-modal__frame) > last'
		);
		assert.equal(
			( await resolveTarget( ctx, 'admin-content' ) ).path,
			'page > locator(#wpbody-content)'
		);
		assert.equal(
			( await resolveTarget( ctx, 'inspector' ) ).path,
			( await resolveTarget( ctx, 'document-sidebar' ) ).path
		);
	} );

	it( 'resolves inspector-panel:<name> to the sidebar panel owning that toggle button', async () => {
		const ctx = fakeContext();
		const loc = await resolveTarget( ctx, 'inspector-panel:Dimensions' );
		assert.equal(
			loc.path,
			'page > locator(.interface-complementary-area, .editor-sidebar) > first > locator(.components-panel__body, .components-tools-panel) > filter(has page > role(button,{"name":"Dimensions","exact":true})) > first'
		);
	} );

	it( 'rejects a typo instead of treating it as a selector', async () => {
		await assert.rejects(
			resolveTarget( fakeContext(), 'inspectr' ),
			/^Error: unknown target "inspectr"\. Known targets: /
		);
	} );

	it( 'looks a selector up in the page first, then the editor canvas', async () => {
		const inPage = fakeContext( ( p ) =>
			p.startsWith( 'page' ) ? 1 : 0
		);
		assert.equal(
			( await resolveTarget( inPage, '.foo' ) ).path,
			'page > locator(.foo) > first'
		);

		const inCanvas = fakeContext( ( p ) =>
			p.startsWith( 'canvas' ) ? 2 : 0
		);
		assert.equal(
			( await resolveTarget( inCanvas, '.foo' ) ).path,
			'canvas > locator(.foo) > first'
		);
	} );

	it( 'falls back to the page locator when nothing matches or counting fails', async () => {
		const none = fakeContext( () => 0 );
		assert.equal(
			( await resolveTarget( none, '#missing' ) ).path,
			'page > locator(#missing) > first'
		);

		const broken = fakeContext( () => {
			throw new Error( 'frame detached' );
		} );
		assert.equal(
			( await resolveTarget( broken, '#missing' ) ).path,
			'page > locator(#missing) > first'
		);
	} );
} );
