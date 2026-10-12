---
name: wp-shots
description: Produce or refresh reproducible WordPress UI screenshots for documentation with the wp-shots engine (Playground + Playwright, YAML shot specs). Use when asked to add, update, check, or lint documentation screenshots, or when a WordPress release changes the UI.
---

# Documentation screenshots with wp-shots

The engine is `toolkit/wp-shots` (npm package `wp-shots`, its own `node_modules`). A project consumes it as a path
dependency and holds the project-specific parts: `shots.config.js`, `blueprint/`, and YAML specs under `shots/`.
This repo's project is `screenshots/`; read `screenshots/README.md` and `screenshots/ARCHITECTURE.md` for the
contract between the two layers.

## Commands (run from the project directory)

- `npx wp-shots lint` — specs, references from Markdown to images, orphans. No browser needed. Run before any PR.
- `npx wp-shots check` — re-render and compare pixels; reports changed shots without writing.
- `npx wp-shots run [--article <slug> | --section <name>]` — render and write images plus the manifest.
- `npx wp-shots doctor`, `list`, `vocab`, `snippet`, `dev` — environment, inventory, the step vocabulary, a Markdown
  snippet for a shot, and an interactive session.

## Rules

- Local runs are previews. The canonical render is the CI workflow (`.github/workflows/screenshots.yml`) inside the
  pinned Playwright image; only its output is comparable across time.
- Keep `dockerImage` in `shots.config.js`, `@playwright/test` in `toolkit/wp-shots/package.json`, and the CI image in
  sync.
- A changed image is a prompt to re-read the article text, not just to accept the pixels.
- Nothing under `toolkit/wp-shots` may import from outside it or assume this repo's slugs or paths. Project facts go
  in `shots.config.js`.
