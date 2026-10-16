import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	manifestPath,
	readManifest,
	writeManifest,
	shotMetadata,
	metadataChanged,
} from '../src/manifest.js';

let root;
let counter = 0;

before( () => {
	root = fs.mkdtempSync(
		path.join( os.tmpdir(), 'wp-screenshots-manifest-' )
	);
} );

after( () => {
	fs.rmSync( root, { recursive: true, force: true } );
} );

const outDir = () => path.join( root, `out${ counter++ }` );

const ENTRY = {
	specHash: 'abcd',
	pixelHash: '1234',
	file: 'image-block/hero.webp',
	article: 'image-block',
	alt: 'The Image block',
	caption: null,
	suite: 'default',
	kind: 'image',
	encoding: 'webp-lossless',
};

describe( 'manifestPath', () => {
	it( 'is manifest.json inside the output directory', () => {
		assert.equal( manifestPath( '/x/out' ), '/x/out/manifest.json' );
	} );
} );

describe( 'readManifest', () => {
	it( 'returns an empty manifest when none exists', () => {
		assert.deepEqual( readManifest( path.join( root, 'nowhere' ) ), {
			version: 1,
			shots: {},
		} );
	} );

	it( 'tolerates a file without a shots map', () => {
		const dir = outDir();
		fs.mkdirSync( dir );
		fs.writeFileSync( manifestPath( dir ), '{"version":1}' );
		assert.deepEqual( readManifest( dir ), { version: 1, shots: {} } );
	} );

	it( 'reports a corrupt file by path', () => {
		const dir = outDir();
		fs.mkdirSync( dir );
		fs.writeFileSync( manifestPath( dir ), '{ not json' );
		assert.throws(
			() => readManifest( dir ),
			new RegExp(
				`^Error: Could not parse ${ manifestPath( dir ).replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) }: `
			)
		);
	} );
} );

describe( 'writeManifest', () => {
	it( 'round-trips through readManifest and creates the directory', () => {
		const dir = path.join( outDir(), 'nested', 'deeper' );
		const shots = { 'image-block/hero': ENTRY };
		writeManifest( dir, { shots } );
		assert.deepEqual( readManifest( dir ), { version: 1, shots } );
	} );

	it( 'writes sorted shot keys and sorted entry keys, 2-space indented, with a trailing newline', () => {
		const dir = outDir();
		writeManifest( dir, {
			shots: {
				'z-article/b': { b: 1, a: 2 },
				'a-article/z': ENTRY,
				'a-article/a': { z: 1, m: 2, a: 3 },
			},
		} );
		const text = fs.readFileSync( manifestPath( dir ), 'utf8' );
		assert.ok( text.endsWith( '}\n' ) );
		assert.ok( ! text.endsWith( '\n\n' ) );
		const data = JSON.parse( text );
		assert.equal( data.version, 1 );
		assert.deepEqual( Object.keys( data ), [ 'version', 'shots' ] );
		assert.deepEqual( Object.keys( data.shots ), [
			'a-article/a',
			'a-article/z',
			'z-article/b',
		] );
		assert.deepEqual( Object.keys( data.shots[ 'a-article/a' ] ), [
			'a',
			'm',
			'z',
		] );
		assert.deepEqual(
			Object.keys( data.shots[ 'a-article/z' ] ),
			[ ...Object.keys( ENTRY ) ].sort()
		);
		assert.equal( text, JSON.stringify( data, null, 2 ) + '\n' );
	} );

	it( 'is idempotent: rewriting the same content gives identical bytes regardless of input key order', () => {
		const a = outDir();
		const b = outDir();
		writeManifest( a, {
			shots: { 'x/one': { b: 1, a: 2 }, 'x/two': { k: 1 } },
		} );
		writeManifest( b, {
			shots: { 'x/two': { k: 1 }, 'x/one': { a: 2, b: 1 } },
		} );
		assert.equal(
			fs.readFileSync( manifestPath( a ), 'utf8' ),
			fs.readFileSync( manifestPath( b ), 'utf8' )
		);
	} );

	it( 'overwrites an existing manifest wholesale', () => {
		const dir = outDir();
		writeManifest( dir, { shots: { 'x/old': { k: 1 } } } );
		writeManifest( dir, { shots: { 'x/new': { k: 2 } } } );
		assert.deepEqual( Object.keys( readManifest( dir ).shots ), [
			'x/new',
		] );
	} );
} );

describe( 'shotMetadata', () => {
	it( 'picks the spec-side fields for a shot', () => {
		const spec = {
			article: 'image-block',
			suite: 'woo',
			file: '/x/spec.yml',
		};
		const shot = {
			id: 'hero',
			alt: 'Alt',
			caption: 'Cap',
			kind: 'clip',
			specHash: 'abcd',
			steps: [],
		};
		assert.deepEqual( shotMetadata( spec, shot, 'image-block/hero.webp' ), {
			file: 'image-block/hero.webp',
			article: 'image-block',
			alt: 'Alt',
			caption: 'Cap',
			suite: 'woo',
			kind: 'clip',
			specHash: 'abcd',
		} );
	} );
} );

describe( 'metadataChanged', () => {
	const meta = {
		file: 'a/b.webp',
		article: 'a',
		alt: 'Alt',
		caption: null,
		suite: 'default',
		kind: 'image',
		specHash: 'abcd',
	};

	it( 'is true when there is no existing entry', () => {
		assert.equal( metadataChanged( null, meta ), true );
		assert.equal( metadataChanged( undefined, meta ), true );
	} );

	it( 'ignores render-only fields on the existing entry and treats a missing caption as null', () => {
		const existing = { ...meta, pixelHash: '1234', encoding: 'webp-q90' };
		delete existing.caption;
		assert.equal( metadataChanged( existing, meta ), false );
	} );

	it( 'is true when any metadata field differs', () => {
		assert.equal(
			metadataChanged( { ...meta, alt: 'Other' }, meta ),
			true
		);
		assert.equal(
			metadataChanged( { ...meta, caption: 'Now captioned' }, meta ),
			true
		);
		assert.equal(
			metadataChanged( { ...meta, specHash: 'ffff' }, meta ),
			true
		);
		assert.equal(
			metadataChanged( { ...meta, file: 'a/b.png' }, meta ),
			true
		);
	} );
} );
