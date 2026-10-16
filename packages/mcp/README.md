# @wp-docs-toolkit/mcp

An [MCP](https://modelcontextprotocol.io) server that lets any MCP client, such as Claude Desktop, Claude Code,
ChatGPT or Cursor, take reproducible WordPress documentation screenshots and validate handbook manifests by
asking in words.

| Tool | What it does |
|---|---|
| `list_presets` | The subjects a screenshot can be taken of, with their parameters. |
| `screenshot` | Render one subject from a preset (a block on the canvas, its toolbar or settings, the site editor, a wp-admin screen, the front end) against the bundled demo site (WordPress 7.1, the Ipsum theme, demo content). Returns the image inline and writes the WebP when given `out`. The first call boots WordPress and Chromium (10-20 s); later calls reuse them (a few seconds). |
| `restart_environment` | Stop the warm WordPress session so the next screenshot boots a fresh site. |

Screenshot calls are serialized on the one warm session; concurrent requests wait their turn. If Chromium is missing on
first use, the server downloads it (about 150 MB) before the first screenshot.
| `validate_manifest` | Check a `manifest.json` for the developer.wordpress.org importer, same checks as the CI action. |

The WordPress session stays warm between calls and closes after ten minutes unused (`--idle <minutes>`, `0` to
keep it forever). Content a screenshot creates is cleaned up after each call; a screenshot that changed site
settings should be followed by `restart_environment`.

Every call renders a local preview. Canonical pixels for committing still come from `wp-screenshots check --docker`
in the documentation project; the tool says so in its result.

## Setup

### The short way (macOS, Linux)

```sh
curl -fsSL https://raw.githubusercontent.com/ndiego/wp-docs-toolkit/trunk/scripts/install.sh | sh
```

Clones the toolkit into `~/.wp-docs-toolkit`, installs dependencies and Chromium, registers the server in Claude
Desktop and (if the `claude` CLI exists) Claude Code, and prints the ChatGPT steps. Re-run to update. On Windows,
follow the manual steps below for now.

### The manual way

Once, on the machine that will run the server:

```sh
git clone https://github.com/ndiego/wp-docs-toolkit.git && cd wp-docs-toolkit
npm ci && npm run setup          # dependencies, then Chromium for Playwright
```

The server starts with `node packages/mcp/src/cli.js` (or `npx wp-docs-mcp` from inside the checkout).

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config), with the absolute path to your checkout:

```json
{
  "mcpServers": {
    "wp-docs-toolkit": {
      "command": "node",
      "args": [ "/path/to/wp-docs-toolkit/packages/mcp/src/cli.js" ]
    }
  }
}
```

Restart Claude Desktop, then ask: "Take a screenshot of the General Settings page in wp-admin." The image comes
back in the conversation.

### Claude Code

The repository carries a `.mcp.json`, so opening the checkout in Claude Code offers the server automatically.
From any other project:

```sh
claude mcp add wp-docs-toolkit -- node /path/to/wp-docs-toolkit/packages/mcp/src/cli.js
```

### ChatGPT and other remote clients

ChatGPT connects only to remote HTTPS MCP servers (Developer Mode, Settings → Apps & Connectors → Advanced); a
local stdio process cannot be added. Run the server in HTTP mode with a token, expose it, and add the URL:

```sh
cd ~/.wp-docs-toolkit
npx wp-docs-mcp --http --token "$(openssl rand -hex 16)"     # prints the token in use on the first line
cloudflared tunnel --url http://127.0.0.1:3920                # or ngrok; prints an https://… URL
```

In ChatGPT, create a connector with `https://<tunnel host>/mcp/<token>` and "No authentication": the token in the
path is what protects the server, since ChatGPT cannot send a bearer header for a no-auth connector. Clients that
can send headers use `Authorization: Bearer <token>` against `/mcp` instead. `GET /healthz` answers without a
token. The server refuses to listen on a non-localhost address without a token. ChatGPT shows the text result;
whether it displays the inline image depends on the client version. Stop the tunnel and the server when done.

Environment variables `PORT`, `HOST` and `WP_DOCS_MCP_TOKEN` are read when the flags are absent, for containers.

### Rendering against a documentation project

By default the server renders against the bundled demo site. To use a documentation project's own demo site and
style, point it at the project's config:

```sh
node packages/mcp/src/cli.js --project /path/to/docs-repo/screenshots/shots.config.js
```

## Example prompts

- "Take a screenshot of the Image block on the editor canvas."
- "Show me the Image block's Styles tab in the block inspector."
- "Give me the site editor's Styles view, wide."
- "Screenshot the Plugins screen in wp-admin and save it to ~/Desktop/plugins.webp."
- "Validate docs/manifest.json against the docs folder."

## Development

```sh
npm test -w @wp-docs-toolkit/mcp      # tool contract tests over an in-memory transport
```
