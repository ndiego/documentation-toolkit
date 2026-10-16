# Example: a slice of the Block Editor Handbook

A small documentation project that exercises the toolkit end to end: Markdown articles with their screenshot specs
kept next to them (`<article>.shots.yaml`), the toolkit's demo site as the environment, and generated images under
`docs/assets/screenshots/`. It doubles as the engine's integration fixture and as the gallery for
`style/SCREENSHOTS.md`.

```sh
# from the repository root, after `npm ci`
cd examples/block-editor-handbook
npx wp-screenshots doctor
npx wp-screenshots run            # local preview render
npx wp-screenshots check --docker # canonical render, report in .wp-screenshots/report/
npx wp-screenshots lint
```

Every shot here is built from a preset, so the specs read as subjects rather than scripts. `npx wp-screenshots presets`
lists them.
