import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '@wp-docs-toolkit/screenshots';
import { createServer } from '../src/server.js';

// A stand-in for the warm WordPress session: it records whether a call got as far as needing WordPress, and
// answers with a canned inspection instead of booting anything.
let reached = 0;
const canned = {
	region: 'options-menu',
	regions: [ 'block-toolbar', 'options-menu', 'popover' ],
	elements: [
		{ role: 'menuitem', name: 'Add note', within: 'options-menu' },
		{ role: 'button', name: 'Options', within: 'block-toolbar' },
	],
	omitted: 0,
	snapshot: '- menu "Options":\n  - menuitem "Add note"',
	snapshotTruncated: false,
	preview: null,
};
const warm = {
	config: () => loadConfig( undefined, { fallback: true } ),
	run: async () => {
		reached++;
		return canned;
	},
	close: async () => {},
};

let client;
let server;

before( async () => {
	const [ clientTransport, serverTransport ] =
		InMemoryTransport.createLinkedPair();
	server = createServer( { warm } );
	await server.connect( serverTransport );
	client = new Client( { name: 'test', version: '0' } );
	await client.connect( clientTransport );
} );

after( async () => {
	await client.close();
	await server.close();
} );

describe( 'inspect tool', () => {
	it( 'is listed with the screenshot inputs minus the image-only ones, plus preview', async () => {
		const { tools } = await client.listTools();
		const tool = tools.find( ( t ) => t.name === 'inspect' );
		assert.ok( tool );
		const props = tool.inputSchema.properties;
		for ( const key of [
			'preset',
			'scene',
			'steps',
			'viewport',
			'target',
			'include',
			'block',
			'preview',
		] ) {
			assert.ok( props[ key ], `missing ${ key }` );
		}
		for ( const key of [ 'annotate', 'frame', 'out', 'pad', 'mask' ] ) {
			assert.equal( props[ key ], undefined, `unexpected ${ key }` );
		}
		assert.equal( props.preview.type, 'boolean' );
		assert.ok( props.preset.enum.includes( 'block-canvas' ) );
	} );

	it( 'rejects an unknown preset before reaching WordPress', async () => {
		reached = 0;
		const result = await client.callTool( {
			name: 'inspect',
			arguments: { preset: 'nope' },
		} );
		assert.equal( result.isError, true );
		assert.equal( reached, 0 );
	} );

	it( 'rejects an unknown step verb with the engine message, before reaching WordPress', async () => {
		reached = 0;
		const result = await client.callTool( {
			name: 'inspect',
			arguments: { scene: 'new-post', steps: [ 'openListVeiw' ] },
		} );
		assert.equal( result.isError, true );
		assert.match( result.content[ 0 ].text, /openListVeiw/ );
		assert.match( result.content[ 0 ].text, /openListView/ );
		assert.equal( reached, 0 );
	} );

	it( 'rejects an unknown target before reaching WordPress', async () => {
		reached = 0;
		const result = await client.callTool( {
			name: 'inspect',
			arguments: { preset: 'post-editor', target: 'top-bra' },
		} );
		assert.equal( result.isError, true );
		assert.match( result.content[ 0 ].text, /unknown target "top-bra"/ );
		assert.equal( reached, 0 );
	} );

	it( 'returns the elements as JSON, then the accessibility tree', async () => {
		reached = 0;
		const result = await client.callTool( {
			name: 'inspect',
			arguments: {
				preset: 'block-canvas',
				block: 'core/image',
				steps: [ 'openBlockMenu' ],
				target: 'options-menu',
			},
		} );
		assert.equal( reached, 1 );
		assert.equal( result.isError, undefined );
		const data = JSON.parse( result.content[ 0 ].text );
		assert.equal( data.region, 'options-menu' );
		assert.deepEqual( data.elements, canned.elements );
		assert.deepEqual( data.regions, canned.regions );
		assert.equal( data.omitted, undefined );
		assert.match( data.note, /menuitem/ );
		assert.match( result.content[ 1 ].text, /^Accessibility tree of/ );
		assert.match( result.content[ 1 ].text, /menuitem "Add note"/ );
		assert.equal(
			result.content.find( ( c ) => c.type === 'image' ),
			undefined
		);
	} );
} );
