---
name: screenshots
description: Produce or refresh reproducible WordPress UI screenshots for documentation with the @wporg-docs/screenshots engine (WordPress Playground + Playwright, YAML shot specs). Use when asked to add, update, check, or lint documentation screenshots, or when a WordPress release changes the UI.
---

# Documentation screenshots

The engine is the npm package `@wporg-docs/screenshots` (binary `wp-screenshots`). A documentation repo holds the
project-specific parts: `shots.config.js`, a Playground `blueprint/`, and YAML specs under `shots/`. Read the
engine's `README.md` (commands, spec format) and `ARCHITECTURE.md` (the contract between engine and project) in
`packages/screenshots/` of the toolkit, and the project's own README for its paths and demo-site slugs.

## Commands (run from the project directory, the one holding `shots.config.js`)

- `npx wp-screenshots lint` validates specs, cross-checks Markdown image references and finds orphans. No browser
  needed. Run before any PR.
- `npx wp-screenshots check` re-renders to a staging dir, compares pixels and writes an HTML report. It stages the
  changed images without touching the committed ones.
- `npx wp-screenshots update` accepts what the last `check` staged (images and manifest entries).
- `npx wp-screenshots run [--article <slug> | --section <path>]` renders and writes images and the manifest directly.
- `npx wp-screenshots dev --article <slug> --shot <id>` opens a headed browser, runs the scene and steps, and pauses in
  the Playwright Inspector. Use its "Pick locator" tool to find role and name for a new step.
- `doctor`, `list`, `vocab`, `snippet` check the setup, list specs, print the step vocabulary, and print the Markdown
  image lines for an article.

## Rules

- Local runs are previews. Fonts differ between macOS and Linux, so only a render inside the pinned Playwright image
  (`--docker` locally, or the project's CI workflow) is canonical and comparable over time. Never commit local
  renders over canonical ones; revert them unless rendered with `--docker`.
- Release flow: `check --docker`, review the report, `update`, open a PR. Never follow `update` with a plain `run`.
- A changed image is a prompt to re-read the article text, not just to accept the pixels.
- Alt text lives in the spec and is the source of truth. `lint --fix` copies it into the Markdown.
- Keep `dockerImage` in `shots.config.js`, `@playwright/test` in the engine's `package.json`, and the project's CI
  image in sync.
- Nothing in the engine may know a project's slugs or paths. Project facts go in `shots.config.js`; content is
  resolved against the running demo site by slug (`{{media.<slug>}}`, `{{post.<slug>}}`).
- Specs fail fast on unknown keys, verbs, scenes, targets and locator keys, so run `lint` after editing a spec.
