// Tests must never boot WordPress or download a browser: any attempt fails fast instead of hanging CI.
process.env.WP_SCREENSHOTS_NO_AUTO_INSTALL = '1';
process.env.PLAYWRIGHT_BROWSERS_PATH = '/nonexistent/playwright-browsers';
