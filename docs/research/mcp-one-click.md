# Connecting an assistant in one click

Research for MCP-011 and MCP-012 (`docs/requirements/ledger.yaml`): what each AI assistant on Windows documents for adding a local MCP server, and what RigReady does with it. The owner's ask: connecting an assistant must be simple, ideally a click, part of the first run where it fits, and not only for developers. Checked 11 November 2026. RigReady's server is described in `docs/research/mcp-server.md`: `RigReady.exe --mcp` (stdio, no token needed) or `http://127.0.0.1:29170/mcp` with a pairing's token.

## What each assistant takes

| Assistant | Local stdio | Local HTTP + header | One-click route | What RigReady does |
|---|---|---|---|---|
| Claude Desktop | yes | no (remote connectors only) | Desktop Extension (.mcpb), see below | Writes its `claude_desktop_config.json` through FileStore |
| LM Studio | yes | yes | `lmstudio://add_mcp?name=&config=<base64>` | Opens the link |
| AnythingLLM | yes | not documented | none | Writes `anythingllm_mcp_servers.json` through FileStore |
| Jan | yes (UI fields) | not documented | none | Shows the three fields to fill in |
| Msty Studio | yes (STDIO / JSON) | yes | none found | Shows the JSON to paste |
| Goose | yes | yes | `goose://extension?cmd=...`, but `cmd` is limited to `jbang`, `npx`, `uvx`, `goosed`, `docker` | Shows the YAML to add |
| Claude Code | yes | yes | `claude mcp add` | Shows the command; "Run it" when the CLI is found |
| Cursor | yes | yes | `cursor://anysphere.cursor-deeplink/mcp/install?name=&config=<base64>` | Opens the link |
| VS Code (Copilot) | yes | yes | `vscode:mcp/install?<url-encoded JSON>` | Opens the link |
| Windsurf | yes | yes | none | Shows the JSON to merge |
| ChatGPT desktop | no | no | remote HTTPS only | Not offered; the manual says why |
| Perplexity for Windows | no (macOS only) | no | remote connectors only | Not offered; the manual says why |
| Windows agent connectors (Copilot) | yes, preview | ? | MSIX package extension or `odr mcp add` | Not offered; see below |

## Details and sources

**Claude Desktop.** Settings in `%APPDATA%\Claude\claude_desktop_config.json`, `{"mcpServers": {"<name>": {"command", "args", "env"}}}` (https://modelcontextprotocol.io/docs/develop/connect-local-servers). The Microsoft Store (MSIX) version reads `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json` instead, and "Edit Config" has opened the other file, so servers silently failed to load (https://github.com/anthropics/claude-code/issues/26073, /34359, /70393). RigReady looks for a `Claude_*` package folder and writes there when one exists. A restart of Claude Desktop (quit from the tray too) loads the change.

**Claude Desktop Extensions (.mcpb).** A zip with `manifest.json` at its root (https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md, https://www.anthropic.com/engineering/desktop-extensions). `manifest_version` 0.3; `server.type` is `node`, `python`, `binary` or `uv`; `server.mcp_config` has `command`, `args`, `env` and `platform_overrides`; substitutions are `${__dirname}`, `${HOME}`, `${DESKTOP}`, `${DOCUMENTS}`, `${DOWNLOADS}`, `${/}` and `${user_config.*}`. A double-click opens it in Claude Desktop, which shows an install dialog.

**Decision: no .mcpb in this release.** The spec says nothing about a `binary` server whose command lies outside the bundle; every example uses `${__dirname}/server/...` and calls the binary self-contained. There is no substitution for `%LOCALAPPDATA%` (where RigReady installs), only `${HOME}`, so a fixed bundle would have to guess the path, and an open report says `${__dirname}` resolves to the MSIX-virtualised path in the Store version. Bundling RigReady.exe itself is not an option (a second copy of a 100 MB app). Without a real Claude Desktop to test against, which this PC must not be used for, shipping it would risk a button that installs something that does not start. The config write gives the same one click and is undone from the Safety page. Worth revisiting: a bundle that RigReady writes at runtime with the absolute path of the running exe, once a test confirms Claude Desktop starts a command outside the bundle.

**Claude Code** (https://code.claude.com/docs/en/mcp). `claude mcp add --transport stdio [--scope local|project|user] <name> -- <command> [args...]`; HTTP: `claude mcp add --transport http <name> <url> --header "Authorization: Bearer ..."`; also `claude mcp add-json`. Scopes: `local` (the default: `~/.claude.json`, under the current project only), `project` (`.mcp.json`), `user` (`~/.claude.json`, every project). RigReady uses `--scope user`, since the default would connect only the folder the terminal happened to be in. "Run it" calls the CLI found at `~\.local\bin\claude.exe` or `%APPDATA%\npm\claude.cmd` with an argument array (`Shell.run`), then reads `~/.claude.json` back before it says it worked. Claude Code writes its own file; RigReady does not edit it.

**Cursor** (https://cursor.com/docs/context/mcp/install-links, https://cursor.com/docs/mcp). `cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64 of the server object without its name>`. Settings in `%USERPROFILE%\.cursor\mcp.json` (`mcpServers`). A forum report says commands with spaces in the path fail on Windows; RigReady's default install path (`%LOCALAPPDATA%\Programs\RigReady`) has none unless the Windows user name does.

**VS Code / GitHub Copilot** (https://code.visualstudio.com/api/extension-guides/ai/mcp, https://code.visualstudio.com/docs/agents/reference/mcp-configuration). `vscode:mcp/install?<encodeURIComponent(JSON.stringify({name, type, command, args}))>` (`vscode-insiders:` for Insiders); also `code --add-mcp '<json>'`. Settings use `servers` with `type: stdio | http`. The docs now also describe a "Copilot Global" config (`~/.copilot/mcp-config.json`); the link works either way, which is why RigReady opens it rather than writing a file. RigReady reads `%APPDATA%\Code\User\mcp.json` only to say whether it is already there.

**LM Studio** (https://lmstudio.ai/docs/app/mcp, https://lmstudio.ai/docs/app/mcp/deeplink). `lmstudio://add_mcp?name=<name>&config=<base64 of the server object>`, URL-encoded. `mcp.json` uses `mcpServers` in Cursor's form; the Windows path `%USERPROFILE%\.lmstudio\mcp.json` comes from third-party sources only, so RigReady opens the link (LM Studio asks the user) and only reads that file.

**AnythingLLM** (https://docs.anythingllm.com/mcp-compatibility/desktop, https://docs.anythingllm.com/installation-desktop/storage). `%APPDATA%\anythingllm-desktop\storage\plugins\anythingllm_mcp_servers.json`, `mcpServers` with `command`, `args`, `env`. RigReady writes it like Claude Desktop's.

**Jan** (https://docs.jan.ai/desktop/mcp). Settings > MCP Servers > +, with Server Name, Command, Arguments. The config file path is third-party only, so RigReady shows the three values.

**Msty Studio** (https://docs.msty.ai/studio/toolbox/tools). Toolbox, "STDIO / JSON", a JSON object with `command`, `args`, `env`; HTTP with headers too. No deep link. RigReady shows the JSON. Its data folder name is not documented, so detection tries `MstyStudio` and `Msty` under AppData and Programs.

**Goose** (https://goose-docs.ai/docs/getting-started/using-extensions, https://goose-docs.ai/docs/guides/config-files). `%APPDATA%\Block\goose\config\config.yaml`, `extensions: <id>: {name, type: stdio, cmd, args, enabled, timeout}`. The `goose://extension` link only takes `jbang`, `npx`, `uvx`, `goosed` or `docker` as `cmd`, so it cannot start RigReady.exe; a URL link has no header parameter for the token. RigReady shows the YAML; editing the user's YAML in place would risk their comments and layout.

**Windsurf** (https://docs.devin.ai/windsurf/plugins/cascade/mcp). Now documented under Devin: `%AppData%\devin\mcp_config.json`, while `~/.codeium/windsurf/mcp_config.json` is described as a discovery file; sources disagree after the rename. RigReady shows the JSON and says where Windsurf's own "View raw config" opens it.

**ChatGPT desktop** (https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt). "Can I connect to a local MCP server? Not directly. ChatGPT connects to remote MCP servers." Developer-mode connectors need a public HTTPS endpoint (or OpenAI's tunnel). RigReady does not expose the rig to the internet, so ChatGPT is not offered; the manual says what it would take.

**Perplexity** (https://www.perplexity.ai/help-center/en/articles/11502712). Local MCP is macOS only (Mac App Store, with its helper); Windows has remote connectors only.

**Windows agent connectors / On-Device Agent Registry** (https://learn.microsoft.com/en-us/windows/ai/mcp/servers/mcp-server-overview, /mcp-windows-identity, /mcp-mcpb, https://learn.microsoft.com/en-us/windows/ai/mcp/odr-tool). Public preview (build 26220.7262 or later). A packaged (MSIX) app registers a server through a `com.microsoft.windows.ai.mcpServer` app extension whose registration file is an MCPB manifest carrying static `initialize` and `tools/list` answers that must match what the server returns. An unpackaged per-user app like RigReady needs a sparse package signed with a trusted certificate, or the user must lower "agent connector" protections. No official page says the consumer Copilot app uses these servers. Not a target until it leaves preview; RigReady's tool list also changes with the "What the assistant sees" setting, which a static manifest cannot follow.

## What was built

- `src/features/mcp/core/connect.ts`: detection (read-only: folders and files that exist, and the JSON that is there), the merge (other servers and keys kept, an older RigReady entry replaced, idempotent, refuses invalid JSON or a server list that is not an object), the install links, Claude Code's argument list.
- `mcp:clients`, `mcp:connectPreview`, `mcp:connect` (all `off` for assistants). `connect` turns the server on first when it is off (the bridge is paired by that; the confirm policy stays "Always ask" unless changed), then writes under one `beginGroup()` and reads the file back, opens the link, or runs the CLI and reads its settings back.
- `AppWindow.openLink(url)`: a new port method that hands a link to Windows only for `https:`, `cursor:`, `vscode:`, `vscode-insiders:`, `lmstudio:` and `goose:` (`src/core/links.ts`); a scenario run records the link instead.
- Settings > AI assistants: "Connect an assistant", general assistants first, one button each; the old paste box stays as "Set it up by hand".
- The welcome screen: an optional, quiet step that leads there; "Not now" hides it on this PC. Nothing is turned on by it.
