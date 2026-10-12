#!/usr/bin/env python3
"""Toolkit facade over the WordPress-HTML-to-Markdown converter core.

The reusable core (BeautifulSoup pre-pass for WordPress block markup, callouts, figures, embeds,
tables, heading ids, plus a markdownify subclass tuned so GitHub and Jetpack's PHP Markdown Extra render
the same thing) currently lives in `scripts/convert.py` together with the HelpHub-specific pipeline that
grew around it. Consumers must import THIS module, not scripts/convert.py, so the core can be extracted
behind the same interface later without touching callers. The Theme Handbook spike
(notes/theme-handbook-migration/spike/scripts/convert_theme.py) is the reference for what a handbook-
specific layer adds on top.

Public API:
    html_to_markdown(html, *, slug="page", base_url=None, callout_style="gfm-alert") -> (markdown, report)
    sanitize_title(text) -> str          WordPress sanitize_title() port (heading anchor ids)
    unique_id(base, used) -> str          -2, -3 de-duplication the way the TOC block does it
    CALLOUT_STYLES                        ("gfm-alert", "gutenberg", "shortcode")

`callout_style`:
    gfm-alert  GitHub alerts (> [!NOTE] / [!TIP] / [!WARNING] / [!CAUTION]); the importer subclass maps them
               to notice markup. This is the cross-handbook convention (toolkit/CONVENTIONS.md).
    gutenberg  raw <div class="callout callout-*"> HTML, what the Block Editor handbook uses today.
    shortcode  [info]/[tip]/[warning]/[alert] handbook shortcodes, what DevHub renders natively.

Run directly for a quick conversion:  python3 -I wp_markdown.py page.html [--base https://developer.wordpress.org]
"""
import argparse
import collections
import html as _html
import importlib.util
import pathlib
import sys

CALLOUT_STYLES = ("gfm-alert", "gutenberg", "shortcode")
_CORE = None
_REPO = pathlib.Path(__file__).resolve().parents[2]


def _core():
    """Load scripts/convert.py once, without running its CLI."""
    global _CORE
    if _CORE is None:
        path = _REPO / "scripts" / "convert.py"
        spec = importlib.util.spec_from_file_location("wp_markdown_core", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _CORE = mod
    return _CORE


class _GenericSite:
    """Stand-in for the HelpHub `Site` object: no asset download, no category map, no media library."""

    def __init__(self):
        self.referenced_frags = set()
        self.videopress = {}
        self.manifest = collections.defaultdict(dict)
        self.media_urls = set()
        self.media_mime = {}
        self.media_by_base = {}
        self.asset_types = {}
        self.cat_by_slug = {}

    def asset(self, url, slug, kind=None, extra=None):
        return url, url, []

    def normalise_url(self, url):
        return url


def _make_ctx(core, slug):
    class Ctx(core.Ctx):
        def rel(self, path):
            return str(path)

    return Ctx(_GenericSite(), slug, pathlib.Path(f"{slug}.md"))


def _generic_rewrite_href(base_url):
    def rewrite_href(href, ctx):
        href = _html.unescape(href.strip())
        if base_url and href.startswith("/") and not href.startswith("//"):
            href = base_url.rstrip("/") + href
            ctx.counts["relative_url_made_absolute"] += 1
        return href

    return rewrite_href


def _generic_handle_images(base_url):
    def handle_images(soup, ctx):
        for img in list(soup.find_all("img")):
            src = img.get("src", "")
            if not src:
                img.decompose()
                continue
            if base_url and src.startswith("/") and not src.startswith("//"):
                src = base_url.rstrip("/") + src
            alt = img.get("alt", "")
            img.attrs = {"src": src, "alt": alt}
            ctx.counts["images"] += 1
            if not alt.strip():
                ctx.counts["images_missing_alt"] += 1

    return handle_images


def html_to_markdown(html, *, slug="page", base_url=None, callout_style="gfm-alert"):
    """Convert rendered WordPress HTML to Markdown. Returns (markdown, report).

    report = {"warnings": [...], "info": [...], "counts": {...}, "heading_ids": [...]}.
    Site-specific link rewriting and asset handling are NOT done here; a handbook layer patches the core
    the way the Theme Handbook spike does if it needs them.
    """
    if callout_style not in CALLOUT_STYLES:
        raise ValueError(f"callout_style must be one of {CALLOUT_STYLES}")
    core = _core()
    saved = {n: getattr(core, n) for n in ("CALLOUT_STYLE", "rewrite_href", "handle_images")}
    try:
        core.CALLOUT_STYLE = callout_style
        core.rewrite_href = _generic_rewrite_href(base_url)
        core.handle_images = _generic_handle_images(base_url)
        ctx = _make_ctx(core, slug)
        md = core.html_to_md(html, ctx)
    finally:
        for n, v in saved.items():
            setattr(core, n, v)
    report = {
        "warnings": list(ctx.warnings),
        "info": list(ctx.info),
        "counts": dict(ctx.counts),
        "heading_ids": sorted(ctx.heading_ids),
    }
    return md, report


def sanitize_title(text):
    return _core().sanitize_title(text)


def unique_id(base, used):
    return _core().unique_id(base, used)


def main():
    ap = argparse.ArgumentParser(description="Convert a rendered WordPress HTML fragment to Markdown.")
    ap.add_argument("html_file")
    ap.add_argument("--base", help="site origin used to absolutise relative links and images")
    ap.add_argument("--callout-style", choices=CALLOUT_STYLES, default="gfm-alert")
    ap.add_argument("--slug", default="page")
    args = ap.parse_args()
    md, report = html_to_markdown(pathlib.Path(args.html_file).read_text(encoding="utf-8"), slug=args.slug,
                                  base_url=args.base, callout_style=args.callout_style)
    sys.stdout.write(md)
    for w in report["warnings"]:
        print(f"warning: {w}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
