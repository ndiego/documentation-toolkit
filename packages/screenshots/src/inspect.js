/**
 * Inspect a screen instead of capturing it: run a shot's scene and steps exactly as a render would, then report
 * the visible interactive elements of its region by role and accessible name, the named region each sits in, the
 * region's accessibility tree, and optionally a small preview image. This is what an agent writing a recipe calls
 * to learn what the UI calls things before it annotates or clicks them.
 */
import sharp from 'sharp';
import { runScene } from './scenes.js';
import { runSetup } from './setup.js';
import { runSteps } from './actions.js';
import { settle } from './capture.js';
import { resolveTarget, waitForTarget, isFullViewport } from './targets.js';
import { resolveViewport } from './style.js';

/** The roles reported, in the order they are looked up. */
export const INSPECT_ROLES = [
	'button',
	'menuitem',
	'menuitemcheckbox',
	'menuitemradio',
	'tab',
	'link',
	'textbox',
	'searchbox',
	'combobox',
	'checkbox',
	'radio',
	'switch',
	'slider',
	'option',
];

/**
 * Named regions an element's `within` is chosen from: the innermost one that contains it. `inspector` and
 * `document-sidebar` resolve to the same element, so the first wins.
 */
export const WITHIN_REGIONS = [
	'block-toolbar',
	'inspector',
	'document-sidebar',
	'top-bar',
	'inserter',
	'list-view',
	'options-menu',
	'popover',
	'modal',
	'canvas',
	'site-editor-sidebar',
	'site-editor-canvas',
	'admin-menu',
	'admin-content',
];

export const MAX_ELEMENTS = 200;
export const MAX_SNAPSHOT = 20_000;
const PREVIEW_WIDTH = 800;

/**
 * Run a prepared shot's scene and steps on a warm session and describe what is on screen.
 * @param {Object}                                                                    config
 * @param {{spec: Object, tmp: string, id: string, alt: string, discard: () => void}} prepared          from prepareShot
 * @param {Object}                                                                    options
 * @param {import('./session.js').Session}                                            options.session   a booted session (required)
 * @param {boolean}                                                                   [options.preview] also return a PNG of the region, at most 800 px wide
 * @param {(msg:string)=>void}                                                        [options.log]
 * @return {Promise<{region: string, regions: string[], elements: {role: string, name: string, within: string|null}[], omitted: number, snapshot: string, snapshotTruncated: boolean, preview: Buffer|null}>} what the region holds
 */
export async function inspectShot( config, prepared, options = {} ) {
	const { session } = options;
	if ( ! session ) {
		prepared.discard();
		throw new Error( 'inspectShot needs an open session' );
	}
	const shot = prepared.spec.shots[ 0 ];
	try {
		await session.ensure();
		const ctx = { ...session.ctx, log: options.log || ( () => {} ) };
		const capture = await driveShot( ctx, config, shot );
		const targetName = capture.target || null;
		const target = await resolveTarget( ctx, targetName );
		if ( target ) {
			await waitForTarget( ctx, targetName, target );
		}
		await settle( ctx );

		const roots = [];
		if ( target ) {
			roots.push( target );
			for ( const inc of capture.include || [] ) {
				const loc = await resolveTarget( ctx, inc );
				if ( loc && ( await visible( loc ) ) ) {
					roots.push( loc );
				}
			}
		} else {
			roots.push( ctx.page.locator( 'body' ) );
			// Locators do not cross into the editor iframe; on an editor screen look inside it too.
			if (
				await ctx.page.locator( 'iframe[name="editor-canvas"]' ).count()
			) {
				roots.push( ctx.editor.canvas.locator( 'body' ) );
			}
		}

		const regions = await namedRegions( ctx );
		const raw = [];
		for ( const root of roots ) {
			raw.push( ...( await collect( root, regions ) ) );
		}
		await Promise.all(
			regions.map( ( r ) => r.handle.dispose().catch( () => {} ) )
		);
		const { elements, omitted } = finishElements( raw, MAX_ELEMENTS );

		const snapshots = [];
		for ( const root of roots ) {
			snapshots.push(
				await root
					.ariaSnapshot( { timeout: 10_000 } )
					.catch( ( e ) => `(no snapshot: ${ firstLine( e ) })` )
			);
		}
		const { text: snapshot, truncated: snapshotTruncated } =
			truncateSnapshot( snapshots.join( '\n' ), MAX_SNAPSHOT );

		let preview = null;
		if ( options.preview ) {
			const png = isFullViewport( targetName )
				? await ctx.page.screenshot( { type: 'png', caret: 'hide' } )
				: await target.screenshot( {
						type: 'png',
						caret: 'hide',
						animations: 'disabled',
					} );
			preview = await sharp( png )
				.resize( { width: PREVIEW_WIDTH, withoutEnlargement: true } )
				.png()
				.toBuffer();
		}
		return {
			region: targetName || 'viewport',
			regions: regions.map( ( r ) => r.name ),
			elements,
			omitted,
			snapshot,
			snapshotTruncated,
			preview,
		};
	} finally {
		// The page stays as the steps left it; the next shot runs its own scene. Content the shot created goes.
		try {
			await session.ctx?.site?.cleanup( () => {} );
		} catch {
			// cleanup is best effort; restart_environment resets the site
		}
		prepared.discard();
	}
}

/**
 * Setup, viewport, scene and steps, as runShots drives a shot before capturing it. runner.js inlines this in its
 * loop rather than exporting it, so it is restated here; keep the two in step (setup, templating, viewport, scene,
 * steps). Setup state is removed again by inspectShot's cleanup, as the runner does after a shot with setup.
 * @param {Object} ctx
 * @param {Object} config
 * @param {Object} shot   a normalised shot
 * @return {Promise<Object>} the shot's capture options with templates resolved
 */
async function driveShot( ctx, config, shot ) {
	ctx.pageErrors.length = 0;
	await runSetup( ctx, shot.setup, ctx.log );
	const resolved = await ctx.site.resolve( {
		steps: shot.steps,
		capture: shot.capture,
	} );
	const vp = resolveViewport( config.style, shot.viewport );
	if ( JSON.stringify( ctx.page.viewportSize() ) !== JSON.stringify( vp ) ) {
		await ctx.page.setViewportSize( vp );
	}
	await runScene( ctx, shot.scene );
	await runSteps( ctx, resolved.steps );
	return resolved.capture;
}

async function visible( locator ) {
	return ( await locator.count() ) > 0 && locator.isVisible();
}

/**
 * The named regions on screen right now, as element handles in the page frame.
 * @param {Object} ctx
 * @return {Promise<{name: string, handle: Object}[]>} visible regions, in WITHIN_REGIONS order
 */
async function namedRegions( ctx ) {
	const out = [];
	for ( const name of WITHIN_REGIONS ) {
		try {
			const loc = await resolveTarget( ctx, name );
			if ( ! ( await visible( loc ) ) ) {
				continue;
			}
			const handle = await loc.elementHandle( { timeout: 1_000 } );
			if ( handle ) {
				out.push( { name, handle } );
			}
		} catch {
			// not on this screen
		}
	}
	return out;
}

/**
 * Visible elements of every inspected role under `root`, with position, a fallback name and region.
 * @param {import('@playwright/test').Locator} root
 * @param {{name: string, handle: Object}[]}   regions
 * @return {Promise<Object[]>} raw entries for finishElements
 */
async function collect( root, regions ) {
	// Inside the editor iframe the page-frame regions cannot be compared against; everything there is canvas.
	const inCanvas = await root
		.evaluate( () => window.frameElement?.name === 'editor-canvas' )
		.catch( () => false );
	const out = [];
	for ( const role of INSPECT_ROLES ) {
		const all = root.getByRole( role );
		let found;
		try {
			found = await all.evaluateAll(
				( els, { regionList, canvas } ) =>
					els.map( ( el ) => {
						const r = el.getBoundingClientRect();
						const style = window.getComputedStyle( el );
						// Not just "visible" to Playwright: WordPress hides skip links and focus-only buttons by clipping
						// them to 1×1 or parking them far above or left of the page, and they are not on screen.
						const clipped =
							style.clipPath === 'inset(50%)' ||
							/^rect\((0|1)px/.test( style.clip );
						const shown =
							r.width > 1 &&
							r.height > 1 &&
							r.bottom > 0 &&
							r.right > 0 &&
							! clipped &&
							style.visibility !== 'hidden' &&
							( ! el.checkVisibility || el.checkVisibility() );
						let within = canvas ? 'canvas' : null;
						let best = null;
						for ( const [ name, region ] of regionList ) {
							if (
								region.contains( el ) &&
								( ! best || best.contains( region ) ) &&
								best !== region
							) {
								best = region;
								within = name;
							}
						}
						const byIds = (
							el.getAttribute( 'aria-labelledby' ) || ''
						)
							.split( /\s+/ )
							.map(
								( id ) =>
									document.getElementById( id )?.textContent
							)
							.filter( Boolean )
							.join( ' ' );
						const name =
							byIds ||
							el.getAttribute( 'aria-label' ) ||
							[ ...( el.labels || [] ) ]
								.map( ( l ) => l.textContent )
								.join( ' ' ) ||
							el.innerText ||
							el.getAttribute( 'title' ) ||
							el.getAttribute( 'placeholder' ) ||
							'';
						return {
							shown,
							x: r.x,
							y: r.y,
							name,
							within,
						};
					} ),
				{
					regionList: inCanvas
						? []
						: regions.map( ( r ) => [ r.name, r.handle ] ),
					canvas: inCanvas,
				}
			);
		} catch {
			continue;
		}
		for ( const [ i, el ] of found.entries() ) {
			if ( ! el.shown ) {
				continue;
			}
			// Playwright's own accessible name, the one getByRole matches against; the DOM guess is the fallback.
			const line = await all
				.nth( i )
				.ariaSnapshot( { timeout: 2_000 } )
				.catch( () => '' );
			const parsed = parseAriaLine( line.split( '\n' )[ 0 ] );
			out.push( {
				role,
				name:
					parsed && parsed.role === role && parsed.name !== null
						? parsed.name
						: el.name,
				within: el.within,
				x: el.x,
				y: el.y,
			} );
		}
	}
	return out;
}

/**
 * Parse the first line of an aria snapshot: `- button "Options" [expanded]` → { role: 'button', name: 'Options' }.
 * @param {string} line
 * @return {{role: string, name: string|null}|null} role and name (null when unnamed), or null if not a node line
 */
export function parseAriaLine( line ) {
	let s = String( line || '' ).trim();
	if ( ! s.startsWith( '- ' ) ) {
		return null;
	}
	s = s.slice( 2 );
	// YAML quotes the whole key in single quotes when it holds characters such as ": ".
	if ( s.startsWith( "'" ) ) {
		const end = s.lastIndexOf( "'" );
		s = s.slice( 1, end > 0 ? end : undefined ).replace( /''/g, "'" );
	}
	const m = /^([a-z]+)(?:\s+("(?:[^"\\]|\\.)*"))?/.exec( s );
	if ( ! m ) {
		return null;
	}
	let name = null;
	if ( m[ 2 ] ) {
		try {
			name = JSON.parse( m[ 2 ] );
		} catch {
			name = m[ 2 ].slice( 1, -1 );
		}
	}
	return { role: m[ 1 ], name };
}

/**
 * Normalise, order (top to bottom, then left to right), de-duplicate and cap the collected elements.
 * @param {{role: string, name: string, within: string|null, x: number, y: number}[]} raw
 * @param {number}                                                                    [max]
 * @return {{elements: {role: string, name: string, within: string|null}[], omitted: number}} the list, and how many were left out over the cap
 */
export function finishElements( raw, max = MAX_ELEMENTS ) {
	const sorted = [ ...raw ].sort(
		( a, b ) =>
			Math.round( a.y ) - Math.round( b.y ) ||
			Math.round( a.x ) - Math.round( b.x )
	);
	const seen = new Set();
	const unique = [];
	for ( const e of sorted ) {
		const name = String( e.name ?? '' )
			.replace( /\s+/g, ' ' )
			.trim()
			.slice( 0, 120 );
		const within = e.within ?? null;
		const key = JSON.stringify( [ e.role, name, within ] );
		if ( seen.has( key ) ) {
			continue;
		}
		seen.add( key );
		unique.push( { role: e.role, name, within } );
	}
	return {
		elements: unique.slice( 0, max ),
		omitted: Math.max( 0, unique.length - max ),
	};
}

/**
 * Cut a snapshot to at most `max` characters on a line boundary.
 * @param {string} text
 * @param {number} [max]
 * @return {{text: string, truncated: boolean}} the text and whether it was cut
 */
export function truncateSnapshot( text, max = MAX_SNAPSHOT ) {
	const s = String( text ?? '' );
	if ( s.length <= max ) {
		return { text: s, truncated: false };
	}
	const cut = s.slice( 0, max );
	const nl = cut.lastIndexOf( '\n' );
	return { text: nl > 0 ? cut.slice( 0, nl ) : cut, truncated: true };
}

function firstLine( e ) {
	return String( e?.message || e ).split( '\n' )[ 0 ];
}
