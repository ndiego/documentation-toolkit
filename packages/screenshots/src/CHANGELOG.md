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

## 0.1.0 (2026-10-13)

Split out of the `toolkit/` directory of wp-documentation-migration, history preserved: `wp-shots/`,
`convert/wp_markdown.py`, `manifest/validate_manifest.py`, `actions/validate-manifest/`, `CONVENTIONS.md`,
`skills/`.
