import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
	extensionFor,
	encode,
	decodeRaw,
	compareRaw,
	diffToPng,
	pixelHash,
	sameAsFile,
} from '../src/image.js';
import { mergeStyle } from '../src/style.js';

let root;

before( () => {
	root = fs.mkdtempSync( path.join( os.tmpdir(), 'wp-screenshots-image-' ) );
} );

after( () => {
	fs.rmSync( root, { recursive: true, force: true } );
} );

// A flat-colour PNG: compresses to a handful of bytes, so lossless WebP stays under any threshold.
async function flatPng(
	width = 64,
	height = 48,
	background = { r: 56, g: 88, b: 233 }
) {
	return sharp( { create: { width, height, channels: 3, background } } )
		.png()
		.toBuffer();
}

// Deterministic pseudo-random noise: incompressible, so lossless WebP is large.
async function noisePng( width = 96, height = 96 ) {
	const data = Buffer.alloc( width * height * 3 );
	// Park-Miller LCG: stays below 2^53, so it is exact in doubles without bitwise ops.
	let seed = 12345;
	for ( let i = 0; i < data.length; i++ ) {
		seed = ( seed * 48271 ) % 2147483647;
		data[ i ] = seed % 256;
	}
	return sharp( data, { raw: { width, height, channels: 3 } } )
		.png()
		.toBuffer();
}

const isWebp = ( buffer ) =>
	buffer.subarray( 0, 4 ).toString( 'ascii' ) === 'RIFF' &&
	buffer.subarray( 8, 12 ).toString( 'ascii' ) === 'WEBP';
const isPng = ( buffer ) =>
	buffer.subarray( 1, 4 ).toString( 'ascii' ) === 'PNG';

describe( 'extensionFor', () => {
	it( 'maps png to png and everything else to webp', () => {
		assert.equal( extensionFor( 'png' ), 'png' );
		assert.equal( extensionFor( 'webp' ), 'webp' );
		assert.equal( extensionFor( undefined ), 'webp' );
	} );
} );

describe( 'encode', () => {
	it( 'encodes losslessly when the result fits under maxBytes', async () => {
		const png = await flatPng();
		const { buffer, encoding } = await encode( png, mergeStyle() );
		assert.equal( encoding, 'webp-lossless' );
		assert.ok( isWebp( buffer ) );
		assert.ok( buffer.length <= 300 * 1024 );
		// Lossless really is lossless: the pixels round-trip.
		const cmp = compareRaw(
			await decodeRaw( png ),
			await decodeRaw( buffer )
		);
		assert.equal( cmp.equal, true );
	} );

	it( 'falls back to lossy at the configured quality when lossless exceeds maxBytes', async () => {
		const png = await noisePng();
		const lossless = await encode(
			png,
			mergeStyle( { webp: { maxBytes: null } } )
		);
		assert.equal( lossless.encoding, 'webp-lossless' );

		const style = mergeStyle( {
			webp: { maxBytes: lossless.buffer.length - 1 },
		} );
		const lossy = await encode( png, style );
		assert.equal( lossy.encoding, 'webp-q90' );
		assert.ok( isWebp( lossy.buffer ) );
		assert.ok(
			lossy.buffer.length < lossless.buffer.length,
			'lossy output is smaller than lossless'
		);

		const q75 = await encode(
			png,
			mergeStyle( { webp: { maxBytes: 1, quality: 75 } } )
		);
		assert.equal( q75.encoding, 'webp-q75' );
	} );

	it( 'stays lossless at any size when maxBytes is null', async () => {
		const { encoding } = await encode(
			await noisePng(),
			mergeStyle( { webp: { maxBytes: null } } )
		);
		assert.equal( encoding, 'webp-lossless' );
	} );

	it( 'skips the lossless attempt when lossless is false', async () => {
		const { encoding } = await encode(
			await flatPng(),
			mergeStyle( { webp: { lossless: false } } )
		);
		assert.equal( encoding, 'webp-q90' );
	} );

	it( 'encodes PNG when the format is png', async () => {
		const { buffer, encoding } = await encode(
			await flatPng(),
			mergeStyle( { format: 'png' } )
		);
		assert.equal( encoding, 'png' );
		assert.ok( isPng( buffer ) );
	} );

	it( 'is deterministic: the same input gives byte-identical output', async () => {
		const flat = await flatPng();
		const noise = await noisePng();
		const style = mergeStyle();
		const lossy = mergeStyle( { webp: { maxBytes: 1 } } );
		assert.ok(
			( await encode( flat, style ) ).buffer.equals(
				( await encode( flat, style ) ).buffer
			)
		);
		assert.ok(
			( await encode( noise, style ) ).buffer.equals(
				( await encode( noise, style ) ).buffer
			)
		);
		assert.ok(
			( await encode( noise, lossy ) ).buffer.equals(
				( await encode( noise, lossy ) ).buffer
			)
		);
		assert.ok(
			(
				await encode( flat, mergeStyle( { format: 'png' } ) )
			).buffer.equals(
				( await encode( flat, mergeStyle( { format: 'png' } ) ) ).buffer
			)
		);
	} );
} );

describe( 'decodeRaw and compareRaw', () => {
	it( 'decodes to RGBA with dimensions', async () => {
		const raw = await decodeRaw( await flatPng( 10, 6 ) );
		assert.equal( raw.width, 10 );
		assert.equal( raw.height, 6 );
		assert.equal( raw.data.length, 10 * 6 * 4 );
		assert.deepEqual(
			[ ...raw.data.subarray( 0, 4 ) ],
			[ 56, 88, 233, 255 ]
		);
	} );

	it( 'reports identical buffers as equal', async () => {
		const a = await decodeRaw( await flatPng() );
		const b = await decodeRaw( await flatPng() );
		assert.deepEqual( compareRaw( a, b ), {
			equal: true,
			diffPixels: 0,
			sizeChanged: false,
			diff: null,
			width: 64,
			height: 48,
		} );
	} );

	it( 'counts differing pixels and builds a diff image on request', async () => {
		const a = await decodeRaw( await flatPng() );
		const b = await decodeRaw( await flatPng() );
		// Two pixels in b are turned black.
		for ( const i of [ 0, 5 ] ) {
			b.data.fill( 0, i * 4, i * 4 + 3 );
		}
		const cmp = compareRaw( a, b, { withDiff: true } );
		assert.equal( cmp.equal, false );
		assert.equal( cmp.diffPixels, 2 );
		assert.equal( cmp.sizeChanged, false );
		assert.equal( cmp.diff.length, 64 * 48 * 4 );
		const png = await diffToPng( cmp );
		assert.ok( isPng( png ) );
		const meta = await sharp( png ).metadata();
		assert.equal( meta.width, 64 );
		assert.equal( meta.height, 48 );
	} );

	it( 'treats a size change as an infinite diff', async () => {
		const a = await decodeRaw( await flatPng( 64, 48 ) );
		const b = await decodeRaw( await flatPng( 64, 49 ) );
		assert.deepEqual( compareRaw( a, b ), {
			equal: false,
			diffPixels: Infinity,
			sizeChanged: true,
			diffPng: null,
		} );
	} );
} );

describe( 'pixelHash', () => {
	it( 'is a stable 16-hex digest of size and pixels', async () => {
		const a = await decodeRaw( await flatPng() );
		const b = await decodeRaw( await flatPng() );
		assert.match( pixelHash( a ), /^[0-9a-f]{16}$/ );
		assert.equal( pixelHash( a ), pixelHash( b ) );
		b.data[ 0 ] = 0;
		assert.notEqual( pixelHash( a ), pixelHash( b ) );
		const taller = await decodeRaw( await flatPng( 64, 49 ) );
		assert.notEqual( pixelHash( a ), pixelHash( taller ) );
	} );
} );

describe( 'sameAsFile', () => {
	it( 'is false for a missing file', async () => {
		const { buffer } = await encode( await flatPng(), mergeStyle() );
		assert.deepEqual(
			await sameAsFile( buffer, path.join( root, 'missing.webp' ) ),
			{ same: false, existing: null, fresh: null, cmp: null }
		);
	} );

	it( 'compares pixels, not bytes, against the file on disk', async () => {
		const file = path.join( root, 'hero.webp' );
		const { buffer } = await encode( await flatPng(), mergeStyle() );
		fs.writeFileSync( file, buffer );
		// A PNG of the same pixels is "the same" even though the bytes differ.
		const same = await sameAsFile( await flatPng(), file );
		assert.equal( same.same, true );
		assert.equal( same.diffPixels, 0 );
		assert.equal( same.cmp.equal, true );

		const different = await sameAsFile(
			await flatPng( 64, 48, { r: 0, g: 0, b: 0 } ),
			file,
			{ withDiff: true }
		);
		assert.equal( different.same, false );
		assert.equal( different.diffPixels, 64 * 48 );
		assert.equal( different.cmp.diff.length, 64 * 48 * 4 );
	} );
} );
