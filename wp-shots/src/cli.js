#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { loadConfig } from './config.js';
import { runShots } from './runner.js';
import { lint, snippet } from './lint.js';
import { writeReport, acceptStaged } from './report.js';
import { runInDocker } from './docker.js';
import { loadSpecs, filterSpecs } from './spec.js';
import { verbNames } from './actions.js';
import { targetNames } from './targets.js';
import { sceneNames } from './scenes.js';

const HELP = `wp-shots: reproducible WordPress UI screenshots from YAML specs

Usage: wp-shots <command> [options]

Commands
  run       Render shots and write changed images + manifest into the output dir
  check     Render to a staging dir, compare with committed images, write an HTML report (exit 1 on changes)
  update    Accept the images staged by the last check
  lint      Validate specs and cross-check generated images against the Markdown
  snippet   Print Markdown image lines for an article (--article x [--from docs/path/file.md])
  dev       Open a headed browser, run a shot's scene and steps, then pause in the Playwright Inspector
  doctor    Check the local setup
  list      List specs and shots
  vocab     List the scenes, step verbs and capture targets specs can use

Filters (run, check, list)
  --article <slug>[,slug]    --section <shots/sub/path>    --suite <name>    --shot <id>[,id]

Options
  --config <file>   Path to shots.config.js (default: nearest one from the cwd)
  --docker          Run the command inside the pinned Playwright image (canonical render)
  --headed          Show the browser
  --fix             lint: rewrite alt text in Markdown to match the specs
  --port <n>        Override the Playground port
  --wp <version>    Override the WordPress version passed to Playground (the blueprint still wins)
  -h, --help
`;

/** Errors a writer can act on print without a stack trace. */
export class UserError extends Error {
	constructor( message ) {
		super( message );
		this.name = 'UserError';
	}
}

main().then(
	( code ) => process.exit( code ?? 0 ),
	( err ) => {
		const userFacing = err?.name === 'SpecError' || err?.name === 'UserError';
		console.error( `\n${ userFacing ? err.message : err?.stack || err }` );
		process.exit( 1 );
	}
);

async function main() {
	const argv = process.argv.slice( 2 );
	const { command, flags, rest } = parseArgs( argv );
	if ( ! command || flags.help || flags.h ) {
		console.log( HELP );
		return 0;
	}
	for ( const k of [ 'config', 'port', 'wp', 'article', 'section', 'suite', 'shot', 'from' ] ) {
		if ( flags[ k ] === true ) {
			throw new UserError( `--${ k } needs a value` );
		}
	}
	const config = await loadConfig( flags.config );
	if ( flags.port ) {
		config.port = Number( flags.port );
		if ( ! Number.isInteger( config.port ) || config.port < 1 || config.port > 65535 ) {
			throw new UserError( `--port must be a port number, got "${ flags.port }"` );
		}
	}
	if ( flags.wp ) {
		config.wordpress.version = String( flags.wp );
	}
	if ( flags.docker ) {
		const args = argv.filter( ( a ) => a !== '--docker' );
		return runInDocker( config, args );
	}
	const filter = {
		article: list( flags.article ),
		section: list( flags.section ),
		suite: list( flags.suite ),
		shot: list( flags.shot ),
	};

	switch ( command ) {
		case 'run': {
			const { summary } = await runShots( config, { filter, mode: 'run', headed: Boolean( flags.headed ) } );
			return summary.failed ? 1 : 0;
		}
		case 'check': {
			const run = await runShots( config, { filter, mode: 'check', headed: Boolean( flags.headed ) } );
			const index = writeReport( config, run );
			console.log( `Report: ${ path.relative( process.cwd(), index ) }` );
			const changed = ( run.summary.counts.changed || 0 ) + ( run.summary.counts.new || 0 );
			return run.summary.failed || changed ? 1 : 0;
		}
		case 'update':
			acceptStaged( config );
			return 0;
		case 'lint':
			return lint( config, { fix: Boolean( flags.fix ) } ).ok ? 0 : 1;
		case 'snippet': {
			const article = list( flags.article )?.[ 0 ] || rest[ 0 ];
			if ( ! article ) {
				throw new Error( 'snippet needs --article <slug>' );
			}
			process.stdout.write( snippet( config, article, flags.from ) );
			return 0;
		}
		case 'dev': {
			const article = list( flags.article )?.[ 0 ];
			const shot = list( flags.shot )?.[ 0 ];
			if ( ! article || ! shot ) {
				throw new Error( 'dev needs --article <slug> --shot <id>' );
			}
			process.env.PWDEBUG = process.env.PWDEBUG || 'console';
			await runShots( config, {
				filter: { article: [ article ], shot: [ shot ] },
				mode: 'check',
				headed: true,
				pauseAt: { article, shot },
			} );
			return 0;
		}
		case 'list': {
			const specs = filterSpecs( loadSpecs( config ), filter );
			if ( ! specs.length ) {
				throw new UserError( 'No shot specs matched the filter. `wp-shots list` without filters shows what exists; --section takes a path under shots/.' );
			}
			for ( const s of specs ) {
				console.log( `${ s.article }  (${ s.relPath }, suite ${ s.suite })` );
				for ( const sh of s.shots ) {
					console.log( `  ${ sh.id }  [${ sh.scene } → ${ sh.capture.target || 'viewport' }]${ sh.kind === 'clip' ? ' clip' : '' }` );
				}
			}
			return 0;
		}
		case 'doctor':
			return ( await doctor( config ) ) ? 0 : 1;
		case 'vocab':
			console.log( `Scenes: ${ sceneNames.join( ', ' ) }\nVerbs: ${ verbNames.join( ', ' ) }\nTargets: ${ targetNames.join( ', ' ) }` );
			return 0;
		default:
			console.error( `Unknown command "${ command }".\n${ HELP }` );
			return 2;
	}
}

async function doctor( config ) {
	let ok = true;
	const check = ( label, pass, hint = '' ) => {
		console.log( `${ pass ? '✓' : '✗' } ${ label }${ pass || ! hint ? '' : `\n    ${ hint }` }` );
		ok = ok && pass;
	};
	const [ major, minor ] = process.versions.node.split( '.' ).map( Number );
	check( `Node ${ process.versions.node }`, major > 22 || ( major === 22 && minor >= 19 ), 'Node 22.19+ is required by @wordpress/e2e-test-utils-playwright' );
	check( `config ${ path.relative( process.cwd(), config.configFile ) }`, true );
	check( `blueprint ${ path.relative( process.cwd(), config.blueprint ) }`, fs.existsSync( config.blueprint ), 'Create blueprint/blueprint.json (see blueprint/README.md)' );
	if ( fs.existsSync( config.blueprint ) ) {
		try {
			const bp = JSON.parse( fs.readFileSync( config.blueprint, 'utf8' ) );
			check( `blueprint pins WordPress (${ bp.preferredVersions?.wp || 'unpinned' }) and PHP (${ bp.preferredVersions?.php || 'unpinned' })`, Boolean( bp.preferredVersions?.wp && bp.preferredVersions?.php ), 'Set preferredVersions in the blueprint; the CLI flag does not win' );
			check( 'blueprint has a login step', ( bp.steps || [] ).some( ( s ) => s.step === 'login' ) || Boolean( bp.login ), 'The browser relies on the login step for authentication' );
		} catch ( e ) {
			check( 'blueprint parses as JSON', false, e.message );
		}
	}
	try {
		const { chromium } = await import( '@playwright/test' );
		const exe = chromium.executablePath();
		check( `Chromium ${ exe ? 'installed' : 'missing' }`, Boolean( exe ) && fs.existsSync( exe ), 'Run: npx playwright install chromium' );
	} catch ( e ) {
		check( 'Playwright importable', false, e.message );
	}
	try {
		const sharp = ( await import( 'sharp' ) ).default;
		check( `sharp ${ sharp.versions.sharp }`, true );
	} catch ( e ) {
		check( 'sharp loads', false, e.message );
	}
	check( `port ${ config.port } free`, await portFree( config.port, config.host ), 'Stop whatever is listening or pass --port' );
	try {
		const specs = loadSpecs( config );
		check( `${ specs.length } spec file(s) valid (${ specs.reduce( ( n, s ) => n + s.shots.length, 0 ) } shots)`, true );
	} catch ( e ) {
		check( 'specs valid', false, e.message );
	}
	check( `output dir ${ path.relative( process.cwd(), config.outDir ) } (writable)`, nearestExistingIsWritable( config.outDir ), 'The nearest existing ancestor of outDir must be writable; run creates the rest' );
	const docker = await import( 'node:child_process' ).then( ( cp ) => cp.spawnSync( 'docker', [ 'version', '--format', '{{.Server.Version}}' ], { encoding: 'utf8' } ) );
	console.log( `${ docker.status === 0 ? '✓' : '·' } Docker ${ docker.status === 0 ? docker.stdout.trim() + ' (canonical renders available via --docker)' : 'not available (local renders are previews; CI does the canonical render)' }` );
	return ok;
}

function nearestExistingIsWritable( p ) {
	let dir = path.resolve( p );
	while ( ! fs.existsSync( dir ) ) {
		const parent = path.dirname( dir );
		if ( parent === dir ) {
			return false;
		}
		dir = parent;
	}
	try {
		fs.accessSync( dir, fs.constants.W_OK );
		return true;
	} catch ( e ) {
		return false;
	}
}

function portFree( port, host ) {
	return new Promise( ( resolve ) => {
		const srv = net.createServer();
		srv.once( 'error', () => resolve( false ) );
		srv.once( 'listening', () => srv.close( () => resolve( true ) ) );
		srv.listen( port, host );
	} );
}

function parseArgs( argv ) {
	const flags = {};
	const rest = [];
	let command = null;
	for ( let i = 0; i < argv.length; i++ ) {
		const a = argv[ i ];
		if ( a.startsWith( '--' ) ) {
			const [ k, inlineV ] = a.slice( 2 ).split( '=' );
			if ( inlineV !== undefined ) {
				flags[ k ] = inlineV;
			} else if ( argv[ i + 1 ] && ! argv[ i + 1 ].startsWith( '-' ) && ! [ 'docker', 'headed', 'fix', 'help' ].includes( k ) ) {
				flags[ k ] = argv[ ++i ];
			} else {
				flags[ k ] = true;
			}
		} else if ( a === '-h' ) {
			flags.help = true;
		} else if ( ! command ) {
			command = a;
		} else {
			rest.push( a );
		}
	}
	return { command, flags, rest };
}

function list( v ) {
	if ( v === undefined || v === true ) {
		return undefined;
	}
	return String( v ).split( ',' ).map( ( s ) => s.trim() ).filter( Boolean );
}
