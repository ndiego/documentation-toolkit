import crypto from 'node:crypto';
import fs from 'node:fs';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { nearestFrame } from './style.js';

export function extensionFor( format ) {
	return format === 'png' ? 'png' : 'webp';
}

/**
 * Encode a raw PNG screenshot buffer to the project's output format.
 * @param {Buffer} png
 * @param {Object} style
 * @return {Promise<Buffer>} the encoded image
 */
export async function encode( png, style ) {
	if ( style.format === 'png' ) {
		const buffer = await sharp( png )
			.png( { compressionLevel: style.png.compressionLevel, effort: 10 } )
			.toBuffer();
		return { buffer, encoding: 'png' };
	}
	const effort = style.webp.effort ?? 6;
	if ( style.webp.lossless !== false ) {
		const buffer = await sharp( png )
			.webp( { lossless: true, effort } )
			.toBuffer();
		if ( ! style.webp.maxBytes || buffer.length <= style.webp.maxBytes ) {
			return { buffer, encoding: 'webp-lossless' };
		}
	}
	const quality = style.webp.quality ?? 90;
	const buffer = await sharp( png ).webp( { quality, effort } ).toBuffer();
	return { buffer, encoding: `webp-q${ quality }` };
}

/**
 * Put the capture on a card: background canvas, rounded corners, soft shadow, content-sized. Sizes are in
 * CSS px and scaled by the device scale factor so the result matches the capture's density.
 * @param {Buffer} png
 * @param {Object} style
 * @param {number} scale
 * @return {Promise<Buffer>} the framed PNG
 */
export async function frameCard( png, style, scale ) {
	const { background, margin, radius, shadow } = style.card;
	const meta = await sharp( png ).metadata();
	const m = Math.round( margin * scale );
	return compose( png, meta, {
		width: meta.width + m * 2,
		height: meta.height + m * 2,
		left: m,
		top: m,
		radius: Math.round( radius * scale ),
		shadow,
		scale,
		background,
	} );
}

/**
 * Put the capture on a stage with a canonical aspect ratio. The content is never scaled: the stage grows around
 * it (at least `stage.margin` on every side) until it reaches the ratio, and the content sits centred.
 * @param {Buffer} png
 * @param {string} frame a key of `style.frames`, or `auto` for the ratio nearest to the content
 * @param {Object} style
 * @param {number} scale
 * @return {Promise<{buffer: Buffer, frame: string, width: number, height: number}>} the staged PNG and the frame used
 */
export async function stage( png, frame, style, scale ) {
	const { background, margin, radius, shadow } = style.stage;
	const meta = await sharp( png ).metadata();
	const m = Math.round( margin * scale );
	let width = meta.width + m * 2;
	let height = meta.height + m * 2;
	const name =
		frame === 'auto' ? nearestFrame( style, width, height ) : frame;
	const ratio = style.frames[ name ];
	if ( ! ratio ) {
		throw new Error(
			`unknown frame "${ frame }" (${ Object.keys( style.frames ).join( ' | ' ) } | auto)`
		);
	}
	if ( width / height < ratio ) {
		width = Math.round( height * ratio );
	} else {
		height = Math.round( width / ratio );
	}
	const buffer = await compose( png, meta, {
		width,
		height,
		left: Math.round( ( width - meta.width ) / 2 ),
		top: Math.round( ( height - meta.height ) / 2 ),
		radius: Math.round( radius * scale ),
		shadow,
		scale,
		background,
	} );
	return { buffer, frame: name, width, height };
}

/**
 * Shared compositor for card and stage: background, blurred shadow, then the rounded capture.
 * @param {Buffer} png
 * @param {Object} meta   sharp metadata of `png`
 * @param {Object} layout
 * @return {Promise<Buffer>} PNG
 */
async function compose( png, meta, layout ) {
	const { width, height, left, top, radius, shadow, scale, background } =
		layout;
	const rounded = await sharp( png )
		.composite( [
			{
				input: roundedMask( meta.width, meta.height, radius ),
				blend: 'dest-in',
			},
		] )
		.png()
		.toBuffer();
	const blur = Math.max( 1, shadow.blur * scale );
	const shadowLayer = await sharp( {
		create: {
			width,
			height,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	} )
		.composite( [
			{
				input: shadowRect(
					meta.width,
					meta.height,
					radius,
					shadow.color
				),
				left,
				top: top + Math.round( shadow.offsetY * scale ),
			},
		] )
		.png()
		.toBuffer();
	const blurredShadow = await sharp( shadowLayer )
		.blur( blur / 2 )
		.png()
		.toBuffer();
	return sharp( backgroundSvg( width, height, background ) )
		.composite( [
			{ input: blurredShadow },
			{ input: rounded, left, top },
		] )
		.png()
		.toBuffer();
}

/**
 * The stage background as SVG: a CSS color string, or { gradient: [from, to], angle } for a linear gradient.
 * @param {number}        w
 * @param {number}        h
 * @param {string|Object} background
 * @return {Buffer} SVG
 */
export function backgroundSvg( w, h, background ) {
	if ( typeof background === 'string' ) {
		return Buffer.from(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${ w }" height="${ h }"><rect width="${ w }" height="${ h }" fill="${ background }"/></svg>`
		);
	}
	const [ from, to ] = background.gradient;
	const angle = background.angle ?? 180;
	// CSS-style angle: 0deg points up, 90deg points right. Convert to a unit vector for the gradient line.
	const rad = ( ( angle - 90 ) * Math.PI ) / 180;
	const dx = Math.cos( rad ) / 2;
	const dy = Math.sin( rad ) / 2;
	const x1 = 0.5 - dx;
	const y1 = 0.5 - dy;
	const x2 = 0.5 + dx;
	const y2 = 0.5 + dy;
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ w }" height="${ h }"><defs><linearGradient id="g" x1="${ x1 }" y1="${ y1 }" x2="${ x2 }" y2="${ y2 }"><stop offset="0" stop-color="${ from }"/><stop offset="1" stop-color="${ to }"/></linearGradient></defs><rect width="${ w }" height="${ h }" fill="url(#g)"/></svg>`
	);
}

function roundedMask( w, h, r ) {
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ w }" height="${ h }"><rect x="0" y="0" width="${ w }" height="${ h }" rx="${ r }" ry="${ r }" fill="#fff"/></svg>`
	);
}

function shadowRect( w, h, r, color ) {
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ w }" height="${ h }"><rect x="0" y="0" width="${ w }" height="${ h }" rx="${ r }" ry="${ r }" fill="${ color }"/></svg>`
	);
}

/**
 * Decode any image (file path or buffer) to raw RGBA.
 * @param {string|Buffer} input
 * @return {Promise<{data:Buffer,width:number,height:number}>} raw RGBA pixels and dimensions
 */
export async function decodeRaw( input ) {
	const { data, info } = await sharp( input )
		.ensureAlpha()
		.raw()
		.toBuffer( { resolveWithObject: true } );
	return { data, width: info.width, height: info.height };
}

/**
 * Compare two raw images. Returns { equal, diffPixels, diffPng } where diffPng is only built when asked.
 * @param {{data:Buffer,width:number,height:number}} a
 * @param {{data:Buffer,width:number,height:number}} b
 * @param {Object}                                   [options]
 * @param {boolean}                                  [options.withDiff]  build the diff PNG
 * @param {number}                                   [options.threshold] pixelmatch threshold
 */
export function compareRaw( a, b, options = {} ) {
	const { withDiff = false, threshold = 0 } = options;
	if ( a.width !== b.width || a.height !== b.height ) {
		return {
			equal: false,
			diffPixels: Infinity,
			sizeChanged: true,
			diffPng: null,
		};
	}
	const diff = withDiff ? Buffer.alloc( a.width * a.height * 4 ) : null;
	const diffPixels = pixelmatch( a.data, b.data, diff, a.width, a.height, {
		threshold,
		includeAA: true,
	} );
	return {
		equal: diffPixels === 0,
		diffPixels,
		sizeChanged: false,
		diff,
		width: a.width,
		height: a.height,
	};
}

export async function diffToPng( raw ) {
	return sharp( raw.diff, {
		raw: { width: raw.width, height: raw.height, channels: 4 },
	} )
		.png()
		.toBuffer();
}

export function pixelHash( raw ) {
	return crypto
		.createHash( 'sha256' )
		.update( `${ raw.width }x${ raw.height }:` )
		.update( raw.data )
		.digest( 'hex' )
		.slice( 0, 16 );
}

/**
 * Pixel-compare a freshly encoded image with the file on disk; `same` is true when nothing visible changed.
 * With `withDiff`, `cmp` carries the diff buffer (see compareRaw) so callers need not decode or compare again.
 * @param {Buffer}  encoded
 * @param {string}  file
 * @param {Object}  [options]
 * @param {boolean} [options.withDiff] keep the diff buffer on `cmp`
 */
export async function sameAsFile( encoded, file, options = {} ) {
	const { withDiff = false } = options;
	if ( ! fs.existsSync( file ) ) {
		return { same: false, existing: null, fresh: null, cmp: null };
	}
	const [ fresh, existing ] = await Promise.all( [
		decodeRaw( encoded ),
		decodeRaw( file ),
	] );
	const cmp = compareRaw( existing, fresh, { withDiff } );
	return {
		same: cmp.equal,
		existing,
		fresh,
		diffPixels: cmp.diffPixels,
		cmp,
	};
}
