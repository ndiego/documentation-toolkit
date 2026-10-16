# Changelog

All packages in this repository share one version. Consumers pin a tag.

## Unreleased

- New package `@wp-docs-toolkit/mcp`: an MCP server (stdio, or Streamable HTTP with `--http`) with `screenshot`,
  `list_presets` and `validate_manifest` tools, so Claude Desktop, Claude Code, ChatGPT and other MCP clients can
  take screenshots by asking. The repo's `.mcp.json` registers it for Claude Code. `shootPreset()` is now a library
  function of `@wp-docs-toolkit/screenshots` (the CLI's `shoot` uses it) and can pick a free Playground port.

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
