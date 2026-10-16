# @wp-docs-toolkit/mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI tool take reproducible WordPress documentation
screenshots and validate handbook manifests by asking in words. It gives the agent six tools: `screenshot`,
`inspect`, `list_presets`, `vocabulary`, `restart_environment` and `validate_manifest` (see [Tools](#tools)).
Screenshots render against a bundled demo site (WordPress 7.1, the Ipsum theme, demo content) unless you point the
server at your own project. For prompts to try, see the [sample prompts](../../README.md#sample-prompts) in the root
README.

- [Requirements](#requirements)
- [Claude Desktop](#claude-desktop)
- [Claude Code](#claude-code)
- [ChatGPT](#chatgpt)
- [Other MCP clients](#other-mcp-clients)
- [Tools](#tools)
- [Against your own documentation project](#against-your-own-documentation-project)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Requirements

These apply whichever AI tool you use.

- **Node 22.19 to 25.** Node 24 is recommended. Node 26 is not supported yet: WordPress Playground's native module
  ships prebuilt binaries for Node 22.19 through 25 only, so Playground cannot load on 26. You do not have to make
  24 your default. `install` registers a supported Node it finds in nvm, Volta, fnm, asdf or Homebrew when your
  default is newer (or the one you name with `--node <binary>`), and if a launcher starts the server on Node 26
  anyway, the server restarts itself on a supported Node it finds on the machine.
- **Disk and first-run downloads.** The first screenshot downloads Chromium (about 150 MB) if it is missing, and a
  WordPress build. Expect about a minute the very first time; later screenshots take a few seconds.
- **Operating system.** `install` knows where Claude Desktop keeps its config on macOS
  (`~/Library/Application Support/Claude/`), Windows (`%APPDATA%\Claude\`) and Linux
  (`$XDG_CONFIG_HOME/Claude/`, default `~/.config/Claude/`). The search for a supported Node looks in the macOS and
  Linux locations of nvm, Volta, fnm, asdf and Homebrew; on Windows, if your default Node is not supported, pass
  `--node <path to node.exe>`.

## Claude Desktop

### Install

1. Run, in a terminal:

   ```sh
   npx -y @wp-docs-toolkit/mcp install
   ```

2. Quit Claude Desktop completely and reopen it.
3. Start a new chat. The tools menu lists `wp-docs-toolkit`.

**Verify it works.** Ask _"Take a screenshot of the General Settings page in wp-admin."_ You should get an image
back in the chat. The first one takes about a minute; the next ones take a few seconds.

### What `install` writes, and why

`install` adds a `wp-docs-toolkit` entry to `claude_desktop_config.json` (backing up the existing file first) and
keeps everything else in it. The entry uses:

- **An absolute path to a supported Node** as `command`, because the desktop app does not see your shell's PATH,
  so a bare `npx` from nvm, Volta or Homebrew is often not found.
- **npx launched by that Node, pinned to the installed version** (`@wp-docs-toolkit/mcp@<version>`), so the npm
  cache can be cleared safely and an update is an explicit step.
- **An `env.PATH` that starts with that Node's folder.** npx hands the server to the first `node` on PATH, and on
  a desktop app's PATH that is usually Homebrew's newest Node; without this the server would run on Node 26 even
  though Node 24 was registered.

It prints the Node it chose and what to do next. Flags: `--config <file>` for a different Claude Desktop config,
`--no-claude-code` to skip [Claude Code](#claude-code), `--node <binary>` to choose the Node.

### Update and uninstall

Run the same install command again to register the newest version, then restart Claude Desktop:

```sh
npx -y @wp-docs-toolkit/mcp install
```

To remove the entries from Claude Desktop and Claude Code:

```sh
npx -y @wp-docs-toolkit/mcp uninstall
```

### By hand

If you prefer to edit the config yourself, open it from Settings → Developer → Edit Config and add:

```json
{
  "mcpServers": {
    "wp-docs-toolkit": {
      "command": "npx",
      "args": ["-y", "@wp-docs-toolkit/mcp"]
    }
  }
}
```

This relies on the app finding `npx` and a supported `node` on its own PATH. If the server never appears, or your
default Node is 26, use absolute paths and set `env.PATH`, which is what `install` writes:

```json
{
  "mcpServers": {
    "wp-docs-toolkit": {
      "command": "/absolute/path/to/node24/bin/node",
      "args": [
        "/absolute/path/to/node24/lib/node_modules/npm/bin/npx-cli.js",
        "-y",
        "@wp-docs-toolkit/mcp"
      ],
      "env": { "PATH": "/absolute/path/to/node24/bin:/usr/bin:/bin" }
    }
  }
}
```

Without the `env.PATH` line, npx hands the server to the default Node even when `command` is Node 24.

## Claude Code

### Install

1. Make sure the `claude` CLI is on your PATH (`claude --version` works).
2. Run the same command as for Claude Desktop:

   ```sh
   npx -y @wp-docs-toolkit/mcp install
   ```

   When `claude` is found, `install` also registers the server in Claude Code at user scope, with the same Node,
   pinned version and PATH. It prints `Registered in Claude Code (user scope)`.

3. Start a new Claude Code session in any project.

**Verify it works.** Run `/mcp` in Claude Code and check that `wp-docs-toolkit` is connected, then ask _"What
screenshot presets are there?"_ You should get the list of presets (`block-canvas`, `block-toolbar`,
`block-settings`, `site-editor`, `post-editor`, `admin-screen`, `front-end`).

### By hand

```sh
claude mcp add --scope user wp-docs-toolkit -- npx -y @wp-docs-toolkit/mcp
```

If your default Node is 26, set a PATH that starts with a supported Node's folder, as `install` does:

```sh
claude mcp add --scope user wp-docs-toolkit -e "PATH=/absolute/path/to/node24/bin:$PATH" -- \
  /absolute/path/to/node24/bin/node \
  /absolute/path/to/node24/lib/node_modules/npm/bin/npx-cli.js -y @wp-docs-toolkit/mcp
```

When `install` does not find `claude`, it prints this command with your paths filled in, to run later.

### In a checkout of this repository

The repository carries a `.mcp.json`, so opening a checkout in Claude Code offers the server automatically. It runs
`node packages/mcp/src/cli.js` from the checkout, so run `npm ci && npm run setup` first (see
[Development](#development)).

## ChatGPT

ChatGPT connects only to remote HTTPS MCP servers; a local process like the one Claude Desktop starts cannot be
added. You run the server in HTTP mode on your machine, protect it with a token, and expose it through a tunnel.

### Requirements

- Everything in [Requirements](#requirements), in the terminal you run the server from.
- Developer mode in ChatGPT (Settings → Apps & Connectors → Advanced), which is where custom connectors are added.
- A tunnel tool that gives a public HTTPS URL for a local port, such as
  [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (or ngrok).

### Steps

1. Create a token and keep it for step 4:

   ```sh
   TOKEN="$(openssl rand -hex 16)"; echo "$TOKEN"
   ```

2. Start the server in HTTP mode, in the same terminal:

   ```sh
   npx -y @wp-docs-toolkit/mcp --http --token "$TOKEN"
   ```

   It listens on `http://127.0.0.1:3920/mcp` and prints `token required`. Leave it running.

3. In a second terminal, start the tunnel and note the `https://…` URL it prints:

   ```sh
   cloudflared tunnel --url http://127.0.0.1:3920
   ```

4. In ChatGPT, open Settings → Apps & Connectors → Advanced, turn on Developer mode, and add a connector with:
   - URL: `https://<tunnel host>/mcp/<token>`
   - Authentication: "No authentication"

5. Enable the connector in a new chat.
6. When you are done, stop the tunnel and the server (Ctrl+C in each terminal).

**Verify it works.** Before adding the connector, `curl http://127.0.0.1:3920/healthz` should return
`{"ok":true,"name":"wp-docs-toolkit"}`. In ChatGPT, ask _"What screenshot presets are there?"_ and you should get
the list of presets.

### Security

- The token in the URL path is what protects the server, because ChatGPT cannot send a bearer header for a
  connector with no authentication. Anyone with the full URL can use the server while it runs, so do not share it,
  and use a new token each time.
- Clients that can send headers use `Authorization: Bearer <token>` against `/mcp` instead.
- `GET /healthz` answers without a token.
- Without `--token`, the server only listens on `127.0.0.1` or `localhost`; it refuses to listen on any other
  address (`--host`) without a token.

### HTTP options

| Flag              | Environment variable | Default     |
| ----------------- | -------------------- | ----------- |
| `--port <n>`      | `PORT`               | `3920`      |
| `--host <addr>`   | `HOST`               | `127.0.0.1` |
| `--token <value>` | `WP_DOCS_MCP_TOKEN`  | none        |

The environment variables are read when the flags are absent, which suits containers.

## Other MCP clients

**Clients that start a local process (stdio)**, such as Cursor and Zed: add a server with command `npx` and
arguments `-y @wp-docs-toolkit/mcp`. If the client cannot find `npx`, or your default Node is 26, use the absolute
paths and `PATH` shown in [Claude Desktop, by hand](#by-hand).

**Clients that connect over HTTP:** follow the [ChatGPT](#chatgpt) steps. Use the `/mcp/<token>` URL, or `/mcp`
with an `Authorization: Bearer <token>` header if the client can send one. A client on the same machine can use
`http://127.0.0.1:3920/mcp` without a tunnel.

## Tools

| Tool                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screenshot`          | Render one subject: a `preset` (a block on the canvas, its toolbar or settings, the site editor, the post editor, a wp-admin screen, the front end) or, for anything no preset covers, a `scene` and `steps` in the engine's vocabulary. `annotate` draws an arrow, outline, numbered badge or dimming anchored to a named button or control; `target` crops to a named region; `setup` creates site state first; `out` also writes the WebP file. Returns the image inline and the YAML spec it rendered from. |
| `inspect`             | Run the same preset or scene and steps, then list the visible buttons, menu items, tabs, links and controls of the region by role, accessible name and the named region each sits in, with the accessibility tree. `preview: true` adds a small image. Use it to find the names for `annotate` and `click` steps.                                                                                                                                                                                          |
| `list_presets`        | The subjects a screenshot can be taken of, with their parameters.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `vocabulary`          | Scenes, step verbs, setup operations and fixtures, capture targets, locator keys and frames: what a free-form screenshot can be built from.                                                                                                                                                                                                                                                                                                                                                                 |
| `restart_environment` | Stop the warm WordPress session so the next screenshot boots a fresh site.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `validate_manifest`   | Check a `manifest.json` for the developer.wordpress.org importer, with the same checks as the CI action.                                                                                                                                                                                                                                                                                                                                                                                                   |

`setup` takes a fixture (`long-post`, `post-with-notes`, `synced-pattern`, `second-author`) or a list of `post`,
`note`, `user`, `option` and `plugin` operations; what it creates is removed after the shot. `screenshot` also takes
`viewport`, `frame`, `include`, `pad`, `fit`, `mask` and `alt`. A bad preset, verb or locator is rejected before
WordPress boots.

The WordPress session stays warm between calls and closes after ten minutes unused (`--idle <minutes>`, `0` to
keep it open). Screenshot calls run one at a time on that session; concurrent requests wait their turn.

Every image is a local preview. Canonical pixels for committing come from `wp-screenshots check --docker` in the
documentation project, and the tool result says so.

### From a prompt to a committed spec

`screenshot` returns, in its `spec` field, the YAML it rendered the image from. Once the image is right, paste
that YAML into a `*.shots.yaml` file next to the article in the documentation repository, set `article` and `id`
to real names, and it becomes a committed screenshot that re-renders with the rest. The
[screenshots README](../screenshots/README.md) describes the spec format.

## Against your own documentation project

By default the server renders against the bundled demo site. To render against a documentation project's own
demo site and style instead, start it with the project's config:

```sh
npx -y @wp-docs-toolkit/mcp --project /path/to/docs-repo/screenshots/shots.config.js
```

For Claude Desktop or another client, add `--project` and the path to the server's arguments. The project's config
then decides the WordPress environment and the style (frames, viewports) screenshots use; without `--project` the
server falls back to the bundled demo site.

## Troubleshooting

**The server never appears in the client.** The client could not start it, usually because it could not find
`npx` or `node` on its PATH. Run `npx -y @wp-docs-toolkit/mcp install` (it writes absolute paths), or use the
absolute paths in [Claude Desktop, by hand](#by-hand). Restart the client afterwards.

**"Node 26 is not supported" or `Failed to load fs-ext native module`.** The server ran on an unsupported Node.
Install Node 24 (`nvm install 24` or `brew install node@24`) and run `npx -y @wp-docs-toolkit/mcp install` again;
it registers the supported Node and a PATH that starts with its folder. If the server finds no supported Node on the
machine, it logs this message once and screenshots fail.

**The first screenshot is slow.** It downloads Chromium if needed and boots WordPress: about a minute the very
first time, around 15 seconds when the session has to start again, then a few seconds per screenshot.

**A screenshot shows leftovers from an earlier one.** Content created through `setup` is removed after each shot,
but steps that changed site state (settings, for example) stay in the warm session. Ask for `restart_environment`,
and the next screenshot boots a fresh site.

**HTTP mode exits with "Refusing to listen on a non-local address without a token".** You passed a `--host` other
than `127.0.0.1` or `localhost`. Add `--token <value>` or set `WP_DOCS_MCP_TOKEN`.

## Development

```sh
git clone https://github.com/ndiego/wp-docs-toolkit.git && cd wp-docs-toolkit
npm ci && npm run setup                             # dependencies, then Chromium
node packages/mcp/src/cli.js install --via path     # register this checkout instead of the npm package
npm test -w @wp-docs-toolkit/mcp                    # tool contract, HTTP auth and install tests
```

`wp-docs-mcp --help` prints the flags.
