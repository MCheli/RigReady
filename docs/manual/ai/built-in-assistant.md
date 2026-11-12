---
title: The built-in assistant
description: The assistant panel in RigReady with the AI provider you choose, what each request carries and costs, building a ready check, and scripts you approve.
order: 5
---

The built-in assistant is a panel at the side of RigReady's window. It talks to the AI provider you chose in Settings (your own key from Anthropic, OpenAI, Google Gemini, OpenRouter or Mistral, or a model on your own PC through Ollama or LM Studio; see [Choose who answers](providers.md)), and it works through the same tools an [assistant connected over MCP](mcp-server.md) gets, with [the same safeguards](safety.md).

## Turn it on

Choose who answers in **Configure > Settings**, under **AI**, and store the key it needs (a server on your own PC needs none). The **Assistant** button then appears at the top of the window, beside **Find or run**. Until then there is no button; **Open the assistant** in the [command palette](../app/command-palette.md) opens the panel, says a provider is needed and takes you to Settings. What assistants connected over MCP drafted is shown in the panel either way. The [binding guide](../dcs/binding-guide-and-ai.md) has a link to the panel too.

![The assistant panel open beside the Settings page](../../../artifacts/screens/assistant/01-panel-open.png)

The conversation fills the panel and the message box stays at the bottom. Drag the panel's left edge to make it wider or narrower (or use the arrow keys on it); RigReady remembers the width, and a double click on the edge brings back the usual one.

## Every request is shown first

Type a message and press **Prepare** (or Enter). RigReady builds the request and shows it above the message box: the host and the model it goes to, which request of the question it is, about how many tokens it has and roughly what reading it costs, and what it carries, in a line each: your message, what the tools answered since the last request, how long the conversation is, and RigReady's instructions and tool list. **Show the exact request** shows the whole text. Nothing is sent until you press **Send** (or Enter again). **Don't send** throws the request away and leaves your message in the box; changing the message does the same, so the request on screen is always the one for the text in the box.

![A request waiting for Send, with the exact text shown](../../../artifacts/screens/assistant/02-first-request.png)

When the model uses a tool, its answer goes back with the next request, and that request is shown again before it goes. Tick **Don't show this again for this conversation** and the rest of that conversation goes without stopping. The tick belongs to that one conversation: **New conversation** starts over with the preview on again.

The preview names the one host the request goes to, for example `api.anthropic.com`, or the server on your PC. If you change the provider in Settings after a request was shown, that request is not sent: it is made again for the new settings and shown first. What a request never carries: your API key (it is the request's credential, sent in a header to that host and nowhere else) and files of yours other than what a tool answered. In what the tools answered, the path of your Windows user folder is written as `{USER}`, and the PC's name as `{PC}` when it has five or more characters; other names and paths go as they are. The provider's terms and privacy policy apply to what is sent; with a model on your PC nothing leaves it. **Exactly what is sent** in Settings lists all of it.

## While it works

A line above the message box says what the assistant is doing, for example "Waiting for the answer (request 2)" or "Running: Find installed programs (request 2)", with the tokens and the cost of the question so far. **Stop** is beside it the whole time. Stopping loses nothing: a message that was not answered is back in the box, and what the tools already answered waits until you press **Continue**.

Every tool the assistant used is a row in the conversation: what it did in words, whether that read, changed something or launched a game, and a line about what it answered. Click the row to see the exact answer, which is what goes to the provider with the next request. A proposal or a script appears in the conversation at the place where it was made.

Replies are shown formatted: headings, lists, bold, code. An `https://` link in a reply opens in your browser when you click it; any other address is shown as text. HTML in a reply is shown as text, and pictures are never loaded.

## What it costs

Where the model's price is known, the panel says what you spend:

- **Before a request goes**, the preview says for example "Request 1 of this question · about 4,400 tokens · about $0.02 to read, plus the answer". One question often takes several requests, one more each time the assistant uses tools.
- **While it works**, the line above the message box shows the tokens and the cost of the question so far.
- **Under the message box** is the total of the conversation: requests, tokens, how many of them the provider read from its cache, and the cost.

**Most a question to the assistant may cost**, in Settings under **AI**, is a ceiling per question, $0.25 unless you change it. Before a request would take a question past it, RigReady stops, also when the preview is switched off for the conversation, and shows that request with **Continue past $0.25** in place of **Send**. Pressing it is good for as much again. Set the amount to 0 and RigReady never stops a question for its cost.

The amounts are estimates from the provider's list price for the model chosen in Settings; what the provider bills is what counts. With Anthropic, the part of a request that did not change since the one before (the instructions, the tools, the conversation so far) is read from the provider's cache at a fraction of the price when the requests follow each other within five minutes. For a model with no known price, and for a server on your own PC, no cost is shown and the ceiling is not used. A question always ends once the assistant has used tools 16 times for it.

## When a request fails

If the provider refuses a request or cannot be reached, the panel says why, your message is back in the message box, and the request stays ready: **Try again** sends it again. If you store another key or change who answers in Settings first, the request is made again for the new settings and shown before anything goes.

Every request a provider refused leaves a line in [RigReady's log](../app/diagnostics.md): the host, the model, the HTTP status, the provider's own error and its request id. The key, your messages, what the tools answered and the replies are never written to the log.

## It answers from this manual

The assistant has this manual at hand. For a how-to question, and before it proposes a change, it searches the manual (`manual_search`), reads the page or the section that fits (`manual_read`), answers from it and links the page, for example [Scripts](../setups/scripts.md) as https://rigready.io/docs/setups/scripts/. When the manual does not cover something, it says so.

## Build a ready check

Ask in plain words: "Set up a DCS session with SimAppPro, TrackIR and SRS". The assistant:

1. **Finds where the programs are installed** with the tool `programs_find`. It looks at the folder names under Program Files, Program Files (x86), the Programs folder of LocalAppData and your Steam libraries, and at the uninstall entries in the registry, and only reads. It knows the folders the usual names hide (SRS is DCS-SimpleRadio-Standalone, TrackIR may be under NaturalPoint, G HUB is LGHUB). Paths come back with [path variables](../setups/path-variables.md), as a setup keeps them: `{PROGRAM_FILES_X86}/TrackIR5/TrackIR5.exe`.

   ![The next request, with where the programs were found](../../../artifacts/screens/assistant/03-found-programs.png)

2. **Proposes the setup** with `setup_propose`: a new setup, or checks and launch steps added to one you have. The proposal appears in the conversation with every check, its fix and every step. **Show the setup as it would be saved** shows all of it. **Save** writes it the way the setup editor does; **Discard** throws it away. Nothing is saved before you press **Save**, and a setup that changed after the assistant read it is not overwritten.

   ![A proposed setup with three checks, waiting for Save](../../../artifacts/screens/assistant/04-setup-proposal.png)

After saving, **Open in the setup editor** takes you to the setup, where you can change anything, for example what **Launch** starts.

To answer what a setup checks or starts, the assistant reads that one setup (`setup_read`), and before it writes a check or a step it looks up the check and fix types it needs (`setup_types`). It can also explain why the rig is not ready (`rig_check`, `check_explain`), run **Make ready** or **Launch** (asked in RigReady first, unless you chose otherwise in Settings; see [Safety](safety.md)), and reach every other action of RigReady through `rigready_call`.

## What is on the Safety page, and what is not

A setup or a script saved from the assistant's draft is a file in RigReady's own data folder. Like a setup you save in the setup editor, it is not listed on the [Safety page](../protect/safety-page.md): that page lists changes to files outside RigReady's folder, each backed up first, and setups you deleted. To take a saved proposal back, edit or delete the setup in the setup editor.

A change the assistant makes through a tool (for example writing bindings, or a fix that **Make ready** runs) is asked in RigReady's window first, unless Settings says not to ask, and a file it changes outside RigReady's folder is backed up and listed on the Safety page under "Built-in assistant".

## Scripts

When no check type does what is needed, ask for a script: "Write a script to start SRS minimized as the fix of the SRS radio check". The assistant drafts a PowerShell (`.ps1`) or batch (`.cmd`) file with `script_draft`, with an explanation in plain words. The panel shows the whole file exactly as it would be saved, the explanation, where it goes in the setup, and a warning for anything worth a second look (it reaches the internet, deletes files, closes programs, changes the registry). A script that asks for administrator rights is refused before you see it.

![A drafted script, shown in full with its explanation](../../../artifacts/screens/assistant/05-script-draft.png)

**Save** writes it into RigReady's data folder, in `scripts\assistant`, with a header that says an assistant wrote it, and records its SHA-256 as your approval. Then it is added to the setup with **Ask before running** on, which cannot be switched off for a script an assistant wrote. From then on:

- Before it runs, RigReady asks **Run this program?** with its path and arguments, every time.

  ![Make ready asks before it runs the assistant's script](../../../artifacts/screens/assistant/06-run-asks-first.png)

- If the file changes after you approved it (edited by hand, or by another program), RigReady does not run it: the fix or check says it "has changed since you approved it". The panel shows the script as it is now, and **Approve it as shown** approves exactly that text.

  ![A changed script, not run until it is approved again](../../../artifacts/screens/assistant/08-changed-shown-again.png)

- No assistant can run it. A script an assistant wrote runs only from RigReady's window, after you were asked.
- It runs as you, never as administrator.
- It is never part of a setup you [share](../protect/sharing.md).

More on how scripts run in [Scripts](../setups/scripts.md).

## What it cannot do

It cannot see your API key or any other secret, change the AI or MCP settings, open file dialogs, use your clipboard, answer RigReady's questions for you, save a proposal or a script, or run a script it wrote. It does nothing while you are not using the panel.
