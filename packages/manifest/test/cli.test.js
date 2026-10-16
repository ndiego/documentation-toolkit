import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath( new URL( '../src/cli.js', import.meta.url ) );
const BLOB = 'https://github.com/WordPress/handbook/blob/trunk';

const tmpDirs = [];
after( () => {
	for ( const dir of tmpDirs ) {
		fs.rmSync( dir, { recursive: true, force: true } );
	}
} );

/**
 * Write a repo-like fixture: manifest.json plus Markdown files.
 *
 * @param {Object}                 manifest The manifest object (or any JSON value).
 * @param {Object<string, string>} files    Relative path to contents.
 * @return {string} The fixture directory.
 */
function fixture( manifest, files = {} ) {
	const dir = fs.mkdtempSync(
		path.join( os.tmpdir(), 'wp-validate-manifest-cli-' )
	);
	tmpDirs.push( dir );
	fs.writeFileSync(
		path.join( dir, 'manifest.json' ),
		JSON.stringify( manifest, null, 2 )
	);
	for ( const [ rel, contents ] of Object.entries( files ) ) {
		const fp = path.join( dir, rel );
		fs.mkdirSync( path.dirname( fp ), { recursive: true } );
		fs.writeFileSync( fp, contents );
	}
	return dir;
}

/**
 * Run the CLI.
 *
 * @param {string[]} args Command-line arguments.
 * @param {string}   cwd  Working directory.
 * @return {{ status: number, stdout: string, stderr: string, lines: string[] }} The result.
 */
function run( args, cwd ) {
	const result = spawnSync( process.execPath, [ CLI, ...args ], {
		cwd,
		encoding: 'utf8',
	} );
	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
		lines: result.stdout.split( '\n' ).filter( Boolean ),
	};
}

const good = {
	intro: {
		title: 'Intro',
		slug: 'intro',
		parent: null,
		order: 1,
		markdown_source: `${ BLOB }/docs/intro.md`,
	},
	'intro/setup': {
		title: 'Setup',
		slug: 'setup',
		parent: 'intro',
		order: 2,
		markdown_source: `${ BLOB }/docs/intro/setup.md`,
	},
};
const goodFiles = {
	'docs/intro.md': '# Intro\n\nHello.\n',
	'docs/intro/setup.md': '# Setup\n\n```\n<!-- wp:paragraph -->\n```\n',
};

describe( 'cli', () => {
	test( 'a valid manifest with --docs and --frozen exits 0 with the summary line', () => {
		const dir = fixture( good, goodFiles );
		fs.writeFileSync(
			path.join( dir, 'frozen.json' ),
			JSON.stringify( [ 'intro', 'intro/setup' ] )
		);
		const { status, lines } = run(
			[ 'manifest.json', '--docs', '.', '--frozen', 'frozen.json' ],
			dir
		);
		assert.equal( status, 0 );
		assert.deepEqual( lines, [ '2 entries, 0 errors, 0 warnings' ] );
	} );

	test( 'errors are printed after warnings and exit 1', () => {
		const dir = fixture(
			{
				...good,
				'intro/setup': { ...good[ 'intro/setup' ], slug: 'wrong' },
				'loose/page': {
					title: 'Loose',
					slug: 'page',
					parent: null,
					order: 0,
					markdown_source: 'docs/loose/page.md',
				},
			},
			{ ...goodFiles, 'docs/loose/page.md': '# Loose\n' }
		);
		const { status, lines } = run(
			[ 'manifest.json', '--docs', '.' ],
			dir
		);
		assert.equal( status, 1 );
		assert.deepEqual( lines, [
			'warning: loose/page: nested path with no parent',
			'warning: loose/page: markdown_source is a relative path; production manifests need a github.com/<org>/<repo>/blob/<branch>/ URL',
			"error: intro/setup: slug 'wrong' does not match the last path segment",
			'3 entries, 1 errors, 2 warnings',
		] );
	} );

	test( '--strict turns warnings into a failing exit code', () => {
		const dir = fixture( {
			'loose/page': {
				title: 'Loose',
				slug: 'page',
				parent: null,
				order: 0,
				markdown_source: `${ BLOB }/docs/loose/page.md`,
			},
		} );
		assert.equal( run( [ 'manifest.json' ], dir ).status, 0 );
		const strict = run( [ 'manifest.json', '--strict' ], dir );
		assert.equal( strict.status, 1 );
		assert.equal(
			strict.lines.at( -1 ),
			'1 entries, 0 errors, 1 warnings'
		);
	} );

	test( '--allow-missing-parent takes several keys until the next flag', () => {
		const dir = fixture( {
			'a/x': {
				title: 'X',
				slug: 'x',
				parent: 'a',
				order: 0,
				markdown_source: `${ BLOB }/a/x.md`,
			},
			'b/y': {
				title: 'Y',
				slug: 'y',
				parent: 'b',
				order: 0,
				markdown_source: `${ BLOB }/b/y.md`,
			},
		} );
		const { status, lines } = run(
			[
				'manifest.json',
				'--allow-missing-parent',
				'a/x',
				'b/y',
				'--strict',
			],
			dir
		);
		assert.equal( status, 1 );
		assert.deepEqual( lines, [
			"warning: a/x: parent 'a' is not in the manifest (allowed)",
			"warning: b/y: parent 'b' is not in the manifest (allowed)",
			'2 entries, 0 errors, 2 warnings',
		] );
		assert.equal(
			run(
				[ 'manifest.json', '--allow-missing-parent', 'a/x', 'b/y' ],
				dir
			).status,
			0
		);
	} );

	test( 'an unreadable manifest exits 1 with a single error line', () => {
		const dir = fixture( good );
		const missing = run( [ 'nope.json' ], dir );
		assert.equal( missing.status, 1 );
		assert.equal( missing.lines.length, 1 );
		assert.match( missing.lines[ 0 ], /^error: cannot read manifest: / );

		fs.writeFileSync( path.join( dir, 'broken.json' ), '{ not json' );
		const broken = run( [ 'broken.json' ], dir );
		assert.equal( broken.status, 1 );
		assert.match( broken.stdout, /^error: cannot read manifest: / );
	} );

	test( 'a list manifest exits 1 with the object-required message', () => {
		const dir = fixture( [ { slug: 'intro' } ] );
		const { status, lines } = run( [ 'manifest.json' ], dir );
		assert.equal( status, 1 );
		assert.deepEqual( lines, [
			'error: manifest must be a JSON object keyed by page path (list manifests cannot express duplicate slugs)',
		] );
	} );

	test( 'a frozen object with a changed order fails', () => {
		const dir = fixture( good );
		fs.writeFileSync(
			path.join( dir, 'frozen.json' ),
			JSON.stringify( {
				intro: { order: 7 },
				'intro/setup': { order: 2 },
			} )
		);
		const { status, lines } = run(
			[ 'manifest.json', '--frozen=frozen.json' ],
			dir
		);
		assert.equal( status, 1 );
		assert.deepEqual( lines, [
			'error: intro: order changed from 7 to 1 (the importer never re-applies 0)',
			'2 entries, 1 errors, 0 warnings',
		] );
	} );

	test( '--help prints usage and exits 0', () => {
		const { status, stdout } = run( [ '--help' ], os.tmpdir() );
		assert.equal( status, 0 );
		assert.match(
			stdout,
			/^wp-validate-manifest: validate a handbook manifest\.json/
		);
		assert.match( stdout, /--allow-missing-parent/ );
	} );

	test( 'a missing positional or an unknown flag exits 2 with usage on stderr', () => {
		const none = run( [], os.tmpdir() );
		assert.equal( none.status, 2 );
		assert.match( none.stderr, /required: manifest/ );
		const unknown = run( [ 'manifest.json', '--bogus' ], os.tmpdir() );
		assert.equal( unknown.status, 2 );
		assert.match( unknown.stderr, /unrecognized arguments: --bogus/ );
	} );
} );
