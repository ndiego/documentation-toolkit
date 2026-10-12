---
name: handbook-cutover
description: Plan or execute the cutover of a wordpress.org handbook from wp-admin editing to a GitHub Markdown source imported by developer.wordpress.org, in the order that avoids duplicate posts, lost edits, and a diverged mirror. Use when a handbook repo is ready to go live, or when asked how a handbook migration should be sequenced.
---

# Handbook cutover (wp-admin → GitHub source)

Background and evidence: `notes/theme-handbook-migration/README.md` (plan) and its research reports. The failure to
avoid is `WordPress/developer-plugins-handbook`: a repo opened to contributors before the importer existed, with
wp-admin left writable, so both sides diverged and 34 merged PRs never reached the site.

## Preconditions

- The importer subclass is merged and deployed (it is inert until the manifest exists at the configured URL).
- The repo's CI validates the manifest (`validate-handbook-manifest`), and the repo has not accepted content PRs yet.
- A Meta committer is lined up to run the first import and apply the editing lock. Nobody else can.
- The manifest is keyed by the live permalink paths and the importer base matches the handbook's URL segment, so
  existing posts are adopted (expected first-run result: "created 0, updated N"). Drafts and private pages are
  inventoried: the importer only sees published posts.

## Order of operations (one day)

1. Announce the wp-admin freeze. From now on every wp-admin edit must be re-applied in Git.
2. Raw export and full backup of the post type's rows (rollback source).
3. Regenerate Markdown and manifest from that export; CI green; dry run on a sandbox or wp-env seeded with
   production rows, comparing IDs, paths, parents, orders, titles and rendered HTML.
4. Merge the content PR with `manifest.json` at the configured path.
5. Run immediately, in order: `wp cron event run devhub_<type>_import_manifest`, then
   `devhub_<type>_import_all_markdown`. Waiting for the 15-minute cron leaves a window with the GitHub template around
   old content.
6. Verify: post count unchanged, no new IDs, every URL 200 with the "Improve it on GitHub" link, landing page intact.
7. Apply the editing lock (capability filter, admins only); transfer issues; update the Feedback and role pages.
8. In wp-admin, forever: trash nothing, move nothing, re-slug nothing. The importer re-creates trashed pages under new
   IDs and duplicates re-slugged ones. Removing a page is a manual unpublish plus a redirect.

## Rollback

IDs and URLs never change, so rollback is content-only: revert the `functions.php` include and redeploy, delete the
`wporg_markdown_*` meta, restore `post_content` from the backup or the pre-import revision, unschedule the two events.
