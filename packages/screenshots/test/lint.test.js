import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { lint, snippet } from '../src/lint.js';
import { loadConfig } from '../src/config.js';
import { writeManifest } from '../src/manifest.js';

let root;
let counter = 0;
let webp;

before( async () => {
	root = fs.realpathSync(
		fs.mkdtempSync( path.join( os.tmpdir(), 'wp-screenshots-lint-' ) )
	);
	webp = await sharp( {
		create: {
			width: 8,
			height: 8,
			channels: 3,
			background: { r: 56, g: 88, b: 233 },
		},
	} )
		.webp( { lossless: true } )
		.toBuffer();
} );

after( () => {
	fs.rmSync( root, { recursive: true, force: true } );
} );

const HERO_ALT = 'The Image block';
const SPEC = `
article: image-block
shots:
  - id: hero
    alt: ${ HERO_ALT }
    caption: The Image block in the editor.
  - id: settings
    alt: Image settings
`;
const MD = `# Image block\n\n![${ HERO_ALT }](../assets/screenshots/image-block/hero.webp)\n`;
const DOCS_MANIFEST = {
	'image-block': {
		slug: 'image-block',
		markdown_source: 'blocks/image-block.md',
	},
	'gallery-block': {
		slug: 'gallery-block',
		markdown_source: 'blocks/gallery-block.md',
	},
};

// Build a small project next to a docs tree:
//   project/shots.config.js, project/shots/blocks/image.yml
//   docs/manifest.json, docs/blocks/image-block.md, docs/assets/screenshots/<article>/<id>.webp + manifest.json
async function makeProject( {
	spec = SPEC,
	md = MD,
	images = [ 'image-block/hero.webp' ],
	manifest = 'auto',
	docsManifest = DOCS_MANIFEST,
	configSource = '',
} = {} ) {
	const base = path.join( root, `p${ counter++ }` );
	const project = path.join( base, 'project' );
	const docs = path.join( base, 'docs' );
	const outDir = path.join( docs, 'assets', 'screenshots' );
	const write = ( file, content ) => {
		fs.mkdirSync( path.dirname( file ), { recursive: true } );
		fs.writeFileSync( file, content );
	};
	write(
		path.join( project, 'shots.config.js' ),
		`export default { docsManifest: '../docs/manifest.json', ${ configSource } };\n`
	);
	if ( spec !== null ) {
		write( path.join( project, 'shots', 'blocks', 'image.yml' ), spec );
	}
	if ( md !== null ) {
		write( path.join( docs, 'blocks', 'image-block.md' ), md );
	}
	if ( docsManifest !== null ) {
		write(
			path.join( docs, 'manifest.json' ),
			JSON.stringify( docsManifest, null, 2 )
		);
	}
	for ( const image of images ) {
		write( path.join( outDir, image ), webp );
	}
	if ( manifest === 'auto' ) {
		const shots = {};
		for ( const image of images ) {
			shots[ image.replace( /\.webp$/, '' ) ] = {
				file: image,
				article: image.split( '/' )[ 0 ],
				specHash: 'abcd',
				pixelHash: '1234',
				encoding: 'webp-lossless',
			};
		}
		writeManifest( outDir, { shots } );
	} else if ( manifest ) {
		writeManifest( outDir, manifest );
	}
	const config = await loadConfig( path.join( project, 'shots.config.js' ) );
	return {
		config,
		project,
		docs,
		outDir,
		mdFile: path.join( docs, 'blocks', 'image-block.md' ),
	};
}

// Run lint with a captured log.
function run( config, opts = {} ) {
	const log = [];
	const result = lint( config, { ...opts, log: ( s ) => log.push( s ) } );
	return { ...result, log };
}

describe( 'lint', () => {
	it( 'passes a consistent project and prints the summary line', async () => {
		const { config } = await makeProject();
		const { ok, errors, warnings, log } = run( config );
		assert.deepEqual( errors, [] );
		assert.deepEqual( warnings, [] );
		assert.equal( ok, true );
		assert.deepEqual( log, [
			'1 spec file(s), 2 shot(s), 1 generated image(s): 0 error(s), 0 warning(s)',
		] );
	} );

	it( 'flags a generated image that no spec produces (orphan)', async () => {
		const { config } = await makeProject( {
			images: [ 'image-block/hero.webp', 'image-block/old.webp' ],
			manifest: null,
		} );
		const { ok, errors, log } = run( config );
		assert.equal( ok, false );
		assert.equal( errors.length, 1 );
		assert.match(
			errors[ 0 ],
			/image-block\/old\.webp: no spec produces this image \(delete it or add a shot\)$/
		);
		assert.ok( log.includes( `error: ${ errors[ 0 ] }` ) );
	} );

	it( 'flags a Markdown reference to a shot that has not been generated yet', async () => {
		const md = `${ MD }\n![Image settings](../assets/screenshots/image-block/settings.webp)\n`;
		const { config } = await makeProject( { md } );
		const { errors, warnings } = run( config );
		assert.deepEqual( warnings, [] );
		assert.equal( errors.length, 1 );
		assert.match(
			errors[ 0 ],
			/image-block\.md: references \.\.\/assets\/screenshots\/image-block\/settings\.webp, which has not been generated yet \(run `wp-screenshots run --article image-block`\)$/
		);
	} );

	it( 'flags a Markdown reference into outDir that no spec produces', async () => {
		const md = `${ MD }\n![Ghost](../assets/screenshots/image-block/ghost.webp)\n`;
		const { config } = await makeProject( { md } );
		const { errors } = run( config );
		assert.equal( errors.length, 1 );
		assert.match(
			errors[ 0 ],
			/image-block\.md: references \.\.\/assets\/screenshots\/image-block\/ghost\.webp, which no spec produces$/
		);
	} );

	it( 'warns about a generated image referenced by no Markdown file', async () => {
		const { config } = await makeProject( {
			md: '# Image block\n\nNo images here.\n',
		} );
		const { ok, errors, warnings, log } = run( config );
		assert.equal( ok, true, 'warnings do not fail the lint' );
		assert.deepEqual( errors, [] );
		assert.equal( warnings.length, 1 );
		assert.match(
			warnings[ 0 ],
			/image-block\/hero\.webp: generated but referenced by no Markdown file$/
		);
		assert.ok( log.includes( `warning: ${ warnings[ 0 ] }` ) );
	} );

	it( 'does not warn about unreferenced images when the docs tree has no Markdown at all', async () => {
		const { config } = await makeProject( { md: null } );
		const { warnings } = run( config );
		assert.deepEqual( warnings, [] );
	} );

	it( 'warns when the Markdown alt text differs from the spec', async () => {
		const md =
			'# Image block\n\n![An image](../assets/screenshots/image-block/hero.webp "Title kept")\n';
		const { config, mdFile } = await makeProject( { md } );
		const { ok, errors, warnings, log } = run( config );
		assert.equal( ok, true );
		assert.deepEqual( errors, [] );
		assert.equal( warnings.length, 1 );
		assert.match(
			warnings[ 0 ],
			/image-block\.md: alt text for \.\.\/assets\/screenshots\/image-block\/hero\.webp differs from the spec \(run with --fix\)$/
		);
		assert.equal(
			fs.readFileSync( mdFile, 'utf8' ),
			md,
			'the file is untouched without --fix'
		);
		assert.ok( ! log.some( ( l ) => l.startsWith( 'fixed' ) ) );
	} );

	it( '--fix rewrites the alt text from the spec, keeping the path and title', async () => {
		const md =
			'# Image block\n\nIntro.\n\n![An image](../assets/screenshots/image-block/hero.webp "Title kept")\n\n![External](https://example.com/x.png)\n';
		const { config, mdFile } = await makeProject( { md } );
		const { ok, warnings, log } = run( config, { fix: true } );
		assert.equal( ok, true );
		assert.deepEqual( warnings, [] );
		assert.equal(
			fs.readFileSync( mdFile, 'utf8' ),
			`# Image block\n\nIntro.\n\n![${ HERO_ALT }](../assets/screenshots/image-block/hero.webp "Title kept")\n\n![External](https://example.com/x.png)\n`
		);
		assert.ok(
			log.some( ( l ) =>
				/^fixed alt text in .*image-block\.md$/.test( l )
			)
		);
		// A second run is clean and does not rewrite.
		const again = run( config, { fix: true } );
		assert.deepEqual( again.warnings, [] );
		assert.ok( ! again.log.some( ( l ) => l.startsWith( 'fixed' ) ) );
	} );

	it( 'treats a path with the wrong ../ depth into the screenshots folder as an error', async () => {
		const md = `# Image block\n\n![${ HERO_ALT }](../../assets/screenshots/image-block/hero.webp)\n`;
		const { config } = await makeProject( { md } );
		const { ok, errors, warnings } = run( config );
		assert.equal( ok, false );
		assert.equal( errors.length, 1 );
		assert.match(
			errors[ 0 ],
			/image-block\.md: \.\.\/\.\.\/assets\/screenshots\/image-block\/hero\.webp looks like a generated screenshot but does not resolve into .*screenshots \(check the \.\.\/ depth; `wp-screenshots snippet --article <slug>` prints the right path\)$/
		);
		// The image is then also unreferenced.
		assert.equal( warnings.length, 1 );
		assert.match(
			warnings[ 0 ],
			/generated but referenced by no Markdown file$/
		);
	} );

	it( 'ignores images outside outDir that do not look like screenshots, and absolute URLs', async () => {
		const md = `${ MD }\n![Logo](../images/logo.png)\n![Remote](https://example.com/shot.webp)\n![Data](data:image/png;base64,AAAA)\n`;
		const { config } = await makeProject( { md } );
		const { errors, warnings } = run( config );
		assert.deepEqual( errors, [] );
		assert.deepEqual( warnings, [] );
	} );

	it( 'requires the article slug to exist in the docs manifest when one is configured', async () => {
		const { config } = await makeProject( {
			docsManifest: { other: { slug: 'other' } },
		} );
		const { errors } = run( config );
		assert.equal( errors.length, 1 );
		assert.match(
			errors[ 0 ],
			/blocks\/image\.yml: article "image-block" is not in .*docs\/manifest\.json$/
		);
	} );

	it( 'skips the slug check when no docs manifest is configured or present', async () => {
		const { config } = await makeProject( { docsManifest: null } );
		assert.equal( run( config ).ok, true );
	} );

	it( 'flags a manifest entry whose file is gone', async () => {
		const manifest = {
			shots: {
				'image-block/hero': { file: 'image-block/hero.webp' },
				'image-block/gone': { file: 'image-block/gone.webp' },
			},
		};
		const { config } = await makeProject( { manifest } );
		const { errors } = run( config );
		assert.deepEqual( errors, [
			'manifest: image-block/gone points at a missing file image-block/gone.webp',
		] );
	} );

	it( 'stops at an invalid spec and reports only that', async () => {
		const { config } = await makeProject( {
			spec: 'article: image-block\nshots:\n  - id: Hero\n    alt: x\n',
			images: [ 'image-block/stray.webp' ],
		} );
		const { ok, errors, warnings, log } = run( config );
		assert.equal( ok, false );
		assert.equal( errors.length, 1 );
		assert.match(
			errors[ 0 ],
			/image\.yml: shots\[0\] \("Hero"\): `id` is required and must be a lowercase slug/
		);
		assert.deepEqual( warnings, [] );
		assert.equal(
			log.at( -1 ),
			'0 spec file(s), 0 shot(s), 0 generated image(s): 1 error(s), 0 warning(s)'
		);
	} );

	it( 'uses the configured output format for expected file names', async () => {
		const { config } = await makeProject( {
			configSource: "format: 'png'",
			images: [ 'image-block/hero.png' ],
			md: `# Image block\n\n![${ HERO_ALT }](../assets/screenshots/image-block/hero.png)\n`,
		} );
		assert.equal( run( config ).ok, true );
		// The webp twin is now an orphan.
		const { config: mixed } = await makeProject( {
			configSource: "format: 'png'",
			images: [ 'image-block/hero.png', 'image-block/hero.webp' ],
			md: `# Image block\n\n![${ HERO_ALT }](../assets/screenshots/image-block/hero.png)\n`,
		} );
		const { errors } = run( mixed );
		assert.equal( errors.length, 1 );
		assert.match( errors[ 0 ], /hero\.webp: no spec produces this image/ );
	} );
} );

describe( 'snippet', () => {
	it( 'prints a Markdown image (and caption) per shot, relative to the article from the docs manifest', async () => {
		const { config } = await makeProject();
		assert.equal(
			snippet( config, 'image-block' ),
			[
				`![${ HERO_ALT }](../assets/screenshots/image-block/hero.webp)`,
				'*The Image block in the editor.*',
				'',
				'![Image settings](../assets/screenshots/image-block/settings.webp)',
				'',
			].join( '\n' )
		);
	} );

	it( 'computes the path relative to --from when given', async () => {
		const { config, docs } = await makeProject();
		const from = path.join( docs, 'deep', 'nested', 'page.md' );
		fs.mkdirSync( path.dirname( from ), { recursive: true } );
		fs.writeFileSync( from, '' );
		const out = snippet( config, 'image-block', from );
		assert.ok(
			out.startsWith(
				`![${ HERO_ALT }](../../assets/screenshots/image-block/hero.webp)\n`
			)
		);
	} );

	it( 'uses the configured format extension', async () => {
		const { config } = await makeProject( {
			configSource: "format: 'png'",
		} );
		assert.match( snippet( config, 'image-block' ), /hero\.png\)/ );
	} );

	it( 'raises UserErrors for an unknown article, a missing --from file and an unlocatable article', async () => {
		const { config, docs } = await makeProject();
		assert.throws(
			() => snippet( config, 'nope' ),
			( e ) =>
				e.name === 'UserError' &&
				/No spec for article "nope"/.test( e.message )
		);
		assert.throws(
			() =>
				snippet(
					config,
					'image-block',
					path.join( docs, 'missing.md' )
				),
			( e ) =>
				e.name === 'UserError' &&
				/--from file not found/.test( e.message )
		);

		const { config: noManifest } = await makeProject( {
			docsManifest: null,
		} );
		assert.throws(
			() => snippet( noManifest, 'image-block' ),
			( e ) =>
				e.name === 'UserError' &&
				/Cannot tell where "image-block" lives; pass --from/.test(
					e.message
				)
		);
	} );
} );
