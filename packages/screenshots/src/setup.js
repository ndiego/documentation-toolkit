/**
 * Setup: site state a shot needs before its scene opens (posts with particular blocks, notes on blocks, extra
 * users, option values, an activated plugin). Each operation is one authenticated REST call or a few, so setup
 * is fast and identical every run. Everything an operation creates or changes is recorded with
 * `site.trackCreated`, and the runner's cleanup after the shot deletes or reverts it.
 *
 * A spec writes operations the way it writes steps, one single-key mapping each:
 *
 *   setup:
 *     - post: { slug: my-post, title: Hello, content: "<!-- wp:paragraph -->…" }
 *     - note: { post: my-post, block: core/paragraph, text: Check this }
 *
 * or names a fixture from fixtures.js: `setup: long-post`.
 */
import crypto from 'node:crypto';

// Far in the past, so a created item never shows a relative date and pixels do not depend on today.
export const SETUP_DATE = '2025-01-15T10:00:00';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]*$/;
const BLOCK_NAME_RE = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export const POST_TYPES = [ 'post', 'page', 'wp_block' ];
export const POST_STATUSES = [ 'draft', 'publish' ];
export const USER_ROLES = [
	'administrator',
	'editor',
	'author',
	'contributor',
	'subscriber',
];
export const PLUGIN_STATUSES = [ 'active', 'inactive' ];
/**
 * The core settings `option` may change: the writable keys of /wp/v2/settings. `url` and `email` are left out
 * (changing them breaks the session or starts a confirmation email).
 */
export const OPTION_NAMES = [
	'title',
	'description',
	'timezone',
	'date_format',
	'time_format',
	'start_of_week',
	'language',
	'use_smilies',
	'default_category',
	'default_post_format',
	'posts_per_page',
	'show_on_front',
	'page_on_front',
	'page_for_posts',
	'default_ping_status',
	'default_comment_status',
	'site_logo',
	'site_icon',
];

const ROUTES = {
	post: '/wp/v2/posts',
	page: '/wp/v2/pages',
	wp_block: '/wp/v2/blocks',
};

/** What each operation takes, in the words the vocabulary tool and the docs use. Kept beside the operations. */
export const setupDocs = {
	post: `{ slug, title?, content? (block markup), type?: ${ POST_TYPES.join( ' | ' ) }, status?: ${ POST_STATUSES.join( ' | ' ) } (default publish), date?, author?: <login> }; open it with scene post:<slug> or page:<slug>`,
	note: '{ post: <slug>, block: <block name> or { name, nth } (nth counts from 0, nested blocks included), text, author?: <login>, date?, replies?: [ { text, author?, date? } ], resolved?: true }',
	user: `{ login, role: ${ USER_ROLES.join( ' | ' ) }, display_name?, email? }`,
	option: `{ name, value }; name is one of ${ OPTION_NAMES.join( ', ' ) }; value may be a {{page.<slug>}} template`,
	plugin: `{ slug (folder, or folder/file without .php), status?: ${ PLUGIN_STATUSES.join( ' | ' ) } (default active) }`,
};

const KEYS = {
	post: [ 'slug', 'title', 'content', 'type', 'status', 'date', 'author' ],
	note: [ 'post', 'block', 'text', 'author', 'date', 'replies', 'resolved' ],
	user: [ 'login', 'display_name', 'role', 'email' ],
	option: [ 'name', 'value' ],
	plugin: [ 'slug', 'status' ],
};

/**
 * Check one operation's argument. Load-time validation: no site needed.
 * @param {string}  op
 * @param {unknown} arg
 * @return {string|null} what is wrong, or null
 */
export function validateSetupOp( op, arg ) {
	if ( ! KEYS[ op ] ) {
		return `unknown operation "${ op }". Known: ${ setupOps.join( ', ' ) }`;
	}
	if ( ! arg || typeof arg !== 'object' || Array.isArray( arg ) ) {
		return `give it a mapping: ${ setupDocs[ op ] }`;
	}
	for ( const key of Object.keys( arg ) ) {
		if ( ! KEYS[ op ].includes( key ) ) {
			return `unknown key "${ key }". Allowed: ${ KEYS[ op ].join( ', ' ) }`;
		}
	}
	return checks[ op ]( arg );
}

const checks = {
	post( arg ) {
		return (
			slugProblem( 'slug', arg.slug ) ||
			stringProblem( 'title', arg.title ) ||
			stringProblem( 'content', arg.content ) ||
			oneOfProblem( 'type', arg.type, POST_TYPES ) ||
			oneOfProblem( 'status', arg.status, POST_STATUSES ) ||
			dateProblem( 'date', arg.date ) ||
			loginProblem( 'author', arg.author, true )
		);
	},
	note( arg ) {
		const problem =
			slugProblem( 'post', arg.post ) ||
			blockProblem( arg.block ) ||
			textProblem( 'text', arg.text ) ||
			loginProblem( 'author', arg.author, true ) ||
			dateProblem( 'date', arg.date );
		if ( problem ) {
			return problem;
		}
		if ( arg.resolved !== undefined && typeof arg.resolved !== 'boolean' ) {
			return 'resolved must be true or false';
		}
		if ( arg.replies === undefined ) {
			return null;
		}
		if ( ! Array.isArray( arg.replies ) ) {
			return 'replies must be a list of { text, author?, date? }';
		}
		for ( const [ i, reply ] of arg.replies.entries() ) {
			if ( ! reply || typeof reply !== 'object' ) {
				return `replies[${ i }] must be a mapping: { text, author?, date? }`;
			}
			for ( const key of Object.keys( reply ) ) {
				if ( ! [ 'text', 'author', 'date' ].includes( key ) ) {
					return `replies[${ i }]: unknown key "${ key }". Allowed: text, author, date`;
				}
			}
			const p =
				textProblem( 'text', reply.text ) ||
				loginProblem( 'author', reply.author, true ) ||
				dateProblem( 'date', reply.date );
			if ( p ) {
				return `replies[${ i }]: ${ p }`;
			}
		}
		return null;
	},
	user( arg ) {
		if (
			arg.email !== undefined &&
			! /^[^@\s]+@[^@\s]+$/.test( arg.email )
		) {
			return 'email must be an email address';
		}
		return (
			loginProblem( 'login', arg.login, false ) ||
			( arg.role === undefined
				? `role is required: ${ USER_ROLES.join( ' | ' ) }`
				: oneOfProblem( 'role', arg.role, USER_ROLES ) ) ||
			stringProblem( 'display_name', arg.display_name )
		);
	},
	option( arg ) {
		if (
			typeof arg.name !== 'string' ||
			! OPTION_NAMES.includes( arg.name )
		) {
			return `name must be one of the core settings: ${ OPTION_NAMES.join( ', ' ) }`;
		}
		if ( ! ( 'value' in arg ) ) {
			return 'value is required';
		}
		if (
			arg.value !== null &&
			! [ 'string', 'number', 'boolean' ].includes( typeof arg.value )
		) {
			return 'value must be a string, number, boolean or null';
		}
		return null;
	},
	plugin( arg ) {
		if (
			typeof arg.slug !== 'string' ||
			! /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?$/.test( arg.slug )
		) {
			return 'slug is required: the plugin folder (akismet) or folder/file without .php (akismet/akismet)';
		}
		return oneOfProblem( 'status', arg.status, PLUGIN_STATUSES );
	},
};

function slugProblem( key, value ) {
	return typeof value === 'string' && SLUG_RE.test( value )
		? null
		: `${ key } is required and must be a lowercase slug (a-z, 0-9, -)`;
}

function loginProblem( key, value, optional ) {
	if ( optional && value === undefined ) {
		return null;
	}
	return typeof value === 'string' && LOGIN_RE.test( value )
		? null
		: `${ key } must be a user login (lowercase a-z, 0-9, . _ -)`;
}

function stringProblem( key, value ) {
	return value === undefined || typeof value === 'string'
		? null
		: `${ key } must be a string`;
}

function textProblem( key, value ) {
	return typeof value === 'string' && value.trim()
		? null
		: `${ key } is required (the note's text)`;
}

function oneOfProblem( key, value, allowed ) {
	return value === undefined || allowed.includes( value )
		? null
		: `${ key } must be ${ allowed.join( ' | ' ) }, got "${ value }"`;
}

function dateProblem( key, value ) {
	if ( value === undefined ) {
		return null;
	}
	return typeof value === 'string' &&
		DATE_RE.test( value ) &&
		! Number.isNaN( Date.parse( value ) )
		? null
		: `${ key } must be a date like ${ SETUP_DATE } (site time), got "${ value }"`;
}

function blockProblem( block ) {
	const name = typeof block === 'object' && block ? block.name : block;
	if ( typeof name !== 'string' || ! BLOCK_NAME_RE.test( name ) ) {
		return 'block is required: a block name (core/paragraph) or { name, nth }';
	}
	if ( typeof block === 'object' ) {
		const extra = Object.keys( block ).filter(
			( k ) => k !== 'name' && k !== 'nth'
		);
		if ( extra.length ) {
			return `block: unknown key "${ extra[ 0 ] }". Allowed: name, nth`;
		}
		if (
			block.nth !== undefined &&
			( ! Number.isInteger( block.nth ) || block.nth < 0 )
		) {
			return 'block.nth must be a whole number, counting from 0';
		}
	}
	return null;
}

/**
 * Run a shot's setup operations in order. Each op's error names the op and carries the REST message.
 * @param {Object}                      ctx   a session context (needs ctx.site)
 * @param {{op: string, arg: Object}[]} ops   normalised operations (spec.js)
 * @param {(msg: string) => void}       [log]
 */
export async function runSetup( ctx, ops = [], log = () => {} ) {
	if ( ! ops.length ) {
		return;
	}
	const state = { posts: new Map(), users: new Map(), me: null };
	for ( const [ index, { op, arg } ] of ops.entries() ) {
		try {
			await operations[ op ]( ctx.site, arg, state );
		} catch ( e ) {
			const label = arg?.slug || arg?.login || arg?.name || arg?.post;
			e.message = `setup[${ index }] (${ op }${ label ? ` ${ label }` : '' }): ${ e.message }`;
			throw e;
		}
	}
	log( `  setup: ${ ops.map( ( o ) => o.op ).join( ', ' ) }` );
}

const operations = {
	async post( site, arg, state ) {
		const type = arg.type || 'post';
		const created = await site.rest( ROUTES[ type ], {
			method: 'POST',
			body: {
				slug: arg.slug,
				title: arg.title ?? '',
				content: arg.content ?? '',
				status: arg.status || 'publish',
				date: arg.date || SETUP_DATE,
				...( arg.author
					? { author: await userId( site, arg.author, state ) }
					: {} ),
			},
		} );
		site.trackCreated( type, created.id );
		if ( created.slug !== arg.slug ) {
			// WordPress appended a suffix: something with this slug already exists, and post:<slug> would open it.
			throw new Error(
				`a ${ type } with slug "${ arg.slug }" already exists on the site (WordPress named the new one "${ created.slug }")`
			);
		}
		state.posts.set( arg.slug, {
			id: created.id,
			type,
			content: created.content?.raw ?? arg.content ?? '',
		} );
	},

	/**
	 * A note thread on one block, as the WordPress 7.1 editor stores it (read from wp-includes/js/dist/editor.js,
	 * 7.1.3, and checked against the REST API of the running site):
	 * - a comment with `type: 'note'` on the post, parent 0; status `hold` is an open thread, `approved` a
	 *   resolved one;
	 * - replies are notes whose parent is the thread (the editor creates them with status `hold`);
	 * - resolving adds a reply with empty content, status `approved` and meta `_wp_note_status: 'resolved'` (the
	 *   "Marked as resolved" line), and sets the thread to `approved`;
	 * - the block points at its threads through `metadata.noteId`, an array of comment IDs (a single number is
	 *   also read).
	 * Verified against WordPress 7.1.3: the Notes sidebar shows these records as open and resolved threads with
	 * replies. Inline notes (text wrapped in `<mark class="wp-note" data-id>`) are not supported.
	 * @param {Object} site
	 * @param {Object} arg
	 * @param {Object} state
	 */
	async note( site, arg, state ) {
		const post = await findPost( site, arg.post, state );
		const name = typeof arg.block === 'string' ? arg.block : arg.block.name;
		const nth = typeof arg.block === 'object' ? ( arg.block.nth ?? 0 ) : 0;
		const date = arg.date || SETUP_DATE;
		const note = async ( fields ) => {
			const created = await site.rest( '/wp/v2/comments', {
				method: 'POST',
				body: { post: post.id, type: 'note', ...fields },
			} );
			site.trackCreated( 'comment', created.id );
			return created;
		};
		const authorOf = async ( login ) =>
			login ? { author: await userId( site, login, state ) } : {};
		const thread = await note( {
			content: arg.text,
			status: arg.resolved ? 'approved' : 'hold',
			date,
			...( await authorOf( arg.author ) ),
		} );
		let last = date;
		for ( const reply of arg.replies || [] ) {
			await note( {
				content: reply.text,
				parent: thread.id,
				status: 'hold',
				date: reply.date || date,
				...( await authorOf( reply.author ) ),
			} );
			last = reply.date && reply.date > last ? reply.date : last;
		}
		if ( arg.resolved ) {
			await note( {
				content: '',
				parent: thread.id,
				status: 'approved',
				date: last,
				meta: { _wp_note_status: 'resolved' },
				...( await authorOf( arg.author ) ),
			} );
		}
		const content = linkNote( post.content, name, nth, thread.id );
		await site.rest( `${ ROUTES[ post.type ] }/${ post.id }`, {
			method: 'POST',
			body: { content },
		} );
		post.content = content;
	},

	async user( site, arg, state ) {
		const created = await site.rest( '/wp/v2/users', {
			method: 'POST',
			body: {
				username: arg.login,
				name: arg.display_name || arg.login,
				email: arg.email || `${ arg.login }@example.com`,
				password: crypto.randomBytes( 18 ).toString( 'base64url' ),
				roles: [ arg.role ],
			},
		} );
		site.trackCreated( 'user', created.id );
		state.users.set( arg.login, created.id );
	},

	async option( site, arg ) {
		const settings = await site.rest( '/wp/v2/settings' );
		if ( ! ( arg.name in settings ) ) {
			throw new Error(
				`the site has no setting "${ arg.name }" in /wp/v2/settings`
			);
		}
		const value = await site.resolve( arg.value );
		site.trackCreated( 'option', arg.name, {
			previous: settings[ arg.name ],
		} );
		await site.rest( '/wp/v2/settings', {
			method: 'POST',
			body: { [ arg.name ]: value },
		} );
	},

	async plugin( site, arg ) {
		const plugins = await site.rest(
			'/wp/v2/plugins?_fields=plugin,status'
		);
		const found = plugins.find(
			( p ) =>
				p.plugin === arg.slug || p.plugin.startsWith( `${ arg.slug }/` )
		);
		if ( ! found ) {
			throw new Error(
				`no installed plugin "${ arg.slug }". Installed: ${ plugins.map( ( p ) => p.plugin ).join( ', ' ) || 'none' }`
			);
		}
		const status = arg.status || 'active';
		if ( found.status === status ) {
			return;
		}
		site.trackCreated( 'plugin', found.plugin, { previous: found.status } );
		await site.rest( `/wp/v2/plugins/${ found.plugin }`, {
			method: 'POST',
			body: { status },
		} );
	},
};

async function findPost( site, slug, state ) {
	if ( state.posts.has( slug ) ) {
		return state.posts.get( slug );
	}
	for ( const type of POST_TYPES ) {
		const items = await site.rest(
			`${ ROUTES[ type ] }?slug=${ encodeURIComponent( slug ) }&status=any&context=edit&per_page=1`
		);
		if ( items?.length ) {
			const post = {
				id: items[ 0 ].id,
				type,
				content: items[ 0 ].content.raw,
			};
			state.posts.set( slug, post );
			return post;
		}
	}
	throw new Error(
		`no post, page or pattern with slug "${ slug }" (create it with a post op earlier in setup)`
	);
}

async function userId( site, login, state ) {
	if ( state.users.has( login ) ) {
		return state.users.get( login );
	}
	const items = await site.rest(
		`/wp/v2/users?slug=${ encodeURIComponent( login ) }&context=edit&_fields=id,username`
	);
	const user =
		( items || [] ).find( ( u ) => u.username === login ) || items?.[ 0 ];
	if ( ! user ) {
		throw new Error(
			`no user with login "${ login }" (create it with a user op earlier in setup)`
		);
	}
	state.users.set( login, user.id );
	return user.id;
}

// The block delimiter tokenizer of @wordpress/block-serialization-default-parser.
const TOKENIZER =
	/<!--\s+(\/)?wp:([a-z][a-z0-9_-]*\/)?([a-z][a-z0-9_-]*)\s+({(?:(?=([^}]+|}+(?=})|(?!}\s+\/?-->)[^])*)\5|[^]*?)}\s+)?(\/)?-->/g;

/**
 * Add a note ID to the `metadata.noteId` list of the nth block of a type in serialized block markup.
 * @param {string} content block markup
 * @param {string} name    block name; a bare name means core/<name>
 * @param {number} nth     which match, counting from 0 in document order (nested blocks included)
 * @param {number} noteId
 * @return {string} the new markup
 */
export function linkNote( content, name, nth, noteId ) {
	const full = name.includes( '/' ) ? name : `core/${ name }`;
	let seen = 0;
	let done = false;
	const out = content.replace(
		TOKENIZER,
		( whole, closer, ns, local, json, _inner, selfClosing ) => {
			if ( done || closer || `${ ns || 'core/' }${ local }` !== full ) {
				return whole;
			}
			if ( seen++ !== nth ) {
				return whole;
			}
			done = true;
			const attrs = json ? JSON.parse( json ) : {};
			const existing = attrs.metadata?.noteId;
			const ids = [
				...( Array.isArray( existing ) ? existing : [ existing ] ),
			].filter( ( id ) => Number( id ) > 0 );
			attrs.metadata = { ...attrs.metadata, noteId: [ ...ids, noteId ] };
			const serializedName =
				ns && ns !== 'core/' ? `${ ns }${ local }` : local;
			return `<!-- wp:${ serializedName } ${ serializeAttributes( attrs ) } ${ selfClosing ? '/' : '' }-->`;
		}
	);
	if ( ! done ) {
		throw new Error(
			`the post has ${ seen } ${ full } block${ seen === 1 ? '' : 's' }, so there is no nth ${ nth } (nth counts from 0)`
		);
	}
	return out;
}

// As @wordpress/blocks serializes comment attributes, so the markup stays valid for the parser.
function serializeAttributes( attrs ) {
	return JSON.stringify( attrs )
		.replace( /--/g, '\\u002d\\u002d' )
		.replace( /</g, '\\u003c' )
		.replace( />/g, '\\u003e' )
		.replace( /&/g, '\\u0026' )
		.replace( /\\"/g, '\\u0022' );
}

export const setupOps = Object.keys( operations );
