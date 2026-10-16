#!/usr/bin/env sh
# Install the wp-docs-toolkit MCP server for Claude Desktop and Claude Code on macOS or Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/ndiego/wp-docs-toolkit/trunk/scripts/install.sh | sh
#
# What it does: clones (or updates) the toolkit into ~/.wp-docs-toolkit, installs its dependencies and Chromium,
# registers the server in Claude Desktop's config (keeping whatever else is there, with a backup) and in Claude
# Code's user scope when the `claude` CLI is present, then prints how to use it, including the ChatGPT route.
#
# Overrides: WP_DOCS_TOOLKIT_HOME (install dir), WP_DOCS_TOOLKIT_REF (branch or tag), CLAUDE_DESKTOP_CONFIG (file),
# WP_DOCS_TOOLKIT_NO_CLAUDE_CODE=1 (skip the Claude Code registration).
set -eu

REPO="https://github.com/ndiego/wp-docs-toolkit.git"
REF="${WP_DOCS_TOOLKIT_REF:-trunk}"
HOME_DIR="${WP_DOCS_TOOLKIT_HOME:-$HOME/.wp-docs-toolkit}"

say() { printf '%s\n' "$*"; }
fail() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "git is required."
command -v node >/dev/null 2>&1 || fail "Node.js 22.19 or newer is required (https://nodejs.org)."
NODE_BIN="$(command -v node)"
NODE_VERSION="$(node -p 'process.versions.node')"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=19)?0:1)' \
	|| fail "Node.js $NODE_VERSION found; 22.19 or newer is required."

say "Installing wp-docs-toolkit ($REF) into $HOME_DIR"
if [ -d "$HOME_DIR/.git" ]; then
	git -C "$HOME_DIR" fetch -q --tags origin
	git -C "$HOME_DIR" checkout -q "$REF"
	# A branch moves; a tag does not. Pull only when on a branch.
	if git -C "$HOME_DIR" show-ref -q --verify "refs/remotes/origin/$REF"; then
		git -C "$HOME_DIR" pull -q --ff-only origin "$REF"
	fi
else
	git clone -q "$REPO" "$HOME_DIR"
	git -C "$HOME_DIR" checkout -q "$REF"
fi

say "Installing dependencies (a minute)"
( cd "$HOME_DIR" && npm ci --no-audit --no-fund --loglevel=error )
say "Installing Chromium for Playwright (about 150 MB, once)"
( cd "$HOME_DIR" && npx playwright install chromium >/dev/null )
# Linux needs the browser's system libraries; Playwright knows which.
if [ "$(uname -s)" = "Linux" ] && ! node -e "import('@playwright/test').then(({chromium})=>chromium.launch().then(b=>b.close()))" >/dev/null 2>&1; then
	say "Chromium needs system libraries; trying: npx playwright install-deps chromium (may ask for sudo)"
	( cd "$HOME_DIR" && npx playwright install-deps chromium ) || say "Could not install system libraries automatically; run 'npx playwright install-deps chromium' in $HOME_DIR."
fi

SERVER="$HOME_DIR/packages/mcp/src/cli.js"
# Registration (Claude Desktop config merge with backup, Claude Code user scope) lives in the package itself.
INSTALL_ARGS="--via path"
[ -n "${CLAUDE_DESKTOP_CONFIG:-}" ] && INSTALL_ARGS="$INSTALL_ARGS --config $CLAUDE_DESKTOP_CONFIG"
[ -n "${WP_DOCS_TOOLKIT_NO_CLAUDE_CODE:-}" ] && INSTALL_ARGS="$INSTALL_ARGS --no-claude-code"
# shellcheck disable=SC2086
"$NODE_BIN" "$SERVER" install $INSTALL_ARGS
exit 0
