/**
 * Semantic locator keys → Playwright locators.
 *
 *   "Replace"                              → button named exactly "Replace"
 *   { button: "Replace" }                  → role button
 *   { control: "Alternative text" }        → form control by label
 *   { menuitem: "Edit as HTML" }           → role menuitem / menuitemcheckbox / menuitemradio
 *   { tab: "Styles" } { link: ... } { option: ... }
 *   { text: "Settings" }                   → getByText
 *   { placeholder: "Search" }              → getByPlaceholder
 *   { role: "searchbox", name: "Search" }  → any role
 *   { selector: ".css" }                   → CSS/XPath
 *   { block: "core/image", nth: 0 }        → block wrapper in the editor canvas
 *
 * Names match the whole accessible name, case-sensitively (`exact: true`), because substring matching picks
 * the wrong control too easily ("Add" vs "Add image"). Set `exact: false` to match a substring.
 * Modifiers: `nth: n`, `within: <target name or selector>`, `in: page|canvas|auto` (default auto: the page
 * document and the editor canvas iframe are both watched until one has a match).
 */
import { resolveTarget } from './targets.js';

export const NAME_KEYS = [
	'button',
	'link',
	'tab',
	'option',
	'menuitem',
	'control',
	'placeholder',
	'text',
];
export const OTHER_KEYS = [ 'role', 'name', 'selector', 'block' ];
export const MODIFIER_KEYS = [ 'exact', 'nth', 'within', 'in' ];
export const LOCATOR_KEYS = [ ...NAME_KEYS, ...OTHER_KEYS, ...MODIFIER_KEYS ];

export function describeKey( key ) {
	if ( typeof key === 'string' ) {
		return `button "${ key }"`;
	}
	const { exact, nth, within, in: where, ...rest } = key;
	const [ k, v ] = Object.entries( rest )[ 0 ] || [ 'locator', '?' ];
	const name =
		k === 'role'
			? `${ v }${ rest.name ? ` "${ rest.name }"` : '' }`
			: `${ k } "${ v }"`;
	return `${ name }${ within ? ` within ${ within }` : '' }${ nth !== undefined ? ` (nth ${ nth })` : '' }`;
}

/**
 * Validate a locator key at spec-load time. Returns an error message or null.
 * @param {string|Object} key
 */
export function validateLocatorKey( key ) {
	if ( typeof key === 'string' ) {
		return null;
	}
	if ( ! key || typeof key !== 'object' ) {
		return 'a locator must be a string (button name) or a mapping like { button: Replace }';
	}
	const unknown = Object.keys( key ).filter(
		( k ) => ! LOCATOR_KEYS.includes( k )
	);
	if ( unknown.length ) {
		return `unknown locator key "${ unknown[ 0 ] }". Use one of: ${ [ ...NAME_KEYS, 'role (+name)', 'selector', 'block' ].join( ', ' ) }; modifiers: ${ MODIFIER_KEYS.join( ', ' ) }`;
	}
	const main = Object.keys( key ).filter(
		( k ) => ! MODIFIER_KEYS.includes( k ) && k !== 'name'
	);
	if ( main.length !== 1 ) {
		return `a locator needs exactly one of ${ [ ...NAME_KEYS, 'role', 'selector', 'block' ].join( ', ' ) } (got ${ main.join( ', ' ) || 'none' })`;
	}
	return null;
}

/**
 * @param {Object}            ctx
 * @param {string|object}     key
 * @param {{timeout?:number}} [opts]
 * @return {Promise<import('@playwright/test').Locator>} the first matching locator
 */
export async function resolveLocator( ctx, key, opts = {} ) {
	const problem = validateLocatorKey( key );
	if ( problem ) {
		throw new Error( problem );
	}
	const spec = typeof key === 'string' ? { button: key } : { ...key };
	const where = spec.in || 'auto';
	const nth = spec.nth;
	const within = spec.within;
	delete spec.in;
	delete spec.nth;
	delete spec.within;

	if ( spec.block ) {
		const loc = ctx.editor.canvas.locator(
			`[data-type="${ spec.block }"]`
		);
		return nth !== undefined ? loc.nth( nth ) : loc.first();
	}

	let roots;
	if ( within ) {
		const scope = await resolveTarget( ctx, within );
		if ( ! scope ) {
			throw new Error(
				`within: "${ within }" is the whole viewport; name a region or selector instead`
			);
		}
		roots = [ scope ];
	} else if ( where === 'page' ) {
		roots = [ ctx.page ];
	} else if ( where === 'canvas' ) {
		roots = [ ctx.editor.canvas ];
	} else {
		roots = [ ctx.page, ctx.editor.canvas ];
	}

	// Poll every root until one has a match (menus and popovers appear a moment after the click that opens them).
	const timeout = opts.timeout ?? 10_000;
	const deadline = Date.now() + timeout;
	while ( Date.now() <= deadline ) {
		for ( const root of roots ) {
			for ( const loc of build( root, spec ) ) {
				try {
					if ( ( await loc.count() ) > 0 ) {
						return nth !== undefined ? loc.nth( nth ) : loc.first();
					}
				} catch {
					// the canvas frame may not exist on admin screens
				}
			}
		}
		await new Promise( ( r ) => setTimeout( r, 150 ) );
	}
	throw new Error(
		`no ${ describeKey( key ) } found${ within ? '' : ' in the page or the editor canvas' } after ${ timeout / 1000 }s.${ await hint( ctx, spec, roots ) }`
	);
}

function build( root, spec ) {
	const exact = spec.exact ?? true;
	if ( spec.button !== undefined ) {
		return [ root.getByRole( 'button', { name: spec.button, exact } ) ];
	}
	if ( spec.link !== undefined ) {
		return [ root.getByRole( 'link', { name: spec.link, exact } ) ];
	}
	if ( spec.tab !== undefined ) {
		return [ root.getByRole( 'tab', { name: spec.tab, exact } ) ];
	}
	if ( spec.option !== undefined ) {
		return [ root.getByRole( 'option', { name: spec.option, exact } ) ];
	}
	if ( spec.menuitem !== undefined ) {
		return [
			root.getByRole( 'menuitem', { name: spec.menuitem, exact } ),
			root.getByRole( 'menuitemcheckbox', {
				name: spec.menuitem,
				exact,
			} ),
			root.getByRole( 'menuitemradio', { name: spec.menuitem, exact } ),
		];
	}
	if ( spec.control !== undefined ) {
		return [ root.getByLabel( spec.control, { exact } ) ];
	}
	if ( spec.placeholder !== undefined ) {
		return [ root.getByPlaceholder( spec.placeholder, { exact } ) ];
	}
	if ( spec.text !== undefined ) {
		return [ root.getByText( spec.text, { exact } ) ];
	}
	if ( spec.role !== undefined ) {
		const o = {};
		if ( spec.name !== undefined ) {
			o.name = spec.name;
			o.exact = exact;
		}
		return [ root.getByRole( spec.role, o ) ];
	}
	if ( spec.selector !== undefined ) {
		return [ root.locator( spec.selector ) ];
	}
	throw new Error( `Unrecognised locator key: ${ JSON.stringify( spec ) }` );
}

/**
 * List visible candidates of the same role so the writer can see what the UI actually calls the thing.
 * @param {Object}   ctx
 * @param {Object}   spec
 * @param {Object[]} roots
 */
async function hint( ctx, spec, roots ) {
	const role =
		[ 'button', 'link', 'tab', 'option', 'menuitem' ].find(
			( r ) => spec[ r ] !== undefined
		) || ( spec.role && typeof spec.role === 'string' ? spec.role : null );
	if ( ! role ) {
		return '';
	}
	const names = new Set();
	for ( const root of roots ) {
		try {
			const all = root.getByRole( role );
			const n = Math.min( await all.count(), 60 );
			for ( let i = 0; i < n; i++ ) {
				const el = all.nth( i );
				if ( await el.isVisible().catch( () => false ) ) {
					const name = (
						await el.evaluate(
							( e ) =>
								e.getAttribute( 'aria-label' ) ||
								e.textContent ||
								''
						)
					)
						.trim()
						.replace( /\s+/g, ' ' );
					if ( name ) {
						names.add( name.slice( 0, 40 ) );
					}
				}
			}
		} catch {
			// ignore
		}
	}
	if ( ! names.size ) {
		return '';
	}
	return ` Visible ${ role }s right now: ${ [ ...names ]
		.slice( 0, 25 )
		.map( ( n ) => `"${ n }"` )
		.join( ', ' ) }.`;
}
