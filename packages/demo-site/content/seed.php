<?php
/**
 * Demo content pack seed for the screenshot environment.
 *
 * Run by blueprint/blueprint.json after WordPress has loaded:
 *   require '/wordpress/wp-load.php'; require '/tmp/wp-screenshots-content/seed.php';
 *
 * The blueprint copies this file and media/ into /tmp/wp-screenshots-content/ first. Everything here is idempotent: each
 * item is looked up by slug and updated in place, so running it twice leaves one copy of everything.
 *
 * THE CONTRACT is the slugs (see ../README.md and content.json). Titles, text, photos and names may change freely.
 *
 * All dates are fixed and in the past, and post_modified is forced to post_date, so nothing reads as "today".
 *
 * @package wp-screenshots
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit( 1 );
}

require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';

wp_set_current_user( 1 );

$wp_screenshots_dir   = __DIR__;
$wp_screenshots_log   = array();
$wp_screenshots_media = array(); // slug => attachment ID.

/** Stable uploads subdirectory, so attachment URLs do not depend on the day the site was built. */
$wp_screenshots_upload_dir = static function ( $dirs ) {
	$dirs['subdir'] = '/2025/01';
	$dirs['path']   = $dirs['basedir'] . $dirs['subdir'];
	$dirs['url']    = $dirs['baseurl'] . $dirs['subdir'];
	return $dirs;
};
add_filter( 'upload_dir', $wp_screenshots_upload_dir );

// Nothing in the seed may reach the network (it also must not notify pingback targets).
add_filter( 'pre_option_default_pingback_flag', '__return_zero' );

/* -------------------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------------------- */

/**
 * Find a post of any status by slug.
 *
 * @param string $slug      post_name.
 * @param string $post_type Post type.
 * @return int Post ID or 0.
 */
function wp_screenshots_find( $slug, $post_type ) {
	$ids = get_posts(
		array(
			'name'             => $slug,
			'post_type'        => $post_type,
			'post_status'      => 'any',
			'fields'           => 'ids',
			'numberposts'      => 1,
			'suppress_filters' => true,
		)
	);
	if ( ! $ids && 'attachment' === $post_type ) {
		$ids = get_posts(
			array(
				'name'             => $slug,
				'post_type'        => 'attachment',
				'post_status'      => 'inherit',
				'fields'           => 'ids',
				'numberposts'      => 1,
				'suppress_filters' => true,
			)
		);
	}
	return $ids ? (int) $ids[0] : 0;
}

/**
 * Pin post_modified to post_date so the editor never says "Last edited a moment ago" for seeded content.
 *
 * @param int $id Post ID.
 */
function wp_screenshots_pin_modified( $id ) {
	global $wpdb;
	$wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->posts} SET post_modified = post_date, post_modified_gmt = post_date_gmt WHERE ID = %d", $id ) );
	clean_post_cache( $id );
}

/**
 * Sideload one media file (once) and force its slug, alt text and caption.
 *
 * @param string $slug    Attachment post_name (the contract).
 * @param string $file    File name inside media/.
 * @param array  $meta    title, alt, caption, description.
 * @return int Attachment ID.
 */
function wp_screenshots_media( $slug, $file, $meta ) {
	global $wp_screenshots_dir, $wp_screenshots_log;
	$date = '2025-01-02 09:00:00';
	$id   = wp_screenshots_find( $slug, 'attachment' );
	if ( ! $id ) {
		$src = $wp_screenshots_dir . '/media/' . $file;
		$tmp = wp_tempnam( $file );
		copy( $src, $tmp ); // media_handle_sideload moves the temp file; keep the source.
		$id = media_handle_sideload(
			array(
				'name'     => $file,
				'tmp_name' => $tmp,
			),
			0,
			$meta['title'],
			array(
				'post_name'     => $slug,
				'post_date'     => $date,
				'post_date_gmt' => $date,
			)
		);
		if ( is_wp_error( $id ) ) {
			throw new RuntimeException( "media {$slug}: " . $id->get_error_message() );
		}
		$wp_screenshots_log[] = "media {$slug} created ({$id})";
	}
	wp_update_post(
		array(
			'ID'           => $id,
			'post_name'    => $slug,
			'post_title'   => $meta['title'],
			'post_excerpt' => $meta['caption'] ?? '',
			'post_content' => $meta['description'] ?? '',
		)
	);
	update_post_meta( $id, '_wp_attachment_image_alt', $meta['alt'] );
	wp_screenshots_pin_modified( $id );
	return (int) $id;
}

/**
 * Create or update a post/page/navigation by slug.
 *
 * @param string $slug Post name (the contract).
 * @param array  $args wp_insert_post() args; post_date is required.
 * @return int Post ID.
 */
function wp_screenshots_upsert( $slug, $args ) {
	global $wp_screenshots_log;
	$type = $args['post_type'] ?? 'post';
	$args = array_merge(
		array(
			'post_type'      => $type,
			'post_status'    => 'publish',
			'post_author'    => 1,
			'comment_status' => 'post' === $type ? 'open' : 'closed',
			'ping_status'    => 'closed',
		),
		$args,
		array( 'post_name' => $slug )
	);
	if ( isset( $args['post_date'] ) && ! isset( $args['post_date_gmt'] ) ) {
		$args['post_date_gmt'] = $args['post_date']; // The site timezone is UTC.
	}
	$id = wp_screenshots_find( $slug, $type );
	if ( $id ) {
		$args['ID'] = $id;
	}
	$result = wp_insert_post( wp_slash( $args ), true );
	if ( is_wp_error( $result ) ) {
		throw new RuntimeException( "{$type} {$slug}: " . $result->get_error_message() );
	}
	if ( ! $id ) {
		$wp_screenshots_log[] = "{$type} {$slug} created ({$result})";
	}
	// Drafts keep an explicit post_name only if we write it ourselves.
	global $wpdb;
	$wpdb->update( $wpdb->posts, array( 'post_name' => $slug ), array( 'ID' => $result ) );
	wp_screenshots_pin_modified( $result );
	return (int) $result;
}

/**
 * Create a user once (by login) and keep its profile current.
 *
 * @param string $login   user_login and nicename (the contract).
 * @param array  $profile display_name, first_name, last_name, description, role.
 * @return int User ID.
 */
function wp_screenshots_user( $login, $profile ) {
	$user = get_user_by( 'login', $login );
	$data = array(
		'user_login'      => $login,
		'user_nicename'   => $login,
		'user_email'      => $login . '@example.com',
		'display_name'    => $profile['display_name'],
		'nickname'        => $profile['display_name'],
		'first_name'      => $profile['first_name'],
		'last_name'       => $profile['last_name'],
		'description'     => $profile['description'],
		'role'            => $profile['role'],
		'user_registered' => '2023-01-15 10:00:00',
	);
	if ( $user ) {
		$data['ID'] = $user->ID;
		$id         = wp_update_user( $data );
	} else {
		$data['user_pass'] = 'password';
		$id                = wp_insert_user( $data );
	}
	if ( is_wp_error( $id ) ) {
		throw new RuntimeException( "user {$login}: " . $id->get_error_message() );
	}
	update_user_meta( $id, 'show_welcome_panel', 0 );
	return (int) $id;
}

/**
 * Term ID for a slug, creating the term once.
 *
 * @param string $taxonomy category|post_tag.
 * @param string $slug     Term slug (the contract).
 * @param string $name     Display name.
 * @param string $desc     Description.
 * @return int
 */
function wp_screenshots_term( $taxonomy, $slug, $name, $desc = '' ) {
	$term = get_term_by( 'slug', $slug, $taxonomy );
	if ( $term ) {
		wp_update_term( $term->term_id, $taxonomy, array( 'name' => $name, 'description' => $desc ) );
		return (int) $term->term_id;
	}
	$t = wp_insert_term( $name, $taxonomy, array( 'slug' => $slug, 'description' => $desc ) );
	if ( is_wp_error( $t ) ) {
		throw new RuntimeException( "term {$slug}: " . $t->get_error_message() );
	}
	return (int) $t['term_id'];
}

/**
 * Insert a comment once, keyed by a comment meta value.
 *
 * @param string $key  Stable key.
 * @param array  $data wp_insert_comment() data.
 * @return int Comment ID.
 */
function wp_screenshots_comment( $key, $data ) {
	global $wpdb;
	$existing = (int) $wpdb->get_var( $wpdb->prepare( "SELECT comment_id FROM {$wpdb->commentmeta} WHERE meta_key = 'wp_screenshots_key' AND meta_value = %s LIMIT 1", $key ) );
	$data     = array_merge(
		array(
			'comment_author_url' => '',
			'comment_author_IP'  => '127.0.0.1',
			'comment_agent'      => 'wp-screenshots-seed',
			'comment_type'       => 'comment',
			'comment_parent'     => 0,
			'user_id'            => 0,
		),
		$data
	);
	$data['comment_date_gmt'] = $data['comment_date'];
	if ( $existing ) {
		$data['comment_ID'] = $existing;
		wp_update_comment( wp_slash( $data ) );
		wp_set_comment_status( $existing, 'spam' === $data['comment_approved'] ? 'spam' : ( $data['comment_approved'] ? 'approve' : 'hold' ) );
		return $existing;
	}
	$id = wp_insert_comment( wp_slash( $data ) );
	if ( ! $id ) {
		throw new RuntimeException( "comment {$key} failed" );
	}
	add_comment_meta( $id, 'wp_screenshots_key', $key, true );
	return (int) $id;
}

/* Block markup helpers. Keep output identical to what each block's save() produces, so the editor never reports
 * "This block contains unexpected or invalid content". */

function wp_screenshots_p( $text ) {
	return "<!-- wp:paragraph -->\n<p>{$text}</p>\n<!-- /wp:paragraph -->";
}

function wp_screenshots_h( $text, $level = 2 ) {
	$attrs = 2 === $level ? '' : ' {"level":' . $level . '}';
	return "<!-- wp:heading{$attrs} -->\n<h{$level} class=\"wp-block-heading\">{$text}</h{$level}>\n<!-- /wp:heading -->";
}

function wp_screenshots_img( $slug, $caption = '' ) {
	global $wp_screenshots_media;
	$id  = $wp_screenshots_media[ $slug ];
	$url = esc_url( wp_make_link_relative( wp_get_attachment_image_url( $id, 'large' ) ) );
	$alt = esc_attr( get_post_meta( $id, '_wp_attachment_image_alt', true ) );
	$cap = $caption ? "<figcaption class=\"wp-element-caption\">{$caption}</figcaption>" : '';
	return "<!-- wp:image {\"id\":{$id},\"sizeSlug\":\"large\",\"linkDestination\":\"none\"} -->\n"
		. "<figure class=\"wp-block-image size-large\"><img src=\"{$url}\" alt=\"{$alt}\" class=\"wp-image-{$id}\"/>{$cap}</figure>\n"
		. '<!-- /wp:image -->';
}

function wp_screenshots_list( $items ) {
	$li = array_map( static fn( $i ) => "<!-- wp:list-item -->\n<li>{$i}</li>\n<!-- /wp:list-item -->", $items );
	return "<!-- wp:list -->\n<ul class=\"wp-block-list\">" . implode( "\n\n", $li ) . "</ul>\n<!-- /wp:list -->";
}

/* -------------------------------------------------------------------------------------------------------------
 * Media
 * ---------------------------------------------------------------------------------------------------------- */

$wp_screenshots_media_spec = array(
	'hero'           => array( 'hero.jpg', 'Lake and mountains', 'A calm lake with reeds in the foreground and green mountains under a bright sky.', 'Morning light over the lake.' ),
	'landscape-1'    => array( 'landscape-1.jpg', 'Sea cliffs', 'Green sea cliffs above a curved sandy beach and turquoise water, seen from above.', 'The cliff path at low tide.' ),
	'landscape-2'    => array( 'landscape-2.jpg', 'Island at sunset', 'A small island silhouetted against an orange sunset sky over a calm sea.', 'Sunset from the ferry deck.' ),
	'landscape-3'    => array( 'landscape-3.jpg', 'Tea garden', 'Rows of green tea bushes among tall trees on rolling hills under an overcast sky.', 'Tea terraces after the rain.' ),
	'portrait-1'     => array( 'portrait-1.jpg', 'Lily pond', 'A still pond covered in lily pads, with misty hills in the distance.', 'A quiet pond on the valley trail.' ),
	'square-1'       => array( 'square-1.jpg', 'Leaves after rain', 'Close-up of green leaves covered in raindrops.', 'Raindrops on the path-side leaves.' ),
	'site-logo'      => array( 'site-logo.png', 'Saltmarsh logo', 'Saltmarsh', '' ),
	'site-icon'      => array( 'site-icon.png', 'Saltmarsh site icon', 'Saltmarsh site icon', '' ),
	'avatar-default' => array( 'avatar-default.png', 'Default avatar', 'Default profile picture', '' ),
);
foreach ( $wp_screenshots_media_spec as $slug => list( $file, $title, $alt, $caption ) ) {
	$wp_screenshots_media[ $slug ] = wp_screenshots_media(
		$slug,
		$file,
		array(
			'title'   => $title,
			'alt'     => $alt,
			'caption' => $caption,
		)
	);
}

/* -------------------------------------------------------------------------------------------------------------
 * Users
 * ---------------------------------------------------------------------------------------------------------- */

update_user_meta( 1, 'show_welcome_panel', 0 );
update_user_meta( 1, 'dismissed_wp_pointers', 'wp390_widgets,wp410_dfw,wp496_privacy,text_widget_custom_html,theme_editor_notice,plugin_editor_notice' );

$author_1 = wp_screenshots_user(
	'author-1',
	array(
		'display_name' => 'Maya Lindqvist',
		'first_name'   => 'Maya',
		'last_name'    => 'Lindqvist',
		'description'  => 'Maya writes the trail guides. She has walked most of the coast path twice and still gets lost in the tea hills.',
		'role'         => 'author',
	)
);
$author_2 = wp_screenshots_user(
	'author-2',
	array(
		'display_name' => 'Theo Marchetti',
		'first_name'   => 'Theo',
		'last_name'    => 'Marchetti',
		'description'  => 'Theo edits Saltmarsh and takes most of the photos. Ask him about ferry timetables.',
		'role'         => 'editor',
	)
);

/* -------------------------------------------------------------------------------------------------------------
 * Taxonomies
 * ---------------------------------------------------------------------------------------------------------- */

$cat_guides = wp_screenshots_term( 'category', 'guides', 'Guides', 'Step-by-step walking and travel guides.' );
$cat_news   = wp_screenshots_term( 'category', 'news', 'News', 'Updates from the Saltmarsh team.' );
$cat_travel = wp_screenshots_term( 'category', 'travel', 'Travel', 'Stories and photos from the road.' );
foreach ( array( 'hiking' => 'Hiking', 'coast' => 'Coast', 'photography' => 'Photography', 'planning' => 'Planning', 'gear' => 'Gear' ) as $slug => $name ) {
	wp_screenshots_term( 'post_tag', $slug, $name );
}

// The install's "Hello world!" post and its sample comment are replaced by the pack.
$hello = wp_screenshots_find( 'hello-world', 'post' );
if ( $hello ) {
	wp_delete_post( $hello, true );
}

/* -------------------------------------------------------------------------------------------------------------
 * Pages
 * ---------------------------------------------------------------------------------------------------------- */

$page_sample = wp_screenshots_upsert(
	'sample-page',
	array(
		'post_type'    => 'page',
		'post_title'   => 'Sample Page',
		'post_date'    => '2023-01-15 10:00:00',
		'post_content' => implode(
			"\n\n",
			array(
				wp_screenshots_p( 'This is an example page. It is different from a blog post because it stays in one place and shows up in your site navigation in most themes.' ),
				wp_screenshots_p( 'Most people start with an About page that introduces them to potential site visitors.' ),
			)
		),
	)
);

$page_about = wp_screenshots_upsert(
	'about',
	array(
		'post_type'    => 'page',
		'post_title'   => 'About',
		'post_date'    => '2023-01-16 10:00:00',
		'post_content' => implode(
			"\n\n",
			array(
				wp_screenshots_p( 'Saltmarsh is a small travel journal written by two friends who prefer slow routes: coast paths, ferries and the long way round.' ),
				wp_screenshots_img( 'portrait-1' ),
				wp_screenshots_h( 'What we write about' ),
				wp_screenshots_p( 'Practical guides for day walks, honest notes on gear, and photo stories from the places in between. Everything here is walked, ridden or sailed before it is written.' ),
			)
		),
	)
);

$page_contact = wp_screenshots_upsert(
	'contact',
	array(
		'post_type'    => 'page',
		'post_title'   => 'Contact',
		'post_date'    => '2023-01-16 11:00:00',
		'post_content' => implode(
			"\n\n",
			array(
				wp_screenshots_p( 'We read every message, usually within a few days.' ),
				wp_screenshots_p( 'Email: <a href="mailto:hello@example.com">hello@example.com</a>' ),
			)
		),
	)
);

// Created but NOT assigned: a spec can switch the front page with show_on_front=page + page_on_front/page_for_posts.
$page_home = wp_screenshots_upsert(
	'home',
	array(
		'post_type'    => 'page',
		'post_title'   => 'Home',
		'post_date'    => '2023-01-15 09:00:00',
		'post_content' => implode(
			"\n\n",
			array(
				wp_screenshots_h( 'Slow routes, good views', 1 ),
				wp_screenshots_p( 'Walking guides and travel notes from the coast, the hills and the ferries in between.' ),
				wp_screenshots_img( 'hero' ),
			)
		),
	)
);
$page_blog = wp_screenshots_upsert(
	'blog',
	array(
		'post_type'    => 'page',
		'post_title'   => 'Blog',
		'post_date'    => '2023-01-15 09:30:00',
		'post_content' => '',
	)
);

/* -------------------------------------------------------------------------------------------------------------
 * Posts
 * ---------------------------------------------------------------------------------------------------------- */

$gallery_items = implode( "\n\n", array( wp_screenshots_img( 'landscape-1' ), wp_screenshots_img( 'landscape-2' ), wp_screenshots_img( 'landscape-3' ) ) );
$cover_id      = $wp_screenshots_media['landscape-2'];
$cover_url     = esc_url( wp_make_link_relative( wp_get_attachment_image_url( $cover_id, 'full' ) ) );

$post_long_content = implode(
	"\n\n",
	array(
		wp_screenshots_p( 'The coast path rewards an early start. By the time the first ferry arrives, the light is already low and gold across the water, and the cliffs are yours for an hour.' ),
		wp_screenshots_h( 'Before you set out' ),
		wp_screenshots_p( 'Check the tide tables the night before. Two of the beaches on this route are only passable for about three hours either side of low water.' ),
		wp_screenshots_img( 'landscape-1', 'The cliff path at low tide.' ),
		wp_screenshots_h( 'What to pack', 3 ),
		wp_screenshots_list( array( 'Water, at least one litre per person', 'A light waterproof layer', 'Snacks that survive a squashed bag', 'A printed map, because signal is patchy' ) ),
		"<!-- wp:quote -->\n<blockquote class=\"wp-block-quote\">" . wp_screenshots_p( 'The best walks end somewhere you can sit down with a hot drink.' ) . "<cite>Maya Lindqvist</cite></blockquote>\n<!-- /wp:quote -->",
		wp_screenshots_h( 'Along the way' ),
		"<!-- wp:gallery {\"linkTo\":\"none\"} -->\n<figure class=\"wp-block-gallery has-nested-images columns-default is-cropped\">{$gallery_items}</figure>\n<!-- /wp:gallery -->",
		"<!-- wp:buttons -->\n<div class=\"wp-block-buttons\"><!-- wp:button -->\n<div class=\"wp-block-button\"><a class=\"wp-block-button__link wp-element-button\" href=\"/contact/\">Ask us about the route</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->",
		"<!-- wp:separator -->\n<hr class=\"wp-block-separator has-alpha-channel-opacity\"/>\n<!-- /wp:separator -->",
		"<!-- wp:cover {\"url\":\"{$cover_url}\",\"id\":{$cover_id},\"dimRatio\":40,\"layout\":{\"type\":\"constrained\"}} -->\n"
			. "<div class=\"wp-block-cover\"><img class=\"wp-block-cover__image-background wp-image-{$cover_id}\" alt=\"\" src=\"{$cover_url}\" data-object-fit=\"cover\"/>"
			. '<span aria-hidden="true" class="wp-block-cover__background has-background-dim-40 has-background-dim"></span>'
			. "<div class=\"wp-block-cover__inner-container\"><!-- wp:paragraph {\"align\":\"center\",\"fontSize\":\"large\"} -->\n<p class=\"has-text-align-center has-large-font-size\">Stay for the sunset ferry.</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->",
		"<!-- wp:columns -->\n<div class=\"wp-block-columns\"><!-- wp:column -->\n<div class=\"wp-block-column\">" . wp_screenshots_h( 'Distance', 3 ) . "\n\n" . wp_screenshots_p( 'About 11 km, mostly level, with two short climbs.' ) . "</div>\n<!-- /wp:column -->\n\n"
			. "<!-- wp:column -->\n<div class=\"wp-block-column\">" . wp_screenshots_h( 'Time', 3 ) . "\n\n" . wp_screenshots_p( 'Four hours at an easy pace, plus lunch.' ) . "</div>\n<!-- /wp:column --></div>\n<!-- /wp:columns -->",
		"<!-- wp:table -->\n<figure class=\"wp-block-table\"><table class=\"has-fixed-layout\"><thead><tr><th>Section</th><th>Distance</th><th>Terrain</th></tr></thead>"
			. '<tbody><tr><td>Harbour to the lighthouse</td><td>3.5 km</td><td>Paved, then grass</td></tr><tr><td>Lighthouse to the cove</td><td>4 km</td><td>Cliff path</td></tr><tr><td>Cove to the ferry</td><td>3.5 km</td><td>Sand and boardwalk</td></tr></tbody>'
			. "</table></figure>\n<!-- /wp:table -->",
		wp_screenshots_p( 'If the last ferry is cancelled, the bus from the harbour runs hourly until late evening.' ),
	)
);

$post_long = wp_screenshots_upsert(
	'post-long',
	array(
		'post_title'    => 'A Day on the Coast Path',
		'post_date'     => '2025-03-20 09:00:00',
		'post_author'   => $author_1,
		'post_excerpt'  => 'Eleven kilometres of cliffs, coves and a sunset ferry: our favourite day walk, step by step.',
		'post_content'  => $post_long_content,
		'post_category' => array( $cat_guides, $cat_travel ),
		'tags_input'    => array( 'hiking', 'coast', 'planning' ),
	)
);
set_post_thumbnail( $post_long, $wp_screenshots_media['hero'] );

$post_short = wp_screenshots_upsert(
	'post-short',
	array(
		'post_title'    => 'Ferry Timetables for the Spring',
		'post_date'     => '2025-02-12 09:00:00',
		'post_author'   => $author_2,
		'post_content'  => wp_screenshots_p( 'The spring timetable starts next week, with an extra evening sailing on weekends. We have updated every guide that depends on it.' ),
		'post_category' => array( $cat_news ),
		'tags_input'    => array( 'planning' ),
	)
);
set_post_thumbnail( $post_short, $wp_screenshots_media['landscape-2'] );

wp_screenshots_upsert(
	'post-draft',
	array(
		'post_title'    => 'Notes for the Autumn Guide',
		'post_status'   => 'draft',
		'post_date'     => '2025-03-25 09:00:00',
		'post_author'   => $author_1,
		'post_content'  => wp_screenshots_p( 'Draft: route ideas for the autumn issue. Check the bridge closure dates before publishing.' ),
		'post_category' => array( $cat_guides ),
	)
);

$more_posts = array(
	array( 'packing-light-for-a-weekend', 'Packing Light for a Weekend', '2023-05-14 09:00:00', 1, $cat_guides, array( 'gear', 'planning' ), 'landscape-1', 'One bag, three days, no regrets. Here is everything we carried on our last weekend away.' ),
	array( 'the-tea-hills-in-the-rain', 'The Tea Hills in the Rain', '2023-09-03 09:00:00', $author_1, $cat_travel, array( 'hiking', 'photography' ), 'landscape-3', 'Rain changes the tea terraces completely. The colours deepen and the paths empty out.' ),
	array( 'five-quiet-beaches', 'Five Quiet Beaches', '2024-02-18 09:00:00', $author_2, $cat_travel, array( 'coast' ), 'landscape-2', 'Not secret, exactly, but quiet enough that you will hear the water before the people.' ),
	array( 'a-beginners-guide-to-tide-tables', 'A Beginner’s Guide to Tide Tables', '2024-07-22 09:00:00', $author_1, $cat_guides, array( 'coast', 'planning' ), 'landscape-1', 'Tide tables look intimidating, but you only need two numbers to plan a safe coastal walk.' ),
	array( 'new-photo-prints-available', 'New Photo Prints Available', '2024-11-10 09:00:00', $author_2, $cat_news, array( 'photography' ), 'landscape-3', 'A small set of prints from this year’s walks is now available. Thank you for asking for them.' ),
	array( 'winter-walking-checklist', 'Winter Walking Checklist', '2025-01-05 09:00:00', 1, $cat_guides, array( 'gear', 'hiking' ), 'landscape-2', 'Shorter days need a little more planning. This is the checklist we use from November to March.' ),
);
foreach ( $more_posts as list( $slug, $title, $date, $author, $cat, $tags, $image, $text ) ) {
	$id = wp_screenshots_upsert(
		$slug,
		array(
			'post_title'    => $title,
			'post_date'     => $date,
			'post_author'   => $author,
			'post_content'  => wp_screenshots_p( $text ) . "\n\n" . wp_screenshots_p( 'More details, maps and photos are in the full guide. As always, check local conditions before you go.' ),
			'post_category' => array( $cat ),
			'tags_input'    => $tags,
		)
	);
	set_post_thumbnail( $id, $wp_screenshots_media[ $image ] );
}

/* -------------------------------------------------------------------------------------------------------------
 * Comments on post-long: 3 approved (one is a reply), 1 pending, 1 spam
 * ---------------------------------------------------------------------------------------------------------- */

$c1 = wp_screenshots_comment(
	'long-1',
	array(
		'comment_post_ID'      => $post_long,
		'comment_author'       => 'Priya Raman',
		'comment_author_email' => 'priya@example.com',
		'comment_content'      => 'We did this walk last weekend using your guide. The tip about the tide times saved us a long detour!',
		'comment_date'         => '2025-03-21 10:15:00',
		'comment_approved'     => 1,
	)
);
wp_screenshots_comment(
	'long-2',
	array(
		'comment_post_ID'      => $post_long,
		'comment_author'       => 'Maya Lindqvist',
		'comment_author_email' => 'author-1@example.com',
		'user_id'              => $author_1,
		'comment_parent'       => $c1,
		'comment_content'      => 'So glad it helped, Priya. Did you make the sunset ferry?',
		'comment_date'         => '2025-03-21 12:40:00',
		'comment_approved'     => 1,
	)
);
wp_screenshots_comment(
	'long-3',
	array(
		'comment_post_ID'      => $post_long,
		'comment_author'       => 'Jonas Weber',
		'comment_author_email' => 'jonas@example.com',
		'comment_content'      => 'Is the cliff section suitable for a dog? Ours is small but very determined.',
		'comment_date'         => '2025-03-22 08:05:00',
		'comment_approved'     => 1,
	)
);
wp_screenshots_comment(
	'long-pending',
	array(
		'comment_post_ID'      => $post_long,
		'comment_author'       => 'Lena Ortiz',
		'comment_author_email' => 'lena@example.com',
		'comment_content'      => 'Lovely photos. Which month were these taken?',
		'comment_date'         => '2025-03-23 17:30:00',
		'comment_approved'     => 0,
	)
);
wp_screenshots_comment(
	'long-spam',
	array(
		'comment_post_ID'      => $post_long,
		'comment_author'       => 'Best Deals Online',
		'comment_author_email' => 'deals@example.com',
		'comment_author_url'   => 'https://example.com/deals',
		'comment_content'      => 'Great post! Check out my website for amazing discounts.',
		'comment_date'         => '2025-03-24 03:12:00',
		'comment_approved'     => 'spam',
	)
);
wp_update_comment_count_now( $post_long );

/* -------------------------------------------------------------------------------------------------------------
 * Navigation menu (wp_navigation "Main"); block themes with an unassigned Navigation block use the newest one.
 * ---------------------------------------------------------------------------------------------------------- */

$nav_link = static function ( $label, $id, $type, $kind ) {
	$url = wp_make_link_relative( 'taxonomy' === $kind ? get_term_link( $id ) : get_permalink( $id ) );
	return '<!-- wp:navigation-link ' . wp_json_encode(
		array(
			'label'          => $label,
			'type'           => $type,
			'id'             => $id,
			'url'            => $url,
			'kind'           => $kind,
			'isTopLevelLink' => 'taxonomy' !== $kind,
		),
		JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
	) . ' /-->';
};
$nav_content = implode(
	"\n\n",
	array(
		'<!-- wp:navigation-link {"label":"Home","url":"/","kind":"custom","isTopLevelLink":true} /-->',
		$nav_link( 'About', $page_about, 'page', 'post-type' ),
		'<!-- wp:navigation-submenu {"label":"Topics","type":"category","id":' . $cat_guides . ',"url":"' . wp_make_link_relative( get_term_link( $cat_guides ) ) . '","kind":"taxonomy"} -->'
			. "\n" . $nav_link( 'Guides', $cat_guides, 'category', 'taxonomy' )
			. "\n" . $nav_link( 'Travel', $cat_travel, 'category', 'taxonomy' )
			. "\n" . $nav_link( 'News', $cat_news, 'category', 'taxonomy' )
			. "\n<!-- /wp:navigation-submenu -->",
		$nav_link( 'Contact', $page_contact, 'page', 'post-type' ),
	)
);
wp_screenshots_upsert(
	'main',
	array(
		'post_type'    => 'wp_navigation',
		'post_title'   => 'Main',
		'post_date'    => '2023-01-16 12:00:00',
		'post_content' => $nav_content,
	)
);

/* -------------------------------------------------------------------------------------------------------------
 * Block showcase: one post per block, holding a representative instance of it, for the block-* presets.
 * Slug contract: block-<block name without core/>.
 * ---------------------------------------------------------------------------------------------------------- */

$block_image = wp_screenshots_upsert(
	'block-image',
	array(
		'post_title'    => 'Image block',
		// Dated early so showcase posts sit at the end of the archive and never lead the home page.
		'post_date'     => '2023-01-10 09:00:00',
		'post_author'   => $author_1,
		'post_content'  => wp_screenshots_p( 'The harbour path is at its best an hour after sunrise, when the mist lifts off the water and the first ferries come in.' )
			. wp_screenshots_img( 'hero', 'Morning light over the lake.' )
			. wp_screenshots_p( 'Allow a full morning: the loop takes three hours at an easy pace, with time for the viewpoint above the old boathouse.' ),
		'post_category' => array( $cat_guides ),
		'tags_input'    => array( 'photography' ),
	)
);
set_post_thumbnail( $block_image, $wp_screenshots_media['hero'] );

/* -------------------------------------------------------------------------------------------------------------
 * Site identity and options
 * ---------------------------------------------------------------------------------------------------------- */

update_option( 'site_logo', $wp_screenshots_media['site-logo'] );
update_option( 'site_icon', $wp_screenshots_media['site-icon'] );
update_option( 'show_on_front', 'posts' );
delete_option( 'page_on_front' );
delete_option( 'page_for_posts' );

// A record of what was seeded; exposed on GET /wp-json/ as wp_screenshots.content by the mu-plugin.
update_option(
	'wp_screenshots_content',
	array(
		'pack'  => 'saltmarsh-placeholder',
		'media' => $wp_screenshots_media,
		'blocks' => array(
			'block-image' => $block_image,
		),
		'pages' => array(
			'sample-page' => $page_sample,
			'about'       => $page_about,
			'contact'     => $page_contact,
			'home'        => $page_home,
			'blog'        => $page_blog,
		),
	)
);

remove_filter( 'upload_dir', $wp_screenshots_upload_dir );
flush_rewrite_rules( false );

echo 'wp-screenshots seed ok: ' . implode( '; ', $wp_screenshots_log ) . "\n";
