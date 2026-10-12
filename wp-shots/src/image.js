import crypto from 'node:crypto';
import fs from 'node:fs';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';

export function extensionFor( format ) {
	return format === 'png' ? 'png' : 'webp';
}

/**
 * Encode a raw PNG screenshot buffer to the project's output format.
 * @param {Buffer} png
 * @param {object} style
 * @returns {Promise<Buffer>}
 */
export async function encode( png, style ) {
	if ( style.format === 'png' ) {
		const buffer = await sharp( png ).png( { compressionLevel: style.png.compressionLevel, effort: 10 } ).toBuffer();
		return { buffer, encoding: 'png' };
	}
	const effort = style.webp.effort ?? 6;
	if ( style.webp.lossless !== false ) {
		const buffer = await sharp( png ).webp( { lossless: true, effort } ).toBuffer();
		if ( ! style.webp.maxBytes || buffer.length <= style.webp.maxBytes ) {
			return { buffer, encoding: 'webp-lossless' };
		}
	}
	const quality = style.webp.quality ?? 90;
	const buffer = await sharp( png ).webp( { quality, effort } ).toBuffer();
	return { buffer, encoding: `webp-q${ quality }` };
}

/**
 * Put the capture on a card: background canvas, rounded corners, soft shadow. Sizes are in CSS px and
 * scaled by the device scale factor so the result matches the capture's density.
 * @param {Buffer} png
 * @param {object} style
 * @param {number} scale
 */
export async function frameCard( png, style, scale ) {
	const { background, margin, radius, shadow } = style.card;
	const meta = await sharp( png ).metadata();
	const m = Math.round( margin * scale );
	const r = Math.round( radius * scale );
	const width = meta.width + m * 2;
	const height = meta.height + m * 2;
	const rounded = await sharp( png )
		.composite( [ { input: roundedMask( meta.width, meta.height, r ), blend: 'dest-in' } ] )
		.png()
		.toBuffer();
	const blur = Math.max( 1, shadow.blur * scale );
	const shadowLayer = await sharp( {
		create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
	} )
		.composite( [ { input: shadowRect( meta.width, meta.height, r, shadow.color ), left: m, top: m + Math.round( shadow.offsetY * scale ) } ] )
		.png()
		.toBuffer();
	const blurredShadow = await sharp( shadowLayer ).blur( blur / 2 ).png().toBuffer();
	return sharp( { create: { width, height, channels: 4, background } } )
		.composite( [ { input: blurredShadow }, { input: rounded, left: m, top: m } ] )
		.png()
		.toBuffer();
}

function roundedMask( w, h, r ) {
	return Buffer.from( `<svg width="${ w }" height="${ h }"><rect x="0" y="0" width="${ w }" height="${ h }" rx="${ r }" ry="${ r }" fill="#fff"/></svg>` );
}

function shadowRect( w, h, r, color ) {
	return Buffer.from( `<svg width="${ w }" height="${ h }"><rect x="0" y="0" width="${ w }" height="${ h }" rx="${ r }" ry="${ r }" fill="${ color }"/></svg>` );
}

/**
 * Decode any image (file path or buffer) to raw RGBA.
 * @returns {Promise<{data:Buffer,width:number,height:number}>}
 */
export async function decodeRaw( input ) {
	const { data, info } = await sharp( input ).ensureAlpha().raw().toBuffer( { resolveWithObject: true } );
	return { data, width: info.width, height: info.height };
}

/**
 * Compare two raw images. Returns { equal, diffPixels, diffPng } where diffPng is only built when asked.
 */
export function compareRaw( a, b, { withDiff = false, threshold = 0 } = {} ) {
	if ( a.width !== b.width || a.height !== b.height ) {
		return { equal: false, diffPixels: Infinity, sizeChanged: true, diffPng: null };
	}
	const diff = withDiff ? Buffer.alloc( a.width * a.height * 4 ) : null;
	const diffPixels = pixelmatch( a.data, b.data, diff, a.width, a.height, { threshold, includeAA: true } );
	return { equal: diffPixels === 0, diffPixels, sizeChanged: false, diff, width: a.width, height: a.height };
}

export async function diffToPng( raw ) {
	return sharp( raw.diff, { raw: { width: raw.width, height: raw.height, channels: 4 } } ).png().toBuffer();
}

export function pixelHash( raw ) {
	return crypto.createHash( 'sha256' ).update( `${ raw.width }x${ raw.height }:` ).update( raw.data ).digest( 'hex' ).slice( 0, 16 );
}

/**
 * Pixel-compare a freshly encoded image with the file on disk; `same` is true when nothing visible changed.
 * With `withDiff`, `cmp` carries the diff buffer (see compareRaw) so callers need not decode or compare again.
 */
export async function sameAsFile( encoded, file, { withDiff = false } = {} ) {
	if ( ! fs.existsSync( file ) ) {
		return { same: false, existing: null, fresh: null, cmp: null };
	}
	const [ fresh, existing ] = await Promise.all( [ decodeRaw( encoded ), decodeRaw( file ) ] );
	const cmp = compareRaw( existing, fresh, { withDiff } );
	return { same: cmp.equal, existing, fresh, diffPixels: cmp.diffPixels, cmp };
}
