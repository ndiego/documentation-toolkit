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

# Claude Desktop: merge our entry into the config, keep everything else, back the file up first.
case "$(uname -s)" in
	Darwin) DEFAULT_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
	*)      DEFAULT_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/Claude/claude_desktop_config.json" ;;
esac
CONFIG="${CLAUDE_DESKTOP_CONFIG:-$DEFAULT_CONFIG}"
mkdir -p "$(dirname "$CONFIG")"
[ -f "$CONFIG" ] && cp "$CONFIG" "$CONFIG.bak-$(date +%Y%m%d%H%M%S)"
CONFIG="$CONFIG" NODE_BIN="$NODE_BIN" SERVER="$SERVER" node - <<'JS'
const fs = require( 'node:fs' );
const file = process.env.CONFIG;
let data = {};
if ( fs.existsSync( file ) ) {
	try {
		data = JSON.parse( fs.readFileSync( file, 'utf8' ) ) || {};
	} catch ( e ) {
		console.error( `install.sh: ${ file } is not valid JSON; fix it and re-run.` );
		process.exit( 1 );
	}
}
data.mcpServers = data.mcpServers || {};
data.mcpServers[ 'wp-docs-toolkit' ] = { command: process.env.NODE_BIN, args: [ process.env.SERVER ] };
fs.writeFileSync( file, JSON.stringify( data, null, 2 ) + '\n' );
JS
say "Registered in Claude Desktop: $CONFIG"

# Claude Code, when present: user scope so it is available in every project.
CLAUDE_CODE_LINE="Not found on this machine. Later: claude mcp add --scope user wp-docs-toolkit -- $NODE_BIN $SERVER"
if [ -z "${WP_DOCS_TOOLKIT_NO_CLAUDE_CODE:-}" ] && command -v claude >/dev/null 2>&1; then
	claude mcp remove wp-docs-toolkit --scope user >/dev/null 2>&1 || true
	if claude mcp add --scope user wp-docs-toolkit -- "$NODE_BIN" "$SERVER" >/dev/null 2>&1; then
		say "Registered in Claude Code (user scope)"
		CLAUDE_CODE_LINE="Already registered. Ask the same thing in any project."
	fi
fi

cat <<EOT

Done. Next:

  Claude Desktop  Quit and reopen it. In a new chat the tools menu lists "wp-docs-toolkit". Try:
                  "Take a screenshot of the General Settings page in wp-admin."
                  The first screenshot takes ~15 s (WordPress boots); later ones a few seconds.

  Claude Code     $CLAUDE_CODE_LINE

  ChatGPT         ChatGPT only connects to remote HTTPS servers. Run the server with a token and expose it:
                    cd $HOME_DIR && npx wp-docs-mcp --http --token "\$(openssl rand -hex 16)"
                    cloudflared tunnel --url http://127.0.0.1:3920      # prints an https://....trycloudflare.com URL
                  then in ChatGPT: Settings → Apps & Connectors → Advanced → Developer mode, create a connector with
                  https://<that host>/mcp/<your token> and "No authentication". Stop both when done.

  Update later    re-run this script. Uninstall: delete $HOME_DIR and the "wp-docs-toolkit" entry in the config.
EOT
