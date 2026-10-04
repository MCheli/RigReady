# Changelog

## 2.0.0 (not released)

A rebuild from the ground up. Nothing from 1.1.0 carries over: not the code, not the data in `~/.rigready`, not the update channel. Version 2.0.0 has not been published; there is no installer to download yet.

### What it contains

**Fly**
- One screen for the setup used last: a grouped checklist, a fix beside every failing item, Make ready, Launch and Stand down.
- Required items make the rig Not ready; optional items only warn.
- Launch is never blocked. Steps can run before and after launch. Stand down closes what RigReady started and returns the monitors to the desk layout.
- Tray icon with the same actions; optional start with Windows.

**Setups**
- Created by capturing the rig as it is now: game, devices, apps, monitor layout, audio devices, game files.
- A full editor, clone, copy items between setups, hand-editable YAML that a broken file cannot take down.

**Checks and fixes**
- Device connected (identical devices told apart), app or service running, monitor layout, default audio device, config file present or containing a value, script, game updated since last verified, device hidden by HidHide.
- Fixes: start an app, apply a monitor layout with a timed revert, set the audio device, restore a file, run a script, show instructions.

**Monitors and audio**
- A to-scale map, named layouts, Identify with numbers and an up arrow on every screen, position, rotation, on/off, main display, resolution and refresh rate.
- Identical USB screens are recognised by the serial number of their USB device.

**DCS World**
- Installs across Steam libraries and standalone; update waiting; aircraft list.
- MFD screen setup written to RigReady's own MonitorSetup file, starting from SimAppPro's plan when there is one.
- Export.lua managed one tool at a time; overwrites by other programs are noticed.
- Bindings: effective bindings (defaults plus your changes) for the F/A-18C and UH-1H, editing with a preview, clean-up of unwanted defaults, device ID repair, copy between aircraft, snapshots.
- Cheat sheets with a picture of every device, print and PDF, DCS kneeboard pages in day and night styles.
- A binding guide for the F/A-18C and UH-1H, and optional AI help with your own Anthropic API key.

**Racing and other games**
- iRacing, Le Mans Ultimate, BeamNG.drive, Assetto Corsa: detection, bindings as the game's files have them, backup and restore.
- Microsoft Flight Simulator 2024, Assetto Corsa EVO, Assetto Corsa Rally: detection, launch, files to back up.
- A Fanatec wheel page; any other game works generically.

**Protecting your configuration**
- One-click backup, a restore wizard with a preview and per-item choices, snapshots, "what changed since it last worked".
- Sharing a setup as a file with a privacy review; imports are validated and never write outside known folders.
- Every change outside RigReady's folder is backed up first, journaled, and can be undone on the Safety page.

**Hardware**
- Devices with your own names, find a device by pressing a button, input tester, hands-off health check, USB map, plug and unplug notifications.
- Stream Deck: inventory, health findings, backup, restore, a guide for a new PC. TrackIR: status and checks.

**The app**
- Per-user installer without administrator rights, updates through GitHub Releases with stable and beta channels, logging with personal details removed, a Diagnostics page.

### Known limitations

**Not yet verified in the real game or on real hardware.** These passed tests on recorded data from one rig. Each has instructions in `docs/requirements/ledger.yaml` under the id shown.
- A binding written by RigReady has not been checked in DCS's own controls screen (BIND-DCS-008).
- MFD displays drawn by DCS from RigReady's monitor setup, with SimAppPro closed, have not been looked at (SAP-001).
- The iRacing device ID repair has not been tried with a wheel whose Windows ID really changed (RACE-IRACING-005).
- Which way is up on sideways-mounted screens cannot be read from Windows; Monitors > Identify asks once.
- Restoring a Stream Deck backup file by file, and closing the Stream Deck app, were only exercised against recorded data.

**By design, for now**
- Many DCS actions (mostly keyboard and view commands) can be shown but not edited; they are marked "bind in DCS".
- WinWing backlight sync, UFC and ICP displays and vibration still need SimAppPro running. `docs/research/winwing-direct-control.md` describes what replacing it would take.
- Tuning values of a Fanatec wheel base live on the base and cannot be read; the Wheel page keeps a hand-entered copy.
- TrackIR's active profile cannot be switched from outside TrackIR.
- The binding guides were written from general knowledge of the aircraft and have not been reviewed by a pilot. Action names are checked against the installed DCS.
- A single backup is built in memory and capped at 2 GB.
- Windows 10 and 11 only.

## 1.1.0 and earlier

The first version of the app (January and February 2026). Superseded; its documents are in `docs/archive/`.
