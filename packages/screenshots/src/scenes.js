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
		const { p: pathParam, canvas, extra } = siteEditorRoute( route );
		const query = new URLSearchParams( {
			p: pathParam,
			...( extra || {} ),
		} );
		if ( canvas ) {
			query.set( 'canvas', canvas );
		}
		await ctx.admin.visitAdminPage( 'site-editor.php', query.toString() );
		if ( canvas === 'edit' ) {
			await ctx.editor.canvas.locator( 'body' ).waitFor();
			await ctx.page.waitForFunction( () =>
				window.wp?.data
					?.select( 'core/editor' )
					?.__unstableIsEditorReady()
			);
		} else {
			await ctx.page
				.locator( '.edit-site-layout, .edit-site-sidebar' )
				.first()
				.waitFor();
		}
	},
	front: async ( ctx, p ) => {
		await ctx.page.goto( p || '/' );
		await ctx.page.waitForLoadState( 'load' );
	},
};

// The site editor's list views, by the name a scene uses: site-editor:<view>.
const SITE_EDITOR_VIEWS = {
	templates: { p: '/template' },
	parts: { p: '/pattern', extra: { postType: 'wp_template_part' } },
	patterns: { p: '/pattern' },
	navigation: { p: '/navigation' },
	pages: { p: '/page' },
	styles: { p: '/styles' },
};

/**
 * Map a scene route to the site editor's `p` route (the `site-editor.php?p=/...` scheme of WordPress 6.8+).
 * @param {string} route
 * @return {{p: string, canvas?: string, extra?: Object}} query parts
 */
function siteEditorRoute( route ) {
	if ( ! route || route === 'home' ) {
		return { p: '/' };
	}
	const view = route.split( ':' )[ 0 ];
	if ( SITE_EDITOR_VIEWS[ view ] ) {
		return SITE_EDITOR_VIEWS[ view ];
	}
	switch ( view ) {
		case 'template':
			return {
				p: `/wp_template/${ routeValue( route ) }`,
				canvas: 'edit',
			};
		case 'part':
			return {
				p: `/wp_template_part/${ routeValue( route ) }`,
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
 * What each scene is and the form its argument takes, for tools that explain the vocabulary. Keyed like
 * `handlers` (a test keeps the two in step).
 */
export const sceneDocs = {
	'new-post': {
		form: 'new-post',
		description: 'A fresh, empty post in the editor, guides dismissed.',
	},
	'new-page': {
		form: 'new-page',
		description: 'A fresh, empty page in the editor, guides dismissed.',
	},
	post: {
		form: 'post:<slug>',
		description: 'An existing post from the demo site, open in the editor.',
	},
	page: {
		form: 'page:<slug>',
		description: 'An existing page from the demo site, open in the editor.',
	},
	admin: {
		form: 'admin:<path>',
		description:
			'A wp-admin screen, e.g. admin:plugins.php or admin:options-general.php?tab=x.',
	},
	'site-editor': {
		form: 'site-editor or site-editor:<view>',
		description: `The site editor on its home or a view: ${ Object.keys( SITE_EDITOR_VIEWS ).join( ', ' ) }, template:<theme>//<slug>, part:<theme>//<slug>.`,
	},
	front: {
		form: 'front or front:<path>',
		description: 'The public site, e.g. front:/about/.',
	},
};

/**
 * The part of a `kind:value` site editor route after the colon.
 * @param {string} route
 * @return {string} the value, empty when the route has none
 */
function routeValue( route ) {
	return route.slice( route.indexOf( ':' ) + 1 );
}
