/**
 * Setup fixtures: named lists of setup operations a shot can ask for with `setup: <name>`. A fixture expands to
 * its operations when the spec loads, so the shot's specHash covers the real content.
 *
 * Everything here is fixed (slugs, logins, dates, text) so the pixels do not change between runs. Slugs and
 * logins start with `setup-` so they never collide with the demo site's own content, and a scene can open what a
 * fixture created: `scene: post:setup-long-post`.
 */

// Far in the past, so relative dates ("2 hours ago") never appear and nothing depends on today.
const DATE = '2025-01-15T10:00:00';

const p = ( text ) =>
	`<!-- wp:paragraph -->\n<p>${ text }</p>\n<!-- /wp:paragraph -->`;
const h = ( text, level = 2 ) =>
	`<!-- wp:heading${ level === 2 ? '' : ` {"level":${ level }}` } -->\n<h${ level } class="wp-block-heading">${ text }</h${ level }>\n<!-- /wp:heading -->`;
const list = ( items ) =>
	`<!-- wp:list -->\n<ul class="wp-block-list">${ items
		.map(
			( item ) =>
				`<!-- wp:list-item -->\n<li>${ item }</li>\n<!-- /wp:list-item -->`
		)
		.join( '\n' ) }</ul>\n<!-- /wp:list -->`;
const blocks = ( ...parts ) => parts.join( '\n\n' );

const LONG_POST = blocks(
	p(
		'The estuary path starts behind the harbour wall and follows the water for most of a day. These are notes from three walks along it, in different weather.'
	),
	h( 'Before you go' ),
	p(
		'Check the tide times first. At high water the lower path floods in two places and the detour adds an hour.'
	),
	list( [
		'Tide table for the harbour',
		'Waterproof boots',
		'Something warm for the ferry',
	] ),
	h( 'The harbour to the mill' ),
	p(
		'The first stretch is flat and busy with dog walkers. The old mill is the only landmark worth stopping for.'
	),
	`<!-- wp:quote -->\n<blockquote class="wp-block-quote">${ p(
		'The river does not hurry, and neither should you.'
	) }<cite>A sign at the mill</cite></blockquote>\n<!-- /wp:quote -->`,
	p(
		'After the mill the path narrows and climbs through a strip of oak wood above the mudflats.'
	),
	`<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->`,
	h( 'The mill to the ferry' ),
	p(
		'This is the quiet part. Herons stand in the shallows and the only sound is the wind in the reeds.'
	),
	h( 'What to watch for', 3 ),
	list( [
		'Curlews on the mudflats in winter',
		'Seals near the ferry slip at low tide',
		'Samphire along the saltmarsh edge in summer',
	] ),
	`<!-- wp:pullquote -->\n<figure class="wp-block-pullquote"><blockquote><p>Three walks, three different rivers.</p></blockquote></figure>\n<!-- /wp:pullquote -->`,
	p(
		'The ferry runs every half hour in summer and on request in winter: ring the bell on the post.'
	),
	`<!-- wp:table -->\n<figure class="wp-block-table"><table class="has-fixed-layout"><thead><tr><th>Section</th><th>Distance</th><th>Time</th></tr></thead><tbody><tr><td>Harbour to mill</td><td>4 km</td><td>1 hour</td></tr><tr><td>Mill to ferry</td><td>7 km</td><td>2 hours</td></tr><tr><td>Ferry to village</td><td>3 km</td><td>45 minutes</td></tr></tbody></table></figure>\n<!-- /wp:table -->`,
	h( 'Getting back' ),
	p(
		'The bus from the village runs hourly until six. Miss the last one and it is a long walk back the way you came.'
	),
	`<!-- wp:preformatted -->\n<pre class="wp-block-preformatted">Bus 42: village 17:05, harbour 17:40</pre>\n<!-- /wp:preformatted -->`,
	p( 'Next time: the north bank, and the lighthouse.' )
);

const NOTES_POST = blocks(
	h( 'Spring opening hours' ),
	p(
		'From the first of April the visitor centre opens every day from nine until five.'
	),
	p(
		'The café keeps the same hours, and the kitchen stops serving hot food at four.'
	),
	p(
		'Guided walks leave from the front desk at ten and two. Booking is not needed for groups under eight.'
	),
	p( 'Dogs are welcome on the coast path but not inside the centre.' ),
	p( 'We close on Easter Sunday.' )
);

const PATTERN = blocks(
	`<!-- wp:group {"layout":{"type":"constrained"}} -->\n<div class="wp-block-group">${ blocks(
		h( 'Get the field notes' ),
		p( 'One email a month with new walks, tide tables and photographs.' ),
		`<!-- wp:buttons -->\n<div class="wp-block-buttons"><!-- wp:button -->\n<div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Subscribe</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->`
	) }</div>\n<!-- /wp:group -->`
);

/**
 * Built-in fixtures: name → { description, ops }. The ops use the spec's own setup form.
 * @type {Object<string, {description: string, ops: Object[]}>}
 */
export const fixtures = {
	'long-post': {
		description:
			'A published post (slug setup-long-post) with about twenty varied blocks, long enough for List View and the canvas to scroll.',
		ops: [
			{
				post: {
					slug: 'setup-long-post',
					title: 'Walking the estuary path',
					content: LONG_POST,
					status: 'publish',
					date: DATE,
				},
			},
		],
	},
	'post-with-notes': {
		description:
			"A post (slug setup-post-with-notes) of short paragraphs with two notes: an open one on the first paragraph with a reply from the demo site's editor (author-2, Theo Marchetti), and a resolved one on the third.",
		// The reply and the resolved note come from a user the demo site already has: the editor colours a note's
		// avatar ring by user ID, and a user created per shot would get a new ID (and colour) every run.
		ops: [
			{
				post: {
					slug: 'setup-post-with-notes',
					title: 'Visitor centre: spring update',
					content: NOTES_POST,
					status: 'draft',
					date: DATE,
				},
			},
			{
				note: {
					post: 'setup-post-with-notes',
					block: { name: 'core/paragraph', nth: 0 },
					text: 'Can we say which days the centre is busiest?',
					date: DATE,
					replies: [
						{
							text: 'Weekends and bank holidays. I will add a line.',
							author: 'author-2',
							date: '2025-01-15T11:30:00',
						},
					],
				},
			},
			{
				note: {
					post: 'setup-post-with-notes',
					block: { name: 'core/paragraph', nth: 2 },
					text: 'Group size changed to eight last year.',
					author: 'author-2',
					date: '2025-01-15T12:00:00',
					resolved: true,
				},
			},
		],
	},
	'synced-pattern': {
		description:
			'A synced pattern (wp_block, slug setup-synced-pattern) named "Newsletter sign-up": a heading, a paragraph and a button in a group.',
		ops: [
			{
				post: {
					type: 'wp_block',
					slug: 'setup-synced-pattern',
					title: 'Newsletter sign-up',
					content: PATTERN,
					status: 'publish',
					date: DATE,
				},
			},
		],
	},
	'second-author': {
		description:
			'A second user with the author role: login setup-author, display name Jordan Reyes.',
		ops: [
			{
				user: {
					login: 'setup-author',
					display_name: 'Jordan Reyes',
					role: 'author',
					email: 'setup-author@example.com',
				},
			},
		],
	},
};

export const fixtureNames = Object.keys( fixtures );
