import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSpec } from '../src/spec.js';
import {
	setupDocs,
	setupOps,
	validateSetupOp,
	linkNote,
	runSetup,
} from '../src/setup.js';
import { fixtures, fixtureNames } from '../src/fixtures.js';
import { createSite } from '../src/site.js';

let root;
let counter = 0;

before( () => {
	root = fs.realpathSync(
		fs.mkdtempSync( path.join( os.tmpdir(), 'wp-screenshots-setup-' ) )
	);
} );

after( () => {
	fs.rmSync( root, { recursive: true, force: true } );
} );

function load( yaml ) {
	const shotsDir = path.join( root, `p${ counter++ }` );
	fs.mkdirSync( shotsDir, { recursive: true } );
	const file = path.join( shotsDir, 'spec.yml' );
	fs.writeFileSync( file, yaml );
	return loadSpec( file, { shotsDir } );
}

const shotWith = ( setup ) =>
	`article: a\nshots:\n  - id: x\n    alt: x\n    scene: post:setup-long-post\n${ setup }`;

describe( 'setup in specs', () => {
	it( 'expands a fixture name into its operations', () => {
		const [ shot ] = load( shotWith( '    setup: long-post\n' ) ).shots;
		assert.deepEqual(
			shot.setup.map( ( o ) => o.op ),
			[ 'post' ]
		);
		assert.equal( shot.setup[ 0 ].arg.slug, 'setup-long-post' );
	} );

	it( 'normalises a list of operations', () => {
		const [ shot ] = load(
			shotWith(
				'    setup:\n      - user: { login: sam, role: editor }\n      - option: { name: title, value: Hello }\n      - plugin: { slug: akismet }\n'
			)
		).shots;
		assert.deepEqual( shot.setup, [
			{ op: 'user', arg: { login: 'sam', role: 'editor' } },
			{ op: 'option', arg: { name: 'title', value: 'Hello' } },
			{ op: 'plugin', arg: { slug: 'akismet' } },
		] );
	} );

	it( 'rejects an unknown fixture with a suggestion', () => {
		assert.throws(
			() => load( shotWith( '    setup: long-pots\n' ) ),
			/unknown setup fixture "long-pots" \(did you mean "long-post"\?\)\. Known: long-post/
		);
	} );

	it( 'rejects an unknown operation with a suggestion', () => {
		assert.throws(
			() => load( shotWith( '    setup:\n      - pots: { slug: a }\n' ) ),
			/setup\[0\]: unknown operation "pots" \(did you mean "post"\?\)/
		);
	} );

	it( 'rejects a bad operation argument, naming the op', () => {
		assert.throws(
			() =>
				load(
					shotWith(
						'    setup:\n      - post: { slug: a, type: product }\n'
					)
				),
			/setup\[0\] \(post\): type must be post \| page \| wp_block/
		);
		assert.throws(
			() =>
				load(
					shotWith(
						'    setup:\n      - post: { slug: a }\n      - note: { post: a, block: core/paragraph }\n'
					)
				),
			/setup\[1\] \(note\): text is required/
		);
		assert.throws(
			() => load( shotWith( '    setup: { post: { slug: a } }\n' ) ),
			/`setup` must be a fixture name/
		);
	} );

	it( 'inherits setup from defaults unless the shot sets its own', () => {
		const spec = load(
			'article: a\ndefaults:\n  setup: second-author\nshots:\n  - id: x\n    alt: x\n  - id: y\n    alt: y\n    setup: []\n  - id: z\n    alt: z\n    preset: post-editor\n'
		);
		const [ x, y, z ] = spec.shots;
		assert.equal( x.setup[ 0 ].arg.login, 'setup-author' );
		assert.deepEqual( y.setup, [] );
		assert.equal( z.setup.length, 1 );
	} );

	it( 'changes specHash when setup changes, and not for shots without setup', () => {
		const none = load( shotWith( '' ) ).shots[ 0 ].specHash;
		const empty = load( shotWith( '    setup: []\n' ) ).shots[ 0 ].specHash;
		const a = load( shotWith( '    setup: long-post\n' ) ).shots[ 0 ]
			.specHash;
		const b = load( shotWith( '    setup: second-author\n' ) ).shots[ 0 ]
			.specHash;
		assert.equal( none, empty );
		assert.notEqual( none, a );
		assert.notEqual( a, b );
	} );
} );

describe( 'fixtures', () => {
	it( 'every fixture validates and loads', () => {
		for ( const name of fixtureNames ) {
			assert.ok( fixtures[ name ].description, name );
			for ( const item of fixtures[ name ].ops ) {
				const [ op ] = Object.keys( item );
				assert.equal(
					validateSetupOp( op, item[ op ] ),
					null,
					`${ name }: ${ op }`
				);
			}
			const [ shot ] = load( shotWith( `    setup: ${ name }\n` ) ).shots;
			assert.equal( shot.setup.length, fixtures[ name ].ops.length );
		}
	} );

	it( 'use fixed slugs, logins and dates', () => {
		for ( const name of fixtureNames ) {
			for ( const item of fixtures[ name ].ops ) {
				const arg = Object.values( item )[ 0 ];
				for ( const key of [ 'slug', 'login' ] ) {
					if ( arg[ key ] && ! item.option && ! item.plugin ) {
						assert.match(
							arg[ key ],
							/^setup-/,
							`${ name } ${ key }`
						);
					}
				}
				if ( item.post || item.note ) {
					assert.match( arg.date, /^2025-/, `${ name } date` );
				}
			}
		}
		assert.equal(
			fixtures[ 'long-post' ].ops[ 0 ].post.slug,
			'setup-long-post'
		);
	} );

	it( 'long-post has about twenty blocks', () => {
		const content = fixtures[ 'long-post' ].ops[ 0 ].post.content;
		const top = content.match( /^<!-- wp:[a-z]/gm ).length;
		assert.ok( top >= 18, `${ top } top-level blocks` );
	} );

	it( 'post-with-notes notes point at blocks that exist', () => {
		const ops = fixtures[ 'post-with-notes' ].ops;
		const post = ops.find( ( o ) => o.post ).post;
		for ( const { note } of ops.filter( ( o ) => o.note ) ) {
			assert.doesNotThrow( () =>
				linkNote( post.content, note.block.name, note.block.nth, 1 )
			);
		}
	} );
} );

describe( 'setup docs', () => {
	it( 'document every operation and nothing else', () => {
		assert.deepEqual(
			Object.keys( setupDocs ).sort(),
			[ ...setupOps ].sort()
		);
	} );
} );

describe( 'linkNote', () => {
	it( 'adds the note ID to the nth block of the name, keeping other attributes', () => {
		const html =
			'<!-- wp:paragraph -->\n<p>a</p>\n<!-- /wp:paragraph -->\n<!-- wp:group --><div><!-- wp:paragraph {"align":"center"} -->\n<p>b</p>\n<!-- /wp:paragraph --></div><!-- /wp:group -->';
		const out = linkNote( html, 'core/paragraph', 1, 42 );
		assert.match(
			out,
			/<!-- wp:paragraph {"align":"center","metadata":{"noteId":\[42\]}} -->/
		);
		assert.match( out, /^<!-- wp:paragraph -->/ );
		assert.match(
			linkNote( out, 'paragraph', 1, 43 ),
			/"noteId":\[42,43\]/
		);
	} );

	it( 'handles namespaced and self-closing blocks', () => {
		assert.equal(
			linkNote( '<!-- wp:my/thing /-->', 'my/thing', 0, 7 ),
			'<!-- wp:my/thing {"metadata":{"noteId":[7]}} /-->'
		);
	} );

	it( 'says how many blocks there are when nth is out of range', () => {
		assert.throws(
			() =>
				linkNote(
					'<!-- wp:paragraph -->\n<p>a</p>\n<!-- /wp:paragraph -->',
					'core/paragraph',
					3,
					1
				),
			/has 1 core\/paragraph block, so there is no nth 3/
		);
	} );
} );

// A fake REST server: records calls and answers the way WordPress does.
function fakeSite( handler ) {
	const calls = [];
	const site = createSite( { baseURL: 'http://example.test', context: {} } );
	const fake = {
		...site,
		calls,
		rest: async ( p, init = {} ) => {
			calls.push( [ init.method || 'GET', p, init.body ] );
			return handler( p, init );
		},
	};
	return fake;
}

describe( 'runSetup', () => {
	it( 'names the operation and keeps the REST message when one fails', async () => {
		const site = fakeSite( () => {
			throw new Error(
				'REST POST /wp/v2/users failed (500): Sorry, that username already exists!'
			);
		} );
		await assert.rejects(
			runSetup( { site }, [
				{ op: 'user', arg: { login: 'admin', role: 'author' } },
			] ),
			/^Error: setup\[0\] \(user admin\): REST POST \/wp\/v2\/users failed \(500\): Sorry, that username already exists!/
		);
	} );

	it( 'refuses a post whose slug WordPress had to change', async () => {
		const site = fakeSite( () => ( {
			id: 5,
			slug: 'taken-2',
			content: { raw: '' },
		} ) );
		await assert.rejects(
			runSetup( { site }, [ { op: 'post', arg: { slug: 'taken' } } ] ),
			/already exists/
		);
	} );
} );
