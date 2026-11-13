---
title: Privacy
description: What leaves the PC when RigReady runs, which is update checks and AI requests you approve, and what personal details are removed from anything you share.
order: 70
---

RigReady is a desktop program that reads your PC and changes files on it. It has no account, no telemetry and no crash reporting. This page lists the only things that leave the PC, and what is taken out of the things you choose to send. What it does on the PC itself, and how updates are checked, is on the [security](security.md) page.

## What leaves the PC

**Update checks.** With automatic checks on, RigReady asks GitHub, where its releases are published, for the newest version a few seconds after it starts and once a day, and downloads a newer version from there. Turn **Check for updates automatically** off in Settings and nothing is asked unless you press **Check now**. See [updates](updates.md).

**AI requests.** Only when you have set up an AI provider, and only when you press **Send** on the preview that shows the complete request first (in the assistant panel you can switch the preview off for one conversation). Requests go to the one host of the provider you chose and nowhere else, with the key in a request header: `api.anthropic.com` for Anthropic (the default), `api.openai.com` for OpenAI, or the address of the OpenAI-compatible service you chose (for example `generativelanguage.googleapis.com` for Google Gemini, `openrouter.ai`, `api.mistral.ai`). The address must be https, except a server on this PC (Ollama, LM Studio), in which case nothing leaves the PC. A redirect to another address is never followed. See [Choose who answers](../ai/providers.md). AI help in the binding guide, which is for DCS aircraft only, sends the aircraft, its actions and what each is bound to now, the product names and the layout of the controllers used in DCS, the guide for the aircraft when there is one (RigReady's, one drafted by AI, or your own) and your question; it never sends file paths, device IDs, serial numbers, the names you gave your devices, your Windows user or PC name, or any other content of your files. The exact list is under [What is sent](../dcs/binding-guide-and-ai.md#what-is-sent). The built-in assistant sends your messages and what each tool it used answered, which can be anything RigReady itself can show you (setups, what is connected and running, where programs are installed, device names, bindings, settings), with the path of your Windows user folder written as `{USER}` and the PC's name as `{PC}`; see [The built-in assistant](../ai/built-in-assistant.md#every-request-is-shown-first). The chosen provider's terms and privacy policy apply to what is sent. **Test** in [Settings](settings.md#ai-assistance) also contacts that host, with one small request, to check the key and the model.

**Links you open.** Some pages link to outside websites, for example a tool's download page or recommended wheel settings. They open in your browser only when you click them.

That is all. Everything else, including every check, every backup and the diagnostics, stays on the PC.

## What you choose to share

Three things are made to leave the PC, each on your decision, and each is cleaned first:

- A **shared setup** (`.rigready`) goes through a privacy review that lists every personal detail found and lets you remove or keep each: user name, PC name, serial numbers, device instance paths, folder paths, audio device IDs. Nothing that runs a program is ever included. See [share a setup](../protect/sharing.md).
- A **picture of a setup** is built from names only and scanned with everything removed. See [a picture of your rig](../protect/rig-picture.md).
- The **diagnostics** report and export have the same details removed before they are copied or written, plus anything that looks like a key or a password masked. See [diagnostics](diagnostics.md).

A [backup](../protect/backups.md) is not cleaned: it is your own copy of your own files, meant for this PC or your next one. Credential files are never put in one.

## What stays private on the PC

- The **log** writes your user folder as `~` and masks keys and passwords, whatever a feature tried to log.
- Each **API key** is encrypted for your Windows account with Windows' data protection and kept in its own file. It is never in the settings file, the log, a backup, a shared setup or a picture, and the Settings page never shows it again.
- **Credential files** (DCS and Steam logins, SimAppPro's account, browser password stores, private keys) are never read into a backup, a snapshot, a shared setup or an import; see [What is never copied](../protect/index.md#what-is-never-copied).
