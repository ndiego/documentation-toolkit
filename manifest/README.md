# manifest

`validate_manifest.py` checks a `manifest.json` for the `wporg-markdown` importer used on developer.wordpress.org.
The checks come from the importer's actual behaviour (`notes/theme-handbook-migration/research/02-pipeline-precedents.md`
§1.3, §5.6) and from imports that failed on manifest errors (Advanced Administration 2023, Accessibility 2026).

```
python3 -I toolkit/manifest/validate_manifest.py manifest.json --docs . --frozen frozen-paths.json \
    [--allow-missing-parent <key> ...] [--strict]
```

- `--frozen`: a JSON list of the live page paths (or an object with their frozen `order`). Missing or renamed keys
  fail; a new key whose slug already exists among the frozen ones fails (the importer would take over that post).
- `--docs`: the repo root; enables the per-file checks (file exists, one `# Title` equal to `title`, no extra H1, no
  raw `<!-- wp:` outside fences).
- Relative `markdown_source` paths are warnings (local/spike manifests); production needs `github.com/…/blob/…` URLs.

The composite action in `../actions/validate-manifest/` runs the same script in CI. Generate the manifest from the
file tree in CI as well and fail if the committed one is stale (the Secure Custom Fields repo's `docs-manifest.yml`
is the model); the generator is handbook-specific until a second handbook needs the same one.
