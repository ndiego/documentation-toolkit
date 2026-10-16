#!/usr/bin/env node
/**
 * wp-docs-mcp: run the toolkit's MCP server.
 *
 *   wp-docs-mcp                       stdio (Claude Desktop, Claude Code, Cursor, …)
 *   wp-docs-mcp --http [--port 3920]  Streamable HTTP on http://127.0.0.1:<port>/mcp (ChatGPT and remote clients,
 *                                     put it behind a tunnel or a reverse proxy with auth)
 *   --project <shots.config.js>       render against a documentation project's own demo site
 *   --idle <minutes>                  close the warm WordPress session after this long unused (default 10; 0 = never)
 *
 * The first screenshot boots WordPress Playground and Chromium (10-20 s); later ones reuse them (a few seconds).
 */
import http from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, createWarmSession } from './server.js';

const args = process.argv.slice( 2 );
const flag = ( name ) => {
	const i = args.indexOf( name );
	return i === -1 ? undefined : args[ i + 1 ];
};
if ( args.includes( '-h' ) || args.includes( '--help' ) ) {
	console.log(
		'Usage: wp-docs-mcp [--http] [--port <n>] [--host <addr>] [--project <shots.config.js>]'
	);
	process.exit( 0 );
}
const options = {
	project: flag( '--project' ),
	idleMs:
		flag( '--idle' ) !== undefined
			? Number( flag( '--idle' ) ) * 60 * 1000
			: undefined,
};
const closers = new Set();
const shutdown = async () => {
	await Promise.all( [ ...closers ].map( ( fn ) => fn().catch( () => {} ) ) );
	process.exit( 0 );
};
process.once( 'SIGINT', shutdown );
process.once( 'SIGTERM', shutdown );

if ( args.includes( '--http' ) ) {
	const port = Number( flag( '--port' ) || 3920 );
	const host = flag( '--host' ) || '127.0.0.1';
	// One warm session shared by every request.
	const warm = createWarmSession( options );
	closers.add( warm.close );
	const httpServer = http.createServer( async ( req, res ) => {
		if ( ! req.url?.startsWith( '/mcp' ) ) {
			res.writeHead( 404 ).end();
			return;
		}
		// Stateless: a fresh server and transport per request, so concurrent clients never share state.
		const transport = new StreamableHTTPServerTransport( {
			sessionIdGenerator: undefined,
		} );
		const server = createServer( { ...options, warm } );
		res.on( 'close', () => {
			transport.close();
			server.close();
		} );
		await server.connect( transport );
		await transport.handleRequest( req, res );
	} );
	httpServer.listen( port, host, () => {
		console.error(
			`wp-docs-mcp listening on http://${ host }:${ port }/mcp (Streamable HTTP)`
		);
	} );
} else {
	const server = createServer( options );
	closers.add( server.closeSession );
	const transport = new StdioServerTransport();
	transport.onclose = shutdown;
	await server.connect( transport );
}
