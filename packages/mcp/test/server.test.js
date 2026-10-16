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
	await server.close();
} );

describe( 'wp-docs-toolkit MCP server', () => {
	it( 'exposes the three tools', async () => {
		const { tools } = await client.listTools();
		assert.deepEqual( tools.map( ( t ) => t.name ).sort(), [
			'list_presets',
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
} );
