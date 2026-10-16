/**
 * Site-level helpers: authenticated REST calls from Node (using the browser context's cookies), slug-based
 * lookups that back `{{media.<slug>}}` templating, and cleanup of content a shot created.
 * @param {Object}                                    options
 * @param {string}                                    options.baseURL
 * @param {import('@playwright/test').BrowserContext} options.context
 */
export function createSite( options ) {
	const { baseURL, context } = options;
	const cache = new Map();
	let nonce = null;
	const created = []; // { type: 'post'|'page', id }

	async function cookieHeader() {
		const cookies = await context.cookies( baseURL );
		return cookies.map( ( c ) => `${ c.name }=${ c.value }` ).join( '; ' );
	}

	async function getNonce() {
		if ( nonce ) {
			return nonce;
		}
		const res = await fetch(
			`${ baseURL }/wp-admin/admin-ajax.php?action=rest-nonce`,
			{
				headers: { cookie: await cookieHeader() },
				signal: AbortSignal.timeout( 15_000 ),
			}
		);
		if ( ! res.ok ) {
			throw new Error(
				`Could not fetch a REST nonce (${ res.status }). Is the browser logged in?`
			);
		}
		nonce = ( await res.text() ).trim();
		return nonce;
	}

	/**
	 * Authenticated REST request. `path` is relative to /wp-json, e.g. `/wp/v2/media?slug=hero`.
	 * @param {string} path
	 * @param {Object} [init]
	 */
	async function rest( path, init = {} ) {
		const url = `${ baseURL }/wp-json${ path }`;
		const headers = {
			cookie: await cookieHeader(),
			'x-wp-nonce': await getNonce(),
			...( init.body ? { 'content-type': 'application/json' } : {} ),
			...( init.headers || {} ),
		};
		const res = await fetch( url, {
			...init,
			headers,
			body: init.body ? JSON.stringify( init.body ) : undefined,
			signal: AbortSignal.timeout( 30_000 ),
		} );
		const text = await res.text();
		let data;
		try {
			data = text ? JSON.parse( text ) : null;
		} catch {
			data = text;
		}
		if ( ! res.ok ) {
			throw new Error(
				`REST ${ init.method || 'GET' } ${ path } failed (${ res.status }): ${ typeof data === 'string' ? data.slice( 0, 200 ) : data?.message || '' }`
			);
		}
		return data;
	}

	const routes = {
		media: '/wp/v2/media',
		post: '/wp/v2/posts',
		page: '/wp/v2/pages',
		user: '/wp/v2/users',
	};

	/**
	 * Look up a content item by slug. Returns { id, url, alt, title } or throws.
	 * @param {string} kind
	 * @param {string} slug
	 */
	async function lookup( kind, slug ) {
		const key = `${ kind }:${ slug }`;
		if ( cache.has( key ) ) {
			return cache.get( key );
		}
		const route = routes[ kind ];
		if ( ! route ) {
			throw new Error(
				`Unknown content kind "${ kind }" in template (use media, post, page or user)`
			);
		}
		const statusArg =
			kind === 'post' || kind === 'page' ? '&status=any' : '';
		const items = await rest(
			`${ route }?slug=${ encodeURIComponent( slug ) }&per_page=1${ statusArg }&context=edit`
		);
		if ( ! Array.isArray( items ) || ! items.length ) {
			throw new Error(
				`No ${ kind } with slug "${ slug }" on the demo site. Check blueprint/README.md for the content contract.`
			);
		}
		const item = items[ 0 ];
		const value = {
			id: item.id,
			url: item.source_url || item.link,
			alt: item.alt_text || '',
			title: item.title?.rendered || item.name || '',
		};
		cache.set( key, value );
		return value;
	}

	const TOKEN = /\{\{\s*([a-z]+)\.([a-z0-9-]+)(?:\.([a-z]+))?\s*\}\}/g;

	/**
	 * Resolve `{{kind.slug[.field]}}` tokens in a string. A string that is exactly one ID token becomes a number.
	 * @param {string} str
	 */
	async function resolveString( str ) {
		if ( ! str.includes( '{{' ) ) {
			return str;
		}
		const matches = [ ...str.matchAll( TOKEN ) ];
		let out = str;
		for ( const m of matches ) {
			const [ whole, kind, slug, field ] = m;
			let replacement;
			if ( kind === 'site' ) {
				replacement = baseURL;
			} else {
				const item = await lookup( kind, slug );
				replacement = field ? item[ field ] : item.id;
				if ( replacement === undefined ) {
					throw new Error(
						`Unknown field "${ field }" in ${ whole } (use id, url, alt or title)`
					);
				}
			}
			if ( out.trim() === whole && typeof replacement === 'number' ) {
				return replacement;
			}
			out = out.replace( whole, () => String( replacement ) );
		}
		if ( /\{\{[^}]*\}\}/.test( out ) ) {
			throw new Error(
				`Unrecognised template ${ out.match( /\{\{[^}]*\}\}/ )[ 0 ] }: use {{media.<slug>}}, {{media.<slug>.url}}, {{post.<slug>}}, {{page.<slug>}} or {{site.url}} (lowercase slugs)`
			);
		}
		return out;
	}

	/**
	 * Deep-resolve templates in any JSON-like value.
	 * @param {Object|Array|string|number|boolean|null} value
	 */
	async function resolve( value ) {
		if ( typeof value === 'string' ) {
			return resolveString( value );
		}
		if ( Array.isArray( value ) ) {
			return Promise.all( value.map( resolve ) );
		}
		if ( value && typeof value === 'object' ) {
			const out = {};
			for ( const [ k, v ] of Object.entries( value ) ) {
				out[ k ] = await resolve( v );
			}
			return out;
		}
		return value;
	}

	function trackCreated( type, id ) {
		if ( id && ! created.some( ( c ) => c.id === id ) ) {
			created.push( { type, id } );
		}
	}

	/**
	 * Delete everything shots created since the last cleanup (auto-drafts and drafts from new-post scenes).
	 * @param {(message: string) => void} [log]
	 */
	async function cleanup( log = () => {} ) {
		while ( created.length ) {
			const { type, id } = created.pop();
			const route = type === 'page' ? routes.page : routes.post;
			try {
				await rest( `${ route }/${ id }?force=true`, {
					method: 'DELETE',
				} );
			} catch ( e ) {
				log(
					`cleanup: could not delete ${ type } ${ id }: ${ e.message }`
				);
			}
		}
	}

	return { rest, lookup, resolve, trackCreated, cleanup, baseURL };
}
