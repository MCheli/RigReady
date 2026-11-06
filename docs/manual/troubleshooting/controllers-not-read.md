---
title: Game controllers could not be read
description: The input tester shows a red notice, the Devices page has no controller details, and a DCS bindings check says the controllers could not be read.
order: 10
---

RigReady reads buttons and axes the way a game does, through DirectInput, with a small separate program it ships: the input reader. When that program cannot start, everything that needs live input says so, and the rest of RigReady keeps working.

## Symptoms

One or more of these:

- **Devices > Input tester** shows a red notice with the reason, for example "The input reader stopped (exit code 3)" followed by what the reader said as it stopped, or "The input reader did not start in time", or "Could not start the input reader".
- **Devices** says "Game controller details are not available", with the same reason. The devices themselves are still listed, from Windows.
- A DCS bindings check on the Play screen fails with "Game controllers could not be read" and marks itself as a check that could not run, not as bindings that are wrong.
- **DCS bindings** shows "Game controllers could not be read" above the device list.
- The log (Diagnostics) has a line beginning "input reader did not start".

## Cause

The input reader is started when something first needs it and runs beside RigReady. It can fail to start when a file it needs is missing from the RigReady program folder, when it is stopped by something on the PC before it answers, or when it does not report back within 15 seconds. The reason it prints is shown as it is; it is meant for a report rather than for reading.

## What to do

1. Everything that does not need the reader still works: the device list, the USB map, monitors, audio, settings, the Play screen's other checks, and launching. The Devices page tries again by itself while the reader is still starting.
2. Quit RigReady from the tray and start it again. The reader is started afresh the next time it is needed.
3. If it keeps failing, install RigReady again over itself; the data folder is kept. A file removed from the program folder is put back that way.
4. If it still fails, copy the diagnostics (see [diagnostics](../app/diagnostics.md)) and report it with the exact notice from the Input tester. The log keeps the reason.

See [the input tester](../hardware/input-tester.md) for what the page shows when the reader runs.
