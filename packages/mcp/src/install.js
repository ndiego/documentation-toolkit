/**
 * `wp-docs-mcp install`: register this server with Claude Desktop and Claude Code so a person never edits a
 * config by hand. Writes absolute paths, because the desktop app does not see the user's shell PATH (nvm,
 * Homebrew and Volta installs all break a bare "npx").
 *
 * The registered launch uses a Node the engine supports (its runtime policy says which): the current one when it
 * qualifies, otherwise the newest supported one found in nvm, Volta, fnm, asdf or Homebrew.
 *
 * How the server is launched afterwards depends on where this copy lives:
 *   - run through `npx -y @wp-docs-toolkit/mcp` (npm's temporary cache): register `node <npx-cli.js> -y
 *     @wp-docs-toolkit/mcp@<version>`, so updates follow npm and the cache may be evicted safely;
 *   - a git checkout or a global install: register `node <this file's cli.js>` directly.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
	findSupportedNode,
	nodeVersionOf,
	unsupportedNodeMessage,
} from '@wp-docs-toolkit/screenshots';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const pkg = createRequire( import.meta.url )( '../package.json' );

/**
 * The default Claude Desktop config path for this platform.
 * @return {string} path
 */
export function desktopConfigPath() {
	if ( process.platform === 'darwin' ) {
		return path.join(
			os.homedir(),
			'Library/Application Support/Claude/claude_desktop_config.json'
		);
	}
	if ( process.platform === 'win32' ) {
		return path.join(
			process.env.APPDATA || path.join( os.homedir(), 'AppData/Roaming' ),
			'Claude/claude_desktop_config.json'
		);
	}
	return path.join(
		process.env.XDG_CONFIG_HOME || path.join( os.homedir(), '.config' ),
		'Claude/claude_desktop_config.json'
	);
}

/**
 * How to launch the server from any environment: absolute node binary plus arguments.
 * @param {'auto'|'npx'|'path'} via
 * @param {string|null}         [nodeBin] Node binary to register (default: the running one)
 * @return {{command: string, args: string[], how: string}} the launch spec
 */
export function launchSpec( via = 'auto', nodeBin = null ) {
	const cli = path.join( here, 'cli.js' );
	const inNpxCache = /[\\/]_npx[\\/]/.test( cli );
	const useNpx = via === 'npx' || ( via === 'auto' && inNpxCache );
	const node = nodeBin || process.execPath;
	if ( useNpx ) {
		const npxCli = npxCliFor( node );
		return {
			command: node,
			args: [ npxCli, '-y', `${ pkg.name }@${ pkg.version }` ],
			how: `npx ${ pkg.name }@${ pkg.version } (Node at ${ node })`,
		};
	}
	return {
		command: node,
		args: [ cli ],
		how: `${ cli } (Node at ${ node })`,
	};
}

/**
 * The npx entry script that belongs to a Node binary (nvm, Homebrew kegs, Volta and fnm all keep npm at
 * ../lib/node_modules/npm next to bin/node); falls back to the running npm's.
 * @param {string} nodeBin
 * @return {string} path to npx-cli.js
 */
export function npxCliFor( nodeBin ) {
	const beside = path.resolve(
		path.dirname( nodeBin ),
		'../lib/node_modules/npm/bin/npx-cli.js'
	);
	if ( fs.existsSync( beside ) ) {
		return beside;
	}
	const globalRoot = execFileSync( 'npm', [ 'root', '-g' ], {
		encoding: 'utf8',
	} ).trim();
	const current = path.join( globalRoot, 'npm/bin/npx-cli.js' );
	if ( ! fs.existsSync( current ) ) {
		throw new Error( `npx entry script not found at ${ current }` );
	}
	return current;
}

/**
 * Decide which Node the registered server runs on: an explicit one, the current one if supported, or the newest
 * supported one found on the machine.
 * @param {string} [explicit] --node value
 * @return {{bin: string, version: string, switched: boolean, note: string|null}} the choice
 */
export function chooseNode( explicit ) {
	if ( explicit ) {
		const bin = resolveBinary( explicit );
		const version = bin && nodeVersionOf( bin );
		if ( ! version ) {
			throw new Error(
				`--node ${ explicit } is not a runnable Node binary (give an absolute path)`
			);
		}
		const problem = unsupportedNodeMessage( version );
		return {
			bin,
			version,
			switched: true,
			note: problem
				? `--node ${ bin }: ${ problem } Screenshots will fail on it.`
				: null,
		};
	}
	const found = findSupportedNode();
	if ( found ) {
		return { ...found, note: null };
	}
	return {
		bin: process.execPath,
		version: process.versions.node,
		switched: false,
		note: `${ unsupportedNodeMessage() } None was found in nvm, Volta, fnm, asdf or Homebrew; after installing one, run this install again and it will register that Node.`,
	};
}

/**
 * Merge our entry into a Claude Desktop config file, keeping everything else, backing the file up first.
 * @param {string}                            file
 * @param {{command: string, args: string[]}} spec
 * @return {string} the backup path, or '' when the file did not exist
 */
export function registerDesktop( file, spec ) {
	let data = {};
	let backup = '';
	if ( fs.existsSync( file ) ) {
		data = JSON.parse( fs.readFileSync( file, 'utf8' ) || '{}' );
		backup = `${ file }.bak-${ new Date()
			.toISOString()
			.replace( /[-:T]/g, '' )
			.slice( 0, 14 ) }`;
		fs.copyFileSync( file, backup );
	}
	fs.mkdirSync( path.dirname( file ), { recursive: true } );
	data.mcpServers = data.mcpServers || {};
	data.mcpServers[ 'wp-docs-toolkit' ] = {
		command: spec.command,
		args: spec.args,
	};
	fs.writeFileSync( file, JSON.stringify( data, null, 2 ) + '\n' );
	return backup;
}

/**
 * Register with the Claude Code CLI in user scope, when it is installed.
 * @param {{command: string, args: string[]}} spec
 * @return {boolean} whether it was registered
 */
export function registerClaudeCode( spec ) {
	const probe = spawnSync( 'claude', [ '--version' ], { encoding: 'utf8' } );
	if ( probe.status !== 0 ) {
		return false;
	}
	spawnSync(
		'claude',
		[ 'mcp', 'remove', 'wp-docs-toolkit', '--scope', 'user' ],
		{
			stdio: 'ignore',
		}
	);
	const add = spawnSync(
		'claude',
		[
			'mcp',
			'add',
			'--scope',
			'user',
			'wp-docs-toolkit',
			'--',
			spec.command,
			...spec.args,
		],
		{ stdio: 'ignore' }
	);
	return add.status === 0;
}

/**
 * Run the install flow and print what happened and what to do next.
 * @param {Object}                options
 * @param {string}                [options.config]     Claude Desktop config path override
 * @param {boolean}               [options.claudeCode] register with Claude Code too (default true)
 * @param {string}                [options.via]        auto | npx | path
 * @param {(msg: string) => void} [options.log]
 * @return {number} exit code
 */
export function runInstall( options = {} ) {
	const log = options.log || console.log;
	const node = chooseNode( options.node );
	if ( node.switched ) {
		log( `Using Node ${ node.version } at ${ node.bin } for the server.` );
	}
	if ( node.note ) {
		log( `Warning: ${ node.note }` );
	}
	const spec = launchSpec( options.via || 'auto', node.bin );
	const file = options.config || desktopConfigPath();
	const backup = registerDesktop( file, spec );
	log(
		`Registered in Claude Desktop: ${ file }${ backup ? ` (backup: ${ path.basename( backup ) })` : '' }`
	);
	let codeLine = `Not found on this machine. Later: claude mcp add --scope user wp-docs-toolkit -- ${ spec.command } ${ spec.args.join( ' ' ) }`;
	if ( options.claudeCode !== false && registerClaudeCode( spec ) ) {
		log( 'Registered in Claude Code (user scope)' );
		codeLine = 'Already registered. Ask the same thing in any project.';
	}
	log( `
Server launch: ${ spec.how }

Next:
  Claude Desktop  Quit and reopen it. In a new chat the tools menu lists "wp-docs-toolkit". Try:
                  "Take a screenshot of the General Settings page in wp-admin."
                  The first screenshot downloads Chromium if needed and boots WordPress (a minute the very
                  first time, ~15 s after that); later screenshots take a few seconds.
  Claude Code     ${ codeLine }
  ChatGPT         Connects only to remote HTTPS servers. Run the server with a token and expose it:
                    npx -y ${ pkg.name } --http --token "$(openssl rand -hex 16)"
                    cloudflared tunnel --url http://127.0.0.1:3920
                  then in ChatGPT: Settings → Apps & Connectors → Advanced → Developer mode, add a connector with
                  https://<tunnel host>/mcp/<token> and "No authentication". Stop both when done.
  Uninstall       npx -y ${ pkg.name } uninstall
` );
	return 0;
}

/**
 * Remove our entries from Claude Desktop and Claude Code.
 * @param {Object}                options
 * @param {string}                [options.config]
 * @param {(msg: string) => void} [options.log]
 * @return {number} exit code
 */
export function runUninstall( options = {} ) {
	const log = options.log || console.log;
	const file = options.config || desktopConfigPath();
	if ( fs.existsSync( file ) ) {
		const data = JSON.parse( fs.readFileSync( file, 'utf8' ) || '{}' );
		if ( data.mcpServers?.[ 'wp-docs-toolkit' ] ) {
			delete data.mcpServers[ 'wp-docs-toolkit' ];
			fs.writeFileSync( file, JSON.stringify( data, null, 2 ) + '\n' );
			log( `Removed from Claude Desktop: ${ file }` );
		}
	}
	const probe = spawnSync( 'claude', [ '--version' ], { encoding: 'utf8' } );
	if ( probe.status === 0 ) {
		spawnSync(
			'claude',
			[ 'mcp', 'remove', 'wp-docs-toolkit', '--scope', 'user' ],
			{
				stdio: 'ignore',
			}
		);
		log( 'Removed from Claude Code (user scope)' );
	}
	return 0;
}

/**
 * An absolute path for a binary given as a path or a bare name (looked up on PATH), or null.
 * @param {string} given
 * @return {string|null} absolute path to an existing file
 */
export function resolveBinary( given ) {
	if ( given.includes( '/' ) || given.includes( '\\' ) ) {
		const abs = path.resolve( given );
		return fs.existsSync( abs ) ? abs : null;
	}
	for ( const dir of ( process.env.PATH || '' ).split( path.delimiter ) ) {
		const candidate = path.join( dir, given );
		if ( dir && fs.existsSync( candidate ) ) {
			return candidate;
		}
	}
	return null;
}
