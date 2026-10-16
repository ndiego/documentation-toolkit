import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	resolveLocator,
	validateLocatorKey,
	describeKey,
	LOCATOR_KEYS,
} from '../src/locators.js';
import { fakeContext } from './fake-page.js';

const NAME_KEYS = [
	'button',
	'link',
	'tab',
	'option',
	'menuitem',
	'control',
	'placeholder',
	'text',
];

describe( 'LOCATOR_KEYS', () => {
	it( 'lists name keys, other keys and modifiers', () => {
		assert.deepEqual( LOCATOR_KEYS, [
			...NAME_KEYS,
			'role',
			'name',
			'selector',
			'block',
			'exact',
			'nth',
			'within',
			'in',
		] );
	} );
} );

describe( 'validateLocatorKey', () => {
	it( 'accepts a bare string (a button name)', () => {
		assert.equal( validateLocatorKey( 'Replace' ), null );
		assert.equal( validateLocatorKey( '' ), null );
	} );

	it( 'accepts exactly one main key plus modifiers', () => {
		for ( const k of [ ...NAME_KEYS, 'selector', 'block' ] ) {
			assert.equal( validateLocatorKey( { [ k ]: 'x' } ), null, k );
		}
		assert.equal(
			validateLocatorKey( { role: 'searchbox', name: 'Search' } ),
			null
		);
		assert.equal( validateLocatorKey( { role: 'dialog' } ), null );
		assert.equal(
			validateLocatorKey( {
				button: 'Add',
				exact: false,
				nth: 1,
				within: 'inspector',
				in: 'page',
			} ),
			null
		);
	} );

	it( 'rejects non-string, non-object values', () => {
		const expected =
			'a locator must be a string (button name) or a mapping like { button: Replace }';
		assert.equal( validateLocatorKey( null ), expected );
		assert.equal( validateLocatorKey( undefined ), expected );
		assert.equal( validateLocatorKey( 7 ), expected );
		assert.equal( validateLocatorKey( true ), expected );
	} );

	it( 'rejects unknown keys, naming the first one and listing the vocabulary', () => {
		assert.equal(
			validateLocatorKey( { buton: 'Replace', foo: 1 } ),
			'unknown locator key "buton". Use one of: button, link, tab, option, menuitem, control, placeholder, text, role (+name), selector, block; modifiers: exact, nth, within, in'
		);
	} );

	it( 'requires exactly one main key', () => {
		const prefix =
			'a locator needs exactly one of button, link, tab, option, menuitem, control, placeholder, text, role, selector, block';
		assert.equal(
			validateLocatorKey( { button: 'A', link: 'B' } ),
			`${ prefix } (got button, link)`
		);
		assert.equal( validateLocatorKey( {} ), `${ prefix } (got none)` );
		assert.equal(
			validateLocatorKey( { nth: 1 } ),
			`${ prefix } (got none)`
		);
		assert.equal(
			validateLocatorKey( { name: 'Search' } ),
			`${ prefix } (got none)`
		);
	} );
} );

describe( 'describeKey', () => {
	it( 'describes strings as buttons and mappings by their main key', () => {
		assert.equal( describeKey( 'Replace' ), 'button "Replace"' );
		assert.equal(
			describeKey( { control: 'Alternative text' } ),
			'control "Alternative text"'
		);
		assert.equal(
			describeKey( { selector: '.x', within: 'inspector', nth: 2 } ),
			'selector ".x" within inspector (nth 2)'
		);
		assert.equal(
			describeKey( { button: 'Add', nth: 0 } ),
			'button "Add" (nth 0)'
		);
	} );

	it( 'describes roles with an optional name', () => {
		assert.equal(
			describeKey( { role: 'searchbox', name: 'Search' } ),
			'searchbox "Search"'
		);
		assert.equal( describeKey( { role: 'dialog' } ), 'dialog' );
	} );

	it( 'degrades gracefully for an empty mapping', () => {
		assert.equal( describeKey( {} ), 'locator "?"' );
	} );
} );

describe( 'resolveLocator', () => {
	const found = () => fakeContext( () => 1 );

	it( 'rejects an invalid key before touching the page', async () => {
		await assert.rejects(
			resolveLocator( {}, { buton: 'x' } ),
			/^Error: unknown locator key "buton"/
		);
		await assert.rejects(
			resolveLocator( {}, 7 ),
			/a locator must be a string/
		);
	} );

	it( 'treats a bare string as an exact button name, searched in the page then the canvas', async () => {
		const ctx = fakeContext( ( p ) => ( p.startsWith( 'page' ) ? 1 : 0 ) );
		assert.equal(
			( await resolveLocator( ctx, 'Replace' ) ).path,
			'page > role(button,{"name":"Replace","exact":true}) > first'
		);

		const canvasOnly = fakeContext( ( p ) =>
			p.startsWith( 'canvas' ) ? 1 : 0
		);
		assert.equal(
			( await resolveLocator( canvasOnly, 'Replace' ) ).path,
			'canvas > role(button,{"name":"Replace","exact":true}) > first'
		);
	} );

	it( 'builds each role-based key with exact matching by default', async () => {
		const ctx = found();
		assert.equal(
			( await resolveLocator( ctx, { link: 'Docs' } ) ).path,
			'page > role(link,{"name":"Docs","exact":true}) > first'
		);
		assert.equal(
			( await resolveLocator( ctx, { tab: 'Styles' } ) ).path,
			'page > role(tab,{"name":"Styles","exact":true}) > first'
		);
		assert.equal(
			( await resolveLocator( ctx, { option: 'Large' } ) ).path,
			'page > role(option,{"name":"Large","exact":true}) > first'
		);
		assert.equal(
			( await resolveLocator( ctx, { control: 'Alt text' } ) ).path,
			'page > label(Alt text,{"exact":true}) > first'
		);
		assert.equal(
			( await resolveLocator( ctx, { placeholder: 'Search' } ) ).path,
			'page > placeholder(Search,{"exact":true}) > first'
		);
		assert.equal(
			( await resolveLocator( ctx, { text: 'Settings' } ) ).path,
			'page > text(Settings,{"exact":true}) > first'
		);
		assert.equal(
			( await resolveLocator( ctx, { selector: '.x > .y' } ) ).path,
			'page > locator(.x > .y) > first'
		);
	} );

	it( 'honours exact: false', async () => {
		assert.equal(
			( await resolveLocator( found(), { button: 'Add', exact: false } ) )
				.path,
			'page > role(button,{"name":"Add","exact":false}) > first'
		);
	} );

	it( 'passes role with and without a name', async () => {
		assert.equal(
			(
				await resolveLocator( found(), {
					role: 'searchbox',
					name: 'Search',
				} )
			).path,
			'page > role(searchbox,{"name":"Search","exact":true}) > first'
		);
		assert.equal(
			( await resolveLocator( found(), { role: 'dialog' } ) ).path,
			'page > role(dialog,{}) > first'
		);
	} );

	it( 'tries menuitem, menuitemcheckbox and menuitemradio in turn', async () => {
		const ctx = fakeContext( ( p ) =>
			p.includes( 'role(menuitemcheckbox' ) ? 1 : 0
		);
		assert.equal(
			( await resolveLocator( ctx, { menuitem: 'Fixed toolbar' } ) ).path,
			'page > role(menuitemcheckbox,{"name":"Fixed toolbar","exact":true}) > first'
		);
	} );

	it( 'applies nth instead of first', async () => {
		assert.equal(
			( await resolveLocator( found(), { button: 'Add', nth: 2 } ) ).path,
			'page > role(button,{"name":"Add","exact":true}) > nth(2)'
		);
	} );

	it( 'resolves blocks in the editor canvas without consulting the page', async () => {
		const ctx = fakeContext( () => {
			throw new Error( 'count should not be called' );
		} );
		assert.equal(
			( await resolveLocator( ctx, { block: 'core/image' } ) ).path,
			'canvas > locator([data-type="core/image"]) > first'
		);
		assert.equal(
			( await resolveLocator( ctx, { block: 'core/image', nth: 1 } ) )
				.path,
			'canvas > locator([data-type="core/image"]) > nth(1)'
		);
	} );

	it( 'restricts the search with in: page | canvas', async () => {
		const ctx = found();
		assert.equal(
			( await resolveLocator( ctx, { button: 'A', in: 'canvas' } ) ).path,
			'canvas > role(button,{"name":"A","exact":true}) > first'
		);
		assert.equal(
			( await resolveLocator( ctx, { button: 'A', in: 'page' } ) ).path,
			'page > role(button,{"name":"A","exact":true}) > first'
		);
	} );

	it( 'scopes the search to a within: target', async () => {
		const loc = await resolveLocator( found(), {
			button: 'Replace',
			within: 'block-toolbar',
		} );
		assert.equal(
			loc.path,
			'page > locator(.block-editor-block-contextual-toolbar, .block-editor-block-toolbar) > first > role(button,{"name":"Replace","exact":true}) > first'
		);
		const sel = await resolveLocator( found(), {
			button: 'Replace',
			within: '#wpbody',
		} );
		assert.equal(
			sel.path,
			'page > locator(#wpbody) > first > role(button,{"name":"Replace","exact":true}) > first'
		);
	} );

	it( 'rejects within: pointing at the whole viewport or an unknown target', async () => {
		await assert.rejects(
			resolveLocator( found(), { button: 'A', within: 'editor' } ),
			/within: "editor" is the whole viewport; name a region or selector instead/
		);
		await assert.rejects(
			resolveLocator( found(), { button: 'A', within: 'inspectr' } ),
			/unknown target "inspectr"/
		);
	} );

	it( 'gives up after the timeout with a message naming the key', async () => {
		const ctx = fakeContext( () => 0 );
		await assert.rejects(
			resolveLocator( ctx, { button: 'Nope' }, { timeout: 0 } ),
			( e ) => {
				assert.equal(
					e.message,
					'no button "Nope" found in the page or the editor canvas after 0s.'
				);
				return true;
			}
		);
		await assert.rejects(
			resolveLocator(
				ctx,
				{ selector: '.x', within: 'inspector' },
				{ timeout: 0 }
			),
			( e ) => {
				assert.equal(
					e.message,
					'no selector ".x" within inspector found after 0s.'
				);
				return true;
			}
		);
	} );

	it( 'lists the visible candidates of the same role in the failure message', async () => {
		// The exact-name lookups find nothing; the bare role lookup used by the hint finds two buttons.
		const ctx = fakeContext(
			( p ) => ( p === 'page > role(button)' ? 2 : 0 ),
			( p ) => ( p.endsWith( 'nth(0)' ) ? ' Publish ' : 'Save  draft' )
		);
		await assert.rejects(
			resolveLocator( ctx, 'Nope', { timeout: 0 } ),
			( e ) => {
				assert.equal(
					e.message,
					'no button "Nope" found in the page or the editor canvas after 0s. Visible buttons right now: "Publish", "Save draft".'
				);
				return true;
			}
		);
	} );
} );
