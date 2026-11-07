---
title: Uninstall
description: Remove RigReady from Windows Settings; it asks whether to remove your data too and keeps it by default, and it never touches your game files.
order: 80
---

RigReady is installed for your user only, under `%LOCALAPPDATA%\Programs\RigReady`, and is removed the way any Windows program is. The uninstaller asks one question: whether to remove your data as well. It never asks for administrator rights.

Your game files, bindings and settings are yours and are not touched by an uninstall, whatever you answer.

## From Windows Settings

1. Quit RigReady from the tray icon's menu.
2. Open Windows Settings, **Apps**, **Installed apps**, find RigReady and choose **Uninstall**.
3. The uninstaller removes the program, its Start menu and desktop shortcuts, the desktop shortcuts of your setups (every "<setup> - RigReady" on the desktop, which only start RigReady), its **Start with Windows** entry, and the copy of the installer that was kept for updates.
4. It then asks: "Also remove your RigReady data? Your setups, backups, settings and logs are in: <folder>. Choose No to keep them, for example to install RigReady again later." **No** is the default.

With **No**, the data folder stays where it is, and installing RigReady again later finds everything as it was. With **Yes**, the folder is removed, and with it your setups, every backup you made and the automatic copies, the snapshots, the change journal, the log and the stored API key. Export the backups you want to keep somewhere else first.

Only a folder that RigReady itself has used, one that has RigReady's log in it, is ever removed.

## Silent uninstall

For a script or a deployment tool, from the install folder:

- `"Uninstall RigReady.exe" /S` removes the program and keeps the data.
- `"Uninstall RigReady.exe" /S --remove-data` removes the data too.

## What stays

- Your data folder, when you chose to keep it.
- Backups you exported elsewhere and `.rigready` files you saved.
- Everything RigReady wrote for a game on your request, such as `RigReady.lua` in DCS's monitor setups, kneeboard pages, lines in `Export.lua` and restored bindings. Undo them on the [Safety page](../protect/safety-page.md) before uninstalling if you do not want them.
- A setup shortcut you renamed so that its name no longer ends in " - RigReady". The uninstaller knows the shortcuts by that ending; delete a renamed one by hand.
- HidHide, SimAppPro, Stream Deck and the other tools: RigReady never installed or changed them.
