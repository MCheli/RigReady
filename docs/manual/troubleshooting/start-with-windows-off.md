---
title: Start with Windows is off
description: RigReady does not start when you sign in although the setting is on, or the setting refuses to turn on: Windows has it switched off in Task Manager.
order: 60
---

**Start with Windows** puts RigReady into the list of programs Windows starts at sign-in, as a per-user entry; RigReady then starts hidden in the tray. Windows keeps a second list, in Task Manager, where any startup program can be switched off. RigReady reads both, so the switch on the Settings page shows what Windows will really do.

## Symptoms

- RigReady does not start when you sign in, and the switch in **Settings > Startup** is off although you turned it on before.
- Turning the switch on is refused: "Windows did not accept the Start with Windows entry. It may be turned off in Task Manager > Startup apps."
- Turning it off is refused: "Windows still lists RigReady as a startup app."
- The setting cannot be read at all, and the page says why under the switch.

## Cause

Windows, or you, or a tune-up tool, disabled RigReady under **Task Manager > Startup apps** (or **Settings > Apps > Startup**). The entry is still there but switched off, and RigReady shows that as off. RigReady does not switch that list back on by itself.

The entry also stops working when RigReady was uninstalled and installed again in another folder, since the entry names the program's full path. The uninstaller removes the entry of the install it removes.

## What to do

1. Open Task Manager (Ctrl+Shift+Esc), **Startup apps**, find RigReady and choose **Enable**.
2. Back in RigReady, turn **Start with Windows** off and on again. The switch now reflects what Windows has.
3. Sign out and in, or restart, to see it start in the tray. Its icon in the tray shows the state of the setup you used last; one click brings the window out.

RigReady starts hidden when it starts this way; a double-click on its tray icon opens the window. See [the hotkey](../one-click/hotkey.md) and [play](../play/index.md) for what else is there before the window opens.
