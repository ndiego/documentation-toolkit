import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Re-run the CLI inside the pinned Playwright Docker image so renders are canonical (same fonts, same
 * Chromium build). The mounted directory is the common ancestor of every path the config uses, so the engine
 * makes no assumption about where docs live relative to the project. node_modules live in named volumes
 * because native modules differ between the host and Linux. The host's Playground download cache
 * (~/.wordpress-playground, where the CLI keeps WordPress zips) is shared with the container, so a render needs
 * no download once the version has been fetched once, and works on networks that filter the container's
 * traffic differently from the host's.
 *
 * @param {Object}   config
 * @param {string[]} args   CLI args without `--docker`
 */
export function runInDocker( config, args ) {
	const probe = spawnSync(
		'docker',
		[ 'version', '--format', '{{.Server.Version}}' ],
		{ encoding: 'utf8' }
	);
	if ( probe.status !== 0 ) {
		throw new Error(
			'Docker is not available. Install Docker Desktop (or run in CI) for canonical renders, or drop --docker for a local preview render.'
		);
	}
	const engineRoot = installRoot(
		path.dirname( fileURLToPath( import.meta.url ) )
	);
	const paths = [
		config.root,
		config.outDir,
		config.docsDir,
		config.docsManifest,
		config.blueprint,
		config.suitesDir,
		config.workDir,
	].filter( Boolean );
	// A path dependency on a sibling checkout lives outside the project; it must be mounted too.
	const engineLinked = ! engineRoot.startsWith(
		path.join( config.root, 'node_modules' ) + path.sep
	);
	if ( engineLinked ) {
		paths.push( engineRoot );
	}
	const mountRoot = commonAncestor( paths );
	const toContainer = ( p ) =>
		path.posix.join(
			'/work',
			path.relative( mountRoot, p ).split( path.sep ).join( '/' )
		);
	const project = toContainer( config.root );
	const volume = `wp-screenshots-${ path.basename( mountRoot ).replace( /[^a-z0-9]/gi, '-' ) }`;
	// Map a host --config path into the container; drop it otherwise (the cwd lookup finds it).
	const mapped = [];
	for ( let i = 0; i < args.length; i++ ) {
		if ( args[ i ] === '--config' && args[ i + 1 ] ) {
			mapped.push(
				'--config',
				toContainer( path.resolve( args[ ++i ] ) )
			);
		} else if ( args[ i ].startsWith( '--config=' ) ) {
			mapped.push(
				`--config=${ toContainer( path.resolve( args[ i ].slice( 9 ) ) ) }`
			);
		} else {
			mapped.push( args[ i ] );
		}
	}
	const script = [];
	const volumes = [ '-v', `${ volume }:${ project }/node_modules` ];
	if ( engineLinked ) {
		// Install the engine where it lives (its lockfile is there), in its own Linux node_modules volume.
		const engine = toContainer( engineRoot );
		script.push(
			`cd ${ shellQuote( engine ) }`,
			'npm ci --no-audit --no-fund'
		);
		volumes.push( '-v', `${ volume }-engine:${ engine }/node_modules` );
	}
	script.push(
		`cd ${ shellQuote( project ) }`,
		'npm ci --no-audit --no-fund',
		`npm exec --prefix ${ shellQuote( toContainer( engineRoot ) ) } -- playwright install chromium`,
		`npx wp-screenshots ${ mapped.map( shellQuote ).join( ' ' ) }`
	);
	const user =
		process.platform === 'linux'
			? [
					'--user',
					`${ os.userInfo().uid }:${ os.userInfo().gid }`,
					'-e',
					'HOME=/tmp',
					'-e',
					'npm_config_cache=/tmp/.npm',
				]
			: [];
	const containerHome = process.platform === 'linux' ? '/tmp' : '/root';
	const playgroundCache = path.join( os.homedir(), '.wordpress-playground' );
	fs.mkdirSync( playgroundCache, { recursive: true } );
	const command = script.join( ' && ' );
	const dockerArgs = [
		'run',
		'--rm',
		process.stdin.isTTY ? '-it' : '-i',
		'--init',
		...user,
		'-e',
		'WP_SCREENSHOTS_CANONICAL=1',
		'-e',
		'CI=1',
		'-v',
		`${ mountRoot }:/work`,
		...volumes,
		'-v',
		`${ playgroundCache }:${ containerHome }/.wordpress-playground`,
		'-w',
		project,
		'--ipc=host',
		config.dockerImage,
		'bash',
		'-lc',
		command,
	];
	console.log(
		`docker ${ dockerArgs.slice( 0, -1 ).join( ' ' ) } "${ command }"`
	);
	const result = spawnSync( 'docker', dockerArgs, { stdio: 'inherit' } );
	return result.status ?? 1;
}

/**
 * The directory whose `npm ci` installs the engine's dependencies: the nearest ancestor with a lockfile
 * (the monorepo root when the engine is a workspace package, the package itself when published).
 * @param {string} from
 */
function installRoot( from ) {
	let dir = from;
	for (;;) {
		if ( fs.existsSync( path.join( dir, 'package-lock.json' ) ) ) {
			return dir;
		}
		const parent = path.dirname( dir );
		if ( parent === dir ) {
			return path.resolve( from, '..' );
		}
		dir = parent;
	}
}

function commonAncestor( paths ) {
	const parts = paths.map( ( p ) => path.resolve( p ).split( path.sep ) );
	const first = parts[ 0 ];
	let i = 0;
	while (
		i < first.length &&
		parts.every( ( p ) => p[ i ] === first[ i ] )
	) {
		i++;
	}
	return first.slice( 0, i ).join( path.sep ) || path.sep;
}

function shellQuote( s ) {
	return /^[a-zA-Z0-9_\-=.,:/]+$/.test( s )
		? s
		: `'${ String( s ).replace( /'/g, `'\\''` ) }'`;
}
