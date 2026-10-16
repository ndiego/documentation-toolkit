# Changelog

All packages in this repository share one version. Consumers pin a tag.

## 0.4.0 (2026-10-16)

- Screenshots: `setup` creates site state before the scene and removes it after the shot, server-side through the
  REST API so it is fast and identical every run. Operations: `post` (from block markup; posts, pages, synced
  patterns), `note` (WordPress 7.1 Notes on a block, with author, date, replies and resolved state), `user`,
  `option`, `plugin`. Built-in fixtures: `long-post`, `post-with-notes`, `synced-pattern`, `second-author`, with
  fixed authors, dates and content. A shot's `setup` is part of its hash, so the manifest re-creates the exact image.
- MCP: `inspect` runs a preset or scene and steps like `screenshot` and returns the visible interactive elements of
  the region (role, accessible name, the named region they sit in) and its accessibility tree instead of an image,
  with an optional low-resolution preview. `screenshot` and `inspect` take `setup`; the `screenshot` result carries
  the YAML it was rendered from, ready to commit as a spec.
- Steps: `openNotesSidebar` and `openCommandPalette`. A Paragraph inserted into a new post by a block preset gets a
  sample sentence, because an empty Paragraph shows the side inserter instead of a block toolbar; the toolbar helper
  says so when no toolbar is on screen.
- `install` no longer copies npx's temporary `node_modules/.bin` folders into the registered PATH.

## 0.3.5 (2026-10-16)

- Fix: on a machine whose default Node is 26, screenshots failed with `Failed to load fs-ext native module` even after
  `install` had registered Node 24. The registered launch goes through npx, and npx hands the package's bin to the
  first `node` on PATH (its `#!/usr/bin/env node` shebang; npm prepends .bin folders, not the running Node's own).
  In Claude Desktop that is Homebrew's Node 26, so the server, and Playground with it, ran there. `install` now
  writes an `env.PATH` that starts with the chosen Node's folder (Claude Desktop and Claude Code), and the server
  restarts itself on a supported Node when a launcher starts it on an unsupported one. Found on a colleague's
  machine.

## 0.3.4 (2026-10-16)

- Node 26 is refused with an explanation instead of crashing inside Playground (its native module ships binaries
  for Node 22.19 to 25 only). `wp-docs-mcp install` registers a supported Node found on the machine when the
  default one is unsupported, and takes `--node <binary>`. Engines fields say `>=22.19 <26`. Found on a
  colleague's Node 26 machine.
- READMEs rewritten for npm readers: install from the registry first, the git checkout as the development path.
- MCP: free-form screenshots. `screenshot` works without a preset given `scene` and `steps` in the engine's
  vocabulary (validated like a YAML spec), and takes `viewport`, `fit` and `mask`; a `vocabulary` tool lists scenes,
  verbs, targets, locator keys and frames so an agent can build a shot no preset covers.
- MCP: the `screenshot` tool takes `target` to crop to a named region (`admin-content` for a wp-admin screen
  without the menu and toolbar, `inspector`, `block-toolbar`, …) instead of the preset's default.
- MCP: tool descriptions and the `vocabulary` output are built from the engine's own tables (targets, frames and
  ratios, viewports, scenes, locator keys, badge positions, preset parameters), so they cannot drift from what a
  spec accepts. `vocabulary.scenes.forms` replaces the prose note. Tight presets declare an `annotationScope`.
- Fix: a `screenshot` call with a bad preset, verb or locator is rejected before WordPress boots; the MCP tests
  run under a guard that never downloads Chromium, so CI fails fast instead of hanging.

## 0.3.3 (2026-10-16)

- Screenshots: dropped `@wordpress/e2e-test-utils-playwright`. The ten helpers the engine used live in `src/wp.js`
  now (ported from Gutenberg, GPL-2.0-or-later). That removes Lighthouse, Sentry and Octokit from the install,
  about 110 MB and 150 packages a consumer never ran.
- Fix: the first screenshot on a machine without Chromium failed with `Package subpath './cli.js' is not defined by
  "exports" in playwright/package.json`. The auto-install now resolves Playwright's CLI through a declared export
  (`@playwright/test/cli`). Found on a colleague's first install from npm.

- The `handbook-cutover` skill moved to wp-documentation-migration: a one-time migration procedure, not a utility.
- 0.3.2 is the first version published to npm (`@wp-docs-toolkit/*`, 2026-10-16). The README's install line is now
  `npx -y @wp-docs-toolkit/mcp install`.

## 0.3.2 (2026-10-16)

- Screenshots: annotations are sized for the displayed image. The engine scales strokes, arrows and badges by the
  capture width against `style.annotations.referenceWidth` (960, the handbook column), between 1× and 2.5×;
  `capture.annotationScale` pins a shot's factor. `style/SCREENSHOTS.md` explains when to crop instead.

## 0.3.1 (2026-10-16)

- MCP: the `screenshot` tool takes `annotate` (arrow, outline, badge, dim anchored to a named button, control, tab,
  menu item, link, text, selector or region; names match loosely unless `exact`), `include` and `pad`. `out`
  expands a leading `~`. Found by a colleague's first prompt, "add an arrow on the Save Draft button".

## 0.3.0 (2026-10-16)

- MCP: `wp-docs-mcp install` / `uninstall` register and remove the server in Claude Desktop and Claude Code with
  absolute paths; when run through `npx` it registers a pinned `npx -y @wp-docs-toolkit/mcp@<version>` launch.
  All packages carry `publishConfig.access: public` and pin each other at the shared version, ready for npm.
- New package `@wp-docs-toolkit/mcp`: an MCP server (stdio, or Streamable HTTP with `--http`) with `screenshot`,
  `list_presets` and `validate_manifest` tools, so Claude Desktop, Claude Code, ChatGPT and other MCP clients can
  take screenshots by asking. The repo's `.mcp.json` registers it for Claude Code. `shootPreset()` is now a library
  function of `@wp-docs-toolkit/screenshots` (the CLI's `shoot` uses it) and can pick a free Playground port.
- Screenshots: sessions. `openSession()` boots Playground and the browser once and `runShots`/`shootPreset` accept
  a `session` to reuse, so a long-lived caller pays the boot once. The MCP server keeps one warm session (idle
  timeout `--idle`, default 10 minutes) and adds a `restart_environment` tool; a second screenshot takes seconds.
- MCP: `scripts/install.sh`, a one-line installer that clones to `~/.wp-docs-toolkit`, installs Chromium and
  registers the server in Claude Desktop and Claude Code. HTTP mode gains token auth (`--token` /
  `WP_DOCS_MCP_TOKEN`, bearer header or `/mcp/<token>` path), `GET /healthz`, `PORT`/`HOST` env, refuses to bind a
  non-local address without a token, serializes screenshot calls, and auto-installs Chromium on first use.

## 0.2.1 (2026-10-16)

- **Renamed** from `documentation-toolkit` to `wp-docs-toolkit` (repository `ndiego/wp-docs-toolkit`; the old URL
  redirects). The npm scope is `@wp-docs-toolkit` (was `@wporg-docs`) and the Claude Code plugin and marketplace
  are `wp-docs-toolkit` (were `wporg-docs`). Binaries, config keys and the `wp_screenshots` REST key are unchanged.
- Screenshots: zero-config `shoot`. With no `shots.config.js` in reach, `shoot`, `doctor`, `presets` and `vocab`
  run against the bundled demo site with working files in the temp directory. `@wp-docs-toolkit/screenshots` now
  depends on `@wp-docs-toolkit/demo-site`. A missing Chromium is reported with the install command instead of a stack
  trace. Root scripts `npm run setup` and `npm run shoot`.

## 0.2.0 (2026-10-16)

Restructured as an npm workspaces monorepo focused on maintaining WordPress.org documentation.

- `wp-shots/` is now `packages/screenshots/`, published as `@wp-docs-toolkit/screenshots` with the binary
  `wp-screenshots`. Renamed with it: the working directory `.wp-screenshots/`, the environment variable
  `WP_SCREENSHOTS_CANONICAL`, the REST index key `wp_screenshots` a demo mu-plugin may expose, and the Docker
  volume prefix.
- `--docker` now installs the engine where it lives (the toolkit checkout when consumed as a path dependency)
  and uses that install's Playwright to fetch Chromium. Before, it assumed the old `engine/` layout.
- The manifest validator is ported from Python to Node as `packages/manifest/` (`@wp-docs-toolkit/manifest`, binary
  `wp-validate-manifest`, no dependencies). The composite action runs it without a Python setup step.
- The HTML-to-Markdown converter facade moved back to wp-documentation-migration. Conversion is a one-time
  migration step, not maintenance, and its core was never in this repository.
- Skills are a Claude Code plugin (`.claude-plugin/`): `screenshots`, `validate-manifest`, `handbook-cutover`.
  `convert-handbook` moved with the converter.
- `CONVENTIONS.md` moved to `style/`.
- Added: unit tests (`node --test`), WordPress ESLint and Prettier configuration, a CI workflow, a changelog, and
  engine documentation that lives with the engine (`packages/screenshots/README.md`, `ARCHITECTURE.md`).
- Screenshots: **presets** (`block-canvas`, `block-toolbar`, `block-settings`, `site-editor`, `post-editor`,
  `admin-screen`, `front-end`) expand a subject into scene, steps and capture; `wp-screenshots presets` lists
  them and `wp-screenshots shoot --preset …` renders one image without a spec.
- Screenshots: **frames**. `frame` takes a canonical ratio (`wide` 16:9, `standard` 4:3, `portrait` 3:4, `banner`
  3:1) or `auto`; the crop sits on a gradient stage that grows to the ratio. `card` remains; the default is `none`.
  The manifest records the frame per image.
- Screenshots: `arrow` annotation; outlines, badges and arrows carry a white halo so WordPress blue stays legible
  over the editor's own selection outline.
- Screenshots: `specs` config takes glob patterns, so a repo keeps specs wherever it likes (next to articles or in
  a mirrored tree). `shotsDir` remains the fallback.
- Screenshots: site editor scenes use the WordPress 6.8+ `?p=/…` routes (the styles view opened the index
  template before); `selectBlock` no longer leaves the inline formatting toolbar over blocks with a caption.
- New package `@wp-docs-toolkit/demo-site`: the blueprint, mu-plugin and content pack moved here from the migration
  repo, now on the Ipsum theme with a `block-image` showcase post.
- New `style/SCREENSHOTS.md` guideline and `examples/block-editor-handbook/`, a sample project rendered end to end
  (Image, Gallery and Table blocks, the site editor).
- Screenshots: `wp-screenshots preview` writes PNG copies of generated images for review by eye or by an agent;
  the `screenshots` skill describes the render, look, fix, place loop around it.

## 0.1.0 (2026-10-13)

Split out of the `toolkit/` directory of wp-documentation-migration, history preserved: `wp-shots/`,
`convert/wp_markdown.py`, `manifest/validate_manifest.py`, `actions/validate-manifest/`, `CONVENTIONS.md`,
`skills/`.
