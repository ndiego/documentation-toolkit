/**
 * The step vocabulary. Every verb is `(ctx, arg) => Promise<void>`; see ARCHITECTURE.md for the table.
 * Verbs lean on the WordPress data stores (wp.data, wp.blocks) through wp.js rather than on DOM details, so
 * they keep working across releases.
 */
import { resolveLocator, describeKey } from './locators.js';
import { resolveTarget } from './targets.js';
import { resolveViewport } from './style.js';

const HUMAN_DELAY_MS = 60;

export const actions = {
	async insertBlock( ctx, arg ) {
		const rep = typeof arg === 'string' ? { name: arg } : arg;
		if ( ! rep?.name ) {
			throw new Error(
				'insertBlock needs a block name, e.g. core/image'
			);
		}
		await ctx.editor.insertBlock( rep );
		await ctx.editor.canvas
			.locator( `[data-type="${ rep.name }"].is-selected` )
			.last()
			.waitFor();
		await ctx.editor.showBlockToolbar();
	},

	async selectBlock( ctx, arg ) {
		const { name, nth = 0 } = typeof arg === 'string' ? { name: arg } : arg;
		const block = ctx.editor.canvas
			.locator( `[data-type="${ name }"]` )
			.nth( nth );
		await block.waitFor();
		// Select through the store with no caret position: placing a caret (what a click or the default
		// selectBlock does) focuses the block's first rich text, and a caption or heading then shows its
		// inline formatting toolbar over the block. Focus the wrapper so keyboard steps still have a home.
		const clientId = await block.getAttribute( 'data-block' );
		await ctx.page.evaluate( ( id ) => {
			window.wp.data
				.dispatch( 'core/block-editor' )
				.selectBlock( id, null );
		}, clientId );
		await block.evaluate( ( el ) => el.focus() );
		await ctx.editor.showBlockToolbar();
		await ctx.editor.canvas
			.locator( '.block-editor-block-list__block.is-selected' )
			.first()
			.waitFor();
	},

	async setContent( ctx, html ) {
		await ctx.editor.setContent( String( html ) );
	},

	async openInserter( ctx ) {
		const toggle = ctx.page
			.getByRole( 'button', { name: /block inserter/i } )
			.first();
		if (
			( await toggle.getAttribute( 'aria-pressed' ) ) !== 'true' &&
			( await toggle.getAttribute( 'aria-expanded' ) ) !== 'true'
		) {
			await toggle.click();
		}
		await ( await resolveTarget( ctx, 'inserter' ) ).waitFor();
	},

	async searchInserter( ctx, term ) {
		await actions.openInserter( ctx );
		const inserter = await resolveTarget( ctx, 'inserter' );
		const search = inserter.getByRole( 'searchbox' ).first();
		await search.fill( String( term ) );
		// The full block list is replaced by search results after a debounce; the patterns section arrives later.
		// These waits are best effort (the class names are Gutenberg internals), but a miss is logged so a UI
		// change shows up as a warning instead of a silently different crop.
		const warn = ( what ) =>
			ctx.log?.(
				`  warning: searchInserter: ${ what } did not appear within 5s (Gutenberg markup may have changed; check the image)`
			);
		await inserter
			.locator( '.block-editor-inserter__all-blocks' )
			.waitFor( { state: 'detached', timeout: 5000 } )
			.catch( () =>
				warn( 'search results (full block list still shown)' )
			);
		await inserter
			.locator(
				'.block-editor-inserter__quick-inserter-patterns, .block-editor-inserter__no-results, .block-editor-inserter__quick-inserter-separator'
			)
			.first()
			.waitFor( { state: 'attached', timeout: 5000 } )
			.catch( () => warn( 'the patterns section' ) );
	},

	async openInspector( ctx, tab = 'settings' ) {
		await ctx.page.evaluate( () => {
			const { dispatch } = window.wp.data;
			try {
				dispatch( 'core/interface' ).enableComplementaryArea(
					'core',
					'edit-post/block'
				);
			} catch {
				// older stores
			}
			try {
				dispatch( 'core/edit-post' ).openGeneralSidebar(
					'edit-post/block'
				);
			} catch {
				// not the post editor
			}
			try {
				dispatch( 'core/edit-site' ).openGeneralSidebar(
					'edit-site/block-inspector'
				);
			} catch {
				// not the site editor
			}
		} );
		const sidebar = await resolveTarget( ctx, 'inspector' );
		await sidebar.waitFor();
		const blockTab = sidebar.getByRole( 'tab', {
			name: 'Block',
			exact: true,
		} );
		if (
			( await blockTab.count() ) &&
			( await blockTab.getAttribute( 'aria-selected' ) ) !== 'true'
		) {
			await blockTab.click();
		}
		// Block inspector tabs: Content (blocks with content controls, e.g. Image alt text), Settings, Styles.
		const wanted = {
			content: 'Content',
			settings: 'Settings',
			styles: 'Styles',
		}[ String( tab ).toLowerCase() ];
		if ( ! wanted ) {
			throw new Error(
				`openInspector: unknown tab "${ tab }" (content | settings | styles)`
			);
		}
		const innerTab = sidebar.getByRole( 'tab', {
			name: wanted,
			exact: true,
		} );
		if ( await innerTab.count() ) {
			await innerTab.click();
		} else {
			const tabs = await sidebar
				.getByRole( 'tab' )
				.allTextContents()
				.catch( () => [] );
			throw new Error(
				`openInspector: no "${ wanted }" tab in the sidebar (is a block selected?). Tabs present: ${ tabs.filter( Boolean ).join( ', ' ) || 'none' }`
			);
		}
	},

	async openDocumentSidebar( ctx ) {
		await ctx.editor.openDocumentSettingsSidebar();
	},

	async openPanel( ctx, name ) {
		const sidebar = await resolveTarget( ctx, 'inspector' );
		const button = sidebar
			.getByRole( 'button', { name, exact: true } )
			.first();
		await button.waitFor();
		if ( ( await button.getAttribute( 'aria-expanded' ) ) === 'false' ) {
			await button.click();
		}
	},

	async openBlockMenu( ctx ) {
		await ctx.editor.clickBlockToolbarButton( 'Options' );
		await ctx.page.getByRole( 'menu' ).last().waitFor();
	},

	async openToolbarDropdown( ctx, name ) {
		await ctx.editor.clickBlockToolbarButton( name );
		await ctx.page.locator( '.components-popover' ).last().waitFor();
	},

	async openListView( ctx ) {
		const toggle = ctx.page
			.getByRole( 'button', { name: /document overview|list view/i } )
			.first();
		if (
			( await toggle.getAttribute( 'aria-pressed' ) ) !== 'true' &&
			( await toggle.getAttribute( 'aria-expanded' ) ) !== 'true'
		) {
			await toggle.click();
		}
		await ( await resolveTarget( ctx, 'list-view' ) ).waitFor();
	},

	async openOptionsMenu( ctx ) {
		const topBar = await resolveTarget( ctx, 'top-bar' );
		await topBar
			.getByRole( 'button', { name: 'Options', exact: true } )
			.first()
			.click();
		await ctx.page.getByRole( 'menu' ).last().waitFor();
	},

	async click( ctx, key ) {
		const loc = await resolveLocator( ctx, key );
		await loc.click().catch( ( e ) => {
			throw new Error(
				`click ${ describeKey( key ) }: ${ e.message.split( '\n' )[ 0 ] }`
			);
		} );
	},

	async hover( ctx, key ) {
		const loc = await resolveLocator( ctx, key );
		await loc.hover();
	},

	async type( ctx, arg ) {
		const { text, pace } = typeof arg === 'string' ? { text: arg } : arg;
		await ctx.page.keyboard.type( String( text ), {
			delay: pace === 'human' ? HUMAN_DELAY_MS : 0,
		} );
	},

	async fill( ctx, arg ) {
		const { value, ...key } = arg;
		const loc = await resolveLocator( ctx, key );
		await loc.fill( String( value ) );
	},

	async select( ctx, arg ) {
		const { option, ...key } = arg;
		const loc = await resolveLocator( ctx, key );
		await loc.selectOption( { label: String( option ) } );
	},

	async press( ctx, chord ) {
		await ctx.pageUtils.pressKeys( String( chord ) );
	},

	async wait( ctx, arg ) {
		if ( typeof arg === 'number' ) {
			await ctx.page.waitForTimeout( arg );
			return;
		}
		const { for: what, state = 'visible', timeout } = arg || {};
		if ( ! what ) {
			throw new Error(
				'wait needs a number of ms or { for: <target|locator>, state? }'
			);
		}
		const loc =
			typeof what === 'string'
				? await resolveTarget( ctx, what )
				: await resolveLocator( ctx, what );
		if ( ! loc ) {
			await ctx.page.waitForLoadState( 'networkidle' );
			return;
		}
		await loc.waitFor( { state, timeout } );
	},

	async setViewport( ctx, arg ) {
		await ctx.page.setViewportSize( resolveViewport( ctx.style, arg ) );
	},

	async setPreference( ctx, { scope = 'core', key, value } ) {
		await ctx.page.evaluate(
			( [ s, k, v ] ) =>
				window.wp.data.dispatch( 'core/preferences' ).set( s, k, v ),
			[ scope, key, value ]
		);
	},

	async scrollTo( ctx, key ) {
		const loc = await resolveLocator( ctx, key );
		await loc.scrollIntoViewIfNeeded();
	},

	async evaluate( ctx, source ) {
		await ctx.page.evaluate( String( source ) );
	},
};

/**
 * Run a list of normalised steps.
 * @param {Object}                                   ctx
 * @param {{verb:string,arg:Object|string|number}[]} steps
 */
export async function runSteps( ctx, steps ) {
	for ( const step of steps ) {
		const { verb, arg, origin, index } = step;
		const fn = actions[ verb ];
		if ( ! fn ) {
			throw new Error(
				`Unknown step verb "${ verb }". Known: ${ Object.keys( actions ).join( ', ' ) }`
			);
		}
		try {
			await fn( ctx, arg );
		} catch ( e ) {
			const where =
				origin === 'defaults'
					? `defaults.steps[${ index }]`
					: `steps[${ index }]`;
			const shown =
				arg === undefined
					? ''
					: ` ${ typeof arg === 'string' ? arg : JSON.stringify( arg ) }`.slice(
							0,
							120
						);
			e.message = `${ where } (${ verb }${ shown }): ${ e.message.split( '\nCall log' )[ 0 ] }`;
			throw e;
		}
	}
}

export const verbNames = Object.keys( actions );
