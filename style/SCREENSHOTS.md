# Screenshot guidelines

How documentation screenshots of WordPress are framed, annotated and written about, so that every image across
every handbook reads as one system. The `@wporg-docs/screenshots` engine enforces the mechanical parts (ratios,
stage, annotation style); the rest is judgment this page records. Example images come from
`examples/block-editor-handbook/`, rendered by the engine from the specs there.

Target surface: the Block Editor Handbook on developer.wordpress.org, whose content column is 960 CSS px wide.
Images render at 2x, so a full-width image is 1920 px across and anything narrower is shown at its natural size.

## Subjects and presets

Ask for a subject, not a procedure. Each preset encodes the scene, the representative content, the capture target
and the frame the house style has settled on, so a spec (or a person prompting an agent) states what the image is
of and the engine supplies the rest.

| Preset | Shows | Frame |
|---|---|---|
| `block-canvas` | A block as it appears on the editor canvas, selected, with its toolbar | auto (nearest ratio) |
| `block-toolbar` | The toolbar of a selected block | banner 3:1 |
| `block-settings` | The block inspector on a tab, optionally with a panel expanded | portrait 3:4 |
| `site-editor` | The site editor on its home view or a named view | wide 16:9 |
| `post-editor` | The whole post editor with a post open | wide 16:9 |
| `admin-screen` | A wp-admin screen | wide 16:9 |
| `front-end` | The public site | wide 16:9 |

Block presets open a **showcase post** from the demo site, `block-<name>`, that already holds a good instance of the
block, so the image shows the block with real content rather than an empty placeholder. `wp-screenshots presets`
lists every preset with its parameters.

```yaml
- id: canvas
  preset: block-canvas
  block: core/image
  alt: An Image block on the editor canvas, selected, showing a photo of a lake at sunrise with a caption below it.
```

![An Image block on the editor canvas, selected, showing a photo of a lake at sunrise with a caption below it.](../examples/block-editor-handbook/docs/assets/screenshots/image-block/canvas.webp)

When no preset fits, write the shot with the full vocabulary (scenes, steps, targets). A preset is a default, not
a constraint; any key set on the shot overrides what the preset filled in.

## Frames

Every framed image sits on a stage with one of four canonical aspect ratios. The content is never scaled; the stage
grows around it until the ratio is reached, with at least 40 CSS px of margin, and the content sits centred.

| Frame | Ratio | Use for |
|---|---|---|
| `wide` | 16:9 | Full editor, site editor, admin screens, the front end |
| `standard` | 4:3 | Modals, popovers, dialogs, blocks on the canvas |
| `portrait` | 3:4 | The inspector and other sidebars, tall panels |
| `banner` | 3:1 | Toolbars and single controls |

`auto` picks the ratio nearest to the content's own shape, which is what the block presets use because blocks come
in every proportion. `none` skips the stage for images that are embedded edge to edge. The manifest records the
frame used for every image.

The stage is a soft blue-grey gradient with a slight shadow and rounded corners on the capture. It exists to give
small crops a consistent footprint on the page and to separate the screenshot from the page around it. It is
defined by style tokens (`stage` in `style.js`) and a project can override it, but the ratios should stay.

![The Image block's Settings tab in the block inspector, with the Resolution setting outlined.](../examples/block-editor-handbook/docs/assets/screenshots/image-block/settings.webp)

![The site editor with the Ipsum theme, showing the home template on the canvas and the navigation sidebar.](../examples/block-editor-handbook/docs/assets/screenshots/site-editor/home.webp)

## Annotations

Four annotation types, all anchored to UI elements rather than pixel positions, so they follow the interface when
it moves between releases:

- **Outline** is the default. Use it to point at a control, a panel or a block.
- **Arrow** only when the target is small or has lookalikes nearby, so an outline would be ambiguous.
- **Badge** (numbered) when the prose enumerates steps or several controls in one image.
- **Dim** when the surrounding interface is noisy and the subject needs isolating.

Arrows are short (40 CSS px) and come from the direction with the most empty space. A toolbar sits directly
under the text above it, so an arrow from `top` crosses that text; point at toolbar buttons from `bottom` or from
the side instead. Outlines have no such problem, which is one more reason they are the default.

One annotation type per image. The accent is WordPress blue (`#3858e9`) with a 2 px white halo on both sides of
the stroke; the editor's own selection outline is the same blue, and the halo is what keeps an annotation legible on
top of it. Annotations never rely on colour alone: outlines carry stroke weight, badges carry numbers.

```yaml
capture:
  annotate:
    - arrow: { button: Replace, from: top }
```

![The Image block toolbar, with an arrow pointing at the Replace button.](../examples/block-editor-handbook/docs/assets/screenshots/image-block/toolbar.webp)

![A Gallery block on the editor canvas, selected, showing three landscape photos in a row.](../examples/block-editor-handbook/docs/assets/screenshots/gallery-block/canvas.webp)

A three-column gallery is wider than it is tall, so `auto` put it on the banner frame; the Image block above landed
on 4:3. The same preset, two shapes, each on the ratio that suits it.

## Text in images

Prefer as little text in an image as the subject allows. A screenshot of a toolbar has to show the toolbar's
labels; a screenshot of a block does not have to show three paragraphs around it. Keep explanations in the caption
and the alt text rather than in labels drawn on the image, and let crops stay tight so neighbouring UI does not add
words. This is a preference, not a rule: UI screenshots sometimes need the text, and that is fine. A writer or an
agent can ask for "no text" or "minimal text" on a shot, and the showcase content should offer variants that make
that possible as it grows.

## Alt text and captions

- Alt text describes what the image shows and, when annotated, what is highlighted: "with the Resolution setting
  outlined", not "with a blue box".
- Alt text lives in the spec and is the source of truth; `wp-screenshots lint --fix` copies it into the Markdown.
- Captions explain; alt text describes. Do not repeat one in the other.

## Determinism and review

Local renders are previews. Only a render inside the pinned Playwright image (`--docker`, or the CI job) is
canonical, because font rasterisation differs between macOS and Linux. A changed image is a prompt to re-read the
article text, not only to accept the pixels: when the interface moved, the prose around the image may be wrong too.
