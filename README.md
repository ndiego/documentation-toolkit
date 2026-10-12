# toolkit

The parts of this repository that must be identical across every handbook repo: the screenshot engine, the
HTML-to-Markdown converter interface, the manifest validator and its CI action, the Markdown conventions, and the
skills that teach an agent the processes. Everything else in the repository (research notes, the HelpHub pipeline
under `scripts/`, the generated `docs/`, the Astro preview in `site/`) is project-specific and stays outside.

This directory is a future repository (working name: `documentation-toolkit`). It is carved out now, while this is
the only consumer, so the boundary exists before the Theme Handbook repo becomes the second consumer. Promotion to
its own repo is a move, not a rewrite, if the rules below hold.

## Contents

| Path | What | Consumed how |
|---|---|---|
| `wp-shots/` | The screenshot engine: npm package `wp-shots` (Playground + Playwright + YAML specs). Own `package.json`, own `node_modules`. | A project depends on it as `"wp-shots": "file:../toolkit/wp-shots"` (later: from npm) and runs `npx wp-shots …` from its own directory. This repo's project is `../screenshots/`. |
| `convert/wp_markdown.py` | The converter interface: `html_to_markdown()`, `sanitize_title()`, `unique_id()`, callout styles. | Import this module. It loads the core from `../scripts/convert.py` today; callers never touch that file. |
| `manifest/validate_manifest.py` | Validator for importer manifests (path keys, parents first, slug takeover, GitHub sources, one H1, no raw block markup, frozen keys). | `python3 -I toolkit/manifest/validate_manifest.py manifest.json --docs . --frozen …` |
| `actions/validate-manifest/` | GitHub composite action wrapping the validator. | `uses: <org>/<repo>/toolkit/actions/validate-manifest@<tag>` |
| `CONVENTIONS.md` | The Markdown conventions every handbook repo follows, derived from importer behaviour. | Read before writing or converting content; linked from each handbook's CONTRIBUTING. |
| `skills/` | Claude Code skills: `convert-handbook`, `validate-handbook-manifest`, `wp-shots`, `handbook-cutover`. | Installed per project (plugin or symlink) so agents follow the same procedures everywhere. |

## Boundary rules

1. Nothing under `toolkit/` imports from, reads, or assumes anything outside `toolkit/`, with one declared exception:
   `convert/wp_markdown.py` loads the converter core from `../scripts/convert.py` until the core is extracted.
   Extracting it changes only that loader.
2. Nothing under `toolkit/` knows a handbook's slugs, paths, URL base, categories, or media library. Those arrive as
   configuration (`shots.config.js`, function arguments, action inputs) or stay in the handbook's own scripts.
3. Nothing under `toolkit/` changes how developer.wordpress.org renders content. Rendering lives in the importer
   subclasses in `WordPress/wporg-developer`; the toolkit produces input the importer accepts and checks it before merge.
4. Consumers pin a version. Once this is a repo, content repos reference a tag, never a branch, so a converter change
   cannot silently rewrite every handbook's next import.
5. Style and voice are the Docs team's style guide on make.wordpress.org/docs. `CONVENTIONS.md` is about what the
   importer and GitHub need, and links out for everything else. No third source of truth.

## Promotion criteria

Split into its own repository when a second content repo consumes it. At that point: give it a problem statement,
named maintainers and CODEOWNERS (the 2025-06 org repo criteria), move `actions/` to a path consumers can reference,
publish `wp-shots` to npm or keep the path dependency via a git URL, and replace the loader exception in rule 1.
