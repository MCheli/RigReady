---
title: Install RigReady
description: The per-user installer, the SmartScreen warning, where RigReady puts itself and your data, how it updates, and running it from source instead.
order: 10
---

RigReady runs on Windows 10 and 11, 64-bit. Nothing else needs to be installed.

## The installer

The [download page](https://rigready.io/download/) has the current installer, `RigReady-Setup-<version>.exe`, with its size and release date; every version is also on [GitHub Releases](https://github.com/MCheli/rigready/releases). Until the first 2.x release is published, the page says so and shows how to run from source instead (below).

Run the installer by double-clicking it.

- It installs for your account only, under `%LOCALAPPDATA%\Programs\RigReady` unless you choose another folder. It never asks for administrator rights and never offers to install for all users.
- It makes a Start menu entry and a desktop shortcut, and offers to start RigReady when it finishes.
- The installer is code-signed with the publisher name Mark Cheli. Until it has earned a reputation with Microsoft, Windows SmartScreen may still warn the first time it runs ("Windows protected your PC"): choose **More info**, check that the publisher is Mark Cheli, then **Run anyway**. See [Windows SmartScreen warns about the installer](../troubleshooting/smartscreen-warning.md).

## Updates

RigReady checks for a newer version when it starts and once a day, downloads it in the background, and installs it when you press **Restart to install** or when you quit, never while a game is running. The channel, the switch for automatic checks and **Check now** are under **Configure > Settings > Updates**. See [Updates](../app/updates.md).

## Where things are

- The app: `%LOCALAPPDATA%\Programs\RigReady`.
- Your data: `~/.rigready`, the folder `.rigready` in your Windows user folder (`C:\Users\<you>\.rigready`): the setups, the settings, the monitor layouts, the backups, the automatic copies made before each change, the change journal and the log. [The app and its data folder](../app/index.md) lists what is in it and how to move it with `RIGREADY_HOME`.
- [Uninstalling](../app/uninstall.md), from Windows Settings > Apps, asks whether to remove that data too and keeps it by default. An update never touches it.

If you used RigReady 1: version 2 is a rebuild and does not read its setups as they are. The old files are left where they are and listed apart on the Setups page under **From RigReady 1**, where RigReady can bring a setup over or say why it cannot, and where they can be deleted; see [Files from RigReady 1](../setups/yaml.md#files-from-rigready-1).

## Run from source

Until the first release, and whenever you want the development version: Windows 10 or 11 and Node.js 22.12 or newer.

```
git clone https://github.com/MCheli/rigready.git
cd rigready
npm ci
npm run dev:scenario -- flying-all-good
```

The last command runs the app on a recorded rig in a temporary folder; it changes nothing on your PC. To run it on your own rig, run `npm run setup:python` once (the small Python runtime the controller reader needs), then `npm run dev`. The repository's [README](../../../README.md) lists the commands, and the [contributing guide](../../../CONTRIBUTING.md) has the rest.
