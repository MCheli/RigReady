# Changelog

## 2.0.0 (not released)

A rebuild from the ground up. Nothing from 1.1.0 carries over: not the code, not the data in `~/.rigready`, not the update channel. What version 1 left in that folder is not touched: its setup files are listed apart on the Setups page, where they can be deleted. Version 2.0.0 has not been published; there is no installer to download yet.

### What it contains

**Play**
- One screen for the setup used last: a readiness dial, the rig drawn with its monitors and devices so a problem shows as a place, a grouped checklist, and a fix beside every failing item.
- One action, Make ready and launch (or Enter): the fixes run in order as visible steps and the game is launched once everything required is met. Make ready, Launch and Stand down are also there on their own.
- Required items make the rig Not ready; optional items only warn. Launch is never blocked, and nothing is launched past a required problem without asking.
- The session is followed: in progress, then Welcome back with Stand down as the main action, optionally standing down by itself. A history of sessions says what needed fixing most often.
- A compact view that stays on top, a quiet offer to switch when the gear plugged in fits another setup, an optional ready tone.
- One double-click: a desktop shortcut per setup, `RigReady.exe --launch "<setup>"` (also `--make-ready` and `--setup`), a taskbar Jump List, a status badge, progress and three buttons on the taskbar button, an optional global hotkey.
- Tray icon with the same actions; optional start with Windows.

**Setups**
- Created by capturing the rig as it is now: game, devices, apps, monitor layout, audio devices, game files.
- A full editor, clone, copy items between setups, hand-editable YAML that a broken file cannot take down.

**Checks and fixes**
- Device connected (identical devices told apart), app or service running, monitor layout, default audio device, config file present or containing a value, script, game updated since last verified, device hidden by HidHide.
- Fixes: start an app, apply a monitor layout with a timed revert, set the audio device, restore a file, run a script, show instructions.

**Monitors and audio**
- A to-scale map, named layouts, Identify with numbers and an up arrow on every screen, position, rotation, on/off, main display, resolution and refresh rate. Applying a layout shows the map moving from before to after.
- Identical USB screens are recognised by the serial number of their USB device.

**DCS World**
- Installs across Steam libraries and standalone; update waiting; aircraft list.
- MFD screen setup written to RigReady's own MonitorSetup file, starting from SimAppPro's plan when there is one.
- Export.lua managed one tool at a time; overwrites by other programs are noticed.
- Bindings: effective bindings (defaults plus your changes) for the F/A-18C and UH-1H, editing with a preview, clean-up of unwanted defaults, device ID repair, copy between aircraft, snapshots.
- Cheat sheets with a picture of every device, print and PDF, DCS kneeboard pages in day and night styles, and a trainer that names an action and has you press the control.
- A binding guide for the F/A-18C and UH-1H, and optional AI help with your own Anthropic API key.

**Racing and other games**
- iRacing, Le Mans Ultimate, BeamNG.drive, Assetto Corsa: detection, bindings as the game's files have them, cheat sheets, backup and restore.
- Microsoft Flight Simulator 2024, Assetto Corsa EVO, Assetto Corsa Rally: detection, launch, files to back up.
- A Fanatec wheel page; any other game works generically.

**Protecting your configuration**
- One-click backup, a restore wizard with a preview and per-item choices, snapshots, "what changed since it last worked".
- Sharing a setup as a file with a privacy review; imports are validated and never write outside known folders. A picture of the setup to show people, with no personal details in it.
- Every change outside RigReady's folder is backed up first, journaled, and can be undone on the Safety page.

**Hardware**
- Devices with your own names, find a device by pressing a button, an input tester with a live trace per axis and a plot of two axes together, a hands-off health check that shows what it recorded, a USB map drawn as a tree, plug and unplug notifications.
- Stream Deck: inventory, health findings, backup, restore, a guide for a new PC. TrackIR: status and checks.

**The app**
- Per-user installer without administrator rights, updates through GitHub Releases with stable and beta channels, logging with personal details removed, a Diagnostics page.
- A command palette (Ctrl+K) over every page and the common actions, with what an action did reported in a toast; Ctrl+1 and Ctrl+2 for Play and Configure; `?` for the list of keys; an About panel.
- Motion is short and switched off when Windows is asked to reduce it. A page that is still reading shows its outline.

### Known limitations

**Not yet verified in the real game or on real hardware.** These passed tests on recorded data from one rig. Each has instructions in `docs/requirements/ledger.yaml` under the id shown.
- A binding written by RigReady has not been checked in DCS's own controls screen (BIND-DCS-008).
- MFD displays drawn by DCS from RigReady's monitor setup, with SimAppPro closed, have not been looked at (SAP-001).
- The iRacing device ID repair has not been tried with a wheel whose Windows ID really changed (RACE-IRACING-005).
- Which way is up on sideways-mounted screens cannot be read from Windows; Monitors > Identify asks once.
- Restoring a Stream Deck backup file by file, and closing the Stream Deck app, were only exercised against recorded data.
- The taskbar badge, progress bar and thumbnail buttons were accepted by Windows in tests, but nobody has looked at them on a real taskbar; the ready tone's sound and a real press of the global hotkey are untested too.

**By design, for now**
- Many DCS actions (mostly keyboard and view commands) can be shown but not edited; they are marked "bind in DCS".
- WinWing backlight sync, UFC and ICP displays and vibration still need SimAppPro running. `docs/research/winwing-direct-control.md` describes what replacing it would take.
- Tuning values of a Fanatec wheel base live on the base and cannot be read; the Wheel page keeps a hand-entered copy.
- TrackIR's active profile cannot be switched from outside TrackIR.
- The binding guides were written from general knowledge of the aircraft and have not been reviewed by a pilot. Action names are checked against the installed DCS.
- The trainer asks buttons and hats only: no axes, modifier combinations or keyboard.
- A single backup is built in memory and capped at 2 GB.
- Windows 10 and 11 only.

## 1.1.0 and earlier

The first version of the app (January and February 2026). Superseded; its documents are in `docs/archive/`.
