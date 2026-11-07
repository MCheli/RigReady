---
title: Kneeboard pages
description: Cheat sheets as DCS kneeboard pages, day or night, in the aircraft's Kneeboard folder: only its own pages are replaced, and a check keeps them current.
order: 90
---

The **Kneeboard** button on [Cheat sheets](cheat-sheets.md) writes the sheet of a DCS aircraft as kneeboard pages, so what each control does is there in the cockpit. This is a DCS feature; the button is only shown for DCS aircraft.

## The dialog

The dialog shows the state of the pages for this aircraft, where they go, and the options:

- **Pages**: tick the devices to export; those with something bound are ticked to begin with. **First page: the most important actions** adds a summary page of your own bindings, hands-on controls first. **Large-print list pages after each device** adds pages that list the device's actions in type large enough for the cockpit.
- **Style**: **Day**, **Night** (dark with dim red, for a dark cockpit) or **Both**; with both, the night pages come after the day pages.
- The preview on the right shows any page exactly as it will be written, in either style.
- **Check before flying**: the setups the up-to-date check can go into; see below.

**Export to kneeboard** (or **Write the pages again** once pages exist) first shows what will be written and removed in the Kneeboard folder, then writes. **Remove RigReady's pages** takes them out again, also with a preview.

While DCS is running (`DCS.exe` or `DCS_mt.exe`), neither is done: the dialog says "DCS is running. Close DCS first: it reads the Kneeboard folder when a mission starts, and RigReady changes no DCS file while it runs", the confirmation's button stays off, and the up-to-date check's fix reports the same. This is the one rule every DCS write follows; see [RigReady will not write DCS files](../troubleshooting/dcs-files-refused.md).

![A night page](../../../artifacts/screens/cheat-sheets-kneeboard/02-preview-night.png)

## The files

Pages go into `Saved Games\DCS\Kneeboard\<aircraft type>\`, for example `Kneeboard\FA-18C_hornet`, whichever spelling of the Kneeboard folder DCS made. DCS shows every image in that folder in name order and stretches it onto the kneeboard, so each page is a portrait 768 × 1024 PNG named `RigReady - 01 - <title>.png`, with `(night)` and `(day)` in the name when the style calls for it, and the lower-case `.png` DCS insists on. DCS reads the folder when a mission starts, so new pages appear in the next mission.

When a setup names a DCS install, a fix run for that setup writes into that install's Saved Games folder.

## Only its own pages

RigReady keeps a record of the pages it wrote, with a fingerprint of each file, and only ever replaces or removes those. A page of yours that happens to have the same name is left alone and RigReady's gets a number added. A page RigReady wrote but you changed since is left alone too, and named. Pages from an earlier export that this one no longer writes, or that were written into another folder when DCS moved, are removed. Every write and removal is backed up and listed under **Configure > Safety** with Undo.

## The up-to-date check

The pages show the bindings as they were when written. The check **Cheat sheet kneeboard pages are up to date** says whether they still do: it passes when nothing changed, says the pages are stale when a binding, a note, a layout or an export option changed since, and says they are missing when some of the files are gone from the folder. Its fix, **Write the kneeboard pages again**, writes them again with the options of the last export. The check is a warning, never a reason for a setup to be Not ready.

Add it to a setup from the dialog's **Check before flying** list, or let capturing a setup offer it for every aircraft that has exported pages. With it in place, **Make ready** rewrites the pages whenever a binding changed; see [Make ready and launch](../play/make-ready-and-launch.md) and [checks](../setups/checks.md).

![The pages are stale after a binding changed](../../../artifacts/screens/cheat-sheets-check/03-stale.png)
