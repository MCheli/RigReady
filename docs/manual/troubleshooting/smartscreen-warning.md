---
title: Windows SmartScreen warns about the installer
description: Windows protected your PC appears when the installer runs because the installer is not code-signed; here is how to get past it and how to be sure of the file.
order: 70
---

When you run the RigReady installer, Windows may show a blue box, "Windows protected your PC", and no Run button. This is SmartScreen, and it says only one thing: the file is not signed with a certificate Windows knows.

RigReady's installer is not code-signed yet. Signing needs a certificate and is a separate decision; until it is made, SmartScreen warns on first run.

## What to do

1. Make sure the file came from the project's own [download page](https://rigready.io/download/) or its [releases page on GitHub](https://github.com/MCheli/rigready/releases), and nowhere else. The release page lists the installer with its size.
2. In the SmartScreen box, choose **More info**, then **Run anyway**.
3. The installer runs without asking for administrator rights: it installs for your user only, under `%LOCALAPPDATA%\Programs\RigReady`, and never offers "for all users". If you see a Windows prompt for administrator permission, stop: that is not RigReady's installer.

See [install](../getting-started/install.md).

## Updates

Updates are the same installer run quietly by RigReady itself after you confirmed, or when you quit. See [updates](../app/updates.md).
