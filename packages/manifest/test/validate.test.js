import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateManifest } from '../src/index.js';

const BLOB = 'https://github.com/WordPress/handbook/blob/trunk';

/**
 * A minimal valid entry.
 *
 * @param {string} key    The manifest key.
 * @param {Object} extras Fields to merge in.
 * @return {Object} The entry.
 */
function entry( key, extras = {} ) {
	return {
		title: key,
		slug: key.slice( key.lastIndexOf( '/' ) + 1 ),
		parent: null,
		order: 0,
		markdown_source: `${ BLOB }/docs/${ key }.md`,
		...extras,
	};
}

const tmpDirs = [];
after( () => {
	for ( const dir of tmpDirs ) {
		fs.rmSync( dir, { recursive: true, force: true } );
	}
} );

/**
 * Write a tree of files to a fresh temp directory.
 *
 * @param {Object<string, string>} files Relative path to contents.
 * @return {string} The directory.
 */
function tmpDocs( files ) {
	const dir = fs.mkdtempSync(
		path.join( os.tmpdir(), 'wp-validate-manifest-' )
	);
	tmpDirs.push( dir );
	for ( const [ rel, contents ] of Object.entries( files ) ) {
		const fp = path.join( dir, rel );
		fs.mkdirSync( path.dirname( fp ), { recursive: true } );
		fs.writeFileSync( fp, contents );
	}
	return dir;
}

describe( 'validateManifest: shape', () => {
	test( 'a clean manifest has no findings and counts entries', () => {
		const result = validateManifest( {
			index: entry( 'index', { title: 'Handbook', slug: 'handbook' } ),
			intro: entry( 'intro' ),
			'intro/setup': entry( 'intro/setup', { parent: 'intro' } ),
		} );
		assert.deepEqual( result, { errors: [], warnings: [], entries: 3 } );
	} );

	test( 'rejects non-object manifests', () => {
		assert.throws( () => validateManifest( [] ), TypeError );
		assert.throws( () => validateManifest( null ), TypeError );
	} );

	test( 'entry must be an object', () => {
		const { errors } = validateManifest( { intro: 'nope', other: [ 1 ] } );
		assert.deepEqual( errors, [
			'intro: entry must be an object',
			'other: entry must be an object',
		] );
	} );
} );

describe( 'validateManifest: keys', () => {
	test( 'keys must not have leading or trailing slashes', () => {
		const { errors } = validateManifest( {
			'/intro/': entry( '/intro/', { slug: 'intro' } ),
		} );
		assert.ok(
			errors.includes(
				"'/intro/': key must not have leading or trailing slashes"
			)
		);
	} );

	test( 'keys that normalise to the same path are duplicates', () => {
		const { errors } = validateManifest( {
			intro: entry( 'intro' ),
			'/intro': entry( '/intro' ),
		} );
		assert.ok( errors.includes( "'/intro': duplicate of 'intro'" ) );
	} );

	test( 'distinct normalised keys are not duplicates', () => {
		const { errors } = validateManifest( {
			a: entry( 'a' ),
			b: entry( 'b' ),
		} );
		assert.deepEqual( errors, [] );
	} );
} );

describe( 'validateManifest: slugs', () => {
	test( 'slug must be a sanitized slug', () => {
		const { errors } = validateManifest( {
			Intro_Page: entry( 'Intro_Page' ),
		} );
		assert.ok(
			errors.includes(
				"Intro_Page: slug 'Intro_Page' is not a sanitized slug"
			)
		);
	} );

	test( 'slug falls back to the last path segment when missing', () => {
		const { errors } = validateManifest( {
			'a/b': entry( 'a/b', { slug: undefined, parent: null } ),
		} );
		assert.deepEqual( errors, [] );
	} );

	test( 'slug must match the last path segment', () => {
		const { errors } = validateManifest( {
			'a/b': entry( 'a/b', { slug: 'c' } ),
		} );
		assert.ok(
			errors.includes(
				"a/b: slug 'c' does not match the last path segment"
			)
		);
	} );

	test( 'index is exempt from the last-segment check', () => {
		const { errors } = validateManifest( {
			index: entry( 'index', { slug: 'handbook' } ),
		} );
		assert.deepEqual( errors, [] );
	} );

	test( 'a reused slug is a warning naming the first page', () => {
		const { warnings, errors } = validateManifest( {
			a: entry( 'a' ),
			'a/x': entry( 'a/x', { parent: 'a' } ),
			b: entry( 'b' ),
			'b/x': entry( 'b/x', { parent: 'b' } ),
		} );
		assert.deepEqual( errors, [] );
		assert.deepEqual( warnings, [
			"b/x: slug 'x' is also used by 'a/x' (safe only if both pages already exist on the site)",
		] );
	} );

	test( 'a slug containing a single quote is quoted the repr way', () => {
		const { errors } = validateManifest( { "it's": entry( "it's" ) } );
		assert.ok(
			errors.includes( 'it\'s: slug "it\'s" is not a sanitized slug' )
		);
	} );
} );

describe( 'validateManifest: parents', () => {
	test( 'parent must be a manifest key', () => {
		const { errors } = validateManifest( {
			'intro/setup': entry( 'intro/setup', { parent: 'intro' } ),
		} );
		assert.ok(
			errors.includes(
				"intro/setup: parent 'intro' is not a manifest key (use the parent's path, not its bare slug)"
			)
		);
	} );

	test( 'allowMissingParent turns a missing parent into a warning', () => {
		const { errors, warnings } = validateManifest(
			{ 'intro/setup': entry( 'intro/setup', { parent: 'intro' } ) },
			{ allowMissingParent: [ 'intro/setup' ] }
		);
		assert.deepEqual( errors, [] );
		assert.deepEqual( warnings, [
			"intro/setup: parent 'intro' is not in the manifest (allowed)",
		] );
	} );

	test( 'parent must appear before its children', () => {
		const { errors } = validateManifest( {
			'intro/setup': entry( 'intro/setup', { parent: 'intro' } ),
			intro: entry( 'intro' ),
		} );
		assert.deepEqual( errors, [
			"intro/setup: parent 'intro' must appear before its children",
		] );
	} );

	test( 'path must be under its parent', () => {
		const { errors } = validateManifest( {
			intro: entry( 'intro' ),
			'other/setup': entry( 'other/setup', { parent: 'intro' } ),
		} );
		assert.deepEqual( errors, [
			"other/setup: path is not under parent 'intro'",
		] );
	} );

	test( 'index may have a parent without being under it', () => {
		const { errors } = validateManifest( {
			intro: entry( 'intro' ),
			index: entry( 'index', { parent: 'intro' } ),
		} );
		assert.deepEqual( errors, [] );
	} );

	test( 'a nested path with no parent is a warning', () => {
		const { warnings } = validateManifest( {
			'intro/setup': entry( 'intro/setup' ),
		} );
		assert.deepEqual( warnings, [
			'intro/setup: nested path with no parent',
		] );
	} );

	test( 'a top-level path with no parent is fine', () => {
		const { warnings } = validateManifest( { intro: entry( 'intro' ) } );
		assert.deepEqual( warnings, [] );
	} );
} );

describe( 'validateManifest: order', () => {
	test( 'integer order and missing order pass', () => {
		const { errors } = validateManifest( {
			a: entry( 'a', { order: 3 } ),
			b: entry( 'b', { order: undefined } ),
		} );
		assert.deepEqual( errors, [] );
	} );

	test( 'non-integer orders fail', () => {
		const { errors } = validateManifest( {
			a: entry( 'a', { order: '1' } ),
			b: entry( 'b', { order: 1.5 } ),
			c: entry( 'c', { order: true } ),
			d: entry( 'd', { order: null } ),
		} );
		assert.deepEqual( errors, [
			'a: order must be an integer',
			'b: order must be an integer',
			'c: order must be an integer',
			'd: order must be an integer',
		] );
	} );
} );

describe( 'validateManifest: markdown_source', () => {
	test( 'a github.com blob URL passes', () => {
		const { errors, warnings } = validateManifest( { a: entry( 'a' ) } );
		assert.deepEqual( errors, [] );
		assert.deepEqual( warnings, [] );
	} );

	test( 'raw, non-md and missing sources fail', () => {
		const raw =
			'https://raw.githubusercontent.com/WordPress/handbook/trunk/docs/a.md';
		const { errors } = validateManifest( {
			a: entry( 'a', { markdown_source: raw } ),
			b: entry( 'b', { markdown_source: `${ BLOB }/docs/b.txt` } ),
			c: entry( 'c', { markdown_source: undefined } ),
			d: entry( 'd', { markdown_source: null } ),
		} );
		assert.deepEqual( errors, [
			`a: markdown_source must be a github.com/<org>/<repo>/blob/<branch>/<path>.md URL, got '${ raw }'`,
			`b: markdown_source must be a github.com/<org>/<repo>/blob/<branch>/<path>.md URL, got '${ BLOB }/docs/b.txt'`,
			"c: markdown_source must be a github.com/<org>/<repo>/blob/<branch>/<path>.md URL, got ''",
			'd: markdown_source must be a github.com/<org>/<repo>/blob/<branch>/<path>.md URL, got None',
		] );
	} );

	test( 'a relative source is a warning', () => {
		const { errors, warnings } = validateManifest( {
			a: entry( 'a', { markdown_source: 'docs/a.md' } ),
		} );
		assert.deepEqual( errors, [] );
		assert.deepEqual( warnings, [
			'a: markdown_source is a relative path; production manifests need a github.com/<org>/<repo>/blob/<branch>/ URL',
		] );
	} );

	test( 'a relative source has all leading dots and slashes stripped before resolving', () => {
		const seen = [];
		const readFile = ( fp ) => {
			seen.push( fp );
			return '# a\n';
		};
		validateManifest(
			{
				a: entry( 'a', { markdown_source: './docs/a.md' } ),
				b: entry( 'b', { markdown_source: '../docs/b.md' } ),
				c: entry( 'c', { markdown_source: './/./docs/c.md' } ),
			},
			{ docs: '/repo', readFile }
		);
		assert.deepEqual( seen, [
			'/repo/docs/a.md',
			'/repo/docs/b.md',
			'/repo/docs/c.md',
		] );
	} );

	test( 'the blob URL resolves to the path after the branch', () => {
		const seen = [];
		const readFile = ( fp ) => {
			seen.push( fp );
			return '# a\n';
		};
		validateManifest(
			{ a: entry( 'a', { markdown_source: `${ BLOB }/docs/sub/a.md` } ) },
			{ docs: '/repo', readFile }
		);
		assert.deepEqual( seen, [ '/repo/docs/sub/a.md' ] );
	} );
} );

describe( 'validateManifest: per-file checks with docs', () => {
	test( 'a well-formed file passes', () => {
		const docs = tmpDocs( {
			'docs/a.md':
				'---\ntitle: x\n---\n\n# A\n\nBody text.\n\n```html\n<!-- wp:paragraph -->\n```\n\n~~~\n# not a heading\n~~~\n',
		} );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: 'A' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [] );
	} );

	test( 'a missing source file fails', () => {
		const docs = tmpDocs( {} );
		const { errors } = validateManifest( { a: entry( 'a' ) }, { docs } );
		assert.deepEqual( errors, [
			`a: source file docs/a.md not found under ${ docs }`,
		] );
	} );

	test( 'a directory at the source path counts as missing', () => {
		const docs = tmpDocs( { 'docs/a.md/placeholder': '' } );
		const { errors } = validateManifest( { a: entry( 'a' ) }, { docs } );
		assert.deepEqual( errors, [
			`a: source file docs/a.md not found under ${ docs }`,
		] );
	} );

	test( 'the file must start with an H1', () => {
		const docs = tmpDocs( { 'docs/a.md': 'Intro text\n\n## A\n' } );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: 'A' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [
			"a: a.md must start with a single '# Title' line",
		] );
	} );

	test( 'an H1 with no text does not count', () => {
		const docs = tmpDocs( { 'docs/a.md': '# \n' } );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: '' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [
			"a: a.md must start with a single '# Title' line",
		] );
	} );

	test( 'the H1 must equal the manifest title', () => {
		const docs = tmpDocs( { 'docs/a.md': '# Alpha\n' } );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: 'A' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [
			"a: H1 'Alpha' differs from manifest title 'A'",
		] );
	} );

	test( 'an empty manifest title skips the comparison', () => {
		const docs = tmpDocs( { 'docs/a.md': '# Alpha\n' } );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: '' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [] );
	} );

	test( 'frontmatter is stripped before the H1 check', () => {
		const docs = tmpDocs( {
			'docs/a.md': '---\ntitle: A\nslug: a\n---\n# A\n',
		} );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: 'A' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [] );
	} );

	test( 'extra H1s are reported with their line number', () => {
		const docs = tmpDocs( { 'docs/a.md': '# A\n\ntext\n\n# Another\n' } );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: 'A' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [ 'a: extra H1 at line 5' ] );
	} );

	test( 'a repeated identical H1 is not an extra H1', () => {
		const docs = tmpDocs( { 'docs/a.md': '# A\n\n# A\n' } );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: 'A' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [] );
	} );

	test( 'H1s and block markup inside fences are ignored', () => {
		const docs = tmpDocs( {
			'docs/a.md':
				'# A\n\n```md\n# Example\n<!-- wp:paragraph -->\n```\n\n  ~~~\n# Indented fence\n~~~\n',
		} );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: 'A' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [] );
	} );

	test( 'raw block markup outside a fence fails with its line number', () => {
		const docs = tmpDocs( {
			'docs/a.md':
				'# A\n\n<!-- wp:paragraph -->\n<p>x</p>\n<!-- /wp:paragraph -->\n',
		} );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: 'A' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [
			"a: unescaped block markup '<!-- wp:' outside a code fence at line 3",
		] );
	} );

	test( 'an unclosed fence hides everything after it', () => {
		const docs = tmpDocs( {
			'docs/a.md': '# A\n\n```\n<!-- wp:paragraph -->\n# Hidden\n',
		} );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: 'A' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [] );
	} );

	test( 'line numbers count from the body after frontmatter, including leading blank lines', () => {
		const docs = tmpDocs( {
			'docs/a.md': '---\nx: 1\n---\n\n\n# A\n<!-- wp:x -->\n',
		} );
		const { errors } = validateManifest(
			{ a: entry( 'a', { title: 'A' } ) },
			{ docs }
		);
		assert.deepEqual( errors, [
			"a: unescaped block markup '<!-- wp:' outside a code fence at line 4",
		] );
	} );

	test( 'without docs the files are not read', () => {
		let called = false;
		const readFile = () => {
			called = true;
			return null;
		};
		const { errors } = validateManifest(
			{ a: entry( 'a' ) },
			{ readFile }
		);
		assert.deepEqual( errors, [] );
		assert.equal( called, false );
	} );
} );

describe( 'validateManifest: frozen', () => {
	const manifest = () => ( {
		intro: entry( 'intro', { order: 1 } ),
		'intro/setup': entry( 'intro/setup', { parent: 'intro', order: 2 } ),
	} );

	test( 'a frozen list that is fully present passes', () => {
		const { errors } = validateManifest( manifest(), {
			frozen: [ 'intro', 'intro/setup' ],
		} );
		assert.deepEqual( errors, [] );
	} );

	test( 'a frozen list key missing from the manifest fails', () => {
		const { errors } = validateManifest( manifest(), {
			frozen: [ 'intro', 'intro/old' ],
		} );
		assert.deepEqual( errors, [
			'intro/old: frozen page is missing from the manifest (removals and renames need a redirect PR)',
		] );
	} );

	test( 'a new page reusing a frozen slug fails (list form)', () => {
		const data = {
			...manifest(),
			guide: entry( 'guide' ),
			'guide/setup': entry( 'guide/setup', { parent: 'guide' } ),
		};
		const { errors, warnings } = validateManifest( data, {
			frozen: [ 'intro', 'intro/setup' ],
		} );
		assert.deepEqual( errors, [
			"guide/setup: new page reuses existing slug 'setup'; the importer would take over the existing post",
		] );
		assert.equal( warnings.length, 1 );
	} );

	test( 'a reused slug between two frozen pages is only the warning', () => {
		const data = {
			...manifest(),
			guide: entry( 'guide' ),
			'guide/setup': entry( 'guide/setup', { parent: 'guide' } ),
		};
		const { errors } = validateManifest( data, {
			frozen: [ 'intro', 'intro/setup', 'guide', 'guide/setup' ],
		} );
		assert.deepEqual( errors, [] );
	} );

	test( 'a frozen object with matching orders passes', () => {
		const { errors } = validateManifest( manifest(), {
			frozen: { intro: { order: 1 }, 'intro/setup': { order: 2 } },
		} );
		assert.deepEqual( errors, [] );
	} );

	test( 'a frozen object reports a changed order', () => {
		const { errors } = validateManifest( manifest(), {
			frozen: { intro: { order: 5 }, 'intro/setup': { order: 2 } },
		} );
		assert.deepEqual( errors, [
			'intro: order changed from 5 to 1 (the importer never re-applies 0)',
		] );
	} );

	test( 'a frozen object reports a removed order as None', () => {
		const data = manifest();
		delete data.intro.order;
		const { errors } = validateManifest( data, {
			frozen: { intro: { order: 5 } },
		} );
		assert.deepEqual( errors, [
			'intro: order changed from 5 to None (the importer never re-applies 0)',
		] );
	} );

	test( 'a frozen object without an order (or with null) skips the order check', () => {
		const { errors } = validateManifest( manifest(), {
			frozen: { intro: {}, 'intro/setup': { order: null } },
		} );
		assert.deepEqual( errors, [] );
	} );

	test( 'a frozen object value that is not an object is only a presence check', () => {
		const { errors } = validateManifest( manifest(), {
			frozen: { intro: true, 'intro/old': 1 },
		} );
		assert.deepEqual( errors, [
			'intro/old: frozen page is missing from the manifest (removals and renames need a redirect PR)',
		] );
	} );

	test( 'a new page reusing a frozen slug fails (object form)', () => {
		const data = { ...manifest(), setup: entry( 'setup' ) };
		const { errors } = validateManifest( data, {
			frozen: { intro: { order: 1 }, 'intro/setup': { order: 2 } },
		} );
		assert.deepEqual( errors, [
			"setup: new page reuses existing slug 'setup'; the importer would take over the existing post",
		] );
	} );

	test( 'no frozen option means no frozen checks', () => {
		const data = { ...manifest(), setup: entry( 'setup' ) };
		const { errors } = validateManifest( data );
		assert.deepEqual( errors, [] );
	} );
} );
