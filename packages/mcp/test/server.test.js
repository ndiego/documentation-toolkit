import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, describePresets } from '../src/server.js';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const fixture = path.resolve( here, '../../manifest/test/fixtures/valid' );

let client;
let server;

before( async () => {
	const [ clientTransport, serverTransport ] =
		InMemoryTransport.createLinkedPair();
	server = createServer();
	await server.connect( serverTransport );
	client = new Client( { name: 'test', version: '0' } );
	await client.connect( clientTransport );
} );

after( async () => {
	await client.close();
	await server.closeSession();
	await server.close();
} );

describe( 'wp-docs-toolkit MCP server', () => {
	it( 'exposes the four tools', async () => {
		const { tools } = await client.listTools();
		assert.deepEqual( tools.map( ( t ) => t.name ).sort(), [
			'list_presets',
			'restart_environment',
			'screenshot',
			'validate_manifest',
		] );
		const shot = tools.find( ( t ) => t.name === 'screenshot' );
		assert.deepEqual( shot.inputSchema.required, [ 'preset' ] );
		assert.ok(
			shot.inputSchema.properties.preset.enum.includes( 'site-editor' )
		);
	} );

	it( 'list_presets returns every preset with its parameters', async () => {
		const result = await client.callTool( {
			name: 'list_presets',
			arguments: {},
		} );
		const data = JSON.parse( result.content[ 0 ].text );
		assert.deepEqual( data, describePresets() );
		const settings = data.find( ( p ) => p.name === 'block-settings' );
		assert.equal( settings.params.block.required, true );
		assert.deepEqual( settings.params.tab.options, [
			'content',
			'settings',
			'styles',
		] );
	} );

	it( 'validate_manifest runs the validator against a fixture', async () => {
		const result = await client.callTool( {
			name: 'validate_manifest',
			arguments: {
				manifest: path.join( fixture, 'manifest.json' ),
				docs: fixture,
				strict: true,
			},
		} );
		assert.equal( result.isError, false );
		assert.match(
			result.content[ 0 ].text,
			/2 entries, 0 errors, 0 warnings/
		);
		assert.equal( result.structuredContent.ok, true );
	} );

	it( 'validate_manifest reports errors as a tool error', async () => {
		const result = await client.callTool( {
			name: 'validate_manifest',
			arguments: {
				manifest: path.join( fixture, 'manifest.json' ),
				docs: path.join( fixture, 'nowhere' ),
			},
		} );
		assert.equal( result.isError, true );
		assert.match( result.content[ 0 ].text, /error: .*not found/ );
	} );

	it( 'screenshot rejects an unknown preset before booting anything', async () => {
		const result = await client.callTool( {
			name: 'screenshot',
			arguments: { preset: 'nope' },
		} );
		assert.equal( result.isError, true );
	} );

	it( 'restart_environment is harmless when nothing is running', async () => {
		const result = await client.callTool( {
			name: 'restart_environment',
			arguments: {},
		} );
		assert.match( result.content[ 0 ].text, /fresh WordPress/ );
	} );
} );

describe( 'annotations', () => {
	it( 'translate client annotations into spec form with fuzzy names by default', async () => {
		const { toSpecAnnotation } = await import( '../src/server.js' );
		assert.deepEqual(
			toSpecAnnotation( {
				type: 'arrow',
				button: 'Save Draft',
				from: 'bottom',
			} ),
			{ arrow: { button: 'Save Draft', from: 'bottom', exact: false } }
		);
		assert.deepEqual(
			toSpecAnnotation( {
				type: 'outline',
				control: 'Resolution',
				exact: true,
			} ),
			{ outline: { control: 'Resolution', exact: true } }
		);
		assert.deepEqual(
			toSpecAnnotation( { type: 'dim', target: 'inspector' } ),
			{
				dim: { target: 'inspector' },
			}
		);
		assert.deepEqual( toSpecAnnotation( { type: 'outline' } ), {
			outline: 'self',
		} );
	} );

	it( 'exposes annotate, include and pad on the screenshot tool', async () => {
		const { tools } = await client.listTools();
		const shot = tools.find( ( t ) => t.name === 'screenshot' );
		assert.ok( shot.inputSchema.properties.annotate );
		assert.ok( shot.inputSchema.properties.target );
		assert.ok( shot.inputSchema.properties.include );
		assert.ok( shot.inputSchema.properties.pad );
	} );

	it( 'scopes annotations to the preset region unless told otherwise', async () => {
		const { toSpecAnnotation } = await import( '../src/server.js' );
		assert.deepEqual(
			toSpecAnnotation(
				{ type: 'badge', button: 'Options' },
				'block-toolbar'
			),
			{
				badge: {
					button: 'Options',
					within: 'block-toolbar',
					exact: false,
				},
			}
		);
		assert.deepEqual(
			toSpecAnnotation(
				{ type: 'badge', button: 'Options', within: 'top-bar' },
				'block-toolbar'
			),
			{ badge: { button: 'Options', within: 'top-bar', exact: false } }
		);
		assert.deepEqual(
			toSpecAnnotation(
				{ type: 'dim', target: 'inspector' },
				'block-toolbar'
			),
			{ dim: { target: 'inspector' } }
		);
	} );
} );
