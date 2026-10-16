import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { stage, backgroundSvg, frameCard } from '../src/image.js';
import { mergeStyle, nearestFrame, frameNames } from '../src/style.js';

const style = mergeStyle();

async function png( width, height ) {
	return sharp( {
		create: { width, height, channels: 3, background: '#ffffff' },
	} )
		.png()
		.toBuffer();
}

describe( 'frames', () => {
	it( 'names the canonical ratios plus none, card and auto', () => {
		assert.deepEqual( frameNames( style ), [
			'none',
			'card',
			'auto',
			'wide',
			'standard',
			'portrait',
			'banner',
		] );
	} );

	it( 'picks the nearest ratio in log space', () => {
		assert.equal( nearestFrame( style, 1600, 900 ), 'wide' );
		assert.equal( nearestFrame( style, 800, 600 ), 'standard' );
		assert.equal( nearestFrame( style, 300, 400 ), 'portrait' );
		assert.equal( nearestFrame( style, 900, 300 ), 'banner' );
		// A tall inspector is nearer portrait than standard even though 1:2 is far from both.
		assert.equal( nearestFrame( style, 400, 800 ), 'portrait' );
	} );
} );

describe( 'stage', () => {
	it( 'grows the canvas to the requested ratio without scaling the content', async () => {
		const out = await stage( await png( 400, 400 ), 'wide', style, 1 );
		assert.equal( out.frame, 'wide' );
		// 400 + 2 * 40 margin = 480 tall; width = 480 * 16/9.
		assert.equal( out.height, 480 );
		assert.equal( out.width, Math.round( 480 * ( 16 / 9 ) ) );
		const meta = await sharp( out.buffer ).metadata();
		assert.equal( meta.width, out.width );
		assert.equal( meta.height, out.height );
		// The content sits centred: the pixel at the centre is still white.
		const { data } = await sharp( out.buffer )
			.extract( {
				left: Math.round( out.width / 2 ),
				top: Math.round( out.height / 2 ),
				width: 1,
				height: 1,
			} )
			.raw()
			.toBuffer( { resolveWithObject: true } );
		assert.deepEqual( [ ...data.slice( 0, 3 ) ], [ 255, 255, 255 ] );
	} );

	it( 'auto resolves to the nearest ratio and reports it', async () => {
		const out = await stage( await png( 300, 600 ), 'auto', style, 1 );
		assert.equal( out.frame, 'portrait' );
		assert.equal( out.width / out.height > 0.74, true );
		assert.equal( out.width / out.height < 0.76, true );
	} );

	it( 'scales the margin with the device scale factor', async () => {
		const out = await stage( await png( 160, 90 ), 'wide', style, 2 );
		assert.equal( out.height, 90 + 2 * 80 );
	} );

	it( 'is deterministic', async () => {
		const a = await stage( await png( 120, 80 ), 'standard', style, 1 );
		const b = await stage( await png( 120, 80 ), 'standard', style, 1 );
		assert.ok( a.buffer.equals( b.buffer ) );
	} );

	it( 'rejects an unknown frame', async () => {
		const input = await png( 10, 10 );
		await assert.rejects(
			() => stage( input, 'square', style, 1 ),
			/unknown frame "square"/
		);
	} );

	it( 'takes a solid colour or a gradient background', () => {
		assert.match(
			String( backgroundSvg( 10, 10, '#abcdef' ) ),
			/fill="#abcdef"/
		);
		const svg = String(
			backgroundSvg( 10, 10, { gradient: [ '#000', '#fff' ], angle: 90 } )
		);
		assert.match( svg, /linearGradient/ );
		assert.match( svg, /stop-color="#000"/ );
	} );

	it( 'frameCard still produces a content-sized card', async () => {
		const buffer = await frameCard( await png( 100, 50 ), style, 1 );
		const meta = await sharp( buffer ).metadata();
		assert.equal( meta.width, 100 + 2 * style.card.margin );
		assert.equal( meta.height, 50 + 2 * style.card.margin );
	} );
} );
