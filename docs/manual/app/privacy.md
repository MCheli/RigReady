---
title: Privacy
description: What leaves the PC when RigReady runs, which is update checks and AI requests you approve, and what personal details are removed from anything you share.
order: 70
---

RigReady is a desktop program that reads your PC and changes files on it. It has no account, no telemetry and no crash reporting. This page lists the only things that leave the PC, and what is taken out of the things you choose to send.

## What leaves the PC

**Update checks.** With automatic checks on, RigReady asks GitHub, where its releases are published, for the newest version a few seconds after it starts and once a day, and downloads a newer version from there. Turn **Check for updates automatically** off in Settings and nothing is asked unless you press **Check now**. See [updates](updates.md).

**AI requests.** Only when you have stored an Anthropic API key, and only when you press **Send** on the preview that shows the complete request first. Requests go to `api.anthropic.com` and nowhere else, with the key in a request header. What is sent: the aircraft's name and DCS's list of its actions with what each is bound to now; for each controller used in DCS, its product name as DirectInput reports it, what it is used as, its number of buttons and hats and the names of its axes; RigReady's guide for the aircraft when there is one; and your question. Never sent: file paths, device IDs, serial numbers, the names you gave your devices, your Windows user or PC name, or the contents of your files. Anthropic's terms and privacy policy apply to what is sent. **Test key** in Settings also contacts Anthropic, to ask whether the key works.

**Links you open.** Some pages link to outside websites, for example a tool's download page or recommended wheel settings. They open in your browser only when you click them.

That is all. Everything else, including every check, every backup and the diagnostics, stays on the PC.

## What you choose to share

Three things are made to leave the PC, each on your decision, and each is cleaned first:

- A **shared setup** (`.rigready`) goes through a privacy review that lists every personal detail found and lets you remove or keep each: user name, PC name, serial numbers, device instance paths, folder paths, audio device ids. Nothing that runs a program is ever included. See [share a setup](../protect/sharing.md).
- A **picture of a setup** is built from names only and scanned with everything removed. See [a picture of your rig](../protect/rig-picture.md).
- The **diagnostics** report and export have the same details removed before they are copied or written, plus anything that looks like a key or a password masked. See [diagnostics](diagnostics.md).

A **backup** is not cleaned: it is your own copy of your own files, meant for this PC or your next one. Credential files are never put in one.

## What stays private on the PC

- The **log** writes your user folder as `~` and masks keys and passwords, whatever a feature tried to log.
- The **API key** is encrypted for your Windows account with Windows' data protection and kept in its own file. It is never in the settings file, the log, a backup, a shared setup or a picture, and the Settings page never shows it again.
- **Credential files** (DCS and Steam logins, SimAppPro's account, browser password stores, private keys) are never read into a backup, a snapshot, a shared setup or an import.
