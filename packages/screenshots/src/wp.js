/**
 * The handful of WordPress editor and admin helpers the engine needs, kept here so the engine does not depend on
 * `@wordpress/e2e-test-utils-playwright` (which brings Lighthouse, Sentry and Octokit along: about 110 MB of
 * downloads for nothing we run). The behaviour is ported from that package (Gutenberg, GPL-2.0-or-later), with
 * one deliberate difference: site editor navigation lives in scenes.js because the upstream helper still emits
 * pre-6.8 URLs.
 */

const PHP_ERROR =
	/(<b>)?(Fatal error|Recoverable fatal error|Warning|Parse error|Notice|Strict Standards|Deprecated|Unknown error)(<\/b>)?: (.*?) in (.*?) on line (<b>)?\d+(<\/b>)?/;

// Keyboard shortcut modifiers the way Gutenberg's docs name them (`primary+k`), resolved for the host OS, since
// the key that opens a shortcut in Chromium depends on where Chromium runs.
const MODIFIERS = {
	primary: ( apple ) => ( apple ? [ 'Meta' ] : [ 'Control' ] ),
	primaryShift: ( apple ) =>
		apple ? [ 'Shift', 'Meta' ] : [ 'Control', 'Shift' ],
	primaryAlt: ( apple ) =>
		apple ? [ 'Alt', 'Meta' ] : [ 'Control', 'Alt' ],
	secondary: ( apple ) =>
		apple ? [ 'Shift', 'Alt', 'Meta' ] : [ 'Control', 'Shift', 'Alt' ],
	access: ( apple ) => ( apple ? [ 'Control', 'Alt' ] : [ 'Shift', 'Alt' ] ),
	ctrl: () => [ 'Control' ],
	alt: () => [ 'Alt' ],
	ctrlShift: () => [ 'Control', 'Shift' ],
	shift: () => [ 'Shift' ],
	shiftAlt: () => [ 'Shift', 'Alt' ],
};

/**
 * Build the helpers for a page.
 * @param {import('@playwright/test').Page} page
 * @param {string}                          baseURL
 * @return {{editor: Object, admin: Object, pageUtils: Object}} the three helper groups the engine's context carries
 */
export function createWordPressHelpers( page, baseURL ) {
	const editor = {
		/** The editor canvas iframe as a frame locator (the page itself has no canvas on admin screens). */
		get canvas() {
			return page.frameLocator( '[name="editor-canvas"]' );
		},

		/** Move the pointer so the block toolbar, which hides while typing, shows. */
		async showBlockToolbar() {
			await page.mouse.move( 50, 50 );
			await page.mouse.move( 75, 75 );
			await page.mouse.move( 100, 100 );
		},

		/**
		 * Set editor preferences through the data store (welcome guides, fullscreen mode, …).
		 * @param {string} scope       e.g. core/edit-post
		 * @param {Object} preferences key → value
		 */
		async setPreferences( scope, preferences ) {
			await page.waitForFunction( () => window?.wp?.data );
			await page.evaluate(
				async ( props ) => {
					for ( const [ key, value ] of Object.entries(
						props.preferences
					) ) {
						await window.wp.data
							.dispatch( 'core/preferences' )
							.set( props.scope, key, value );
					}
				},
				{ scope, preferences }
			);
		},

		/**
		 * Click a button in the block toolbar by its accessible name.
		 * @param {string} label
		 */
		async clickBlockToolbarButton( label ) {
			await editor.showBlockToolbar();
			const toolbar = page.getByRole( 'toolbar', {
				name: 'Block tools',
			} );
			await toolbar.waitFor( { timeout: 5000 } ).catch( () => {
				throw new Error(
					`the block toolbar is not on screen. Is a block selected? An empty Paragraph shows the side inserter instead of a toolbar: give it text first (insertBlock { name: core/paragraph, attributes: { content } }, or type).`
				);
			} );
			await toolbar.getByRole( 'button', { name: label } ).click();
		},

		/**
		 * Replace the whole post content with block HTML.
		 * @param {string} html
		 */
		async setContent( html ) {
			await page.waitForFunction(
				() => window?.wp?.blocks && window?.wp?.data
			);
			await page.evaluate( ( markup ) => {
				const blocks = window.wp.blocks.parse( markup );
				window.wp.data
					.dispatch( 'core/block-editor' )
					.resetBlocks( blocks );
			}, html );
		},

		/** Open the Post/Page tab of the settings sidebar if it is closed. */
		async openDocumentSettingsSidebar() {
			const toggle = page
				.getByRole( 'region', { name: 'Editor top bar' } )
				.getByRole( 'button', {
					name: 'Settings',
					exact: true,
					disabled: false,
				} );
			if (
				( await toggle.getAttribute( 'aria-expanded' ) ) === 'false'
			) {
				await toggle.click();
				await page
					.getByRole( 'region', { name: 'Editor settings' } )
					.getByRole( 'button', { name: 'Close Settings' } )
					.waitFor();
			}
		},

		/**
		 * Insert a block through the data store; the new block becomes selected.
		 * @param {{name: string, attributes?: Object, innerBlocks?: Object[]}} block
		 * @param {{clientId?: string}}                                         [options] parent to insert into
		 */
		async insertBlock( block, options = {} ) {
			await page.waitForFunction(
				() => window?.wp?.blocks && window?.wp?.data
			);
			await page.evaluate(
				( [ representation, clientId ] ) => {
					const create = ( {
						name,
						attributes = {},
						innerBlocks = [],
					} ) =>
						window.wp.blocks.createBlock(
							name,
							attributes,
							innerBlocks.map( create )
						);
					window.wp.data
						.dispatch( 'core/block-editor' )
						.insertBlock(
							create( representation ),
							undefined,
							clientId
						);
				},
				[ block, options.clientId ]
			);
		},
	};

	const pageUtils = {
		/**
		 * Whether the page is at a wp path (query ignored).
		 * @param {string} wpPath e.g. wp-login.php
		 * @return {boolean} match
		 */
		isCurrentURL( wpPath ) {
			return (
				new URL( wpPath, baseURL ).pathname ===
				new URL( page.url() ).pathname
			);
		},

		/**
		 * Press a key chord written the Gutenberg way: `primary+k`, `shift+Tab`, `Enter`.
		 * @param {string}                           chord
		 * @param {{times?: number, delay?: number}} [options]
		 */
		async pressKeys( chord, options = {} ) {
			const apple = process.platform === 'darwin';
			const keys = chord
				.split( '+' )
				.flatMap( ( part ) =>
					MODIFIERS[ part ] ? MODIFIERS[ part ]( apple ) : part
				)
				.join( '+' );
			const times = options.times ?? 1;
			for ( let i = 0; i < times; i++ ) {
				await page.keyboard.press( keys );
				if ( times > 1 && options.delay ) {
					await page.waitForTimeout( options.delay );
				}
			}
		},
	};

	const admin = {
		/**
		 * Open a wp-admin screen and fail on a login redirect or a PHP error in the page.
		 * @param {string} adminPath e.g. plugins.php
		 * @param {string} [query]   query string without the ?
		 */
		async visitAdminPage( adminPath, query ) {
			await page.goto(
				`/wp-admin/${ adminPath.replace( /^\/+/, '' ) }${ query ? `?${ query }` : '' }`
			);
			if ( pageUtils.isCurrentURL( 'wp-admin/upgrade.php' ) ) {
				await page.click( '.button.button-large.button-primary' );
				await page.click( '.button.button-large' );
			}
			if ( pageUtils.isCurrentURL( 'wp-login.php' ) ) {
				throw new Error( 'Not logged in' );
			}
			const match = ( await page.content() ).match( PHP_ERROR );
			if ( match ) {
				throw new Error(
					`Unexpected error in page content: ${ match[ 0 ] }`
				);
			}
		},

		/**
		 * Open the editor on a new post, with the welcome guide off.
		 * @param {{postType?: string, title?: string, content?: string, excerpt?: string, showWelcomeGuide?: boolean, fullscreenMode?: boolean}} [options]
		 */
		async createNewPost( options = {} ) {
			const query = new URLSearchParams();
			for ( const [ key, param ] of [
				[ 'postType', 'post_type' ],
				[ 'title', 'post_title' ],
				[ 'content', 'content' ],
				[ 'excerpt', 'excerpt' ],
			] ) {
				if ( options[ key ] ) {
					query.set( param, options[ key ] );
				}
			}
			await admin.visitAdminPage( 'post-new.php', query.toString() );
			await editor.setPreferences( 'core/edit-post', {
				welcomeGuide: options.showWelcomeGuide ?? false,
				fullscreenMode: options.fullscreenMode ?? false,
			} );
		},
	};

	return { editor, admin, pageUtils };
}
