# Racing research: iRacing, Le Mans Ultimate, BeamNG.drive, Fanatec Podium DD2

Research date: 2026-10-03. Machine: the owner's rig (Windows 11 25H2, build 26200).

Read `docs/PRODUCT.md` and `docs/ARCHITECTURE.md` first. This document is meant to be enough to implement the racing game modules, the Fanatec device checks and the wheel-settings features without redoing the research.

## How to read this document

- **[V]** means verified on this machine by reading files, the registry, PnP data or logs (read-only). Excerpts are real; personal identifiers are redacted (`<steamid64>`, `<hostname>`).
- **[W]** means it comes from the web. The URL is given.
- **[I]** means inferred from verified data but not confirmed by a vendor document or an experiment. Treat as a hypothesis with a test plan.
- **[?]** means unknown. A test plan is listed in "Needs the wheel plugged in" or the per-game open questions.

Nothing on disk was modified. No game or vendor app was started.

## Contents

1. Cross-cutting: Steam detection, DirectInput identity, the DD2 as Windows sees it
2. iRacing
3. Le Mans Ultimate
4. BeamNG.drive
5. Fanatec (driver, FanatecApp, wheel settings)
6. Implementation checklists
7. Things only verifiable with the wheel plugged in
8. Sources

---

## 1. Cross-cutting

### 1.1 Steam detection [V]

- Steam root: `HKCU\Software\Valve\Steam\SteamPath` = `c:/program files (x86)/steam` (forward slashes, lower case). Also `HKLM\SOFTWARE\WOW6432Node\Valve\Steam\InstallPath` = `C:\Program Files (x86)\Steam`. Normalise before comparing.
- Libraries: `<SteamRoot>\steamapps\libraryfolders.vdf` (Valve KeyValues text). Each numbered block has `"path"` and an `"apps"` map of appid to size. On this rig there is one library.
- Per-game manifest: `<library>\steamapps\appmanifest_<appid>.acf`, KeyValues text. Useful keys: `installdir`, `buildid`, `StateFlags`, `LastUpdated`, `TargetBuildID`.
- `StateFlags` is a bitmask. `4` = fully installed. `6` = installed and update required (bit 2). On this rig, LMU shows `"StateFlags" "6"`: Steam has an update pending for it. That is a useful pre-flight warning ("Le Mans Ultimate needs an update before it will launch").
- Each Steam game also has an uninstall key `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App <appid>` with `InstallLocation`. That is a quick secondary check, but `libraryfolders.vdf` is authoritative.

| Game | Steam appid | `installdir` | buildid on this rig |
|---|---|---|---|
| iRacing | 266410 | `iRacing` (a 2 KB stub, see 2.1) | 22363345 |
| Le Mans Ultimate | 2399420 | `Le Mans Ultimate` | 25513257 (StateFlags 6) |
| BeamNG.drive | 284160 | `BeamNG.drive` | 24617469 |

Launch through Steam with `steam://rungameid/<appid>`. Pass it as an argument to `explorer.exe` or `steam.exe` (`steam.exe -applaunch <appid> [args]` also works and accepts extra game arguments [W, standard Steam behaviour]). Never build a shell string.

### 1.2 DirectInput device identity: the key to "Windows changed my device IDs" [V]

All three games read the wheel through DirectInput, which gives two GUIDs per device:

- **Product GUID** encodes VID and PID: `{PPPPVVVV-0000-0000-0000-504944564944}`. The last 6 bytes are ASCII `PIDVID`. For the DD2 it is `{00070EB7-0000-0000-0000-504944564944}`, meaning PID `0x0007` and VID `0x0EB7`. It is stable across ports and PCs.
- **Instance GUID** is per device instance on this PC, for example `{20B0BED0-03A4-11F1-8001-444553540000}`. The last 6 bytes are ASCII `DEST\0\0`. It is time-based (UUID v1) and generated locally. It is **not** stable across PCs and may change after re-enumeration.

Where Windows keeps instance GUIDs (read-only, no admin needed):

```
HKCU\System\CurrentControlSet\Control\MediaProperties\PrivateProperties\DirectInput\VID_0EB7&PID_0007\
  Calibration\0   GUID = D0 BE B0 20 A4 03 F1 11 80 01 44 45 53 54 00 00   Joystick Id = 00 00 00 00
  Calibration\1   GUID = D0 BE B0 20 A4 03 F1 11 80 02 44 45 53 54 00 00   Joystick Id = 01 00 00 00
  Calibration\2   GUID = D0 BE B0 20 A4 03 F1 11 80 03 44 45 53 54 00 00
  DeviceInstances
    7&2A952C6A&0&0000 = 02     (two different parent paths = the base has been seen on two USB paths)
    7&2A952C6A&0&0001 = 02
    7&2A952C6A&0&0002 = 02
    8&333F9D8D&0&0000 = 02
    8&333F9D8D&0&0001 = 02
    8&333F9D8D&0&0002 = 02
```

The `GUID` value is the raw little-endian GUID. `D0 BE B0 20 A4 03 F1 11 80 01 …` is `{20B0BED0-03A4-11F1-8001-444553540000}`, exactly the GUID in iRacing's `joyCalib.yaml` and LMU's trace log. Each of the DD2's HID game-controller collections gets its own slot (`…8001…`, `…8002…`).

Also useful:
- `HKCU\System\CurrentControlSet\Control\MediaResources\Joystick\DINPUT.DLL\CurrentJoystickSettings\Joystick<N>OEMName` lists the current winmm joystick slots. The DD2 is `Joystick12OEMName = VID_0EB7&PID_0007` here. The slot number in `Calibration\0\Joystick Id` (0) does not match the current slot (12), but the GUID has stayed the same since February (seen in April logs). **[I]** The instance GUID is tied to the calibration slot record, not to the winmm joystick ID.
- `HKCU\…\Joystick\OEM\VID_0EB7&PID_0007\OEMName` = `FANATEC Podium Wheel Base DD2` (also in HKLM, written by the Fanatec driver).

**Implementation advice.** To learn the *current* instance GUIDs reliably, enumerate DirectInput at runtime (`IDirectInput8::EnumDevices`, `DI8DEVCLASS_GAMECTRL`), for example from the Python sidecar via `ctypes` or `comtypes`. The registry can resolve an *old* instance GUID found in a game file back to a VID/PID (search every `DirectInput\VID_*&PID_*\Calibration\*\GUID`). That works offline and in fixtures. pygame/SDL GUIDs are a different scheme and do not match the games' GUIDs.

**What breaks when Windows re-enumerates:**
- iRacing: bindings and calibration are keyed by the instance GUID (plus product GUID). If the instance GUID changes, iRacing treats the device as new and asks for calibration [W: iRacing support says any port change requires recalibration, https://support.iracing.com/support/solutions/articles/31000133335].
- LMU: devices are keyed by a "unique name" string, not the GUID (see 3.3). It is probably more robust; see the open question there.
- BeamNG: keyed by VID/PID only (`00070eb7`). Port changes do not matter. Two identical devices cannot be told apart.

### 1.3 The Podium DD2 as Windows sees it [V]

PnP data (the base is not plugged in right now; these are the last-seen, non-present nodes):

```
USB\VID_0EB7&PID_0007\7&9A60DAA&0&3          "USB Input Device", Service=HidUsb, LowerFilters=FanatecWheelFilterUsb
  HardwareIds:   USB\VID_0EB7&PID_0007&REV_0691 ; USB\VID_0EB7&PID_0007
  BusReportedDeviceDesc: FANATEC Podium Wheel Base DD2
  LocationInfo:  Port_#0003.Hub_#0009
  LocationPaths: PCIROOT(0)#PCI(1400)#USBROOT(0)#USB(4)#USB(1)#USB(3)
  Parent:        USB\VID_2109&PID_2817\6&3a944ce5&0&1      (a VIA Labs USB hub)
HID\VID_0EB7&PID_0007&COL01\8&333F9D8D&0&0000  HID-compliant game controller  UP:0001 U:0004 (Joystick)
HID\VID_0EB7&PID_0007&COL02\8&333F9D8D&0&0001  HID-compliant game controller  UP:0001 U:0004 (Joystick)
HID\VID_0EB7&PID_0007&COL03\8&333F9D8D&0&0002  HID-compliant device           UP:0001 U:003A (Counted Buffer)
ROOT\FANATEC_WHEEL_VIRTUAL_MOUSE\0000          "Fanatec Wheel Virtual Mouse" (present even without the base; driver FWVirtualInputDevice, Corsair 8.486.0.2)
```

Facts a device check can rely on:

1. **VID `0x0EB7`, PID `0x0007`.** The USB product string is `FANATEC Podium Wheel Base DD2`. It comes from the device, so it is available even without the Fanatec driver.
2. **No USB serial number.** The instance ID `7&9A60DAA&0&3` is the generated, port-derived form (contains `&`). Moving the base to another port gives a different USB instance ID and a new HID parent (`7&2A952C6A…` vs `8&333F9D8D…` above). The device check must therefore identify the base by VID/PID (only one DD2 per rig is realistic). Rule 4 in PRODUCT.md is satisfied by VID/PID alone here; record the USB location path only as a hint.
3. **Three HID collections, two of them joysticks.** Games see **two DirectInput devices with the same name**. Verified from logs:
   - BeamNG: `FANATEC Podium Wheel Base DD2 … created as joystick0` and `… created as joystick1`. joystick0 has 108 buttons, 8 axes and 1 POV. joystick1 has 63 buttons.
   - LMU: adds `{…8001…}`, then rejects `{…8002…}` with `Did not add device with guid {20B0BED0-03A4-11F1-8002-444553540000}: Fanatec device not recognized by Fanatec SDK.`
   - A checklist must expect **2 game-controller collections + 1 vendor collection** for one physical DD2, and must not flag the second as a duplicate or rogue device.
4. Axis names on COL01 (DirectInput, from the BeamNG log): X `Wheel Axis`, Y `Combined Pedals`, Z `Accelerator`, RX `X Rotation`, RY `Y Rotation`, RZ `Brake`, Slider0 `Clutch`, Slider1 `Dial`. The names come from the Fanatec driver's OEM registry entries (`HKLM\…\Joystick\OEM\VID_0EB7&PID_0007\Axes\0..6`). Without the driver they would be generic.
5. `REV_0691` is the USB bcdDevice. **[?]** Whether it changes with firmware is unknown.
6. The DD2 sits behind a hub on this rig (`Hub_#0009`). iRacing support advises against hubs [W, URL above]. The USB map could show this as information, not as a failure.
7. HidHide is installed (`nefarius_HidHide_Updater` in the Run key). Its blacklist (`HKLM\SYSTEM\CurrentControlSet\Services\HidHide\Parameters`) **needs admin to read**: access was denied here. Use the HidHide CLI or client API, not that key, to check whether the DD2 is hidden.

**Does the PID change with a different rim?** No **[W]**. Rims are not USB devices. The base reports the attached rim's ID inside its HID input data. The Linux driver exposes it as `wheel_id` (16-bit, for example `0x2102` = ClubSport F1 IS; `0x000a` = Formula V2; `0x0008` = CSL P1 V2; `0x060c` = Podium Button Module Endurance) [https://github.com/gotzl/hid-fanatecff, README and `hid-ftec.h`]. On Windows, the Fanatec driver caches what it last saw in the registry (see 5.3: `RimType` 13 and 17 under two device keys). **[V]**

**What does change the PID** is the base's mode **[W]**: Fanatec's help centre says that in YELLOW (PC compatibility) mode "the wheel base will adjust its device ID to emulate the ClubSport Wheel Base V2.5", that is, PID `0x0004`. RED is native PC mode (PID `0x0007`). Sources: https://help.fanatec.com/hc/en-us/articles/45693893907729 and https://help.fanatec.com/hc/en-us/articles/49364685827857 (the second returned 403 to the fetcher; content comes from search snippets, so re-read both pages manually before relying on them). The device check should therefore accept `0EB7:0007` as OK and report `0EB7:0004` as "DD2 is in compatibility (yellow) mode; game bindings saved in red mode will not match".

Fanatec PIDs (VID `0x0EB7`), from `hid-ftec.h` [W, https://github.com/gotzl/hid-fanatecff] and cross-checked against the PIDs the Fanatec driver registers under `HKLM\…\Joystick\OEM` on this rig [V]:

| PID | Device |
|---|---|
| 0x0001 | ClubSport Wheel Base V2 |
| 0x0004 | ClubSport Wheel Base V2.5 (also any DD base in yellow compatibility mode) |
| 0x0005 | CSL Elite Wheel Base (PS4) |
| 0x0006 | Podium Wheel Base DD1 |
| 0x0007 | Podium Wheel Base DD2 |
| 0x0011 | CSR Elite |
| 0x0020 | CSL DD |
| 0x0197 | Porsche 911 wheel base |
| 0x0E03 | CSL Elite Wheel Base |
| 0x183B | ClubSport Pedals V3 (USB) |
| 0x6204 / 0x6205 / 0x6206 | CSL Elite pedals / CSL LC pedals / CSL LC V2 pedals |
| 0x1A92 / 0x1A93 | ClubSport USB adapter, shifter / handbrake mode (OEMName in HKLM) |

Pedals plugged into the base (as on this rig: `PedalsType = 1` and a CSP V3 picture in FanatecApp prefs) do **not** appear as a separate USB device. They are axes on the base (Accelerator/Brake/Clutch).

---

## 2. iRacing

### 2.1 Install detection, launch and version

**Standalone install (the real one) [V]**
- Folder: `C:\Program Files (x86)\iRacing\`. All files are read-only (`--r---`).
- Uninstall key: `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{2CB193B9-1B9D-4A84-BC70-0948145BA4BA}_is1`, with `DisplayName = iRacing.com Race Simulation` and `InstallLocation = C:\Program Files (x86)\iRacing\`. **Do not trust its `DisplayVersion`**: it says `2026.03.13.02` while the installed build is `2026.04.21.01`, because the in-app updater does not update it.
- Also present: `HKLM\SOFTWARE\iRacing.com Motorsport Simulations\iRacing.com Race Simulation\Shortcuts` (installer only) and `HKCU\Software\iRacing\Updater` (window position only). The registry path `HKLM\SOFTWARE\iRacing.com\iRacingSim` from `docs/archive/game-integration-reference.md` **does not exist** on this machine.

**Steam "install" [V]** `steamapps\common\iRacing\` is a 2 KB stub: `steam_appid.txt` (266410), `StartPlayingNow.bat`, `StartPlayingBetaUINow.bat` and `StartServiceAndPlayNow.bat`. These scripts start `ui\iRacingUI.exe` from the standalone folder, hardcoded to `C:\Program Files (x86)\iRacing\ui\`. A Steam entry alone does not mean iRacing is installed. Always resolve the standalone folder.

**Executables [V]**

| File | Role |
|---|---|
| `ui\iRacingUI.exe` (v8.7.3, Electron, logs as `iracing-electron`) | The launcher and UI. The user signs in here and starts sessions. **This is what RigReady launches.** |
| `iRacingSim64DX11.exe` (258 MB) | The simulator. Started by the UI with session parameters; do not launch it directly. Its process is the "in car" signal. |
| `iRacingService64.exe` | Windows service `iRacingService` ("iRacing.com Helper Service"), Automatic, Running. `Start_iRacingService.bat` runs `iRacingService64 -allservices -install -start` (needs UAC). |
| `iRacingLauncher64.exe` | Legacy launcher. Fanatec's config still points at `iRacingLauncher.exe`, which **does not exist** (stale path in `HKCU\Software\Endor\FanatecService\Games\5_0\ExeLaunch`). |
| `iRacingLocalServer64.exe` | Local/AI server. |
| `updater\iRacingUpdater.exe` | Updater. Its log shows it runs **elevated** (`Token is elevated to Full`). |

Useful launch arguments: none documented for `iRacingUI.exe`. Launch it with no arguments, working directory `…\iRacing\ui\` (the Steam bat uses `start /D "…\ui\"`).

**Version [V]**
- `C:\Program Files (x86)\iRacing\version_system.txt` = `2026.04.21.01` (sim build).
- `updater\version.txt` = `2026.04.21.01`.
- Per-package versions appear in `Documents\iRacing\logs\updater_*.txt`, for example `File: /updates/system_2026.04.21.01_2026.04.06.02.pkg … Version: 2026.04.21.01 fromVersion: 2026.04.06.02`.
- Whether an update is pending can only be known from the UI or the iRacing server. **[?]** There is no local "update pending" flag. Show the installed build and the date of the last updater log.

**Process names for checks:** `iRacingUI.exe`, `iRacingSim64DX11.exe`, `iRacingService64.exe` (service), `iRacingUpdater.exe`.

### 2.2 Where settings live (`Documents\iRacing\`) [V]

The Documents folder is `[Environment]::GetFolderPath('MyDocuments')` = `C:\Users\Owner\Documents` here (not OneDrive-redirected). Always use the known-folder API, because OneDrive redirection is common.

| File | Format | Contents | Whole-file backup/restore | Written when (from timestamps) |
|---|---|---|---|---|
| `controls.cfg` (30,412 B) | **Binary** (`GFCC` magic) | All bindings plus some controller settings | Yes, while the sim is closed | Only when controls change (4/11) |
| `joyCalib.yaml` (654 B) | YAML | Axis calibration per device | Yes, together with `controls.cfg` | Only when calibrating (4/11, same second as `controls.cfg`) |
| `app.ini` (32 KB) | INI with `; comment` per key | Audio devices, FFB options, HUD, misc | Yes | Every sim exit (4/25 20:54) |
| `rendererDX11Monitor.ini` | INI | Graphics for monitor mode (sections `[AutoCfg] [Graphics Options] [Drive Screen] [User Options] [Display] [MonitorSetup] …`) | Yes | Every sim exit |
| `core.ini` | INI | Networking/debug/telemetry | Yes | Every sim exit |
| `camera.ini`, `fueldata.ini` | INI | Camera, fuel | Yes | Every sim exit |
| `profiles\hud\Baseline.ini` | INI | HUD opacity/scale | Yes | When changed |
| `setups\<car>\…` | Binary setup files (`-Current-` starts `03 00 00 00 FA 03 …`, then encrypted-looking bytes) | Car setups | Yes (opaque) | When saving or driving |
| `scripts\radio\*.txt` | Text | Radio scripts | Yes | Rarely |
| `logs\`, `lapfiles\`, `replay\`, `paint\`, `sentry\` | Mixed | Not configuration | Skip | Ongoing |

**Graphics file names depend on the render mode [W/I].** `rendererDX11Monitor.ini` is used for monitor mode. VR uses separate files (`rendererDX11OpenXR.ini`, `rendererDX11OpenVR.ini`, for example); only the Monitor file exists here. Track whichever exist.

**The sim rewrites the INI files on exit.** Never restore while `iRacingSim64DX11.exe` is running: the sim will overwrite the restore. Restoring while only `iRacingUI.exe` is running is fine [I]. The UI does not hold these files; the sim reads them at start.

**FFB settings [V]** live in `app.ini [Force Feedback]`. Excerpt:

```ini
[Force Feedback]
alwaysRestartFFB=1                      	; Always restart force when updating it, set to true if wheel goes limp after a while
damperMode=0                            	; Set damper effect type 0 = Damper 1 = Inertia 2 = Friction
displayLinearInNm=0                     	; Display the force level in peak Nm when using the linear mode
enableFFB360HzInterpolated=1            	; If available send full 360Hz force feedback to wheel via an interpolation call.
loadFanatecAPI=1                        	; Enable Fanatec wheel API
steeringBumpStop_Deg=45.000000          	; degrees into bump stop before max force
steeringForceParkedPct=0.330000         	; Reduce FFB force by percent when parked, to help reduce oscillations
```

The format is `key=value`, padded with spaces, then a TAB, then `; comment`. An editor must preserve the padding and comments (rewrite only the value token).

**[?] Where the "Strength" / "Wheel force (Nm)" / "Use linear mode" values live.** They are not in `app.ini`. The `controls.cfg` header contains floats that look like them (see 2.4: `25.2`, `25.18`, `100.0`, `50.0`, `1.8`), but this is unconfirmed. iRacing stores strength per car [W, Fanatec's recommended settings say to tick "Use custom controls for this car" to keep per-car strength]. Treat FFB strength as part of the opaque `controls.cfg` until verified.

### 2.3 Calibration file (`joyCalib.yaml`) [V]

```yaml
---
CalibrationInfo:
 DeviceList:
 - DeviceName: 'FANATEC Podium Wheel Base DD2'
   InstanceGUID: '{20B0BED0-03A4-11F1-8001-444553540000}'
   ProductGUID: '{00070EB7-0000-0000-0000-504944564944}'
   AxisList:
   - Axis: 0
     AxisName: 'Combined Pedals'
     CalibMin: 0
     CalibCenter: 65535
     CalibMax: 65535
   - Axis: 1
     AxisName: 'Brake'
   ...
   - Axis: 3
     AxisName: 'Wheel Axis'
     CalibMin: 0
     CalibCenter: 33145
     CalibMax: 65535
...
```

- It is YAML with a leading `---` and a trailing `...`, one-space indentation and single-quoted strings. Write it back in exactly that style (iRacing's parser may be strict **[?]**). Prefer a byte-level GUID replacement over YAML re-serialisation.
- `Axis` numbers are iRacing's own per-device index (0 Combined Pedals, 1 Brake, 2 Accelerator, 3 Wheel Axis). They are not DirectInput offsets. `controls.cfg` refers to these indices.

### 2.4 Bindings file (`controls.cfg`): binary layout reverse-engineered [V/I]

Header (159 bytes), then a `LRTC` chunk with the records:

```
0000: 47 46 43 43  14 00 00 00  C0 76 00 00  02 00 00 00  ...   "GFCC", u32 version? = 0x14, u32 = 0x76C0
0028: 66 66 E6 3F  (1.8f) ... 29 C9 C9 41 (25.22f) ... 00 00 C8 42 (100.0f) ... 97 70 C9 41 (25.18f) ... 00 00 48 42 (50.0f) 00 00 80 3F 00 00 80 3F
009F: 4C 52 54 43  08 00 00 00  1F 76 00 00   "LRTC", u32 = 8, u32 = 0x761F (bytes of record data that follow)
```

**Records [V, verified by walking the whole file: 367 records, ending 2 bytes before EOF].** Each record is a NUL-terminated ASCII action name followed by **exactly 68 bytes**:

| Offset after NUL | Size | Meaning |
|---|---|---|
| +0 | u32 | flag A (0 or 1). **[?]** Meaning unknown. It is 1 for most keyboard-capable/one-shot actions. |
| +4 | u32 | allowed input mask **[I]**: `0x1F` axis/button/key; `0x19` steering; `0x06` button/key only; `0x39` "Level" axes |
| +8 | u32 | binding type: `0` unbound, `1` joystick axis, `2` joystick button, `4` keyboard |
| type 1 (axis) | | `+12` u32 iRacing axis index (matches `joyCalib.yaml` `Axis`); `+16` u32 0; **`+20` instance GUID (16 B)**; **`+36` product GUID (16 B)**; `+52` u32 direction (`SteerRight` = 1, `SteerLeft` = 0) |
| type 2 (button) | | `+12` 16-byte button **bitmask** (bit n = DirectInput button n; `Gear1` = `0x2000` = button 13, `ShiftUp` = `0x10` = button 4, `Reset` = `0x02000000` = button 25); **`+36` instance GUID**; **`+52` product GUID** |
| type 4 (key) | | `+12` u32 key code. Letters, digits, arrows (`0x25–0x28`) and Pause (`0x13`) are Windows virtual-key codes. F-keys appear as `0xC5–0xD0` **[?]**. Byte `+18` holds modifiers (`AutoFFB` has `0x0C` there) **[?]**. |

Excerpt (the `Throttle` record, bound to Accelerator, axis 2 of the DD2):

```
"Throttle\0" 00000000 1F000000 01000000 02000000 00000000
             D0BEB020 A403F111 80014445 53540000   <- instance GUID {20B0BED0-03A4-11F1-8001-444553540000}
             B70E0700 00000000 00005049 44564944   <- product GUID  {00070EB7-0000-0000-0000-504944564944} ("PIDVID")
             00000000 00000000 00000000 00000000
```

- Many actions have a secondary slot named `<Action>2` (`Throttle2`, `ShiftUp2`, …).
- On this rig, 17 records reference the DD2, and those are the only device GUIDs in the file.
- **Action names are plain identifiers** and can be listed in plain language with a label map: `Throttle, Brake, Clutch, SteerLeft, SteerRight, ShiftUp, ShiftDown, GearReverse, GearNeutral, Gear1..Gear16, Ignition, Starter, PitSpeedLimiter, PushToPass, DRS, Handbrake, Reset, LookLeft/Right/Up/Down, BrakeBiasInc/Dec/Level, ABSInc/Dec, TractionControlInc/Dec, DashPageInc/Dec, WingFrontInc/Dec, DiffEntry…, MGUK…, AutoFFB, IncFFB, DecFFB, TChatInitiate, NextDrivingCam, BlackBox*, Rpy* (replay), Cam* (camera tool), VChat*, SPCC* (spotter), Pause`, and so on. The full list of 367 names comes from walking the file. Generate it from a fixture copy; do not hand-maintain it.
- Existing community tools: an "iRacing Controls Editor" is referenced in `docs/archive/game-integration-reference.md` (https://github.com/jackhumbert/iracing-controls-editor-app). **[?]** That link has not been re-verified.

**Edit safety.** Editing values in place (same length) is low-risk: the record size is fixed, and the `LRTC` length does not change. Adding or removing records is not supported; the game owns the set of action names. Back up first (rule 1) and only edit with the sim closed.

### 2.5 Device identity and repair (iRacing)

- Devices are identified by **instance GUID + product GUID + DeviceName** (`joyCalib.yaml`), and by **instance GUID + product GUID** in every bound `controls.cfg` record. **[V]**
- If the instance GUID changes (new port, new PC, Windows re-enumeration), the old bindings point at a missing device. iRacing shows the device as uncalibrated, and its official fix is to delete both files and redo the wizard. **[W]** https://support.iracing.com/support/solutions/articles/31000133335: "Any time a device is connected to a different USB port, it will require calibration in iRacing…"; "Go to Documents/iRacing and delete controls.cfg and joyCalib.yaml files."
- **A tool can repair it [I, high confidence from the verified layout]:**
  1. Collect `(instanceGUID, productGUID)` pairs from `joyCalib.yaml` and from the `controls.cfg` records.
  2. Enumerate the currently attached DirectInput devices (product GUID → current instance GUIDs).
  3. For each old instance GUID that is not attached: if exactly one attached device has the same product GUID and is the same collection kind, map old → new. For the DD2, pick the collection iRacing uses; on this rig it is the `…8001…` one, which is COL01, the 108-button joystick. If several identical devices exist, ask the user ("press a button on the device that was X") and never guess (rule 4).
  4. Replace the 16 raw bytes (little-endian GUID) at every occurrence in `controls.cfg`. Search the whole file for the exact 16-byte pattern; the offsets differ for axis and button records. Also replace the GUID string in `joyCalib.yaml`.
  5. Back up both files first, close the sim first, and show the user the list of remapped actions.
  - Calibration values stay valid after the remap because it is the same physical device.
  - **[?]** It is not verified whether iRacing also stores other device fingerprints (for example the device name) that would reject the remapped GUID. Test with a deliberately changed GUID on a fixture copy, then with the wheel on another port.

### 2.6 Per-car structure

- `Documents\iRacing\setups\<carfolder>\` exists for every owned car (about 190 folders here). Most are empty; a few contain `-Current-` setup files. Folder names are iRacing's internal car paths (`mx5 mx52016`, `porsche992rgt3`, `stockcars fordmustang2022`). The Fanatec service ships a mapping of iRacing car paths to names in `C:\Program Files\Fanatec\FanatecService\Service\xml\CarsList_iRacing.xml` **[V]**, which is a handy label source.
- **Per-car controls ("Use custom controls for this car") [W/?]:** the option exists and is recommended by Fanatec for per-car FFB strength. Earlier repo research claims it writes `setups\<car>\controls.cfg` and `setups\<car>\joyCalib.yaml`. **Not present on this machine (no car has custom controls), so unverified.** The repair in 2.5 must scan `setups\*\controls.cfg` and `setups\*\joyCalib.yaml` too, if they exist.

### 2.7 Helper apps and pre-flight checks (iRacing)

- **[V]** `iRacingService` Windows service must be Running. Query it with the service API, not `sc` string parsing in a shell. Starting it needs admin: offer the bat's equivalent via UAC, or just tell the user.
- **[V]** `iRacingUI.exe` is the launch target.
- **[V]** `trophi.ai` (AI coaching) is installed and autostarts: `HKCU\…\Run\trophi.ai` = `"%LOCALAPPDATA%\trophi.ai\trophi.ai.launcher.exe" --startMinimized`. It is a typical "app running" check for racing profiles.
- **[W]** SimHub: default install `C:\Program Files (x86)\SimHub\`, process `SimHubWPF.exe` (https://www.simhubdash.com/community-2/simhub-support/simhub-installation-directory/). Not installed here.
- **[W/?]** CrewChief V4: process `CrewChiefV4.exe`. Usually installed under `C:\Program Files (x86)\Britton IT Ltd\CrewChiefV4\` **[?]**. Detect it via the uninstall registry DisplayName. Not installed here.
- Fanatec: `FanatecService.exe` must be running for LEDs, ITM and the game integration (5.2).
- **[W]** In-sim telemetry for "is the sim on track" uses iRacing's memory-mapped file `Local\IRSDKMemMapFileName` (irsdk). Optional.

### 2.8 Open questions (iRacing)

- What the `controls.cfg` header floats are (FFB strength / max force / steering?). Test: change the in-sim strength once and diff the header.
- The meaning of flag A and the key-modifier encoding.
- The per-car custom controls file names.

---

## 3. Le Mans Ultimate (LMU)

### 3.1 Install detection, launch and version [V]

- Steam only (appid 2399420). Folder `<library>\steamapps\common\Le Mans Ultimate\`.
- Executables: `Le Mans Ultimate.exe` (game), `start_protected_game.exe` (Easy Anti-Cheat bootstrap), `Launcher\Launch Le Mans Ultimate.exe`, `PluginsAdapter.exe`. **Launch through Steam** (`steam://rungameid/2399420`) so EAC and Steam auth work. Fanatec's config lists `Le Mans Ultimate.exe` and `start_protected_game.exe` as the process names to watch.
- Launch arguments: **[?]** none documented. The trace log shows `Command line: ""` when started from Steam.
- Version:
  - `UserData\Log\trace_<date>.txt` line 2: `LMU-Retail:1.3000 UTC=… SteamBuild=22815142 SteamUser=<steamid64> …` (last run).
  - The Steam manifest `buildid` (25513257) is the installed build.
  - `StateFlags=6` means an update is pending (true on this rig right now).
  - The trace build (22815142) is older than the manifest build: the game has updated since it was last played.
- LMU runs a local web UI/REST server: `Settings.JSON` → `Miscellaneous` → `"WebUI bind": "localhost"`, `"WebUI port": 6397`. **[I]** A listener on `127.0.0.1:6397` means LMU is running and past start-up. Nothing was listening at research time; the game was closed.

### 3.2 Where settings live (`<install>\UserData\`) [V]

UserData is **inside the Steam game folder**, not Documents [V, also W: https://guide.lemansultimate.com/hc/en-gb/articles/13260585473551]. A Steam "verify files" does not delete it [W/?], but uninstalling may. That is a strong reason to back it up.

| Path | Format | Contents | Backup/restore | Rewritten by game |
|---|---|---|---|---|
| `player\direct input.json` | JSON (2-space indent) | **Bindings, device options, FFB per device** | Yes, whole file | **On every start-up** and when controls change (trace: `Saving direct input config to …`) |
| `player\current controls.json` | JSON | Global control options (steering range, camera, FFB filter, "Use Custom Wheel") | Yes | On every start-up |
| `player\Settings.JSON` | JSON; every key has a sibling `"<key>#"` holding its description string | Game, graphics, sound, driving aids, controls metadata | Yes | On start-up (via `Settings.TMP` then rename) and on exit |
| `Config_DX11.ini` | INI (`//[[gMa1.002f …]]` first line) | Resolution, refresh, borderless, adapter `VideoGUID`, VR mirror | Yes | When changed in the launcher/video settings |
| `player\Settings\<Track>\AutoSave.rrbin` | Binary | Per-track car setup autosaves | Yes (opaque) | When driving |
| `player\Multiplayer.JSON`, `CustomPluginVariables.JSON`, `FavoriteAndFixedSetups.gal` | JSON / text | Multiplayer, plugin settings | Yes | On exit |
| `Controller\Presets\*.JSON` | JSON | Vendor presets shipped with the game (including `Fanatec Podium DD2.JSON`) | Not user data | By updates |
| `EffectDef.json`, `EffectPresets.txt`, `snd.cfg` | Text | Game-shipped | No | By updates |
| `Log\trace*.txt` | Text | Logs (device detection is logged, which is very useful for diagnostics) | No | Every run |

**Restore only while LMU is not running**, because it rewrites the three player files at start-up and exit. The trace shows it loading then immediately re-saving `direct input.json`. If a restored file is invalid or refers to a missing device, the game will "fix" it by rewriting it. **[I]** Verify after the next run that the restore survived.

Graphics: `Settings.JSON` → `"Graphic Options"` (283 keys) plus `Config_DX11.ini`:

```ini
[COMPONENTS]
VideoGUID=00002C02-0000-0000-0000-000000000000
VideoResW=5120
VideoResH=1440
VideoRefreshRate=120
WindowedMode=0
Borderless=1
```

`VideoResW/H` encode the ultrawide layout. They are relevant when checking that the Samsung 49" is primary and at the right mode.

### 3.3 Bindings and FFB format (`direct input.json`) [V]

```json
{
  "Devices": {
    "FANATEC Podium Wheel Base DD2:FSDeviceWheelDD-4EDAB5C3015B4FC5": {
      "Force Feedback": {
        "Enabled": true,
        "Invert Force Feedback": false,
        "Steering effects strength": 4000.0,
        "Steering torque minimum": 0.0,
        "Steering torque sensitivity": 1.0,
        "Use vendor specific Force Feedback": true,
        "Vibrotactile effects strength": 0.0
      },
      "Type": "Wheel",
      "input axis properties": { "X+": {"center": 0.5, "max": 1.0, "min": 0.5}, "RZ-": {"center": 1.0, "max": 0.0, "min": 1.0}, "...": {} },
      "instance name": "FANATEC Podium Wheel Base DD2:FSDeviceWheelDD",
      "layout": { "axes": 8, "buttons": 108, "povs": 1 },
      "options": { "Steering Wheel Maximum Rotation": 900.0, "Steering Wheel Maximum Rotation From Driver": true, "Brake Sensitivity": 1.0, "...": 0 },
      "product guid": "{00070EB7-0000-0000-0000-504944564944}",
      "product name": "FANATEC Podium Wheel Base DD2"
    }
  },
  "Input": {
    "Throttle":    { "device": "FANATEC Podium Wheel Base DD2:FSDeviceWheelDD-4EDAB5C3015B4FC5", "id": 5 },
    "Brake":       { "device": "…-4EDAB5C3015B4FC5", "id": 11 },
    "Steer Left":  { "device": "…", "id": 1 },
    "Steer Right": { "device": "…", "id": 0 },
    "Shift Up":    { "device": "…", "id": 36 },
    "Pit Menu Up": { "device": "…", "id": 16 }
  },
  "Alternative Input": { "Bias Forward": { "device": "…", "id": 135 } },
  "Type": "Direct Input"
}
```

- **Action names are plain English keys** in `Input` (primary) and `Alternative Input` (secondary): `Throttle, Brake, Clutch In, Steer Left, Steer Right, Shift Up, Shift Down, Neutral, Speed Limiter, Pit Request, Headlights Pulse, Wipers, Traction Control Up/Down, Increment/Decrement Motor Map, Bias Forward/Rearward, Pit Menu Up/Down/Inc/Dec, Driver Overlay Next/Previous MFD, Look Left/Right, Push To change camera view, …`. Listing them in plain language needs no label map. Unbound actions are simply absent; the full action list comes from the game presets in `Controller\Presets\*.JSON`.
- **`id` encoding [I, consistent across every verified binding and with BeamNG's default DD2 map]:**
  - `0–15`: axis half-ranges in the order `X+, X-, Y+, Y-, Z+, Z-, RX+, RX-, RY+, RY-, RZ+, RZ-, S0+, S0-, S1+, S1-`. Throttle = 5 = Z- (Accelerator); Brake = 11 = RZ- (Brake); Clutch In = 3 = Y-; Steer Right = 0 = X+; Steer Left = 1 = X-.
  - `16–31`: POV hats, 4 hats × (up, right, down, left). Pit Menu Up = 16, Next MFD = 17 (right), Pit Menu Down = 18, Previous MFD = 19 (left).
  - `32+`: buttons; DirectInput button n = id `32 + n`. Shift Up = 36 = button 4 and Shift Down = 37 = button 5, matching BeamNG's DD2 defaults (`shiftUp = button4`).
  - Verify with the wheel by pressing known buttons (section 7).
- Keyboard and gamepad bindings: `current controls.json` has `"Use Custom Keyboard"` and `"Use Custom Gamepad"`; the presets `keyboard.json` and `gamepad.json` live in `Controller\Presets`. **[?]** Where a customised keyboard map is saved.

**Device identity (LMU).** The key is `"<product name>:<instance name>-<16 hex>"`, for example `FANATEC Podium Wheel Base DD2:FSDeviceWheelDD-4EDAB5C3015B4FC5`. The trace log ties it to the instance GUID:

```
hwinput.cpp  5706: Trying to add device with guid {20B0BED0-03A4-11F1-8001-444553540000}
hwinput.cpp  2247: Controller unique name: FANATEC Podium Wheel Base DD2:FSDeviceWheelDD-4EDAB5C3015B4FC5
hwinput.cpp  2300: Initialization successfull. Device - Name:FANATEC Podium Wheel Base DD2:FSDeviceWheelDD-4EDAB5C3015B4FC5  VIPDID 70EB7  InstanceID:{20B0BED0-03A4-11F1-8001-444553540000}
hwinput.cpp  2109: Got maximum steering wheel range for … from Fanatec driver 900
```

- **[?]** What the 16-hex suffix is derived from (a hash of the instance GUID, the device path, or a Fanatec SDK serial). This decides whether a USB port change breaks LMU bindings. Test: note the suffix, move the base to another port, start LMU, read the new trace line. Because the suffix is not the instance GUID itself, **do not attempt an automatic repair until this is known.**
- A repair, once understood, is a pure JSON operation: rename the key under `Devices` and replace every `"device"` string. The JSON is human-readable and safe to edit with the game closed.
- **What RigReady repairs (RACE-LMU-004, 2026-10-04), and what it does not.** The format carries a rewritable identifier for one case: the *name* in front of the suffix. The entry also holds `"product guid"` (`{PPPPVVVV-0000-0000-0000-504944564944}`, i.e. VID/PID), which does not change when a driver or firmware update renames the controller, so the entry can be matched to a connected controller whose DirectInput product name is now different. Two repairs exist (`src/features/racing/core/lmu/rename.ts`), both text-level so every other byte of the file stays as it was:
  1. The game has already added an entry for the same product guid under the new name (it ran once since the rename): every `"device"` string that names the old key is pointed at that entry's key. The key is the game's own, so nothing is assumed about the suffix.
  2. There is no such entry: the old product name is replaced by the new one in the key, in `"product name"`, in `"instance name"` and in every `"device"` string. **The 16-hex suffix is kept unchanged. [?]** If the suffix turns out to be derived from the name, the game will not recognise the rewritten key and will show the controls as unbound, exactly as before the repair; the page says so before the write ("Not yet verified in the game") and the change is one Undo on the Safety page.
  Not repaired, and not offered: a suffix change on its own (USB port move, the open question above), a key that does not start with `<product name>:`, and two connected controllers of one model with different names. Owner test to close the **[?]**: after a real Fanatec driver update that renames the base, compare the `Controller unique name:` line of the new `UserData\Log\trace*.txt` with the key in `direct input.json`; if only the name part differs, repair 2 is confirmed.
- Note `"FSDeviceWheelDD"`: **[I]** this looks like a Fanatec SDK device-class name, not a rim name.

### 3.4 Per-car / per-profile structure

- **[V]** Bindings are global, one `direct input.json`. `Settings.JSON` → `Controls` → `"Current Control File": "defaults"` suggests named control files are supported **[?]**.
- **[V]** Car setups are per track: `player\Settings\<Track>\AutoSave.rrbin`.
- **[W/?]** Per-car FFB multiplier in the garage: commonly discussed, but its storage is unverified. An earlier repo note says "LMU does not support multiple profiles natively"; the workaround is swapping the player files.
- Steering range: `current controls.json` has `"Steering Wheel Range": 360` and `"Range From Vehicle": false`. In `direct input.json`, `"Steering Wheel Maximum Rotation From Driver": true` makes LMU read the base's SEN through the Fanatec SDK (the trace says 900).

### 3.5 Helper apps (LMU)

- Steam must be running (a Steam-only title).
- `FanatecService.exe` (LEDs, ITM). Fanatec has no recommended-settings link for LMU (see 5.4).
- `PluginsAdapter.exe` and `UserData\..\plugins\` hold rF2-style shared-memory plugins used by SimHub and CrewChief. The Fanatec service ships `PodiumrFactor2Plugin64.dll` **[V]**.
- SimHub and CrewChief, as for iRacing.

---

## 4. BeamNG.drive

### 4.1 Install detection, launch and version [V]

- Steam appid 284160, folder `<library>\steamapps\common\BeamNG.drive\`. The executable is `BeamNG.drive.exe`, and it acts as a launcher: the launcher log shows `launchGame| --supportLaunchTokenId=…` then the game running in a child process. Its parent was `steam.exe` when started from Steam.
- **[W]** Command-line arguments documented for BeamNG.tech that also apply to the shared engine: `-console`, `-gfx dx11|vk|d3d12`, `-lua <chunk>`, `-batch`, `-nosteam` (https://documentation.beamng.com/beamng_tech/arguments_and_settings/). **[?]** Exactly which ones `.drive` honours. A user-folder override is set by `startup.ini` `UserPath =` (verified file, see below), not an argument. Recommend launching with no arguments through Steam.
- Version:
  - Installed: `BeamNG.drive.exe` FileVersion `0.39.4.0.20972`; also `integrity.json` → `"buildinfo": "buildbot build 20972 on winbuildbot - 07/08/2026 - 18:16:47"`.
  - Last run: `%LOCALAPPDATA%\BeamNG\BeamNG.drive.ini` → `version = 0.38.5.0`; also `settings.json` → `"lastVersion": "0.38.5.0.19602"`.
  - When they differ, the game will migrate the user folder on the next start (`isVersionUpgradeNeeded` / `migrateUserFolderPre0_37` in the launcher log). Warn the user to back up before the first run after an update.

### 4.2 Where settings live [V]

User folder resolution, from the launcher log:

1. `<game>\startup.ini` `[filesystem] UserPath = <empty|relative|absolute>`. It is empty here, so the default applies.
2. Default (since 0.37): `%LOCALAPPDATA%\BeamNG\BeamNG.drive\current\`. Before 0.37 it was `%LOCALAPPDATA%\BeamNG.drive\<major.minor>\` (`defaultUserPathWithoutVersionPre0_37` in the log). The archive doc's `{LOCALAPPDATA}\BeamNG.drive\{version}` is the **old** layout.
3. `%LOCALAPPDATA%\BeamNG\BeamNG.drive.ini` records `version` and `installPath`.

| File (under `current\settings\`) | Format | Contents | Backup/restore | Rewritten |
|---|---|---|---|---|
| `inputmaps\<vidpid>.diff` (for example `00070eb7.diff`) | JSON | Bindings **and FFB** for that device, as a diff against the defaults | Yes | When bindings change (5/2) |
| `inputmaps\keyboard.diff` | JSON | Keyboard diff | Yes | When changed |
| `inputmaps\<vehicle>\<vidpid>.diff` | JSON | Per-vehicle bindings [W] | Yes | When changed |
| `settings.json` | JSON | Graphics, display, audio, steering assists (`steeringAutocenterEnabled` …) | Yes | Every exit (5/9 18:44) |
| `cloud\settings.json` | JSON | Gameplay prefs (auto clutch, gearbox, FOV); synced by Steam Cloud (`BeamNG.drive.cloud\steam_autocloud.vdf`) | Yes, but Steam Cloud may overwrite it | Every exit |
| `game-settings.cs`, `postfxSettings.postfx`, `imgui.ini` | Text | Engine/UI | Yes | Every exit |
| `cloud\missionProgress\…`, `highscores.json` | JSON | Progress | Optional | Ongoing |

Graphics excerpt (`settings.json`):

```json
"GraphicDisplayDriver":"//./DISPLAY1",
"GraphicDisplayModes":"Fullscreen",
"GraphicDisplayRefreshRates":120,
"GraphicDisplayResolutions":"5120 1440",
"GraphicGPU":"NVIDIA GeForce RTX 5080",
```

`GraphicDisplayDriver` names a GDI display (`\\.\DISPLAY1`). If Windows renumbers displays, BeamNG may open on the wrong monitor. That is a cross-check for the display-layout feature.

### 4.3 Bindings format and device identity [V]

Factory maps are in `<game>\settings\inputmaps\<vidpid>.json`, plus `vehicles\<veh>\inputmaps\*.json` [W]. There are ready-made DD2, CSL DD, CSW and other Fanatec maps: `00070eb7.json`, `00200eb7.json`, `00040eb7.json`, `00060eb7.json`. The user's changes are a **diff**:

```json
{
  "bindings":[
    { "action":"accelerate", "control":"zaxis", "isInverted":true },
    { "action":"steering", "angle":2520, "control":"xaxis",
      "ffb":{ "forceCoef":200, "smoothing":200, "smoothing2automatic":true, "softlockForce":0.81, "...":0 },
      "filterType":2, "isForceEnabled":true, "isForceInverted":true },
    { "action":"vehicle_selector", "control":"button11" }
  ],
  "devicetype":"joystick",
  "guid":"{00070EB7-0000-0000-0000-504944564944}",
  "name":"FANATEC Podium Wheel Base DD2",
  "removed":[ { "action":"clutch", "control":"slider" }, { "action":"accelerate", "control":"yaxis" } ],
  "vendorName":"Fanatec",
  "version":1,
  "vidpid":"00070EB7"
}
```

- **Identity is VID/PID only.** The file name is `<pid><vid>` in lower-case hex (`00070eb7`), and `"guid"` is the **product** GUID. A port change or Windows re-enumeration does not break BeamNG bindings; nothing needs repair. [V + W: https://documentation.beamng.com/modding/input/bindings/] The catch is that two identical devices share one map (BeamNG supports a filename suffix, but **[?]** how it is assigned is unknown).
- The DD2's second collection (joystick1) has the same VID/PID, so it **shares the same map** **[I]**. The log shows BeamNG considering FFB candidates on both and failing to create an FFB interface on joystick1 (`Could not get or create an ffbInterface for … 'joystick1'`), which is harmless.
- **The DD2 in yellow mode would be `00040eb7`** and pick up the CSW V2.5 map instead. The user's diff would not apply.
- Controls: `xaxis, yaxis, zaxis, rxaxis, ryaxis, rzaxis, slider, slider2…, button0…, upov/dpov/lpov/rpov`. Mapping to DD2 names (from the log): xaxis Wheel Axis, yaxis Combined Pedals, zaxis Accelerator, rzaxis Brake, slider Clutch, slider2 Dial.
- **Plain-language action names [V]:** actions are defined in `<game>\lua\ge\extensions\core\input\actions\*.json` (camera, gameplay, general, menu, vehicle, replay, …; about 180+ entries). They are **relaxed JSON (SJSON)**: comments and missing commas, so `JSON.parse` fails; use an SJSON/JSON5-tolerant parser. Each action has `cat`, `order` and `title` (a translation key). English titles are in `<game>\locales\translations\en-US\main.translation.json`, for example `"ui.inputActions.vehicle.accelerate.title": "Throttle"` and `"ui.inputActions.vehicle.shiftUp.title": "Shift Up"`.
- **Editing:** write a `.diff` with `bindings` and `removed` only. Never touch the factory `.json` in the game folder. Edit with the game closed **[I]**. **FFB per device lives in the steering binding** (`ffb.forceCoef`, `smoothing`, `angle`), so "wheel settings per game" for BeamNG is that object.

### 4.4 Per-vehicle structure [W]

"Vehicle bindings in settings/inputmaps/vehicle_directory_name/*.diff" (https://documentation.beamng.com/modding/input/bindings/ and https://docs.beamng.com/modding/input/vehicle-specific-bindings/). There are none on this rig. `vehicles\<veh>\` in the user folder holds mod/material data, not bindings.

### 4.5 Helper apps (BeamNG)

Steam. BeamNG outputs OutGauge/MotionSim UDP for SimHub [W/?, settings in-game]. No mandatory helpers. FanatecService is not needed for FFB, because BeamNG uses DirectInput FFB through the driver.

---

## 5. Fanatec

### 5.1 What is installed [V]

| Component | Location | Notes |
|---|---|---|
| "FANATEC driver package" 0.52.2 | Uninstall `{F6A28FA9-93DF-4507-B327-3BCDA7660D00}` (64-bit), Publisher "Corsair Fanatec"; MSI cached at `C:\ProgramData\Package Cache\{F6A28FA9…}v0.52.2\Fanatec_64_driver.msi` | Driver + firmware |
| `C:\Program Files\Fanatec\Fanatec Wheel\` | `FAWForceFeedbackDrv64.dll` (DirectInput FFB OEM effect driver), `FWFilterUsb.sys` (lower filter on the base's USB node, service `FanatecWheelFilterUsb`), `FWVirtualInputDevice.sys` (virtual mouse), `FWPnpService.exe` (Windows service **FWPnpService**, LocalSystem, Auto, Running) | Driver version 8.486.0.2 (`DriverVer=09/17/2025,8.486.0.2`) |
| `…\Fanatec Wheel\fw\` | `FanatecFirmwareManager.exe`, per-device updaters, 35 `.hex` + 12 `.eff` firmware images, `versions.xml`, `changelog.xml` | **`versions.xml` lists the firmware shipped with this driver**: `<PDD>3.6.1.2</PDD>` (Podium DD), `<EBLDC_DD>3.0.1.1</EBLDC_DD>` (DD motor), `<WQR_PDD25>…`, `<CSPV3>1.35</CSPV3>` |
| `…\Fanatec Wheel\ihv\*.reg`, `metadata\*.devicemetadata-ms` | Windows racing-wheel / UI-navigation IHV registrations | PIDs 0E03, 0005, 038E, 0004, 0197 |
| FanatecApp 1.2.1.3 | Uninstall `{db3c6c83-e26c-4648-8000-3b364f938f74}` (WOW6432Node), Publisher "Corsair"; UI at `C:\Program Files\Fanatec\FanatecUI\UI\Fanatec.exe` (**Flutter** app + WebView2) | The UI is optional at runtime |
| FanatecService 0.9.5 (.NET) | `C:\Program Files\Fanatec\FanatecService\Service\FanatecService.exe`; started by `HKLM\…\Run\FanatecService` (a **user process, not a Windows service**) | Game detection, LEDs, ITM, telemetry, profiles |
| `GameControlService.exe` | same folder | Telemetry extraction (not running at research time) |
| **Eclipse Mosquitto 2.0.18 MQTT broker** | `C:\Program Files\mosquitto\`, Windows service `mosquitto` (LocalSystem, Auto), installed by the Fanatec installer (`OneFanatecSetupCustomAction.CA.dll` in the same folder) | `listener 1883 0.0.0.0`, `allow_anonymous false`, password file. **Listens on all interfaces.** FanatecService connects on 127.0.0.1 and on the LAN IP (for the mobile app) |

FanaLab and the old Fanatec Control Panel are **not** installed: no `%LOCALAPPDATA%\Fanatec\FanaLab` and no `Documents\FanaLab`; `%LOCALAPPDATA%\Fanatec` exists but is empty.

### 5.2 How FanatecApp and the service communicate [V]

`FanatecService.dll.config` defines MQTT topics; `FanatecService.deps.json` references `MQTTnet`, `MQTTPublisher` and `MQTTSubscriber`. Examples:

```xml
<add key="BackendPublisherTuningsSettingsQueueName" value="HW_UI_TuningsSettings_GET"/>
<add key="BackendPublisherProfileListQueueName" value="HW_UI_GameProfile_GET"/>
<add key="BackendPublisherActiveProfileQueueName" value="HW_UI_ActiveProfile_GET"/>
<add key="UIPublisherQueueName" value="UI_HW_FanatecService_POST"/>
<add key="MobilePublisherTuningsSettingsQueueName" value="Mobile_UI_TuningsSettings_GET"/>
```

So the live tuning settings (SEN, FF, NDP, …) are **published over local MQTT** by FanatecService, and the UI posts changes back on `UI_HW_FanatecService_POST`. This is an **undocumented** interface. It is technically readable by a client holding the broker credentials (stored in the Mosquitto password file, which this research did not open). **Recommendation: do not build on it** without the owner's explicit decision. It is undocumented, needs Fanatec's broker credentials, and could change with any FanatecApp update. If the owner wants "read current wheel settings", the research next step is to subscribe read-only to `HW_UI_TuningsSettings_GET` and record the payload format. That is listed in section 7.

**Security note for the owner (not a RigReady feature):** the Fanatec installer exposes an MQTT broker on `0.0.0.0:1883`.

### 5.3 Where Fanatec settings are stored [V]

| What | Where | Format | Notes |
|---|---|---|---|
| **Wheel-base tuning (SEN, FF, NDP, NFR, NIN, INT, FEI, FOR, SPR, DPR, BLI, SHO, …)** | **On the base** (5 presets in the base's memory) [W: "The Tuning Menu constantly stores 5 custom presets … in the Base's internal memory", https://www.fanatec.com/eu/en/explorer/products/steering-wheel/fanatec-tuning-menu-for-performance/] | Firmware | **No file on disk holds them.** Nothing under Program Files, ProgramData, AppData or Documents changed when they were set; the only `xml\CurrentSettings.xml` is the install-time default (1/19/2026) |
| FanatecApp UI prefs | `%APPDATA%\com.example\Fanatec\shared_preferences.json` | JSON (`flutter.` prefixed keys) | Window size and position, tutorials shown, chosen pedal pictures (`FS_PEDALSTYPE_CSPV3`). The folder name `com.example` is literally Flutter's default and could change in a future release |
| FanatecApp WebView data | `%APPDATA%\com.example\Fanatec\webview_data\` and `C:\Program Files\Fanatec\FanatecUI\UI\Fanatec.exe.WebView2\` | Chromium profile | Not settings |
| FanatecService per-user settings | `HKCU\Software\Endor\FanatecService\` | Registry | `Games\<major>_<minor>` (per game: `IsHidden`, `IsFavorite`, `IsSteamInstalled`, `IsExeLaunch`, `ExeLaunch`, **`DefaultProfile`** (empty for every game here)); `ITM\…` (display pages); `Led\…` (rev/flag LED colours and RPM thresholds: `Led\RevRaw\SliderLedRaw1 = 6500` …); `Settings\` (units, language, `DefaultProfileRFactor2 = ClubSport Wheel`) |
| Driver cache of the last-seen hardware | `HKLM\SOFTWARE\WOW6432Node\Fanatec Endor AG\FanatecWheel\{GUID}\<slot>` | Registry (readable without admin) | Slot `16` of `{249A63FC-…}`: `BaseType=8`, `RimType=13`, `PedalsType=1`, `WheelRotation=1080`, `ClutchBitePoint=100`, `SystemReport=<64 bytes>`. Under `{FB546087-…}\16`: `RimType=17`. Two GUID keys suggest two rims or two enumerations. **[?]** The meaning of the type codes |
| Driver options | `HKLM\…\Fanatec Endor AG\FanatecWheel` | Registry | `PS4ModeAutoSwitch=0`, `ManualFirmwareUpdate=1`, `PID_0007=0`, `AllowCswV2Mode=0`, … |
| Accessory options | `HKLM\…\Fanatec Endor AG\CSP` (`BrakeMultiplier=50`), `…\CSUA` | Registry | |
| Per-game definitions (shipped) | `C:\Program Files\Fanatec\FanatecService\Service\xml\Configuration.xml` | XML | Per game: exe names, Steam launch URL, `recommendedFFBLink`, supported telemetry |
| Per-game car lists (shipped) | `xml\CarsList_<game>.xml`, `xml\ProfileCarsList_<game>.xml` | XML | `ProfileCarsList_iRacing.xml` is 12 KB; the others are empty `<ProfileName/>` |

**Where FanatecApp game profiles go once created: [?] not observable.** No profile exists on this rig (every `DefaultProfile` is empty and no profile file was found). Candidates are `HKCU\Software\Endor\FanatecService\…` (the `DefaultProfileRFactor2` value suggests profiles are named entries), the service `xml\` folder (writable? it sits under Program Files and the service runs as the user, **[?]**) or Fanatec's cloud (the service references `AWSSDK.S3` and `Carbon.Storage`). Test plan in section 7.

Legacy FanaLab (for users who still have it) **[W]**: profiles are in `%LOCALAPPDATA%\Fanatec\FanaLab\`; back up and restore the folder (https://boxthislap.org/fanalab-overview-and-features/ and Fanatec forum via search).

**Export, backup, restore, apply from outside:**
- FanatecApp supports import/export of settings between devices [W, simracinghub.nl summary of the 2025 app: "import and export settings between different devices", https://www.simracinghub.nl/en/?p=20137]. **[?]** The file format and default location; it was not exercised.
- No command line: `Fanatec.exe` has no documented arguments. **[?]**
- No public API for tuning. The game-facing **Fanatec SDK** (`EndorFanatecSdk64_VS2019.dll`; iRacing has `loadFanatecAPI=1`) covers LEDs, displays and wheel-range reading (LMU: "Got maximum steering wheel range … from Fanatec driver 900"). **[?]** Whether it exposes tuning writes.
- Over HID: the Linux driver reads and writes the tuning menu (`ftec_tuning/*`: `BLI DPR DRI FEI FF FOR SEN SHO SPR …`, "experimental") [W, https://github.com/gotzl/hid-fanatecff]. A Windows tool *could* do the same with HID reports, but it would be writing to a 25 Nm motor controller with an unofficial protocol. **Not recommended.**
- **Practical recommendation for RigReady:**
  1. Back up `HKCU\Software\Endor\FanatecService` (export to a `.reg`-equivalent JSON) and `%APPDATA%\com.example\Fanatec\` as "Fanatec app settings".
  2. Treat the base's 5 presets as **documented, not restored**: store the user's intended values per profile and show them as a checklist ("set the base to preset 2: SEN AUT, FF 70, …"), unless the MQTT read path in 5.2 is approved.
  3. Remind the user that SEN/rotation matters to every game (LMU reads it from the driver; BeamNG's binding `angle` must match it).

### 5.4 Recommended settings sources (item 8)

| Game | Official Fanatec source | What it gives |
|---|---|---|
| iRacing | `recommendedFFBLink` in Fanatec's own `Configuration.xml` [V]: `https://forum.fanatec.com/topic/541-iracing-pc-fanatec-recommended-settings/p1` (current forum URL: https://forum.fanatec.com/discussion/653/iracing-pc-fanatec-recommended-settings) | The thread returns 403 to automated fetch. Search snippet [W] for Podium DD1 (the DD2 entry is in the same post): **SEN 1080, FF 90, FFS Lin, NDP 16, NFR 2, NIN 8, INT 3, FEI 100, FOR 100, SPR 100, DPR 100, BLI user, SHO 100, BRF user.** In-game: Use Linear Mode checked, Reduce force when parked checked, Strength 6.0 (per car, with "Use custom controls for this car"), Wheel force 20 Nm, Damping 0 %, Min Force 0 %. **Re-read the DD2 row manually; the snippet named DD1.** |
| Le Mans Ultimate | `<recommendedFFBLink />` is **empty** in Fanatec's config [V]. The rFactor 2 link is `https://forum.fanatec.com/topic/546-rfactor-2-pc-fanatec-recommended-settings/p1` (same engine) | Community guidance [W]: NDP 5–10, INT 1–2, FEI 80–100; in-game FFB strength 85–90 %, smoothing 0, minimum torque 0 % (https://coachdaveacademy.com/tutorials/fanatec-settings-for-le-mans-ultimate/) |
| BeamNG.drive | Not in Fanatec's game list [V] | No official recommendation. Use Fanatec's general guide [W]: SEN Auto, FF/FOR 100, NDP ~15, NFR ~5, NIN off, INT 2 (https://www.fanatec.com/eu/hu/explorer/products/racing-wheels-wheel-bases/finding-the-best-settings-for-your-fanatec-base/). In-game: steering `angle` must equal the base SEN |

**What a "recommended vs your current" comparison needs:**
1. A **recommended-settings dataset** in RigReady's data, per game × base model (DD1/DD2/CSL DD/…), with fields `{param, value, unit, note}` and a `source` URL and `retrieved` date. The Fanatec forum is not machine-readable, so maintain it by hand and allow user overrides.
2. **Current base values.** No file holds them (5.3). Options, in order of preference: (a) the user types them or confirms from the base display, stored per RigReady profile; (b) the MQTT read in 5.2, if approved; (c) a HID read (not recommended).
3. **Current in-game values**, all readable from files: iRacing `app.ini [Force Feedback]` (plus strength, **[?]** location); LMU `direct input.json` → `Devices.<dev>."Force Feedback"` and `options`; BeamNG `inputmaps\<vidpid>.diff` → steering binding `ffb` and `angle`.
4. **Cross-checks that matter more than taste:** SEN vs in-game rotation (BeamNG `angle`, LMU `Steering Wheel Maximum Rotation[From Driver]`, iRacing calibration); the base in red (PC) mode, i.e. PID 0007; FFB enabled in game.

---

## 6. Implementation checklists

### iRacing (`src/features/games/iracing/`)
- [ ] Detect the standalone install. Find `iRacingUI.exe` under the uninstall key's `InstallLocation`, falling back to `C:\Program Files (x86)\iRacing\`. Ignore the uninstall `DisplayVersion`.
- [ ] Record the Steam stub (appid 266410) as an "also in Steam" fact only.
- [ ] Version = `version_system.txt`. Show the last update time from the newest `Documents\iRacing\logs\updater_*.txt`.
- [ ] Launch `ui\iRacingUI.exe` with cwd `ui\` and no arguments.
- [ ] Checks: service `iRacingService` Running; process `iRacingUI.exe` (after launch); the DD2 present as `0EB7:0007` (warn on `0EB7:0004`); `FanatecService.exe` running if the profile wants LEDs.
- [ ] Tracked files: `controls.cfg`, `joyCalib.yaml`, `app.ini`, `rendererDX11*.ini`, `core.ini`, `camera.ini`, `fueldata.ini`, `profiles\**`, `scripts\**`, plus `setups\*\controls.cfg|joyCalib.yaml` if present. Exclude `logs`, `replay`, `lapfiles`, `paint`, `sentry`, `screenshots`, `videos`.
- [ ] Block restore while `iRacingSim64DX11.exe` is running.
- [ ] `controls.cfg` reader: header, `LRTC`, records (name + 68 bytes) → typed bindings (axis/button bitmask/key), device GUIDs. Unit-test it against a sanitized fixture copy of this rig's file (367 records, 17 DD2 references).
- [ ] Plain-language label map for iRacing action ids (generated list, hand-written labels).
- [ ] Device-GUID repair: 16-byte replace in `controls.cfg` + string replace in `joyCalib.yaml`, after backup, with the user confirming the mapping. Disambiguate identical devices by asking the user.
- [ ] `app.ini` editor that preserves padding and comments (for FFB toggles).
- [ ] Do not ship a strength editor until its storage is known.

### Le Mans Ultimate (`src/features/games/lmu/`)
- [ ] Detect via `libraryfolders.vdf` + `appmanifest_2399420.acf`. Warn when `StateFlags & 2` (update pending).
- [ ] Version: manifest `buildid`; last-run version from the first `LMU-Retail:` line of the newest `UserData\Log\trace*.txt`.
- [ ] Launch `steam://rungameid/2399420`. Processes: `Le Mans Ultimate.exe`, `start_protected_game.exe`. Optional readiness probe on `127.0.0.1:<WebUI port from Settings.JSON>`.
- [ ] Tracked files: `UserData\player\direct input.json`, `current controls.json`, `Settings.JSON`, `Multiplayer.JSON`, `CustomPluginVariables.JSON`, `FavoriteAndFixedSetups.gal`, `UserData\Config_DX11.ini`, `UserData\player\Settings\**` (setups). Exclude `Log`, `Replays`, `ScreenShots`, `CustomLiveryCache`, `Controller\Presets` and the game-shipped files.
- [ ] Block restore while LMU is running. After restore, re-check on the next run that the file was kept.
- [ ] Bindings reader: `Input` / `Alternative Input` → `{action, deviceKey, id}`, decoded with the id scheme in 3.3. Device list from `Devices` (`product guid` → VID/PID).
- [ ] Bindings editor: JSON, game closed, keys preserved.
- [ ] Device repair: **disabled** until the unique-name suffix is understood (section 7).
- [ ] Parse `Settings.JSON` ignoring the `"<key>#"` description siblings, and preserve them on write.

### BeamNG.drive (`src/features/games/beamng/`)
- [ ] Detect via Steam (appid 284160). The user folder comes from `startup.ini UserPath`, else `%LOCALAPPDATA%\BeamNG\BeamNG.drive\current\`. Handle the pre-0.37 `%LOCALAPPDATA%\BeamNG.drive\<ver>\` too.
- [ ] Version: exe FileVersion (installed) vs `BeamNG.drive.ini version` (last run). Warn "first run after update will migrate your user folder; back up now".
- [ ] Launch via Steam. Process `BeamNG.drive.exe`; it also spawns a child, so treat any `BeamNG.drive.exe` as running.
- [ ] Tracked files: `settings\inputmaps\**\*.diff`, `settings\settings.json`, `settings\cloud\settings.json`, `settings\game-settings.cs`, `settings\postfxSettings.postfx`, `settings\ui_apps\**`. Exclude `temp`, `cache`, `replays`, `screenshots`, `mods` (optional, large).
- [ ] Bindings: merge the factory `<game>\settings\inputmaps\<vidpid>.json` (and the vehicle maps) with the user `.diff` (`bindings` added or overriding, `removed` subtracted) → the effective map. Labels come from the action SJSON + `locales\translations\en-US\main.translation.json`.
- [ ] Editor writes only `.diff`. Needs an SJSON-tolerant parser for the action files.
- [ ] Wheel settings per game = the steering binding `angle` + `ffb` object in `00070eb7.diff`.
- [ ] No GUID repair needed. Do flag "your map is for 00070eb7 but the base is in mode 00040eb7".

### Fanatec (`src/features/devices/fanatec/` or the device-check feature)
- [ ] Device check without hardware: expect USB `VID_0EB7&PID_0007` (product string `FANATEC Podium Wheel Base DD2`), with 2 HID joystick collections (`&COL01`, `&COL02`) and 1 vendor collection (`&COL03`). Identity is VID/PID; no serial. Store the location path as a hint only.
- [ ] Mode check: `0EB7:0004` present and `0EB7:0007` absent → "compatibility (yellow) mode".
- [ ] Driver check: service `FWPnpService` Running; `FanatecWheelFilterUsb` among the base's `LowerFilters` (when present); the driver package version from the uninstall key (0.52.2).
- [ ] App check: `FanatecService.exe` process (started from the HKLM Run key); optionally `mosquitto` service Running (FanatecService depends on it).
- [ ] Firmware info: show `versions.xml` `<PDD>` (the firmware this driver ships). **[?]** The base's actual firmware is not on disk (registry `FirmwareVersion=0`), so it needs the wheel or the MQTT read.
- [ ] Backup set "Fanatec app settings": `HKCU\Software\Endor\FanatecService` (registry export) + `%APPDATA%\com.example\Fanatec\shared_preferences.json`. Restore with FanatecService stopped **[I]**.
- [ ] Recommended-settings dataset (5.4) + a per-profile "intended base preset" record + a comparison UI. In-game values come from files; base values come from the user.
- [ ] Optionally show the last-seen rim/base from the HKLM driver cache (labelled "last seen").
- [ ] Do NOT write tuning to the base (no MQTT publish, no HID writes).

---

## 7. Things that can only be verified with the wheel plugged in

1. Current DirectInput instance GUIDs for COL01/COL02. Confirm that `…8001…` is COL01 (108 buttons) and is the one iRacing and LMU use.
2. Move the base to another USB port: (a) does the DirectInput instance GUID change (new `Calibration\N` slot)? (b) does iRacing lose calibration (expected yes)? (c) does LMU's unique-name suffix `-4EDAB5C3015B4FC5` change? (d) BeamNG unaffected (expected).
3. The iRacing GUID-repair procedure end to end: copy the files, rewrite the GUID, start the sim, confirm the bindings work.
4. LMU `id` encoding: press the paddles (expected 36/37), the D-pad (16–19) and one more button, and compare with the binding screen.
5. Yellow/compatibility mode: confirm PID `0x0004` and the device name shown.
6. Swap rims: confirm the PID stays `0x0007` and that only `RimType` in the HKLM driver cache changes. Record the rim codes (13, 17 = which rims?).
7. With FanatecApp: create a game profile and an export, then diff `HKCU\Software\Endor\FanatecService`, `%APPDATA%\com.example\Fanatec\` and `C:\Program Files\Fanatec\FanatecService\Service\xml\` to find where profiles and exports live and in what format.
8. (Owner decision first) Subscribe read-only to the MQTT topic `HW_UI_TuningsSettings_GET` to capture the tuning payload format.
9. The base's actual firmware version and whether `REV_0691` tracks it.
10. iRacing: change the in-sim FFB strength and diff `controls.cfg` (header floats) and `app.ini` to locate strength / max force / linear mode. Enable "Use custom controls for this car" once and list the files it creates.
11. Whether the second DD2 collection (COL02) produces input at all (BeamNG saw 63 buttons on it).

## 8. Sources

On-machine (all read-only) [V]: the paths quoted above; the registry keys `HKCU\System\CurrentControlSet\Control\MediaProperties\PrivateProperties\DirectInput`, `HKLM\SYSTEM\CurrentControlSet\Control\MediaProperties\PrivateProperties\Joystick\OEM`, `HKCU\Software\Endor`, `HKLM\SOFTWARE\WOW6432Node\Fanatec Endor AG`, the uninstall keys; `Get-PnpDevice` / `Get-PnpDeviceProperty` for `VID_0EB7`; logs `Documents\iRacing\logs\updater_*.txt`, `LMU UserData\Log\trace_2026_04_25_19_02_35-18.txt`, `%LOCALAPPDATA%\BeamNG\BeamNG.drive\current\beamng.log` and `beamng-launcher.log`.

Web [W]:
- iRacing calibration and USB ports: https://support.iracing.com/support/solutions/articles/31000133335
- BeamNG bindings format: https://documentation.beamng.com/modding/input/bindings/ ; per-vehicle: https://docs.beamng.com/modding/input/vehicle-specific-bindings/
- BeamNG arguments: https://documentation.beamng.com/beamng_tech/arguments_and_settings/
- LMU UserData location: https://guide.lemansultimate.com/hc/en-gb/articles/13260585473551
- Fanatec PIDs, rim IDs, tuning over HID (Linux driver): https://github.com/gotzl/hid-fanatecff and `hid-ftec.h` in that repo
- Fanatec compatibility (yellow) mode emulates CSW V2.5: https://help.fanatec.com/hc/en-us/articles/45693893907729-Wheel-Bases-Red-Mode-vs-Yellow-Mode-Compatibility-with-Older-Games , https://help.fanatec.com/hc/en-us/articles/49364685827857-Wheel-Base-Compatibility-Modes-A-Primer (403 to fetch; content from search results)
- Tuning presets stored in the base: https://www.fanatec.com/eu/en/explorer/products/steering-wheel/fanatec-tuning-menu-for-performance/ ; FanatecApp vs FanaLab: https://www.fanatec.com/explorer/products/racing-wheels-wheel-bases/fanatec-app-and-fanatec-control-panel-fanalab-a-comparison/
- FanatecApp import/export summary: https://www.simracinghub.nl/en/?p=20137 ; FanaLab folder: https://boxthislap.org/fanalab-overview-and-features/
- Fanatec iRacing recommended settings: https://forum.fanatec.com/discussion/653/iracing-pc-fanatec-recommended-settings (403 to fetch; values from search snippet)
- General Fanatec settings guide: https://www.fanatec.com/eu/hu/explorer/products/racing-wheels-wheel-bases/finding-the-best-settings-for-your-fanatec-base/
- LMU Fanatec community settings: https://coachdaveacademy.com/tutorials/fanatec-settings-for-le-mans-ultimate/
- SimHub install folder: https://www.simhubdash.com/community-2/simhub-support/simhub-installation-directory/
