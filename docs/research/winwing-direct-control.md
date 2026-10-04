# Research: driving the WinWing devices directly (without SimAppPro)

Feasibility note for SAP-005, written 2026-10-04. It collects what is known about the runtime features SimAppPro provides (backlight, UFC/ICP displays, MFD frame backlight, vibration) and about the USB MFD screens, and sets out the smallest safe experiment for each. It builds on `docs/research/hardware-and-tools.md` sections 0 and 1 (read those first; this note does not repeat the file-level findings) and `docs/research/dcs.md` section 4 (Export.lua).

**Nothing was sent to any device for this note, no HID tool was run and no software was installed.** The one thing read from the PC was the Plug and Play device list (`Get-PnpDevice`, a registry-backed query that does no device I/O). Every experiment below is described, not run.

How claims are tagged:

- **[Repo]**: already established in `hardware-and-tools.md` (there tagged [PC] or [Web]).
- **[PC]**: read on the owner's PC on 2026-10-04 for this note.
- **[Web]**: stated by the cited public source. The pages were read through a summarising fetch, so **every byte value below must be re-read in the source itself before it is used in a write.**
- **[Snippet]**: seen only in search-result text; the page itself could not be opened.
- **[Inference]**: a conclusion, to be treated as a hypothesis.

This is not `docs/research/winwing-protocol.md`. That file is what SAP-005 asks for and can only be written from a capture on the rig (section 7): it will record the reports as actually seen on the owner's devices.

---

## 1. Summary

| Feature | Public documentation | Covers the owner's devices? | Feasible for RigReady | First experiment |
|---|---|---|---|---|
| Panel / throttle / stick backlight | Good: one command (`0x49`), two independent sources | Takeoff Panel 2, UFC+HUD, MFD frames: yes. Stick base, Throttle Base 1, Startup Panel: no public part ids | Yes, medium effort | One backlight level on the Takeoff Panel 2 (section 7, step 3) |
| Indicator LEDs (Master Caution etc.) | Same command | Takeoff Panel 2: yes | Yes, with a data source (DCS-BIOS) | After the backlight experiment |
| UFC text (Hornet) | One source, with a glyph table | UFC1 + HUD1: yes | Yes, medium effort | One segment group, after a capture |
| ICP display (F-16 DED) | One source | ICP: yes | Yes, higher effort (framebuffer, acks) | Capture only at first |
| MFD frame backlight | One source | MFD1-L/C/R: yes | Yes, same as backlight | One level on one frame, after the Takeoff Panel |
| Vibration motors | Linux kernel driver, for other grips | F-15EX handles on Base 1: **no** | Simple pulses probably; SimAppPro-quality effects are a project of their own | Capture only; no write until the part ids and index are seen |
| USB MFD screens | Not needed | They are plain monitors | **Done** (displays + dcs-setup features) | None |

Overall: the lighting and display features are reachable over one documented HID channel, and a small MIT-licensed reference exists. It is a separate project with real brick risk from one wrong byte, and the public material does not cover three of the owner's nine devices. Until a capture on the rig confirms the reports, PRODUCT.md stands: RigReady checks that SimAppPro runs when a setup needs these features (SAP-003), and no product UI is added (SAP-005, rule 2).

---

## 2. The devices and how they appear to Windows

From `hardware-and-tools.md` section 0 [Repo] and the PnP list [PC]:

| Device | VID:PID | Runtime features it has | Public part id |
|---|---|---|---|
| Orion Joystick Base 2 + F-16 grip | 4098:BEA8 | backlight; vibration not established (SimAppPro's `DevicesDynamicVibrationMotorConfig` has a key 48647 = 0xBE07, which is not this device's PID and may be a part id) | none found |
| Throttle Base 1 + F-15EX handles | 4098:BD26 | backlight, vibration (config keys 48897 / 48898 = 0xBF01 / 0xBF02) | handles 0xBF01 / 0xBF02 or 0xBF03 (sources disagree, section 5.4); base: none |
| MFD1-L / -C / -R button frames | 4098:BEE1 / BEE0 / BEE2 | frame backlight | 0xBE0D |
| UFC1 + HUD1 | 4098:BEDE | backlight, UFC segment display, LCD backlight | UFC 0xBED0, HUD panel 0xBE0E |
| ICP | 4098:BF06 | backlight, DED pixel display | 0xBF06 |
| F18 Startup Panel | 4098:BE03 | backlight | none found |
| F18 Takeoff Panel 2 | 4098:BF05 | backlight, gear and indicator LEDs | 0xBF05 |
| MFD USB screens (x3) | 17E9:FF00 | none of the above: DisplayLink monitors | not applicable |

- Each WinWing device is **one USB HID interface with one top-level collection** [PC]: the PnP list has exactly one `USB\VID_4098&PID_xxxx` "USB Input Device" and one `HID\VID_4098&PID_xxxx` "HID-compliant game controller" per device, with no `&MI_` or `&COL` variants. So the lights and displays are driven through the same HID collection as the buttons (the game-controller one: usage page 0x01, usage 0x04 [Web: PROTOCOL-WINCTRL]), not through a separate vendor-defined collection. The public doc says an MFD frame in "1 split 3" mode shows three collections and only the first has an output report; the owner's frames are not in that mode [PC].
- Consequence [Inference]: any program that can open a game controller can send these reports, without admin rights. There is no "safe" interface that only carries lighting; the same channel carries the dangerous commands (section 6).
- The device's report descriptor (output report sizes, report ids) has **not** been read. It is the first read-only step (section 7, step 1).

---

## 3. What SimAppPro does today (the path to replace)

[Repo: `hardware-and-tools.md` 1c]

1. **DCS -> SimAppPro**: `Saved Games\DCS\Scripts\wwt\wwtExport.lua` sends JSON over UDP to `127.0.0.1:16536`: cockpit argument values SimAppPro subscribed to (`addOutput`), and the results of Lua snippets it sent (`addCommon`, for example `list_indication(6)` for the Hornet UFC).
2. **SimAppPro logic**: JS in `mainsrc/` maps cockpit values to LED indices, segment cells (`LCDContolCommon/F18.js`) and vibration effects (`DCSShakeEffect.js`, effect files under `%APPDATA%\SimAppPro\ShakeEffect`).
3. **SimAppPro -> device**: the native `WWTHID_JSAPI.node` / `WWTHID.dll`: `SetLedStateBySerialNumber(serial, index, 0-255)` (backlights, indicators **and motors**), `SetLcdState(serial, group, 4 bytes)` (UFC), `post0xF0(...)` (ICP, MCDU).

A replacement needs both halves: a data source (DCS-BIOS is installed on this PC and carries every value needed: dimmers, lamps, the UFC fields [Repo]) and the HID writes. RigReady must not imitate step 1's design: the wwt link runs arbitrary Lua sent over UDP [Repo].

---

## 4. Common transport

One vendor command channel, used for everything except the pixel displays:

- **Output report `0x02`, 14 bytes**: `02 | part id (u32, little endian) | length | command | payload...`. Part `0x00000001` is a broadcast. The device echoes with part id + 0x1000 [Web: PROTOCOL-WINCTRL; Repo].
- **Independent confirmation**: the Linux kernel driver `hid-winwing` sends `02 60 be 00 00 03 49 <led> <brightness> 00 00 00 00 00` with `hid_hw_output_report(..., 14)`, and says the bytes were captured from the vendor's app with usbmon [Web: kernel source]. Two sources that did not copy each other agree on the frame and on command `0x49`.
- **Report `0xF0`, 64 bytes**: chunks of a longer logical frame, for the ICP pixel display and the MCDU; acknowledged per chunk [Web: PROTOCOL-WINCTRL].
- State **latches**: there is no watchdog, so what was last written stays when the host exits [Web; Repo].
- SimAppPro may keep running, but its "sync with DCS" must be off for a panel another program drives, or the two overwrite each other [Web: dcs-signal-converter README].

Sources and their weight:

| Source | Licence | What it is | Weight |
|---|---|---|---|
| Linux kernel `drivers/hid/hid-winwing.c` | GPL-2.0 | Mainline driver: throttle grip LEDs, and rumble for two grips | Highest (reviewed, in mainline), but narrow, and not the owner's PIDs |
| `cbass2404/dcs-signal-converter`, `docs/PROTOCOL-WINCTRL.md` | MIT | Windows daemon driving PTO2, UFC+HUD, ICP, MFD frames, throttle II from DCS-BIOS; protocol document from USBPcap captures and SimAppPro's HID log | The only source for most of the owner's panels; single author, "beta", small user base |
| `rswilem/winctrl-xplane-plugin`, `schenlap/XSchenFly`, `landre-cerp/WwDevicesDotnet` | GPL-3.0 / GPL-3.0 / BSD-3-Clause | Airliner panels (FCU, EFIS, MCDU, PFP, Ursa Minor) on X-Plane / MSFS | Show the same channel is used across the product range; not the owner's devices |
| `llamaXc/winwing-ufc-addon`, `winwing-f16-ded` | BSD-2-Clause / none stated | Feed SimAppPro (fake wwt messages), or load WinWing's own DLLs | Not a route for RigReady: still needs SimAppPro or its binaries |

GPL code may be read to learn the protocol but must not be copied into RigReady (MIT). The MIT protocol document is the one to build from.

---

## 5. Per feature

### 5.1 Backlight brightness (panels, throttle, stick)

- **What SimAppPro does**: maps the cockpit dimmers (`CONSOLES_DIMMER`, `INST_PNL_DIMMER`, ...) and its own brightness sliders to `SetLedStateBySerialNumber(serial, index, 0-255)` [Repo].
- **Transport**: report `0x02`, command `0x49`: `02 <part id LE> 03 49 <index> <value> 00...`; dimmers 0-255; volatile (not stored) and echoed [Web: PROTOCOL-WINCTRL; kernel].
- **Publicly documented indices** [Web: PROTOCOL-WINCTRL]: Takeoff Panel 2 (part 0xBF05): 0 backlight, 1 gear lights, 2 "SL" (gates indicators 4-17), 3 flag, 4-17 indicators. UFC (0xBED0): 0 panel backlight, 1 LCD backlight. HUD panel (0xBE0E): 1 backlight. MFD frame (0xBE0D): 0 backlight. Orion Throttle Base II (0xBE60): 0 backlight, 1 A/A, 2 A/G.
- **Not public**: Orion Joystick Base 2 (BEA8), Throttle Base **1** (BD26), F18 Startup Panel (BE03). Their part ids and indices must come from a capture. The values the device remembers across power cycles are in flash and are written with command `0x06`, which is on the never-send list; a direct tool only sets the volatile level.
- **Feasibility**: yes for the documented panels. Effort: an HID output port in `src/platform/windows`, a per-device table (part id, indices), DCS-BIOS as the data source, write-on-change, clear on exit.
- **Risks**: the dangerous commands sit next to this one (`0x47` / `0x48` calibration beside `0x49`); see section 6. A wrong index on the right command only lights the wrong LED.
- **Smallest safe experiment**: section 7, steps 1-3 (Takeoff Panel 2 backlight to one level and back).

### 5.2 UFC and ICP displays

- **What SimAppPro does**: reads the Hornet UFC text with `list_indication(6)` through the wwt link, maps strings to segment cells (`F18.js` `DCSToCharPos`) and calls `SetLcdState(serial, group, 4 bytes)`; for the ICP it renders the DED into a bitmap and sends it with `post0xF0` [Repo].
- **UFC transport** [Web: PROTOCOL-WINCTRL]: command `0x4C`: `02 d0 be 00 00 06 4c <group 0x00-0x17> b0 b1 b2 b3 00`: four bytes of a 96-byte segment buffer per report, no acknowledgement, volatile. Cells straddle groups, so the host keeps a shadow buffer. A glyph table (36 cells, 105 glyphs) is in that repository (`data/displays/ufc1.json`); it can also be derived independently from a capture. Do not copy SimAppPro's own tables or fonts.
- **ICP transport** [Web: PROTOCOL-WINCTRL]: report `0xF0`: `f0 00 <seq> <chunk length 1-60> <data>`, carrying a frame with part id, function id (`0x102` write framebuffer, `0x103` commit), a host clock, a respond flag, a length and the payload; framebuffer 200 x 64 at 1 bit per pixel (1600 bytes); the device acknowledges each report. **Disagreement to resolve by capture**: `hardware-and-tools.md` gives the self-test function as `0x104`, the summary of the public doc read for this note gave `0x04`. Do not send either before the source and a capture agree.
- **Feasibility**: UFC medium (the hard part is the glyph map and the shadow buffer); ICP higher (chunking, acknowledgements, rendering the DED text into pixels). Both need the cockpit text, which DCS-BIOS exports (`UFC_OPTION_DISPLAY_1..5`, `UFC_SCRATCHPAD_*`, the F-16 DED lines).
- **Risks**: display writes are volatile and do not touch flash. The ICP path uses a second report id with its own function ids, some of which are firmware functions [Inference]; treat every function id not seen in a capture of normal use as forbidden.
- **Smallest safe experiment**: capture first (section 7, step 2) with the Hornet UFC showing a known string; only then one group write that reproduces a captured report byte for byte, which by construction changes nothing visible; then one cell.

### 5.3 MFD frame backlight

- **What SimAppPro does**: the same LED call; its code names a `Screen_Backlight` LED for the MFD (`DCSAPULight.js`) whose index was not extracted [Repo].
- **Transport** [Web: PROTOCOL-WINCTRL]: command `0x49` to part 0xBE0D, index 0 (frame backlight dimmer), for PIDs BEE0 / BEE1 / BEE2. This answers the frame-backlight half of the open item in `hardware-and-tools.md`; whether a separate index dims the screen panel itself is not public (the screen is a DisplayLink monitor, section 5.5, so probably not [Inference]).
- **Feasibility**: same as 5.1. Note the three frames share one part id and differ by USB device, so the write is addressed by opening the right device (by serial), never by broadcast.
- **Smallest safe experiment**: after the Takeoff Panel experiment has worked: one level on MFD1-C, then back.

### 5.4 Vibration motors

- **What SimAppPro does**: `DCSShakeEffect.js` computes effects (curves in a native DLL, effect files under `ShakeEffect`) and drives motors with the LED call, using LED indices from the device config's `DynamicVibrationMotor` map; its config has entries for 48647 (0xBE07), 48897 (0xBF01) and 48898 (0xBF02) [Repo].
- **Transport** [Web: kernel `hid-winwing`, rumble support]: two 14-byte output reports, `02 01 bf 00 00 03 49 00 <magnitude> 00 00 00 00 00` and `02 03 bf 00 00 03 49 00 <magnitude> 00 00 00 00 00`: command `0x49`, index 0, to parts 0xBF01 and 0xBF03, magnitude 0-255. The driver covers grips TGRIP-15E / 15EX on the Orion **2** base (4098:BD65 / BD64) only.
- **Open points**: the owner's throttle is Base **1** (BD26), not in the kernel table. The kernel uses parts 0xBF01 / 0xBF03; SimAppPro's config keys suggest 0xBF01 / 0xBF02. Which applies to the owner's handles, and the motor index, must be read from a capture. Nothing public was found for stick-base vibration.
- **Feasibility**: simple on/off pulses probably; matching SimAppPro's effects (gun, stall buffet, afterburner, touchdown) means writing an effect engine. Lowest priority.
- **Risks**: a motor is a latching output with no watchdog: if the host crashes mid-pulse it keeps running until something writes 0 or the device is unplugged. The timed variant (`0x4B`, LED with duration) is on the public never-send list, so timing must be done by the host. Long runs heat the motor [Inference].
- **Smallest safe experiment**: capture only. No write until the part id and index have been seen on this throttle, and then only with a tested "write 0" path and the USB cable within reach.

### 5.5 The USB MFD screens

- Each screen is a **DisplayLink USB graphics device** (17E9:FF00) that Windows shows as an ordinary monitor (`USB_Monitor`, 1024 x 768) [Repo: 1b]. Public pages agree: the vendor describes a "built-in USB graphics card chip", and users install the DisplayLink driver and then see normal monitors [Snippet].
- SimAppPro's part is configuration only: it writes the DCS viewport file and `options.lua`. RigReady already does this without it (DISP-005, DCS-MON-002 / 004; SAP-001 is waiting only for the in-game check).
- No vendor HID protocol on the screens was found, and none is needed. Brightness of the LCD panel itself is not controllable by any documented means; DDC/CI over DisplayLink is generally not available [Inference].
- **Experiment**: none. Do not send HID reports to 17E9 devices.

---

## 6. Risks

**Bricking and recalibration.** The command channel is shared with firmware functions. The public never-send list [Web: PROTOCOL-WINCTRL; Repo]: `0x04` restart, `0x06` write configuration (flash), `0x20`-`0x25` firmware update, `0x40` enter update mode, `0x43` set use counts, `0x47` / `0x48` calibration, `0x4B` LED with duration, `0x56` write parameter. `0x40` sits beside the harmless `0x41` / `0x42`, and `0x47` / `0x48` beside `0x49`: a one-off error in one byte is the realistic way to lose calibration or put a device into its bootloader. No public report of a third-party tool bricking a WinWing device was found; the bricking reports on the ED forum concern SimAppPro's own firmware updates, some through USB hubs [Snippet]. On this rig every WinWing device is three hubs deep [Repo: section 8].

Rules any write path must have, experiment or product:

1. An allow-list, not a deny-list: only `(report id, command, part id, index range)` tuples that were seen in a capture of SimAppPro on this rig may be sent. Everything else is refused in code before the HID call.
2. The report is built from a typed description (part, command, index, value), never from a hex string a person typed.
3. Fixed length (14 bytes for `0x02`), padded with zeros; the command byte is checked against the allow-list after the buffer is built.
4. One device at a time, addressed by VID, PID and serial; never the broadcast part id.
5. Write on change only, and write the restore values on exit.
6. No firmware, configuration or calibration command, ever. Persistent settings stay SimAppPro's job.

**Firmware changes.** WinWing updates firmware through SimAppPro; indices and part ids may change between versions. The public sources give no firmware versions. A product feature would have to read the firmware version (a read command exists in the public doc) and refuse versions it was not verified on. XSchenFly's README carries the same warning [Web].

**Two writers.** SimAppPro with "sync with DCS" on will overwrite anything RigReady writes, and vice versa. A setup must say who owns the lights.

**Licence and legal.** No SimAppPro licence text or WinWing statement about third-party tools was found on the web; **the owner should read the licence shown by the SimAppPro installer and note what it says about reverse engineering** (not done here: it means opening the installer). Interoperability research on hardware one owns is widely practised here (a mainline Linux driver, MobiFlight's WinWing support [Snippet]) but that is not a legal opinion. For the code base: build from the MIT protocol document and from the owner's own captures; do not copy code from the GPL projects; do not copy SimAppPro's code, tables, fonts or images; do not load or redistribute `WWTHID.dll` / `WWTHID_JSAPI.node`. Warranty: assume WinWing support will not help with a device damaged by a third-party write.

**Credentials.** The public protocol document obtained part of its data by setting `"HIDLog": true` in `%APPDATA%\SimAppPro\config.json`. That is the file holding the WinWing account name and password [Repo: 1a]. RigReady never reads or writes it, and the capture below does not need it.

---

## 7. The experiments, in order

For the owner to run later. Steps 1 and 2 send nothing. Step 3 is the single reversible write that SAP-005 asks for. Stop at the first surprise.

**Step 1: read the HID report descriptors (read-only, no install).**

- What: for each `HID\VID_4098&PID_xxxx` device, the top-level usage page and usage, and `OutputReportByteLength` / `FeatureReportByteLength` from `HidP_GetCaps`.
- How: `HidD_GetPreparsedData` + `HidP_GetCaps` on a handle opened with **no access rights** (`CreateFile` with desired access 0, share read+write). These return what Windows parsed when the device was plugged in; no report is sent. A koffi script in `tests/rig/` is the natural place (rig smoke is read-only by rule). Do **not** call `HidD_GetFeature` or `HidD_GetInputReport`: those do issue a transfer.
- Expected: one collection per device (already seen in PnP), usage page 0x01 usage 0x04, an output report length of 14 (report `0x02` + 13) and, on the ICP, 64 for `0xF0` [Inference from the public doc].
- Record: add the caps to `fixtures/rigs/mark-full/` (a new `hid-caps.json`) and to `docs/research/winwing-protocol.md`.

**Step 2: capture SimAppPro's own traffic (read-only for the devices; installs a capture driver).**

- Tool: USBPcap with Wireshark (https://desowin.org/usbpcap/). It installs a USB filter driver and wants a reboot: the owner's decision, not something an agent does. Uninstall it afterwards if it is not wanted.
- Procedure: start a capture on the root hub that carries the WinWing devices; start SimAppPro; in SimAppPro move the brightness slider of **one** device (Takeoff Panel 2) to three known levels (for example 0 %, 50 %, 100 %) with a pause between; stop. Then separate short captures: one indicator LED test, a Hornet cold start with the UFC showing a known string, the F-16 DED, one vibration test from SimAppPro's device page, MFD frame brightness. One feature per capture file.
- Filter: `usb.idVendor == 0x4098` and host-to-device transfers; in Wireshark `usbhid.data` or `usb.capdata` starting `02`.
- What to write down for each report: device (PID, serial), endpoint or control transfer (`SET_REPORT`), report id, length, the 14 bytes, and what was done in SimAppPro at that moment. Compare with section 5: part id, command, index, value.
- Store: the `.pcapng` files stay on the owner's PC or go into `docs/research/captures/` only after checking they hold nothing but HID traffic (a capture of the whole root hub also contains keyboard input: **do not type passwords while capturing**, and filter to VID 4098 before saving).
- Result: `docs/research/winwing-protocol.md` with the reports as seen, which closes the first criterion of SAP-005 and gives step 3 its allow-list.

**Step 3: one reversible write: one backlight level on one device.**

- Preconditions: step 2 shows, for the Takeoff Panel 2 (4098:BF05), a `0x02` report of 14 bytes with command `0x49`, index 0 and a value that tracks the slider. SimAppPro is closed (or its sync is off). DCS is closed. The panel is on a port where unplugging it is easy.
- Before: note the current level as SimAppPro shows it (the device also answers a read of its state in the public doc; only use that if the capture showed SimAppPro doing the same read).
- Write: exactly the captured report for 50 %, expected to be `02 05 bf 00 00 03 49 00 80 00 00 00 00 00` [Repo; confirm against the capture]. One report, through `HidD_SetOutputReport` or `WriteFile` on the collection from step 1, built by code that refuses any command other than `0x49` and any part other than `0xBF05`.
- Observe: the backlight goes to about half; the device echoes a report with part `0xCF05` [Web].
- Restore: send the same report with the value noted before. If anything looks wrong: unplug and replug the panel (the level is volatile, so a power cycle returns the stored value), then start SimAppPro, which sets its own level again.
- Where: a rig test under `tests/rig/` behind an explicit flag, in the style of the display-apply test (restore in `finally`), never part of `rig:smoke`. This is the "reversible prototype" of SAP-005's second criterion.
- Not in this step: indicator LEDs, any display, any motor, any other device.

**Later steps, each only after the one before worked and with its own capture as the allow-list:** an indicator LED on the Takeoff Panel (on, off); MFD1-C frame backlight; one UFC group (first a byte-for-byte replay of a captured report); a 100 ms motor pulse with a guaranteed off. The ICP display comes last.

---

## 8. What a product feature would need (not to be built yet)

- A port (`HidOutput`) implemented only in `src/platform/windows`, with a fake that records reports for tests; features never see raw bytes.
- A per-device table (PID, part ids, indices, verified firmware versions) as data, filled from captures, nothing hardcoded to the owner's serials.
- A data source: DCS-BIOS (already detected and managed in Export.lua by dcs-setup). RigReady would need a DCS-BIOS stream reader.
- Ownership: a setup declares whether SimAppPro or RigReady drives the lights; the existing `winwingRuntime` setting (SAP-003) is the place.
- Stand down writes the restore values.
- Until then, rule 2: no button, no setting, no page.

A cheaper alternative worth weighing first: recommend `dcs-signal-converter` as a helper app (RigReady already checks and starts helper apps), and keep RigReady out of the HID business entirely.

---

## 9. Not determined

- Output report lengths and ids on the owner's devices (step 1).
- Part ids and indices for the Orion Joystick Base 2, Throttle Base 1 and the F18 Startup Panel.
- Which handle part ids the F-15EX handles on Base 1 use (0xBF02 or 0xBF03 for the second), and the motor index.
- The ICP self-test function id (`0x104` or `0x04`).
- Whether the firmware versions on this rig match what the public document was verified on.
- What SimAppPro's licence says about third-party tools.
- Combat Panel 2: still not seen on this PC (`hardware-and-tools.md` section 0).

---

## Sources

- Linux kernel driver: https://raw.githubusercontent.com/torvalds/linux/master/drivers/hid/hid-winwing.c ; original LED patch https://lkml.rescloud.iu.edu/2402.2/01644.html ; rumble patch https://patchew.org/linux/20260307052246.GA21987@altimeter-info/
- dcs-signal-converter (MIT): https://github.com/cbass2404/dcs-signal-converter ; protocol document https://github.com/cbass2404/dcs-signal-converter/blob/main/docs/PROTOCOL-WINCTRL.md
- winctrl-xplane-plugin (GPL-3.0): https://github.com/rswilem/winctrl-xplane-plugin
- XSchenFly (GPL-3.0): https://github.com/schenlap/XSchenFly ; predecessor https://github.com/schenlap/winwing_fcu
- WwDevicesDotnet (BSD-3-Clause): https://github.com/landre-cerp/WwDevicesDotnet
- winwing-ufc-addon: https://github.com/llamaXc/winwing-ufc-addon ; winwing-f16-ded: https://github.com/llamaXc/winwing-f16-ded
- MobiFlight WinWing support [Snippet]: https://docs.mobiflight.com/game-controllers/winwing
- ED forum [Snippet; pages returned 403]: panel lights need SimAppPro https://forum.dcs.world/topic/309928-combat-ready-panel-controling-panel-lights-maybe-another-way/ ; a throttle that no longer enumerates after a SimAppPro firmware update https://forum.dcs.world/topic/338498-hotas-orion-only-flashes-green-ag-and-aa-keys-after-updating ; firmware updates through hubs https://forum.dcs.world/topic/367077-winwing-devices-and-updating-firmware-do-all-other-usb-devices-really-need-to-be-unplugged ; MFD screens with the DisplayLink driver https://forum.dcs.world/topic/317822-winwing-mfds-w-screens/
- USBPcap: https://desowin.org/usbpcap/ ; HID preparsed data: https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/preparsed-data
- This repository: `docs/research/hardware-and-tools.md` sections 0, 1a-1c and 8; `docs/research/dcs.md` section 4; `fixtures/rigs/mark-full/devices.json`.
