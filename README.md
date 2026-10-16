# wp-docs-toolkit

Tooling for writing and maintaining WordPress.org documentation: reproducible screenshots of the WordPress UI, a
validator for handbook manifests, the Markdown conventions handbooks follow, and skills that teach AI agents the
procedures. It is a utility layer meant to be used by other tools and repositories, from a terminal, from code,
or from a prompt in Claude or ChatGPT.

> **Work in progress.** Versions are 0.x, the demo site is a placeholder, and the API and presets will change as the
> first handbooks adopt it. Feedback and issues are welcome.

## Packages

| Package | What it does | Install |
|---|---|---|
| [`@wp-docs-toolkit/mcp`](packages/mcp) | MCP server: take screenshots and validate manifests by asking, from Claude Desktop, Claude Code, ChatGPT or any MCP client | `npx -y @wp-docs-toolkit/mcp install` |
| [`@wp-docs-toolkit/screenshots`](packages/screenshots) | The engine and `wp-screenshots` CLI: boots a pinned WordPress in Playground, drives it with Playwright, renders YAML-defined or preset-based shots on canonical frames | `npm install -D @wp-docs-toolkit/screenshots` |
| [`@wp-docs-toolkit/manifest`](packages/manifest) | `wp-validate-manifest`: checks a handbook `manifest.json` against what the developer.wordpress.org importer requires; zero dependencies | `npm install -D @wp-docs-toolkit/manifest` |
| [`@wp-docs-toolkit/demo-site`](packages/demo-site) | The Playground environment screenshots are taken in: WordPress 7.1, the Ipsum theme, deterministic demo content with a per-block showcase | comes with the engine |

Also in this repository: a [GitHub Action](actions/validate-manifest) for the validator, the
[Markdown conventions](style/CONVENTIONS.md) and [screenshot guidelines](style/SCREENSHOTS.md), the Claude Code
[skills](skills) (installable as the `wp-docs-toolkit` plugin), and an [example project](examples/block-editor-handbook).

## Quick start

**By prompt.** Install once, restart Claude Desktop, ask.

```sh
npx -y @wp-docs-toolkit/mcp install
```

The first screenshot takes about a minute, while Chromium and a WordPress build download; later ones take a few
seconds. Claude Code is registered by the same command. ChatGPT connects over HTTPS; the
[mcp README](packages/mcp/README.md) covers that route.

**From a terminal.** One image, nothing to configure:

```sh
npx -y -p @wp-docs-toolkit/screenshots wp-screenshots shoot --preset site-editor --out site-editor.webp
```

`wp-screenshots presets` lists the subjects.

**In a documentation repo.** Specs live next to the articles; `run` renders, `check --docker` produces the canonical
pixels, `lint` ties images to Markdown. The [screenshots README](packages/screenshots/README.md) has the spec
format and the [example project](examples/block-editor-handbook) shows a working setup.

**In CI.** `uses: ndiego/wp-docs-toolkit/actions/validate-manifest@v0.3.3` with `manifest` and `docs` inputs, so a
manifest that would break an import cannot merge.

## Sample prompts

With the MCP server installed, these work as written in Claude Desktop, Claude Code or ChatGPT:

- *Take a screenshot of the General Settings page in wp-admin.*
- *Show me the Image block on the editor canvas.*
- *The Image block's Settings tab with the Resolution control outlined.*
- *Screenshot the post editor with an arrow on the Save draft button.*
- *The Image block's toolbar, with numbered badges on Replace and Options.*
- *Give me the site editor's Styles view and save it to ~/Desktop/styles.webp.*
- *A screenshot of the Plugins screen, cropped to the content area, not the whole admin.*
- *What screenshot presets are there?*
- *Validate docs/manifest.json against the docs folder.*

Subjects are presets: a block on the canvas, its toolbar or settings tab, the site editor and its views, the post
editor, any wp-admin screen, the front end. Highlights are anchored to named controls, so "outline the Resolution
control" finds the control by its label. Blocks with showcase content are Image, Gallery and Table; for others, ask
for the block "in a new post".

## Skills for Claude Code

```text
/plugin marketplace add ndiego/wp-docs-toolkit
/plugin install wp-docs-toolkit@wp-docs-toolkit
```

`screenshots` teaches the render, look, fix, place loop; `validate-manifest` explains what each check means.

## Principles

- Nothing here knows a handbook's slugs, paths or URLs. Those arrive as configuration.
- Nothing here changes how developer.wordpress.org renders; the toolkit produces input the importer accepts.
- Consumers pin a version. Every package shares one version; git consumers pin a tag.
- Style and voice are the Docs team's [style guide](https://make.wordpress.org/docs/style-guide/); the
  conventions here are about what the importer and GitHub need.
- Maintenance tooling only. One-time migration tooling lives in
  [wp-documentation-migration](https://github.com/ndiego/wp-documentation-migration).

## Development

```sh
git clone https://github.com/ndiego/wp-docs-toolkit.git && cd wp-docs-toolkit
npm ci && npm run setup      # dependencies, then Chromium
npm run lint && npm test
```

Plain ESM JavaScript with JSDoc, no build step. CI runs lint, tests, the skills check and the action against its
own fixture. Releases: update `CHANGELOG.md`, bump every package to the same version, tag `vX.Y.Z` on `trunk`,
publish the four packages in dependency order (`manifest`, `demo-site`, `screenshots`, `mcp`). Publishing needs a
one-time password per package, so it runs from a terminal.

## Status

Done: screenshot engine with presets, frames and annotations; demo site on Ipsum with Image, Gallery and Table
showcases; MCP server with a warm WordPress session; manifest validator and action; conventions and guidelines.
Next: more blocks in the showcase, a Markdown conventions linter, a style and spelling check for WordPress.org
prose, a hosted MCP endpoint, and an upstream request to slim the Playground runtime, which currently ships a PHP
build for every version.

## License

GPL-2.0-or-later. The demo site's photos are CC0 (see `packages/demo-site/content/LICENSES.md`); the Ipsum theme
is vendored from [WordPress/ipsum](https://github.com/WordPress/ipsum).
