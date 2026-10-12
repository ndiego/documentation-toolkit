import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Re-run the CLI inside the pinned Playwright Docker image so renders are canonical (same fonts, same
 * Chromium build). The mounted directory is the common ancestor of every path the config uses, so the engine
 * makes no assumption about where docs live relative to the project. node_modules live in named volumes
 * because native modules differ between the host and Linux. The host's Playground download cache
 * (~/.wordpress-playground, where the CLI keeps WordPress zips) is shared with the container, so a render needs
 * no download once the version has been fetched once, and works on networks that filter the container's
 * traffic differently from the host's.
 *
 * @param {object} config
 * @param {string[]} args  CLI args without `--docker`
 */
export function runInDocker( config, args ) {
	const probe = spawnSync( 'docker', [ 'version', '--format', '{{.Server.Version}}' ], { encoding: 'utf8' } );
	if ( probe.status !== 0 ) {
		throw new Error( 'Docker is not available. Install Docker Desktop (or run in CI) for canonical renders, or drop --docker for a local preview render.' );
	}
	const paths = [ config.root, config.outDir, config.docsDir, config.docsManifest, config.blueprint, config.suitesDir, config.workDir ].filter( Boolean );
	const mountRoot = commonAncestor( paths );
	const toContainer = ( p ) => path.posix.join( '/work', path.relative( mountRoot, p ).split( path.sep ).join( '/' ) );
	const project = toContainer( config.root );
	const volume = `wp-shots-${ path.basename( mountRoot ).replace( /[^a-z0-9]/gi, '-' ) }`;
	// Map a host --config path into the container; drop it otherwise (the cwd lookup finds it).
	const mapped = [];
	for ( let i = 0; i < args.length; i++ ) {
		if ( args[ i ] === '--config' && args[ i + 1 ] ) {
			mapped.push( '--config', toContainer( path.resolve( args[ ++i ] ) ) );
		} else if ( args[ i ].startsWith( '--config=' ) ) {
			mapped.push( `--config=${ toContainer( path.resolve( args[ i ].slice( 9 ) ) ) }` );
		} else {
			mapped.push( args[ i ] );
		}
	}
	const script = [
		`cd ${ shellQuote( project ) }`,
		'npm ci --no-audit --no-fund',
		'npx playwright install chromium',
		`npx wp-shots ${ mapped.map( shellQuote ).join( ' ' ) }`,
	].join( ' && ' );
	const user = process.platform === 'linux' ? [ '--user', `${ os.userInfo().uid }:${ os.userInfo().gid }`, '-e', 'HOME=/tmp', '-e', 'npm_config_cache=/tmp/.npm' ] : [];
	const containerHome = process.platform === 'linux' ? '/tmp' : '/root';
	const playgroundCache = path.join( os.homedir(), '.wordpress-playground' );
	fs.mkdirSync( playgroundCache, { recursive: true } );
	const dockerArgs = [
		'run',
		'--rm',
		process.stdin.isTTY ? '-it' : '-i',
		'--init',
		...user,
		'-e', 'WP_SHOTS_CANONICAL=1',
		'-e', 'CI=1',
		'-v', `${ mountRoot }:/work`,
		'-v', `${ volume }:${ project }/node_modules`,
		'-v', `${ volume }-engine:${ project }/engine/node_modules`,
		'-v', `${ playgroundCache }:${ containerHome }/.wordpress-playground`,
		'-w', project,
		'--ipc=host',
		config.dockerImage,
		'bash',
		'-lc',
		script,
	];
	console.log( `docker ${ dockerArgs.slice( 0, -1 ).join( ' ' ) } "${ script }"` );
	const result = spawnSync( 'docker', dockerArgs, { stdio: 'inherit' } );
	return result.status ?? 1;
}

function commonAncestor( paths ) {
	const parts = paths.map( ( p ) => path.resolve( p ).split( path.sep ) );
	const first = parts[ 0 ];
	let i = 0;
	while ( i < first.length && parts.every( ( p ) => p[ i ] === first[ i ] ) ) {
		i++;
	}
	return first.slice( 0, i ).join( path.sep ) || path.sep;
}

function shellQuote( s ) {
	return /^[a-zA-Z0-9_\-=.,:/]+$/.test( s ) ? s : `'${ String( s ).replace( /'/g, `'\\''` ) }'`;
}
