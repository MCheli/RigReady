# Research: hardware and helper tools

Research for RigReady (see `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`). Done 2026-10-03 on the owner's rig (Windows 11 Pro 26200, non-elevated shell, Medium integrity). Nothing on the machine was changed: no app was started, stopped or reconfigured, and all reads were read-only. The only tools run were `HidHideCLI.exe` query flags (`--cloak-state --inv-state --dev-list --app-list --dev-gaming`, with `--cancel` after the first run) and PowerShell/WMI/PnP reads.

How claims are tagged:

- **[PC]**: verified on this machine (file read, registry read, PnP query, port list).
- **[Web]**: from a cited web source, not checked here.
- **[Inference]**: my conclusion from the evidence. Treat it as a hypothesis until an experiment confirms it.

Rule for implementers: everything below that names the owner's paths, PIDs or serials is an **example from one rig**. Nothing may be hardcoded (PRODUCT.md).

---

## 0. Inventory of the rig as Windows sees it [PC]

| Device | VID:PID (hex) | USB serial (instance) | DirectInput/OEM name (registry) |
|---|---|---|---|
| Orion Joystick Base 2 + F-16 grip | 4098:BEA8 | 82E72012C416422192F650B2 | WINWING Orion Joystick Base 2 + JGRIP-F16 |
| Orion Throttle Base 1 + F-15EX handles | 4098:BD26 | 14067062F4E6C33163562052 | WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R |
| MFD1-L button frame | 4098:BEE1 | 6EFA7012E446232143263042 | WINWING MFD1-L |
| MFD1-C button frame | 4098:BEE0 | 53BD7012E446232143263042 | WINWING MFD1-C |
| MFD1-R button frame | 4098:BEE2 | 80E62062A4E6D221B2465002 | WINWING MFD1-R |
| UFC1 + HUD1 | 4098:BEDE | AE372062A4E6D221B2465002 | WINWING UFC1 + HUD1 |
| ICP | 4098:BF06 | 8E3C6012D4664221F33630B2 | WINWING ICP |
| F18 Startup Panel | 4098:BE03 | 0FA12062F4362231C4766072 | WINWING F18 STARTUP PANEL |
| F18 Takeoff Panel 2 | 4098:BF05 | B167D012E4465321A2E63072 | WINWING F18 TAKEOFF PANEL 2 |
| MFD USB screens (x3) | 17E9:FF00 (DisplayLink) | WWIN29320221210092611 / …093818 / …163532 | n/a (Display class "WINWING USB 3.0 Display1") |
| Thrustmaster TPR | 044F:B68F | (no serial: `8&348856F8&0&2`) | T-Pendular-Rudder |
| Virpil control panel | 3344:C259 (COL01 game controller + COL02 vendor) | `FF` | R-VPC Panel #1 |
| Stream Deck XL (model 20GAT9902) | 0FD9:008F | A00NA33331P1UB | n/a |
| TrackIR 5 | 131D:0159 | (no serial) | n/a (class NaturalPointDevices) |

- WinWing's VID is **0x4098** (16536 decimal). SimAppPro's own JSON stores VID/PID in decimal, for example `"vid": 16536, "pid": 48808`.
- **Combat Panel 2 could not be found.** No separate USB or HID device, no OEMName registry entry, no DCS binding file and no SimAppPro `supportDevice.json` entry refers to a combat panel. WinWing's code has a constant `F18_COMBAT_READY_PANEL = 0xBE05`, and no 0xBE05 device is present. Either it is unplugged, or it is chained through another panel and shares that panel's USB device. **Ask the owner.**
- A Fanatec DD2 appears as `present: true` in HidHide's `--dev-gaming` JSON, but the PnP filter did not show it. Not investigated further.

---

## 1. Replacing SimAppPro

### 1a. What SimAppPro writes, and where it keeps its own state [PC]

SimAppPro 1.16.91 is an **Electron app**, installed per user at `%LOCALAPPDATA%\Programs\SimAppPro\` (NSIS, with `Uninstall SimAppPro.exe`). The JS sources sit unminified in `resources\app.asar` under `mainsrc/` (main process). Native code is in `resources\app.asar.unpacked\` (`WWTHID.dll`, `WWTHID_JSAPI.node`, `WWTMonitor.dll`, `SimLogic.exe`, `vJoyInterface.dll`, and others). It also ships `resources\elevate.exe`, which it uses for HKLM writes.

**Files written into the DCS setup:**

| File | What SimAppPro does | Evidence |
|---|---|---|
| `Saved Games\DCS\Scripts\Export.lua` | `LoadWinwingExport()` in `mainsrc/GetPath.js` runs **every time SimAppPro starts**. It deletes the legacy `Scripts/Winwing/WinwingExport.lua` lines, then makes sure the file **starts with** `local wwtlfs=require('lfs')` / `dofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')`, moving the line to the top if it is already present. Other lines are kept. It creates the file if it is missing. Setting the electron-store key `TurnoffExport: true` turns this off. | The Export.lua mtime (2026-10-03 15:01:35) equals the SimAppPro start time in `log.log` and `config.json`. |
| `Saved Games\DCS\Scripts\wwt\wwtExport.lua`, `wwtNetwork.lua` | Overwritten on every start from `app.asar.unpacked\Events\wwt\` (no backup). | `GetPath.js` lines 272–309 |
| `<DCS install>\Config\MonitorSetup\wwtMonitor.lua` | Generated from the MFD layout wizard. Header: `name = _('winwing')`, `Description = 'Auto script by winwing,please no changes.'`. It goes in the **install folder**, not Saved Games. | `mainsrc/GameExtendDisplay/MFD/DCS/DCS.js` (`setGameConfig`) |
| `Saved Games\DCS\Config\options.lua` | Regex-replaces the `graphics` keys `multiMonitorSetup` (= `"wwtMonitor"`, the **file name** without `.lua`), `width` (7424), `height` (1440) and `aspect` (5.1555…). | same |
| `Saved Games\DCS\Config\appSettings.lua` | **Rewrites the whole file** from its template (`windowPlacement` x/y/w/h = 0/0/7424/1440 plus a `monitors` table). | same |
| `HKCU\…` and `HKLM\System\CurrentControlSet\Control\MediaProperties\PrivateProperties\Joystick\OEM\VID_4098&PID_xxxx\OEMName` | Sets the friendly device names, for example `WINWING MFD1-L`. **This matters for bindings:** DirectInput, and so DCS, take the device name from OEMName, and DCS names binding files `<OEMName> {<instance GUID>}.diff.lua`. On a new PC without SimAppPro the names would differ and existing `.diff.lua` files would not match. | `mainsrc/DeviceNameToRegistrySync.js`; the registry values are present in both hives [PC] |

The owner's current `wwtMonitor.lua` [PC]:

```lua
Viewports = { Center = { x = 0; y = 0; width = 5120; height = 1440; aspect = 3.5555555555555554; } }
UIMainView = Viewports.Center
GU_MAIN_VIEWPORT = Viewports.Center
LEFT_MFCD   = { x = 5896; y = 256; width = 752; height = 762; }
RIGHT_MFCD  = { x = 5128; y = 256; width = 752; height = 762; }
CENTER_MFCD = { x = 6664; y = 256; width = 752; height = 762; }
```

Each export is a 768x1024 portrait screen cropped by `tailorMonitor` {left 8, top 256, right -8, bottom -6}, which gives 752x762 at y=256. **Note the order:** RIGHT_MFCD is on the leftmost USB screen (x 5120) and LEFT_MFCD on the middle one. SimAppPro assigns instruments to monitors by its own ids (`"002"`, `"003"`, `"004"`), not by left-to-right order. The physical wiring decides which is which.

**Export.lua today vs the February backup** [PC]:

- Today (143 bytes): the wwt lines plus `dofile(lfs.writedir() .. [[Scripts\DCS-BIOS\BIOS.lua]])`.
- Backup `Documents\DCS Backup\DCS\Scripts\Export.lua` (2026-02-01): wwt, **DCS-ExportScript** (`Scripts\DCS-ExportScript\ExportScript.lua`) and **Tacview**.
- **DCS-ExportScript is now missing from Saved Games entirely**, but the Stream Deck "DCS Interface" plugin (`dcs_interface.exe`, listening on UDP 127.0.0.1:1725 [PC]) depends on it. Its helpDocs say so explicitly, and the backup's `Config.lua` has `IkarusPort = 1725`. **The owner's Stream Deck DCS lamps and displays will not receive data in the current setup.** This is a concrete first check for RigReady: if the "DCS Interface" plugin is installed, Export.lua must load DCS-ExportScript.
- SimAppPro does not remove other lines, so this loss happened some other way, probably a fresh Saved Games folder.

**SimAppPro's own state** [PC]:

- `%APPDATA%\SimAppPro\config.json`: the electron-store. Keys include `DCS_ALL_Path`, `DCSActiveVersion` (`steamDCS`), `EXEStartUp: true` (starts with Windows), `TurnoffExport` (absent, so Export editing is on), `DevicesDynamicVibrationMotorConfig` (keys 48647, 48897, 48898), `cookies`, and **`AutoLoginSaveAccount`, which holds the WinWing account name and password as plain base64, not encrypted.** RigReady must **never** back up, copy, display or share this file. Treat it as a secret-bearing file.
- `%APPDATA%\SimAppPro\GameExtendDisplay\MFD\MFD_config.json`: last-used monitor info (driver name "DisplayLink USB Device", `\\.\DISPLAY5/6/7`, portrait 768x1024).
- `…\GameExtendDisplay\MFD\DCS_config.json` (60 KB): the full MFD plan. `mainMonitorInfoById`, `usbMonitorInfoById`, `gameViewports`, `gameOptions.graphics`, `gameAppSettings`, `currentMod` (`FA-18C`), and `modsInfo` with per-aircraft instrument→monitor maps for A-10C, A-10C_2, AH-64D, AV8BNA, F-15E, F-15E_WSO, F-16C, F-5E, F14, F14_WSO, FA-18C, JF-17, Ka-50, M-2000C, MIG-21bis. Each instrument has `gameConfigKey` (the DCS viewport name), `tailorMonitor` crop, and `gameMonitor`/`displayMonitor` rectangles. **This file is a ready-made import source**: RigReady can read it to seed an MFD layout without asking the user anything.
- `…\GamePreSets\SupportGame\supportGame.json` (DCS paths) and `supportDevice.json` (device list with vid/pid/name/DirectInput GUID).
- `…\DeviceConfig\deviceCalibration.json`, `…\ShakeEffect\{active,default,effect}\DCS…` (vibration effect definitions), `…\log\`, `…\log.log`.

### 1b. The MFD USB screens [PC unless tagged]

- They are **DisplayLink USB 3.0 graphics devices** (VID 0x17E9, PID 0xFF00, composite with MI_00/MI_01), driver "DisplayLink USB Device" 11.5.6380.0 (`oem3.inf`). No "DisplayLink Graphics" program is installed, so the driver came from Windows Update or from SimAppPro's bundle.
- After the driver binds, each screen is a **plain Windows monitor**: `DISPLAY\REG0319\…`, EDID name `USB_Monitor`, manufacturer `REG`, **EDID serial "0" on all three**. They cannot be told apart by EDID.
- **How to tell the screens apart:** take the monitor's PnP parent `USB\VID_17E9&PID_FF00&MI_00\…`, then its parent `USB\VID_17E9&PID_FF00\WWIN2932022121009xxxx`. That is the composite device, whose instance ID is the **USB serial**, unique per screen. Match the DisplayConfig target `monitorDevicePath` (it contains `REG0319#a&2c1ac5a9&0&UID256`) to the `DISPLAY\REG0319\A&2C1AC5A9&0&UID256` instance, walk up to the serial, and store **that serial** in the profile (PRODUCT.md rule 4).
- Current Windows state (desk layout): Dell 2560x1440 is primary at 0,0. The Samsung is at 2560. The three USB screens are **1024x768 landscape** at 7680, 8704 and 9728. SimAppPro's flight plan expects the Samsung at 0,0 and the USB screens **portrait 768x1024** at 5120/5888/6656. So flying needs a layout with **rotation** (DisplayConfig `DISPLAYCONFIG_ROTATION_ROTATE90/270`) and the Samsung at the origin. Without that, `options.lua` width 7424 and the viewports land in the wrong place.
- **Which physical MFD frame (L/C/R HID) a screen belongs to cannot be derived reliably.** For L and R the USB location paths happen to share a hub branch (MFD1-L HID `…USB(6)#USB(4)#USB(1)#USB(3)` and screen …093818 `…USB(25)#USB(4)#USB(1)#USB(2)`), but for C they do not. Every hub's ContainerId is the generic `{9F4B56F0-…}`. Use an **"Identify" flow**: show a big label on each USB screen and ask the user which MFD it sits in.

**What DCS needs to draw MFD exports without SimAppPro** [PC + Web]:

1. A MonitorSetup Lua defining `Viewports.Center`, `UIMainView`, `GU_MAIN_VIEWPORT`, and the named export viewports (`LEFT_MFCD`, `RIGHT_MFCD`, `CENTER_MFCD` for the Hornet; other aircraft use other names, and SimAppPro's `DCS_config.json` `modsInfo` lists `gameConfigKey` per aircraft).
2. Put it in **`Saved Games\DCS\Config\MonitorSetup\<name>.lua`**. DCS reads user MonitorSetup files there, and the install-folder copy can be replaced by an update or repair ([ED forum](https://forum.dcs.world/topic/331931-custom-monitor-setup-lua-files-not-appearing-in-dcs-options-monitor-drop-down-box), [ED forum](https://forum.dcs.world/topic/315299-new-monitor-setup-lua-file-not-visible-in-menu)) [Web]. That folder does **not** exist on this PC yet [PC]. The install-folder MonitorSetup *is* user-writable here (`BUILTIN\Users:(F)`, Steam's ACL), but RigReady should use Saved Games.
3. In `options.lua` `graphics`: `multiMonitorSetup = "<file name>"`, plus `width`/`height`/`aspect` covering the whole desktop bounding box (here 7424x1440), with `fullScreen = false`.
4. The Windows layout must match the coordinates: positions plus portrait rotation, as above.
5. Optional: `appSettings.lua` `windowPlacement` for borderless placement.

No SimAppPro runtime is involved in MFD drawing. **Feasibility: fully replaceable today.**

### 1c. Runtime features: protocol and feasibility

**DCS ↔ SimAppPro link** [PC, from `wwtExport.lua` / `wwtNetwork.lua` / `mainsrc/DCSData.js`]:

- Transport: JSON over UDP. The export opens one UDP socket on an **ephemeral port bound to all interfaces** (`setsockname("*", 0)`), sends to `127.0.0.1:16536` (a second target, 16537, is commented out) and reads replies non-blocking on the same socket. It ticks every 0.03 s via `LuaExportActivityNextEvent` and chains any earlier `LuaExport*` functions.
- SimAppPro listens on **UDP 0.0.0.0:16536** (confirmed with `Get-NetUDPEndpoint`).
- DCS → SimAppPro messages (`{"func":…}`):
  - `{"func":"net","msg":"ready"}`
  - `{"func":"mission","msg":"ready"|"start"|"stop"}`
  - `{"func":"mod","msg":"<LoGetSelfData().Name>"}`
  - `{"func":"heartbeat","msg":<t>}` every 3 s
  - `{"func":"addOutput","timestamp":t,"args":{"<devId>":{"<argId>":value}}}` (only changed cockpit arguments)
  - `{"func":"addCommon","timestamp":t,"args":{"<key>":<result>}}` (results of Lua snippets, only when changed)
  - replies to `getOutput`, `getCommon`, `original`, `clearOutput`, `clearCommon`
- SimAppPro → DCS messages:
  - `addOutput {args:{dev:{arg:…}}}` subscribes to `GetDevice(dev):get_argument_value(arg)`
  - `getOutput` (one-shot read)
  - `addCommon {args:{key:"<lua source>"}}`: **arbitrary Lua run every tick with `loadstring`**. For the UFC, SimAppPro sends `return list_indication(6);` (Hornet UFC text).
  - `original {msg:"<lua>"}`: runs arbitrary Lua once
  - `setInput {args:{dev:{cmd:value}}}`: `performClickableAction`
  - `clearOutput`, `clearCommon`
- Security note [Inference]: anything that can reach the export's ephemeral UDP port can execute Lua inside DCS's export environment. RigReady must not open firewall rules or forward this port, and should not imitate the design.

**SimAppPro → device (HID)** [PC, from `mainsrc/*.js`; byte layout from Web]:

- JS calls go into the native `WWTHID_JSAPI.node`:
  - `SetLedStateBySerialNumber(serial, index, 0–255)` drives backlights, indicator LEDs **and vibration motors**. `DCSShakeEffect.js` drives motors by sending LED indices from the device config's `DynamicVibrationMotor` map.
  - `SetLcdState(serial, group, [4 bytes])` drives the UFC 7-segment groups.
  - `post0xF0(serial, functionId, isResponse, data)` drives the ICP pixel display and MCDU.
  - `sendHid(serial, bytes)`.
- The Hornet UFC map is in `mainsrc/LCDContolCommon/F18.js` (`DCSToCharPos`: `UFC_OptionDisplay1` → cells 10–13, scratchpad digits 2–8 reversed, and so on).
- The device firmware protocol has been **reverse engineered in the open**:
  - **Linux kernel `hid-winwing`** (GPL-2.0, Ivan Gorinov) supports the Orion2 throttle grips 0xBE62/0xBE68. LED report, 14 bytes: `02 60 BE 00 00 03 49 <led> <brightness> 00 00 00 00 00` ([LKML patch](https://lkml.rescloud.iu.edu/2402.2/01644.html), [kernel source mirror](https://gbmc.googlesource.com/linux/+/refs/heads/master/drivers/hid/hid-winwing.c)) [Web].
  - **`cbass2404/dcs-signal-converter`** ([GitHub](https://github.com/cbass2404/dcs-signal-converter), **MIT**, Rust daemon plus Node editor; protocol doc [`docs/PROTOCOL-WINCTRL.md`](https://github.com/cbass2404/dcs-signal-converter/blob/main/docs/PROTOCOL-WINCTRL.md)) [Web]. It drives Takeoff Panel 2, Orion Throttle Base II, UFC+HUD, ICP, MFD L/C/R and others directly over HID, using **DCS-BIOS** as the data source. SimAppPro does not have to be closed, but its "sync with DCS" light setting must be off for the panels involved. Protocol summary:
    - Report `0x02`, 14 bytes: `02 | part_id (u32 LE; 0x00000001 = broadcast) | len | cmd …`. The device echoes with `part_id + 0x1000`.
    - **LED / dimmer:** cmd `0x49`: `02 <part> 03 49 <index> <value> 00…`. Dimmers take 0–255; indicators take 0/1.
    - **UFC segments:** cmd `0x4C`: `02 d0 be 00 00 06 4c <group 0x00–0x17> b0 b1 b2 b3 00`. No ack. Needs a host-side 96-byte shadow buffer.
    - **ICP pixel display:** report `0xF0`, 64-byte chunks of a logical frame (part id, function `0x102` write / `0x103` commit, 200x64 1-bpp framebuffer), acked per chunk.
    - Part IDs: UFC `0xBED0`, HUD panel `0xBE0E`, ICP `0xBF06`, PTO2 `0xBF05`, Orion Throttle II `0xBE60`, F-15EX handles `0xBF01`/`0xBF02`.
    - PTO2 LED indices: 0 backlight, 1 gear lights, 2 SL (gates all indicators), 3 FLAG, 4–17 indicators.
    - **Never send** `0x04` (restart), `0x06` (write cfg), `0x40` (bootloader, next to `0x41`), `0x43`, `0x47`/`0x48` (calibration, next to `0x49`) or `0x56`. A typo can brick or recalibrate a device.
    - State **latches** with no watchdog, so lights stay on after the host exits. Write only on change, and clear everything on mission stop.
  - Related: [`llamaXc/winwing-ufc-addon`](https://github.com/llamaXc/winwing-ufc-addon) (fakes SimAppPro's UDP messages to show custom UFC text), [`llamaXc/winwing-f16-ded`](https://github.com/llamaXc/winwing-f16-ded) (ICP DED experiments), [`rswilem/winctrl-xplane-plugin`](https://github.com/rswilem/winctrl-xplane-plugin) (**GPL-3.0**, X-Plane on macOS/Linux; drives MCDU/PFP/FCU/EFIS displays and LEDs without SimAppPro) [Web].
- DCS-BIOS is already installed and loaded on this PC [PC]: `Scripts\DCS-BIOS`, export to multicast `239.255.50.10:5010`, import on UDP/TCP 7778. Its `FA-18C_hornet.json` contains `UFC_OPTION_DISPLAY_1..5`, `UFC_SCRATCHPAD_*`, `UFC_COMM1/2_DISPLAY`, `CONSOLES_DIMMER`, `INST_PNL_DIMMER`, `FLOOD_DIMMER`, `MASTER_CAUTION_LT`, `APU_READY_LT` and other lamps. So every input SimAppPro takes from its own export is also available from DCS-BIOS.

**Feasibility verdicts for a third-party tool** (RigReady itself or a recommended companion):

| Feature | Verdict | Why | Smallest experiment (not run) |
|---|---|---|---|
| MFD screen export setup | **Done-able now, no risk** | Plain monitors plus DCS Lua (section 1b) | Generate a Saved Games MonitorSetup with SimAppPro's own numbers. Set `options.lua` to it with SimAppPro closed and `TurnoffExport` set. Start a Hornet mission and confirm all three exports. |
| Binding backup and device names | **Done-able now** | Files plus the OEMName registry values | Export the OEM keys and compare with DCS binding file names. |
| Backlight and indicator LED sync | **Feasible, medium effort** | Documented `0x49` command. DCS-BIOS supplies lamp and dimmer values. MIT reference implementation exists. | With SimAppPro closed, open HID 4098:BF05 (Takeoff Panel 2) via `node-hid`/koffi `HidD_SetOutputReport`/`WriteFile` and send `02 05 BF 00 00 03 49 00 80 00 00 00 00 00`. Expect the backlight at about 50% and an echoed reply with part `0xCF05`. Then send `… 49 04 01 …` (Master Caution lamp) and `… 49 04 00 …` to turn it off. Restore the backlight afterwards. |
| UFC text (Hornet) | **Feasible, medium effort** | `0x4C` segment groups plus a glyph table (in dcs-signal-converter, or derived from `F18.js`) | Write one group to part `0xBED0` on device 4098:BEDE and watch one cell change. Then render "123" in the scratchpad. |
| ICP / DED pixel display | **Feasible, higher effort** | `0xF0` chunked framebuffer with per-chunk acks | Send function `0x104` self-test value 1 (all on) to part `0xBF06`, then value 2 (all off). |
| Vibration (F-15EX handles) | **Feasible for simple effects; SimAppPro-quality effects are hard** | Motors use the same LED/`0x49` command (motor = LED index on the handle part; config keys 48897/48898 = 0xBF01/0xBF02). SimAppPro's effect curves run in its DLL (`ContinuousModelOperatoion`) and the effect files under `ShakeEffect`. The motor index numbers are **not determined**. | Find the motor index in SimAppPro's `www/js/DeviceConfig` (`DynamicVibrationMotor` for PID 48897), then send `0x49 <idx> 0x80` to part `0xBF01` for 200 ms and `0x00` after. |
| MFD screen brightness / bezel backlight | **Probably the same `0x49` mechanism** (`Screen_Backlight` LED name in `DCSAPULight.js`) | Not verified | Find the `Screen_Backlight` index for PID 48865 in DeviceConfig and send it. |

**Overall verdict:** writing a WinWing HID driver inside RigReady is a **separate project**. It is feasible, an MIT reference exists, and it needs an exclusive owner of the device (SimAppPro's sync must be off) plus brick-safety rules. For the first release, follow PRODUCT.md:

- RigReady replaces all **configuration** (MFD layout, export scripts, binding backup, OEM names).
- For runtime features, a profile declares "needs SimAppPro (lights/UFC/vibration)" and RigReady checks that `SimAppPro.exe` is running.
- RigReady can optionally *recommend* dcs-signal-converter.
- Legal note [Inference]: reading SimAppPro's shipped JS to document interop is research. Do not copy its code or assets (device images, fonts, glyph PNGs) into an MIT project. Build from the open protocol doc, which is MIT.

---

## 2. Stream Deck (7.4.2) [PC unless tagged]

**Locations:**

- Install: `C:\Program Files\Elgato\StreamDeck\StreamDeck.exe`. Process name `StreamDeck`. It listens on TCP 127.0.0.1:28196 and [::]:28198 (plugin websocket).
- Profiles: `%APPDATA%\Elgato\StreamDeck\ProfilesV3\<UUID>.sdProfile\`. Each has a `manifest.json` (`{"Device":{"Model":"20GAT9902","UUID":"@(1)[4057/143/A00NA33331P1UB]"},"Name":…,"Pages":{…},"Version":"3.0"}`; the device UUID is VID/PID in decimal plus the USB serial), plus `Profiles\<page UUID>\manifest.json` (actions) and `Images\`.
- Plugins: `%APPDATA%\Elgato\StreamDeck\Plugins\<plugin-uuid>.sdPlugin\manifest.json`. **Some manifests are not plain JSON** (Elgato's Discord plugin failed to parse), so parse defensively.
- Automatic backups: `%APPDATA%\Elgato\StreamDeck\BackupV3\Stream Deck - YYYY-MM-DD-HH-MM-SS.streamDeckProfilesBackup`. There are seven (Aug–Oct 2026, about 96 MB each). Elgato makes one on every app update ([Elgato help](https://help.elgato.com/hc/en-us/articles/360048424432)) [Web]; the frequency here suggests other triggers too.
- Registry: `HKCU\Software\Elgato Systems GmbH\StreamDeck` (Devices, wndGeometry, …). File associations for `.streamDeckProfilesBackup`, `.streamDeckProfile` and `.streamDeckPlugin` all run `"…\StreamDeck.exe" "%1"`.

**`.streamDeckProfilesBackup` format (a plain ZIP):**

- **v7 / BackupV3:** `Profiles/<UUID>.sdProfile/…` plus `Resources/manifest.json` (`{"resources": null}` here). Profile manifests are `"Version":"3.0"`. 3,946 entries, mostly PNG.
- **Older (Feb 2024, `Documents\DCS Backup\Stream Deck - 02-03-2024 - 19-16.streamDeckProfilesBackup`, 59 MB):** `<UUID>.sdProfile/…` at the **zip root**, manifests `"Version":"2.0"`, with `AppIdentifier`. Restore must handle both. The same nine profile UUIDs exist in both.
- **Plugins are not in backups.** They have to be reinstalled separately.

**Safe backup and restore by a tool:**

- **Backup (safe while the app runs):** copy the newest file in `BackupV3`, and/or zip `ProfilesV3` into the v7 layout above (`Profiles/…` plus `Resources/manifest.json`). Read only, then validate that every `manifest.json` parses. The app may write while you copy; re-copy if any mtime changes during the copy [Inference].
- **Restore, recommended:** `Shell.run(StreamDeck.exe, [backupPath])`. The app shows its own "Restore? This overwrites existing profiles" prompt ([Elgato help](https://help.elgato.com/hc/en-us/articles/360048424432)) [Web]. RigReady must **not** report success until it has re-read `ProfilesV3` and found the expected profile names (PRODUCT.md rule 2). Back up the current `ProfilesV3` first (rule 1).
- **Restore, file-level fallback:** quit the Stream Deck app → back up `ProfilesV3` → replace it → start the app. The app must be closed because it holds profiles in memory and rewrites them [Inference; not verified]. Stopping the app is a visible action that needs user consent.

**Profiles and plugins on this rig:**

- 10 profiles, all on the Stream Deck XL: DCS World, F18C XL, UH-1H, F-16 stream deck xl profile, F-15E S4+ Pilot, F-15E S4+ WSO, F-14B cold start with Rio cockpit XL, P-51D, SFX MFS 2024 XL, Discord Labeled XL Plugin Win.
- Installed plugins: **DCS Interface** (`com.ctytler.dcs`, v1.0.4, Charlie Tytler, `dcs_interface.exe`), Discord (`com.elgato.discord`), Stream Deck Icon Library, Tutorial.
- Action usage across all profiles: system hotkey 942, ctytler DCS actions about 1,580 (textdial 399, static button 356, dial 290, lamp 192, switch 175, …), `avionics.madjack.dcs.set` 65, Discord 31, `com.barraider.supermacro` 1.
- **What matters for DCS:**
  1. **DCS Interface (ctytler):** needs DCS-ExportScript with `IkarusPort 1725`, which is **currently missing** from Export.lua (section 1a).
  2. **`avionics.madjack.dcs`:** Mad Jack's DCS-BIOS based Stream Deck plugin, one-way Stream Deck → DCS ([ED forum thread](https://forum.dcs.world/topic/230609-new-streamdeck-plugin/)) [Web]. **Not installed**, but 65 actions use it.
  3. **BarRaider SuperMacro:** **not installed**, 1 action.
- **Check to build:** "profile actions reference plugins that are not installed" (UUID prefix with no matching `Plugins\<uuid>.sdPlugin`).

---

## 3. TrackIR 5.5.3 [PC unless tagged]

- Executable: `C:\Program Files (x86)\TrackIR5\TrackIR5.exe`. Process `TrackIR5`, window title `TrackIR 5.5.3`. Also `TIRMouse.exe`, `NPClient.dll`, `NPClient64.dll`. The NPClient location games look for is `HKCU\Software\NaturalPoint\NATURALPOINT\NPClient Location\Path = C:\Program Files (x86)\TrackIR5\`. A useful check: if this is missing or points somewhere else, games will not see TrackIR.
- User data: `%APPDATA%\NaturalPoint\TrackIR 5\`:
  - `Settings.xml`: app settings, including `<LastProfile>default.xml</LastProfile>`, `<ExclusiveProfile></ExclusiveProfile>`, `RunAtStartup`, `MinimizeToTray`, and the global curves.
  - `Profiles\*.xml`: UTF-16 XML (`<Profile><Name>…`). Here: default, driving, flying, one2one, smooth.
  - `ProfileMap.dat`: **plain text**, one line per game ID, `<NaturalPoint game id> <profile file>`. 741 lines, all `default.xml` here.
  - `sgl.dat` + `sgl.sig`: the signed game list.
- The install folder also has default `Settings.xml`, `ProfileMap.dat` and `Profiles`. TrackIR copies them to AppData.
- **Detecting the active profile:** there is no API. Best effort: read `Settings.xml` `LastProfile` (the profile when no game is connected) and `ExclusiveProfile` (forces one profile for all games). When a game connects, TrackIR uses `ProfileMap.dat[gameId]`. DCS's NaturalPoint game ID was not determined; it is in the encrypted `sgl.dat`. TrackIR probably writes its files on exit, so on-disk values can lag the UI [Inference].
- **Selecting from outside:** there is **no command-line switch**. Users have asked NaturalPoint for one for years ([NaturalPoint forum](https://forums.naturalpoint.com/viewtopic.php?p=50906)) [Web]. Practical option: with TrackIR **closed**, back up and edit `Settings.xml` (`ExclusiveProfile` or `LastProfile`), then start TrackIR. Or keep the TrackIR profile in RigReady's tracked files and restore it. Map profiles by title in TrackIR's own Titles tab (the documented method).

---

## 4. HidHide (app 1.5.230, driver 1.4.181.0) [PC]

- CLI: `C:\Program Files\Nefarius Software Solutions\HidHide\x64\HidHideCLI.exe`. **Works without admin** (verified non-elevated). Commands: `--cloak-state`, `--inv-state`, `--dev-list` (hidden devices), `--app-list` (allowlisted apps), `--dev-gaming` (JSON of gaming HID devices with `present`, `gamingDevice`, `symbolicLink`, `vendor`, `product`, `friendlyName`), `--dev-all`, and others.
- **The CLI saves configuration on exit unless `--cancel` is the last argument.** Always end read-only queries with `--cancel`.
- Output uses command syntax, one per line. Here: `--cloak-off`, `--inv-off`, then `--app-reg "<path>"` lines. Hidden devices are presumably listed as `--dev-hide "<device instance path>"` lines; **nothing is hidden on this rig, so the exact hidden-device format was not observed**. Parse both quoted and unquoted forms.
- Current state: cloaking **off**, inverse mode off, no hidden devices. Allowlisted apps: HidHideCLI, HidHideClient, Nuclear Option.
- Registry: config lives under `HKLM\SYSTEM\CurrentControlSet\Services\HidHide\Parameters`, and **reading it is denied to a non-admin** ("Requested registry access is not allowed"). Use the CLI.
- Check logic: warn when cloaking is on **and** a profile-required device's instance path (`HID\VID_…` or its `USB\…` parent) is in the hidden list **and** the game exe (for example `DCS.exe`) is not allowlisted. Inverse mode flips the allowlist meaning. If cloaking is off, hidden devices do not matter.
- Detect installation with the uninstall key (`DisplayName = HidHide`, `InstallLocation`) or the service `HidHide`. `HidHideWatchdog` runs as a process.

---

## 5. Windows audio default devices (no admin)

| Option | Read default | Set default | Trade-offs |
|---|---|---|---|
| **A. Core Audio COM in-process via `koffi`** (already a dependency) | `IMMDeviceEnumerator::GetDefaultAudioEndpoint(eRender/eCapture, eConsole/eCommunications)`, a documented API | `IPolicyConfig::SetDefaultEndpoint(id, role)`, **undocumented** but used by every switcher; no admin needed | No extra binary and fast (ms). You hand-write COM vtable calls (risk of crashing the process), so run it in an Electron `utilityProcess`, not main. Undocumented interface IIDs could change (stable since Windows 7). |
| B. Small bundled helper exe (C# against .NET Framework 4.8, built into Windows, or C++/Rust) | same APIs | same | Robust and testable on its own. Adds a binary to sign and ship, and another language to the repo. |
| C. PowerShell module [AudioDeviceCmdlets](https://github.com/frgnca/AudioDeviceCmdlets) (MIT) | `Get-AudioDevice -Playback/-Recording` | `Set-AudioDevice -ID … [-DefaultOnly/-CommunicationOnly]` | **Not installed here** [PC]; you would bundle the DLL and `Import-Module` by path. PowerShell 5.1 startup costs about 0.5–1.5 s per call. AV and execution-policy friction. |
| D. Python sidecar + `comtypes` | via comtypes | IPolicyConfig via comtypes | The sidecar exists, but only pygame is bundled [PC]. Adds dependencies to the packaged Python. |
| E. NirSoft SoundVolumeView / svcl | yes | yes | Freeware with redistribution limits; not suitable for an MIT project. |

- Read-only fallback without COM [PC]: `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render|Capture\{guid}` is readable by Users (device list, state, friendly names in `Properties`), but the registry does **not** reliably say which device is the default.
- Well-known COM constants [Web/common knowledge; verify in the experiment]:
  - `CLSID_MMDeviceEnumerator {BCDE0395-E52F-467C-8E3D-C4579291692E}`, `IID_IMMDeviceEnumerator {A95664D2-9614-4F35-A746-DE8DB63617E6}`. Vtable: EnumAudioEndpoints 3, GetDefaultAudioEndpoint 4, GetDevice 5. `IMMDevice::GetId` is 5.
  - `CLSID_PolicyConfigClient {870AF99C-171D-4F9E-AF0D-E63DF40C2BC9}`, `IID_IPolicyConfig {F8679F50-850A-41CF-9C72-430F290290C8}`. `SetDefaultEndpoint` is vtable 13. Roles: 0 eConsole, 1 eMultimedia, 2 eCommunications.
- Set all three roles to match Windows' "Default device"; set eCommunications on its own for "Default communication device" ([IPolicyConfig background](https://docs.lizardbyte.dev/projects/sunshine/latest/PolicyConfig_8h.html)) [Web].
- **Recommendation: A** (koffi in a `utilityProcess` behind `AudioProvider`). If vtable work proves fragile, fall back to **B**.
- Experiment (not run): from Node with koffi, read the default render device ID and friendly name and compare with Sound settings. Then set the same device as default (a no-op) and confirm no error and no admin prompt.
- Profiles should store the endpoint ID (`{0.0.0.00000000}.{guid}`) plus the friendly name, and match by ID first.

---

## 6. Start with Windows and tray (Electron 44, electron-builder NSIS per-user) [Web + repo]

- The repo already builds **NSIS, `perMachine: false`** (`package.json` `build.nsis`), so the app lands in `%LOCALAPPDATA%\Programs\RigReady\RigReady.exe`. Squirrel is not used; **do not adopt Squirrel**. Its `Update.exe` stub changes the login-item path rules ([Electron app docs](https://www.electronjs.org/docs/latest/api/app)).
- **Turn it on or off:** `app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: ['--hidden'], enabled, name })`. This writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. `enabled` maps to `…\Explorer\StartupApproved\Run`, which is what Task Manager's Startup apps toggle changes. No admin needed.
- **Read the state:** `app.getLoginItemSettings()` gives `openAtLogin`, `executableWillLaunchAtLogin` and `launchItems[]` (name, path, args, scope, enabled). Show "disabled in Task Manager" when `openAtLogin` is true but the item is not enabled.
- `wasOpenedAtLogin` is macOS-only. On Windows, detect `--hidden` in `process.argv` and start in the tray without a window.
- Call `app.requestSingleInstanceLock()`. A second launch, for example from the Start menu, should show the existing window.
- Call `app.setAppUserModelId('io.rigready.app')` (the electron-builder `appId`) so notifications and the taskbar group correctly.
- Tray: keep a module-level reference to the `Tray` (garbage collection removes it otherwise). Use a `.ico` with 16/24/32 px. Closing the window hides it to the tray; Quit is in the tray menu. Windows 11 puts new tray icons in the overflow; tell the user once.
- Uninstall: NSIS does **not** remove the Run value. Add `build/installer.nsh` with `!macro customUnInstall` → `DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "<name>"`, or have the app clear it on uninstall. Use a **fixed `name`** so updates do not create duplicate entries.
- `allowToChangeInstallationDirectory: true` is fine: `process.execPath` is correct at runtime. The **portable** target would break the login path, so disable the option there.

---

## 7. Device visualisation for cheat sheets

**Existing work:**

- **Joystick Diagrams** ([GitHub](https://github.com/Rexeh/joystick-diagrams), **GPL-2.0**; [templates](https://www.joystick-diagrams.com/templates/)) [Web].
  - Templates are SVG with placeholder text keys: `BUTTON_n`, `AXIS_X`/`AXIS_Y`/…, `POV_n_U/D/L/R`, plus modifier variants.
  - Templates are matched to devices by name.
  - The catalog lists about 84 templates, including 28+ WinWing (Orion2 family, URSA MINOR, panels), 10+ Thrustmaster and 18+ Virpil. **No Fanatec.**
  - A draw.io starter template is included.
  - Licence: the repo is GPL-2.0, and per-template licences are not stated. Do **not** bundle their SVGs in an MIT app without explicit permission. Importing a user-supplied file is fine.
- SimAppPro ships device images (`app.asar.unpacked\image`, `www`). They are **proprietary**; do not use them.
- No open WinWing / Thrustmaster TPR / Virpil panel / Fanatec image or layout library was found besides Joystick Diagrams.

**Options when no template exists:**

1. **Generated schematic (zero drawing).** Read the device's HID capabilities: button count, axes and hats from the HID report descriptor (`HidP_GetCaps` / `HidP_GetButtonCaps` via koffi, or pygame in the existing sidecar). Render a clean grid of numbered buttons, an axis list with bars and hats as 4-way glyphs. Show labels only for bound controls (from DCS `.diff.lua`). It works for all nine WinWing devices on day one. It looks generic, but it is readable and printable, and it can be rendered at the 768x1024 kneeboard size.
2. **User-arranged layout.** In a "Layout" editor, the user presses a physical button and RigReady highlights that control, and the user drags it onto a canvas. The canvas can have an optional photo or outline the user supplies. Positions are saved as RigReady template JSON (`{vid, pid, controls: [{id:"BUTTON_12", x, y, w, h, shape}]}`). This takes about 5–10 minutes per device, and only for the devices the user cares about.
3. **Community templates.** Import Joystick Diagrams SVGs (map `BUTTON_n` to DCS `JOY_BTNn`). Share RigReady JSON templates as files under CC0/MIT.

**Recommendation:** ship **(1)** as the default for every device, add **(2)** as the upgrade path, and support **(3)** import. For the owner's MFD1 frames, (2) over a photo takes minutes. The schematic still covers the panels where a grid is acceptable: the startup and takeoff panels have many toggles.

Experiment (not run): for 4098:BEE1, call `HidP_GetCaps` and the button caps, and confirm the button count matches what DCS shows (`JOY_BTN1..n`).

---

## 8. USB topology

**APIs / commands** [PC-verified where marked]:

- **Parent chain** [PC]: `CM_Get_Parent` (cfgmgr32), or the `DEVPKEY_Device_Parent` property. PowerShell: `Get-PnpDeviceProperty -InstanceId … -KeyName DEVPKEY_Device_Parent`. Walk up to `USB\ROOT_HUB30` and the PCI xHCI controller.
- **Port chain** [PC]: `DEVPKEY_Device_LocationPaths`, for example `PCIROOT(0)#PCI(1400)#USBROOT(0)#USB(6)#USB(4)#USB(1)#USB(3)`, with one `USB(n)` per hub port. Also `DEVPKEY_Device_LocationInfo` (`Port_#0003.Hub_#0019`).
- **Port details:** open the hub (`GUID_DEVINTERFACE_USB_HUB`) and call `IOCTL_USB_GET_NODE_INFORMATION` (port count), `IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX` / `_V2` (speed, `NumberOfOpenPipes`, device descriptor) and `IOCTL_USB_GET_DESCRIPTOR_FROM_NODE_CONNECTION` (config descriptor, from which you count endpoints). This is how Microsoft's [USBView](https://learn.microsoft.com/windows-hardware/drivers/debugger/usbview) works; its source is a Windows driver sample and a good reference.
- Problem devices: `DEVPKEY_Device_ProblemCode` / `Get-PnpDevice` Status. The "Not enough USB controller resources" notification shows up as a problem on the device.

**This rig** [PC]:

- **One xHCI controller** for the whole PC: Intel USB 3.20 eXtensible Host Controller (PCI 8086:7A60). It carries **62** USB devices (interface children not counted).
- Everything except TrackIR goes through an ASMedia hub on root port 6, which appears as **174C:2074 on the USB 2 side and 174C:3074 on port 25 on the SuperSpeed side**: a USB 3 hub enumerates twice, so merge the halves. Behind it are Genesys 05E3:0610 / 05E3:0626 hubs, about 22 hub entries in total.
- HID devices are 3 external hubs deep (2074 → 0610 → 0610). The DisplayLink screens are also 3 deep (3074 → 0626 → 0626).
- A single desktop "7-port hub" is often two or three cascaded hub chips, so one box can use several tiers [Inference].

**Limits worth warning about:**

- **Hub tiers:** USB allows at most **5 hubs between the host and a device** (7 tiers including root and device) ([Microsoft TechNet](https://technet.microsoft.com/en-us/library/cc939107.aspx)) [Web]. Warn at 4 and flag at 5. Count hub chips, not boxes.
- **xHCI endpoint/resource limit:** Intel 8-series xHCI supported **96 endpoints** for the whole controller, and the error is "Not enough USB controller resources" ([Plugable KB](https://kb.plugable.com/en_US/not-enough-usb-controller-resources-error)) [Web]. Newer Intel PCH limits are higher, but **the exact figure for 8086:7A60 was not determined**. Since everything here is on one controller, show an endpoint total per controller (from config descriptors) and point at the busiest branch. Suggest a PCIe USB card to split the load as the remedy.
- **Bandwidth:** three DisplayLink screens share one SuperSpeed hub uplink with everything else on that hub. Not a hard limit, but worth a note when screens stutter [Inference].

---

## Implementation checklist

### 1. SimAppPro replacement
- [ ] `GameModule(dcs)`: detect `Scripts\Export.lua` lines (wwt, DCS-BIOS, DCS-ExportScript, Tacview) and report which helpers each line serves.
- [ ] Check: if a Stream Deck profile uses `com.ctytler.dcs.*`, Export.lua loads `Scripts\DCS-ExportScript\ExportScript.lua` and `Config.lua` has `IkarusPort` matching the plugin (default 1725). Remediation: restore from a backup (the owner's Feb backup has it).
- [ ] Expect SimAppPro to rewrite Export.lua on start (reorders its line to the top). Compare **sets of lines**, not bytes, so this is not reported as drift.
- [ ] Importer: read `%APPDATA%\SimAppPro\GameExtendDisplay\MFD\DCS_config.json` → per-aircraft viewport names and crops → RigReady MFD layout.
- [ ] Writer: generate `Saved Games\DCS\Config\MonitorSetup\RigReady.lua` (backup first). Set `options.lua` `graphics.multiMonitorSetup/width/height/aspect` (surgical edit via the legacy Lua tokenizer). Optionally write `appSettings.lua` `windowPlacement`.
- [ ] Warn that SimAppPro will overwrite `options.lua`/`appSettings.lua` if its MFD wizard is re-applied. Offer guidance to set `TurnoffExport`; do not write SimAppPro's config.json yourself without consent.
- [ ] Display identity for USB screens: monitor → `MI_00` → composite `USB\VID_17E9&PID_FF00\<serial>`. Store the serial. Add an "Identify" overlay to map serial → L/C/R.
- [ ] Display layout must support **rotation** (portrait MFDs) and the primary/origin change.
- [ ] Backup/share: include the OEMName registry values (HKCU) in binding backups and restore them (HKCU only; HKLM needs admin, so tell the user).
- [ ] **Never** read into backups or share `%APPDATA%\SimAppPro\config.json` (plaintext-equivalent credentials).
- [ ] Check "SimAppPro running" (`SimAppPro.exe`) for profiles flagged `needsWinwingRuntime`.
- [ ] Later (separate epic): WinWing HID output via the `0x49`/`0x4C`/`0xF0` protocol, using dcs-signal-converter's MIT doc, with a hard denylist of dangerous commands, write-on-change and clear-on-exit. Start with the takeoff-panel backlight experiment.

### 2. Stream Deck
- [ ] Detect: `StreamDeck.exe` process, uninstall key "Elgato Stream Deck" (version), `%APPDATA%\Elgato\StreamDeck\ProfilesV3`.
- [ ] Inventory: parse profile manifests (name, device model, device serial) and page manifests (action UUIDs). Map them to installed plugins. **Check for missing plugins** (owner: madjack DCS, BarRaider SuperMacro).
- [ ] Backup: copy the newest `BackupV3` file plus RigReady's own zip of `ProfilesV3` in v7 layout. Validate the JSON.
- [ ] Restore: back up the current state → `Shell.run(StreamDeck.exe, [file])` → wait → verify the profile names. File-level restore only after the user agrees to quit the app.
- [ ] Read both backup layouts (v2 root-level and v3 `Profiles/`).
- [ ] Install guidance: list the plugin UUIDs the profiles need, with marketplace links.

### 3. TrackIR
- [ ] Detect: process `TrackIR5`, exe path from the uninstall key or `C:\Program Files (x86)\TrackIR5`, and `HKCU\Software\NaturalPoint\NATURALPOINT\NPClient Location\Path`, which must point at an existing folder with `NPClient64.dll`.
- [ ] Tracked files: `%APPDATA%\NaturalPoint\TrackIR 5\{Settings.xml, ProfileMap.dat, Profiles\*.xml}` (UTF-16 profiles).
- [ ] Show "last profile / exclusive profile" from Settings.xml, labelled "as last saved by TrackIR".
- [ ] Optional remediation: with TrackIR closed, set `ExclusiveProfile` (backup first), then start TrackIR. Never edit while it is running.

### 4. HidHide
- [ ] Detect: uninstall key `HidHide` → `InstallLocation\x64\HidHideCLI.exe`.
- [ ] Query: `HidHideCLI.exe --cloak-state --inv-state --dev-list --app-list --cancel` (argument array, no shell). Parse lines in command form. Use `--dev-gaming --cancel` for JSON device details.
- [ ] Check: cloaking on, required device hidden, game exe not allowed (account for inverse mode) → warn. Remediation is guidance only: open HidHide Client.
- [ ] Fixture: record CLI output in `fixtures/rigs/mark-flight/`. Get a sample with a device actually hidden (format not yet observed).

### 5. Audio
- [ ] `AudioProvider` in a `utilityProcess` using koffi: list endpoints (ID, name, state), get defaults (render and capture × console/communications), and set the default via IPolicyConfig.
- [ ] Run the no-op set experiment first. Fall back to a bundled helper if koffi COM is unstable.
- [ ] Profiles store the endpoint ID plus name. Matching tries ID, then name.

### 6. Start with Windows / tray
- [ ] Setting "Start with Windows" → `setLoginItemSettings({openAtLogin, args:['--hidden'], name:'RigReady'})`. Show the Task Manager-disabled state from `getLoginItemSettings().launchItems`.
- [ ] `--hidden` starts in the tray. Single-instance lock. `setAppUserModelId`.
- [ ] Tray menu: Open, the last profile's Make ready / Launch / Stand down (only when implemented, rule 2), Quit.
- [ ] `build/installer.nsh` `customUnInstall` removes the HKCU Run value.

### 7. Device visualisation
- [ ] HID caps reader (buttons/axes/hats per device) in `DeviceProvider`.
- [ ] Schematic renderer (SVG) with bound labels from DCS bindings, in print and kneeboard (768x1024 PNG) outputs.
- [ ] Layout editor: press to select, drag to place, optional background photo; RigReady template JSON (CC0) for export and import.
- [ ] Import of Joystick Diagrams SVG templates (user-supplied; nothing bundled).

### 8. USB topology
- [ ] `DeviceProvider.topology()`: for each device, the parent chain (`DEVPKEY_Device_Parent`), `LocationPaths` and the controller. Merge USB 3 hub twins (USB 2 and SuperSpeed halves).
- [ ] Hub-depth warning (warn at 4, error at 5 hubs).
- [ ] Endpoint count per controller via the hub IOCTLs (config descriptors), with "busiest branch" and "consider a second controller" guidance. The threshold is configurable because the 7A60 limit is unknown.
- [ ] Fixture: record this rig's tree (one controller, 62 devices, the ASMedia → Genesys cascade).

---

## Not determined

- Combat Panel 2: not seen anywhere on this PC (unplugged or chained?).
- The endpoint limit of the Intel 8086:7A60 xHCI.
- The HidHide `--dev-list` line format when a device is actually hidden.
- The exact WinWing vibration motor indices and the MFD `Screen_Backlight` index (they are in SimAppPro's `www/js/DeviceConfig`, not extracted).
- The part ID for Throttle **Base 1** (PID 0xBD26). The open docs cover Base II (0xBE60).
- DCS's NaturalPoint game ID, and whether TrackIR writes `Settings.xml` live or on exit.
- Whether a file-level Stream Deck restore needs anything beyond `ProfilesV3` in v7, for example the `Resources` store.
- Physical pairing of each USB screen to its MFD frame (needs the Identify flow).
