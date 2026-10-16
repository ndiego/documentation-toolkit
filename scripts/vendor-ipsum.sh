#!/usr/bin/env sh
# Vendor the Ipsum theme (the proposed WordPress 7.2 default theme) into the demo site at a pinned commit.
# Usage: scripts/vendor-ipsum.sh [<commit sha>]   (default: the sha recorded in packages/demo-site/themes/IPSUM.md)
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$ROOT/packages/demo-site/themes"
SHA="${1:-$(sed -n 's/^Commit: //p' "$DEST/IPSUM.md")}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "Fetching WordPress/ipsum@$SHA"
curl -sL "https://github.com/WordPress/ipsum/archive/$SHA.tar.gz" | tar xz -C "$TMP"
mv "$TMP"/ipsum-* "$TMP/ipsum"
# Development files are not part of a theme install.
( cd "$TMP/ipsum" && rm -rf .github .husky bin composer.json composer.lock package.json package-lock.json \
	lint-staged.config.mjs phpcs.xml.dist .stylelintrc.json .stylelintignore .npmrc .nvmrc .wp-env.json \
	.gitignore AGENTS.md CONTRIBUTING.md )
( cd "$TMP" && rm -f ipsum.zip && zip -qr -X ipsum.zip ipsum )
mv "$TMP/ipsum.zip" "$DEST/ipsum.zip"
VERSION=$(sed -n 's/^Version: //p' "$TMP/ipsum/style.css" | tr -d '\r')
cat > "$DEST/IPSUM.md" <<MD
# Ipsum theme

Vendored copy of [WordPress/ipsum](https://github.com/WordPress/ipsum), the proposed default theme for WordPress 7.2,
without its development files. GPL-2.0-or-later. Re-vendor with \`scripts/vendor-ipsum.sh <sha>\`.

Commit: $SHA
Theme version: $VERSION
Vendored: $(date -u +%Y-%m-%d)
MD
echo "Wrote $DEST/ipsum.zip and $DEST/IPSUM.md"
