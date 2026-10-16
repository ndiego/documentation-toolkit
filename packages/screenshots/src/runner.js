import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { blueprintForSuite } from './config.js';
import { loadSpecs, filterSpecs } from './spec.js';
import { startPlayground } from './env/playground.js';
import { launchBrowser } from './browser.js';
import { createSite } from './site.js';
import { runScene } from './scenes.js';
import { runSteps } from './actions.js';
import { captureShot } from './capture.js';
import {
	extensionFor,
	sameAsFile,
	decodeRaw,
	pixelHash,
	diffToPng,
} from './image.js';
import {
	readManifest,
	writeManifest,
	shotMetadata,
	metadataChanged,
} from './manifest.js';
import { stagedEntryPath } from './report.js';
import { resolveViewport } from './style.js';

const require = createRequire( import.meta.url );

/**
 * Render shots.
 *
 * mode "run":   write changed images into config.outDir and update the manifest.
 * mode "check": write nothing into outDir; stage renders (and their manifest entries) under workDir/check for
 *               `update` to apply, and return the diff list. A dev session (pauseAt) stages under workDir/dev
 *               instead, so it never disturbs what a previous check staged.
 *
 * @param {Object}                        config
 * @param {Object}                        opts
 * @param {Object}                        [opts.filter]
 * @param {'run'|'check'}                 [opts.mode]
 * @param {boolean}                       [opts.headed]
 * @param {(msg:string)=>void}            [opts.log]
 * @param {{article:string, shot:string}} [opts.pauseAt] dev mode: pause after this shot's steps
 * @param {Object[]}                      [opts.specs]   specs to run instead of loading them from disk
 */
export async function runShots( config, opts = {} ) {
	const {
		filter = {},
		mode = 'run',
		headed = false,
		log = console.log,
		pauseAt = null,
	} = opts;
	const specs = filterSpecs( opts.specs || loadSpecs( config ), filter );
	if ( ! specs.length ) {
		throw Object.assign(
			new Error(
				'No shot specs matched the filter. `wp-screenshots list` shows what exists.'
			),
			{ name: 'UserError' }
		);
	}
	const totalShots = specs.reduce( ( n, s ) => n + s.shots.length, 0 );
	log(
		`${ specs.length } spec file(s), ${ totalShots } shot(s), mode ${ mode }`
	);

	const ext = extensionFor( config.style.format );
	const outDir = config.outDir;
	const stageDir = path.join( config.workDir, pauseAt ? 'dev' : 'check' );
	const failDir = path.join( config.workDir, 'failures' );
	if ( mode === 'check' ) {
		fs.rmSync( stageDir, { recursive: true, force: true } );
	}
	fs.mkdirSync( failDir, { recursive: true } );

	const manifest = readManifest( outDir );
	const results = [];
	const bySuite = new Map();
	for ( const spec of specs ) {
		if ( ! bySuite.has( spec.suite ) ) {
			bySuite.set( spec.suite, [] );
		}
		bySuite.get( spec.suite ).push( spec );
	}

	const playwrightVersion =
		require( '@playwright/test/package.json' ).version;
	const startedAll = Date.now();

	for ( const [ suite, suiteSpecs ] of bySuite ) {
		const blueprint = blueprintForSuite( config, suite );
		const blueprintHash = hashFile( blueprint );
		let env = null;
		let browser = null;
		let ctx = null;

		const boot = async () => {
			await teardown();
			env = await startPlayground( {
				blueprint,
				host: config.host,
				port: config.port,
				wp: config.wordpress.version,
				php: config.wordpress.php,
				logFile: path.join(
					config.workDir,
					`playground-${ suite }.log`
				),
				log,
			} );
			browser = await launchBrowser( {
				baseURL: env.baseURL,
				style: config.style,
				user: config.user,
				headed,
			} );
			// First request: Playground's login step hands the browser its auth cookie, which the REST helpers
			// (template lookups, cleanup) reuse. Without this, a run whose first shot uses {{media.*}} has no cookie.
			await browser.page.goto( '/wp-admin/index.php' );
			const site = createSite( {
				baseURL: env.baseURL,
				context: browser.context,
			} );
			ctx = {
				...browser,
				site,
				style: config.style,
				config,
				log,
				baseURL: env.baseURL,
				versions: env.versions,
			};
		};
		const teardown = async () => {
			if ( browser ) {
				await browser.close();
				browser = null;
			}
			if ( env ) {
				await env.stop();
				env = null;
			}
		};
		const onSignal = async () => {
			await teardown();
			process.exit( 130 );
		};
		process.once( 'SIGINT', onSignal );
		process.once( 'SIGTERM', onSignal );

		// Set when a reboot after an isolated shot fails: the suite's remaining shots are reported as failed
		// rather than aborting the run (which would leave images on disk without manifest entries).
		let aborted = null;
		try {
			await boot();
			for ( const [ specIndex, spec ] of suiteSpecs.entries() ) {
				log( `\n${ spec.article } (${ spec.relPath })` );
				for ( const [ shotIndex, shot ] of spec.shots.entries() ) {
					const key = `${ spec.article }/${ shot.id }`;
					const file = `${ spec.article }/${ shot.id }.${ ext }`;
					const outFile = path.join( outDir, file );
					const t0 = Date.now();
					if ( shot.kind === 'clip' ) {
						log(
							`  ~ ${ shot.id }: clips are not supported yet (phase 5); skipped`
						);
						results.push( { key, status: 'skipped', ms: 0 } );
						continue;
					}
					if ( aborted ) {
						results.push( {
							key,
							status: 'failed',
							ms: 0,
							error: aborted,
						} );
						log(
							`  ✗ ${ shot.id } failed: ${ firstLine( aborted ) }`
						);
						continue;
					}
					try {
						// Only this shot's page errors should show up in its failure diagnostics.
						ctx.pageErrors.length = 0;
						const resolved = await ctx.site.resolve( {
							steps: shot.steps,
							capture: shot.capture,
						} );
						const vp = resolveViewport(
							config.style,
							shot.viewport
						);
						if (
							JSON.stringify( ctx.page.viewportSize() ) !==
							JSON.stringify( vp )
						) {
							await ctx.page.setViewportSize( vp );
						}
						await runScene( ctx, shot.scene );
						if ( shot.script ) {
							const mod = await import(
								pathToFileURL( shot.script ).href
							);
							await ( mod.default || mod.run )( ctx, {
								shot,
								spec,
							} );
						} else {
							await runSteps( ctx, resolved.steps );
						}
						if (
							pauseAt &&
							pauseAt.article === spec.article &&
							pauseAt.shot === shot.id
						) {
							log(
								'  Paused. Use the Playwright Inspector to pick locators; press Resume to capture.'
							);
							await ctx.page.pause();
						}
						const captured = await captureShot( ctx, {
							...shot,
							capture: resolved.capture,
						} );
						const meta = shotMetadata( spec, shot, file );
						const existing = manifest.shots[ key ];
						const { same, fresh, cmp } = await sameAsFile(
							captured.buffer,
							outFile,
							{ withDiff: mode !== 'run' }
						);
						const raw =
							fresh || ( await decodeRaw( captured.buffer ) );
						// When the pixels match, the committed file stays as it is, so the manifest must describe
						// that file (its byte size and encoding), not this run's re-encode of the same pixels.
						const entry = {
							...( existing || {} ),
							...meta,
							width: raw.width,
							height: raw.height,
							bytes: same
								? fs.statSync( outFile ).size
								: captured.buffer.length,
							encoding: same
								? existing?.encoding || captured.encoding
								: captured.encoding,
							pixelHash: pixelHash( raw ),
							frame: captured.frame,
							wordpress: env.versions.wordpress,
							php: env.versions.php,
							theme: env.versions.theme || null,
							playwright: playwrightVersion,
							chromium: browser.chromiumVersion,
							platform: `${ process.platform }-${ process.arch }`,
							canonical:
								process.env.WP_SCREENSHOTS_CANONICAL === '1',
							blueprintHash,
						};
						let status;
						if ( mode === 'run' ) {
							const fileExisted = fs.existsSync( outFile );
							if ( same ) {
								status = 'unchanged';
								// Pixels match, but the entry may still be stale: fields added since, an `update` that
								// copied new bytes without touching the manifest, or a version bump with identical
								// output. A local preview run never overwrites a canonical entry's environment fields.
								const downgrade =
									existing?.canonical && ! entry.canonical;
								const next = downgrade
									? {
											...entry,
											wordpress: existing.wordpress,
											php: existing.php,
											theme: existing.theme,
											playwright: existing.playwright,
											chromium: existing.chromium,
											platform: existing.platform,
											canonical: true,
										}
									: entry;
								const stale =
									! existing ||
									Object.keys( next ).some(
										( k ) =>
											JSON.stringify(
												existing[ k ] ?? null
											) !==
											JSON.stringify( next[ k ] ?? null )
									);
								if (
									stale ||
									metadataChanged( existing, meta )
								) {
									manifest.shots[ key ] = {
										...next,
										capturedAt:
											existing?.capturedAt ||
											new Date().toISOString(),
									};
									status = 'metadata';
								}
							} else {
								fs.mkdirSync( path.dirname( outFile ), {
									recursive: true,
								} );
								fs.writeFileSync( outFile, captured.buffer );
								manifest.shots[ key ] = {
									...entry,
									capturedAt: new Date().toISOString(),
								};
								status = fileExisted ? 'updated' : 'created';
							}
						} else {
							if ( same ) {
								status = 'unchanged';
							} else {
								status = cmp ? 'changed' : 'new';
							}
							if ( ! same ) {
								const staged = path.join( stageDir, file );
								fs.mkdirSync( path.dirname( staged ), {
									recursive: true,
								} );
								fs.writeFileSync( staged, captured.buffer );
								fs.writeFileSync(
									stagedEntryPath( staged ),
									JSON.stringify(
										{
											key,
											entry: {
												...entry,
												capturedAt:
													new Date().toISOString(),
											},
										},
										null,
										2
									) + '\n'
								);
								if ( cmp && ! cmp.sizeChanged ) {
									fs.writeFileSync(
										staged.replace(
											/\.[a-z]+$/,
											'.diff.png'
										),
										await diffToPng( cmp )
									);
								}
							}
						}
						const ms = Date.now() - t0;
						results.push( {
							key,
							file,
							status,
							ms,
							width: raw.width,
							height: raw.height,
						} );
						log(
							`  ${ icon( status ) } ${ shot.id } ${ status } (${ raw.width }×${ raw.height }, ${ ms } ms)`
						);
					} catch ( e ) {
						const ms = Date.now() - t0;
						const failShot = path.join(
							failDir,
							`${ spec.article }--${ shot.id }.png`
						);
						await ctx?.page
							?.screenshot( { path: failShot, fullPage: false } )
							.catch( () => {} );
						results.push( {
							key,
							status: 'failed',
							ms,
							error: e.message,
						} );
						log(
							`  ✗ ${ shot.id } failed: ${ firstLine( e.message ) }\n    page state saved to ${ path.relative( process.cwd(), failShot ) }`
						);
						if ( ctx?.pageErrors?.length ) {
							log(
								`    page errors: ${ ctx.pageErrors.slice( -3 ).join( ' | ' ) }`
							);
						}
					}
					const moreToCome =
						shotIndex < spec.shots.length - 1 ||
						specIndex < suiteSpecs.length - 1;
					if ( shot.isolated && moreToCome ) {
						log( '  (isolated shot: rebooting Playground)' );
						try {
							await boot();
						} catch ( e ) {
							aborted = `Playground did not come back after isolated shot ${ shot.id }: ${ firstLine( e.message ) }`;
							log( `  ✗ ${ aborted }` );
						}
					}
				}
				if ( ! aborted ) {
					await ctx.site.cleanup( log );
				}
			}
		} finally {
			process.off( 'SIGINT', onSignal );
			process.off( 'SIGTERM', onSignal );
			await teardown();
		}
	}

	if ( mode === 'run' ) {
		// Drop manifest entries for shots that no longer exist, only when nothing was filtered.
		if (
			! filter.article?.length &&
			! filter.section?.length &&
			! filter.suite?.length &&
			! filter.shot?.length
		) {
			const live = new Set(
				specs.flatMap( ( s ) =>
					s.shots.map( ( sh ) => `${ s.article }/${ sh.id }` )
				)
			);
			for ( const key of Object.keys( manifest.shots ) ) {
				if ( ! live.has( key ) ) {
					delete manifest.shots[ key ];
				}
			}
		}
		writeManifest( outDir, manifest );
	}

	const summary = summarise( results );
	log(
		`\nDone in ${ ( ( Date.now() - startedAll ) / 1000 ).toFixed( 1 ) }s: ${ summary.text }`
	);
	return { results, summary, stageDir };
}

function summarise( results ) {
	const counts = {};
	for ( const r of results ) {
		counts[ r.status ] = ( counts[ r.status ] || 0 ) + 1;
	}
	const text =
		Object.entries( counts )
			.map( ( [ k, v ] ) => `${ v } ${ k }` )
			.join( ', ' ) || 'nothing';
	return { counts, text, failed: counts.failed || 0 };
}

function icon( status ) {
	return (
		{
			created: '+',
			updated: '↻',
			unchanged: '=',
			metadata: 'm',
			changed: '↻',
			new: '+',
		}[ status ] || '·'
	);
}

function firstLine( s ) {
	return String( s ).split( '\n' )[ 0 ];
}

function hashFile( file ) {
	return crypto
		.createHash( 'sha256' )
		.update( fs.readFileSync( file ) )
		.digest( 'hex' )
		.slice( 0, 16 );
}
