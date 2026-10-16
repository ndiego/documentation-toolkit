# wp-docs-toolkit

Tooling for writing and maintaining WordPress.org documentation. The repository holds the parts that must be
identical across every documentation repo: the screenshot engine, the handbook manifest validator and its CI
action, the Markdown conventions, and the skills that teach an agent the procedures. Each handbook's content,
pipeline and preview site live in that handbook's own repo.

| Path | What | Consumed how |
|---|---|---|
| `packages/screenshots/` | `@wp-docs-toolkit/screenshots`: reproducible WordPress UI screenshots from YAML specs (WordPress Playground + Playwright). Binary `wp-screenshots`. | A documentation repo depends on it and runs `wp-screenshots` from a project directory holding `shots.config.js`, a blueprint and specs. [README](packages/screenshots/README.md), [ARCHITECTURE](packages/screenshots/ARCHITECTURE.md). |
| `packages/demo-site/` | `@wp-docs-toolkit/demo-site`: the Playground environment screenshots are taken in. Pinned WordPress 7.1 and PHP 8.3, the Ipsum theme (the proposed 7.2 default, vendored), a clean wp-admin, a deterministic demo content pack with a per-block showcase. | A project sets `blueprint` in `shots.config.js` to its `blueprint.json`. [README](packages/demo-site/README.md). |
| `packages/mcp/` | `@wp-docs-toolkit/mcp`: an MCP server exposing `screenshot`, `list_presets` and `validate_manifest` to Claude Desktop, Claude Code, ChatGPT or any MCP client. Binary `wp-docs-mcp`, stdio or Streamable HTTP. | Point the client at `node packages/mcp/src/cli.js`; the repo's `.mcp.json` does it for Claude Code. [README](packages/mcp/README.md). |
| `packages/manifest/` | `@wp-docs-toolkit/manifest`: validator for `wporg-markdown` importer manifests (path keys, parents first, slug takeover, GitHub sources, one H1, no raw block markup, frozen keys). Binary `wp-validate-manifest`, no dependencies. | `npx wp-validate-manifest manifest.json --docs . --frozen …` locally; the action below in CI. [README](packages/manifest/README.md). |
| `actions/validate-manifest/` | GitHub composite action wrapping the validator. | `uses: ndiego/wp-docs-toolkit/actions/validate-manifest@<tag>` |
| `style/CONVENTIONS.md` | The Markdown conventions every handbook repo follows, derived from importer behaviour. | Read before writing or converting content; linked from each handbook's CONTRIBUTING. |
| `style/SCREENSHOTS.md` | The screenshot guidelines: subjects and presets, the four canonical frames, annotation style, text in images, alt text. | Read before adding screenshots; the engine enforces the mechanical parts. |
| `examples/block-editor-handbook/` | A slice of the Block Editor Handbook with specs next to the articles, rendered against the demo site. | The engine's integration fixture and the gallery for the guidelines. `cd` there and run `npx wp-screenshots run`. |
| `skills/` | Claude Code skills: `screenshots`, `validate-manifest`. | Installed as the `wp-docs-toolkit` plugin (below) so agents follow the same procedures everywhere. |

Planned next: style enforcement (WordPress.org spelling, terminology and formatting as a Vale style package plus a
skill that applies it). The Docs team style guide on make.wordpress.org/docs stays the source of truth; the toolkit
only enforces it.

## Share it with a colleague

Paste this in Slack. It is everything a technical colleague needs, from a terminal to a prompt:

> **wp-docs-toolkit** takes reproducible screenshots of the WordPress UI from a prompt. Install (needs Node 22.19+;
> one command, no clone):
> ```
> npx -y @wp-docs-toolkit/mcp install
> ```
> Then quit and reopen Claude Desktop, and in a new chat say: *"Take a screenshot of the General Settings page in
> wp-admin."* The first one takes a minute (it downloads a browser and boots WordPress); after that a few seconds.
> Claude Code is registered too. More to try: *"the Image block on the editor canvas"*, *"its Styles tab with the
> Resolution setting highlighted"*, *"the post editor with an arrow on the Save draft button"*. Ask *"what
> screenshot presets are there?"* to see the list. ChatGPT needs a tunnel: `npx -y @wp-docs-toolkit/mcp --help`.

The command registers the MCP server in Claude Desktop (merging into the existing config, with a backup) and in
Claude Code, with absolute paths so the desktop app finds Node. `npx -y @wp-docs-toolkit/mcp uninstall` removes it.
Details and the ChatGPT route are in [packages/mcp](packages/mcp/README.md). The packages are on npm under
[`@wp-docs-toolkit`](https://www.npmjs.com/org/wp-docs-toolkit); `scripts/install.sh` remains for installing from a
git checkout.

## Quick start: one screenshot, nothing to configure

```sh
git clone https://github.com/ndiego/wp-docs-toolkit.git && cd wp-docs-toolkit
npm ci && npm run setup                      # dependencies, then Chromium for Playwright (once)
npm run shoot -- --preset site-editor --out ~/Desktop/site-editor.webp
```

That boots the bundled demo site (WordPress 7.1, the Ipsum theme, demo content), renders the subject on a
canonical frame and writes the image. `npx wp-screenshots presets` lists the subjects and their parameters, for
example `--preset block-settings --block core/image --tab styles`. From any other directory, the same works with
`npx --prefix path/to/wp-docs-toolkit wp-screenshots shoot …`. To ask for it in words instead, install the Claude
Code plugin (below) or connect the MCP server (`packages/mcp/`) to Claude Desktop, ChatGPT or any MCP client.

## Consuming it

Pin a tag, never a branch (rule 4 below). Every package shares the repository version.

**npm packages.** `@wp-docs-toolkit/screenshots`, `@wp-docs-toolkit/manifest`, `@wp-docs-toolkit/demo-site` and
`@wp-docs-toolkit/mcp`, one shared version. A documentation project depends on `@wp-docs-toolkit/screenshots`
from npm. The submodule route below still works for a project that wants to track a git tag instead:

```sh
git submodule add https://github.com/ndiego/wp-docs-toolkit.git toolkit
( cd toolkit && git checkout v0.3.3 && npm ci )
```

```json
{ "dependencies": { "@wp-docs-toolkit/screenshots": "file:../toolkit/packages/screenshots" } }
```

The engine's dependencies install at the toolkit root (`npm ci` there), not inside the package, because the repo is
an npm workspace. Projects that install Chromium in a `postinstall` use `npm exec --prefix ../toolkit -- playwright install chromium`.

**The action.** `uses: ndiego/wp-docs-toolkit/actions/validate-manifest@v0.3.3` with `manifest`, `docs`,
optional `frozen`, `allow-missing-parent` and `strict` inputs.

**The skills.** The repo is a Claude Code plugin and its own marketplace:

```text
/plugin marketplace add ndiego/wp-docs-toolkit
/plugin install wp-docs-toolkit@wp-docs-toolkit
```

Or for one session without installing: `claude --plugin-dir path/to/wp-docs-toolkit`.

## Boundary rules

1. Nothing in this repository imports from, reads, or assumes anything outside it.
2. Nothing here knows a handbook's slugs, paths, URL base, categories, or media library. Those arrive as
   configuration (`shots.config.js`, function arguments, action inputs) or stay in the handbook's own scripts.
3. Nothing here changes how developer.wordpress.org renders content. Rendering lives in the importer subclasses in
   `WordPress/wporg-developer`; the toolkit produces input the importer accepts and checks it before merge.
4. Consumers pin a version. Content repos reference a tag, never a branch, so a change here cannot silently alter
   every handbook's next import or render.
5. Style and voice are the Docs team's style guide on make.wordpress.org/docs. `style/CONVENTIONS.md` is about what
   the importer and GitHub need, and links out for everything else. No third source of truth.
6. Maintenance tooling only. One-time migration tooling (the HTML-to-Markdown converter, the handbook cutover
   procedure) lives with the migration, in wp-documentation-migration.

## Development

```sh
npm ci            # installs every workspace
npm run lint      # ESLint with the WordPress config, Prettier (wp-prettier)
npm test          # node --test in every package
npm run format
```

Code is plain ESM JavaScript with JSDoc types and no build step. CI runs lint, tests, the skills check and the
action against its own fixture on every pull request.

## Releasing

1. Update `CHANGELOG.md` and bump the version in every package manifest, `.claude-plugin/plugin.json` and the
   `version` in `packages/mcp/src/server.js` (one version for everything; inter-package dependencies pin it).
2. Tag `vX.Y.Z` on `trunk` and push the tag.
3. Publish to npm, in dependency order, from a logged-in shell (`npm login --registry https://registry.npmjs.org`;
   each package pins the public registry in `publishConfig`, so a corporate proxy in `.npmrc` is bypassed; the `@wp-docs-toolkit` scope must exist
   as an npm organisation, free for public packages, or be replaced by the publisher's own scope):
   ```sh
   npm publish -w @wp-docs-toolkit/manifest
   npm publish -w @wp-docs-toolkit/demo-site
   npm publish -w @wp-docs-toolkit/screenshots
   npm publish -w @wp-docs-toolkit/mcp
   ```
   `npm pack --dry-run -w <package>` shows what each one ships. The account requires a one-time password per
   publish, approved in the browser, so publish from a terminal, not from an agent session. Staged publishes
   show as `0.0.0-stage` placeholders until approved on npmjs.com.
4. Consumers check out the new tag inside their `toolkit/` submodule and commit the pointer.

## History

Named `documentation-toolkit` until 2026-10-16; the old GitHub URL redirects here.
Split out of the `toolkit/` directory of
[ndiego/wp-documentation-migration](https://github.com/ndiego/wp-documentation-migration) on 2026-10-13, history
preserved, when a second repo (the wordpress.org/docs exploration, `wp-docs-platform`) started consuming it.
Restructured as a monorepo in 0.2.0; see `CHANGELOG.md`. Still open before proposing it under the WordPress
organisation: publish the packages to npm, and add a problem statement, named maintainers and CODEOWNERS.
