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
- The installer is not code signed, so Windows SmartScreen warns the first time it runs ("Windows protected your PC"). Choose **More info**, then **Run anyway**. Signing needs a certificate and is a separate decision; until then the warning is expected.

## Updates

RigReady checks for a newer version a few seconds after it starts and once a day, on the stable channel unless you choose the beta channel under **Configure > Settings > Updates**. A newer version downloads in the background and is installed when you press **Restart to install**, or silently when RigReady quits. It is never installed while a game is running. The same page has **Check now** and the switch for automatic checks; with the switch off, nothing is checked, downloaded or installed.

## Where things are

- The app: `%LOCALAPPDATA%\Programs\RigReady`.
- Your data: `%USERPROFILE%\.rigready`, with the setups (`profiles\*.yaml`), `settings.json`, the monitor layouts, the backups, the automatic copies made before each change, the change journal and the log. Set the environment variable `RIGREADY_HOME` to use another folder.
- Uninstalling, from Windows Settings > Apps, asks whether to remove that data too. The default keeps it, and an update never touches it.

If you used RigReady 1.x: version 2 is a rebuild and does not read its setups. What version 1 left in the data folder is not touched; its setup files are listed apart on the Setups page, where they can be deleted.

## Run from source

Until the first release, and whenever you want the development version: Windows 10 or 11 and Node.js 22.12 or newer.

```
git clone https://github.com/MCheli/rigready.git
cd rigready
npm ci
npm run dev:scenario -- flying-all-good
```

The last command runs the app on a recorded rig in a temporary folder; it changes nothing on your PC. To run it on your own rig, run `npm run setup:python` once (the small Python runtime the controller reader needs), then `npm run dev`. The repository's [README](../../../README.md) lists the commands, and the [contributing guide](../../../CONTRIBUTING.md) has the rest.
