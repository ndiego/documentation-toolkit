import fs from 'node:fs';
import path from 'node:path';
import { walk } from './files.js';
import { readManifest, writeManifest } from './manifest.js';

/**
 * Write an HTML before/after/diff report for a `check` run.
 * @param {Object}                              config
 * @param {{results:object[], stageDir:string}} run
 * @return {string} path to index.html
 */
export function writeReport( config, run ) {
	const dir = path.join( config.workDir, 'report' );
	fs.rmSync( dir, { recursive: true, force: true } );
	fs.mkdirSync( path.join( dir, 'before' ), { recursive: true } );
	fs.mkdirSync( path.join( dir, 'after' ), { recursive: true } );
	const rows = [];
	for ( const r of run.results ) {
		if ( ! [ 'changed', 'new', 'failed' ].includes( r.status ) ) {
			continue;
		}
		const safe = r.key.replace( /\//g, '--' );
		let before = null;
		let after = null;
		let diff = null;
		if ( r.file ) {
			const committed = path.join( config.outDir, r.file );
			const staged = path.join( run.stageDir, r.file );
			const ext = path.extname( r.file );
			if ( fs.existsSync( committed ) ) {
				before = `before/${ safe }${ ext }`;
				fs.copyFileSync( committed, path.join( dir, before ) );
			}
			if ( fs.existsSync( staged ) ) {
				after = `after/${ safe }${ ext }`;
				fs.copyFileSync( staged, path.join( dir, after ) );
			}
			const diffFile = staged.replace( /\.[a-z]+$/, '.diff.png' );
			if ( fs.existsSync( diffFile ) ) {
				diff = `after/${ safe }.diff.png`;
				fs.copyFileSync( diffFile, path.join( dir, diff ) );
			}
		}
		rows.push( { ...r, before, after, diff } );
	}
	const counts = run.results.reduce(
		( acc, r ) => (
			( acc[ r.status ] = ( acc[ r.status ] || 0 ) + 1 ),
			acc
		 ),
		{}
	);
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>wp-screenshots check report</title>
<style>
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:24px;color:#1e1e1e;background:#fff}
h1{font-size:20px}.summary span{display:inline-block;margin-right:16px}
.shot{border-top:1px solid #ddd;padding:16px 0}.shot h2{font-size:15px;margin:0 0 8px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.cols figure{margin:0}.cols figcaption{font-size:12px;color:#555;margin-bottom:4px}
.cols img{max-width:100%;border:1px solid #ddd;background:#f6f7f7}
.failed{color:#b32d2e}.status{font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
pre{white-space:pre-wrap;background:#f6f7f7;padding:8px;border-radius:4px}
</style></head><body>
<h1>wp-screenshots check report</h1>
<p class="summary">${ Object.entries( counts )
		.map( ( [ k, v ] ) => `<span><strong>${ v }</strong> ${ k }</span>` )
		.join( '' ) }</p>
${ rows.length ? '' : '<p>No visual changes.</p>' }
${ rows
	.map(
		( r ) => `<section class="shot">
<h2><span class="status ${ r.status }">${ r.status }</span> ${ escape( r.key ) }${ r.width ? ` <small>${ r.width }×${ r.height }</small>` : '' }</h2>
${ r.error ? `<pre>${ escape( r.error ) }</pre>` : '' }
<div class="cols">
${ r.before ? `<figure><figcaption>Before (committed)</figcaption><img src="${ r.before }"></figure>` : '' }
${ r.after ? `<figure><figcaption>After (this run)</figcaption><img src="${ r.after }"></figure>` : '' }
${ r.diff ? `<figure><figcaption>Diff</figcaption><img src="${ r.diff }"></figure>` : '' }
</div></section>`
	)
	.join( '\n' ) }
</body></html>
`;
	const index = path.join( dir, 'index.html' );
	fs.writeFileSync( index, html );
	return index;
}

function escape( s ) {
	return String( s ).replace(
		/[&<>"]/g,
		( c ) =>
			( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ]
	);
}

/**
 * Accept the staged results of the last `check`: copy each staged image over the committed one and apply the
 * manifest entry `check` staged next to it, so the environment recorded (canonical flag, versions) is the one
 * that produced the pixels. No second render is needed.
 * @param {Object}                    config
 * @param {(message: string) => void} [log]
 */
export function acceptStaged( config, log = console.log ) {
	const stageDir = path.join( config.workDir, 'check' );
	if ( ! fs.existsSync( stageDir ) ) {
		throw new Error( 'Nothing staged. Run `wp-screenshots check` first.' );
	}
	const manifest = readManifest( config.outDir );
	let n = 0;
	let entries = 0;
	for ( const file of walk( stageDir ) ) {
		if ( file.endsWith( '.diff.png' ) || file.endsWith( '.json' ) ) {
			continue;
		}
		const relFile = path.relative( stageDir, file );
		const dest = path.join( config.outDir, relFile );
		fs.mkdirSync( path.dirname( dest ), { recursive: true } );
		fs.copyFileSync( file, dest );
		n++;
		const sidecar = stagedEntryPath( file );
		if ( fs.existsSync( sidecar ) ) {
			const { key, entry } = JSON.parse(
				fs.readFileSync( sidecar, 'utf8' )
			);
			manifest.shots[ key ] = entry;
			entries++;
		}
		log( `accepted ${ relFile }` );
	}
	if ( entries ) {
		writeManifest( config.outDir, manifest );
	}
	// Clear the stage so a later `update` cannot copy these over newer renders.
	fs.rmSync( stageDir, { recursive: true, force: true } );
	log(
		`${ n } image(s) accepted, ${ entries } manifest entr${ entries === 1 ? 'y' : 'ies' } updated.`
	);
	return n;
}

/**
 * Where `check` stages the manifest entry for a staged image.
 * @param {string} stagedImage
 */
export function stagedEntryPath( stagedImage ) {
	return stagedImage.replace( /\.[a-z]+$/, '.json' );
}
