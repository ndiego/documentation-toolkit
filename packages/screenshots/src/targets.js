/**
 * Named capture targets. One registry so that a Gutenberg class rename is fixed in one place.
 * A target resolves to a Playwright Locator, or to `null` for "the whole viewport".
 *
 * A target string is either a known name, `inspector-panel:<Panel name>`, or a CSS selector. To keep typos
 * from silently becoming selectors, a selector must look like one: start with `.`, `#`, `[` or contain a
 * space, `>` or `:` (e.g. `#the-list tr:first-child`).
 */

const FULL_VIEWPORT = new Set( [
	'editor',
	'admin-screen',
	'front',
	'viewport',
	'page',
] );

const registry = {
	canvas: ( ctx ) => ctx.page.locator( 'iframe[name="editor-canvas"]' ),
	'selected-block': ( ctx ) =>
		ctx.editor.canvas
			.locator( '.block-editor-block-list__block.is-selected' )
			.first(),
	'block-toolbar': ( ctx ) =>
		ctx.page
			.locator(
				'.block-editor-block-contextual-toolbar, .block-editor-block-toolbar'
			)
			.first(),
	inspector: ( ctx ) =>
		ctx.page
			.locator( '.interface-complementary-area, .editor-sidebar' )
			.first(),
	'document-sidebar': ( ctx ) =>
		ctx.page
			.locator( '.interface-complementary-area, .editor-sidebar' )
			.first(),
	inserter: ( ctx ) =>
		ctx.page
			.locator(
				'.editor-inserter-sidebar, .block-editor-inserter__main-area, .block-editor-inserter__quick-inserter'
			)
			.first(),
	'list-view': ( ctx ) =>
		ctx.page
			.locator(
				'.editor-list-view-sidebar, .edit-post-editor__list-view-panel'
			)
			.first(),
	'top-bar': ( ctx ) =>
		ctx.page
			.locator(
				'.editor-header, .edit-post-header, .edit-site-header-edit-mode'
			)
			.first(),
	'options-menu': ( ctx ) =>
		ctx.page
			.locator( '.components-dropdown-menu__menu, [role="menu"]' )
			.last(),
	popover: ( ctx ) =>
		ctx.page
			.locator( '.components-popover:not(.block-editor-block-popover)' )
			.last(),
	modal: ( ctx ) => ctx.page.locator( '.components-modal__frame' ).last(),
	'site-editor-sidebar': ( ctx ) =>
		ctx.page
			.locator(
				'.edit-site-layout__sidebar-region, .edit-site-layout__sidebar, .edit-site-sidebar__screen-wrapper'
			)
			.first(),
	'site-editor-canvas': ( ctx ) =>
		ctx.page
			.locator(
				'.edit-site-layout__canvas-container, .edit-site-layout__canvas, .edit-site-visual-editor'
			)
			.first(),
	'admin-content': ( ctx ) => ctx.page.locator( '#wpbody-content' ),
	'admin-menu': ( ctx ) => ctx.page.locator( '#adminmenuwrap' ),
};

export function looksLikeSelector( name ) {
	return /^[.#\[]/.test( name ) || /[\s>:*]/.test( name );
}

/**
 * Validate a target string at spec-load time. Returns an error message or null.
 * @param {string} name
 */
export function validateTargetName( name ) {
	if ( name === null || name === undefined ) {
		return null;
	}
	if ( typeof name !== 'string' ) {
		return 'target must be a string';
	}
	if (
		FULL_VIEWPORT.has( name ) ||
		registry[ name ] ||
		name.startsWith( 'inspector-panel:' ) ||
		looksLikeSelector( name )
	) {
		return null;
	}
	return `unknown target "${ name }". Known targets: ${ targetNames.join( ', ' ) }. A CSS selector must start with ".", "#" or "[".`;
}

/**
 * @param {Object}                ctx
 * @param {string|null|undefined} name
 * @return {Promise<import('@playwright/test').Locator|null>} the locator, or null for the whole viewport
 */
export async function resolveTarget( ctx, name ) {
	if ( ! name || FULL_VIEWPORT.has( name ) ) {
		return null;
	}
	if ( name.startsWith( 'inspector-panel:' ) ) {
		const panelName = name.slice( 'inspector-panel:'.length );
		const sidebar = registry.inspector( ctx );
		return sidebar
			.locator( '.components-panel__body, .components-tools-panel' )
			.filter( {
				has: ctx.page.getByRole( 'button', {
					name: panelName,
					exact: true,
				} ),
			} )
			.first();
	}
	if ( registry[ name ] ) {
		return registry[ name ]( ctx );
	}
	const problem = validateTargetName( name );
	if ( problem ) {
		throw new Error( problem );
	}
	// A selector: look in the page first, then the editor canvas.
	const inPage = ctx.page.locator( name );
	try {
		if ( ( await inPage.count() ) > 0 ) {
			return inPage.first();
		}
		const inCanvas = ctx.editor.canvas.locator( name );
		if ( ( await inCanvas.count() ) > 0 ) {
			return inCanvas.first();
		}
	} catch {
		// fall through
	}
	return inPage.first();
}

/**
 * Wait for a target to be visible, with an error a writer can act on.
 * @param {Object}                             ctx
 * @param {string}                             name
 * @param {import('@playwright/test').Locator} locator
 * @param {number}                             [timeout]
 */
export async function waitForTarget( ctx, name, locator, timeout = 15_000 ) {
	try {
		await locator.waitFor( { state: 'visible', timeout } );
	} catch {
		throw new Error(
			`target "${ name }" is not visible on this screen after ${ timeout / 1000 }s. Is the right panel open? (scene and steps decide what is on screen)`
		);
	}
}

export function isFullViewport( name ) {
	return ! name || FULL_VIEWPORT.has( name );
}

export const targetNames = [
	...FULL_VIEWPORT,
	...Object.keys( registry ),
	'inspector-panel:<name>',
];
