# Changelog

All packages in this repository share one version. Consumers pin a tag.

## 0.2.0 (unreleased)

Restructured as an npm workspaces monorepo focused on maintaining WordPress.org documentation.

- `wp-shots/` is now `packages/screenshots/`, published as `@wporg-docs/screenshots` with the binary
  `wp-screenshots`. Renamed with it: the working directory `.wp-screenshots/`, the environment variable
  `WP_SCREENSHOTS_CANONICAL`, the REST index key `wp_screenshots` a demo mu-plugin may expose, and the Docker
  volume prefix.
- `--docker` now installs the engine where it lives (the toolkit checkout when consumed as a path dependency)
  and uses that install's Playwright to fetch Chromium. Before, it assumed the old `engine/` layout.
- The manifest validator is ported from Python to Node as `packages/manifest/` (`@wporg-docs/manifest`, binary
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
- New package `@wporg-docs/demo-site`: the blueprint, mu-plugin and content pack moved here from the migration
  repo, now on the Ipsum theme with a `block-image` showcase post.
- New `style/SCREENSHOTS.md` guideline and `examples/block-editor-handbook/`, a sample project rendered end to end.

## 0.1.0 (2026-10-13)

Split out of the `toolkit/` directory of wp-documentation-migration, history preserved: `wp-shots/`,
`convert/wp_markdown.py`, `manifest/validate_manifest.py`, `actions/validate-manifest/`, `CONVENTIONS.md`,
`skills/`.
