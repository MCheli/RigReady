# The owner's rig (facts from the owner and from the machine, 2026-10-03)

## Monitors

| Screen | Identity | Used for |
|---|---|---|
| Samsung LC49G95T ultrawide, 5120x1440 | `DISPLAY\SAM7053`, serial H4ZR900542 | Flying and racing; always the primary |
| Three identical USB MFD screens ("USB_Monitor", `DISPLAY\REG0319`, serial 0) | Told apart only by instance path | Flying (F/A-18C MFD exports) |
| Dell G3223D | `DISPLAY\DELD139`, serial 12NFXG3 | Desk use; should be OFF while flying |
| TV | Not connected on 2026-10-03 | Racing (track view), above the main screen |

**MFD rotation.** On 2026-10-03 the three MFD screens were set to 768x1024 and the owner reported the taskbar, which should be at the bottom, appears on the physical left edge of each screen. The image is therefore rotated 90 degrees clockwise relative to the panel, which is what Windows "Portrait" does on a landscape-mounted panel. The correct setting is expected to be landscape, 1024x768, orientation 0. This is a deduction; confirm with the owner before treating a layout as known-good, and do not change it during tests except inside capture-and-restore.

Rotation and placement of the MFD screens is the owner's number one display problem, because DCS draws MFD exports at pixel coordinates in the combined desktop.

## Devices

Nine WinWing devices (VID 4098): Orion joystick base 2 + F-16 grip, throttle base with F-15EX handles, MFD1 left/centre/right frames, UFC1 + HUD1, ICP, F18 startup panel, F18 takeoff panel 2, combat panel 2. Thrustmaster TPR pedals (044F:B68F). Virpil control panel (3344:C259). Stream Deck MK.2. TrackIR 5. Fanatec Podium DD2 wheel base (plugged in from 2026-10-03 for recording).

## Software

DCS World (Steam), iRacing, Le Mans Ultimate, BeamNG.drive, MSFS 2024, Assetto Corsa / EVO / Rally, Tacview. SimAppPro 1.16.91, Stream Deck 7.4.2, TrackIR 5.5.3, FanatecApp 1.2.1.3 with driver 0.52.2, HidHide 1.5.230, ViGEm bus 1.22.0.

## Priorities

DCS aircraft: F/A-18C first, then the UH-1H Huey. Other aircraft do not matter yet. Racing: Le Mans Ultimate, iRacing, BeamNG.drive.

## Safety copy

`C:\Users\Owner\RigReady-safety-backup-2026-10-03` holds `Saved Games\DCS` and the old `~/.rigready` as they were before any work started.
