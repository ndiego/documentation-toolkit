/**
 * Annotations are drawn into the top document as a fixed overlay built from element bounding boxes, so they
 * follow the real UI and work for elements inside the editor canvas iframe (frame boxes are page-relative).
 */
import { resolveLocator } from './locators.js';
import { resolveTarget } from './targets.js';
import { scaledAnnotationStyle } from './style.js';

const OVERLAY_ID = 'wp-screenshots-overlay';

/**
 * Resolve the bounding box an annotation refers to.
 * `{ outline: self }` refers to the capture target; `{ outline: { target: inspector } }` to a named target;
 * anything else is a locator key.
 * @param {Object}                                  ctx
 * @param {Object|string}                           annotation
 * @param {import('@playwright/test').Locator|null} targetLocator
 */
async function boxFor( ctx, annotation, targetLocator ) {
	// `label` and `position` style the badge, `from` the arrow; everything else is the locator key.
	const { type, self, target, label, position, from, ...key } = annotation;
	let loc;
	if ( self ) {
		loc = targetLocator;
	} else if ( target ) {
		loc = await resolveTarget( ctx, target );
	} else {
		loc = await resolveLocator( ctx, key );
	}
	if ( ! loc ) {
		throw new Error(
			`${ type }: cannot annotate the whole viewport; give it a locator`
		);
	}
	await loc.waitFor( { state: 'visible' } );
	const box = await loc.boundingBox();
	if ( ! box ) {
		throw new Error(
			`${ type }: element has no bounding box (${ JSON.stringify( key ) })`
		);
	}
	return box;
}

/**
 * Draw the annotations. Returns { boxes, remove } where boxes are the drawn extents (for clip computation).
 * @param {Object}                                  ctx
 * @param {object[]}                                annotations   normalised { type, ...locatorKey }
 * @param {import('@playwright/test').Locator|null} targetLocator
 * @param {number}                                  [scale]       size multiplier (see annotationScaleFor)
 */
export async function applyAnnotations(
	ctx,
	annotations,
	targetLocator,
	scale = 1
) {
	if ( ! annotations.length ) {
		return { boxes: [], remove: async () => {} };
	}
	const style = ctx.style;
	const tokens = scaledAnnotationStyle( style, scale );
	const items = [];
	let badgeCounter = 0;
	for ( const a of annotations ) {
		const box = await boxFor( ctx, a, targetLocator );
		if ( a.type === 'badge' ) {
			badgeCounter += 1;
		}
		items.push( {
			type: a.type,
			box,
			label:
				a.label !== undefined
					? String( a.label )
					: String( badgeCounter ),
			position: a.position || style.badge.position,
			from: a.from || style.arrow.from,
		} );
	}
	const boxes = await ctx.page.evaluate(
		( { id, items: list, style: s } ) => {
			document.getElementById( id )?.remove();
			const layer = document.createElement( 'div' );
			layer.id = id;
			Object.assign( layer.style, {
				position: 'fixed',
				inset: '0',
				pointerEvents: 'none',
				zIndex: '2147483647',
			} );
			const extents = [];
			for ( const item of list ) {
				const { box } = item;
				if ( item.type === 'outline' ) {
					const o = s.outline;
					const el = document.createElement( 'div' );
					const inset = o.gap + o.width;
					const halo = o.halo?.width || 0;
					Object.assign( el.style, {
						position: 'absolute',
						left: `${ box.x - inset }px`,
						top: `${ box.y - inset }px`,
						width: `${ box.width + inset * 2 }px`,
						height: `${ box.height + inset * 2 }px`,
						border: `${ o.width }px solid ${ o.color }`,
						borderRadius: `${ o.radius + o.gap }px`,
						boxSizing: 'border-box',
						// A light ring on both sides of the stroke keeps it legible over the editor's own blue outline.
						...( halo
							? {
									outline: `${ halo }px solid ${ o.halo.color }`,
									boxShadow: `inset 0 0 0 ${ halo }px ${ o.halo.color }`,
								}
							: {} ),
					} );
					layer.appendChild( el );
					extents.push( {
						x: box.x - inset - halo,
						y: box.y - inset - halo,
						width: box.width + ( inset + halo ) * 2,
						height: box.height + ( inset + halo ) * 2,
					} );
				} else if ( item.type === 'badge' ) {
					const b = s.badge;
					const el = document.createElement( 'div' );
					const half = b.size / 2;
					const [ v, h ] = item.position.split( '-' );
					const x =
						h === 'right' ? box.x + box.width - half : box.x - half;
					const y =
						v === 'bottom'
							? box.y + box.height - half
							: box.y - half;
					Object.assign( el.style, {
						position: 'absolute',
						left: `${ x }px`,
						top: `${ y }px`,
						width: `${ b.size }px`,
						height: `${ b.size }px`,
						borderRadius: '50%',
						background: b.background,
						color: b.color,
						font: b.font,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
						...( b.halo?.width
							? {
									outline: `${ b.halo.width }px solid ${ b.halo.color }`,
								}
							: {} ),
					} );
					el.textContent = item.label;
					layer.appendChild( el );
					const bh = b.halo?.width || 0;
					extents.push( {
						x: x - bh,
						y: y - bh,
						width: b.size + bh * 2,
						height: b.size + bh * 2,
					} );
				} else if ( item.type === 'arrow' ) {
					const a = s.arrow;
					// Unit direction the arrow travels (towards the target) and the point on the box it aims at.
					const dirs = {
						top: [ 0, 1 ],
						bottom: [ 0, -1 ],
						left: [ 1, 0 ],
						right: [ -1, 0 ],
						'top-left': [ 1, 1 ],
						'top-right': [ -1, 1 ],
						'bottom-left': [ 1, -1 ],
						'bottom-right': [ -1, -1 ],
					};
					const [ ux, uy ] = dirs[ item.from ] || dirs[ 'top-right' ];
					const norm = Math.hypot( ux, uy );
					const dx = ux / norm;
					const dy = uy / norm;
					const cx = box.x + box.width / 2;
					const cy = box.y + box.height / 2;
					// Aim point: edge midpoint for cardinal directions, the corner for diagonals.
					let ax = cx;
					if ( dx > 0 ) {
						ax = box.x;
					} else if ( dx < 0 ) {
						ax = box.x + box.width;
					}
					let ay = cy;
					if ( dy > 0 ) {
						ay = box.y;
					} else if ( dy < 0 ) {
						ay = box.y + box.height;
					}
					const tipX = ax - dx * a.gap;
					const tipY = ay - dy * a.gap;
					const tailX = tipX - dx * a.length;
					const tailY = tipY - dy * a.length;
					// The shaft ends where the head begins.
					const shaftX = tipX - dx * a.head;
					const shaftY = tipY - dy * a.head;
					const px = -dy;
					const py = dx;
					const half = a.head * 0.55;
					const head = [
						[ tipX, tipY ],
						[ shaftX + px * half, shaftY + py * half ],
						[ shaftX - px * half, shaftY - py * half ],
					]
						.map( ( pt ) =>
							pt.map( ( v ) => v.toFixed( 2 ) ).join( ',' )
						)
						.join( ' ' );
					const halo = a.halo?.width || 0;
					const svgNS = 'http://www.w3.org/2000/svg';
					const svg = document.createElementNS( svgNS, 'svg' );
					Object.assign( svg.style, {
						position: 'absolute',
						inset: '0',
						width: '100%',
						height: '100%',
						overflow: 'visible',
					} );
					const draw = ( color, extra ) => {
						const line = document.createElementNS( svgNS, 'line' );
						line.setAttribute( 'x1', tailX.toFixed( 2 ) );
						line.setAttribute( 'y1', tailY.toFixed( 2 ) );
						line.setAttribute( 'x2', shaftX.toFixed( 2 ) );
						line.setAttribute( 'y2', shaftY.toFixed( 2 ) );
						line.setAttribute( 'stroke', color );
						line.setAttribute(
							'stroke-width',
							String( a.width + extra * 2 )
						);
						line.setAttribute( 'stroke-linecap', 'round' );
						svg.appendChild( line );
						const poly = document.createElementNS(
							svgNS,
							'polygon'
						);
						poly.setAttribute( 'points', head );
						poly.setAttribute( 'fill', color );
						poly.setAttribute( 'stroke', color );
						poly.setAttribute(
							'stroke-width',
							String( extra * 2 )
						);
						poly.setAttribute( 'stroke-linejoin', 'round' );
						svg.appendChild( poly );
					};
					if ( halo ) {
						draw( a.halo.color, halo );
					}
					draw( a.color, 0 );
					layer.appendChild( svg );
					const xs = [
						tailX,
						tipX,
						shaftX + px * half,
						shaftX - px * half,
					];
					const ys = [
						tailY,
						tipY,
						shaftY + py * half,
						shaftY - py * half,
					];
					const reach = a.width + halo;
					extents.push( {
						x: Math.min( ...xs ) - reach,
						y: Math.min( ...ys ) - reach,
						width:
							Math.max( ...xs ) - Math.min( ...xs ) + reach * 2,
						height:
							Math.max( ...ys ) - Math.min( ...ys ) + reach * 2,
					} );
					// The target itself must stay in the crop too.
					extents.push( box );
				} else if ( item.type === 'dim' ) {
					const el = document.createElement( 'div' );
					Object.assign( el.style, {
						position: 'absolute',
						left: `${ box.x }px`,
						top: `${ box.y }px`,
						width: `${ box.width }px`,
						height: `${ box.height }px`,
						boxShadow: `0 0 0 200vmax ${ s.dim.color }`,
						borderRadius: `${ s.outline.radius }px`,
					} );
					layer.appendChild( el );
					extents.push( box );
				}
			}
			document.body.appendChild( layer );
			return extents;
		},
		{
			id: OVERLAY_ID,
			items,
			style: tokens,
		}
	);
	return {
		boxes,
		remove: async () => {
			await ctx.page
				.evaluate(
					( id ) => document.getElementById( id )?.remove(),
					OVERLAY_ID
				)
				.catch( () => {} );
		},
	};
}
