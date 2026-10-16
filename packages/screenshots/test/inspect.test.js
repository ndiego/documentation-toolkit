import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	parseAriaLine,
	finishElements,
	truncateSnapshot,
	inspectShot,
	INSPECT_ROLES,
	WITHIN_REGIONS,
} from '../src/inspect.js';
import { targetNames } from '../src/targets.js';

describe( 'parseAriaLine', () => {
	it( 'reads the role and name of a node line', () => {
		assert.deepEqual( parseAriaLine( '- button "Options" [expanded]' ), {
			role: 'button',
			name: 'Options',
		} );
		assert.deepEqual( parseAriaLine( '- menuitem "Copy ⌘C"' ), {
			role: 'menuitem',
			name: 'Copy ⌘C',
		} );
		assert.deepEqual( parseAriaLine( '  - textbox "Add title": Hello' ), {
			role: 'textbox',
			name: 'Add title',
		} );
	} );

	it( 'unescapes quotes and unwraps single-quoted YAML keys', () => {
		assert.deepEqual( parseAriaLine( '- link "Say \\"hi\\""' ), {
			role: 'link',
			name: 'Say "hi"',
		} );
		assert.deepEqual( parseAriaLine( `- 'button "Note: it''s here"'` ), {
			role: 'button',
			name: "Note: it's here",
		} );
	} );

	it( 'gives a null name for an unnamed node and null for anything else', () => {
		assert.deepEqual( parseAriaLine( '- button' ), {
			role: 'button',
			name: null,
		} );
		assert.equal( parseAriaLine( 'text: hello' ), null );
		assert.equal( parseAriaLine( '' ), null );
		assert.equal( parseAriaLine( undefined ), null );
	} );
} );

describe( 'finishElements', () => {
	it( 'orders top to bottom then left to right, normalises names and drops duplicates', () => {
		const { elements, omitted } = finishElements( [
			{
				role: 'button',
				name: 'Options',
				within: 'top-bar',
				x: 900,
				y: 10,
			},
			{
				role: 'button',
				name: ' Save\n draft ',
				within: 'top-bar',
				x: 700,
				y: 10.4,
			},
			{
				role: 'menuitem',
				name: 'Copy',
				within: 'options-menu',
				x: 50,
				y: 200,
			},
			{
				role: 'button',
				name: 'Options',
				within: 'top-bar',
				x: 900,
				y: 10,
			},
			{
				role: 'button',
				name: 'Options',
				within: 'block-toolbar',
				x: 300,
				y: 120,
			},
		] );
		assert.equal( omitted, 0 );
		assert.deepEqual( elements, [
			{ role: 'button', name: 'Save draft', within: 'top-bar' },
			{ role: 'button', name: 'Options', within: 'top-bar' },
			{ role: 'button', name: 'Options', within: 'block-toolbar' },
			{ role: 'menuitem', name: 'Copy', within: 'options-menu' },
		] );
	} );

	it( 'caps the list and says how many were left out', () => {
		const raw = Array.from( { length: 7 }, ( _, i ) => ( {
			role: 'link',
			name: `Item ${ i }`,
			within: null,
			x: 0,
			y: i,
		} ) );
		const { elements, omitted } = finishElements( raw, 5 );
		assert.equal( elements.length, 5 );
		assert.equal( omitted, 2 );
		assert.equal( elements[ 0 ].name, 'Item 0' );
		assert.equal( elements[ 0 ].within, null );
	} );
} );

describe( 'truncateSnapshot', () => {
	it( 'leaves short text alone', () => {
		assert.deepEqual( truncateSnapshot( '- button "A"', 100 ), {
			text: '- button "A"',
			truncated: false,
		} );
	} );

	it( 'cuts long text on a line boundary', () => {
		const text = [ '- a', '- bb', '- ccc', '- dddd' ].join( '\n' );
		assert.deepEqual( truncateSnapshot( text, 10 ), {
			text: '- a\n- bb',
			truncated: true,
		} );
	} );
} );

describe( 'inspectShot', () => {
	it( 'needs a session and drops the prepared shot without one', async () => {
		let discarded = false;
		await assert.rejects(
			inspectShot(
				{},
				{ spec: { shots: [] }, discard: () => ( discarded = true ) },
				{}
			),
			/needs an open session/
		);
		assert.equal( discarded, true );
	} );

	it( 'only names regions the target registry knows', () => {
		for ( const name of WITHIN_REGIONS ) {
			assert.ok( targetNames.includes( name ), name );
		}
		assert.ok( INSPECT_ROLES.includes( 'menuitem' ) );
	} );
} );
