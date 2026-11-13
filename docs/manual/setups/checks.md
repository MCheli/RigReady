---
title: Checks and fixes
description: "Every kind of check a setup can hold, by group: what it looks at, its fields, and the fix Make ready can run for it. Also the fix types on their own."
order: 30
---

A setup's checklist is made of checks. Each check has a type, its fields ("What to check" in the editor), and usually a fix: what Make ready does when the check is not met. This page lists every type this version of RigReady has, in the groups the [Play screen](../play/index.md) shows them in. The name in brackets is what the YAML file uses.

A check that is not met is red when required and yellow when optional. A check that could not be run at all (a timeout, a folder that does not exist on this PC, a type this version does not know) is shown with an "error" chip and counts as not met when required. Every check has a timeout: the limit in [Settings](../app/settings.md#safety-and-limits) (5 seconds by default) or the item's own **Timeout (seconds)** in [the setup editor](editor.md).

## Devices connected

### Device connected (`device.connected`)

A USB device is present. It is known by its vendor and product ID, never by its name; with identical devices a serial number or the USB port tells them apart. Fields: `vendorId` and `productId` (four hex digits each), `serial`, `instanceId` (the USB port; moving the device breaks the check), `count` (how many must be present). No fix: plug it in. When [HidHide](../hardware/devices.md#hidhide) hides the device from the game the check fails with "Hidden by HidHide" and says what to change in HidHide; RigReady does not change HidHide settings. The row has **Diagnose**, which opens the Devices page ([A device is not found](../troubleshooting/device-not-found.md)).

### Wheel base connected in the right mode (`racing.wheelBase`)

A wheel base is connected and, where its USB ID shows the mode, in PC mode ([Wheel](../games/wheel.md)); any brand RigReady knows. Fields: `vendorId` (0EB7 unless said otherwise), `productId`. It says when a Fanatec base is in compatibility (yellow) mode, when a Logitech G29 is in its PS3 position, when a Thrustmaster wheel has not been switched by its driver or a T300 is in PS4 or advanced mode, when games cannot see the base, when it hangs off a hub, and when a different base is connected. No fix. Tested on a real wheel for Fanatec only.

### Wheel rotation as expected (`racing.wheelRotation`)

Optional. The rotation the Fanatec driver last recorded is the one expected. Fields: `brand` (only `fanatec` can be read), `degrees`. No fix: set the rotation on the base.

### Stream Deck connected (`stream-deck.connected`)

A Stream Deck is plugged in ([Stream Deck](../hardware/stream-deck.md)). Field: `serial`, for one particular deck when the rig has several. No fix.

### TrackIR camera connected (`trackir.connected`)

The TrackIR camera is plugged in ([TrackIR](../hardware/trackir.md)). No fields, no fix.

## Apps and services

### App running (`process.running`)

A program is running, by its image name ("TrackIR5.exe", compared without regard to case). Fields: `name`; `path`, when the running program must also be this executable (path variables allowed) and not a copy from elsewhere; `stopOnStandDown`: true closes it at [Stand down](../play/stand-down.md) always, false never, unset only when RigReady started it this session; `forceClose`: terminate it when it has not closed ten seconds after being asked. Fix: **Start the app** (`process.launch`).

### Windows service running (`service.running`)

A Windows service is running, by its short name ("HidHide", "Audiosrv"). Field: `name`. Starting a service needs administrator rights, so there is no automatic fix; the fix can be instructions or a script of your own.

### TrackIR running (`trackir.running`)

The TrackIR software is running, wherever it is installed. It also notes when TrackIR runs but games cannot see it. Field: `closeOnStandDown`. Fix: **Start TrackIR** (`trackir.start`). On Stand down TrackIR is asked to close and ended if it has not closed after ten seconds; when it is still running after that, the line says why.

### Stream Deck app running (`stream-deck.running`)

The Stream Deck app is running. Fields: `closeOnStandDown`, `forceClose` (**Force it closed if it does not close**, off by default: the Stream Deck window only goes to the tray when asked, and [Stand down](../play/stand-down.md#an-app-that-is-still-running) then names it as still running). Fix: **Start Stream Deck** (`stream-deck.start`). When the app is not installed the row says so.

### SimAppPro running (`dcs.simAppProRunning`)

WinWing's [SimAppPro](../dcs/simapppro.md) is running, for the features that still need it (backlight sync, UFC and ICP displays, vibration). Field: `features`, the list of those features; the row says what SimAppPro is needed for. Fix: **Start SimAppPro** (`dcs.startSimAppPro`).

### iRacing helper service running (`racing.iracingService`)

The "iRacing.com Helper Service" Windows service is running ([iRacing](../games/iracing.md)). No fields; no fix, since starting it needs administrator rights.

## Monitors

### Monitor layout (`display.layout`)

The monitors are arranged as the setup expects: which are on, where they are, their size, their rotation and which is the main display. Fields: `displays`, the arrangement as it was captured; `layoutId` and `layoutName`, a layout saved on the Monitors page ([Monitor layouts](../monitors-and-audio/layouts.md)). In [the setup editor](editor.md) you choose the saved layout by name from the **Layout** list, which fills in all three, and the fix uses the same layout without asking again. When a saved layout is named it is what counts, so changing "Flying" on the Monitors page changes every setup that uses it; the copy in the setup is used only when the saved layout has been deleted. Fix: **Apply the monitor layout** (`display.applyLayout`), which changes the screens, asks **Keep this monitor layout?** the first time the layout is used on this PC ([When RigReady asks, and when it does not](../monitors-and-audio/layouts.md#when-rigready-asks-and-when-it-does-not)) and reads the result back. At Stand down the earlier layout is put back, unless a desk layout is chosen.

### DCS monitor setup fits the monitors (`dcs.monitorSetup`)

DCS's options.lua selects the expected monitor setup, and DCS's window matches what the setup's monitors span. Fields: `setup`, the monitor setup's name; `window`, its width and height. Fix: **Write the RigReady screen setup** (`dcs.writeScreenSetup`), which writes RigReady's own monitor setup file and selects it ([MFD screens and the monitor setup](../dcs/screens.md)). When the difference comes from **Use in DCS** on the DCS Screens tab, the row says so, and its button **Update the setup** makes the check expect the new values ([Setups made before "Use in DCS"](../dcs/screens.md#setups-made-before-use-in-dcs)).

## Audio

### Default audio device (`audio.defaultDevice`)

A device is Windows' default. Fields: `flow`, playback or recording; `id`, the Windows endpoint ID; `name`, used when the id is no longer found; `role`: `default` (the device Windows uses for everything), `communications` (the one voice chat apps use), or `both`. Fix: **Set the default audio device** (`audio.setDefault`); see [Audio](../monitors-and-audio/audio.md). Stand down puts the earlier default back when the fix changed it and you have not changed it since.

## Config files

### Config file or folder present (`file.exists`)

A file or folder exists. Fields: `path` (with a [path variable](path-variables.md), or absolute); `kind`, file or folder; `pattern`, for a folder: at least one file below it must match, for example `*.diff.lua`. Fixes: **Restore from a backup**, **Show instructions**, **Run a script**.

### Config file content (`file.content`)

A file says what it should. Fields: `path`; `rule`: `contains` (the text appears), `regex` (the pattern matches), or `equals` (the value at `keyPath` is `value`); `value`; `keyPath`, for equals: `options.graphics.multiMonitorSetup` in a Lua file, `Section.key` in an INI file, `a.b.0.c` in a JSON file; `format`: auto (by the file's extension: .lua, .ini and .cfg, .json), lua, ini or json. The same fixes as above.

### Export.lua loads the tools this setup needs (`dcs.exportLua`)

DCS's [Export.lua](../dcs/export-lua.md) has the line for each tool the setup needs (WinWing, DCS-BIOS, SRS, Tacview, DCS-ExportScript, Helios). Field: `tools`. Fix: **Put back the missing Export.lua lines** (`dcs.repairExportLua`), which adds only what is missing.

### DCS graphics options (`dcs.options`)

Options in DCS's options.lua are as expected ([Checks in a setup](../dcs/screens.md#checks-in-a-setup)). Fields, each optional but at least one: `multiMonitorSetup`, `width`, `height`, `fullScreen`, `vr`. Fix: **Set the DCS options** (`dcs.setOptions`). DCS must be closed for the fix to write. When the difference comes from **Use in DCS**, the row says so, and **Update the setup** makes the check and its fix expect the new values. A fix that would undo the RigReady screen setup in use (a window that no longer covers its monitors, another monitor setup, full screen) says so on the row, and Make ready asks before it runs it ([Setups made before "Use in DCS"](../dcs/screens.md#setups-made-before-use-in-dcs)).

### DCS files RigReady manages are unchanged (`dcs.managedFiles`)

The DCS files RigReady wrote (its monitor setup, its Export.lua lines, its options) are as it left them. The row names what changed outside RigReady and notes when SimAppPro is the likely cause ([The DCS files RigReady manages](../dcs/simapppro.md#the-dcs-files-rigready-manages)). No fields. Fix: **Restore RigReady's version** (`dcs.restoreManaged`).

### DCS bindings match the connected devices (`dcs-bindings.deviceIds`)

The aircraft's binding files belong to the device IDs Windows has now, and the connected devices have bindings of your own for it. Fields: `aircraft` (DCS's folder name, `FA-18C_hornet`), `aircraftName`. Fix: **Review device ID changes** (`dcs-bindings.openMigration`), which opens Bindings > Device IDs ([Device IDs changed](../dcs/device-ids.md)) with a preview; nothing is moved until you apply it there, so Make ready lists it under Needs you ([Make ready and launch](../play/make-ready-and-launch.md)).

### iRacing knows the connected controllers (`racing.iracingDevices`)

The controllers in iRacing's own files are connected, and none has a new Windows ID. No fields, no fix; the row points to Configure > Games > Racing > iRacing ([Repair: a wheel with a new Windows ID](../games/iracing.md#repair-a-wheel-with-a-new-windows-id)).

### Racing bindings are the saved set (`racing.bindingSet`)

A racing game's binding files are the ones saved in a named backup ([Use in a setup](../games/iracing.md#backups)). Fields: `game` (iracing, lmu, beamng, assetto-corsa), `backupId`, `name`. Fix: **Restore the saved racing bindings** (`racing.restoreBindingSet`).

### Cheat sheet kneeboard pages are up to date (`cheat-sheets.kneeboardCurrent`)

The [kneeboard pages](../dcs/kneeboard.md) RigReady wrote for an aircraft match its bindings now. Fields: `game`, `aircraft`, `aircraftName`. Fix: **Write the kneeboard pages again** (`cheat-sheets.regenerate`).

## Other

### Script succeeds (`script.check`)

A script or program of yours runs and exits with a success code. Fields: `exe`, `args`, `cwd`, `successExitCodes` (0 by default), `timeoutSeconds` (10 by default, up to 600). Its output is kept with the row. Fixes: **Run a script**, **Show instructions**. See [Scripts](scripts.md).

### Game updated since you last verified (`game.updated`)

The installed version of a game is the one you last confirmed works. Fields: `game`, `verifiedVersion`. It only ever warns, whatever the setup says, and notes when an update is waiting to be installed. Its own button, **Mark verified**, records the version installed now. Fix: **Back up the game's settings and bindings** (`backup.gameFiles`), which makes a backup and leaves the warning until you mark the version verified ([A backup before a game update](../protect/backups.md#a-backup-before-a-game-update)).

### DCS World installed (`dcs.install`)

The DCS install this setup was made for is still there ([Installs and aircraft](../dcs/installs.md)). Field: `installDir`. No fix.

### In-game wheel settings as recommended (`racing.wheelSettings`)

The wheel settings RigReady can read in a racing game's files match the presets recorded on the [Wheel page](../games/wheel.md#recommended-settings). Field: `game` (lmu or beamng). No fix.

## The fixes on their own

Every fix type that does something can also be a step before launch, after launch or at Stand down ([Launch targets and steps](launch.md)). Make ready runs fixes by group (monitors, audio, files, devices, apps, scripts) and, within a group, by kind, then in the order of the setup.

- **Start the app** (`process.launch`): `exe`, `args`, `cwd`, `waitFor` (the image name to wait for when a launcher starts a differently named program), `timeoutMs` (how long to wait for it to appear, 10 seconds by default).
- **Run a script** (`script.run`): see [Scripts](scripts.md). Shown to you before it runs, unless the script says otherwise.
- **Show instructions** (`instructions.show`): `text`, in a small Markdown subset (paragraphs, lists, numbered steps, bold, code, links). Make ready never runs it; the item is listed under Needs you with the text.
- **Restore from a backup** (`file.restore`): `path`. Puts back the newest copy RigReady has: a known-good copy you saved with **Keep a copy of the file as it is now** in the editor, or the automatic copy made before the file was last changed ([The Safety page](../protect/safety-page.md)). The file as it is now is backed up first, and the restore is read back before it is reported. Without any copy, the row says "No backup of this file yet" and offers no fix.
- **Apply the monitor layout**, **Set the default audio device**, **Start TrackIR**, **Start Stream Deck**, **Start SimAppPro**, **Write the RigReady screen setup**, **Put back the missing Export.lua lines**, **Set the DCS options**, **Restore RigReady's version**, **Restore the saved racing bindings** and **Write the kneeboard pages again**: as described with their checks.
- **Review device ID changes** and **Back up the game's settings and bindings** open a screen or do their work without making the check pass; Make ready leaves them to you.

A check or fix type this version of RigReady does not have (a setup written by a newer RigReady) is kept in the file and shown on the row as not available.
