---
title: RigReady will not write DCS files
description: Bindings, screens, Export.lua, kneeboard pages, restores and undo are refused with "DCS is running", because DCS rewrites those files itself when it exits.
order: 40
---

RigReady refuses to change any DCS file while DCS is running. This is not caution for its own sake: DCS keeps its options and bindings in memory and writes them to disk again when it exits or when you press OK in its controls screen, which would silently overwrite whatever RigReady had just written.

## Symptoms

Depending on the page:

- **DCS bindings**: "DCS is running. You can look around, but nothing can be saved until it is closed." Saving edits is refused with "DCS is running. It keeps bindings in memory and writes them back when you press OK in its controls screen, which would overwrite this change. Close DCS first." The same goes for the clean-up of unwanted defaults, the device ID repair and copying between aircraft.
- **DCS World > Screens**: "Close DCS first: it rewrites options.lua when it exits."
- **DCS World > Export.lua**: "DCS is running. Close it before changing Export.lua; DCS reads it when a mission starts."
- **Backups > Restore** and a snapshot put back: the game is listed under "Close these before restoring", and the Restore button stays off. See [restore](../protect/restore.md).
- **Cheat sheets > Kneeboard**: "DCS is running. Close DCS first: it reads the Kneeboard folder when a mission starts, and RigReady changes no DCS file while it runs." Export and Remove both wait. See [Kneeboard pages](../dcs/kneeboard.md).
- Undoing a binding change: "DCS is running. Close it before undoing a change to its bindings."
- **Safety > Undo** of any change in DCS's folders: "DCS World is running (DCS.exe). DCS World may write its settings again when it exits, which would undo the restore. Close it first. Nothing was undone." See [the Safety page](../protect/safety-page.md).

Every page uses the same test: DCS counts as running while `DCS.exe` or `DCS_mt.exe` is in the list of running programs.

## What to do

1. Close DCS completely, including a mission that is still loading and the DCS launcher. RigReady believes a program is closed only when its process is gone from the list of running programs, not when its window disappears.
2. Go back to the page and try again. The restore page has **I closed them: check again**; the other pages re-check when you act.
3. On the restore page you can instead tick **Ask them to close for me**: RigReady asks DCS to close the way its own Exit would, waits, and never ends it by force. A game with a mission running may ask you to confirm; unsaved progress is the game's to save.

The same rule applies to the racing games and to tools such as Stream Deck and the Fanatec App, each with its own reason shown on the page.
