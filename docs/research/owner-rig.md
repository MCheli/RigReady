# The owner's rig (facts from the owner and from the machine, 2026-10-03)

## Monitors

| Screen | Identity | Used for |
|---|---|---|
| Samsung LC49G95T ultrawide, 5120x1440 | `DISPLAY\SAM7053`, serial H4ZR900542 | Flying and racing; always the primary |
| Three identical USB MFD screens ("USB_Monitor", `DISPLAY\REG0319`, EDID serial 1 on all three) | Each hangs off its own DisplayLink USB device (`17E9:FF00`) with a serial of its own: `WWIN29320221210163532`, `WWIN29320221210092611`, `WWIN29320221210093818`. That serial is what RigReady identifies them by, on any USB port | Flying (F/A-18C MFD exports) |
| Dell G3223D | `DISPLAY\DELD139`, serial 12NFXG3 | Desk use; should be OFF while flying |
| TV | Not connected on 2026-10-03 | Racing (track view), above the main screen |

**MFD rotation (corrected 2026-10-03, later the same day).** Two states have been observed on this machine:

| State | Ultrawide | MFD screens | Dell | Notes |
|---|---|---|---|---|
| A — at session start, Dell off | primary, 5120x1440 at (0,0) | 768x1024 (portrait) at x = 5120, 5888, 6656 | not attached | Matches SimAppPro's `wwtMonitor.lua`: RIGHT_MFCD x=5128, LEFT_MFCD x=5896, CENTER_MFCD x=6664, each 752x762 at y=256 |
| B — after the owner turned every screen on | 5120x1440 at (2560,0) | 1024x768 (landscape) at x = 7680, 8704, 9728 | primary, 2560x1440 at (0,0) | The owner looked at this state and said the taskbar is on the physical LEFT of each MFD screen, i.e. wrong |

So the panels are physically mounted in portrait, and the known-good flying layout is state A: ultrawide primary at (0,0), three MFD screens in portrait 768x1024 immediately to its right, Dell disabled. Windows keeps separate remembered settings per set of attached monitors, which is why turning the Dell on flipped the MFDs to landscape — this is exactly the owner's number one display problem. An earlier version of this note guessed landscape; that was wrong.

**Which portrait: 90 or 270 (measured 2026-10-03, evening).** `npm run rig:smoke:apply` applied the flying layout on the real monitors twice, once with each, and restored the desk layout after each (`tests/rig/displayIdentity.rig.test.ts`):

| RigReady rotation | Windows accepted it | DISPLAYCONFIG_ROTATION | GDI `dmDisplayOrientation` | Windows calls it |
|---|---|---|---|---|
| 90 | yes, all three screens, 768x1024 at x = 5120, 5888, 6656 | 2 | 1 (DMDO_90) | Portrait |
| 270 | yes, all three screens, same places | 4 | 3 (DMDO_270) | Portrait (flipped) |

So Windows takes either, and the machine cannot say which one is upright on the panels. What points to **90**: SimAppPro's `DCS_config.json`, written in the flying state, calls the three screens `"direction": "portrait"`, and its vocabulary (`landscape`, `portrait`, `landscape_flip`, `portrait_flip`) is the order of the GDI values 0 to 3, so its plain `portrait` is DMDO_90, Windows' "Portrait", RigReady's 90. And the owner saw the taskbar on the physical left of each MFD screen while they were in landscape, which is a panel turned a quarter clockwise; "Portrait" is the orientation that is upright on such a panel. Dell disconnected (state A) cannot be reproduced by software, because Windows keeps that configuration under another set of connected monitors and its store is not readable without admin rights, so the stored value itself was not read.

It needs one look to settle: Configure > Monitors > Identify shows an arrow on every screen and asks "Which way is up?". If an arrow points down, "Arrow points down: turn it" flips that screen (with the usual keep-or-revert) and corrects the saved layouts. A layout captured while the rig is in its real flying state has the right value anyway, because it is read from Windows.

DCS draws MFD exports at pixel coordinates in the combined desktop, so the layout must be applied before launch.

## Devices

Nine WinWing devices (VID 4098): Orion joystick base 2 + F-16 grip, throttle base with F-15EX handles, MFD1 left/centre/right frames, UFC1 + HUD1, ICP, F18 startup panel, F18 takeoff panel 2, combat panel 2. Thrustmaster TPR pedals (044F:B68F). Virpil control panel (3344:C259). Stream Deck MK.2. TrackIR 5. Fanatec Podium DD2 wheel base (plugged in from 2026-10-03 for recording).

## Software

DCS World (Steam), iRacing, Le Mans Ultimate, BeamNG.drive, MSFS 2024, Assetto Corsa / EVO / Rally, Tacview. SimAppPro 1.16.91, Stream Deck 7.4.2, TrackIR 5.5.3, FanatecApp 1.2.1.3 with driver 0.52.2, HidHide 1.5.230, ViGEm bus 1.22.0.

## Priorities

DCS aircraft: F/A-18C first, then the UH-1H Huey. Other aircraft do not matter yet. Racing: Le Mans Ultimate, iRacing, BeamNG.drive.

## Safety copy

`C:\Users\Owner\RigReady-safety-backup-2026-10-03` holds `Saved Games\DCS` and the old `~/.rigready` as they were before any work started.
