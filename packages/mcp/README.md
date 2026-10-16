# @wp-docs-toolkit/mcp

An [MCP](https://modelcontextprotocol.io) server that lets any MCP client, such as Claude Desktop, Claude Code,
ChatGPT or Cursor, take reproducible WordPress documentation screenshots and validate handbook manifests by
asking in words.

| Tool | What it does |
|---|---|
| `list_presets` | The subjects a screenshot can be taken of, with their parameters. |
| `screenshot` | Render one subject from a preset, optionally with annotations (`annotate`: an arrow or outline on a named button or control, numbered badges, dimming), extra regions in the crop (`include`) and `pad` (a block on the canvas, its toolbar or settings, the site editor, a wp-admin screen, the front end) against the bundled demo site (WordPress 7.1, the Ipsum theme, demo content). Returns the image inline and writes the WebP when given `out`. The first call boots WordPress and Chromium (10-20 s); later calls reuse them (a few seconds). |
| `vocabulary` | Scenes, step verbs, capture targets, locator keys, frames: what a free-form screenshot can be built from. |
| `restart_environment` | Stop the warm WordPress session so the next screenshot boots a fresh site. |

Presets are the structured path and cover most requests. For anything else the `screenshot` tool takes `scene`
and `steps` in the engine's own vocabulary (the same one YAML specs use), plus `viewport`, `target`, `fit` and `mask`,
so an agent can build a shot no preset anticipated while every step is still validated. `vocabulary` lists what is
available.

Screenshot calls are serialized on the one warm session; concurrent requests wait their turn. If Chromium is missing on
first use, the server downloads it (about 150 MB) before the first screenshot.
| `validate_manifest` | Check a `manifest.json` for the developer.wordpress.org importer, same checks as the CI action. |

The WordPress session stays warm between calls and closes after ten minutes unused (`--idle <minutes>`, `0` to
keep it forever). Content a screenshot creates is cleaned up after each call; a screenshot that changed site
settings should be followed by `restart_environment`.

Every call renders a local preview. Canonical pixels for committing still come from `wp-screenshots check --docker`
in the documentation project; the tool says so in its result.

## Setup

Requirements: Node 22.19 to 25. Node 26 is not supported yet because WordPress Playground's native module ships no
binaries for it; `install` registers a supported Node found in nvm, Volta, fnm, asdf or Homebrew when the default
is newer (`--node <binary>` to choose one). Chromium (about 150 MB) and a WordPress build download on the first
screenshot.

### One command

```sh
npx -y @wp-docs-toolkit/mcp install
```

Registers the server in Claude Desktop and, when the `claude` CLI exists, in Claude Code, writing the absolute path
of a supported Node and a PATH that starts with its folder, so the server runs on that Node whatever the desktop app
finds by default (it does not see your shell's nvm setup, and Homebrew's newest Node usually comes first on its
PATH). Should a launcher still start it on an unsupported Node, the server restarts itself on a supported one it
finds on the machine. Restart Claude Desktop afterwards. The
same command later updates to the newest version; `npx -y @wp-docs-toolkit/mcp uninstall` removes the entries.
Flags: `--config <file>` for another Claude Desktop config, `--no-claude-code`.

### By hand

Claude Desktop: add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "wp-docs-toolkit": {
      "command": "npx",
      "args": [ "-y", "@wp-docs-toolkit/mcp" ]
    }
  }
}
```

If the server never appears, the app could not find `npx` on its PATH; put the absolute path to your Node binary in
`command` and `.../lib/node_modules/npm/bin/npx-cli.js` as the first argument. If your default Node is 26, add
`"env": { "PATH": "<that Node's bin folder>:/usr/bin:/bin" }` as well, or npx hands the server to the default Node.
`install` writes all of this.

Claude Code: `claude mcp add wp-docs-toolkit -- npx -y @wp-docs-toolkit/mcp`. A checkout of the toolkit repository
also carries a `.mcp.json`, so opening it in Claude Code offers the server automatically.

Other stdio clients (Cursor, Zed, …): command `npx`, arguments `-y @wp-docs-toolkit/mcp`.

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
npx -y @wp-docs-toolkit/mcp --project /path/to/docs-repo/screenshots/shots.config.js
```

### Developing the server

```sh
git clone https://github.com/ndiego/wp-docs-toolkit.git && cd wp-docs-toolkit
npm ci && npm run setup
node packages/mcp/src/cli.js install --via path     # register this checkout instead of the npm package
```

## Example prompts

- "Take a screenshot of the Image block on the editor canvas."
- "Show me the Image block's Styles tab in the block inspector."
- "Give me the site editor's Styles view, wide."
- "Screenshot the Plugins screen in wp-admin and save it to ~/Desktop/plugins.webp."
- "Take a screenshot of the post editor with an arrow on the Save draft button."
- "The Image block's Settings tab with the Resolution control outlined."
- "Validate docs/manifest.json against the docs folder."
- "Open the block inserter, search for Gallery, and screenshot the inserter panel." (no preset covers this; the
  agent writes `steps` from the `vocabulary` tool)

## Tests

```sh
npm test -w @wp-docs-toolkit/mcp      # tool contract, HTTP auth and install tests
```
