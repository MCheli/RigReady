# RigReady as an MCP server

Design record for MCP-001 to MCP-010 (`docs/requirements/ledger.yaml`). The owner's ask of 7 November 2026: keep the in-app AI that uses the user's own Anthropic key, and also let any AI assistant on the PC (Claude Desktop, Claude Code, Cursor, VS Code, others) use RigReady through the Model Context Protocol: almost every function, guides and the manual for the assistant, help with first setup, bindings and troubleshooting. It ships in 2.0.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Who hosts the server | The running app, in its main process | Every safeguard (FileStore backups, the Safety journal, the monitor keep-or-revert countdown, "DCS must be closed", one action at a time) lives there. A second process with its own ports would have to copy them, and two writers to the same files is what the journal is meant to prevent. |
| Transport | Streamable HTTP on `127.0.0.1:<port>/mcp` (default port 29170, changeable) | Every current client speaks it; one endpoint; the SDK serves 2025-era clients statelessly and 2026-07-28 clients natively from one factory. |
| Clients that only start a program (stdio) | `RigReady.exe --mcp`, a bridge that passes messages to the running app | Claude Desktop and most others start a command. The bridge holds no tools and no state: it reads where the app listens (`<data root>/mcp/endpoint.json`) and its token (`<data root>/mcp/bridge-token`), and forwards. When the app is not running, every request is answered with an error that says so; the next request tries again. |
| Default | Off. Turned on from Settings > AI assistants | A listening port is a decision for the user. |
| Who may talk to it | Every request carries a bearer token of a pairing; anything else gets 401, reads included | A local port is reachable by every program of every user on the PC. Reads expose the rig, the setups and the log. The bridge is paired automatically when the server is turned on, so this costs a stdio user nothing. |
| What a pairing is | A name ("Claude Code") and the SHA-256 of a token (`rr_` + 64 hex). HTTP tokens are shown once and never stored; the bridge's is in `<data root>/mcp/bridge-token` | The name is what changes are recorded under. A stolen `mcp.json` holds no usable token. |
| Why the bridge token is not in safeStorage | A file in the data folder, which the Windows user profile protects; the bridge runs with a Chromium profile of its own in the temp folder | Electron's safeStorage keeps its key in the app's Chromium profile (`Local State`), written lazily. A second process opening that profile found no key yet, made its own, and could not decrypt; worse, it could have written its key over the app's and lost the stored Anthropic key. Tried and seen in the e2e run. A DPAPI call of our own (koffi, `CryptProtectData`) would restore encryption at rest; see the open questions. |
| Browsers | Host and Origin are checked before the token (the SDK's localhost validation) | DNS rebinding and a web page posting to localhost are refused even with a guessed token. |
| Where the tools come from | Every channel of every feature contract, derived; plus task-level tools features register on `ctx.mcp` | "Expose every edge" without a second list to maintain. A feature that adds a channel is exposed by writing its contract, with no shared-code edit. |
| What gates a call | The channel's tier in its contract (`read`, `change`, `launch`, `off`) and the user's confirm policy | One rule for channel tools, task-level tools and `rigready_call`. A channel without a tier is treated as `change`. |
| Two surfaces | `guided` (default): task-level tools plus `rigready_channels` (the reference) and `rigready_call` (one call). `full`: also every offered channel as its own `ipc_<feature>_<key>` tool | 230+ tools swamp most assistants' tool lists; the guided surface still reaches every channel, through the same gate. |
| Confirmation | Asked in RigReady's window, never through the assistant. Policy: always ask (default), launches only, never | An assistant cannot answer its own question. A question that is not answered in 60 seconds is a no. |
| Mutual exclusion | One change or launch at a time across every assistant; a second is refused with `mcp.busy` | Make ready, Stand down and binding writes are not meant to overlap. |
| Limits | 30 calls in a burst, 10 a second after that, per pairing; request bodies up to 1 MB; answers longer than 1 000 000 characters are cut | A runaway loop in an assistant cannot hammer the rig or fill its memory. |
| Secrets | `off` channels are never offered: API keys, tokens, the MCP settings themselves, dialogs and clipboard, window-only signals, anything that spends the user's Anthropic credit | The in-app AI keeps its own key; an outside assistant never sees it or uses it. |
| What the assistant did | Every call is recorded (who, which tool, what it asked, how it ended, which Safety page actions it left) and shown in Settings > AI assistants | The user sees what was done in their name, and can undo a change from the Safety page. |

## Module layout

```
src/shared/ipc.ts          ChannelMeta { describe, tier } on channel(); ChannelTier
src/core/contracts.ts      ContractRegistry: every wired contract as data (filled by the bootstrap)
src/core/mcp.ts            McpRegistry: what features register (task-level tools, resources, templates, prompts)
src/core/feature.ts        MainContext.contracts, .mcp, .invoke(); FeatureMain.start()
src/main/bootstrap.ts      fills the contract registry; ctx.invoke goes the way the tray does
src/core/mcpBridge.ts      the bridge's message pump and what it shares with the feature (endpoint file, token file, path)
src/main/mcpBridge.ts      RigReady.exe --mcp: Electron side of the bridge (files, stdio)
src/platform/electron      processStdio(): stdin and stdout as streams (process.stdin ends at once in Electron's main process on Windows)
src/features/mcp/
  contract.ts              the Settings page's channels (all off for assistants, except status, activity, catalogue)
  main.ts                  wires McpService; start() listens when the setting is on
  guide.md                 rigready://guide, the operating rules for an assistant
  core/names.ts            ipc_<feature>_<key> and back
  core/tiers.ts            tier of a channel, gate decision per policy, annotations
  core/jsonSchema.ts       zod input -> JSON Schema 2020-12 (z.toJSONSchema), no-input and non-object inputs
  core/catalogue.ts        derivation, built-ins, the catalogue and its self-check, the reference text
  core/curated.ts          task-level tools of the mcp feature (rig_check, rig_make_ready, ...)
  core/resources.ts        rigready:// resources and templates
  core/prompts.ts          first_setup, fix_my_bindings, why_not_ready, new_pc
  core/manual.ts           the bundled manual (docs/manual/**), front matter, search
  core/gate.ts             rate limit, tier x policy, confirmation, one change at a time, the record
  core/confirm.ts          questions waiting for the window
  core/activity.ts         what assistants did, this run
  core/pairings.ts         tokens, hashes, the bridge's pairing
  core/store.ts            <data root>/mcp.json and mcp/endpoint.json
  core/clientConfig.ts     what to paste into each client
  core/service.ts          the whole server as one object
  server/host.ts           node:http listener, Host/Origin/token checks, body limit
  server/build.ts          one McpServer per request from the catalogue
  bridge/proxy.test.ts     the bridge against the real server, without Electron
  renderer/                Settings section, the confirm dialog, the activity list
```

## Data flow of one call

1. The client POSTs JSON-RPC to `/mcp` with `Authorization: Bearer rr_...`.
2. `McpHost` checks the path, Host, Origin, then the token against the pairings (constant-time compare of hashes; the store is read each time, so a revoked pairing stops at once). The protocol layer is handed the pairing id and name, never the token.
3. The SDK builds an `McpServer` from the catalogue for this request and dispatches `tools/call`.
4. The tool's handler builds a `ToolCall` (tool, tier, one-line summary, the work) and hands it to the `Gate` with the caller.
5. The gate: rate limit, then tier against the policy (`read` runs; `change` and `launch` may ask the window and wait; `off` is refused), then the busy check, then the work through `ctx.invoke`, which is the same validated path the tray uses: the zod input schema of the channel, then the handler, then the zod output schema. The taskbar and the tray follow what was done.
6. The journal groups before and after are compared, so the record names the Safety page actions the call left.
7. The answer is the channel's own answer as JSON (`structuredContent` and text), or `isError` with `code: message`. Never a success the channel did not report.

## Tool catalogue

Task-level tools (registered by the mcp feature on `ctx.mcp`; another feature can add its own the same way):

| Tool | Tier | What it does |
|---|---|---|
| `setups_list` | read | Every setup with id, name, game, last use, whether it can launch, which is in use |
| `rig_check` | read | Runs a setup's checklist; every item with status and fix |
| `check_explain` | read | One item again, with its type, parameters, details and fix |
| `rig_make_ready` | change | Make ready: every available fix in order, then a check; programs needing confirmation only with `approvePrograms` |
| `rig_launch` | launch | Launches a setup's game with its actions |
| `rig_stand_down` | change | Stand down, optionally asking the game to close |
| `setup_create_from_rig` | change | Captures the rig as it is and saves a setup |
| `device_find_by_press` | read | Waits for a button press and names the device |
| `manual_search` | read | Finds manual pages by words |
| `rigready_channels` | read | The reference of every channel, by feature, with JSON Schemas |
| `rigready_call` | the channel's tier | Calls one channel by name through the same gate |

Bindings, monitor layouts, backups, diagnostics, Stream Deck, TrackIR and the racing games are reached through their channels (for example `dcs-bindings:plan` then `dcs-bindings:apply`, `displays:apply`, `backup:create`, `diagnostics:log`), each with the tier and description its contract gives. `npm test -- catalogue` holds every channel to: exactly one entry, a sound input schema, a description, a tier. At the time of writing there are 273 channels: 120 read, 100 change, 2 launch (fly:launch and games:launch), 51 off.

Resources: `rigready://guide`, `rigready://docs` (contents) and `rigready://docs/<section>` / `rigready://docs/<section>/<page>` (every manual page, title and description from its front matter), `rigready://ipc` and `rigready://ipc/<feature>` (the channel reference), `rigready://rig/state`, `rigready://setups` and `rigready://setups/<id>` (the setup YAML), `rigready://log`, `rigready://safety`, `rigready://activity`.

Prompts: `first_setup`, `fix_my_bindings`, `why_not_ready`, `new_pc`.

## Pairing flow

1. The user turns the server on in Settings > AI assistants. The bridge gets its pairing (its token into `mcp/bridge-token`), the listener starts, `endpoint.json` is written.
2. Stdio clients: the page shows the text to paste for Claude Desktop, Claude Code, Cursor and VS Code (`RigReady.exe --mcp`), with a Copy button. Nothing else is needed.
3. HTTP clients: **Pair** takes a name and shows the token once, with the client configuration filled in. The page lists pairings with their last use and call count; **Forget** revokes one at once. **New token** (beside RigReady.exe --mcp) rotates the bridge's.

## Error model

Every refusal is a tool result with `isError: true` and text `code: message detail`. Codes: `mcp.denied` (the user said no), `mcp.timeout` (no answer in 60 s), `mcp.off` (not offered), `mcp.busy`, `mcp.rate`, `mcp.input` (arguments do not fit), `mcp.output`, `mcp.channel` / `mcp.feature` (unknown name, with the list), `mcp.setup` / `mcp.item` (unknown setup or item, with what exists), and every channel's own codes passed through (`display.reverted`, `journal.changed`, the DCS-running refusals). HTTP-level: 401 without a known token, a 4xx refusal for a foreign Host or Origin (before the token is looked at), 404 off the endpoint path, and a refusal over the body limit.

## Versioning and extensibility

- The server's version is the app's. Tool names are stable: a channel tool's name is its channel's, and a renamed channel is a breaking change for assistants exactly as for the renderer.
- A feature exposes itself by giving its contract `describe` and `tier`, and optionally by registering task-level tools, resources and prompts on `ctx.mcp` in its `main.ts`. No shared file changes.
- `catalogue.test.ts` fails when a channel has no description or tier, so a new channel is described when it is written.
- The SDK negotiates the protocol revision; the endpoint file records the newest one the server speaks.

## The built-in assistant (ASSIST-001 to ASSIST-004)

The assistant inside the app uses the same catalogue and the same gate. `McpService.toolHost()` is handed to `ctx.mcp.provideHost()` at setup; the ai-assist feature calls `ctx.mcp.host()` for the guided surface's tools and calls each through `planToolCall` (`core/dispatch.ts`, shared with `server/build.ts`) and `Gate.call`, with the caller "Built-in assistant". It works whether or not the server listens. The gate runs every call's work under `runAsAssistant` (`src/core/assistantScripts.ts`), so a script an assistant wrote is refused while any assistant's call is being carried out; only the window runs one, after asking. `programs_find`, `setup_propose` and `script_draft` are task-level tools of the ai-assist feature, so MCP clients have them too; the last two only make drafts, which the panel shows and only the user's Save turns into files.

## Not built yet

These return a clear error or are absent, never a pretend success:

- MCP sampling and elicitation (the server asks nothing of the client).
- Change notifications (`tools/list_changed`, resource subscriptions); clients list again when they reconnect.
- The Safety page does not name the assistant beside an action yet; the activity list on the Settings page does, with the action's id.
- The one-line summary in the question names the setup as the assistant gave it (an id or a name), not always the setup's display name.
- Electron writes an empty line to stdout when `RigReady.exe --mcp` starts. The official SDK skips it (the e2e proves it); a strict client might log a parse warning.

## Open questions for the owner

1. The default confirm policy is "always ask". Is "launches only" a better default for a user who just paired their own assistant?
2. Should the guided surface be the default, or should power users get `full` by default?
3. Port 29170 by default: fine, or would you prefer a random free port written to the endpoint file each start (HTTP clients would then need reconfiguring)?
4. The bridge token is a file in the data folder rather than encrypted. Encrypting it with a direct DPAPI call (not Electron's safeStorage) is about a day of work. Worth it for 2.0, or later?
5. `fly:check` with `remember` (the default) makes the checked setup the one in use. It is tiered `read` as RigReady's own bookkeeping. Agree?
