<?php
/**
 * Plugin Name: WP Shots demo environment
 * Description: Makes a Playground demo site deterministic and clean for documentation screenshots.
 *
 * Installed by blueprint/blueprint.json into wp-content/mu-plugins/. It changes what the site LOOKS like only where
 * the default would be noisy or time-dependent; it does not hide the admin bar, the cursor or anything a screenshot
 * may legitimately need (the engine decides those at capture time).
 *
 * What it does, hook by hook:
 *
 * 1. Admin notices
 *    - `in_admin_header` (PHP_INT_MAX): removes every callback on `admin_notices`, `all_admin_notices`,
 *      `network_admin_notices` and `user_admin_notices` just before admin-header.php fires them. That covers the
 *      SQLite integration plugin notice, the core update nag, "Privacy policy" nags and any plugin's promo notice.
 *      Inline feedback that a screen prints itself (for example "Settings saved." via settings_errors()) still shows.
 *    - `welcome_panel`: core's `wp_welcome_panel` is removed, so the Dashboard has no Welcome panel even if the
 *      `show_welcome_panel` user meta is ever reset (the seed sets it to 0 as well).
 *
 * 2. Updates (Dashboard > Updates says everything is up to date; no count bubbles in the menu or admin bar)
 *    - `pre_site_transient_update_core|update_plugins|update_themes`: short-circuit the transients with "no updates"
 *      objects whose `last_checked` is a fixed timestamp (WP_SCREENSHOTS_LAST_CHECKED), so "Last checked on ..." is stable.
 *    - Removes the hooks that would refresh them: `wp_version_check`, `wp_update_plugins`, `wp_update_themes`
 *      (cron + load-*.php screens) and `_maybe_update_core|plugins|themes` on `admin_init`.
 *    - Auto-updates are NOT disabled through `automatic_updater_disabled` / `auto_update_*` filters, because those change
 *      what Updates, Plugins and Themes display. They cannot run anyway: their cron hook is removed and HTTP is blocked.
 *
 * 3. No outbound HTTP
 *    - `pre_http_request`: any request to a host other than the site itself fails immediately with a WP_Error.
 *      Playground runs offline in CI; this makes failures fast and identical everywhere (browse-happy/serve-happy
 *      checks, oEmbed discovery, pattern directory). Exception: wp_screenshots_http_fixture() answers the Dashboard's
 *      Events API and News/Planet feeds with fixed placeholder data, so that widget renders its normal layout. Define WP_SCREENSHOTS_ALLOW_HTTP true to
 *      opt out. A future fixture layer for embeds should hook `pre_oembed_result` (see proposal 4.2).
 *    - Emoji detection script/styles are removed (they would load twemoji from s.w.org in a browser without an
 *      emoji font, which headless Chromium on Linux is).
 *
 * 4. Local avatars
 *    - `pre_get_avatar_data`: every avatar (admin bar, comments, users list, REST `avatar_urls`, editor) uses the
 *      content pack's `avatar-default` attachment, or an inline SVG data URI when that attachment does not exist.
 *      No request ever goes to gravatar.com. Note: the Discussion settings "Default Avatar" list therefore shows
 *      the same image for every option.
 *
 * 5. No CSS motion
 *    - `admin_head`, `wp_head`, `enqueue_block_editor_assets` and the `block_editor_settings_all` `styles` array
 *      (the editor canvas iframe) all get one rule that zeroes animation and transition durations and delays.
 *      The caret is NOT hidden here: Playwright's `caret: 'hide'` does that per screenshot.
 *
 * 6. Dates
 *    - Seeded dates are all in 2025 or earlier, never "this year": wp-admin drops the year for dates in the current
 *      year ("Mar 20th" vs "Mar 20th 2025") by the SERVER clock, which this plugin does not freeze.
 *    - Server side, the seed gives every post, page, attachment and comment a fixed date (and post_modified =
 *      post_date), and the update transients carry a fixed `last_checked`. Nothing else is frozen on the server:
 *      relative times ("Last edited 2 minutes ago", "Published 3 days ago") are computed in the browser, and the
 *      engine does not freeze the browser clock by default (a frozen Date.now stalls Gutenberg debounces); shots that show relative times should mask them or set `style.clock`.
 *
 * 7. Environment facts for the engine
 *    - `rest_index`: adds `wp_screenshots: { wordpress, php, theme, content }` to GET /wp-json/ so the runner can assert
 *      which WordPress and PHP actually booted without logging in.
 *
 * @package wp-screenshots
 */

// Load once; allow a suite to disable it entirely with define( 'WP_SCREENSHOTS_DEMO', false ) before mu-plugins load.
if ( defined( 'WP_SCREENSHOTS_DEMO' ) ) {
	return;
}
define( 'WP_SCREENSHOTS_DEMO', true );

/** Fixed "last checked for updates" time: 2026-01-01 00:00:00 UTC. */
if ( ! defined( 'WP_SCREENSHOTS_LAST_CHECKED' ) ) {
	define( 'WP_SCREENSHOTS_LAST_CHECKED', 1767225600 );
}

/* -------------------------------------------------------------------------------------------------------------
 * 1. Admin notices and the Welcome panel
 * ---------------------------------------------------------------------------------------------------------- */

add_action(
	'in_admin_header',
	static function () {
		foreach ( array( 'admin_notices', 'all_admin_notices', 'network_admin_notices', 'user_admin_notices' ) as $hook ) {
			remove_all_actions( $hook );
		}
	},
	PHP_INT_MAX
);

remove_action( 'welcome_panel', 'wp_welcome_panel' );
add_action(
	'admin_init',
	static function () {
		remove_action( 'welcome_panel', 'wp_welcome_panel' );
	}
);

/* -------------------------------------------------------------------------------------------------------------
 * 2. Updates
 * ---------------------------------------------------------------------------------------------------------- */

/**
 * A transient value that says "checked, nothing to update".
 *
 * @param string $which core|plugins|themes.
 * @return object
 */
function wp_screenshots_no_updates( $which ) {
	$value               = new stdClass();
	$value->last_checked = WP_SCREENSHOTS_LAST_CHECKED;
	if ( 'core' === $which ) {
		$value->updates         = array();
		$value->version_checked = get_bloginfo( 'version' );
		$value->translations    = array();
		return $value;
	}
	$value->checked      = array();
	$value->response     = array();
	$value->no_update    = array();
	$value->translations = array();
	return $value;
}

add_filter( 'pre_site_transient_update_core', static fn() => wp_screenshots_no_updates( 'core' ) );
add_filter( 'pre_site_transient_update_plugins', static fn() => wp_screenshots_no_updates( 'plugins' ) );
add_filter( 'pre_site_transient_update_themes', static fn() => wp_screenshots_no_updates( 'themes' ) );

// Deliberately NOT filtering `automatic_updater_disabled` or `auto_update_*`: either one changes visible UI (Updates says
// "This site will not receive automatic updates", Plugins/Themes show "Auto-updates disabled" instead of the toggle).
// Auto-updates cannot run anyway: the `wp_maybe_auto_update` cron hook is removed below and outbound HTTP is blocked.
// A suite that wants them off for real can define( 'AUTOMATIC_UPDATER_DISABLED', true ) via blueprint `constants`.

/** Removes the update checks core schedules or runs on admin screens. */
function wp_screenshots_remove_update_checks() {
	remove_action( 'admin_init', '_maybe_update_core' );
	remove_action( 'admin_init', '_maybe_update_plugins' );
	remove_action( 'admin_init', '_maybe_update_themes' );
	remove_action( 'wp_version_check', 'wp_version_check' );
	remove_action( 'wp_update_plugins', 'wp_update_plugins' );
	remove_action( 'wp_update_themes', 'wp_update_themes' );
	remove_action( 'init', 'wp_schedule_update_checks' );
	remove_action( 'wp_maybe_auto_update', 'wp_maybe_auto_update' );
	foreach ( array( 'load-plugins.php', 'load-update.php', 'load-update-core.php' ) as $hook ) {
		remove_action( $hook, 'wp_update_plugins' );
	}
	foreach ( array( 'load-themes.php', 'load-update.php', 'load-update-core.php' ) as $hook ) {
		remove_action( $hook, 'wp_update_themes' );
	}
}
wp_screenshots_remove_update_checks();
add_action( 'init', 'wp_screenshots_remove_update_checks', 0 );

/* -------------------------------------------------------------------------------------------------------------
 * 3. No outbound HTTP, no emoji loader
 * ---------------------------------------------------------------------------------------------------------- */

add_filter(
	'pre_http_request',
	static function ( $response, $args, $url ) {
		if ( defined( 'WP_SCREENSHOTS_ALLOW_HTTP' ) && WP_SCREENSHOTS_ALLOW_HTTP ) {
			return $response;
		}
		$host = wp_parse_url( $url, PHP_URL_HOST );
		$home = wp_parse_url( home_url(), PHP_URL_HOST );
		if ( ! $host || $host === $home || in_array( $host, array( 'localhost', '127.0.0.1' ), true ) ) {
			return $response;
		}
		$fixture = wp_screenshots_http_fixture( $url );
		if ( null !== $fixture ) {
			return $fixture;
		}
		return new WP_Error( 'wp_screenshots_offline', 'Outbound HTTP is disabled in the screenshot environment.' );
	},
	10,
	3
);

/**
 * Canned responses for the requests a stock wp-admin makes, so the Dashboard's "WordPress Events and News" widget
 * renders its normal layout instead of "RSS Error" lines. The items are evergreen placeholders with fixed dates.
 *
 * @param string $url Request URL.
 * @return array|null wp_remote_request()-shaped response, or null for "no fixture".
 */
function wp_screenshots_http_fixture( $url ) {
	$ok = static fn( $body, $type ) => array(
		'headers'  => array( 'content-type' => $type ),
		'body'     => $body,
		'response' => array(
			'code'    => 200,
			'message' => 'OK',
		),
		'cookies'  => array(),
		'filename' => null,
	);
	if ( str_starts_with( $url, 'https://api.wordpress.org/events/' ) ) {
		$location = array(
			'description' => 'Lisbon',
			'latitude'    => '38.72',
			'longitude'   => '-9.14',
			'country'     => 'PT',
		);
		return $ok( wp_json_encode( array( 'location' => $location, 'events' => array() ) ), 'application/json' );
	}
	$feeds = array(
		'wordpress.org/news/feed'   => array(
			array( 'Learn WordPress: new tutorials on the block editor', '2025-12-02', 'Short, practical lessons on building pages with blocks, patterns and styles.' ),
			array( 'How to get involved in the next release', '2025-11-18', 'Testing, translating and documenting all help. Here is where to start.' ),
		),
		'planet.wordpress.org/feed' => array(
			array( 'Five tips for writing useful alt text', '2025-12-04', '' ),
			array( 'Getting started with block themes', '2025-12-03', '' ),
			array( 'A gentle introduction to patterns', '2025-12-01', '' ),
		),
	);
	foreach ( $feeds as $needle => $items ) {
		if ( false === strpos( $url, $needle ) ) {
			continue;
		}
		$xml = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>WordPress</title>'
			. '<link>https://wordpress.org/</link><description>WordPress</description>';
		foreach ( $items as $i => list( $title, $date, $text ) ) {
			$xml .= '<item><title>' . esc_html( $title ) . '</title><link>https://wordpress.org/#wp-screenshots-' . $i . '</link>'
				. '<pubDate>' . gmdate( 'D, d M Y H:i:s', strtotime( $date . ' 12:00:00 UTC' ) ) . ' +0000</pubDate>'
				. '<description>' . esc_html( $text ) . '</description></item>';
		}
		return $ok( $xml . '</channel></rss>', 'application/rss+xml; charset=UTF-8' );
	}
	return null;
}

remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
remove_action( 'wp_print_styles', 'print_emoji_styles' );
remove_action( 'admin_print_styles', 'print_emoji_styles' );
remove_action( 'wp_enqueue_scripts', 'wp_enqueue_emoji_styles' );
remove_action( 'admin_enqueue_scripts', 'wp_enqueue_emoji_styles' );
add_filter( 'emoji_svg_url', '__return_false' );

/* -------------------------------------------------------------------------------------------------------------
 * 4. Local avatars
 * ---------------------------------------------------------------------------------------------------------- */

/**
 * URL of the content pack's neutral avatar (attachment slug `avatar-default`), or an inline SVG fallback.
 *
 * @return string
 */
function wp_screenshots_avatar_url() {
	static $url = null;
	if ( null !== $url ) {
		return $url;
	}
	$ids = get_posts(
		array(
			'post_type'        => 'attachment',
			'post_status'      => 'inherit',
			'name'             => 'avatar-default',
			'fields'           => 'ids',
			'numberposts'      => 1,
			'suppress_filters' => true,
		)
	);
	$url = $ids ? (string) wp_get_attachment_url( $ids[0] ) : '';
	if ( '' === $url ) {
		$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#dcdcde"/>'
			. '<circle cx="128" cy="100" r="46" fill="#a7aaad"/><path d="M40 256c0-70 46-98 88-98s88 28 88 98z" fill="#a7aaad"/></svg>';
		$url = 'data:image/svg+xml;base64,' . base64_encode( $svg ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions
	}
	return $url;
}

add_filter(
	'pre_get_avatar_data',
	static function ( $args ) {
		$args['url']          = wp_screenshots_avatar_url();
		$args['found_avatar'] = true;
		return $args;
	},
	PHP_INT_MAX
);

/* -------------------------------------------------------------------------------------------------------------
 * 5. No CSS motion (wp-admin, front end, block editor document and editor canvas iframe)
 * ---------------------------------------------------------------------------------------------------------- */

/** @return string The one rule that zeroes animations and transitions. */
function wp_screenshots_no_motion_css() {
	return '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; '
		. 'transition-duration: 0s !important; transition-delay: 0s !important; }';
}

$wp_screenshots_print_no_motion = static function () {
	echo '<style id="wp-screenshots-no-motion">' . wp_screenshots_no_motion_css() . "</style>\n"; // phpcs:ignore WordPress.Security.EscapeOutput
};
add_action( 'admin_head', $wp_screenshots_print_no_motion );
add_action( 'wp_head', $wp_screenshots_print_no_motion );
add_action( 'login_head', $wp_screenshots_print_no_motion );

add_action(
	'enqueue_block_editor_assets',
	static function () {
		wp_register_style( 'wp-screenshots-no-motion', false, array(), '1' );
		wp_enqueue_style( 'wp-screenshots-no-motion' );
		wp_add_inline_style( 'wp-screenshots-no-motion', wp_screenshots_no_motion_css() );
	}
);

add_filter(
	'block_editor_settings_all',
	static function ( $settings ) {
		$settings['styles']   = isset( $settings['styles'] ) && is_array( $settings['styles'] ) ? $settings['styles'] : array();
		$settings['styles'][] = array(
			'css'            => wp_screenshots_no_motion_css(),
			'isGlobalStyles' => false,
		);
		return $settings;
	},
	PHP_INT_MAX
);

/* -------------------------------------------------------------------------------------------------------------
 * 7. Environment facts on the REST index (GET /wp-json/)
 * ---------------------------------------------------------------------------------------------------------- */

add_filter(
	'rest_index',
	static function ( $response ) {
		if ( $response instanceof WP_REST_Response ) {
			$data             = $response->get_data();
			$data['wp_screenshots'] = array(
				'wordpress' => get_bloginfo( 'version' ),
				'php'       => PHP_VERSION,
				'theme'     => get_stylesheet(),
				'content'   => get_option( 'wp_screenshots_content', null ),
			);
			$response->set_data( $data );
		}
		return $response;
	}
);
