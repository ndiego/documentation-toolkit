#!/usr/bin/env python3
"""Validate a handbook manifest.json for the wporg-markdown importer used on developer.wordpress.org.

Checks the invariants that have broken real imports (Advanced Administration 2023, Accessibility 2026) or
that the Theme Handbook research showed the importer cannot protect against on its own
(notes/theme-handbook-migration/research/02-pipeline-precedents.md section 5.6):

  - the manifest is a JSON object keyed by page path (not the Gutenberg list format)
  - keys are unique, normalised (no leading/trailing slash), and parents precede children
  - `parent` is null or an existing key (path form), except keys listed in --allow-missing-parent
  - a new entry's `slug` never equals another entry's slug at a different path (the importer's slug
    fallback would silently take over the existing post)
  - `order` is an integer; with --frozen, existing keys keep their frozen order (0 is never re-applied)
  - `markdown_source` is a github.com/<org>/<repo>/blob/<branch>/... URL (raw URLs break the edit link)
  - with --docs DIR: each source file exists, starts with exactly one `# Title` equal to `title`,
    contains no other H1, and has no unescaped `<!-- wp:` outside fenced code (it would disable wpautop)
  - with --frozen FILE: no key from the frozen list is missing or renamed (removals need a redirect PR)

Exit code 1 on any error. Warnings do not fail the run unless --strict.

Usage: python3 -I validate_manifest.py manifest.json [--docs DIR] [--frozen frozen-paths.json]
                [--allow-missing-parent KEY ...] [--strict]
"""
import argparse
import json
import pathlib
import re
import sys
import urllib.parse

GITHUB_BLOB = re.compile(r"^https://github\.com/[^/]+/[^/]+/blob/[^/]+/.+\.md$")


def norm(key: str) -> str:
    return key.strip("/")


def read_markdown_checks(path: pathlib.Path, title: str, key: str, errors, warnings):
    text = path.read_text(encoding="utf-8")
    body = re.sub(r"^---\n.*?\n---\n", "", text, count=1, flags=re.S)  # importer strips frontmatter
    lines = body.lstrip("\n").split("\n")
    if not lines or not re.match(r"^# \S", lines[0]):
        errors.append(f"{key}: {path.name} must start with a single '# Title' line")
    else:
        h1 = lines[0][2:].strip()
        if title and h1 != title:
            errors.append(f"{key}: H1 {h1!r} differs from manifest title {title!r}")
    in_fence = False
    for n, line in enumerate(body.split("\n"), 1):
        if re.match(r"^\s*(```|~~~)", line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if line.startswith("# ") and n > 1 and line.strip() != lines[0].strip():
            errors.append(f"{key}: extra H1 at line {n}")
        if "<!-- wp:" in line:
            errors.append(f"{key}: unescaped block markup '<!-- wp:' outside a code fence at line {n}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest")
    ap.add_argument("--docs", help="root directory the markdown_source paths resolve under (repo checkout)")
    ap.add_argument("--frozen", help="JSON list of keys that must all still exist")
    ap.add_argument("--allow-missing-parent", nargs="*", default=[], help="keys whose parent is intentionally absent")
    ap.add_argument("--strict", action="store_true", help="treat warnings as errors")
    args = ap.parse_args()

    errors, warnings = [], []
    try:
        data = json.loads(pathlib.Path(args.manifest).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"error: cannot read manifest: {exc}")
        return 1
    if not isinstance(data, dict):
        print("error: manifest must be a JSON object keyed by page path (list manifests cannot express duplicate slugs)")
        return 1

    keys = list(data.keys())
    seen_norm = {}
    for k in keys:
        nk = norm(k)
        if nk != k:
            errors.append(f"{k!r}: key must not have leading or trailing slashes")
        if nk in seen_norm:
            errors.append(f"{k!r}: duplicate of {seen_norm[nk]!r}")
        seen_norm[nk] = k

    slug_at = {}
    seen_so_far = set()
    for k in keys:
        e = data[k]
        if not isinstance(e, dict):
            errors.append(f"{k}: entry must be an object")
            continue
        slug = e.get("slug") or k.rsplit("/", 1)[-1]
        if not re.match(r"^[a-z0-9-]+$", slug):
            errors.append(f"{k}: slug {slug!r} is not a sanitized slug")
        if k != "index" and k.rsplit("/", 1)[-1] != slug:
            errors.append(f"{k}: slug {slug!r} does not match the last path segment")
        if slug in slug_at and slug_at[slug] != k:
            # Duplicate slugs are fine for *existing* adopted pages (matched by path first), but the
            # importer's slug fallback makes a *new* page with a reused slug take over the other post.
            warnings.append(f"{k}: slug {slug!r} is also used by {slug_at[slug]!r} (safe only if both pages already exist on the site)")
        slug_at.setdefault(slug, k)

        parent = e.get("parent")
        if parent is not None:
            if parent not in data:
                if k in args.allow_missing_parent:
                    warnings.append(f"{k}: parent {parent!r} is not in the manifest (allowed)")
                else:
                    errors.append(f"{k}: parent {parent!r} is not a manifest key (use the parent's path, not its bare slug)")
            elif parent not in seen_so_far:
                errors.append(f"{k}: parent {parent!r} must appear before its children")
            if not k.startswith(parent + "/") and k != "index":
                errors.append(f"{k}: path is not under parent {parent!r}")
        elif "/" in k:
            warnings.append(f"{k}: nested path with no parent")

        order = e.get("order", 0)
        if not isinstance(order, int) or isinstance(order, bool):
            errors.append(f"{k}: order must be an integer")

        src = e.get("markdown_source", "")
        rel = None
        if GITHUB_BLOB.match(src):
            rel = urllib.parse.urlparse(src).path.split("/blob/", 1)[1].split("/", 1)[1]
        elif src and "://" not in src and src.endswith(".md"):
            # Relative path: fine for a local/spike manifest served from disk; production needs the blob URL.
            warnings.append(f"{k}: markdown_source is a relative path; production manifests need a github.com/<org>/<repo>/blob/<branch>/ URL")
            rel = src.lstrip("./")
        else:
            errors.append(f"{k}: markdown_source must be a github.com/<org>/<repo>/blob/<branch>/<path>.md URL, got {src!r}")
        if rel and args.docs:
            fp = pathlib.Path(args.docs) / rel
            if not fp.is_file():
                errors.append(f"{k}: source file {rel} not found under {args.docs}")
            else:
                read_markdown_checks(fp, e.get("title", ""), k, errors, warnings)
        seen_so_far.add(k)

    if args.frozen:
        frozen = json.loads(pathlib.Path(args.frozen).read_text(encoding="utf-8"))
        for fk in frozen if isinstance(frozen, list) else frozen.keys():
            if fk not in data:
                errors.append(f"{fk}: frozen page is missing from the manifest (removals and renames need a redirect PR)")
            elif isinstance(frozen, dict) and isinstance(frozen[fk], dict):
                fo = frozen[fk].get("order")
                if fo is not None and data[fk].get("order") != fo:
                    errors.append(f"{fk}: order changed from {fo} to {data[fk].get('order')} (the importer never re-applies 0)")
        new_keys = [k for k in keys if k not in (frozen if isinstance(frozen, list) else frozen.keys())]
        frozen_slugs = {data[k].get("slug") or k.rsplit("/", 1)[-1] for k in keys if k not in new_keys}
        for k in new_keys:
            s = data[k].get("slug") or k.rsplit("/", 1)[-1]
            if s in frozen_slugs:
                errors.append(f"{k}: new page reuses existing slug {s!r}; the importer would take over the existing post")

    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"error: {e}")
    print(f"{len(keys)} entries, {len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors or (args.strict and warnings) else 0


if __name__ == "__main__":
    sys.exit(main())
