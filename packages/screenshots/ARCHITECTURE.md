# Architecture

The contract between the engine (this package) and a documentation project that uses it. Keep it current when
either side changes.

## Two layers

```
<documentation repo>/
  <project dir>/                    the PROJECT: shots, blueprint, demo content, config
    shots.config.js                 project config consumed by the engine
    blueprint/                      Playground blueprint, mu-plugin, demo content pack
    shots/                          YAML shot specs, usually mirrored to the docs tree
  docs/                             the Markdown and the generated images the engine writes into

@wp-docs-toolkit/screenshots             the ENGINE: this package, consumed from npm or as a path dependency
```

The engine knows nothing about any repository. It receives a config object (directories, blueprint path,
WordPress version, style tokens) and does the rest. Rules that keep that true:

- Nothing in `src/` reads outside the paths in the config or assumes what article slugs look like.
- Project facts (output dir, docs dir, manifest path, blueprint path, versions, viewports, style tokens) come from
  `shots.config.js`.
- Content keys (`{{media.hero}}`) are resolved against the running site by slug through the REST API, not against
  files in the project. The demo content pack can be replaced wholesale as long as the slugs keep existing.

## Modules (`src/`)

| Module | Responsibility |
|---|---|
| `cli.js` | `wp-screenshots run\|check\|update\|lint\|snippet\|dev\|doctor\|list\|vocab`, argument parsing, exit codes |
| `config.js` | Load `shots.config.js` (nearest one from the cwd, or `--config`), apply defaults, resolve paths |
| `spec.js` | Discover specs (`config.specs` globs or `shotsDir`), load and validate YAML; expand `defaults` and presets; reject unknown keys, verbs, scenes, targets, frames, presets and locator keys with a "did you mean"; compute spec hashes |
| `presets.js` | Subjects (`block-canvas`, `block-settings`, `site-editor`, …) expanded into scene, steps and capture; parameter validation; the table `wp-screenshots presets` prints |
| `env/playground.js` | Start and stop `@wp-playground/cli server` from a blueprint, wait for the "Ready!" line (the HTTP server answers before the blueprint seed finishes), assert the booted WordPress and PHP versions |
| `browser.js` | Launch Chromium with the deterministic context options; build the editor, admin and page helpers |
| `wp.js` | The handful of WordPress helpers the engine needs (canvas frame, insert/set content through wp.data, preferences, admin navigation, key chords), ported from Gutenberg's Playwright utilities so that package and its Lighthouse/Sentry tail are not dependencies |
| `site.js` | REST lookups for `{{media.*}}`, `{{post.*}}`, `{{page.*}}` templating; cleanup of content a shot created |
| `scenes.js` | `new-post`, `new-page`, `post:<slug>`, `page:<slug>`, `admin:<path>`, `site-editor[:<route>]`, `front[:<path>]` |
| `actions.js` | The step vocabulary; each verb is `(ctx, arg) => Promise<void>`, built on the WordPress data stores so they keep working across releases |
| `locators.js` | Semantic locator keys to Playwright locators; polls the page and the editor canvas frame until one matches |
| `targets.js` | Named capture targets to locators, one registry so a Gutenberg class rename is fixed in one place |
| `capture.js` | Settle, compute the clip from target plus `include` plus `pad`, inject annotations, screenshot, hand off to `image.js` |
| `annotate.js` | Overlay drawn in the top document from element bounding boxes: `outline`, `arrow`, `badge`, `dim`, each with a halo |
| `image.js` | sharp: the stage (canonical ratios, gradient background, shadow, rounded corners) and the legacy card, WebP/PNG encode, decode for compare; pixel compare via pixelmatch |
| `manifest.js` | Read and write the output manifest; touch only entries whose pixels or metadata changed |
| `lint.js` | Spec, alt text, orphan and reference checks against the docs tree; `--fix` for alt text; `snippet` |
| `report.js` | HTML before/after/diff report for `check`; `update` applies the staged images and manifest entries |
| `docker.js` | Re-run the CLI inside the pinned Playwright image with the project, the docs and the engine mounted |
| `style.js` | Default style tokens, overridable from the config |
| `runner.js` | Orchestrates: boot once per suite, group shots by article, run scenes and steps, capture, write, manifest |

Plain ESM JavaScript with JSDoc types. No build step, so a contributor can read the file that runs.

## Shot spec

```yaml
article: image-block             # required; output folder name. Must be in the docs manifest when one is configured.
suite: default                   # optional; blueprint suite (<suitesDir>/<name>/blueprint.json)
defaults:                        # optional; merged into every shot
  scene: new-post
  viewport: desktop
shots:
  - id: toolbar-replace          # required; file name. [a-z0-9-]+
    preset: block-toolbar        # optional; a subject from presets.js. Its params (block, post, …) are shot keys
    alt: ...                     # required; the Markdown alt text
    caption: ...                 # optional; italic caption line under the image
    scene: new-post              # see scenes
    viewport: desktop            # desktop | narrow | mobile | {width, height}
    isolated: false              # true = this shot mutated the site; boot a fresh Playground afterwards
    steps: [ ... ]               # list of verbs; string or single-key object
    capture:
      target: block-toolbar      # named target or selector; default editor/admin-screen/front per scene
      include: [selected-block]  # optional; extend the clip to cover these targets too
      pad: 16                    # CSS px; default from style
      fit: content               # optional; clip a tall target's bottom to its last visible child
      frame: auto                # none | card | auto | wide | standard | portrait | banner (style.frames)
      annotate:
        - outline: { button: Replace }
        - arrow: { button: Replace, from: top }
        - badge: { label: 1, control: Alternative text }
        - dim: { target: inspector }
      mask: [ { selector: ".some-dynamic" } ]
    kind: image                  # image (default) | clip (reserved; parsed and skipped with a warning)
    script: ./custom.js          # optional escape hatch; default export (ctx) => Promise<void>, replaces steps
```

Templating in any string value: `{{media.<slug>}}` (attachment ID), `{{media.<slug>.url}}`, `{{media.<slug>.alt}}`,
`{{post.<slug>}}` / `{{page.<slug>}}` (ID), `{{post.<slug>.url}}`, `{{site.url}}`.

## Step verbs

| Verb | Argument | Notes |
|---|---|---|
| `insertBlock` | `core/image` or `{name, attributes, innerBlocks}` | Via `wp.data`, like Gutenberg's tests; the new block becomes selected |
| `selectBlock` | `core/image` or `{name, nth}` | Selects the nth block of that type in the canvas |
| `setContent` | block HTML string | Replaces the whole post content |
| `openInserter` | none | Opens the main block inserter |
| `searchInserter` | search term | Opens the inserter, types the term and waits for the debounced results |
| `openInspector` | `content`, `settings` or `styles` (default `settings`) | Opens the block sidebar on that tab. `content` exists only for blocks with content controls |
| `openDocumentSidebar` | none | Opens the Post/Page tab of the sidebar |
| `openPanel` | panel name | Expands a collapsed sidebar panel by its button name |
| `openBlockMenu` | none | Opens the block toolbar's Options menu |
| `openToolbarDropdown` | button name | Opens a toolbar dropdown, for example `Align` |
| `openListView` | none | |
| `openOptionsMenu` | none | The editor's top-right Options menu |
| `click` / `hover` | locator key | |
| `type` | `text` or `{text, pace}` | `page.keyboard.type`; pace `human` adds delay |
| `fill` | `{ <locator key>, value }` | |
| `select` | `{ <locator key>, option }` | Native `<select>` |
| `press` | key chord | `Enter`, `Escape`, `primary+k` (modifiers resolved for the host OS) |
| `wait` | `{ for: <target or locator key>, state?: visible\|hidden\|attached }` or a number of ms | |
| `setViewport` | viewport name or `{width, height}` | |
| `setPreference` | `{ scope, key, value }` | `core`, `core/edit-post`, `core/edit-site` |
| `scrollTo` | locator key | `scrollIntoViewIfNeeded` |
| `evaluate` | JS source string | Escape hatch; runs in the page |

Locator keys: `{ button: "Replace" }`, `{ control: "Alternative text" }` (textbox, combobox, checkbox or spinbutton
by label), `{ menuitem: "Edit as HTML" }`, `{ tab: "Styles" }`, `{ text: "Settings" }`,
`{ role: "searchbox", name: "Search" }`, `{ selector: ".css" }`, `{ block: "core/image" }`. Names match the whole
accessible name (`exact: true` by default). The page document and the editor canvas frame are both polled until
one has a match, unless `in: canvas` or `in: page` is given; `within: <target>` scopes the search.

## Named targets

`editor`, `canvas`, `selected-block`, `block-toolbar`, `inspector`, `inspector-panel:<name>`, `document-sidebar`,
`inserter`, `list-view`, `top-bar`, `options-menu`, `popover`, `modal`, `site-editor-sidebar`,
`site-editor-canvas`, `admin-content`, `admin-screen`, `admin-menu`, `front`. Anything that looks like a CSS
selector (starts with `.`, `#`, `[` or contains a combinator) is used as one; anything else is rejected at load.

## Frames and the stage

`frame` names one of `style.frames` (`wide` 16:9, `standard` 4:3, `portrait` 3:4, `banner` 3:1), `auto` for the
ratio nearest to the crop, `none` for the bare crop, or `card` for the older content-sized card. `image.js`
composes the stage: the crop is never scaled; the canvas grows to the ratio with at least `stage.margin` on every
side, the crop sits centred on a gradient or solid background with a blurred shadow and rounded corners. The name
of the frame used (`auto` resolved) is recorded per image in the manifest. The reasoning behind the ratios is in
the toolkit's `style/SCREENSHOTS.md`.

## Output

- `<outDir>/<article>/<id>.webp`. Lossless WebP when the result fits `style.webp.maxBytes` (300 KB by default; UI
  crops land at 10–50 KB) and lossy at `style.webp.quality` (90) above it, because lossless WebP of a photo-heavy
  2x editor shot is larger than PNG. Both encodings are deterministic. The manifest records `encoding` per image.
- `<outDir>/manifest.json`: `{ "version": 1, "shots": { "<article>/<id>": { file, article, alt, caption, suite,
  kind, frame, wordpress, php, theme, specHash, blueprintHash, playwright, chromium, platform, canonical,
  capturedAt, width, height, bytes, encoding, pixelHash } } }`, keys sorted. An entry changes only when the pixels change, the
  spec metadata changes, or a field is missing.
- Images are compared pixel for pixel against the committed file before writing; identical pixels leave the file
  untouched so git shows no churn.

## Canonical renders

`--docker` re-runs the CLI in `dockerImage`. It mounts the common ancestor of every configured path (and of the
engine's install root when the engine is a path dependency) at `/work`, keeps Linux `node_modules` in named
volumes, shares the host's `~/.wordpress-playground` cache, runs `npm ci` for the engine and the project, installs
Chromium through the engine's Playwright, and exports `WP_SCREENSHOTS_CANONICAL=1` so the manifest marks the
result canonical. A CI job that runs inside the same image with that variable set is equivalent.

## Environment contract (`blueprint/`)

The engine needs: a blueprint path, the port, the admin credentials, and a `login` step in the blueprint so the
browser arrives authenticated. The blueprint's `preferredVersions` is authoritative for WordPress and PHP (the
Playground CLI's `--wp` flag loses to it). A demo mu-plugin may add `wp_screenshots: { wordpress, php, theme }`
to `GET /wp-json/`; the engine prefers it over the generator tag when asserting versions.

## Known behaviour worth keeping in mind

- WordPress 6.8+ routes the site editor through `site-editor.php?p=/…` (`/styles`, `/template`, `/pattern`,
  `/navigation`, `/page`; `/wp_template/<theme>//<slug>&canvas=edit` to edit). `scenes.js` builds those URLs
  itself; the Gutenberg Playwright utility still emits the pre-6.8 query parameters.
- Selecting a block with a caret (a click, or the store's default `selectBlock`) focuses its first rich text and
  pops the inline formatting toolbar over the block. `selectBlock` selects through the store with no caret
  position and focuses the block wrapper instead.
- A fixed Playwright clock stalls Gutenberg's debounces, so the engine never uses `setFixedTime`.
- The Playground server answers HTTP a few seconds before the blueprint seed finishes; the engine waits for the
  CLI's "Ready!" line.
- Local macOS renders differ from Linux renders in font rasterisation. Only renders inside the pinned image are
  comparable over time.
