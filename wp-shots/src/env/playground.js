import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire( import.meta.url );

/** Absolute path of the Playground CLI entry script. */
export function playgroundCliPath() {
	const pkgPath = require.resolve( '@wp-playground/cli/package.json' );
	const pkg = JSON.parse( fs.readFileSync( pkgPath, 'utf8' ) );
	const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[ 'wp-playground-cli' ] || Object.values( pkg.bin )[ 0 ];
	return path.join( path.dirname( pkgPath ), bin );
}

/**
 * Start `wp-playground-cli server` from a blueprint and wait until WordPress answers.
 *
 * Playground's `login` blueprint step auto-authenticates any HTTP client on its first request by setting
 * cookies and answering 302, so readiness accepts 200 or 302.
 *
 * @param {object} opts
 * @param {string} opts.blueprint      Absolute path to blueprint.json
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {string} [opts.wp]           WordPress version (also pinned in the blueprint; the blueprint wins)
 * @param {string} [opts.php]
 * @param {string} opts.logFile        Where to write the server log
 * @param {(msg:string)=>void} [opts.log]
 * @param {number} [opts.timeoutMs]
 */
export async function startPlayground( opts ) {
	const { blueprint, host, port, wp, php, logFile, log = () => {}, timeoutMs = 240_000 } = opts;
	if ( ! fs.existsSync( blueprint ) ) {
		throw new Error( `Blueprint not found: ${ blueprint }` );
	}
	fs.mkdirSync( path.dirname( logFile ), { recursive: true } );
	const args = [
		playgroundCliPath(),
		'server',
		`--blueprint=${ blueprint }`,
		'--blueprint-may-read-adjacent-files',
		`--port=${ port }`,
	];
	if ( wp && wp !== 'latest' ) {
		args.push( `--wp=${ wp }` );
	}
	if ( php ) {
		args.push( `--php=${ php }` );
	}
	const started = Date.now();
	const out = fs.openSync( logFile, 'w' );
	const child = spawn( process.execPath, args, {
		cwd: path.dirname( blueprint ),
		stdio: [ 'ignore', out, out ],
		env: { ...process.env, NODE_OPTIONS: '' },
	} );
	let exited = false;
	let exitCode = null;
	child.on( 'exit', ( code ) => {
		exited = true;
		exitCode = code;
	} );
	const baseURL = `http://${ host }:${ port }`;
	const stop = async () => {
		if ( exited ) {
			return;
		}
		child.kill( 'SIGTERM' );
		await new Promise( ( resolve ) => {
			const t = setTimeout( () => {
				if ( ! exited ) {
					child.kill( 'SIGKILL' );
				}
				resolve();
			}, 5000 );
			child.once( 'exit', () => {
				clearTimeout( t );
				resolve();
			} );
		} );
	};
	const onExit = () => {
		if ( ! exited ) {
			child.kill( 'SIGKILL' );
		}
	};
	process.once( 'exit', onExit );

	log( `Booting WordPress Playground on ${ baseURL } (log: ${ path.relative( process.cwd(), logFile ) })` );
	while ( true ) {
		if ( exited ) {
			throw new Error( `Playground exited with code ${ exitCode } before answering. Last log lines:\n${ tail( logFile ) }` );
		}
		if ( Date.now() - started > timeoutMs ) {
			await stop();
			throw new Error( `Playground did not answer within ${ timeoutMs / 1000 }s. Last log lines:\n${ tail( logFile ) }` );
		}
		// The CLI prints "Ready!" once the blueprint has finished. HTTP answers a few seconds earlier, while
		// the seed is still running, so the log line is the signal that content exists.
		if ( logContains( logFile, 'Ready!' ) ) {
			try {
				const res = await fetch( `${ baseURL }/wp-login.php`, { redirect: 'manual', signal: AbortSignal.timeout( 2000 ) } );
				if ( res.status === 200 || res.status === 302 ) {
					break;
				}
			} catch ( e ) {
				// not ready yet
			}
		}
		await sleep( 250 );
	}
	const bootMs = Date.now() - started;
	const versions = await detectVersions( baseURL );
	log( `Playground ready in ${ ( bootMs / 1000 ).toFixed( 1 ) }s: WordPress ${ versions.wordpress || '?' }, PHP ${ versions.php || '?' }` );
	if ( wp && wp !== 'latest' && wp !== 'nightly' && versions.wordpress && ! versions.wordpress.startsWith( wp ) ) {
		log( `Warning: requested WordPress ${ wp } but ${ versions.wordpress } booted. Pin \`preferredVersions.wp\` in the blueprint; the CLI flag does not win.` );
	}
	return { baseURL, bootMs, versions, stop: async () => { process.off( 'exit', onExit ); await stop(); } };
}

/**
 * Read the WordPress version from the front end's generator meta tag and PHP from the X-Powered-By header.
 * Both are best effort; a theme may remove the generator tag.
 * @param {string} baseURL
 */
export async function detectVersions( baseURL ) {
	const versions = { wordpress: null, php: null, theme: null };
	// The demo mu-plugin adds a `wp_shots` block to the REST index; prefer it when present.
	try {
		const res = await fetchFollowingLogin( `${ baseURL }/wp-json/` );
		if ( res.ok ) {
			const index = await res.json();
			if ( index?.wp_shots?.wordpress ) {
				return { wordpress: index.wp_shots.wordpress, php: index.wp_shots.php || null, theme: index.wp_shots.theme || null };
			}
		}
	} catch ( e ) {
		// fall back to the generator tag
	}
	try {
		const res = await fetchFollowingLogin( `${ baseURL }/` );
		const powered = res.headers.get( 'x-powered-by' );
		if ( powered ) {
			versions.php = powered.replace( /^PHP\//, '' );
		}
		const html = await res.text();
		const m = html.match( /<meta name="generator" content="WordPress ([^"]+)"/ );
		if ( m ) {
			versions.wordpress = m[ 1 ];
		}
	} catch ( e ) {
		// leave nulls
	}
	return versions;
}

/**
 * Playground answers a cookie-less client's first request with a 302 that sets the login cookie, so follow
 * redirects by hand and carry the cookies along (fetch's own follow mode would loop).
 */
async function fetchFollowingLogin( startUrl ) {
	let url = startUrl;
	let cookies = [];
	let res;
	for ( let hop = 0; hop < 6; hop++ ) {
		res = await fetch( url, {
			redirect: 'manual',
			headers: cookies.length ? { cookie: cookies.join( '; ' ) } : {},
			signal: AbortSignal.timeout( 15_000 ),
		} );
		const setCookies = res.headers.getSetCookie?.() || [];
		cookies = cookies.concat( setCookies.map( ( c ) => c.split( ';' )[ 0 ] ) );
		if ( res.status >= 300 && res.status < 400 && res.headers.get( 'location' ) ) {
			url = new URL( res.headers.get( 'location' ), url ).href;
			continue;
		}
		break;
	}
	return res;
}

function logContains( file, needle ) {
	try {
		return fs.readFileSync( file, 'utf8' ).includes( needle );
	} catch ( e ) {
		return false;
	}
}

function tail( file, lines = 25 ) {
	try {
		return fs.readFileSync( file, 'utf8' ).trim().split( '\n' ).slice( -lines ).join( '\n' );
	} catch ( e ) {
		return '(no log)';
	}
}

const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
