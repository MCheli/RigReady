---
title: AI assistants
description: The built-in assistant with a provider you choose, and any assistant on your PC through MCP. Both use the same tools and the same safeguards.
order: 105
---

RigReady works with AI in two ways. Both are off until you turn them on, and nothing else in the app needs them. Both reach RigReady through the same tools and the same safeguards: a change or a launch is asked about in RigReady's window first, every file change is backed up and listed on the Safety page under the assistant's name, and what is never offered to one is never offered to the other.

- **The built-in assistant.** A panel you open from the **Assistant** button at the top of the window or from the command palette, on any screen and for any game. It uses your own key from Anthropic (the default), OpenAI, Google Gemini, OpenRouter or Mistral, or a model on your own PC through Ollama or LM Studio, and shows you each request before it is sent. It finds where your helper programs are installed, proposes the checks and launch steps of a ready check, explains why the rig is not ready, and writes scripts for what no check covers. Nothing it proposes is saved until you press **Save**. See [The built-in assistant](built-in-assistant.md) and [Choose who answers](providers.md).
- **An assistant of your own, through MCP.** An AI assistant you already use on this PC (Claude Desktop, Claude Code, Cursor, VS Code and others that speak the Model Context Protocol) can use RigReady the same way. RigReady does not pay for it and never hands it your API key. See [Connect an assistant](mcp-server.md).

The [binding guide](../dcs/binding-guide-and-ai.md) keeps its own focused AI help for DCS bindings, with the same provider, and can open the assistant for anything else.

## Pages in this section

- [The built-in assistant](built-in-assistant.md): the panel, what is sent, building a ready check, scripts.
- [Choose who answers](providers.md): the providers the built-in assistant and the binding guide work with, how to set each up, and which host receives what.
- [Connect an assistant](mcp-server.md): turning the MCP server on, and what to paste into Claude Desktop, Claude Code, Cursor and VS Code.
- [What the assistants can do](what-the-assistant-can-do.md): the tools, the manual pages and the guided conversations.
- [Safety](safety.md): what RigReady asks you first, what it never offers, and how to see and undo what was done.
