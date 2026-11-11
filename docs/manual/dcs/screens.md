---
title: MFD screens and the monitor setup
description: Put the main view and the cockpit displays on your monitors: RigReady.lua, options.lua, bezel crops, SimAppPro's plan as a start, and what to check in DCS.
order: 20
---

DCS can draw the cockpit displays of some aircraft, the DDIs and the AMPCD of the F/A-18C for example, on separate screens. Which screen each display lands on is set in a monitor setup file. The **Screens** tab of **Configure > DCS World** makes that file from your monitor layout, so you need neither SimAppPro nor a text editor for it.

## How DCS does it

A monitor setup is a Lua file in `Config\MonitorSetup`, either in the DCS install folder or under `Saved Games\DCS`. It names a rectangle for the main 3D view and one for each exported display, in pixels counted from the top left corner of the DCS window. DCS opens its window at the top left of the main Windows display with the size from options.lua, and the `graphics.multiMonitorSetup` key in options.lua says which file to use.

RigReady writes its own file, `Saved Games\DCS\Config\MonitorSetup\RigReady.lua`, and sets options.lua to use it. It never edits a monitor setup file it did not write, so a file made by SimAppPro or by hand stays as it is.

## Starting from SimAppPro's plan

When SimAppPro has an MFD plan on this PC, RigReady reads it, and only it (SimAppPro's settings file, which holds your WinWing account password, is never read), and starts from it: which screens the displays were on and how the bezels were cropped. The first time the tab opens without a saved setup it imports the plan into the first monitor layout that has all of its screens, and says so. **Import from SimAppPro** does the same later, into the layout chosen at the top. Screens the plan uses that are not in the chosen layout are listed, so you can pick the layout you fly with.

![A setup imported from SimAppPro's plan](../../../artifacts/screens/dcs-setup-screens/01-imported.png)

## Building the setup

- **Monitor layout the coordinates are for**: the monitors as they are now, the layout of any setup, any saved layout from [Monitors](../monitors-and-audio/layouts.md), or the layout saved with this screen setup. The coordinates only fit one arrangement, so choose the one you fly with.
- **Main view on**: tick one or more monitors. The 3D view spans them.
- **Aircraft**: one chip per aircraft. **+ Aircraft** lists every aircraft installed in DCS that can draw a display on another screen, with the displays it can export. RigReady reads them from each module's own cockpit scripts (the names a display asks the monitor setup for, such as `LEFT_MFCD`, `EHSI`, `F14_TID` or the Ka-50's `ABRIS` and `Shkval`), so a module you install later appears on its own. The scripts are only read, never run. An aircraft without exportable displays, such as the UH-1H, is not listed and uses the main view only. If a module's scripts cannot be read, RigReady falls back to what it knows of the F/A-18C, F-16C, A-10C and A-10C II, F-15E, F-14 and Ka-50, and adds whatever SimAppPro's plan knows about installed aircraft.
- A new setup starts on the aircraft of the setup you used last, when its name says which one (a setup called "DCS F-16C" starts on the Viper), and otherwise on the first aircraft in the list. A saved setup or SimAppPro's plan starts with the aircraft it already has.
- For each display, choose the monitor or **Not shown**, then set the **Crop** in pixels from the left, top, right and bottom edges to leave out the bezel. On the map you can also drag a display onto a screen and drag its edges.
- The dashed outline on the map is the DCS window: the box around every monitor the setup uses. Its size is what options.lua must say.

When two aircraft put the same display in different places, RigReady writes a per-aircraft section that DCS applies when that cockpit loads.

The page refuses to write a setup with a problem (a display placed twice, a monitor that is not in the layout, a crop that leaves almost nothing) and warns about things that work but are worth knowing: a display drawn over the main view, or monitors that do not start at the top left of the main Windows display.

![Every installed aircraft that can export a display](../../../artifacts/screens/dcs-setup-module-displays/02-installed-aircraft.png)

![The F-15E's six displays, one placed on an MFD screen](../../../artifacts/screens/dcs-setup-module-displays/03-f-15e-placed.png)

![Cropping a bezel](../../../artifacts/screens/dcs-setup-screens/05-cropped.png)

## Writing it

**What "Use in DCS" will do** lists the change before it happens: create, update or keep RigReady.lua, and which options.lua keys change (the monitor setup, and with **Also size the DCS window to W × H, windowed** ticked, the width, height, aspect ratio and full screen off). **Show the file** shows the Lua that will be written. **Use in DCS** writes both files as one change, reads them back, and reports that DCS will use the setup the next time it starts. The button reads **In use** when nothing needs changing.

If RigReady.lua was changed outside RigReady since it last wrote it, writing shows the differences first and asks whether to keep their version or replace it. The file is backed up either way and can be put back from **Configure > Safety** ([The Safety page](../protect/safety-page.md)).

## The files DCS can choose

**Monitor setups DCS can choose** lists every file in both folders with its name, who made it as far as RigReady can tell (RigReady, SimAppPro, DCS or hand-made), the displays it exports, and **in use** on the one options.lua selects. **Show on map** draws a file's rectangles on the current monitors; a rectangle that lies off the monitors is marked.

## Checks in a setup

A DCS setup can carry three checks about this; capturing a setup offers them. See [checks](../setups/checks.md).

- **DCS monitor setup fits the monitors**: every rectangle of the selected file lies on the monitors as they are arranged now, the DCS window in options.lua is large enough, and the monitors the saved screen setup uses are where it was made for them. A USB screen is recognised by its serial number, so moving it to another port is not a change. The fix, **Write the RigReady screen setup**, writes the saved setup again.
- **DCS graphics options**: the width, height, full screen and VR keys as they were when the setup was captured, with the fix **Set the DCS options**.
- **DCS files RigReady manages are unchanged**: see [SimAppPro](simapppro.md).

## What to check in DCS

The displays drawn by DCS from RigReady's monitor setup, with SimAppPro closed, have not yet been verified in the real game: they passed their tests on recorded data from one rig. The [changelog](../../../CHANGELOG.md) lists this under known limitations. The first time, with the MFD screens connected:

1. Close SimAppPro (its tray icon, then Exit) and keep it closed, because its MFD wizard rewrites options.lua.
2. Under **Configure > Monitors**, apply the flying layout and keep it. Use **Identify** ([Identify and which way is up](../monitors-and-audio/identify.md)) to tell identical USB screens apart and to say which way is up on a sideways screen.
3. On the Screens tab, choose that layout, place the displays, and use the setup in DCS.
4. Start DCS and a mission with the aircraft powered. Each display should appear on its own screen, upright and not cut off.

If a display is on the wrong screen, upside down or missing, come back to the tab: swap the monitor in the display's dropdown, adjust the crop, or choose another layout. Nothing in DCS needs to be edited by hand.
