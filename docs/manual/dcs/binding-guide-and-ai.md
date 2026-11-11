---
title: Binding guide and AI help
description: Binding guides for twenty DCS aircraft, the walkthrough that binds with you, and optional AI help with your own Anthropic key.
order: 110
---

**Configure > Binding guide** explains, for an aircraft you do not know yet, what the important controls do, when you use them and where they belong, and walks you through binding them. Everything on the Walkthrough and Priorities tabs works without any key. AI help is optional and needs your own Anthropic API key.

Choose the aircraft at the top right; each one says **Guide included**, **Guide drafted by AI** or **No guide yet**.

An AI assistant of your own (Claude Desktop, Claude Code, Cursor and others) can also help with bindings through RigReady's MCP server, without an API key in RigReady; see [AI assistants](../ai/index.md).

## The guides

RigReady ships guides for these aircraft:

| Kind | Aircraft |
|---|---|
| Fighters and strike jets | F/A-18C Hornet, F-16C Viper, F-14A/B Tomcat (pilot, and a separate guide for the RIO), F-15E Strike Eagle (pilot, and a separate guide for the WSO) |
| Attack jets | A-10C II Warthog and A-10C (one guide for both), A-10A, Su-25T, Su-25 |
| Flaming Cliffs fighters | F-15C, MiG-29 (A, S and G, one guide), Su-27 and J-11A (one guide), Su-33 |
| Helicopters | Ka-50 III and Ka-50 Black Shark (one guide), UH-1H Huey (pilot) |
| Warbirds and trainers | P-51D Mustang, TF-51D, F-86F Sabre, Christen Eagle II |

An aircraft without a guide, such as a gunner's seat or a module not on this list, says **No guide yet**; with your own key, AI help can draft one (see below).

A guide is a plain data file in RigReady's source (`packs/`, one file per aircraft, for example `FA-18C_hornet.yaml`); anyone can add an aircraft by writing one in the same format. Each item in a guide has a title, what it does, when you use it, a tier (**Must have to fly and fight**, **Should have**, **Nice to have**), where it belongs (**On the stick, throttle or pedals**, **On a panel or button box**, **Fine on the keyboard**), and the DCS actions it stands for, each with a plain-language label. The guide also has a plan per kind of device: what to put on the stick, the throttle, the pedals, the MFD frames, the panels and the keyboard, in order.

The guides were written from general knowledge of the aircraft and of how their switches work in DCS. They have not been reviewed by a pilot and are not affiliated with Eagle Dynamics. What is checked, by a test, is that every action name in a guide exists in DCS's own input files for the aircraft, so a DCS update that renames an action is caught. **Where this guide comes from** at the bottom of the Priorities tab says the same.

The plain labels from the guide are also what the [bindings page](bindings.md) and the [cheat sheets](cheat-sheets.md) show first, with DCS's name beside them.

## Priorities tab

The whole guide at a glance: the summary, each tier with its items and a dot for the state of each (bound on a controller, partly bound, not bound, or not in this version of DCS), how many of the tier are bound, and the plan per device.

## Walkthrough tab

The items in order of importance, one at a time. For the current item you see what it does, when you use it, where it belongs, a tip when there is one, and each of its actions with what it is bound to now (your bindings and DCS defaults, keyboard included; a binding on a device marked as not used in DCS is shown struck through and does not count).

**Bind** on an action starts listening: press the control you want on any controller and the change is staged. An axis action needs an axis and a button action a button or a hat; a press of the wrong kind is refused with a note. Actions RigReady cannot write yet say **Bind in DCS**; see [DCS bindings](bindings.md#actions-marked-bind-in-dcs). **Done, next** and **Skip** move on and are remembered, so the walkthrough carries on where you left it after a restart; **Mark not done** reopens an item.

![Press the control for the current action](../../../artifacts/screens/ai-assist-walkthrough/01-press-the-control.png)

The bar at the bottom lists the staged changes, with what each one would replace and whether two of them use the same control. **Review and write** shows exactly what will be written to DCS's binding files, the same review as on the bindings page, and **Write the change** writes it, backed up first and with Undo on [the Safety page](../protect/safety-page.md). Nothing is written before that.

## AI help

AI help needs an Anthropic API key of your own. Under **Configure > Settings**, the **AI assistance** section takes the key; it is stored encrypted for your Windows account and never written to settings, logs, backups, shared setups or screenshots. Below it, **Test key** makes one free request that only succeeds with a valid key, **Model** chooses between Claude Opus 5.5 and Claude Sonnet 5.5 with their prices per million tokens, and **Exactly what is sent** lists what every request contains. See [Settings](../app/settings.md).

With a key the Binding guide page gets an **AI help** tab, and the walkthrough gets an **Explain** button on each action.

- **Suggest a setup** asks for a binding plan for this aircraft on your controllers.
- **Ask about this setup** takes a question of up to 600 characters, for example "What am I missing for carrier landings?", and answers in plain text.
- **Explain** on an action in the walkthrough asks what it does in the real aircraft and in DCS, when you use it and where it belongs.
- **Draft a guide**, for an aircraft without one, has the model write a guide in the same format from the aircraft's own action list. It is saved under RigReady's folder, marked as drafted by AI wherever it is shown, and every action in it was checked against the aircraft's real action list; nobody checked the advice. **Delete the drafted guide** removes it.

### What is sent

Before each request a dialog shows what will be sent: the model, the size in characters and tokens and the approximate cost of reading it, what is in it, and under **Show the exact request** the request body itself. Sent are the aircraft's name, DCS's list of its actions with what each is bound to now, for each controller used in DCS its product name, role, number of buttons and hats and axis names, RigReady's guide when there is one, and your question. Never sent are file paths, device IDs, serial numbers, the names you gave devices, your Windows user or PC name, or the contents of your files. The key goes only to api.anthropic.com, in a request header. Nothing leaves the PC until you press **Send**. [Privacy](../app/privacy.md) lists everything that ever leaves the PC.

![What will be sent](../../../artifacts/screens/ai-assist-suggest/01-payload.png)

A suggestion or a drafted guide arrives as a stream: the dialog says how far it is and offers **Cancel the request**; nothing of an answer is used before it is complete and has been checked. A refused, cut-off or unreadable answer is reported, and nothing from it is used.

### Nothing is applied without a tick and a review

Every line of a suggested plan is checked against what exists: an action that is not in this aircraft, a controller or input that is not there, an axis action on a button, an action RigReady cannot write, or a line suggested twice is dropped and listed with the reason. The suggestions that remain each have a tick, a priority, the model's reason, and flags: **Already bound exactly like this**, a conflict with what the control does now, or a clash with another suggestion using the same control. **Review N changes** opens the file-change review, and only **Write** writes, backed up first and with Undo. A question's answer is text only and changes nothing.
