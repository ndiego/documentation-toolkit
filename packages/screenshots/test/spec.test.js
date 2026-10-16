import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSpecs, loadSpec, filterSpecs, SpecError } from '../src/spec.js';

let root;
let counter = 0;

before( () => {
	root = fs.realpathSync(
		fs.mkdtempSync( path.join( os.tmpdir(), 'wp-screenshots-spec-' ) )
	);
} );

after( () => {
	fs.rmSync( root, { recursive: true, force: true } );
} );

// A fresh shots directory holding the given files ({ 'relative/path.yml': 'yaml text' }).
function project( files ) {
	const shotsDir = path.join( root, `p${ counter++ }`, 'shots' );
	for ( const [ rel, text ] of Object.entries( files ) ) {
		const file = path.join( shotsDir, rel );
		fs.mkdirSync( path.dirname( file ), { recursive: true } );
		fs.writeFileSync( file, text );
	}
	return { shotsDir };
}

// Load a single spec file from the given YAML text.
function load( yaml, name = 'spec.yml' ) {
	const config = project( { [ name ]: yaml } );
	return loadSpec( path.join( config.shotsDir, name ), config );
}

const VALID = `
article: image-block
shots:
  - id: hero
    alt: The Image block
`;

describe( 'loadSpec', () => {
	it( 'loads a minimal spec with every default applied', () => {
		const spec = load( VALID );
		assert.equal( spec.article, 'image-block' );
		assert.equal( spec.suite, 'default' );
		assert.equal( spec.relPath, 'spec.yml' );
		assert.equal( spec.shots.length, 1 );
		const shot = spec.shots[ 0 ];
		assert.match( shot.specHash, /^[0-9a-f]{16}$/ );
		delete shot.specHash;
		assert.deepEqual( shot, {
			id: 'hero',
			preset: null,
			kind: 'image',
			alt: 'The Image block',
			caption: null,
			scene: 'new-post',
			viewport: 'desktop',
			isolated: false,
			steps: [],
			script: null,
			capture: {
				target: null,
				include: [],
				pad: undefined,
				frame: null,
				annotate: [],
				annotationScale: undefined,
				mask: [],
				fit: null,
			},
		} );
	} );

	it( 'expands defaults into each shot and lets the shot override them', () => {
		const spec = load( `
article: image-block
suite: woo
defaults:
  scene: new-post
  viewport: narrow
  steps:
    - openInspector
  capture:
    target: inspector
    pad: 8
shots:
  - id: settings
    alt: "  Image settings  "
    caption: "  The settings panel.  "
    kind: clip
    isolated: true
    steps:
      - click: Replace
      - type: Hello
    capture:
      frame: card
  - id: toolbar
    alt: Toolbar
    viewport: mobile
    capture:
      target: block-toolbar
      pad: 0
` );
		assert.equal( spec.suite, 'woo' );
		const [ settings, toolbar ] = spec.shots;
		assert.equal( settings.alt, 'Image settings' );
		assert.equal( settings.caption, 'The settings panel.' );
		assert.equal( settings.kind, 'clip' );
		assert.equal( settings.isolated, true );
		assert.equal( settings.viewport, 'narrow' );
		assert.deepEqual( settings.steps, [
			{
				verb: 'openInspector',
				arg: undefined,
				origin: 'defaults',
				index: 0,
			},
			{ verb: 'click', arg: 'Replace', origin: 'shot', index: 0 },
			{ verb: 'type', arg: 'Hello', origin: 'shot', index: 1 },
		] );
		assert.equal( settings.capture.target, 'inspector' );
		assert.equal( settings.capture.pad, 8 );
		assert.equal( settings.capture.frame, 'card' );
		assert.equal( toolbar.viewport, 'mobile' );
		assert.equal( toolbar.capture.target, 'block-toolbar' );
		assert.equal( toolbar.capture.pad, 0 );
		assert.equal( toolbar.capture.frame, null );
	} );

	it( 'does not inherit default steps into a shot that uses a different scene', () => {
		const spec = load( `
article: a
defaults:
  steps:
    - openInspector
shots:
  - id: one
    alt: A
  - id: two
    alt: B
    scene: admin:plugins.php
    steps:
      - press: Escape
` );
		assert.deepEqual(
			spec.shots[ 0 ].steps.map( ( s ) => s.verb ),
			[ 'openInspector' ]
		);
		assert.equal( spec.shots[ 1 ].scene, 'admin:plugins.php' );
		assert.deepEqual(
			spec.shots[ 1 ].steps.map( ( s ) => s.verb ),
			[ 'press' ]
		);
	} );

	it( 'normalises include, mask and annotate into lists', () => {
		const spec = load( `
article: a
shots:
  - id: one
    alt: A
    capture:
      target: inspector
      include: block-toolbar
      mask: { selector: ".date" }
      fit: content
      annotate:
        - outline: self
        - badge: { button: Replace, label: "1", position: bottom-right }
        - dim: { target: inspector-panel:Dimensions }
` );
		const { capture } = spec.shots[ 0 ];
		assert.deepEqual( capture.include, [ 'block-toolbar' ] );
		assert.deepEqual( capture.mask, [ { selector: '.date' } ] );
		assert.equal( capture.fit, 'content' );
		assert.deepEqual( capture.annotate, [
			{ type: 'outline', self: true },
			{
				type: 'badge',
				button: 'Replace',
				label: '1',
				position: 'bottom-right',
			},
			{ type: 'dim', target: 'inspector-panel:Dimensions' },
		] );
	} );

	it( 'resolves a shot script relative to the spec file', () => {
		const config = project( {
			'spec.yml': `
article: a
shots:
  - id: one
    alt: A
    script: ./one.js
`,
			'one.js': 'export default async () => {};\n',
		} );
		const spec = loadSpec(
			path.join( config.shotsDir, 'spec.yml' ),
			config
		);
		assert.equal(
			spec.shots[ 0 ].script,
			path.join( config.shotsDir, 'one.js' )
		);
	} );

	it( 'rejects a missing script', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    script: ./nope.js
` ),
			/script not found/
		);
	} );

	it( 'throws a SpecError naming the file for invalid YAML', () => {
		assert.throws(
			() => load( 'article: [unclosed' ),
			( e ) => {
				assert.ok( e instanceof SpecError );
				assert.equal( e.name, 'SpecError' );
				assert.match( e.message, /spec\.yml: invalid YAML/ );
				assert.ok( e.file.endsWith( 'spec.yml' ) );
				return true;
			}
		);
	} );
} );

describe( 'loadSpec: unknown names are rejected at load time', () => {
	it( 'unknown top-level key, with a suggestion', () => {
		assert.throws(
			() =>
				load( `
article: a
shotz:
  - id: one
    alt: A
` ),
			/top level: unknown key "shotz" \(did you mean "shots"\?\)\. Allowed: article, suite, defaults, shots/
		);
	} );

	it( 'unknown defaults key', () => {
		assert.throws(
			() =>
				load( `
article: a
defaults:
  viewpor: desktop
shots:
  - id: one
    alt: A
` ),
			/defaults: unknown key "viewpor" \(did you mean "viewport"\?\)/
		);
	} );

	it( 'unknown shot key, locating the shot by index and id', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    caption: ok
  - id: two
    altt: B
` ),
			/shots\[1\] \("two"\): unknown key "altt" \(did you mean "alt"\?\)/
		);
	} );

	it( 'unknown capture key', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    capture:
      padd: 4
` ),
			/shots\[0\] \("one"\) capture: unknown key "padd" \(did you mean "pad"\?\)/
		);
	} );

	it( 'far-off key gets no suggestion', () => {
		assert.throws(
			() =>
				load( `
article: a
banana: 1
shots:
  - id: one
    alt: A
` ),
			( e ) => {
				assert.match( e.message, /unknown key "banana"\. Allowed:/ );
				assert.doesNotMatch( e.message, /did you mean/ );
				return true;
			}
		);
	} );

	it( 'unknown step verb, with a suggestion', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    steps:
      - clik: Replace
` ),
			/steps\[0\]: unknown step "clik" \(did you mean "click"\?\)\. Known: insertBlock/
		);
	} );

	it( 'unknown bare-string verb in defaults', () => {
		assert.throws(
			() =>
				load( `
article: a
defaults:
  steps: [ openInspecter ]
shots:
  - id: one
    alt: A
` ),
			/defaults: steps\[0\]: unknown step "openInspecter" \(did you mean "openInspector"\?\)/
		);
	} );

	it( 'step mapping with more than one key', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    steps:
      - click: Replace
        type: x
` ),
			/steps\[0\] must have exactly one key \(the verb\), got click, type\. Indent/
		);
	} );

	it( 'step that is neither a string nor a mapping', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    steps:
      - 42
` ),
			/steps\[0\] must be a string or a single-key mapping/
		);
	} );

	it( 'steps that is not a list', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    steps: click
` ),
			/`steps` must be a list/
		);
	} );

	it( 'unknown scene in defaults and in a shot, with a suggestion', () => {
		assert.throws(
			() =>
				load( `
article: a
defaults:
  scene: new-psot
shots:
  - id: one
    alt: A
` ),
			/defaults: unknown scene "new-psot" \(did you mean "new-post"\?\)\. Known: new-post, new-page/
		);
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    scene: site-editr:styles
` ),
			/shots\[0\] \("one"\): unknown scene "site-editr:styles" \(did you mean "site-editor"\?\)/
		);
	} );

	it( 'unknown capture target and include target', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    capture:
      target: inspectr
` ),
			/capture: unknown target "inspectr"\. Known targets: editor, .*inspector-panel:<name>\. A CSS selector must start with/
		);
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    capture:
      include: [ inspector, toolbar ]
` ),
			/capture\.include: unknown target "toolbar"/
		);
	} );

	it( 'accepts selector-looking capture targets and inspector panels', () => {
		const spec = load( `
article: a
shots:
  - id: one
    alt: A
    capture:
      target: "#the-list tr:first-child"
      include: [ ".notice", "inspector-panel:Dimensions" ]
` );
		assert.equal(
			spec.shots[ 0 ].capture.target,
			'#the-list tr:first-child'
		);
	} );

	it( 'unknown locator key in a click/hover/scrollTo step', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    steps:
      - click: { buton: Replace }
` ),
			/steps\[0\] \(click\): unknown locator key "buton"\. Use one of: button, link/
		);
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    steps:
      - hover: { button: A, link: B }
` ),
			/steps\[0\] \(hover\): a locator needs exactly one of .* \(got button, link\)/
		);
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    steps:
      - scrollTo: 7
` ),
			/steps\[0\] \(scrollTo\): a locator must be a string/
		);
	} );

	it( 'unknown locator key in mask and annotate', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    capture:
      mask: { selectr: ".x" }
` ),
			/capture\.mask: unknown locator key "selectr"/
		);
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
    capture:
      annotate:
        - outline: { buton: Replace }
` ),
			/capture\.annotate\[0\] \(outline\): unknown locator key "buton"/
		);
	} );

	it( 'annotation shape, type, target and position are validated', () => {
		const base = ( annotate ) => `
article: a
shots:
  - id: one
    alt: A
    capture:
      annotate:
${ annotate }
`;
		assert.throws(
			() => load( base( '        - { outline: self, badge: self }' ) ),
			/annotate\[0\] must be a single-key mapping/
		);
		assert.throws(
			() => load( base( '        - circle: self' ) ),
			/annotate\[0\]: unknown annotation "circle" \(outline \| badge \| arrow \| dim\)/
		);
		assert.throws(
			() => load( base( '        - outline: Replace' ) ),
			/annotate\[0\] \(outline\): give it a locator/
		);
		assert.throws(
			() => load( base( '        - outline: { target: nowhere }' ) ),
			/annotate\[0\] \(outline\): unknown target "nowhere"/
		);
		assert.throws(
			() =>
				load(
					base(
						'        - badge: { button: Replace, position: middle }'
					)
				),
			/annotate\[0\]: position must be top-left/
		);
	} );

	it( 'kind, frame, fit and pad are validated', () => {
		const shot = ( extra ) => `
article: a
shots:
  - id: one
    alt: A
${ extra }
`;
		assert.throws(
			() => load( shot( '    kind: video' ) ),
			/unknown kind "video" \(image \| clip\)/
		);
		assert.throws(
			() => load( shot( '    capture: { frame: shadow }' ) ),
			/unknown frame "shadow" \(plain \| none \| card \| auto \| wide \| standard \| portrait \| banner\)/
		);
		assert.throws(
			() => load( shot( '    capture: { fit: cover }' ) ),
			/unknown fit "cover" \(only "content"\)/
		);
		assert.throws(
			() => load( shot( '    capture: { pad: -1 }' ) ),
			/pad must be a number of CSS pixels/
		);
		assert.throws(
			() => load( shot( '    capture: { pad: "8px" }' ) ),
			/pad must be a number of CSS pixels/
		);
	} );
} );

describe( 'loadSpec: required fields', () => {
	it( 'article is required and must be a slug', () => {
		assert.throws(
			() =>
				load( `
shots:
  - id: one
    alt: A
` ),
			/`article` is required and must be a lowercase slug/
		);
		assert.throws(
			() =>
				load( `
article: Image Block
shots:
  - id: one
    alt: A
` ),
			/`article` is required/
		);
	} );

	it( 'shots must be a non-empty list', () => {
		assert.throws(
			() => load( 'article: a\n' ),
			/`shots` must be a non-empty list/
		);
		assert.throws(
			() => load( 'article: a\nshots: []\n' ),
			/`shots` must be a non-empty list/
		);
		assert.throws(
			() => load( 'article: a\nshots:\n  - hero\n' ),
			/shots\[0\] must be a mapping/
		);
	} );

	it( 'shot id must match [a-z0-9-]+', () => {
		for ( const bad of [
			'Hero',
			'hero shot',
			'hero_shot',
			'-hero',
			'héro',
		] ) {
			assert.throws(
				() =>
					load( `
article: a
shots:
  - id: "${ bad }"
    alt: A
` ),
				/`id` is required and must be a lowercase slug \(a-z, 0-9, -\)/,
				bad
			);
		}
		assert.throws(
			() =>
				load( `
article: a
shots:
  - alt: A
` ),
			/shots\[0\]: `id` is required/
		);
		const ok = load( `
article: a
shots:
  - id: 2nd-hero-9
    alt: A
` );
		assert.equal( ok.shots[ 0 ].id, '2nd-hero-9' );
	} );

	it( 'alt is required and must not be blank', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
` ),
			/shots\[0\] \("one"\): `alt` is required \(the image's alt text\)/
		);
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: "   "
` ),
			/`alt` is required/
		);
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: 42
` ),
			/`alt` is required/
		);
	} );

	it( 'duplicate shot ids within a file', () => {
		assert.throws(
			() =>
				load( `
article: a
shots:
  - id: one
    alt: A
  - id: one
    alt: B
` ),
			/duplicate shot id "one"/
		);
	} );
} );

describe( 'loadSpecs', () => {
	it( 'walks the shots directory, sorted, and ignores non-YAML files', () => {
		const config = project( {
			'b/second.yaml': 'article: b\nshots:\n  - { id: x, alt: X }\n',
			'a/first.yml': 'article: a\nshots:\n  - { id: x, alt: X }\n',
			'a/notes.md': '# not a spec\n',
			'a/helper.js': 'export default 1;\n',
		} );
		const specs = loadSpecs( config );
		assert.deepEqual(
			specs.map( ( s ) => s.relPath ),
			[ 'a/first.yml', 'b/second.yaml' ]
		);
	} );

	it( 'returns an empty list for a missing shots directory', () => {
		assert.deepEqual(
			loadSpecs( { shotsDir: path.join( root, 'does-not-exist' ) } ),
			[]
		);
	} );

	it( 'rejects the same article/shot defined in two files', () => {
		const config = project( {
			'one.yml': 'article: a\nshots:\n  - { id: hero, alt: X }\n',
			'two.yml': 'article: a\nshots:\n  - { id: hero, alt: Y }\n',
		} );
		assert.throws(
			() => loadSpecs( config ),
			/two\.yml: shot "a\/hero" is also defined in one\.yml/
		);
	} );

	it( 'allows the same shot id under different articles', () => {
		const config = project( {
			'one.yml': 'article: a\nshots:\n  - { id: hero, alt: X }\n',
			'two.yml': 'article: b\nshots:\n  - { id: hero, alt: Y }\n',
		} );
		assert.equal( loadSpecs( config ).length, 2 );
	} );
} );

describe( 'specHash', () => {
	const base = ( {
		alt = 'A',
		caption = '',
		steps = '',
		target = 'inspector',
		viewport = 'desktop',
	} = {} ) => `
article: a
shots:
  - id: one
    alt: ${ alt }
    ${ caption ? `caption: ${ caption }` : '' }
    viewport: ${ viewport }
    steps:
      - openInspector
      ${ steps }
    capture:
      target: ${ target }
`;

	it( 'is stable across loads and files', () => {
		const a = load( base() ).shots[ 0 ].specHash;
		const b = load( base(), 'other/name.yml' ).shots[ 0 ].specHash;
		assert.equal( a, b );
		assert.equal( load( base() ).shots[ 0 ].specHash, a );
	} );

	it( 'ignores alt and caption (metadata, not render)', () => {
		const a = load( base() ).shots[ 0 ].specHash;
		assert.equal(
			load( base( { alt: 'Different', caption: 'With caption' } ) )
				.shots[ 0 ].specHash,
			a
		);
	} );

	it( 'changes when a step, target or viewport changes', () => {
		const a = load( base() ).shots[ 0 ].specHash;
		assert.notEqual(
			load( base( { steps: '- click: Replace' } ) ).shots[ 0 ].specHash,
			a
		);
		assert.notEqual(
			load( base( { target: 'block-toolbar' } ) ).shots[ 0 ].specHash,
			a
		);
		assert.notEqual(
			load( base( { viewport: 'mobile' } ) ).shots[ 0 ].specHash,
			a
		);
	} );

	it( 'includes the script contents', () => {
		const yaml =
			'article: a\nshots:\n  - id: one\n    alt: A\n    script: ./s.js\n';
		const one = project( {
			'spec.yml': yaml,
			's.js': 'export default 1;\n',
		} );
		const two = project( {
			'spec.yml': yaml,
			's.js': 'export default 2;\n',
		} );
		const h1 = loadSpec( path.join( one.shotsDir, 'spec.yml' ), one )
			.shots[ 0 ].specHash;
		const h2 = loadSpec( path.join( two.shotsDir, 'spec.yml' ), two )
			.shots[ 0 ].specHash;
		assert.notEqual( h1, h2 );
	} );
} );

describe( 'filterSpecs', () => {
	let specs;
	before( () => {
		const config = project( {
			'blocks/image.yml':
				'article: image-block\nsuite: default\nshots:\n  - { id: hero, alt: A }\n  - { id: settings, alt: B }\n',
			'blocks/gallery.yml':
				'article: gallery-block\nsuite: woo\nshots:\n  - { id: hero, alt: C }\n',
			'admin/plugins.yml':
				'article: plugins\nshots:\n  - { id: list, alt: D }\n',
			'blocks.yml':
				'article: blocks-overview\nshots:\n  - { id: hero, alt: E }\n',
		} );
		specs = loadSpecs( config );
	} );

	const articles = ( out ) => out.map( ( s ) => s.article );

	it( 'returns everything without a filter', () => {
		assert.equal( filterSpecs( specs ).length, 4 );
		assert.equal(
			filterSpecs( specs, { article: [], shot: [] } ).length,
			4
		);
	} );

	it( 'by article', () => {
		assert.deepEqual(
			articles(
				filterSpecs( specs, {
					article: [ 'plugins', 'gallery-block' ],
				} )
			),
			[ 'plugins', 'gallery-block' ]
		);
	} );

	it( 'by section (directory under shots/), accepting shots/ prefixes and trailing slashes', () => {
		for ( const section of [
			'blocks',
			'blocks/',
			'shots/blocks',
			'./shots/blocks/',
		] ) {
			assert.deepEqual(
				articles( filterSpecs( specs, { section: [ section ] } ) ),
				[ 'gallery-block', 'image-block' ],
				section
			);
		}
		assert.deepEqual(
			articles(
				filterSpecs( specs, { section: [ 'blocks/image.yml' ] } )
			),
			[ 'image-block' ]
		);
	} );

	it( 'a section does not match a file that merely shares its prefix', () => {
		assert.deepEqual(
			articles( filterSpecs( specs, { section: [ 'block' ] } ) ),
			[]
		);
	} );

	it( 'by suite', () => {
		assert.deepEqual(
			articles( filterSpecs( specs, { suite: [ 'woo' ] } ) ),
			[ 'gallery-block' ]
		);
	} );

	it( 'by shot id, dropping specs left with no shots and keeping other shots out', () => {
		const out = filterSpecs( specs, { shot: [ 'settings' ] } );
		assert.deepEqual( articles( out ), [ 'image-block' ] );
		assert.deepEqual(
			out[ 0 ].shots.map( ( s ) => s.id ),
			[ 'settings' ]
		);
		// The original is not mutated.
		assert.equal(
			specs.find( ( s ) => s.article === 'image-block' ).shots.length,
			2
		);
	} );

	it( 'filters combine', () => {
		const out = filterSpecs( specs, {
			section: [ 'blocks' ],
			shot: [ 'hero' ],
			suite: [ 'default' ],
		} );
		assert.deepEqual( articles( out ), [ 'image-block' ] );
	} );
} );

describe( 'presets in specs', () => {
	it( 'expands a preset into scene, steps and capture, with shot keys winning', () => {
		const spec = load( `
article: image-block
shots:
  - id: canvas
    preset: block-canvas
    block: core/image
    alt: The block
  - id: custom
    preset: block-settings
    block: core/image
    tab: styles
    alt: Styles tab
    steps:
      - openPanel: Dimensions
    capture:
      frame: wide
      annotate:
        - outline: { control: Width }
` );
		const [ canvas, custom ] = spec.shots;
		assert.equal( canvas.preset, 'block-canvas' );
		assert.equal( canvas.scene, 'post:block-image' );
		assert.deepEqual(
			canvas.steps.map( ( s ) => [ s.verb, s.arg, s.origin ] ),
			[ [ 'selectBlock', 'core/image', 'preset' ] ]
		);
		assert.equal( canvas.capture.target, 'selected-block' );
		assert.deepEqual( canvas.capture.include, [ 'block-toolbar' ] );
		assert.equal( canvas.capture.frame, 'auto' );
		assert.deepEqual(
			custom.steps.map( ( s ) => [ s.verb, s.origin ] ),
			[
				[ 'selectBlock', 'preset' ],
				[ 'openInspector', 'preset' ],
				[ 'openPanel', 'shot' ],
			]
		);
		assert.equal( custom.capture.target, 'inspector' );
		assert.equal( custom.capture.frame, 'wide' );
		assert.equal( custom.capture.annotate.length, 1 );
		assert.notEqual( canvas.specHash, custom.specHash );
	} );

	it( 'does not inherit defaults into a preset shot', () => {
		const spec = load( `
article: image-block
defaults:
  scene: new-page
  steps:
    - openListView
shots:
  - id: one
    preset: site-editor
    alt: x
` );
		assert.equal( spec.shots[ 0 ].scene, 'site-editor' );
		assert.deepEqual( spec.shots[ 0 ].steps, [] );
	} );

	it( 'rejects unknown presets with a suggestion, bad params and stray keys', () => {
		assert.throws(
			() =>
				load(
					'article: a\nshots:\n  - id: x\n    preset: block-canvs\n    alt: x\n'
				),
			/unknown preset "block-canvs" \(did you mean "block-canvas"\?\)/
		);
		assert.throws(
			() =>
				load(
					'article: a\nshots:\n  - id: x\n    preset: block-canvas\n    alt: x\n'
				),
			/preset block-canvas needs `block`/
		);
		assert.throws(
			() =>
				load(
					'article: a\nshots:\n  - id: x\n    preset: site-editor\n    block: core/image\n    alt: x\n'
				),
			/unknown key "block"/
		);
		assert.throws(
			() =>
				load(
					'article: a\nshots:\n  - id: x\n    preset: block-settings\n    block: core/image\n    tab: layout\n    alt: x\n'
				),
			/must be one of content \| settings \| styles/
		);
	} );
} );

describe( 'frames and arrows', () => {
	it( 'accepts every frame name including auto and rejects others with a suggestion', () => {
		for ( const frame of [
			'none',
			'card',
			'auto',
			'wide',
			'portrait',
			'plain',
		] ) {
			const spec = load(
				`article: a\nshots:\n  - id: x\n    alt: x\n    capture: { frame: ${ frame } }\n`
			);
			assert.equal( spec.shots[ 0 ].capture.frame, frame );
		}
		assert.throws(
			() =>
				load(
					'article: a\nshots:\n  - id: x\n    alt: x\n    capture: { frame: portrit }\n'
				),
			/unknown frame "portrit" \(did you mean "portrait"\?\)/
		);
	} );

	it( 'accepts an arrow with a direction and rejects unknown directions', () => {
		const spec = load(
			'article: a\nshots:\n  - id: x\n    alt: x\n    capture:\n      annotate:\n        - arrow: { button: Replace, from: top-left }\n'
		);
		assert.deepEqual( spec.shots[ 0 ].capture.annotate[ 0 ], {
			type: 'arrow',
			button: 'Replace',
			from: 'top-left',
		} );
		assert.throws(
			() =>
				load(
					'article: a\nshots:\n  - id: x\n    alt: x\n    capture:\n      annotate:\n        - arrow: { button: Replace, from: north }\n'
				),
			/from must be one of top \| bottom/
		);
	} );
} );

describe( 'spec discovery with config.specs', () => {
	it( 'finds specs by glob relative to the config root and reports paths from there', () => {
		const base = path.join( root, `p${ counter++ }` );
		const files = {
			'docs/blocks/image.shots.yaml':
				'article: image\nshots:\n  - id: a\n    alt: a\n',
			'docs/site/editor.shots.yaml':
				'article: editor\nshots:\n  - id: b\n    alt: b\n',
			'docs/blocks/notes.yaml':
				'article: ignored\nshots:\n  - id: c\n    alt: c\n',
		};
		for ( const [ rel, text ] of Object.entries( files ) ) {
			fs.mkdirSync( path.dirname( path.join( base, rel ) ), {
				recursive: true,
			} );
			fs.writeFileSync( path.join( base, rel ), text );
		}
		const config = {
			root: base,
			specs: [ 'docs/**/*.shots.yaml' ],
			specsBase: base,
			shotsDir: path.join( base, 'shots' ),
		};
		const specs = loadSpecs( config );
		assert.deepEqual(
			specs.map( ( s ) => [ s.article, s.relPath ] ),
			[
				[ 'image', 'docs/blocks/image.shots.yaml' ],
				[ 'editor', 'docs/site/editor.shots.yaml' ],
			]
		);
		assert.deepEqual(
			filterSpecs( specs, { section: [ 'docs/blocks' ] } ).map(
				( s ) => s.article
			),
			[ 'image' ]
		);
	} );
} );

describe( 'annotationScale', () => {
	it( 'accepts a positive number and rejects anything else', () => {
		const spec = load(
			'article: a\nshots:\n  - id: x\n    alt: x\n    capture: { annotationScale: 1.5 }\n'
		);
		assert.equal( spec.shots[ 0 ].capture.annotationScale, 1.5 );
		assert.throws(
			() =>
				load(
					'article: a\nshots:\n  - id: x\n    alt: x\n    capture: { annotationScale: 0 }\n'
				),
			/annotationScale must be a positive number/
		);
	} );
} );
