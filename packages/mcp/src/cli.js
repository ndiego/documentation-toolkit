#!/usr/bin/env node
/**
 * wp-docs-mcp: run the toolkit's MCP server.
 *
 *   wp-docs-mcp                       stdio (Claude Desktop, Claude Code, Cursor, …)
 *   wp-docs-mcp --http [--port 3920]  Streamable HTTP on http://127.0.0.1:<port>/mcp (ChatGPT and remote clients,
 *                                     put it behind a tunnel or a reverse proxy with auth)
 *   --project <shots.config.js>       render against a documentation project's own demo site
 */
import http from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';

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
const options = { project: flag( '--project' ) };

if ( args.includes( '--http' ) ) {
	const port = Number( flag( '--port' ) || 3920 );
	const host = flag( '--host' ) || '127.0.0.1';
	const httpServer = http.createServer( async ( req, res ) => {
		if ( ! req.url?.startsWith( '/mcp' ) ) {
			res.writeHead( 404 ).end();
			return;
		}
		// Stateless: a fresh server and transport per request, so concurrent clients never share state.
		const transport = new StreamableHTTPServerTransport( {
			sessionIdGenerator: undefined,
		} );
		const server = createServer( options );
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
	await server.connect( new StdioServerTransport() );
}
