---
name: convert-handbook
description: Convert a WordPress.org handbook (or any WordPress-rendered HTML) to importer-ready Markdown with the toolkit converter, following the cross-handbook conventions. Use when asked to convert, export, or migrate handbook pages to Markdown, or to regenerate a handbook's Markdown from the site.
---

# Convert a handbook to Markdown

Read `toolkit/CONVENTIONS.md` first; every rule there is an importer constraint, not a style preference.

## Inputs

- Prefer a **raw** export (`post_content`, `post_title`, `post_name`, `post_parent`, `menu_order` via WP-CLI or WXR).
  The public REST API returns rendered HTML: texturized quotes, expanded shortcodes, rewritten image URLs. It is fine
  for a fidelity study, not for the final conversion.
- Keep the fetched data in its own directory, separate from scripts. Run Python with `-I`.

## Convert

- Use the facade, never `scripts/convert.py` directly:
  `from toolkit.convert import wp_markdown` → `html_to_markdown(html, slug=..., base_url="https://developer.wordpress.org")`.
  Quick check of one file: `.venv/bin/python -I toolkit/convert/wp_markdown.py page.html --base https://developer.wordpress.org`.
- Notices: `callout_style="gfm-alert"` (default). Mapping: info → `[!NOTE]`, tip → `[!TIP]`, warning → `[!WARNING]`,
  alert → `[!CAUTION]`. The importer subclass turns these into notice markup; see the Theme Handbook research for the
  tested filter.
- A handbook layer may patch link rewriting, images and headings on top of the core, the way
  `notes/theme-handbook-migration/spike/scripts/convert_theme.py` does. Keep such patches in the handbook's own
  script, not in the toolkit.
- Known traps (all seen on real handbooks): block-markup comments inside code samples must stay escaped; literal
  `[audio]`/`[video]`/`[gallery]`/`[caption]` in prose must be escaped as `[[…]]`; explicit heading ids become
  `{#id}`; `<pre>` nested in `<p>` or `<code>` must be repaired; one `# Title` first and no other H1.

## Verify

- Generate the manifest from the tree (never by hand) and run `toolkit/manifest/validate_manifest.py` on it.
- Compare rendered output against the live site page by page (headings, ids, images, code blocks, notices, links);
  the spike's `compare.py` is the reference. Screenshot a handful of diverse pages side by side.
- Report counts and every difference, classified: converter bug, importer transform needed, content needing a manual
  touch, cosmetic. Do not "fix" content as part of a one-to-one migration.
