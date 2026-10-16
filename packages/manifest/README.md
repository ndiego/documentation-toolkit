# @wporg-docs/manifest

`wp-validate-manifest` checks a `manifest.json` for the `wporg-markdown` importer used on developer.wordpress.org.
The checks come from the importer's actual behaviour (`notes/theme-handbook-migration/research/02-pipeline-precedents.md`
§1.3, §5.6) and from imports that failed on manifest errors (Advanced Administration 2023, Accessibility 2026).

No runtime dependencies; Node 22.19 or later.

## Run

```
npx wp-validate-manifest manifest.json --docs . --frozen frozen-paths.json \
    [--allow-missing-parent <key> ...] [--strict]
```

- `manifest.json`: the manifest, a JSON object keyed by page path.
- `--docs DIR`: the repo root the `markdown_source` paths resolve under; enables the per-file checks (file exists, one
  `# Title` equal to `title`, no extra H1, no raw `<!-- wp:` outside fences).
- `--frozen FILE`: a JSON list of the live page paths, or an object keyed by path whose values may carry a frozen
  `order`. Missing or renamed keys fail; a new key whose slug already exists among the frozen ones fails (the importer
  would take over that post); a changed frozen `order` fails.
- `--allow-missing-parent KEY ...`: one or more keys whose parent is intentionally absent from the manifest (for
  example a parent that is unpublished on purpose). Their missing parent is reported as a warning instead of an error.
- `--strict`: treat warnings as errors.
- `-h`, `--help`: usage.

Output goes to stdout: every `warning: …` line, then every `error: …` line, then `N entries, E errors, W warnings`.
The exit code is 1 on any error, or on any warning with `--strict`; otherwise 0. A manifest that cannot be read or
parsed, or that is not a JSON object, exits 1 with a single `error:` line.

## Library

```js
import { validateManifest } from '@wporg-docs/manifest';

const { errors, warnings, entries } = validateManifest( manifest, {
	docs: '.', // optional: enables the per-file checks
	frozen: [ 'index', 'getting-started' ], // optional: list or { key: { order } } object
	allowMissingParent: [ 'advanced/legacy' ], // optional
	readFile: ( absolutePath ) => string | null, // optional: defaults to the filesystem
} );
```

`manifest` is the parsed manifest object (the function throws a `TypeError` for anything that is not a plain
object). `errors` and `warnings` are arrays of message strings without the `error:`/`warning:` prefix; `entries` is
the number of keys. `readFile` receives the resolved absolute path and returns the file's contents, or `null` when
there is no regular file at that path; override it to validate against an in-memory tree.

## What it enforces, and why

- Object keyed by page path, not the Gutenberg list format. The Theme Handbook reuses 7 slugs on 14 pages; a list
  manifest keys by slug and cannot express that.
- Keys are unique and normalised: no leading or trailing slash. Two keys that differ only by surrounding slashes are
  duplicates.
- `slug` is a sanitized slug (`[a-z0-9-]+`) and equals the key's last path segment (`index` is exempt). When `slug`
  is absent, the last segment is used.
- Parents are keys (paths), listed before their children, and each child's path sits under its parent. Bare-slug
  parents resolve only at the top level; a child listed before a not-yet-existing parent is created top-level
  (importer bug, `process_manifest_doc()`). A nested path with no parent is a warning.
- A new entry may not reuse an existing slug: the importer's slug fallback silently takes over the other post and
  moves it (reproduced in the Theme Handbook spike). Pass `--frozen` with the live key list so "new" is known. Without
  it, a reused slug is a warning (safe only if both pages already exist on the site).
- `order` is an integer (booleans are not) and existing pages keep their frozen order. The importer never re-applies
  `0`.
- `markdown_source` is a `github.com/<org>/<repo>/blob/<branch>/…md` URL. Raw URLs break the "Improve it on GitHub"
  link. Relative paths are allowed for local/spike manifests and reported as warnings.
- With `--docs`: the file exists, starts with exactly one `# Title` equal to `title` (frontmatter is stripped first,
  as the importer does), has no other H1, and has no unescaped `<!-- wp:` outside code fences (it flips `has_blocks()`
  and disables `wpautop` for the whole page). Fences open and close on lines starting with ``` or `~~~`.
- Removals and renames of frozen keys fail: the importer never deletes, so they need a redirect PR and a manual
  unpublish by a Meta committer.

## Reading the output

Errors fail the run. Warnings (duplicate slugs that already exist on the site, relative sources, nested paths with no
parent, allowed missing parents) are informational unless `--strict`. A documented exception, such as a page whose
parent is intentionally unpublished, goes in `--allow-missing-parent`.

## CI

The composite action in `../../actions/validate-manifest/` runs this same code with the same flags. Generate the
manifest from the file tree in CI as well and fail if the committed one is stale (the Secure Custom Fields repo's
`docs-manifest.yml` is the model); the generator is handbook-specific until a second handbook needs the same one.

## Tests

```
npm test -w @wporg-docs/manifest
```
