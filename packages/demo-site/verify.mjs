// Smoke test for the blueprint: opens key screens on a running Playground, saves PNGs to blueprint/.verify/ and
// prints diagnostics (notices, modals, update badges, external requests, invalid blocks).
//
//   ../node_modules/.bin/wp-playground-cli server --blueprint=blueprint/blueprint.json \
//       --blueprint-may-read-adjacent-files --port=9411 &
//   node blueprint/verify.mjs [http://127.0.0.1:9411]
//
// Exit code 1 when a check fails. Not part of the engine; it exists so whoever edits the blueprint or content pack
// can see the result without running the whole toolkit.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE =
	process.argv[ 2 ] || process.env.WP_BASE || 'http://127.0.0.1:9411';
const OUT = path.join(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'.verify'
);
fs.mkdirSync( OUT, { recursive: true } );
const failures = [];
const fail = ( msg ) => {
	failures.push( msg );
	console.log( '  FAIL ' + msg );
};

const browser = await chromium.launch();
const context = await browser.newContext( {
	baseURL: BASE,
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
	reducedMotion: 'reduce',
	colorScheme: 'light',
	locale: 'en-US',
	timezoneId: 'UTC',
} );
const page = await context.newPage();
const external = new Set();
const local = new URL( BASE ).host;
page.on( 'request', ( r ) => {
	const u = new URL( r.url() );
	if ( /^https?:$/.test( u.protocol ) && u.host !== local ) {
		external.add( u.host + u.pathname );
	}
} );
page.on( 'pageerror', ( e ) => console.log( '  pageerror: ' + e.message ) );

const SO = { animations: 'disabled', caret: 'hide', scale: 'device' };
const settle = async () => {
	await page.mouse.move( 1439, 899 );
	await page.evaluate( () => document.fonts.ready );
	await page.waitForLoadState( 'networkidle' ).catch( () => {} );
	await page.waitForTimeout( 300 );
};

const adminDiag = () =>
	page.evaluate( () => {
		const visible = ( el ) =>
			!! el &&
			window.getComputedStyle( el ).display !== 'none' &&
			el.getClientRects().length > 0;
		return {
			notices: [
				...document.querySelectorAll(
					'#wpbody-content .notice, #wpbody-content .update-nag, #wpbody-content .error, #wpbody-content .updated'
				),
			]
				.filter( visible )
				.map( ( n ) =>
					n.textContent.trim().replace( /\s+/g, ' ' ).slice( 0, 120 )
				),
			welcomePanel: visible( document.querySelector( '#welcome-panel' ) ),
			updateBadges: [
				...document.querySelectorAll(
					'#adminmenu .update-plugins, #wp-admin-bar-updates'
				),
			]
				.filter( ( b ) => visible( b ) && b.textContent.trim() !== '0' )
				.map(
					( b ) =>
						( b.closest( 'li' )?.id || '' ) +
						':' +
						b.textContent.trim()
				),
			version: [ ...document.body.classList ].find( ( c ) =>
				c.startsWith( 'version-' )
			),
			footer: document
				.querySelector( '#footer-upgrade' )
				?.textContent.trim(),
			avatars: [ ...document.querySelectorAll( 'img.avatar' ) ]
				.map( ( i ) => i.currentSrc )
				.filter( ( v, i, a ) => a.indexOf( v ) === i ),
		};
	} );

const editorDiag = () =>
	page.evaluate( () => {
		const flat = ( blocks ) =>
			blocks.flatMap( ( b ) => [ b, ...flat( b.innerBlocks ) ] );
		const blocks = flat(
			window.wp.data.select( 'core/block-editor' ).getBlocks()
		);
		return {
			modals: [
				...document.querySelectorAll( '.components-modal__frame' ),
			].map( ( m ) => m.getAttribute( 'aria-label' ) || m.className ),
			notices: [
				...document.querySelectorAll(
					'.components-notice, .components-snackbar'
				),
			].map( ( n ) => n.textContent.trim().slice( 0, 120 ) ),
			invalidBlocks: blocks
				.filter( ( b ) => ! b.isValid )
				.map( ( b ) => b.name ),
			blockCount: blocks.length,
			fullscreen:
				document.body.classList.contains( 'is-fullscreen-mode' ),
		};
	} );

async function visit( name, url, kind, ready ) {
	console.log( `\n${ name }  ${ url }` );
	const t0 = performance.now();
	const res = await page.goto( url );
	const tResponse = Math.round( performance.now() - t0 );
	if ( await page.locator( '#loginform' ).count() ) {
		fail( `${ name }: landed on the login form (auto-login missing)` );
	}
	if ( ready ) {
		await ready();
	}
	const tReady = Math.round( performance.now() - t0 );
	await settle();
	let diag = {};
	if ( kind === 'editor' ) {
		diag = { ...( await adminDiag() ), ...( await editorDiag() ) };
	} else if ( kind === 'admin' ) {
		diag = await adminDiag();
	}
	console.log(
		`  status=${ res?.status() } response=${ tResponse }ms ready=${ tReady }ms`
	);
	console.log( '  ' + JSON.stringify( diag ) );
	if ( diag.notices?.length ) {
		fail( `${ name }: notices ${ JSON.stringify( diag.notices ) }` );
	}
	if ( diag.welcomePanel ) {
		fail( `${ name }: welcome panel visible` );
	}
	if ( diag.updateBadges?.length ) {
		fail(
			`${ name }: update badges ${ JSON.stringify( diag.updateBadges ) }`
		);
	}
	if ( diag.modals?.length ) {
		fail( `${ name }: modal open ${ JSON.stringify( diag.modals ) }` );
	}
	if ( diag.invalidBlocks?.length ) {
		fail(
			`${ name }: invalid blocks ${ JSON.stringify( diag.invalidBlocks ) }`
		);
	}
	if (
		diag.avatars?.some(
			( a ) => ! a.startsWith( BASE ) && ! a.startsWith( 'data:' )
		)
	) {
		fail( `${ name }: remote avatar` );
	}
	await page.screenshot( { path: path.join( OUT, name + '.png' ), ...SO } );
	return diag;
}

const editorReady = async () => {
	await page.waitForFunction( () =>
		window.wp?.data?.select( 'core/editor' )?.getCurrentPostId?.()
	);
	await page
		.frameLocator( '[name="editor-canvas"]' )
		.locator( 'body' )
		.waitFor();
	await page.waitForFunction(
		() =>
			window.wp.data.select( 'core/block-editor' ).getBlocks !== undefined
	);
};

await visit( 'dashboard', '/wp-admin/index.php', 'admin' );
await visit( 'updates', '/wp-admin/update-core.php', 'admin' );
const updText = await page.locator( '#wpbody-content' ).innerText();
console.log(
	'  updates text: ' + updText.replace( /\s+/g, ' ' ).slice( 0, 600 )
);
if ( ! /latest version of WordPress/i.test( updText ) ) {
	fail( 'updates: does not say WordPress is up to date' );
}

await visit( 'post-new', '/wp-admin/post-new.php', 'editor', editorReady );

const postLong = await page.request
	.get( '/wp-json/wp/v2/posts?slug=post-long&_fields=id' )
	.then( ( r ) => r.json() );
await visit(
	'post-long-editor',
	`/wp-admin/post.php?post=${ postLong[ 0 ].id }&action=edit`,
	'editor',
	async () => {
		await editorReady();
		await page.waitForFunction(
			() =>
				window.wp.data.select( 'core/block-editor' ).getBlocks()
					.length > 5
		);
	}
);

await visit( 'site-editor', '/wp-admin/site-editor.php', 'admin', async () => {
	await page.locator( '.edit-site-layout' ).waitFor();
	await page
		.frameLocator( 'iframe[name="editor-canvas"]' )
		.locator( 'body' )
		.waitFor()
		.catch( () => {} );
} );
const se = await page.evaluate( () => ( {
	modals: [ ...document.querySelectorAll( '.components-modal__frame' ) ].map(
		( m ) => m.getAttribute( 'aria-label' ) || m.className
	),
	theme: window.wp?.data?.select( 'core' )?.getCurrentTheme?.()?.stylesheet,
} ) );
console.log( '  ' + JSON.stringify( se ) );
if ( se.modals.length ) {
	fail( 'site-editor: modal open ' + JSON.stringify( se.modals ) );
}

await visit( 'front', '/', 'front' );
const front = await page.evaluate( () => ( {
	title: document.title,
	theme: [ ...document.querySelectorAll( 'link[rel=stylesheet]' ) ]
		.map( ( l ) => l.href )
		.find( ( h ) => h.includes( '/themes/' ) ),
	posts: [ ...document.querySelectorAll( '.wp-block-post-title' ) ].map(
		( t ) => t.textContent.trim()
	),
	nav: [
		...document.querySelectorAll( '.wp-block-navigation-item__label' ),
	].map( ( t ) => t.textContent.trim() ),
} ) );
console.log( '  ' + JSON.stringify( front ) );
if ( ! front.posts.includes( 'A Day on the Coast Path' ) ) {
	fail( 'front: demo posts not listed' );
}

await visit( 'post-long-front', '/post-long/', 'front' );
await page.screenshot( {
	path: path.join( OUT, 'post-long-front-full.png' ),
	...SO,
	scale: 'css',
	fullPage: true,
} );

console.log(
	'\nexternal requests: ' +
		( external.size ? [ ...external ].join( ', ' ) : 'none' )
);
if ( external.size ) {
	fail( 'external requests made' );
}
await browser.close();
console.log(
	failures.length
		? `\n${ failures.length } check(s) failed`
		: '\nall checks passed'
);
process.exit( failures.length ? 1 : 0 );
