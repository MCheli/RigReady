---
title: Security
description: What RigReady writes and where, why it needs no administrator rights, what leaves the PC, how updates are checked, and how to verify an installer.
order: 75
---

RigReady reads your PC and changes files on it, so it is fair to ask what it does to be safe. This page answers that in plain terms. The checks behind each statement are in the repository (`docs/research/security-review-2026-11.md`), and `SECURITY.md` there says how to report a problem.

## It runs as you, not as administrator

RigReady installs for your Windows user only, under `%LOCALAPPDATA%\Programs\RigReady`, and never asks for elevation: no UAC prompt at install, at start, for a fix, or for an update. Everything it does, it does with your rights and nothing more. It reads the Windows registry and never writes to it, with one exception: the per-user "start with Windows" entry, when you switch that on.

## What it writes, and where

- **Its own folder**, `%USERPROFILE%\.rigready`: setups, settings, backups, the log. See [the data folder](index.md).
- **Game and tool files**, only when you ask: under Documents, Saved Games, AppData and the Steam libraries. Every such write is backed up first and listed on the [Safety page](../protect/safety-page.md), where it can be undone. A file RigReady did not write is never deleted.
- **The desktop**, when you make a shortcut for a setup.

Nothing under Program Files is changed. A setup you import, or a backup you restore, can only write to those same folders, whatever the file says, and a zip that tries to reach outside them is refused. Neither ever writes into the Start menu or its Startup folder, where Windows would open a file by itself at the next sign-in.

## What it starts

The game, the helper programs you chose, and the scripts you put in a setup. Each is started as a program with a list of arguments, never as a command line, so a name or a path in a setup cannot become a command. A script runs as you and only when you asked for it: a fix that runs a script shows the exact program and arguments first. A shared setup never carries scripts or launch commands; they are removed when it is made and again when it is imported, and the list of what was removed is shown.

A small Python program that ships inside RigReady reads live controller input through Windows' DirectInput. It uses only Python's standard library and opens no network connection.

## What it closes

**Stand down** asks each helper app to close the way its window's close button would, and waits up to ten seconds. It does not force a program to quit unless the setup says it may; a program that is still running is reported, not killed. Closing TrackIR at stand down, when you switch that on, stops it after the wait if it has not closed by then. A restore that would write files a running game or tool owns stops and says so, and closes the program only when you let it.

## What it reads from Windows

Devices, monitors, audio devices and running programs through Windows' own interfaces. From the registry: where Steam is, the list of installed programs (to find games and tools), the names and calibration Windows keeps for each game controller, where TrackIR's game interface is, and the Fanatec driver settings a backup records. None of these is changed.

## What leaves the PC

Two things, and nothing else:

- The **update check**: a request to GitHub, where the releases are, a few seconds after start and once a day. Off when automatic checks are off.
- **AI requests**, only with your own Anthropic API key and only when you press Send on the preview that shows the complete request.

No telemetry, no crash reporting, no account. [Privacy](privacy.md) lists exactly what the AI requests contain and what the diagnostics report removes.

## What it reads from games and files

Game files (DCS Lua, iRacing and other games' settings), imported `.rigready` files and backups are treated as untrusted. Lua that is data is read by a strict parser that refuses anything that is a program; the few Lua files that are programs (DCS input defaults, MonitorSetup) run in a sandbox with no file, process or network access and limits on how long they may run and how much memory they may use (256 MB; a file that needs more is not read). Imported files and backups are checked for size, for links, for paths that point outside the target folder, for YAML that would multiply itself into millions of values, and for anything that runs, before a byte is written.

## Updates are checked before they are installed

A new version comes from the project's GitHub releases and nowhere else. The download's checksum is compared with the release feed, and a file that does not match is thrown away. Once releases are signed, the installer's signature is checked against the publisher's name built into the app, and anything unsigned or signed by someone else is refused. An update is installed only when you restart RigReady or quit it, never while a game is running. A release that fixes a security problem is announced on every screen with the install one click away. See [updates](updates.md).

## Verifying the installer

On Windows, right-click `RigReady-Setup-<version>.exe`, **Properties**, **Digital Signatures**. A release from before signing has no signature; the download page and the release notes say when the first signed release is out, and under which name. Every release also carries `latest.yml` with the installer's SHA-512, which PowerShell can compare:

```
$sha = [Security.Cryptography.SHA512]::Create()
$stream = [IO.File]::OpenRead("RigReady-Setup-<version>.exe")
[Convert]::ToBase64String($sha.ComputeHash($stream)); $stream.Dispose()
```

The string printed must equal the `sha512:` line of `latest.yml` from the same release. An installer from anywhere but GitHub Releases or rigready.io is not one of ours.

## Reporting a problem

A security problem is reported privately through the repository's Security tab, as `SECURITY.md` describes. Anything else goes to the issues page, with a diagnostics report; see [troubleshooting](../troubleshooting/index.md).
