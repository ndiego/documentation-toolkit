# @wporg-docs/screenshots

Reproducible WordPress UI screenshots for documentation. A YAML file per article says what to show. The engine
boots WordPress Playground from a committed blueprint (pinned WordPress and PHP, a theme, demo content), drives the
UI with Playwright, and writes WebP images plus a manifest into the documentation tree. When a WordPress release
changes the UI, regenerate and review the diff instead of retaking screenshots by hand.

The design contract between the engine and a documentation project is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

Requirements: Node 22.19 or newer (24 recommended), about 1 GB of disk for dependencies and Chromium. No Docker, no
database, no local WordPress install.

The engine is consumed from a *project directory* inside a documentation repo that holds `shots.config.js`, a
Playground `blueprint/`, and YAML specs under `shots/`.

Until the package is on npm, depend on it as a path into a checkout of this repository (pinned at a tag):

```sh
# in the documentation repo
git submodule add https://github.com/ndiego/documentation-toolkit.git toolkit
( cd toolkit && git checkout v0.2.0 && npm ci )          # the engine's dependencies live in the toolkit checkout
```

```json
{
  "scripts": {
    "shots": "wp-screenshots",
    "postinstall": "npm exec --prefix ../toolkit -- playwright install chromium"
  },
  "dependencies": {
    "@wporg-docs/screenshots": "file:../toolkit/packages/screenshots"
  }
}
```

Then, in the project directory: `npm install` and `npx wp-screenshots doctor`.

## Commands

Run from the project directory (or pass `--config path/to/shots.config.js`).

```sh
wp-screenshots run [--article <slug>] [--section <path>] [--suite <name>] [--shot <id>]
wp-screenshots check [filters] [--docker]   # render to a staging dir, diff against committed images, HTML report
wp-screenshots update                       # accept the images and manifest entries the last check staged
wp-screenshots lint [--fix]                 # specs, Markdown references, orphans; --fix rewrites alt text
wp-screenshots shoot --preset <name> [--<param> <value>] [--frame <frame>] [--out <file>]   # one image, no spec
wp-screenshots presets                      # the subjects a shot can be built from, with their parameters
wp-screenshots snippet --article <slug> [--from docs/path/file.md]
wp-screenshots preview [filters] [--width <px>] [--out <dir>]   # PNG copies of generated images for review
wp-screenshots dev --article <slug> --shot <id>   # headed browser, pauses in the Playwright Inspector
wp-screenshots doctor | list | vocab
```

`shoot` is the "just give me one" path: `wp-screenshots shoot --preset site-editor --out site-editor.webp`
renders a single image from a preset without a spec file.

| Command | What it does |
|---|---|
| `run` | Renders the matching shots and writes an image only when its pixels changed, so a repeat run against the same WordPress leaves git clean. Updates the manifest. |
| `check` | Renders to `<workDir>/check/`, compares with the committed images, writes `<workDir>/report/index.html` with before/after/diff, and exits 1 when anything changed or failed. Nothing committed is touched. |
| `update` | Copies the staged images and their manifest entries into place. The release flow is `check --docker`, review, `update`, pull request. Never follow `update` with a plain `run`: a local render would overwrite canonical images with previews. |
| `lint` | Validates every spec, checks that each generated image is referenced from the Markdown with the spec's alt text, and reports orphans and dangling references. Needs no browser. |
| `--docker` | Re-runs the command inside the pinned Playwright image (`dockerImage` in the config) for a canonical render. |

Failures save the page state (screenshot, HTML, console log) under `<workDir>/failures/`.

## Configuration: `shots.config.js`

Paths are relative to the config file.

```js
export default {
	// Where the specs are: glob patterns relative to this file. Keep them next to their articles
	// (`docs/**/*.shots.yaml`) or in a mirrored tree (`shots/**/*.yaml`); the engine only needs the pattern.
	specs: [ 'docs/**/*.shots.yaml' ],
	shotsDir: 'shots',                      // used only when `specs` is not set: every YAML file under it
	outDir: '../docs/assets/screenshots',   // generated images and manifest.json
	docsDir: '../docs',                     // Markdown tree lint cross-checks
	docsManifest: '../docs/manifest.json',  // optional: article slugs must exist here
	blueprint: 'blueprint/blueprint.json',  // Playground blueprint (pins WordPress and PHP, logs in)
	suitesDir: 'blueprint/suites',          // optional per-suite blueprints: <suitesDir>/<name>/blueprint.json
	workDir: '.wp-screenshots',             // logs, failures, check staging, reports (gitignore it)
	wordpress: { version: '7.1.3', php: '8.3' }, // asserted after boot; the blueprint's preferredVersions wins
	port: 9400,
	format: 'webp',                         // or 'png'
	dockerImage: 'mcr.microsoft.com/playwright:v1.64.0-noble',
	style: {},                              // overrides for the tokens in src/style.js
};
```

Keep `dockerImage`, `@playwright/test` in this package, and your CI image at the same Playwright version.

## Writing a shot

One YAML file per article, found through `specs`. The file name does not matter; `article` is the output folder
(and, when `docsManifest` is set, must be a slug in it). Images land at `<outDir>/<article>/<id>.webp`.

### From a preset

Most documentation screenshots are one of a few subjects. A preset names the subject and the engine supplies the
scene, the steps, the capture target and the frame the house style settled on (see `style/SCREENSHOTS.md` in the
toolkit). Any key set on the shot overrides what the preset filled in; shot steps run after the preset's.

```yaml
article: image-block
shots:
  - id: canvas
    preset: block-canvas
    block: core/image
    alt: An Image block on the editor canvas, selected, showing a photo of a lake with a caption below it.
  - id: settings
    preset: block-settings
    block: core/image
    tab: settings
    alt: The Image block's Settings tab, with the Resolution setting outlined.
    capture:
      annotate:
        - outline: { control: Resolution }
```

| Preset | Parameters | Shows |
|---|---|---|
| `block-canvas` | `block` (required), `post` | A block on the canvas, selected, with its toolbar |
| `block-toolbar` | `block`, `post` | The block's toolbar |
| `block-settings` | `block`, `post`, `tab` (content, settings, styles), `panel` | The inspector on a tab |
| `site-editor` | `view` | The site editor home or a view (templates, parts, patterns, navigation, pages, styles, template:…, part:…) |
| `post-editor` | `post` | The whole post editor |
| `admin-screen` | `screen` (required) | A wp-admin screen |
| `front-end` | `path` | The public site |

Block presets open the demo site's showcase post `block-<name>` (`block-image` for `core/image`), which holds a
representative instance of the block. `post: new` inserts the block into a fresh post instead; `post: <slug>` opens
another post. `wp-screenshots presets` prints this table from the source of truth.

### By hand

```yaml
article: image-block
defaults:
  scene: new-post
  steps:
    - insertBlock: { name: core/paragraph, attributes: { content: Some lead text. } }
shots:
  - id: toolbar-replace
    alt: The Image block toolbar with the Replace button highlighted.
    steps:
      - insertBlock:
          name: core/image
          attributes: { id: "{{media.hero}}", url: "{{media.hero.url}}", alt: "{{media.hero.alt}}" }
    capture:
      target: block-toolbar
      pad: 24
      annotate:
        - outline: { button: Replace, within: block-toolbar }
```

- **Scenes** set the starting state: `new-post`, `new-page`, `post:<slug>`, `page:<slug>`, `admin:<path>`,
  `site-editor`, `site-editor:<route>`, `front`, `front:<path>`.
- **Steps** are verbs such as `insertBlock`, `selectBlock`, `searchInserter`, `openInspector`, `openPanel`,
  `openBlockMenu`, `openToolbarDropdown`, `openListView`, `openOptionsMenu`, `click`, `hover`, `type`, `fill`,
  `select`, `press`, `wait`, `setViewport`, `setPreference`, `scrollTo`, `evaluate`. `wp-screenshots vocab` lists
  them all; the table is in ARCHITECTURE.md.
- **Locator keys** name elements the way a reader would: `{ button: Replace }`, `{ control: Alternative text }`,
  `{ menuitem: Edit as HTML }`, `{ tab: Styles }`, `{ text: Settings }`, `{ role: searchbox, name: Search }`,
  `{ selector: .css }`. Names match the whole accessible name; add `exact: false` for a substring.
- **Capture targets** are named regions from one registry: `editor`, `selected-block`, `block-toolbar`,
  `inspector`, `inspector-panel:<name>`, `inserter`, `list-view`, `top-bar`, `popover`, `modal`,
  `admin-content`, `admin-screen`, `front`, or a CSS selector. `include:` widens the crop, `pad:` adds space,
  `fit: content` trims a tall panel, `frame: card` puts a full-editor shot on a card.
- **Annotations** anchor to elements, never to pixels: `outline`, `arrow` (with `from: top | bottom | left |
  right | top-left | …`), numbered `badge`, `dim`. WordPress blue with a white halo so they stay legible over the
  editor's own selection outline.
- **Frames** put the crop on a stage with a canonical ratio: `wide` 16:9, `standard` 4:3, `portrait` 3:4,
  `banner` 3:1, `auto` (nearest to the content), `none`, or the content-sized `card`. The content is never scaled;
  the stage grows to the ratio. The manifest records the frame used.
- **Templating** resolves against the running demo site by slug: `{{media.<slug>}}`, `{{media.<slug>.url}}`,
  `{{media.<slug>.alt}}`, `{{post.<slug>}}`, `{{page.<slug>}}`, `{{site.url}}`. The project's blueprint README
  is the contract for which slugs exist.
- **Alt text** lives in the spec and is the source of truth; `lint --fix` copies it into the Markdown.
- **`defaults.steps`** run before every shot that uses the default scene. A shot with another scene does not
  inherit them.
- **Typos fail fast.** Unknown keys, verbs, scenes, targets and locator keys are rejected when the spec loads,
  with a "did you mean", so `lint` catches them in CI before anything boots.
- **Escape hatch:** `script: ./file.js` replaces `steps` with a default export `(ctx) => Promise<void>` that
  receives `{ page, editor, admin, pageUtils, site, style }`.

Authoring loop: `wp-screenshots dev --article x --shot y` opens a visible browser, runs the scene and steps, and
pauses in the Playwright Inspector. Its "Pick locator" tool shows the role and name to use in a step.

## Determinism and the canonical render

Every run uses a 1440×900 viewport at 2x, light scheme, en-US, UTC, reduced motion, animations disabled, caret
hidden and the pointer parked, against the pinned WordPress, PHP, theme and demo content. On one machine, repeat
runs are byte-identical.

Fonts differ between macOS and Linux, so local renders are previews. The canonical render runs inside the pinned
Playwright Docker image: `--docker` locally (Docker Desktop) or a CI job using the same image. The manifest marks
each image `canonical: true|false` (set by `WP_SCREENSHOTS_CANONICAL=1`, which `--docker` exports). The host's
`~/.wordpress-playground` download cache is shared with the container, so after the first fetch of a WordPress
version a render needs no network for WordPress itself.

## Output

- `<outDir>/<article>/<id>.webp` at 2x. Lossless WebP under `style.webp.maxBytes` (300 KB by default), lossy at
  `style.webp.quality` (90) above it. The manifest records which. `format: 'png'` switches everything to PNG.
- `<outDir>/manifest.json`: per image, the alt text, article, WordPress, PHP and theme versions, spec and
  blueprint hashes, Playwright and Chromium versions, platform, canonical flag and pixel hash. An entry changes
  only when the pixels or the spec metadata change.

## Regenerating at a WordPress release

1. Bump `preferredVersions.wp` in the blueprint and `wordpress.version` in `shots.config.js`. Bump
   `@wordpress/e2e-test-utils-playwright` here if the editor changed a lot.
2. `wp-screenshots check --docker` (or the project's CI job) and open `<workDir>/report/index.html`.
3. Review the before/after pairs. A changed image is also a prompt to re-read the article text.
4. `wp-screenshots update`, then open a pull request.

## Environment contract

The engine needs from the project: a blueprint path, a free port, admin credentials (`admin` / `password` by
default, overridable under `user`), and a `login` step in the blueprint so the browser arrives authenticated.
If the demo site exposes a `wp_screenshots: { wordpress, php, theme }` object on `GET /wp-json/` (a mu-plugin can
add it), the engine uses it to assert the booted versions; otherwise it falls back to the generator tag.

## Development

```sh
npm ci                       # at the repository root
npm test -w @wporg-docs/screenshots
npm run lint                 # ESLint (WordPress config) and Prettier (wp-prettier)
```
