import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const cli = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../src/cli.js'
);
const TOKEN = 'test-secret-token';
let port;
let child;

function freePort() {
	return new Promise( ( resolve ) => {
		const srv = net.createServer();
		srv.listen( 0, '127.0.0.1', () => {
			const { port: p } = srv.address();
			srv.close( () => resolve( p ) );
		} );
	} );
}

before( async () => {
	port = await freePort();
	child = spawn(
		process.execPath,
		[ cli, '--http', '--port', String( port ), '--token', TOKEN ],
		{ stdio: [ 'ignore', 'ignore', 'pipe' ] }
	);
	await new Promise( ( resolve, reject ) => {
		child.stderr.on( 'data', ( d ) => {
			if ( String( d ).includes( 'listening' ) ) {
				resolve();
			}
		} );
		child.on( 'exit', ( code ) =>
			reject( new Error( `server exited early (${ code })` ) )
		);
	} );
} );

after( () => {
	child.kill( 'SIGTERM' );
} );

describe( 'HTTP mode', () => {
	it( 'answers /healthz without a token', async () => {
		const res = await fetch( `http://127.0.0.1:${ port }/healthz` );
		assert.equal( res.status, 200 );
		assert.deepEqual( await res.json(), {
			ok: true,
			name: 'wp-docs-toolkit',
		} );
	} );

	it( 'rejects /mcp without the token', async () => {
		const res = await fetch( `http://127.0.0.1:${ port }/mcp`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		} );
		assert.equal( res.status, 401 );
		assert.equal( ( await res.json() ).error, 'unauthorized' );
	} );

	it( 'accepts a bearer token and serves the tools', async () => {
		const client = new Client( { name: 'bearer', version: '0' } );
		await client.connect(
			new StreamableHTTPClientTransport(
				new URL( `http://127.0.0.1:${ port }/mcp` ),
				{
					requestInit: {
						headers: { authorization: `Bearer ${ TOKEN }` },
					},
				}
			)
		);
		const { tools } = await client.listTools();
		assert.ok( tools.some( ( t ) => t.name === 'screenshot' ) );
		await client.close();
	} );

	it( 'accepts the token in the path for clients that cannot send headers', async () => {
		const client = new Client( { name: 'path', version: '0' } );
		await client.connect(
			new StreamableHTTPClientTransport(
				new URL( `http://127.0.0.1:${ port }/mcp/${ TOKEN }` )
			)
		);
		const result = await client.callTool( {
			name: 'list_presets',
			arguments: {},
		} );
		assert.ok( JSON.parse( result.content[ 0 ].text ).length > 0 );
		await client.close();
	} );

	it( 'rejects a wrong path token', async () => {
		const res = await fetch( `http://127.0.0.1:${ port }/mcp/wrong`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		} );
		assert.equal( res.status, 401 );
	} );
} );
