# mark-full: notes

Recorded 2026-10-03 from the owner's rig with everything connected (flight gear and the Fanatec DD2; the TV is not connected). Re-record with `npm run rig:record -- mark-full`, or one part with `--only=files` (parts: devices, displays, processes, services, audio, input, registry, hidhide, files). What is copied is listed in `scripts/lib/recordPlan.ts`. This file is not overwritten.

## What state was recorded

The **desk** state, which is the wrong one for flying: Dell G3223D primary at 0,0 (2560x1440), ultrawide LC49G95T at 2560,0 (5120x1440), the three MFD screens ("USB_Monitor", EDID REG0319) in landscape 1024x768 at 7680 / 8704 / 9728, all with raw rotation 1 (identity). Scenario `desk-mfds-wrong` is this state unchanged.

The known-good flying layout (ultrawide primary at 0,0; MFDs portrait 768x1024 at x=5120, 5888, 6656; Dell off) is produced by mutation in `fixtures/scenarios/flying-fresh.yaml`.

Default audio when recorded: playback Speakers (Realtek), communications playback the Dell monitor, recording and communications recording the Arctis headset microphone.

## What is in it

| File | Content |
|---|---|
| `devices.json`, `usb-tree.json` | 62 USB devices with hub chains |
| `displays.json` | 5 monitors |
| `processes.json` | every running process (paths as on the PC, user name replaced) |
| `services.json` | 718 Windows services with state |
| `audio.json` | 10 endpoints and the defaults |
| `input.json` | 12 DirectInput game controllers with instance GUID, product GUID, VID/PID, axis names |
| `registry.json` | 252 keys: DirectInput calibration slots (instance GUIDs) and OEM names, joystick slots, Steam path, Steam's per-app state for the sims, uninstall entries of the sims and helper apps, `HKCU\Software\Endor\FanatecService`, `HKLM\SOFTWARE\WOW6432Node\Fanatec Endor AG`, the iRacing installer key. No Eagle Dynamics keys exist (Steam edition). |
| `hidhide.json` | HidHide as reported by `HidHideCLI` (read-only, `--cancel`): installed, cloaking off, nothing hidden, 3 allow-listed programs, the `--dev-gaming` list |
| `files/` | 363 files, 2.7 MB, laid out as under a user folder (see below) |
| `rehome.json` | the recorded files that contain paths to re-point at the fake home when a scenario starts |

`files/` (20 of the files are empty placeholders for programs, so detection by `exists()` works; no binary or image is recorded):

- `Saved Games/DCS`: `Config/Input` (11 F/A-18C diffs, `disabled.lua`, a `FA-18C_hornet.backup` folder), `Config/options.lua`, `appSettings.lua`, `lang.cfg`; `Scripts/Export.lua`, `Scripts/wwt/*`, `Scripts/DCS-BIOS/BIOS.lua` and `BIOSConfig.lua`; `Kneeboard/.keep` (the folder is empty on the PC); `Logs/dcs.log` cut down to its first lines, the `DCS/<version>` line and the `INPUT (Main): created [...]` lines. There is no `Config/MonitorSetup` folder on the PC and no UH-1H input folder.
- `Documents/iRacing` (`controls.cfg`, `joyCalib.yaml`, `app.ini`, `core.ini`, `camera.ini`, `rendererDX11Monitor.ini`), `Documents/Assetto Corsa/cfg`.
- `AppData/Roaming`: SimAppPro `GameExtendDisplay/MFD/DCS_config.json`, TrackIR `ProfileMap.dat`, Stream Deck `ProfilesV3` (2 of 10 profiles: each profile's manifest and its first three pages, every action's `Settings` emptied) and every plugin's `manifest.json`, Fanatec `shared_preferences.json`, MSFS 2024 `UserCfg.opt`.
- `AppData/Local/BeamNG`: `BeamNG.drive.ini`, `current/settings/inputmaps`, `settings.json`.
- `Program Files (x86)/Steam/steamapps`: `libraryfolders.vdf` (apps list cut to the sims), `appmanifest_*.acf` for DCS (223750), iRacing (266410), LMU (2399420), BeamNG (284160), MSFS 2024 (2537590), Assetto Corsa (244210), AC EVO (3058630), AC Rally (3917090).
- `.../common/DCSWorld`: `Config/MonitorSetup`, `Config/Input`, `Scripts/Input`, `Mods/aircraft/FA-18C/Input`, `Mods/aircraft/Uh-1H/Input`, both modules' `Cockpit/Scripts/devices.lua` and `command_defs.lua`, `entry.lua` of all 20 aircraft modules, `_DCS_Steam`. The Steam edition has no `autoupdate.cfg`.
- `.../common/Le Mans Ultimate/UserData`: `player/*.json`, `Controller/` presets, `Config_DX11.ini`. `.../common/BeamNG.drive/startup.ini` (`integrity.json` is 1.7 MB and was skipped).
- `Program Files (x86)/iRacing`: `version_system.txt`, `updater/version.txt`. `Program Files/Fanatec`: `Configuration.xml`, `versions.xml`.

## Privacy

Paths have the Windows user name replaced with `User`. Steam account ids are replaced with the neutral id `76561197960265728`, and the player name and nickname in LMU's `Settings.JSON` with `Player`. Never recorded: `%APPDATA%\SimAppPro\config.json` (account credentials), DCS `network.vault` and `steam_authdata.bin`. The recording still contains real device serial numbers and the full list of running programs and services.

## MFD screen orientation: 90 is likely, still not seen on the panels

Whether portrait on these panels is rotation **90 or 270** has not been read from the machine:

- Windows keeps one stored configuration per set of connected monitors. The flying set (Dell disconnected) is not the current set, `SetDisplayConfig` with `SDC_TOPOLOGY_SUPPLIED` fails with error 31 for it, and the stored configurations under `HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\Configuration` cannot be read without admin rights (access denied).
- Two indirect pieces of evidence both point to **90**: (1) SimAppPro's `DCS_config.json`, written in the flying state, records the three MFD screens as `"direction": "portrait"`, and its vocabulary has four values (`landscape`, `portrait`, `landscape_flip`, `portrait_flip`), so the plain Windows "Portrait" (90), not "Portrait (flipped)" (270). (2) The owner saw the taskbar on the physical left of each MFD screen while they were in landscape, which means the panels are mounted turned 90 degrees clockwise; Windows "Portrait" is the orientation that is upright on a monitor turned that way.
- The scenarios use 90. It is confirmed for good the next time the rig is in the flying state: `npm run rig:smoke` prints each monitor's rotation.

## Facts learned from the real apply test (layout restored exactly afterwards)

- The MFD screens only offer one mode, 1024x768 (EDID and `WmiMonitorListedSupportedSourceModes`). Portrait is therefore a rotation, not a different resolution.
- In the Windows display configuration API the source mode keeps the unrotated size (1024x768) when rotation is 90/270; the desktop sees the turned size (768x1024). `DisplayInfo.width/height` are the desktop size. `rawRotation` is the untouched `DISPLAYCONFIG_ROTATION` value (1=0°, 2=90°, 3=180°, 4=270°).
- The three MFD screens have the same EDID name and serial; they differ only in the instance part of their device path (`...reg0319#a&2c1ac5a9...`, `...a&270816bc...`, `...a&2f291759...`), which is what `DisplayInfo.id` holds. Which id is the left, centre or right panel is not known from the recording.
- Disabling the primary, moving, rotating and re-enabling all worked through `SetDisplayConfig` on this rig, including the USB (indirect display) MFD screens.

## DirectInput

DirectInput lists 12 game controllers, and so does `input.json`. The earlier pygame/SDL reader listed only 10: SDL leaves out controllers that have no buttons (the T-Pendular-Rudder pedals: 3 axes, 0 buttons) or no axes (WINWING F18 TAKEOFF PANEL 2: 0 axes, 64 buttons). The sidecar now calls DirectInput itself.

The Virpil panel (`VID_3344&PID_C259`) has two calibration slots in the registry: slot 0 (`...-8001-...`) is stale, slot 1 (`...-8002-...`) is the one in use and the one in the DCS file name. It is the fixture's example of "Windows changed the device id".
