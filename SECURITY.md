# Security

RigReady is a Windows desktop program that reads a PC's hardware and game files, changes those files on request, and starts the game. This page says how to report a problem in it, which versions get fixes, what the program touches, and how a fix reaches an installed copy. The findings of the last review are in `docs/research/security-review-2026-11.md`; the user-facing summary is `docs/manual/app/security.md` (published at rigready.io/docs/app/security/).

## Reporting a vulnerability

Use GitHub's private reporting: the **Security** tab of the repository, **Report a vulnerability**. That makes a private advisory that only the maintainer can read. Do not open a public issue for something that could be used against other users before it is fixed.

Say what you found, which version, and how to reproduce it. A diagnostics report (Configure > Diagnostics > Copy diagnostics) helps; it has personal details removed. You will get an answer within seven days, and a fix for a confirmed problem is published as a security release (below). There is no bug bounty. Credit in the release notes is given when wanted.

## Supported versions

| Version | Fixes |
|---|---|
| The newest 2.x release | Yes |
| Older 2.x releases | No: update to the newest one |
| 1.1.0 and earlier | No. Version 1 does not update itself; install 2.x from rigready.io/download |

## What the program touches

- **Runs as you, never as administrator.** The installer is per user (`%LOCALAPPDATA%\Programs\RigReady`), nothing asks for elevation, and the registry is only read, except the per-user "start with Windows" entry.
- **Writes** go to its own data folder (`%USERPROFILE%\.rigready`) and, on request, to game and tool files under Documents, Saved Games, AppData and the Steam libraries. Every write outside the data folder is backed up first and listed on the Safety page, where it can be undone.
- **Changes HidHide** only when you start a virtual controller with "hide the real controllers": it adds those controllers and its own controller reader through HidHide's command-line tool, records what it added in its data folder first, and takes exactly that away when the virtual controller stops (or at the next start after a crash). It never installs a driver; the virtual controller needs the ViGEmBus driver, which you install yourself.
- **Starts** the game, helper programs and the scripts you put in a setup, always as a program plus an argument list; nothing from a setup is ever part of a command line. An imported setup never carries scripts or launch commands.
- **Leaves the PC:** the update check (GitHub Releases) and, only with your own Anthropic API key and only when you press Send, AI requests to `api.anthropic.com`. Nothing else. No telemetry, no crash reporting.
- **Reads untrusted input** (game Lua files, imported `.rigready` files, backup zips, controller names) through strict parsers with size caps; Lua runs in a sandbox with no file or process access and limits on how long it runs and how much memory it uses. A restore or an import never writes into the Start menu or its Startup folder.

## How findings are handled

Problems found by a review or reported privately are tracked privately until a release that fixes them is published. A fixed problem is then described in the release notes and in the review documents under `docs/research/`. Open problems are not listed here.

## How a fix reaches you

An installed copy checks GitHub for a new version a few seconds after it starts and once a day, downloads it in the background, and installs it when you restart or quit RigReady, never while a game runs. A release whose title or notes start with `[security]` is shown on every screen with the install one click away. The download's SHA-512 is checked against the release feed, and once releases are signed, the installer's Authenticode signature is checked against the publisher name built into the app. `docs/manual/app/updates.md` describes it for users; `docs/RELEASING.md` has the hotfix runbook.

If automatic checks are off, nothing is checked: watch the releases page or press Check now in Settings.
