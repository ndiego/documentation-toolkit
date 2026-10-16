---
name: validate-manifest
description: Validate a handbook manifest.json for the wporg-markdown importer on developer.wordpress.org before it is merged, catching the mistakes that have broken real imports. Use when a manifest is generated or edited, when setting up CI for a handbook repo, or when an import created duplicates or moved pages.
---

# Validate a handbook manifest

Run: `npx wp-validate-manifest manifest.json --docs <repo root> [--frozen frozen-paths.json] [--strict]`
(package `@wporg-docs/manifest`, no dependencies). In CI, use the composite action
`ndiego/documentation-toolkit/actions/validate-manifest@<tag>` (same checks, same flags).

## What it enforces, and why

- Object keyed by page path, not the Gutenberg list format. The Theme Handbook reuses 7 slugs on 14 pages; a list
  manifest keys by slug and cannot express that.
- Parents are keys (paths), listed before their children. Bare-slug parents resolve only at the top level; a child
  listed before a not-yet-existing parent is created top-level (importer bug, `process_manifest_doc()`).
- A new entry may not reuse an existing slug: the importer's slug fallback silently takes over the other post and
  moves it (reproduced in the Theme Handbook spike). Pass `--frozen` with the live key list so "new" is known.
- `order` is an integer and existing pages keep their frozen order. The importer never re-applies `0`.
- `markdown_source` is a `github.com/<org>/<repo>/blob/<branch>/…md` URL. Raw URLs break the "Improve it on GitHub"
  link. Relative paths are allowed for local/spike manifests and reported as warnings.
- With `--docs`: the file exists, starts with exactly one `# Title` equal to `title`, has no other H1, and has no
  unescaped `<!-- wp:` outside code fences (it flips `has_blocks()` and disables `wpautop` for the whole page).
- Removals and renames of frozen keys fail: the importer never deletes, so they need a redirect PR and a manual
  unpublish by a Meta committer.

## Reading the output

Errors fail the run. Warnings (duplicate slugs that already exist on the site, relative sources, nested paths with no
parent) are informational unless `--strict`. A documented exception, such as a page whose parent is intentionally
unpublished, goes in `--allow-missing-parent`.
