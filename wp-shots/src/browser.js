import { resolveViewport } from './style.js';

/**
 * Launch Chromium with deterministic context options and build the Gutenberg Playwright utilities.
 *
 * `@wordpress/e2e-test-utils-playwright` reads WP_BASE_URL and friends at import time, so the env is set
 * before the dynamic import.
 *
 * @param {object} opts
 * @param {string} opts.baseURL
 * @param {object} opts.style
 * @param {{username:string,password:string}} opts.user
 * @param {boolean} [opts.headed]
 * @param {string|object} [opts.viewport]
 */
export async function launchBrowser( { baseURL, style, user, headed = false, viewport = 'desktop' } ) {
	process.env.WP_BASE_URL = baseURL;
	process.env.WP_USERNAME = user.username;
	process.env.WP_PASSWORD = user.password;
	const [ { chromium }, utils ] = await Promise.all( [
		import( '@playwright/test' ),
		import( '@wordpress/e2e-test-utils-playwright' ),
	] );
	const { Admin, Editor, PageUtils } = utils;

	const browser = await chromium.launch( { headless: ! headed } );
	const context = await browser.newContext( {
		baseURL,
		viewport: resolveViewport( style, viewport ),
		deviceScaleFactor: style.deviceScaleFactor,
		reducedMotion: 'reduce',
		colorScheme: style.colorScheme,
		locale: style.locale,
		timezoneId: style.timezoneId,
		hasTouch: false,
		serviceWorkers: 'block',
	} );
	const page = await context.newPage();
	page.setDefaultTimeout( 15_000 );
	page.setDefaultNavigationTimeout( 60_000 );
	if ( style.clock ) {
		// setSystemTime keeps time flowing (a fixed time would stall every debounce that reads Date.now()).
		await page.clock.setSystemTime( new Date( style.clock ) );
	}
	const pageErrors = [];
	page.on( 'pageerror', ( e ) => pageErrors.push( e.message ) );

	const editor = new Editor( { page } );
	const pageUtils = new PageUtils( { page, browserName: 'chromium' } );
	const admin = new Admin( { page, pageUtils, editor } );

	return {
		browser,
		context,
		page,
		editor,
		pageUtils,
		admin,
		pageErrors,
		chromiumVersion: browser.version(),
		async close() {
			await context.close().catch( () => {} );
			await browser.close().catch( () => {} );
		},
	};
}
