/**
 * Annotations are drawn into the top document as a fixed overlay built from element bounding boxes, so they
 * follow the real UI and work for elements inside the editor canvas iframe (frame boxes are page-relative).
 */
import { resolveLocator } from './locators.js';
import { resolveTarget } from './targets.js';

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
	// `label` and `position` style the badge; everything else is the locator key.
	const { type, self, target, label, position, ...key } = annotation;
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
 */
export async function applyAnnotations( ctx, annotations, targetLocator ) {
	if ( ! annotations.length ) {
		return { boxes: [], remove: async () => {} };
	}
	const style = ctx.style;
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
					Object.assign( el.style, {
						position: 'absolute',
						left: `${ box.x - inset }px`,
						top: `${ box.y - inset }px`,
						width: `${ box.width + inset * 2 }px`,
						height: `${ box.height + inset * 2 }px`,
						border: `${ o.width }px solid ${ o.color }`,
						borderRadius: `${ o.radius + o.gap }px`,
						boxSizing: 'border-box',
					} );
					layer.appendChild( el );
					extents.push( {
						x: box.x - inset,
						y: box.y - inset,
						width: box.width + inset * 2,
						height: box.height + inset * 2,
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
					} );
					el.textContent = item.label;
					layer.appendChild( el );
					extents.push( { x, y, width: b.size, height: b.size } );
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
			style: {
				outline: style.outline,
				badge: style.badge,
				dim: style.dim,
			},
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
