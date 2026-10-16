#!/usr/bin/env node
/**
 * wp-docs-mcp: run the toolkit's MCP server.
 *
 *   wp-docs-mcp install               register the server in Claude Desktop and Claude Code (absolute paths)
 *                                     [--config <file>] [--no-claude-code] [--via npx|path] [--node <binary>]
 *   wp-docs-mcp uninstall             remove those entries
 *   wp-docs-mcp                       stdio (Claude Desktop, Claude Code, Cursor, …)
 *   wp-docs-mcp --http [--port 3920]  Streamable HTTP on http://127.0.0.1:<port>/mcp (ChatGPT and remote clients,
 *                                     put it behind a tunnel or a reverse proxy with auth)
 *   --project <shots.config.js>       render against a documentation project's own demo site
 *   --idle <minutes>                  close the warm WordPress session after this long unused (default 10; 0 = never)
 *   --token <secret>                  HTTP mode: require it as `Authorization: Bearer <secret>` or in the path
 *                                     /mcp/<secret> (for clients that cannot send headers). Env: WP_DOCS_MCP_TOKEN.
 *   Env PORT / HOST override --port / --host. GET /healthz answers 200 without a token.
 *
 * The first screenshot boots WordPress Playground and Chromium (10-20 s); later ones reuse them (a few seconds).
 */
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, createWarmSession } from './server.js';
import { unsupportedNodeMessage } from '@wp-docs-toolkit/screenshots';

const args = process.argv.slice( 2 );
const flag = ( name ) => {
	const i = args.indexOf( name );
	return i === -1 ? undefined : args[ i + 1 ];
};
if ( args.includes( '-h' ) || args.includes( '--help' ) ) {
	console.log(
		'Usage: wp-docs-mcp [install | uninstall] [--http] [--port <n>] [--host <addr>] [--token <secret>] [--idle <minutes>] [--project <shots.config.js>]'
	);
	process.exit( 0 );
}
if ( args[ 0 ] === 'install' ) {
	const { runInstall } = await import( './install.js' );
	process.exit(
		runInstall( {
			config: flag( '--config' ),
			claudeCode: ! args.includes( '--no-claude-code' ),
			via: flag( '--via' ) || 'auto',
			node: flag( '--node' ),
		} )
	);
}
if ( args[ 0 ] === 'uninstall' ) {
	const { runUninstall } = await import( './install.js' );
	process.exit( runUninstall( { config: flag( '--config' ) } ) );
}
// The server can start on any Node, but screenshots cannot: say so once, loudly, before a client connects.
const nodeProblem = unsupportedNodeMessage();
if ( nodeProblem ) {
	console.error( `wp-docs-mcp: ${ nodeProblem }` );
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
	const port = Number( flag( '--port' ) || process.env.PORT || 3920 );
	const host = flag( '--host' ) || process.env.HOST || '127.0.0.1';
	const token = flag( '--token' ) || process.env.WP_DOCS_MCP_TOKEN || '';
	if ( host !== '127.0.0.1' && host !== 'localhost' && ! token ) {
		console.error(
			'Refusing to listen on a non-local address without a token. Pass --token <secret> or set WP_DOCS_MCP_TOKEN.'
		);
		process.exit( 2 );
	}
	// One warm session shared by every request.
	const warm = createWarmSession( options );
	closers.add( warm.close );
	const httpServer = http.createServer( async ( req, res ) => {
		const url = new URL( req.url || '/', 'http://localhost' );
		if ( url.pathname === '/healthz' ) {
			res.writeHead( 200, { 'content-type': 'application/json' } );
			res.end( JSON.stringify( { ok: true, name: 'wp-docs-toolkit' } ) );
			return;
		}
		if ( ! url.pathname.startsWith( '/mcp' ) ) {
			res.writeHead( 404 ).end();
			return;
		}
		if ( token && ! authorized( req, url, token ) ) {
			res.writeHead( 401, { 'content-type': 'application/json' } );
			res.end(
				JSON.stringify( {
					error: 'unauthorized',
					hint: 'Send Authorization: Bearer <token> or use the /mcp/<token> path.',
				} )
			);
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
			`wp-docs-mcp listening on http://${ host }:${ port }/mcp (Streamable HTTP${ token ? ', token required' : ', no auth: keep it on localhost' })`
		);
	} );
	closers.add(
		() => new Promise( ( resolve ) => httpServer.close( resolve ) )
	);
} else {
	const server = createServer( options );
	closers.add( server.closeSession );
	const transport = new StdioServerTransport();
	transport.onclose = shutdown;
	await server.connect( transport );
}

/**
 * Constant-time check of the bearer header or the /mcp/<token> path segment.
 * @param {import('node:http').IncomingMessage} req
 * @param {URL}                                 url
 * @param {string}                              token
 * @return {boolean} whether the request may proceed
 */
function authorized( req, url, token ) {
	const header = String( req.headers.authorization || '' );
	const bearer = header.startsWith( 'Bearer ' ) ? header.slice( 7 ) : '';
	const inPath = url.pathname.startsWith( '/mcp/' )
		? decodeURIComponent( url.pathname.slice( 5 ).split( '/' )[ 0 ] )
		: '';
	return [ bearer, inPath ].some( ( candidate ) => {
		if ( ! candidate || candidate.length !== token.length ) {
			return false;
		}
		return timingSafeEqual(
			Buffer.from( candidate ),
			Buffer.from( token )
		);
	} );
}
