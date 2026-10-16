/**
 * Scenes: the starting state of a shot. Each scene navigates to a known place and waits until it is usable.
 *
 *   new-post | new-page            fresh editor, guides dismissed
 *   post:<slug> | page:<slug>      existing content from the demo site in the editor
 *   admin:<path>                   e.g. admin:plugins.php, admin:options-general.php?tab=x
 *   site-editor[:<route>]          home | templates | parts | patterns | navigation | pages | styles |
 *                                  template:<slug> | part:<slug>
 *   front[:<path>]                 the front end
 */

const EDITOR_HIDE_ADMIN_BAR_CSS = `
#wpadminbar { display: none !important; }
html.wp-toolbar { padding-top: 0 !important; }
html, body { --wp-admin--admin-bar--height: 0px !important; }
.interface-interface-skeleton, .edit-post-layout, .editor-editor-interface, .edit-site-layout { top: 0 !important; }
`;

export function parseScene( scene ) {
	const idx = scene.indexOf( ':' );
	if ( idx === -1 ) {
		return { name: scene, arg: '' };
	}
	return { name: scene.slice( 0, idx ), arg: scene.slice( idx + 1 ) };
}

export function isEditorScene( scene ) {
	const { name } = parseScene( scene );
	return [ 'new-post', 'new-page', 'post', 'page', 'site-editor' ].includes(
		name
	);
}

/**
 * @param {Object} ctx
 * @param {string} scene
 */
export async function runScene( ctx, scene ) {
	const { name, arg } = parseScene( scene );
	const handler = handlers[ name ];
	if ( ! handler ) {
		throw new Error(
			`Unknown scene "${ scene }". Known: ${ Object.keys( handlers ).join( ', ' ) }`
		);
	}
	// Forget the editor's local autosave backups from earlier shots, or the next post shows a
	// "backup of this post in your browser" notice.
	await ctx.page
		.evaluate( () => {
			try {
				window.localStorage.clear();
				window.sessionStorage.clear();
			} catch {
				// about:blank or storage denied
			}
		} )
		.catch( () => {} );
	await handler( ctx, arg );
	if ( isEditorScene( scene ) && ctx.style.hideAdminBar !== false ) {
		await ctx.page.addStyleTag( { content: EDITOR_HIDE_ADMIN_BAR_CSS } );
	}
}

const handlers = {
	'new-post': async ( ctx ) => {
		await ctx.admin.createNewPost( {
			fullscreenMode: ctx.style.fullscreenMode !== false,
		} );
		await waitForPostEditor( ctx );
		await trackCurrentPost( ctx, 'post' );
	},
	'new-page': async ( ctx ) => {
		await ctx.admin.createNewPost( {
			postType: 'page',
			fullscreenMode: ctx.style.fullscreenMode !== false,
		} );
		await waitForPostEditor( ctx );
		await trackCurrentPost( ctx, 'page' );
	},
	post: async ( ctx, slug ) => {
		const { id } = await ctx.site.lookup( 'post', slug );
		await ctx.admin.visitAdminPage(
			'post.php',
			`post=${ id }&action=edit`
		);
		await ctx.editor.setPreferences( 'core/edit-post', {
			welcomeGuide: false,
			fullscreenMode: ctx.style.fullscreenMode !== false,
		} );
		await waitForPostEditor( ctx );
	},
	page: async ( ctx, slug ) => {
		const { id } = await ctx.site.lookup( 'page', slug );
		await ctx.admin.visitAdminPage(
			'post.php',
			`post=${ id }&action=edit`
		);
		await ctx.editor.setPreferences( 'core/edit-post', {
			welcomeGuide: false,
			fullscreenMode: ctx.style.fullscreenMode !== false,
		} );
		await waitForPostEditor( ctx );
	},
	admin: async ( ctx, pathAndQuery ) => {
		const [ p, q ] = ( pathAndQuery || 'index.php' ).split( '?' );
		await ctx.admin.visitAdminPage( p, q );
		await ctx.page.waitForLoadState( 'domcontentloaded' );
	},
	'site-editor': async ( ctx, route ) => {
		const options = siteEditorOptions( route );
		await ctx.admin.visitSiteEditor( options );
		if ( options.canvas === 'edit' || options.postId ) {
			await ctx.editor.canvas.locator( 'body' ).waitFor();
		}
		if ( route === 'styles' ) {
			// Open the Styles panel if the route did not already land there.
			const stylesButton = ctx.page
				.getByRole( 'button', { name: 'Styles', exact: true } )
				.first();
			if (
				( await stylesButton.count() ) &&
				! ( await stylesButton.getAttribute( 'aria-pressed' ) )
			) {
				await stylesButton.click();
			}
		}
	},
	front: async ( ctx, p ) => {
		await ctx.page.goto( p || '/' );
		await ctx.page.waitForLoadState( 'load' );
	},
};

function siteEditorOptions( route ) {
	if ( ! route || route === 'home' ) {
		return {};
	}
	switch ( route.split( ':' )[ 0 ] ) {
		case 'templates':
			return { postType: 'wp_template' };
		case 'parts':
			return { postType: 'wp_template_part' };
		case 'patterns':
			return { path: '/patterns' };
		case 'navigation':
			return { postType: 'wp_navigation' };
		case 'pages':
			return { postType: 'page' };
		case 'styles':
			return { path: '/wp_global_styles', canvas: 'edit' };
		case 'template':
			return {
				postType: 'wp_template',
				postId: routeValue( route ),
				canvas: 'edit',
			};
		case 'part':
			return {
				postType: 'wp_template_part',
				postId: routeValue( route ),
				canvas: 'edit',
			};
		default:
			throw new Error( `Unknown site-editor route "${ route }"` );
	}
}

async function waitForPostEditor( ctx ) {
	await ctx.page.waitForFunction( () => {
		const select = window.wp?.data?.select( 'core/editor' );
		if ( ! select ) {
			return false;
		}
		return typeof select.__unstableIsEditorReady === 'function'
			? select.__unstableIsEditorReady()
			: !! select.getCurrentPostId();
	} );
	await ctx.editor.canvas.locator( 'body' ).waitFor();
	await ctx.editor.canvas
		.locator(
			'.editor-post-title, .wp-block-post-title, [aria-label="Add title"]'
		)
		.first()
		.waitFor();
	// Close anything modal that slipped past the preferences (a guide, the pattern chooser).
	const modal = ctx.page.locator( '.components-modal__frame' );
	if ( await modal.count() ) {
		await ctx.page.keyboard.press( 'Escape' );
		await modal
			.first()
			.waitFor( { state: 'hidden' } )
			.catch( () => {} );
	}
}

async function trackCurrentPost( ctx, type ) {
	const id = await ctx.page.evaluate( () =>
		window.wp?.data?.select( 'core/editor' )?.getCurrentPostId()
	);
	if ( id ) {
		ctx.site.trackCreated( type, id );
	}
}

export const sceneNames = Object.keys( handlers );

/**
 * The part of a `kind:value` site editor route after the colon.
 * @param {string} route
 * @return {string} the value, empty when the route has none
 */
function routeValue( route ) {
	return route.slice( route.indexOf( ':' ) + 1 );
}
