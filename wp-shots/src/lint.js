import fs from 'node:fs';
import path from 'node:path';
import { loadSpecs } from './spec.js';
import { extensionFor } from './image.js';
import { readManifest } from './manifest.js';
import { walk } from './files.js';

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;

/**
 * Check specs, generated images and Markdown references agree.
 *
 * Errors (exit 1): invalid spec, article not in the docs manifest, generated image with no spec, Markdown
 * reference to a generated image that does not exist.
 * Warnings: generated image referenced by no Markdown, alt text in Markdown differs from the spec
 * (`fix: true` rewrites it).
 *
 * @param {object} config
 * @param {{fix?:boolean, log?:(s:string)=>void}} opts
 */
export function lint( config, opts = {} ) {
	const { fix = false, log = console.log } = opts;
	const errors = [];
	const warnings = [];
	const ext = extensionFor( config.style.format );

	let specs = [];
	try {
		specs = loadSpecs( config );
	} catch ( e ) {
		errors.push( e.message );
		return finish();
	}

	// Article slugs must exist in the docs manifest, if one is configured.
	const knownSlugs = loadDocsSlugs( config.docsManifest );
	const shotsByFile = new Map(); // "article/id.ext" -> shot
	for ( const spec of specs ) {
		if ( knownSlugs && ! knownSlugs.has( spec.article ) ) {
			errors.push( `${ rel( spec.file ) }: article "${ spec.article }" is not in ${ rel( config.docsManifest ) }` );
		}
		for ( const shot of spec.shots ) {
			shotsByFile.set( `${ spec.article }/${ shot.id }.${ ext }`, { spec, shot } );
		}
	}

	// Generated images must come from a spec.
	const generated = listImages( config.outDir );
	for ( const file of generated ) {
		if ( ! shotsByFile.has( file ) ) {
			errors.push( `${ rel( path.join( config.outDir, file ) ) }: no spec produces this image (delete it or add a shot)` );
		}
	}

	// Manifest entries should match files.
	const manifest = readManifest( config.outDir );
	for ( const [ key, entry ] of Object.entries( manifest.shots ) ) {
		if ( ! fs.existsSync( path.join( config.outDir, entry.file ) ) ) {
			errors.push( `manifest: ${ key } points at a missing file ${ entry.file }` );
		}
	}

	// Markdown references.
	const referenced = new Set();
	const mdFiles = config.docsDir && fs.existsSync( config.docsDir ) ? walk( config.docsDir ).filter( ( f ) => f.endsWith( '.md' ) ) : [];
	for ( const md of mdFiles ) {
		let text = fs.readFileSync( md, 'utf8' );
		let changed = false;
		const outBase = path.basename( config.outDir );
		text = text.replace( IMAGE_RE, ( whole, alt, src, title ) => {
			if ( /^[a-z]+:/.test( src ) ) {
				return whole;
			}
			const abs = path.resolve( path.dirname( md ), src );
			const relOut = path.relative( config.outDir, abs );
			if ( relOut.startsWith( '..' ) || path.isAbsolute( relOut ) ) {
				// Not one of ours, unless it was meant to be: a wrong number of `../` is the usual slip.
				if ( src.includes( `/${ outBase }/` ) ) {
					errors.push( `${ rel( md ) }: ${ src } looks like a generated screenshot but does not resolve into ${ rel( config.outDir ) } (check the ../ depth; \`wp-shots snippet --article <slug>\` prints the right path)` );
				}
				return whole;
			}
			referenced.add( relOut );
			const hit = shotsByFile.get( relOut );
			if ( ! hit ) {
				errors.push( `${ rel( md ) }: references ${ src }, which no spec produces` );
				return whole;
			}
			if ( ! fs.existsSync( abs ) ) {
				errors.push( `${ rel( md ) }: references ${ src }, which has not been generated yet (run \`wp-shots run --article ${ hit.spec.article }\`)` );
			}
			if ( alt.trim() !== hit.shot.alt ) {
				if ( fix ) {
					changed = true;
					return `![${ hit.shot.alt }](${ src }${ title ? ` "${ title }"` : '' })`;
				}
				warnings.push( `${ rel( md ) }: alt text for ${ src } differs from the spec (run with --fix)` );
			}
			return whole;
		} );
		if ( changed ) {
			fs.writeFileSync( md, text );
			log( `fixed alt text in ${ rel( md ) }` );
		}
	}
	if ( mdFiles.length ) {
		for ( const file of generated ) {
			if ( shotsByFile.has( file ) && ! referenced.has( file ) ) {
				warnings.push( `${ rel( path.join( config.outDir, file ) ) }: generated but referenced by no Markdown file` );
			}
		}
	}

	return finish();

	function finish() {
		for ( const w of warnings ) {
			log( `warning: ${ w }` );
		}
		for ( const e of errors ) {
			log( `error: ${ e }` );
		}
		log( `${ specs.length } spec file(s), ${ shotsByFile.size } shot(s), ${ generated.length } generated image(s): ${ errors.length } error(s), ${ warnings.length } warning(s)` );
		return { errors, warnings, ok: errors.length === 0 };
	}
}

function markdownSourceFor( manifestFile, article ) {
	if ( ! manifestFile || ! fs.existsSync( manifestFile ) ) {
		return null;
	}
	const data = JSON.parse( fs.readFileSync( manifestFile, 'utf8' ) );
	for ( const entry of Object.values( data ) ) {
		if ( entry && entry.slug === article && entry.markdown_source ) {
			return entry.markdown_source;
		}
	}
	return null;
}

function loadDocsSlugs( manifestFile ) {
	if ( ! manifestFile || ! fs.existsSync( manifestFile ) ) {
		return null;
	}
	const data = JSON.parse( fs.readFileSync( manifestFile, 'utf8' ) );
	const slugs = new Set();
	for ( const entry of Object.values( data ) ) {
		if ( entry && entry.slug ) {
			slugs.add( entry.slug );
		}
	}
	return slugs;
}

function listImages( outDir ) {
	if ( ! fs.existsSync( outDir ) ) {
		return [];
	}
	return walk( outDir )
		.filter( ( f ) => /\.(webp|png)$/.test( f ) )
		.map( ( f ) => path.relative( outDir, f ) );
}

function rel( p ) {
	return path.relative( process.cwd(), p );
}

/**
 * Markdown lines for every shot of an article, in spec order.
 * @param {object} config
 * @param {string} article
 * @param {string} [fromFile]  Markdown file the snippet will be pasted into, for the relative path
 */
export function snippet( config, article, fromFile ) {
	const specs = loadSpecs( config ).filter( ( s ) => s.article === article );
	if ( ! specs.length ) {
		throw Object.assign( new Error( `No spec for article "${ article }"` ), { name: 'UserError' } );
	}
	// Paths are relative to the article's Markdown file: --from, else the docs manifest's markdown_source.
	let from = fromFile ? path.resolve( fromFile ) : null;
	if ( from && ! fs.existsSync( from ) ) {
		throw Object.assign( new Error( `--from file not found: ${ from }` ), { name: 'UserError' } );
	}
	if ( ! from ) {
		const source = markdownSourceFor( config.docsManifest, article );
		if ( source ) {
			from = path.resolve( config.docsDir, source );
		}
	}
	if ( ! from ) {
		throw Object.assign( new Error( `Cannot tell where "${ article }" lives; pass --from <path to its .md file>` ), { name: 'UserError' } );
	}
	const ext = extensionFor( config.style.format );
	const lines = [];
	for ( const spec of specs ) {
		for ( const shot of spec.shots ) {
			const abs = path.join( config.outDir, spec.article, `${ shot.id }.${ ext }` );
			const relPath = path.relative( path.dirname( from ), abs );
			lines.push( `![${ shot.alt }](${ relPath.split( path.sep ).join( '/' ) })` );
			if ( shot.caption ) {
				lines.push( `*${ shot.caption }*` );
			}
			lines.push( '' );
		}
	}
	return lines.join( '\n' ).trimEnd() + '\n';
}
