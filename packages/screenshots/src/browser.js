import { resolveViewport } from './style.js';
import { createWordPressHelpers } from './wp.js';

/**
 * Launch Chromium with deterministic context options and build the WordPress helpers (wp.js).
 *
 * @param {Object}        opts
 * @param {string}        opts.baseURL
 * @param {Object}        opts.style
 * @param {boolean}       [opts.headed]
 * @param {string|object} [opts.viewport]
 */
export async function launchBrowser( {
	baseURL,
	style,
	headed = false,
	viewport = 'desktop',
} ) {
	const { chromium } = await import( '@playwright/test' );

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

	const { editor, admin, pageUtils } = createWordPressHelpers(
		page,
		baseURL
	);

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
