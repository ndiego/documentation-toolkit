/**
 * Which Node.js versions the engine runs on, and how to find a supported one on a machine whose default is not.
 *
 * The floor comes from `fs.globSync` and the Playground CLI (22.19). The ceiling comes from WordPress Playground's
 * native add-on (`fs-ext-extra-prebuilt`), which ships prebuilt binaries per Node major and, as of 2.2.14, stops at
 * Node 25. On Node 26 Playground fails to load, so the engine refuses to start there with a message instead.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const NODE_MIN = [ 22, 19 ];
export const NODE_MAX_MAJOR = 25;

/**
 * Whether a Node version string is one the engine supports.
 * @param {string} version e.g. "24.21.0"
 * @return {boolean} supported
 */
export function isSupportedNode( version ) {
	const v = String( version ).replace( /^v/, '' );
	return (
		compareVersions( v, NODE_MIN.join( '.' ) ) >= 0 &&
		Number( v.split( '.' )[ 0 ] ) <= NODE_MAX_MAJOR
	);
}

/**
 * The one-line explanation when the running Node is not supported.
 * @param {string} [version]
 * @return {string|null} message, or null when supported
 */
export function unsupportedNodeMessage( version = process.versions.node ) {
	if ( isSupportedNode( version ) ) {
		return null;
	}
	return `Node ${ version } is not supported: WordPress Playground's native module ships binaries for Node ${ NODE_MIN.join( '.' ) } through ${ NODE_MAX_MAJOR } only. Install Node 24 (nvm install 24, or brew install node@24) and run the toolkit with it; \`npx -y @wp-docs-toolkit/mcp install\` registers a supported Node automatically when one is installed.`;
}

/**
 * Throw a user-facing error when the running Node cannot run Playground.
 */
export function ensureSupportedNode() {
	const message = unsupportedNodeMessage();
	if ( message ) {
		throw Object.assign( new Error( message ), { name: 'UserError' } );
	}
}

/**
 * Directories where version managers and package managers keep Node binaries, newest first within each.
 * @param {string} [home]
 * @return {string[]} candidate `node` binaries that exist
 */
export function candidateNodeBinaries( home = os.homedir() ) {
	const globs = [
		path.join( home, '.nvm/versions/node/v*/bin/node' ),
		path.join( home, '.volta/tools/image/node/*/bin/node' ),
		path.join(
			home,
			'.local/share/fnm/node-versions/v*/installation/bin/node'
		),
		path.join(
			home,
			'Library/Application Support/fnm/node-versions/v*/installation/bin/node'
		),
		path.join( home, '.asdf/installs/nodejs/*/bin/node' ),
		'/opt/homebrew/opt/node@*/bin/node',
		'/usr/local/opt/node@*/bin/node',
		'/opt/homebrew/bin/node',
		'/usr/local/bin/node',
		'/usr/bin/node',
	];
	// Keep the path as found (Homebrew's opt/ symlink survives upgrades; the Cellar path behind it does not),
	// deduplicating by what it resolves to.
	const seen = new Set();
	const found = [];
	for ( const pattern of globs ) {
		for ( const file of fs.globSync( pattern ) ) {
			if ( ! fs.existsSync( file ) ) {
				continue; // a dangling symlink (an uninstalled Homebrew keg)
			}
			const real = fs.realpathSync( file );
			if ( ! seen.has( real ) ) {
				seen.add( real );
				found.push( file );
			}
		}
	}
	return found;
}

/**
 * The version a Node binary reports, or null when it cannot be run.
 * @param {string} bin
 * @return {string|null} version without the v
 */
export function nodeVersionOf( bin ) {
	try {
		return execFileSync( bin, [ '-p', 'process.versions.node' ], {
			encoding: 'utf8',
			timeout: 5000,
		} ).trim();
	} catch {
		return null;
	}
}

/**
 * Pick the best Node to run the engine with: the current one if supported, otherwise the newest supported one
 * installed on the machine.
 * @param {Object}                       [options]
 * @param {string}                       [options.current]    version of the running Node (default: this process)
 * @param {string}                       [options.currentBin] its binary
 * @param {string[]}                     [options.candidates] binaries to consider (default: version managers' directories)
 * @param {(bin: string) => string|null} [options.versionOf]  version probe (for tests)
 * @return {{bin: string, version: string, switched: boolean}|null} the choice, or null when nothing supported exists
 */
export function findSupportedNode( options = {} ) {
	const current = options.current ?? process.versions.node;
	const currentBin = options.currentBin ?? process.execPath;
	if ( isSupportedNode( current ) ) {
		return { bin: currentBin, version: current, switched: false };
	}
	const candidates = options.candidates ?? candidateNodeBinaries();
	const versionOf = options.versionOf ?? nodeVersionOf;
	let best = null;
	for ( const bin of candidates ) {
		const version = versionOf( bin );
		if ( ! version || ! isSupportedNode( version ) ) {
			continue;
		}
		if ( ! best || compareVersions( version, best.version ) > 0 ) {
			best = { bin, version, switched: true };
		}
	}
	return best;
}

function compareVersions( a, b ) {
	const pa = a.split( '.' ).map( Number );
	const pb = b.split( '.' ).map( Number );
	for ( let i = 0; i < 3; i++ ) {
		if ( ( pa[ i ] || 0 ) !== ( pb[ i ] || 0 ) ) {
			return ( pa[ i ] || 0 ) - ( pb[ i ] || 0 );
		}
	}
	return 0;
}
