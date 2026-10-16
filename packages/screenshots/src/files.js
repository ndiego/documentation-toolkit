import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every file under `dir`, depth first. A missing directory yields an empty list.
 * @param {string} dir
 * @return {string[]} absolute paths
 */
export function walk( dir ) {
	if ( ! fs.existsSync( dir ) ) {
		return [];
	}
	const out = [];
	for ( const entry of fs.readdirSync( dir, { withFileTypes: true } ) ) {
		const full = path.join( dir, entry.name );
		if ( entry.isDirectory() ) {
			out.push( ...walk( full ) );
		} else {
			out.push( full );
		}
	}
	return out;
}

/**
 * sha256 of a file's bytes, shortened, for change detection.
 * @param {string} file
 * @return {string} 16 hex chars
 */
export function hashFile( file ) {
	return crypto
		.createHash( 'sha256' )
		.update( fs.readFileSync( file ) )
		.digest( 'hex' )
		.slice( 0, 16 );
}
