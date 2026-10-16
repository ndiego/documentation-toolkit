# @wp-docs-toolkit/mcp

An [MCP](https://modelcontextprotocol.io) server that lets any MCP client, such as Claude Desktop, Claude Code,
ChatGPT or Cursor, take reproducible WordPress documentation screenshots and validate handbook manifests by
asking in words.

| Tool | What it does |
|---|---|
| `list_presets` | The subjects a screenshot can be taken of, with their parameters. |
| `screenshot` | Render one subject from a preset (a block on the canvas, its toolbar or settings, the site editor, a wp-admin screen, the front end). Boots the bundled demo site (WordPress 7.1, the Ipsum theme, demo content), returns the image inline, and writes the WebP when given `out`. 15-30 seconds per image. |
| `validate_manifest` | Check a `manifest.json` for the developer.wordpress.org importer, same checks as the CI action. |

Every call renders a local preview. Canonical pixels for committing still come from `wp-screenshots check --docker`
in the documentation project; the tool says so in its result.

## Setup

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

ChatGPT connects to MCP servers over HTTP, not stdio. Run the server in HTTP mode and expose it:

```sh
npx wp-docs-mcp --http --port 3920        # http://127.0.0.1:3920/mcp, Streamable HTTP
```

The server has no authentication of its own. Keep it on localhost and put a tunnel or reverse proxy with
authentication in front of it (for example `cloudflared tunnel --url http://127.0.0.1:3920` for a test), then add
the public `/mcp` URL as a connector in ChatGPT (Settings → Connectors, developer mode). ChatGPT shows the text
result; whether it displays the inline image depends on the client.

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
