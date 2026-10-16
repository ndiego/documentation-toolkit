---
name: screenshots
description: Produce or refresh reproducible WordPress UI screenshots for documentation with the @wp-docs-toolkit/screenshots engine (WordPress Playground + Playwright, YAML shot specs). Use when asked to add, update, check, or lint documentation screenshots, or when a WordPress release changes the UI.
---

# Documentation screenshots

The engine is the npm package `@wp-docs-toolkit/screenshots` (binary `wp-screenshots`). A documentation repo holds the
project-specific parts: `shots.config.js`, a Playground `blueprint/`, and YAML specs under `shots/`. Read the
engine's `README.md` (commands, spec format) and `ARCHITECTURE.md` (the contract between engine and project) in
`packages/screenshots/` of the toolkit, and the project's own README for its paths and demo-site slugs.

## Start from a subject

Most requests are one of a few subjects. Write the shot with a preset and let the engine supply scene, steps and
framing; override only what the request needs. `npx wp-screenshots presets` lists presets and parameters.

- "the Image block on the canvas" → `preset: block-canvas`, `block: core/image`
- "its settings panel" / "the Styles tab" → `preset: block-settings`, `block`, `tab: settings | styles | content`
- "the block toolbar" → `preset: block-toolbar`
- "a screenshot of the site editor" / "the Styles view" → `preset: site-editor` [, `view: styles`]
- "the Plugins screen" → `preset: admin-screen`, `screen: plugins.php`
- one image right now, no spec, no project: `npx wp-screenshots shoot --preset site-editor --out site-editor.webp`
  works from any directory; without a `shots.config.js` it boots the toolkit's bundled demo site. If Chromium is
  missing it says so and gives the install command.

Highlight with one annotation type per image: `outline` by default, `arrow` when the target is small or has
lookalikes, numbered `badge` for enumerated steps, `dim` for noisy surroundings. Annotations scale automatically
for the displayed size; if a highlight would need to be large to be seen, crop tighter (a narrower preset or
target) instead of relying on the scale. Read `style/SCREENSHOTS.md` in the
toolkit for the frames, the annotation style and the text-in-images preference (minimal by default, "no text" or
"full" on request).

Block presets expect the demo site to hold a showcase post `block-<name>` for the block; when it does not, pass
`post: new` (inserts the block into a fresh post) or write the steps by hand.

## The loop

1. Write or edit the spec (a preset plus the request's specifics). `npx wp-screenshots lint` catches typos before
   anything boots.
2. Render it: `npx wp-screenshots run --article <slug>` (local preview is fine while iterating).
3. Look at it: `npx wp-screenshots preview --article <slug> --width 1400` writes PNG copies under
   `<workDir>/preview/` and prints their paths; open them with the Read tool. Check that nothing is cut off, no
   stray popover or inline toolbar is showing, the annotation points at the right element, and the frame suits the
   subject. If something is wrong, change the spec (a different target, `pad`, `fit: content`, a `wait` step, a
   different `from` for an arrow) and go back to step 2.
4. Place it: `npx wp-screenshots snippet --article <slug>` prints the Markdown image lines with the alt text; put
   them where the article discusses that UI. `lint` confirms the references resolve.
5. Hand over: the canonical pixels come from `check --docker` or the project's CI job, then `update`. Say so in
   the pull request; do not commit local renders over canonical ones.

## Commands (run from the project directory, the one holding `shots.config.js`)

- `npx wp-screenshots lint` validates specs, cross-checks Markdown image references and finds orphans. No browser
  needed. Run before any PR.
- `npx wp-screenshots check` re-renders to a staging dir, compares pixels and writes an HTML report. It stages the
  changed images without touching the committed ones.
- `npx wp-screenshots update` accepts what the last `check` staged (images and manifest entries).
- `npx wp-screenshots run [--article <slug> | --section <path>]` renders and writes images and the manifest directly.
- `npx wp-screenshots dev --article <slug> --shot <id>` opens a headed browser, runs the scene and steps, and pauses in
  the Playwright Inspector. Use its "Pick locator" tool to find role and name for a new step.
- `doctor`, `list`, `vocab`, `snippet`, `preview` check the setup, list specs, print the step vocabulary, print the
  Markdown image lines for an article, and write PNG copies of generated images for review.

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
- Specs fail fast on unknown keys, verbs, scenes, targets, frames, presets and locator keys, so run `lint` after
  editing a spec.
- Look at the image after rendering (convert WebP to PNG if needed). Check: nothing cut off, no stray popovers or
  inline toolbars, the annotation points at the right element, the frame suits the subject.
