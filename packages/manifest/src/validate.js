/**
 * Validate a handbook manifest.json for the wporg-markdown importer used on developer.wordpress.org.
 *
 * Checks the invariants that have broken real imports (Advanced Administration 2023, Accessibility 2026) or
 * that the Theme Handbook research showed the importer cannot protect against on its own
 * (notes/theme-handbook-migration/research/02-pipeline-precedents.md section 5.6):
 *
 *   - keys are unique, normalised (no leading/trailing slash), and parents precede children
 *   - `parent` is null or an existing key (path form), except keys listed in allowMissingParent
 *   - a new entry's `slug` never equals another entry's slug at a different path (the importer's slug
 *     fallback would silently take over the existing post)
 *   - `order` is an integer; with `frozen`, existing keys keep their frozen order (0 is never re-applied)
 *   - `markdown_source` is a github.com/<org>/<repo>/blob/<branch>/... URL (raw URLs break the edit link)
 *   - with `docs`: each source file exists, starts with exactly one `# Title` equal to `title`,
 *     contains no other H1, and has no unescaped `<!-- wp:` outside fenced code (it would disable wpautop)
 *   - with `frozen`: no key from the frozen list is missing or renamed (removals need a redirect PR)
 *
 * Messages use Python repr-style quoting ('slug') so that CI logs keep the same shape they always had.
 */
import fs from 'node:fs';
import path from 'node:path';

const GITHUB_BLOB =
	/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/.+\.md$/;
const SANITIZED_SLUG = /^[a-z0-9-]+$/;
const FRONTMATTER = /^---\n.*?\n---\n/s;
const FENCE = /^\s*(```|~~~)/;

/**
 * Format a value the way Python's repr() would, for the common cases that appear in messages.
 *
 * @param {unknown} value Any JSON value.
 * @return {string} The repr-style text.
 */
function repr( value ) {
	if ( typeof value === 'string' ) {
		const quote =
			value.includes( "'" ) && ! value.includes( '"' ) ? '"' : "'";
		let out = '';
		for ( const ch of value ) {
			const code = ch.codePointAt( 0 );
			if ( ch === '\\' ) {
				out += '\\\\';
			} else if ( ch === quote ) {
				out += '\\' + ch;
			} else if ( ch === '\n' ) {
				out += '\\n';
			} else if ( ch === '\r' ) {
				out += '\\r';
			} else if ( ch === '\t' ) {
				out += '\\t';
			} else if ( code < 0x20 || code === 0x7f ) {
				out += '\\x' + code.toString( 16 ).padStart( 2, '0' );
			} else {
				out += ch;
			}
		}
		return quote + out + quote;
	}
	return str( value );
}

/**
 * Format a value the way Python's str() would, for the common cases that appear in messages.
 *
 * @param {unknown} value Any JSON value.
 * @return {string} The str-style text.
 */
function str( value ) {
	if ( value === null || value === undefined ) {
		return 'None';
	}
	if ( value === true ) {
		return 'True';
	}
	if ( value === false ) {
		return 'False';
	}
	if ( typeof value === 'string' || typeof value === 'number' ) {
		return String( value );
	}
	return JSON.stringify( value );
}

/**
 * Whether a value is a plain JSON object (the Python `dict` case).
 *
 * @param {unknown} value Any JSON value.
 * @return {boolean} True for objects that are not null and not arrays.
 */
export function isPlainObject( value ) {
	return (
		value !== null && typeof value === 'object' && ! Array.isArray( value )
	);
}

/**
 * Normalise a manifest key: strip leading and trailing slashes.
 *
 * @param {string} key A manifest key.
 * @return {string} The key without surrounding slashes.
 */
function norm( key ) {
	return key.replace( /^\/+|\/+$/g, '' );
}

/**
 * The last path segment of a key.
 *
 * @param {string} key A manifest key.
 * @return {string} Everything after the last slash.
 */
function lastSegment( key ) {
	return key.slice( key.lastIndexOf( '/' ) + 1 );
}

/**
 * The slug an entry resolves to: its `slug` field when truthy, otherwise the last path segment.
 *
 * @param {string}  key   The manifest key.
 * @param {unknown} entry The entry (any JSON value; non-objects have no slug field).
 * @return {unknown} The slug value.
 */
function slugOf( key, entry ) {
	const slug = isPlainObject( entry ) ? entry.slug : undefined;
	return slug || lastSegment( key );
}

/**
 * Python-style truthiness for the values this validator looks at.
 *
 * @param {unknown} value Any JSON value.
 * @return {boolean} Whether Python would treat the value as truthy.
 */
function truthy( value ) {
	if ( Array.isArray( value ) ) {
		return value.length > 0;
	}
	if ( isPlainObject( value ) ) {
		return Object.keys( value ).length > 0;
	}
	return Boolean( value );
}

/**
 * Default file reader: the contents of a regular file, or null when there is none at that path.
 *
 * @param {string} filePath Absolute path.
 * @return {string|null} UTF-8 contents, or null when the path is not a regular file.
 */
function readFileOrNull( filePath ) {
	const stat = fs.statSync( filePath, { throwIfNoEntry: false } );
	if ( ! stat || ! stat.isFile() ) {
		return null;
	}
	return fs.readFileSync( filePath, 'utf8' );
}

/**
 * Per-file Markdown checks: one H1 equal to the title, no other H1, no raw block markup outside fences.
 *
 * @param {string}   text     The file contents.
 * @param {string}   fileName The file's base name, for the message.
 * @param {unknown}  title    The manifest `title`.
 * @param {string}   key      The manifest key.
 * @param {string[]} errors   Collected errors (mutated).
 */
function readMarkdownChecks( text, fileName, title, key, errors ) {
	// The importer strips frontmatter before it looks at the body.
	const body = text.replace( FRONTMATTER, '' );
	const lines = body.replace( /^\n+/, '' ).split( '\n' );
	if ( ! /^# \S/.test( lines[ 0 ] ) ) {
		errors.push(
			`${ key }: ${ fileName } must start with a single '# Title' line`
		);
	} else {
		const h1 = lines[ 0 ].slice( 2 ).trim();
		if ( truthy( title ) && h1 !== title ) {
			errors.push(
				`${ key }: H1 ${ repr( h1 ) } differs from manifest title ${ repr( title ) }`
			);
		}
	}

	let inFence = false;
	const bodyLines = body.split( '\n' );
	for ( let i = 0; i < bodyLines.length; i++ ) {
		const n = i + 1;
		const line = bodyLines[ i ];
		if ( FENCE.test( line ) ) {
			inFence = ! inFence;
			continue;
		}
		if ( inFence ) {
			continue;
		}
		if (
			line.startsWith( '# ' ) &&
			n > 1 &&
			line.trim() !== lines[ 0 ].trim()
		) {
			errors.push( `${ key }: extra H1 at line ${ n }` );
		}
		if ( line.includes( '<!-- wp:' ) ) {
			errors.push(
				`${ key }: unescaped block markup '<!-- wp:' outside a code fence at line ${ n }`
			);
		}
	}
}

/**
 * The repository-relative path a github.com blob URL points at (everything after the branch).
 *
 * @param {string} src A URL that matched GITHUB_BLOB.
 * @return {string} The path under the repository root.
 */
function blobPath( src ) {
	const urlPath = src
		.slice( 'https://github.com'.length )
		.split( /[?#]/ )[ 0 ];
	const afterBlob = urlPath.slice(
		urlPath.indexOf( '/blob/' ) + '/blob/'.length
	);
	return afterBlob.slice( afterBlob.indexOf( '/' ) + 1 );
}

/**
 * Returns a file's contents, or null when there is no regular file at that path.
 *
 * @callback ReadFile
 * @param {string} absolutePath The resolved path.
 * @return {string|null} The UTF-8 contents, or null.
 */

/**
 * @typedef {Object} ValidateOptions
 * @property {string}       [docs]               Root directory the markdown_source paths resolve under; enables
 *                                               the per-file checks.
 * @property {Array|Object} [frozen]             Keys that must all still exist: a list, or an object whose values
 *                                               may carry a frozen `order`.
 * @property {string[]}     [allowMissingParent] Keys whose parent is intentionally absent from the manifest.
 * @property {ReadFile}     [readFile]           File reader; defaults to the filesystem.
 */

/**
 * Validate a parsed manifest.
 *
 * @param {Object}          data      The manifest: an object keyed by page path.
 * @param {ValidateOptions} [options] Validation options.
 * @return {{ errors: string[], warnings: string[], entries: number }} The findings and the entry count.
 */
export function validateManifest( data, options = {} ) {
	const {
		docs,
		frozen,
		allowMissingParent = [],
		readFile = readFileOrNull,
	} = options;
	const errors = [];
	const warnings = [];

	if ( ! isPlainObject( data ) ) {
		throw new TypeError(
			'manifest must be a JSON object keyed by page path'
		);
	}

	const keys = Object.keys( data );
	const has = ( key ) =>
		typeof key === 'string' && Object.hasOwn( data, key );

	const seenNorm = new Map();
	for ( const k of keys ) {
		const nk = norm( k );
		if ( nk !== k ) {
			errors.push(
				`${ repr( k ) }: key must not have leading or trailing slashes`
			);
		}
		if ( seenNorm.has( nk ) ) {
			errors.push(
				`${ repr( k ) }: duplicate of ${ repr( seenNorm.get( nk ) ) }`
			);
		}
		seenNorm.set( nk, k );
	}

	const slugAt = new Map();
	const seenSoFar = new Set();
	for ( const k of keys ) {
		const e = data[ k ];
		if ( ! isPlainObject( e ) ) {
			errors.push( `${ k }: entry must be an object` );
			continue;
		}

		const slug = slugOf( k, e );
		if ( typeof slug !== 'string' || ! SANITIZED_SLUG.test( slug ) ) {
			errors.push(
				`${ k }: slug ${ repr( slug ) } is not a sanitized slug`
			);
		}
		if ( k !== 'index' && lastSegment( k ) !== slug ) {
			errors.push(
				`${ k }: slug ${ repr( slug ) } does not match the last path segment`
			);
		}
		if ( slugAt.has( slug ) && slugAt.get( slug ) !== k ) {
			// Duplicate slugs are fine for *existing* adopted pages (matched by path first), but the
			// importer's slug fallback makes a *new* page with a reused slug take over the other post.
			warnings.push(
				`${ k }: slug ${ repr( slug ) } is also used by ${ repr(
					slugAt.get( slug )
				) } (safe only if both pages already exist on the site)`
			);
		}
		if ( ! slugAt.has( slug ) ) {
			slugAt.set( slug, k );
		}

		const parent = e.parent;
		if ( parent !== null && parent !== undefined ) {
			if ( ! has( parent ) ) {
				if ( allowMissingParent.includes( k ) ) {
					warnings.push(
						`${ k }: parent ${ repr( parent ) } is not in the manifest (allowed)`
					);
				} else {
					errors.push(
						`${ k }: parent ${ repr(
							parent
						) } is not a manifest key (use the parent's path, not its bare slug)`
					);
				}
			} else if ( ! seenSoFar.has( parent ) ) {
				errors.push(
					`${ k }: parent ${ repr( parent ) } must appear before its children`
				);
			}
			if ( ! k.startsWith( String( parent ) + '/' ) && k !== 'index' ) {
				errors.push(
					`${ k }: path is not under parent ${ repr( parent ) }`
				);
			}
		} else if ( k.includes( '/' ) ) {
			warnings.push( `${ k }: nested path with no parent` );
		}

		const order = e.order === undefined ? 0 : e.order;
		if ( ! Number.isInteger( order ) ) {
			errors.push( `${ k }: order must be an integer` );
		}

		const src = e.markdown_source === undefined ? '' : e.markdown_source;
		let rel = null;
		if ( typeof src === 'string' && GITHUB_BLOB.test( src ) ) {
			rel = blobPath( src );
		} else if (
			typeof src === 'string' &&
			src &&
			! src.includes( '://' ) &&
			src.endsWith( '.md' )
		) {
			// Relative path: fine for a local/spike manifest served from disk; production needs the blob URL.
			warnings.push(
				`${ k }: markdown_source is a relative path; production manifests need a github.com/<org>/<repo>/blob/<branch>/ URL`
			);
			rel = src.replace( /^[./]+/, '' );
		} else {
			errors.push(
				`${ k }: markdown_source must be a github.com/<org>/<repo>/blob/<branch>/<path>.md URL, got ${ repr(
					src
				) }`
			);
		}
		if ( rel && docs ) {
			const fp = path.resolve( docs, rel );
			const text = readFile( fp );
			if ( text === null || text === undefined ) {
				errors.push(
					`${ k }: source file ${ rel } not found under ${ docs }`
				);
			} else {
				const title = e.title === undefined ? '' : e.title;
				readMarkdownChecks(
					text,
					path.basename( fp ),
					title,
					k,
					errors
				);
			}
		}
		seenSoFar.add( k );
	}

	if ( frozen ) {
		const frozenIsList = Array.isArray( frozen );
		const frozenKeys = frozenIsList ? frozen : Object.keys( frozen );
		for ( const fk of frozenKeys ) {
			if ( ! has( fk ) ) {
				errors.push(
					`${ fk }: frozen page is missing from the manifest (removals and renames need a redirect PR)`
				);
			} else if ( ! frozenIsList && isPlainObject( frozen[ fk ] ) ) {
				const fo = frozen[ fk ].order;
				const current = isPlainObject( data[ fk ] )
					? data[ fk ].order
					: undefined;
				if ( fo !== null && fo !== undefined && current !== fo ) {
					errors.push(
						`${ fk }: order changed from ${ str( fo ) } to ${ str(
							current
						) } (the importer never re-applies 0)`
					);
				}
			}
		}
		const frozenSet = new Set( frozenKeys );
		const newKeys = keys.filter( ( k ) => ! frozenSet.has( k ) );
		const frozenSlugs = new Set(
			keys
				.filter( ( k ) => frozenSet.has( k ) )
				.map( ( k ) => slugOf( k, data[ k ] ) )
		);
		for ( const k of newKeys ) {
			const s = slugOf( k, data[ k ] );
			if ( frozenSlugs.has( s ) ) {
				errors.push(
					`${ k }: new page reuses existing slug ${ repr(
						s
					) }; the importer would take over the existing post`
				);
			}
		}
	}

	return { errors, warnings, entries: keys.length };
}
