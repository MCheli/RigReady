---
title: What the assistants can do
description: The tools, manual pages and guided conversations the built-in assistant and a connected one get, for setups, ready checks, scripts, bindings and more.
order: 20
---

The [built-in assistant](built-in-assistant.md) and an assistant [connected over MCP](mcp-server.md) get the same tools, from one list, and every call goes through the same gate. Either can do almost everything you can do in RigReady's window, through the same steps the window uses. It reads the same checks, writes through the same backups, and gets the same refusals, for example when DCS is running.

## Tools

| Tool | What it does | Asks you first |
|---|---|---|
| `setups_list` | Lists your setups and which one is in use | No |
| `rig_check` | Runs a setup's checklist and reports every item | No |
| `check_explain` | Explains one item: what it looks for, what it found, what its fix would do | No |
| `rig_make_ready` | Runs **Make ready** for a setup | Yes, under **Always ask** |
| `rig_launch` | Launches a setup's game | Yes, unless you chose **Never ask** |
| `rig_stand_down` | Runs **Stand down**, and can ask the game to close | Yes, under **Always ask** |
| `setup_create_from_rig` | Creates a setup from the rig as it is now, like the capture page | Yes, under **Always ask** |
| `device_find_by_press` | Waits for you to press a button and names the device | No |
| `programs_find` | Finds where programs are installed by name or vendor (SimAppPro, TrackIR, SRS, Stream Deck, VoiceAttack, Tacview, OpenKneeboard, Pit House, G HUB), with path variables | No: it only reads |
| `setup_propose` | Proposes checks and launch steps for a setup, or a new setup, shown in RigReady's assistant panel | No: nothing is saved until you press **Save** |
| `script_draft` | Drafts a `.ps1` or `.cmd` script and its explanation, shown in full in the panel | No: nothing is saved until you press **Save**, and it never runs without asking you |
| `manual_search` | Finds pages of this manual, each with its address on rigready.io | No |
| `manual_read` | Reads one page of this manual in full | No |
| `rigready_channels` | Lists every other action of RigReady by page, with what each takes | No |
| `rigready_call` | Runs one of those actions | When the action changes the rig or launches a game |

Through `rigready_channels` and `rigready_call` the assistant also reaches the bindings pages (read the bindings of an aircraft, plan a change, show you the plan, then write it), the monitor layouts, audio devices, backups and restores, setups, Stream Deck and TrackIR, the racing games, diagnostics and the log. Every one of them says whether it only reads, changes the rig or launches a game, and RigReady applies [the same rules](safety.md) to each.

## What it can read

- **The guide** (`rigready://guide`): how an assistant should work with RigReady. Check before fixing, show a preview before writing, never guess an id, and let you answer in RigReady.
- **This manual**: every page, by section (`rigready://docs`).
- **The rig right now** (`rigready://rig/state`): the setup in use and a fresh check of it.
- **Your setups** (`rigready://setups`), each as the YAML file RigReady keeps.
- **The log** (`rigready://log`), with personal details masked, and **every change RigReady made** (`rigready://safety`).

## Guided conversations

Some assistants list these as prompts or slash commands:

- **first_setup**: from an empty RigReady to a working setup.
- **fix_my_bindings**: what is wrong with the bindings of one aircraft or car, fixed with a preview of every change.
- **why_not_ready**: each failing check explained, then **Make ready** offered.
- **new_pc**: the order of work after moving the rig to a new PC.

## What it cannot do

It cannot see or use the API key of your AI provider, change the AI assistant settings, open file dialogs, copy to your clipboard, or answer RigReady's questions for you. It cannot save a proposal or a script (only you can, in the panel), and it cannot run a script an assistant wrote: that runs only from RigReady's window, after RigReady asked you. It only works while RigReady is running.

Setup proposals and script drafts from an assistant connected over MCP wait in the assistant panel, which opens from the command palette (**Open the assistant**) even when no AI provider is set up: no key is needed to look at them or save them, only to talk to the built-in assistant.

