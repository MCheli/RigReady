# The owner's rig (facts from the owner and from the machine, 2026-10-03)

## Monitors

| Screen | Identity | Used for |
|---|---|---|
| Samsung LC49G95T ultrawide, 5120x1440 | `DISPLAY\SAM7053`, serial H4ZR900542 | Flying and racing; always the primary |
| Three identical USB MFD screens ("USB_Monitor", `DISPLAY\REG0319`, serial 0) | Told apart only by instance path | Flying (F/A-18C MFD exports) |
| Dell G3223D | `DISPLAY\DELD139`, serial 12NFXG3 | Desk use; should be OFF while flying |
| TV | Not connected on 2026-10-03 | Racing (track view), above the main screen |

**MFD rotation (corrected 2026-10-03, later the same day).** Two states have been observed on this machine:

| State | Ultrawide | MFD screens | Dell | Notes |
|---|---|---|---|---|
| A — at session start, Dell off | primary, 5120x1440 at (0,0) | 768x1024 (portrait) at x = 5120, 5888, 6656 | not attached | Matches SimAppPro's : RIGHT_MFCD x=5128, LEFT_MFCD x=5896, CENTER_MFCD x=6664, each 752x762 at y=256 |
| B — after the owner turned every screen on | 5120x1440 at (2560,0) | 1024x768 (landscape) at x = 7680, 8704, 9728 | primary, 2560x1440 at (0,0) | The owner looked at this state and said the taskbar is on the physical LEFT of each MFD screen, i.e. wrong |

So the panels are physically mounted in portrait, and the known-good flying layout is state A: ultrawide primary at (0,0), three MFD screens in portrait 768x1024 immediately to its right, Dell disabled. Windows keeps separate remembered settings per set of attached monitors, which is why turning the Dell on flipped the MFDs to landscape — this is exactly the owner's number one display problem. Which of the two portrait orientations (90 or 270) is correct has not been read yet; the raw value from state A is the answer (disable the Dell inside a capture-and-restore test and read it, or ask the owner). An earlier version of this note guessed landscape; that was wrong.

DCS draws MFD exports at pixel coordinates in the combined desktop, so the layout must be applied before launch.

## Devices

Nine WinWing devices (VID 4098): Orion joystick base 2 + F-16 grip, throttle base with F-15EX handles, MFD1 left/centre/right frames, UFC1 + HUD1, ICP, F18 startup panel, F18 takeoff panel 2, combat panel 2. Thrustmaster TPR pedals (044F:B68F). Virpil control panel (3344:C259). Stream Deck MK.2. TrackIR 5. Fanatec Podium DD2 wheel base (plugged in from 2026-10-03 for recording).

## Software

DCS World (Steam), iRacing, Le Mans Ultimate, BeamNG.drive, MSFS 2024, Assetto Corsa / EVO / Rally, Tacview. SimAppPro 1.16.91, Stream Deck 7.4.2, TrackIR 5.5.3, FanatecApp 1.2.1.3 with driver 0.52.2, HidHide 1.5.230, ViGEm bus 1.22.0.

## Priorities

DCS aircraft: F/A-18C first, then the UH-1H Huey. Other aircraft do not matter yet. Racing: Le Mans Ultimate, iRacing, BeamNG.drive.

## Safety copy

`C:\Users\Owner\RigReady-safety-backup-2026-10-03` holds `Saved Games\DCS` and the old `~/.rigready` as they were before any work started.
