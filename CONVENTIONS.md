# Markdown conventions for WordPress.org handbooks

Started 2026-10-07 for HelpHub; promoted to the toolkit 2026-10-12 as the cross-handbook version. Target: the
`wporg-markdown` importer used for the Block Editor, Playground, Secure Custom Fields, Coding Standards and Advanced
Administration handbooks (source in `notes/reference/wporg-markdown/`; behaviour verified against a local import of
the Theme Handbook, `notes/theme-handbook-migration/research/`). Everything below is an importer or GitHub constraint,
not a style preference. Voice, grammar and terminology are the Docs team's style guide on make.wordpress.org/docs.

## Added from the Theme Handbook work (2026-10-12)

- **Manifest keyed by page path**, parents as path keys and listed before children. Bare slugs are ambiguous
  (the Theme Handbook reuses 7 slugs on 14 pages) and resolve only at the top level.
- **A new page never reuses an existing slug.** The importer's slug fallback takes over the existing post and moves
  it. `toolkit/manifest/validate_manifest.py` enforces this.
- **Explicit heading ids are carried as `{#id}`.** Deep links depend on them; the TOC block generates the rest with
  `sanitize_title` and `-2`, `-3` suffixes.
- **Notices are GitHub alerts** (`[!NOTE]` info, `[!TIP]` tip, `[!WARNING]` warning, `[!CAUTION]` alert); the
  importer subclass rewrites them to notice markup. Raw `.callout-*` divs (the Block Editor's current style) are not
  styled on GitHub and do not parse Markdown inside.
- **Shortcodes in prose stay escaped** (`[[audio]]`), and block-markup comments only ever appear inside code fences.
- **Images live in the repo as compressed WebP** (animated WebP for animations) under `assets/`, referenced by relative
  path, with alt text carried verbatim. The importer subclass sideloads them into the site's media library at import
  (as the Playground importer does), so the site never serves from GitHub. Keeping absolute
  `developer.wordpress.org/files/` URLs (the Block Editor's current practice) also imports fine but leaves image
  updates outside the pull request flow. **Video and other large media are never stored in Git**; host them on
  WordPress.org or YouTube and embed by URL.

## What the importer actually does

| Step | Behaviour | Consequence for us |
|------|-----------|--------------------|
| Fetch | Reads `manifest.json` from raw.githubusercontent on a cron, with ETag dedupe | Merged PRs go live without a deploy |
| Frontmatter | Stripped with `^---(.+)---` (ungreedy) | Frontmatter is allowed but ignored |
| Title | First `# H1` line becomes `post_title`; otherwise manifest `title` | Every file starts with `# Title` |
| Convert | Jetpack `WPCom_GHF_Markdown_Parser` (GitHub-flavored) | Fenced code, tables, raw HTML pass through. Markdown inside HTML blocks is **not** parsed |
| Sanitize | `wp_filter_post_kses` | `<iframe>` stripped unless the handbook subclass allows it. `<video>`, `<img>`, `<div class>` are allowed |
| Excerpt | First line of text | First paragraph should be a real summary sentence |
| Hierarchy | `parent` + `order` from manifest set `post_parent` / `menu_order` | Hierarchical post type. HelpHub uses categories, so a HelpHub subclass must map parents to terms |
| Links | Handbook subclass rewrites relative `.md` links to permalinks in `wporg_markdown_before_transform` | We can use relative links in Markdown |

Gutenberg's own conventions (observed in `docs/`): `/docs/path/file.md#anchor` links, `README.md` as folder
index, images as absolute `developer.wordpress.org/files/...` URLs, callouts as raw HTML
`<div class="callout callout-info|callout-tip|callout-warning|callout-alert">` with `<p>` inside,
YouTube as raw `<iframe>` (allowed by their subclass), `{% codetabs %}` for tabbed code.

## Our conventions

- **File layout**: `docs/<top-category>/<sub-category>/<slug>.md`, `README.md` per folder as index.
- **Title**: `# Title` first line. No other H1 in body.
- **Frontmatter**: minimal, flat: `title`, `slug`, `original_url`, `wp_id`, `categories`, `date`, `modified`,
  `migration` (converter warnings, to be deleted once reviewed).
- **Headings**: h2/h3 drive the TOC. Anchor ids follow WordPress `sanitize_title` of the heading text,
  with `-2`, `-3` suffixes for duplicates, because existing `#anchor` links depend on that.
- **Callouts**: GitHub-style alerts `> [!NOTE]` / `[!TIP]` / `[!WARNING]` / `[!CAUTION]` (decided
  2026-10-07, to render well on GitHub). The HelpHub importer subclass needs a small
  `wporg_markdown_before_transform` filter to turn these into notice markup. Converter can still emit the
  Gutenberg HTML style with `--callout-style gutenberg`.
- **Links**: relative Markdown links between files. Links off-site stay absolute.
- **Images**: relative paths into `docs/assets/images/YYYY/MM/<file>`, mirroring the original
  `/documentation/files/` path so unchanged images can be mapped back to their existing attachment URL on
  import. Alt text preserved. Caption as italic line under the image.
- **Video**: VideoPress / YouTube as a bare URL on its own line (auto-embed). Self-hosted `<video>` kept as
  HTML with a local `src`.
- **Tables**: GFM tables; complex tables (rowspan etc.) stay as HTML.
- **Code**: fenced, with language hint.
- **Manifest**: `docs/manifest.json` in importer format, generated from the folder tree by a script, never
  hand-edited.

## Decisions so far (2026-10-07)

- Publish via GitHub + wporg-markdown importer, like the Block Editor handbook.
- Optimise for rendering on GitHub: plain Markdown, GFM alerts, relative links, relative images.
- Keep URLs flat (`/article/<slug>/`) and map folders to categories in a HelpHub importer subclass.
- Astro Starlight is a disposable preview renderer in `site/`; nothing framework-specific goes into `docs/`.
- Changelog sections stay in the body for now; likely dropped in favour of git history later.
- "Was this article helpful?" is out of scope here; it will be a WordPress.org theme feature (or an
  "Edit on GitHub" link).
- Media: in-repo copies under docs/assets for now; long-term home still open.

## Open design questions for merge-back

1. URL scheme. HelpHub articles live at `/documentation/article/<slug>/` (flat) with categories. The
   importer wants a hierarchy. Options: (a) HelpHub importer subclass that ignores `parent` for the post
   and assigns categories instead, keeping URLs unchanged (no redirects needed); (b) switch to
   hierarchical URLs and add 321 redirects.
2. Blocks vs classic HTML. The importer saves classic HTML; HelpHub content today is block HTML. The
   HelpHub theme may style `.wp-block-*` classes. Either accept classic HTML output, or use the
   `WordPress/php-toolkit` Markdown-to-blocks component in the subclass.
3. Image hosting. Keep images in the repo (reviewable in PRs, importer sideloads like Playground does) or
   keep pointing at the WordPress.org media library (zero work, but screenshots can't be updated via PR).
4. Changelog sections. Hand-written in 213 articles today. Keep in body, or move to git history?
5. "Was this article helpful?" has no static/GitHub equivalent. Replace with "Edit on GitHub" / issue link?
