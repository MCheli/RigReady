---
title: Windows SmartScreen warns about the installer
description: Windows protected your PC can appear the first time the signed installer runs, until it has a reputation: how to check the publisher and get past it.
order: 70
---

When you run the RigReady installer, Windows may show a blue box, "Windows protected your PC", and no Run button. This is Microsoft Defender SmartScreen. It warns about a program that is new to it until enough people have downloaded and run that program, whether it is signed or not.

RigReady's installer is code-signed with the publisher name **Mark Cheli**, through Microsoft's Artifact Signing service. The signature alone does not stop the warning: SmartScreen also wants a reputation, which a new installer earns over time. So for a while after a release the box can still appear, with the publisher's name in it.

## What to do

1. Make sure the file came from the project's own [download page](https://rigready.io/download/) or its [releases page on GitHub](https://github.com/MCheli/rigready/releases), and nowhere else. The release page lists the installer with its size.
2. In the SmartScreen box, choose **More info**. It shows the file's name and its publisher, which must be **Mark Cheli**. If it says "Unknown publisher" or another name, the file is not a RigReady 2 installer from the project: do not run it.
3. Choose **Run anyway**.
4. The installer runs without asking for administrator rights: it installs for your user only, under `%LOCALAPPDATA%\Programs\RigReady`, and never offers "for all users". If you see a Windows prompt for administrator permission, stop: that is not RigReady's installer.

To look at the signature before you run the file: right-click it, **Properties**, **Digital Signatures**. See [verifying the installer](../app/security.md#verifying-the-installer) and [install](../getting-started/install.md).

## Updates

Updates are the same installer run quietly by RigReady itself after you confirmed, or when you quit, and SmartScreen does not ask about them. Before it runs one, RigReady checks the signature: an update that is not signed by Mark Cheli is refused. See [updates](../app/updates.md).
