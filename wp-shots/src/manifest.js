import fs from 'node:fs';
import path from 'node:path';

const VERSION = 1;

export function manifestPath( outDir ) {
	return path.join( outDir, 'manifest.json' );
}

export function readManifest( outDir ) {
	const file = manifestPath( outDir );
	if ( ! fs.existsSync( file ) ) {
		return { version: VERSION, shots: {} };
	}
	try {
		const data = JSON.parse( fs.readFileSync( file, 'utf8' ) );
		return { version: VERSION, shots: data.shots || {} };
	} catch ( e ) {
		throw new Error( `Could not parse ${ file }: ${ e.message }` );
	}
}

export function writeManifest( outDir, manifest ) {
	const sorted = {};
	for ( const key of Object.keys( manifest.shots ).sort() ) {
		sorted[ key ] = sortKeys( manifest.shots[ key ] );
	}
	fs.mkdirSync( outDir, { recursive: true } );
	fs.writeFileSync( manifestPath( outDir ), JSON.stringify( { version: VERSION, shots: sorted }, null, 2 ) + '\n' );
}

function sortKeys( obj ) {
	const out = {};
	for ( const k of Object.keys( obj ).sort() ) {
		out[ k ] = obj[ k ];
	}
	return out;
}

/**
 * Metadata fields that describe the spec rather than the render. Changing these updates the manifest even
 * when pixels are identical.
 */
export function shotMetadata( spec, shot, file ) {
	return {
		file,
		article: spec.article,
		alt: shot.alt,
		caption: shot.caption,
		suite: spec.suite,
		kind: shot.kind,
		specHash: shot.specHash,
	};
}

export function metadataChanged( existing, meta ) {
	if ( ! existing ) {
		return true;
	}
	return Object.keys( meta ).some( ( k ) => JSON.stringify( existing[ k ] ?? null ) !== JSON.stringify( meta[ k ] ?? null ) );
}
