import { resolveTarget, isFullViewport, waitForTarget } from './targets.js';
import { resolveLocator } from './locators.js';
import { applyAnnotations } from './annotate.js';
import { encode, frameCard } from './image.js';

/** Park the pointer, wait for fonts, network and layout to settle. */
export async function settle( ctx ) {
	const vp = ctx.page.viewportSize();
	// Bottom-right corner: (0,0) would hover the admin bar's WordPress menu.
	await ctx.page.mouse.move( vp.width - 1, vp.height - 1 );
	await ctx.page.evaluate( () => document.fonts?.ready ).catch( () => {} );
	try {
		if ( await ctx.page.locator( 'iframe[name="editor-canvas"]' ).count() ) {
			await ctx.editor.canvas.locator( 'body' ).evaluate( () => document.fonts?.ready );
			await ctx.editor.canvas.locator( 'img' ).evaluateAll( ( imgs ) =>
				Promise.all( imgs.map( ( i ) => ( i.complete ? null : new Promise( ( r ) => { i.onload = r; i.onerror = r; } ) ) ) )
			);
		}
	} catch ( e ) {
		// no canvas on this screen
	}
	await ctx.page
		.waitForLoadState( 'networkidle', { timeout: 8_000 } )
		.catch( () => ctx.log?.( '  warning: network did not go idle within 8s before capture (something keeps loading; check the image)' ) );
	await ctx.page.waitForTimeout( ctx.style.settleDelay );
}

function union( boxes ) {
	const xs1 = Math.min( ...boxes.map( ( b ) => b.x ) );
	const ys1 = Math.min( ...boxes.map( ( b ) => b.y ) );
	const xs2 = Math.max( ...boxes.map( ( b ) => b.x + b.width ) );
	const ys2 = Math.max( ...boxes.map( ( b ) => b.y + b.height ) );
	return { x: xs1, y: ys1, width: xs2 - xs1, height: ys2 - ys1 };
}

function padAndClamp( box, pad, vp ) {
	const x = Math.max( 0, box.x - pad );
	const y = Math.max( 0, box.y - pad );
	const right = Math.min( vp.width, box.x + box.width + pad );
	const bottom = Math.min( vp.height, box.y + box.height + pad );
	return { x: Math.floor( x ), y: Math.floor( y ), width: Math.ceil( right - x ), height: Math.ceil( bottom - y ) };
}

/**
 * Capture one shot from the current page state.
 * @param {object} ctx
 * @param {object} shot  normalised shot
 * @returns {Promise<{buffer:Buffer, width:number, height:number, clip:object|null}>}
 */
export async function captureShot( ctx, shot ) {
	const { capture } = shot;
	const style = ctx.style;
	const targetName = capture.target;
	const targetLocator = await resolveTarget( ctx, targetName );
	if ( targetLocator ) {
		await waitForTarget( ctx, targetName, targetLocator );
	}
	await settle( ctx );

	const boxes = [];
	if ( targetLocator ) {
		const box = await targetLocator.boundingBox();
		if ( ! box ) {
			throw new Error( `target "${ targetName }" has no bounding box` );
		}
		if ( capture.fit === 'content' ) {
			// Clip the bottom to the lowest visible descendant, so a tall panel does not drag empty space along.
			const bottom = await targetLocator.evaluate( ( el ) => {
				let max = 0;
				for ( const child of el.querySelectorAll( '*' ) ) {
					const r = child.getBoundingClientRect();
					if ( r.width > 0 && r.height > 0 && getComputedStyle( child ).visibility !== 'hidden' ) {
						max = Math.max( max, r.bottom );
					}
				}
				const own = el.getBoundingClientRect();
				return Math.min( own.bottom, max || own.bottom ) - own.top;
			} );
			box.height = Math.max( 1, bottom );
		}
		boxes.push( box );
	}
	for ( const inc of capture.include ) {
		const loc = await resolveTarget( ctx, inc );
		if ( ! loc ) {
			continue;
		}
		const box = await loc.boundingBox().catch( () => null );
		if ( box ) {
			boxes.push( box );
		}
	}

	const annotations = await applyAnnotations( ctx, capture.annotate, targetLocator );
	boxes.push( ...annotations.boxes );

	const masks = [];
	for ( const m of capture.mask ) {
		masks.push( await resolveLocator( ctx, m ) );
	}

	const vp = ctx.page.viewportSize();
	let clip = null;
	if ( ! isFullViewport( targetName ) && boxes.length ) {
		const wanted = union( boxes );
		clip = padAndClamp( wanted, capture.pad ?? style.pad, vp );
		const cutRight = wanted.x + wanted.width > vp.width + 0.5;
		const cutBottom = wanted.y + wanted.height > vp.height + 0.5;
		if ( cutRight || cutBottom || wanted.x < -0.5 || wanted.y < -0.5 ) {
			ctx.log?.( `  warning: target "${ targetName }" extends past the ${ cutBottom ? 'bottom' : 'edge' } of the viewport and is cut off; consider fit: content, a scrollTo step, or a taller viewport` );
		}
	}

	let png;
	try {
		png = await ctx.page.screenshot( {
			type: 'png',
			animations: 'disabled',
			caret: 'hide',
			scale: 'device',
			fullPage: false,
			...( clip ? { clip } : {} ),
			...( masks.length ? { mask: masks, maskColor: style.maskColor } : {} ),
		} );
	} finally {
		await annotations.remove();
	}

	const frame = capture.frame || style.frame;
	if ( frame === 'card' ) {
		png = await frameCard( png, style, style.deviceScaleFactor );
	}
	const { buffer, encoding } = await encode( png, style );
	const dims = clip
		? { width: Math.round( clip.width * style.deviceScaleFactor ), height: Math.round( clip.height * style.deviceScaleFactor ) }
		: { width: vp.width * style.deviceScaleFactor, height: vp.height * style.deviceScaleFactor };
	return { buffer, encoding, png, clip, ...dims };
}
