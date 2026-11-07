---
title: Connect an assistant
description: Turn on RigReady's MCP server and connect Claude Desktop, Claude Code, Cursor, VS Code or any other MCP client, with the text to paste for each.
order: 10
---

RigReady's MCP server runs inside RigReady while it is open. It listens only on this PC (`127.0.0.1`), and only an assistant you connected from the Settings page can reach it.

## Turn it on

1. Open **Configure > Settings** and go to **AI assistants (MCP)**.
2. Switch on **Let AI assistants use RigReady**. The line under it says where it listens, for example `http://127.0.0.1:29170/mcp`.
3. Choose **When RigReady asks you first** (see [Safety](safety.md)). **Always ask** is the default.

![The AI assistants section of Settings with the server on and an assistant paired](../../../artifacts/screens/mcp-settings/03-paired.png)

Turning it off stops the server at once. RigReady remembers the choice, so the server is back the next time RigReady starts.

## Assistants that start a program

Most assistants start a program and talk to it. For them, RigReady installs nothing extra: they start `RigReady.exe --mcp`, which passes everything on to the RigReady that is running. Pick the assistant under **Connect an assistant**, press **Copy**, and paste the text where the hint says. The text has the right path to `RigReady.exe` on your PC.

**Claude Desktop.** In Claude Desktop, open **Settings > Developer > Edit Config**, paste the text into `claude_desktop_config.json` (merge it into `mcpServers` if the file has other servers), save, and restart Claude Desktop. The text looks like this:

```json
{
  "mcpServers": {
    "rigready": {
      "command": "C:\\Users\\you\\AppData\\Local\\Programs\\RigReady\\RigReady.exe",
      "args": ["--mcp"]
    }
  }
}
```

**Claude Code.** Run the command the page gives in a terminal, once:

```
claude mcp add --transport stdio rigready -- "C:\Users\you\AppData\Local\Programs\RigReady\RigReady.exe" --mcp
```

**Cursor.** Paste the text into `~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` in one project. It has the same shape as Claude Desktop's.

**VS Code.** Paste the text into `.vscode/mcp.json`, or run **MCP: Open User Configuration** for every workspace.

When RigReady is not running, the assistant gets an answer that says so. Start RigReady and ask again; nothing needs restarting.

## Assistants that connect to the address

Some assistants connect to an address instead of starting a program. Such an assistant needs a token of its own:

1. Under **Assistants that connect over HTTP**, type a name for it ("Claude Code", "My laptop's Cursor") and press **Pair**.
2. The token is shown once, and the text under **Connect an assistant** now carries it (choose **Claude Code, over HTTP**, **Cursor, over HTTP** or **Any other client**). Copy it now: RigReady keeps only a fingerprint of the token, so it cannot show it again.
3. The pairing is listed with its last call. **Forget** stops its token from working at once.

Everything that assistant does is recorded under the name you gave it.

## The port

The server listens on port 29170. If another program already uses it, the line under the switch says so.

## What the assistant sees

**What the assistant sees** has two choices. **Task tools** (the default) gives a short list: check, make ready, launch, stand down, list and create setups, explain a check, find a device by a button press, search the manual, and one tool that reaches every other part of RigReady by name. **Every channel as its own tool** lists over 200 tools, one for every action of every page; choose it only for an assistant that handles long tool lists well. Both reach the same things under the same rules. See [What the assistant can do](what-the-assistant-can-do.md).
