---
title: DCS World
description: What RigReady does for DCS World, the Configure > DCS World page and its tabs, the files it manages under Saved Games, and the rule that DCS must be closed.
order: 60
---

RigReady is a Windows app that checks a sim rig is ready, fixes what is not, and launches the game. For DCS World it goes further than for any other game: it reads DCS's own files, shows what they say in plain language, and writes them for you when you ask it to. This section covers everything RigReady does with DCS.

Pages in this section:

- [Installs and aircraft](installs.md): how RigReady finds the Steam and standalone editions, a waiting update, and the aircraft you have.
- [MFD screens and the monitor setup](screens.md): putting the main view and the cockpit displays on your monitors.
- [Export.lua](export-lua.md): the lines that load WinWing, DCS-BIOS, SRS and the other tools.
- [Bindings](bindings.md), [Binding problems](binding-problems.md), [Device IDs changed](device-ids.md) and [Copy between aircraft and snapshots](copy-and-snapshots.md): the DCS bindings page.
- [Cheat sheets](cheat-sheets.md), [Kneeboard pages](kneeboard.md) and [Learn your controls](trainer.md): a picture of every device with what each control does.
- [Binding guide and AI help](binding-guide-and-ai.md): what matters in an aircraft, and optional help from an AI model.
- [SimAppPro](simapppro.md): what RigReady does in its place, and what still needs it.

## The DCS World page

**Configure > DCS World** has four tabs.

- **Overview**: the installs with their version and whether an update is waiting, the Saved Games folders, the aircraft, and the state of the screens, Export.lua, the graphics options and SimAppPro at a glance. A warning at the top says when a file RigReady manages was changed by something else, and a note says when DCS is running.
- **Screens**: the monitor setup, described on [MFD screens and the monitor setup](screens.md).
- **Export.lua**: the export scripts, described on [Export.lua](export-lua.md).
- **SimAppPro**: what RigReady does in SimAppPro's place and which setups still need it running, described on [SimAppPro](simapppro.md).

The bindings have their own page, **Configure > DCS bindings**, and the cheat sheets and the binding guide are under **Configure > Cheat sheets** and **Configure > Binding guide**. All of them find DCS the same way, through the installs described on [Installs and aircraft](installs.md).

![The DCS World overview](../../../artifacts/screens/dcs-setup-overview/01-overview.png)

## Close DCS before writing

RigReady refuses to write DCS's files while DCS is running. DCS reads options.lua and the monitor setup when it starts and Export.lua when a mission starts, rewrites options.lua when it exits, and keeps the bindings in memory and writes them back when you press OK in its controls screen. A change made while it runs would be lost or half read.

While DCS runs you can still look at everything. The buttons that write are disabled, the bindings page says that nothing can be saved, and a fix that would write a DCS file reports that DCS must be closed first. RigReady looks for DCS.exe among the running processes. The message each page shows, and what to do, are on [RigReady will not write DCS files](../troubleshooting/dcs-files-refused.md).

Kneeboard pages are the exception: writing them is not blocked, because DCS reads that folder when a mission starts, so new pages simply appear in the next mission.

## Where DCS keeps things

DCS writes everything of yours into a folder under Saved Games: `Saved Games\DCS` for the Steam edition and for a standalone install without a variant, or `Saved Games\DCS.<variant>` when a standalone install has a `dcs_variant.txt` file. RigReady calls this the user folder; in a setup it is the path variable `{DCS_USER}` (see [path variables](../setups/path-variables.md)). The install folder, `{DCS_INSTALL}`, is only ever read.

| What | Where under Saved Games\DCS | What RigReady does with it |
|---|---|---|
| Graphics and other options | `Config\options.lua` | Reads the window size, full screen, VR and the monitor setup; changes single keys and nothing else when you write a screen setup or a setup fixes the options |
| Bindings | `Config\Input\<aircraft>\joystick\<Device name> {ID}.diff.lua`, plus `modifiers.lua`, `disabled.lua` and `wizard.lua` | Reads them together with DCS's defaults to show what is bound; writes edits, cleanups, copies and restores; renames them when a device ID changed |
| Monitor setup | `Config\MonitorSetup\RigReady.lua` | Writes its own file and selects it in options.lua; never edits a file it did not write |
| Export scripts | `Scripts\Export.lua` | Adds or removes one tool's line and leaves every other line as it was |
| Kneeboard pages | `Kneeboard\<aircraft>\RigReady - 01 - ....png` | Writes cheat sheet pages; replaces or removes only pages it wrote itself |
| The log | `Logs\dcs.log` | Reads the version and date of the last run; never writes it |
| Aircraft and their default bindings | `<install>\Mods\aircraft\...` | Reads the aircraft list and the default input files; the install folder is never written |

The aircraft folder names are DCS's input profile keys, for example `FA-18C_hornet` and `UH-1H`, not the display names.

## Every change is backed up

Nothing outside RigReady's own folder is written without a copy being kept first and the change being described. Every DCS file RigReady writes is listed under **Configure > Safety** with Undo, and before a write you see what will change, as a plain-language list and as the exact text. See [Backups](../protect/backups.md) for the whole-rig backup that includes the DCS files.

## Not yet verified in the real game

Two things have passed their tests on recorded data from one rig but have not been looked at inside DCS itself:

- A binding written by RigReady has not been checked in DCS's own controls screen. See [Bindings](bindings.md).
- The MFD displays drawn by DCS from RigReady's monitor setup, with SimAppPro closed, have not been looked at. See [MFD screens and the monitor setup](screens.md).

Both pages say what to look at the first time.
