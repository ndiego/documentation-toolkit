import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStyle, mergeStyle, resolveViewport } from '../src/style.js';

describe( 'defaultStyle', () => {
	it( 'carries the house tokens the engine relies on', () => {
		assert.deepEqual( Object.keys( defaultStyle.viewports ), [
			'desktop',
			'narrow',
			'mobile',
		] );
		assert.deepEqual( defaultStyle.viewports.desktop, {
			width: 1440,
			height: 900,
		} );
		assert.equal( defaultStyle.deviceScaleFactor, 2 );
		assert.equal( defaultStyle.format, 'webp' );
		assert.deepEqual( defaultStyle.webp, {
			lossless: true,
			effort: 6,
			maxBytes: 300 * 1024,
			quality: 90,
		} );
		assert.deepEqual( defaultStyle.png, { compressionLevel: 9 } );
		assert.equal( defaultStyle.clock, null );
		assert.equal( defaultStyle.frame, 'none' );
	} );
} );

describe( 'mergeStyle', () => {
	it( 'returns a deep copy of the defaults when given nothing', () => {
		const style = mergeStyle();
		assert.deepEqual( style, defaultStyle );
		assert.notEqual( style, defaultStyle );
		style.outline.color = 'changed';
		style.viewports.desktop.width = 1;
		assert.equal( defaultStyle.outline.color, '#3858e9' );
		assert.equal( defaultStyle.viewports.desktop.width, 1440 );
	} );

	it( 'replaces scalars, including falsy ones', () => {
		const style = mergeStyle( {
			pad: 0,
			fullscreenMode: false,
			settleDelay: 0,
			clock: '2025-01-01T09:00:00Z',
			colorScheme: 'dark',
		} );
		assert.equal( style.pad, 0 );
		assert.equal( style.fullscreenMode, false );
		assert.equal( style.settleDelay, 0 );
		assert.equal( style.clock, '2025-01-01T09:00:00Z' );
		assert.equal( style.colorScheme, 'dark' );
	} );

	it( 'merges nested token groups one level deep, keeping untouched siblings', () => {
		const style = mergeStyle( {
			outline: { color: 'red' },
			badge: { size: 32 },
			card: { shadow: { blur: 1 } },
		} );
		assert.deepEqual( style.outline, {
			color: 'red',
			width: 3,
			radius: 4,
			gap: 4,
			halo: { color: '#ffffff', width: 2 },
		} );
		assert.equal( style.badge.size, 32 );
		assert.equal( style.badge.background, '#3858e9' );
		// Only one level: a nested object inside a group replaces the whole sub-object.
		assert.deepEqual( style.card.shadow, { blur: 1 } );
		assert.equal( style.card.margin, 36 );
	} );

	it( 'adds and overrides viewports without dropping the built-in ones', () => {
		const style = mergeStyle( {
			viewports: {
				wide: { width: 1920, height: 1080 },
				mobile: { width: 375, height: 812 },
			},
		} );
		assert.deepEqual( Object.keys( style.viewports ), [
			'desktop',
			'narrow',
			'mobile',
			'wide',
		] );
		assert.deepEqual( style.viewports.mobile, { width: 375, height: 812 } );
		assert.deepEqual(
			style.viewports.desktop,
			defaultStyle.viewports.desktop
		);
	} );

	it( 'handles the output format and encoder options', () => {
		assert.equal( mergeStyle( { format: 'png' } ).format, 'png' );
		const lossless = mergeStyle( { webp: { maxBytes: null } } );
		assert.deepEqual( lossless.webp, {
			lossless: true,
			effort: 6,
			maxBytes: null,
			quality: 90,
		} );
		const lossy = mergeStyle( { webp: { lossless: false, quality: 80 } } );
		assert.deepEqual( lossy.webp, {
			lossless: false,
			effort: 6,
			maxBytes: 300 * 1024,
			quality: 80,
		} );
		assert.deepEqual( mergeStyle( { png: { compressionLevel: 6 } } ).png, {
			compressionLevel: 6,
		} );
	} );

	it( 'replaces, rather than merges, array values and passes unknown keys through', () => {
		const style = mergeStyle( { custom: [ 1, 2 ], extra: { a: 1 } } );
		assert.deepEqual( style.custom, [ 1, 2 ] );
		assert.deepEqual( style.extra, { a: 1 } );
	} );

	it( 'does not mutate the overrides object', () => {
		const overrides = { outline: { color: 'red' } };
		mergeStyle( overrides );
		assert.deepEqual( overrides, { outline: { color: 'red' } } );
	} );
} );

describe( 'resolveViewport', () => {
	const style = mergeStyle( {
		viewports: { wide: { width: 1920, height: 1080 } },
	} );

	it( 'resolves names, defaulting to desktop', () => {
		assert.deepEqual( resolveViewport( style ), {
			width: 1440,
			height: 900,
		} );
		assert.deepEqual( resolveViewport( style, 'mobile' ), {
			width: 390,
			height: 844,
		} );
		assert.deepEqual( resolveViewport( style, 'wide' ), {
			width: 1920,
			height: 1080,
		} );
	} );

	it( 'accepts an explicit size and strips extra keys', () => {
		assert.deepEqual(
			resolveViewport( style, { width: 800, height: 600, label: 'x' } ),
			{ width: 800, height: 600 }
		);
	} );

	it( 'lists the known names for an unknown viewport', () => {
		assert.throws(
			() => resolveViewport( style, 'tablet' ),
			/Unknown viewport "tablet"\. Known: desktop, narrow, mobile, wide/
		);
	} );
} );
