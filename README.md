# documentation-toolkit

The parts that must be identical across every WordPress documentation repo: the screenshot engine, the
HTML-to-Markdown converter interface, the manifest validator and its CI action, the Markdown conventions, and the
skills that teach an agent the processes. Research notes, each handbook's own pipeline, generated content and
preview sites are project-specific and live in the consuming repos.

This repository was split out of the `toolkit/` directory of
[ndiego/wp-documentation-migration](https://github.com/ndiego/wp-documentation-migration) on 2026-10-13, history
preserved, when a second repo (the wordpress.org/docs exploration, `wp-docs-platform`) started consuming it.

## Consuming it

Pin a tag, never a branch (rule 4 below).

- As a git submodule at `toolkit/`: `git submodule add <this repo> toolkit`, then check out the tag inside it.
- The composite action: `uses: ndiego/documentation-toolkit/actions/validate-manifest@v0.1.0`.
- `wp-shots` is not on npm yet and lives in a subdirectory, so a git URL dependency does not work. Use the
  submodule and `"wp-shots": "file:../toolkit/wp-shots"` in the project's `package.json`.
- The converter interface needs the converter core, which is not extracted yet. Set `WP_MARKDOWN_CORE` to the
  path of `scripts/convert.py` in a wp-documentation-migration checkout, or keep that checkout as a sibling
  directory of this one. Extracting the core is the first open item under "Promotion status".

## Contents

| Path | What | Consumed how |
|---|---|---|
| `wp-shots/` | The screenshot engine: npm package `wp-shots` (Playground + Playwright + YAML specs). Own `package.json`, own `node_modules`. | A project depends on it as `"wp-shots": "file:../toolkit/wp-shots"` (later: from npm) and runs `npx wp-shots …` from its own directory. wp-documentation-migration's project is its `screenshots/` directory. |
| `convert/wp_markdown.py` | The converter interface: `html_to_markdown()`, `sanitize_title()`, `unique_id()`, callout styles. | Import this module. It loads the core from wp-documentation-migration today; callers never touch that file. |
| `manifest/validate_manifest.py` | Validator for importer manifests (path keys, parents first, slug takeover, GitHub sources, one H1, no raw block markup, frozen keys). | `python3 -I toolkit/manifest/validate_manifest.py manifest.json --docs . --frozen …` |
| `actions/validate-manifest/` | GitHub composite action wrapping the validator. | `uses: ndiego/documentation-toolkit/actions/validate-manifest@<tag>` |
| `CONVENTIONS.md` | The Markdown conventions every handbook repo follows, derived from importer behaviour. | Read before writing or converting content; linked from each handbook's CONTRIBUTING. |
| `skills/` | Claude Code skills: `convert-handbook`, `validate-handbook-manifest`, `wp-shots`, `handbook-cutover`. | Installed per project (plugin or symlink) so agents follow the same procedures everywhere. |

## Boundary rules

1. Nothing in this repository imports from, reads, or assumes anything outside it, with one declared exception:
   `convert/wp_markdown.py` loads the converter core from wp-documentation-migration (`WP_MARKDOWN_CORE` or a
   sibling checkout) until the core is extracted. Extracting it changes only that loader.
2. Nothing here knows a handbook's slugs, paths, URL base, categories, or media library. Those arrive as
   configuration (`shots.config.js`, function arguments, action inputs) or stay in the handbook's own scripts.
3. Nothing here changes how developer.wordpress.org renders content. Rendering lives in the importer
   subclasses in `WordPress/wporg-developer`; the toolkit produces input the importer accepts and checks it before merge.
4. Consumers pin a version. Content repos reference a tag, never a branch, so a converter change cannot silently
   rewrite every handbook's next import.
5. Style and voice are the Docs team's style guide on make.wordpress.org/docs. `CONVENTIONS.md` is about what the
   importer and GitHub need, and links out for everything else. No third source of truth.

## Promotion status

The split happened when a second content repo consumed it. Still open, in order:

1. Extract the converter core from wp-documentation-migration's `scripts/convert.py` into `convert/` and drop the
   loader exception in rule 1.
2. Publish `wp-shots` to npm so consumers no longer need the submodule for it.
3. Replace the `toolkit/` directory in wp-documentation-migration with this repo pinned at a tag.
4. Add a problem statement, named maintainers and CODEOWNERS (the 2025-06 org repo criteria) before proposing it
   under the WordPress organisation.
