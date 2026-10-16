# Demo site (`@wporg-docs/demo-site`)

The WordPress Playground environment the documentation screenshots are taken in: a blueprint, a small mu-plugin
that keeps wp-admin clean and deterministic, the Ipsum theme (the proposed WordPress 7.2 default, vendored), and a
demo content pack with a per-block showcase. The engine knows nothing about what is in here beyond what this file
promises (see "Environment contract" in the engine's `ARCHITECTURE.md`). A project points at it with
`blueprint: '<path to>/packages/demo-site/blueprint.json'` in `shots.config.js`; the example project in
`examples/block-editor-handbook/` does exactly that.

```
demo-site/
  blueprint.json                    default suite (Blueprint v1)
  mu-plugins/wp-screenshots-demo.php  installed to wp-content/mu-plugins/
  themes/ipsum.zip                  the Ipsum theme at a pinned commit (themes/IPSUM.md; scripts/vendor-ipsum.sh)
  content/
    seed.php                        idempotent PHP that creates all demo content
    media/                          bundled images (photos are CC0)
    LICENSES.md                     one row per media file
    content.json                    machine-readable index of the pack
  verify.mjs                        smoke test: screenshots + diagnostics into .verify/ (git-ignored)
```

The site identity ("Saltmarsh", a slow-travel field journal) and the photos are placeholders until an official demo
site replaces them. The slugs below are the contract and must survive that replacement.

## What the engine can rely on

- **Login**: user `admin`, password `password`. The blueprint's `login` step makes Playground log in any client on
  its first request (a cookieless request gets a 302 that sets the auth cookie), so a fresh browser context arrives
  in wp-admin authenticated. `author-1` and `author-2` also have password `password`.
- **Versions**: WordPress 7.1.3, PHP 8.3, theme `ipsum` (unzipped from `themes/ipsum.zip` and activated by the blueprint). `GET /wp-json/`
  includes `wp_screenshots: { wordpress, php, theme, content }` (added by the mu-plugin), so the runner can assert what
  booted without authenticating.
- **Readiness**: the server answers HTTP about 4 s into the boot, *while the blueprint is still running*. The site is
  only ready when the CLI prints `Ready! WordPress is running on ...`, or equivalently when `GET /wp-json/` has a
  non-null `wp_screenshots.content` (written by the last step of the seed). Measured on an M-series Mac with the
  WordPress zip cached: first response 4.1-4.7 s, ready 7.9-8.8 s.
- **Document root** inside Playground is `/wordpress/` (so `wp-content` is `/wordpress/wp-content/`).
- **Editor preferences** for user 1: no welcome guides, no "Choose a pattern" modal, fullscreen mode on.
- **Content keys** are slugs (below). IDs are not part of the contract.

## Slug contract

Shot specs reference these through `{{media.<slug>}}`, `{{post.<slug>}}`, `{{page.<slug>}}`. A replacement content
pack must keep every slug in this table (it may add more). Everything else (titles, text, photos, names) is free.

### Media (attachments, `post_name`)

| Slug | What it must be | Placeholder now |
|---|---|---|
| `hero` | Landscape photo, at least 1600 px wide; featured image of `post-long` | Lake and mountains, 2000x1125 |
| `landscape-1` | Landscape photo; used in `post-long` image block and gallery | Sea cliffs, 2000x1500 |
| `landscape-2` | Landscape photo; `post-long` cover block, gallery, featured image of `post-short` | Island at sunset, 2000x1500 |
| `landscape-3` | Landscape photo; `post-long` gallery | Tea garden, 2000x1476 |
| `portrait-1` | Portrait photo; used on `about` | Lily pond, 1500x2000 |
| `square-1` | Square photo | Leaves after rain, 2000x2000 |
| `site-logo` | Logo PNG, set as the `site_logo` option | Wordmark, 786x250 |
| `site-icon` | 512x512 PNG, set as the `site_icon` option | Arch mark |
| `avatar-default` | 256x256 PNG used for every avatar (no Gravatar) | Grey silhouette |

Every attachment has alt text (`_wp_attachment_image_alt`); photos also have a caption.

### Posts

| Slug | Must be |
|---|---|
| `post-long` | Published; by `author-1`; featured image `hero`; contains paragraph, heading, image (`landscape-1`), list, quote, gallery (`landscape-1..3`), buttons, separator, cover (`landscape-2`), columns and table blocks; comments: 3 approved (one a reply), 1 pending, 1 spam |
| `post-short` | Published; featured image `landscape-2` |
| `post-draft` | Draft |

Six more published posts (2023-2025, featured images cycling through the landscapes, three different authors) give
Query Loop, Latest Posts and Archives some volume. Their slugs are listed in `content/content.json` but are not
part of the contract.

### Block showcase (posts)

One post per block, holding a representative instance of it, so the `block-canvas`, `block-toolbar` and
`block-settings` presets can open a finished example instead of building one. Slug: `block-<name without core/>`.

| Slug | Block | Content |
|---|---|---|
| `block-image` | `core/image` | A paragraph, the `hero` photo with a caption, a paragraph; featured image `hero`; dated 2023 so it never leads the home page |
| `block-gallery` | `core/gallery` | A paragraph, a gallery of `landscape-1..3`, a paragraph; featured image `landscape-1` |
| `block-table` | `core/table` | A paragraph, a three-column table with a header row, a paragraph; featured image `landscape-3` |

Adding a block to the showcase means one more `wp_screenshots_upsert( 'block-<name>', … )` in `seed.php` with the
block's markup exactly as its `save()` emits it, plus a row here and in `content.json`.

### Pages

| Slug | Must be |
|---|---|
| `sample-page` | Published |
| `about` | Published; text plus an image |
| `contact` | Published |
| `home` | Published; NOT assigned as the front page |
| `blog` | Published; NOT assigned as the posts page |

The front page shows the latest posts (`show_on_front = posts`). To switch a suite (or an `isolated: true` shot) to a
static front page, set `show_on_front` to `page`, `page_on_front` to the ID of `home` and `page_for_posts` to the ID
of `blog`, for example with an extra `runPHP` step:

```php
<?php require '/wordpress/wp-load.php';
update_option( 'show_on_front', 'page' );
update_option( 'page_on_front', get_page_by_path( 'home' )->ID );
update_option( 'page_for_posts', get_page_by_path( 'blog' )->ID );
```

### Users

| Login (and slug) | Role | Display name now |
|---|---|---|
| `admin` | administrator | admin |
| `author-1` | author | Maya Lindqvist |
| `author-2` | editor | Theo Marchetti |

Also seeded: categories `guides`, `news`, `travel`; tags `hiking`, `coast`, `photography`, `planning`, `gear`; a
`wp_navigation` menu `main` ("Main": Home, About, Topics submenu with the three categories, Contact). The install's
"Hello world!" post and its comment are removed.

All dates are fixed and in 2025 or earlier, and `post_modified` equals `post_date`. Not "this year" on purpose:
wp-admin prints dates in the current year without the year, judged by the server clock, which is not frozen.

## Replacing or extending the content pack

The site name "Saltmarsh" and everything in `content/` are placeholders for a designer to replace.

To add a media item:

1. Drop the file in `content/media/` (JPEG or PNG; at most about 600 KB and 2000 px on the long edge; strip
   metadata). SVG is not accepted by WordPress uploads.
2. Add a `writeFile` step for it to `blueprint.json` (copy an existing media step; the target directory is
   `/tmp/wp-screenshots-content/media/`).
3. Add a line to `$wp_screenshots_media_spec` in `content/seed.php`: slug, file name, title, alt text, caption.
4. Add a row to `content/LICENSES.md` and an entry to `content/content.json`.

Posts, pages, users, terms and comments are created with the helpers at the top of `seed.php`
(`wp_screenshots_upsert()`, `wp_screenshots_user()`, `wp_screenshots_term()`, `wp_screenshots_comment()`). They look items up by slug, so
`seed.php` can be run twice without creating duplicates. Block markup must match what each block's `save()` emits,
or the editor shows "This block contains unexpected or invalid content"; `verify.mjs` checks `post-long` for invalid
blocks.

## Testing the blueprint on its own

From the repository root:

```bash
./node_modules/.bin/wp-playground-cli server --blueprint=packages/demo-site/blueprint.json \
    --blueprint-may-read-adjacent-files --port=9411
# wait for "Ready! WordPress is running on http://127.0.0.1:9411", then in another shell:
curl -sL -c /tmp/c.txt -b /tmp/c.txt http://127.0.0.1:9411/wp-json/ | head -c 300
curl -sL -b /tmp/c.txt 'http://127.0.0.1:9411/wp-json/wp/v2/media?slug=hero&_fields=id,slug,alt_text'
curl -sL -b /tmp/c.txt 'http://127.0.0.1:9411/wp-json/wp/v2/posts?slug=post-long&_fields=id,featured_media'
curl -sL -b /tmp/c.txt 'http://127.0.0.1:9411/wp-json/wp/v2/users?_fields=slug,name'
curl -sL -b /tmp/c.txt 'http://127.0.0.1:9411/wp-json/wp/v2/pages?slug=about&_fields=id,slug'
node packages/demo-site/verify.mjs http://127.0.0.1:9411   # PNGs in .verify/, exit 1 on any failed check
```

The cookie jar matters: without it every request is the auto-login 302. Plain REST calls are unauthenticated (no
nonce), so drafts and the pending/spam comments are not visible through them.

## Suites

A shot that needs a different site names a suite, and the runner boots `<suitesDir>/<name>/blueprint.json` from the
project instead. A suite follows the same contract as this file (login step, pinned versions, the mu-plugin, and the
content slugs it promises in its own README). This package ships only the default suite.

## The mu-plugin (`mu-plugins/wp-screenshots-demo.php`)

Its header comment explains every hook. In short:

- Removes all callbacks from `admin_notices`, `all_admin_notices`, `network_admin_notices` and `user_admin_notices`
  (including the SQLite integration notice), and the Dashboard Welcome panel. Messages a screen prints itself, such
  as "Settings saved.", still appear.
- Short-circuits the `update_core`, `update_plugins` and `update_themes` transients to "no updates" with a fixed
  `last_checked` (January 1, 2026), and removes every update-check hook. Dashboard > Updates says everything is up to
  date and no count bubbles appear. Auto-updates are not disabled by filter, because those filters change what
  Updates, Plugins and Themes display; they cannot run anyway.
- Blocks all outbound HTTP (`pre_http_request`), except canned fixture responses for the Dashboard's Events API and
  News/Planet feeds so that widget looks normal. Removes the emoji loader (it fetches from s.w.org). Define
  `WP_SCREENSHOTS_ALLOW_HTTP` as true to opt out.
- Serves every avatar from the `avatar-default` attachment (inline SVG fallback); no Gravatar requests.
- Zeroes CSS animation and transition durations in wp-admin, the front end, the block editor and the editor canvas
  iframe. It does not hide the caret, the cursor or the admin bar; the engine decides those at capture time.
- Adds `wp_screenshots` (versions, theme, seeded content IDs) to `GET /wp-json/`.

`define( 'WP_SCREENSHOTS_DEMO', false )` before mu-plugins load (for example through the blueprint `constants` key)
disables it for a suite.

## Playground gotchas

- **Pin versions in `preferredVersions`.** The blueprint value overrides `--wp`/`--php`, and in CLI 3.1.57 a
  blueprint without `preferredVersions` booted 7.1.3 whatever `--wp` said. An omitted PHP version picks the newest.
  The CLI banner prints "WordPress latest" even when the blueprint pins 7.1.3; trust `wp_screenshots.wordpress` instead.
- **`--blueprint-may-read-adjacent-files` is required** for `{ "resource": "bundled" }` files (the mu-plugin, the
  seed and the media). Bundled paths are relative to the blueprint file.
- **No `wp-cli` step**: it downloads `wp-cli.phar` from playground.wordpress.net at run time. Use `runPHP` with
  `require '/wordpress/wp-load.php';` instead.
- **No `importWxr` with remote attachments**: it fetches media over the network. The seed sideloads bundled files.
- **`features.networking: false`** is set so nothing depends on the network at run time; the mu-plugin blocks
  outbound HTTP independently, so behaviour is the same if Playground ignores the flag.
- **`server` mode is ephemeral.** Each boot builds a fresh site from the blueprint; nothing persists between boots.
  The only thing written outside the project is the WordPress zip cache in `~/.wordpress-playground/`.
- **The server answers before the blueprint has finished** (see Readiness above). Wait for `Ready!` or
  `wp_screenshots.content`.
- **URLs**: `siteurl`/`home` are `http://127.0.0.1:<port>`. Seeded block markup uses root-relative URLs
  (`/wp-content/uploads/2025/01/hero.jpg`), so content survives a port change, but attachment `source_url` and
  permalinks from REST are absolute for the port the site booted on.
