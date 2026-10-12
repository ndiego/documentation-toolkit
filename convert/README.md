# convert

`wp_markdown.py` is the interface every handbook conversion goes through. The converter core (WordPress block-markup
pre-pass plus a markdownify subclass that GitHub and Jetpack's PHP Markdown Extra render identically) still lives in
`../../scripts/convert.py`, entangled with the HelpHub pipeline; this facade loads it and exposes only the generic
calls, so extracting the core later changes nothing for callers.

```python
import sys; sys.path.insert(0, "toolkit/convert")
import wp_markdown as wm
md, report = wm.html_to_markdown(html, slug="getting-started", base_url="https://developer.wordpress.org")
```

`report` carries warnings, info, counts (images, missing alt, links made absolute, …) and the heading ids assigned.
Callout styles: `gfm-alert` (default, the cross-handbook convention), `gutenberg` (raw callout divs, the Block
Editor's current style), `shortcode` (`[info]`… what DevHub renders natively; the Theme Handbook spike used it to
prove byte-identical notices).

A handbook layer adds its own link rewriting, image policy and heading-id handling by patching the core the way
`notes/theme-handbook-migration/spike/scripts/convert_theme.py` does. Those patches are handbook-specific and do not
belong here. Dependencies: `beautifulsoup4`, `markdownify`, `pyyaml` (the repo's `.venv`).
