# DCS World: research for RigReady

Researched 2026-10-03 on the owner's rig. Everything was read only. Nothing under `Saved Games\DCS` or the DCS install was changed.

**How to read this document.** Each claim has a tag:

- **[verified]**: read directly from files, the registry or logs on this PC.
- **[source]**: read from DCS's own Lua source in the install, which is the code that actually runs. This is the strongest evidence for how DCS behaves.
- **[web]**: taken from the web, with the URL given. Not confirmed on this PC.
- **[inferred]**: a conclusion drawn from the evidence above it. It has not been tested.

Path abbreviations used throughout:

| Abbrev | Path on this PC |
|---|---|
| `INSTALL` | `C:\Program Files (x86)\Steam\steamapps\common\DCSWorld` (Steam edition) |
| `SG` | `C:\Users\Owner\Saved Games\DCS` (DCS calls this the "write dir", `lfs.writedir()`) |

Installed version: `bin\DCS.exe`, FileVersion `2.9.29.27468` [verified]. The last logged run (2026-07-26) was `DCS/2.9.28.26283 (x86_64; MT; ...)`. Steam shows another update waiting (see section 7).

---

## 1. Input bindings

### 1.1 Folder layout

User bindings live here [verified, source `Scripts/Input/Data.lua` `getProfileUserConfigPath_`, `loadDeviceProfileDiff_`]:

```
SG\Config\Input\
    disabled.lua                                  devices turned off in DCS's UI, plus the PnP flag
    wizard.lua                                    (optional, absent here) axis wizard results, keyed by full device name
    <UnitName>\                                   one folder per input profile, e.g. FA-18C_hornet, UH-1H
        modifiers.lua                             (optional) user modifiers for this aircraft
        joystick\<DeviceName> {GUID}.diff.lua     every DirectInput game controller, throttles included
        keyboard\Keyboard.diff.lua
        mouse\Mouse.diff.lua
        trackir\..., headtracker\...              same pattern
    UiLayer\, CameraFree\, ...                    non-aircraft layers, same structure
```

- **The folder name is the profile key, not the display name.** The aircraft's `entry.lua` declares `InputProfiles = { ["FA-18C_hornet"] = current_mod_path .. '/Input/FA-18C/' }` [verified, `INSTALL\Mods\aircraft\FA-18C\entry.lua` line 51]. That gives the Saved Games folder `FA-18C_hornet`, while the defaults sit in install folder `Input/FA-18C`. For the Huey it is `["UH-1H"] = .../input/UH-1H`, plus `UH-1H_Gunner` and `UH-1H_TrackIR_Gunner` [verified].
- The folder name is the profile key with `*/?<>|\:"` removed [source `getProfileUserConfigPath_`].
- The human-readable profile name comes from `<InputFolder>\name.lua`, for example `return _('F/A-18C')` [verified].
- **Device type folder.** `Input.getDeviceTypeName()` decides it. In practice every game controller, throttles included, goes in `joystick`. `Utils.lua` tries to detect a "Throttle" type, but its `string.find(result, 'Throttle')` searches the type name instead of the device name, so it never matches [source `Scripts/Input/Utils.lua` lines 28-43]. The owner's WinWing throttle is in `joystick\` [verified].
- `SG\Config\Input\FA-18C_hornet.backup\` exists on this PC. DCS ignores it because the name matches no profile. Someone (the owner or an earlier tool) made it as a backup [verified].

### 1.2 File name and the GUID

The file name is `<DeviceName> {<GUID>}.diff.lua`. DCS calls `<DeviceName> {<GUID>}` the device's "full id". `dcs.log` prints it on every start [verified, `SG\Logs\dcs.log`]:

```
INPUT (Main): created [WINWING MFD1-R] with full id [WINWING MFD1-R {806E0610-B756-11f0-8024-444553540000}],SUPPLEMENTAL|UNKNOWN
INPUT (Main): created [WINWING ICP] with full id [WINWING ICP {806DB7F0-B756-11f0-8020-444553540000}],JOYSTICK|LIMITED
INPUT (Main): created [T-Pendular-Rudder] with full id [T-Pendular-Rudder {7F3956A0-B756-11f0-801B-444553540000}],JOYSTICK|LIMITED
```

**DeviceName** is the DirectInput product name. Windows stores it as `OEMName` under `HKCU\System\CurrentControlSet\Control\MediaProperties\PrivateProperties\Joystick\OEM\VID_xxxx&PID_yyyy` (also under HKLM) [verified: for example, `VID_4098&PID_BEE0 = WINWING MFD1-C` and `VID_3344&PID_C259 = R-VPC Panel #1`]. Some vendors' names end in a space (DCS's own `DefaultAssignments.lua` says so for CH and VKB devices). Never trim it.

**The GUID is the DirectInput instance GUID**, stored as a 16-byte binary value `GUID` at:

```
HKCU\System\CurrentControlSet\Control\MediaProperties\PrivateProperties\DirectInput\VID_xxxx&PID_yyyy\Calibration\<n>\GUID
```

[verified: every GUID in the owner's file names matches one of these registry values; table in 1.3]. Facts about these GUIDs:

- They are **version-1 (time-based) UUIDs** whose node field is `444553540000` (ASCII `DEST`). The timestamp is when Windows first registered that controller. For example, `806D90E0-B756-11F0-801E-...` decodes to 2025-11-01 19:10, and `DF6F4BD0-FA0C-11F0-8002-...` decodes to 2026-01-25 16:42 [verified by decoding]. The 3rd/4th group (`80xx`) is a counter per allocation.
- **Text casing: copy DCS exactly.** DCS writes Data1, Data2 and Data4 in upper case and **Data3 in lower case**: `806D90E0-B756-11f0-801E-444553540000` [verified in every file name and in `dcs.log`]. Match case-insensitively, but write in DCS's style.
- **One entry per VID/PID plus a calibration slot `<n>`.** The three WinWing MFDs have different PIDs (`BEE0` = C, `BEE1` = L, `BEE2` = R), so they never collide [verified].
- **When a GUID changes** (evidence plus [web] reports):
  - The `Calibration\<n>` key is deleted, or Windows hands out a new slot. On this PC `VID_3344&PID_C259` (Virpil panel) has two slots, `\0` = `...8001` (Joystick Id 0, stale) and `\1` = `...8002` (Joystick Id 10, in use). Only one panel is plugged in [verified via `Get-PnpDevice`]. So this device's GUID has already changed once. DCS uses `...8002`.
  - Windows is reinstalled or the device is set up on a new PC (new registry, new timestamps).
  - **The firmware or grip changes the PID or product name.** WinWing encodes base and grip in both the PID and the name (`WINWING Orion Joystick Base 2 + JGRIP-F16`, PID `BEA8`). Swapping a grip gives a new PID, so a new GUID **and** a new name [inferred from the naming and the per-PID registry keys].
  - Forum reports of GUIDs changing after updates or reinstalls, fixed by renaming files: [forum.dcs.world/topic/386078](https://forum.dcs.world/topic/386078-control-device-ids-guids-how-are-they-generated/), [topic/343291](https://forum.dcs.world/topic/343291-lost-binds-after-re-install), [topic/122448](https://forum.dcs.world/topic/122448-migrating-to-a-new-pc-joystick-settings-missing/) [web].
- **Plugging into a different USB port** does not by itself change the GUID, because the key is per VID/PID, not per port [inferred]. With several *identical* devices, the order of the slots can swap [inferred, not testable here].

**The best way to find the current full id:** parse the `INPUT (Main): created [...] with full id [...]` lines in `SG\Logs\dcs.log` (written on every DCS start). Cross-check with the registry `Calibration\<n>\GUID` entries for the VID/PID. When a VID/PID has more than one slot, the registry alone cannot tell which slot is live. Use the log, or DirectInput enumeration (`IDirectInput8::EnumDevices` gives `guidInstance`).

### 1.3 The owner's devices (verified)

All 11 files are under `SG\Config\Input\FA-18C_hornet\joystick\`, last written 2026-01-30 to 2026-02-01. **There is no `UH-1H` folder**, so the Huey has never been bound and runs entirely on defaults. There is no `modifiers.lua`. `disabled.lua` disables nothing.

| Device name (file prefix) | GUID in file name | VID&PID \ slot | DCS type in log | Built-in default axis assignment | Default cleanup visible in the diff |
|---|---|---|---|---|---|
| R-VPC Panel #1 | DF6F4BD0-FA0C-11f0-8002-… | 3344&C259 \1 (slot \0 stale) | SUPPLEMENTAL | none listed, so the generic `default` set (see 1.5) | no `removed` entries |
| T-Pendular-Rudder | 7F3956A0-B756-11f0-801B-… | 044F&B68F \0 | JOYSTICK\|LIMITED | rudder Z, brakes Y/X | removes Pitch/Roll/Thrust (stale, see 1.8) |
| WINWING F18 STARTUP PANEL | 806D90E0-B756-11f0-801E-… | 4098&BE03 \0 | SUPPLEMENTAL | not in the panel list, so `default` | removes 4 axes and 8 POV views |
| WINWING F18 TAKEOFF PANEL 2 | 806E0610-B756-11f0-8025-… | 4098&BF05 \0 | SUPPLEMENTAL | panel list (no axes) | none |
| WINWING ICP | 806DB7F0-B756-11f0-8020-… | 4098&BF06 \0 | JOYSTICK\|LIMITED | panel list | removes Pitch/Roll |
| WINWING MFD1-C | 806DDF00-B756-11f0-8021-… | 4098&BEE0 \0 | SUPPLEMENTAL | panel list | none |
| WINWING MFD1-L | 7F3956A0-B756-11f0-801A-… | 4098&BEE1 \0 | SUPPLEMENTAL | panel list | none |
| WINWING MFD1-R | 806E0610-B756-11f0-8024-… | 4098&BEE2 \0 | SUPPLEMENTAL | panel list | removes 8 POV views |
| WINWING Orion Joystick Base 2 + JGRIP-F16 | 806DDF00-B756-11f0-8023-… | 4098&BEA8 \0 | JOYSTICK\|STANDARD | roll X, pitch Y | removes Rudder RZ and 4 POV views; `changed` pitch curve |
| WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R | 806DDF00-B756-11f0-8022-… | 4098&BD26 \0 | SUPPLEMENTAL | **not listed** (only the "Orion Throttle Base II" variants are), so `default` | 4 removed |
| WINWING UFC1 + HUD1 | 806E0610-B756-11f0-8026-… | 4098&BEDE \0 | 1STPERSON\|SIXDOF | panel list | 4 removed |

Other DirectInput devices in the registry: Fanatec Podium DD2 `0EB7&0007` (3 slots) and an Xbox 360 controller `045E&028E` (first registered today) [verified].

**[inferred]** MFD1-L, MFD1-C and the R-VPC panel have no `removed` entries. If those devices expose a POV hat, the default "View … slow" POV bindings are still live on them. Check this against the device's capabilities before claiming it.

### 1.4 The `.diff.lua` format

DCS writes it with `Serializer:serialize_sorted('local diff', diff)` followed by `file:write('return diff')` [source `Data.lua` `storeDeviceProfileDiffIntoFile_`, `Scripts/Serializer.lua` lines 362-425]. Byte-level facts [verified with `od -c`]:

- ASCII/UTF-8, **no BOM, LF line endings, tab indentation, no newline after `return diff`**.
- Keys are sorted with Lua `<` (byte order for strings; numbers before strings is impossible here because each table has one key type). Strings are written with `%q`. Numbers use Lua 5.1 `tostring`, which is `%.14g` (`0.15`, `1`, `-0.5`).
- Each key is written as `["key"] = ` or `[1] = `. Nested tables open with `{` and close with `},`. The top level closes with `}`.
- Top-level keys: `axisDiffs`, `keyDiffs`, and (for force-feedback devices) `ffDiffs`. A key is left out when it is empty. If all three are empty, DCS **deletes the file** (`os.remove`) [source `saveDeviceProfile`].

Real excerpt (`WINWING Orion Joystick Base 2 + JGRIP-F16 {806DDF00-B756-11f0-8023-444553540000}.diff.lua`, abridged):

```lua
local diff = {
	["axisDiffs"] = {
		["a2001cdnil"] = {
			["changed"] = {
				[1] = {
					["filter"] = {
						["curvature"] = {
							[1] = 0.15,
						},
						["deadzone"] = 0,
						["hardwareDetent"] = false,
						["hardwareDetentAB"] = 0,
						["hardwareDetentMax"] = 0,
						["invert"] = false,
						["saturationX"] = 1,
						["saturationY"] = 1,
						["slider"] = false,
					},
					["key"] = "JOY_Y",
				},
			},
			["name"] = "Pitch",
		},
		["a2003cdnil"] = {
			["name"] = "Rudder",
			["removed"] = {
				[1] = {
					["key"] = "JOY_RZ",
				},
			},
		},
		["a3043cd13"] = {
			["added"] = {
				[1] = {
					["filter"] = { ... ["invert"] = true, ["saturationY"] = 0.25, ... },
					["key"] = "JOY_RY",
				},
			},
			["name"] = "Throttle Designator Controller - VERTICAL AXIS",
		},
	},
	["keyDiffs"] = {
		["d3002pnilu3002cd13vd1vpnilvu0"] = {
			["added"] = {
				[1] = {
					["key"] = "JOY_BTN5",
				},
			},
			["name"] = "Gun Trigger - SECOND DETENT (Press to shoot)",
		},
		["dnilp32u214cdnilvdnilvpnilvunil"] = {
			["name"] = "View Left slow",
			["removed"] = {
				[1] = {
					["key"] = "JOY_BTN_POV1_L",
				},
			},
		},
		["dnilp36unilcdnilvdnilvpnilvunil"] = {
			["added"] = {
				[1] = { ["key"] = "JOY_BTN19", },
				[2] = { ["key"] = "JOY_BTN36", },
			},
			["name"] = "View Center",
		},
	},
}
return diff
```

Modifier ("reformer") example from `R-VPC Panel #1 {…}.diff.lua`:

```lua
		["d3011pnilunilcd53vd-1vpnilvunil"] = {
			["added"] = {
				[1] = {
					["key"] = "JOY_BTN34",
					["reformers"] = {
						[1] = "LCtrl",
						[2] = "LWin",
					},
				},
			},
			["name"] = "ALR-67 DIS TYPE Switch - CCW",
		},
```

#### Command keys (hashes)

These are built by `getKeyCommandHash` and `getAxisCommandHash` [source `Scripts/Input/Utils.lua` lines 470-517]:

- **Key command:** `d<down>p<pressed>u<up>cd<cockpit_device_id>vd<value_down>vp<value_pressed>vu<value_up>`. Each field is `tostring(value)`, so a missing field becomes the literal text `nil`. Example: `d3011pnilunilcd53vd-1vpnilvunil` means down=3011, pressed=nil, up=nil, cockpit device 53, value_down=-1.
- **Axis command:** `a<action>cd<cockpit_device_id>`, for example `a2001cdnil` (Pitch) or `a3043cd13`.
- The numbers are the command IDs from the default Lua. Cockpit commands (`hotas_commands.*`, `device_commands.Button_N`) and device IDs (`devices.HOTAS`) are defined in Lua in the install (`Mods\aircraft\<X>\Cockpit\Scripts\command_defs.lua` and `devices.lua`).
- **Engine commands (`iCommand*`) have no values in any Lua file.** The engine injects them through `Input.getEnvTable().Actions` [verified: `grep` found no definitions in `INSTALL\Scripts`, `Config` or `API`]. IDs seen in the owner's files: Pitch 2001, Roll 2002, Rudder 2003, Thrust 2004, Wheel Brake 2101, Wheel Brake Left/Right 2112/2113, View Left/Right/Up/Down slow 32/33/34/35 with up=214, View Center 36.
- **Do not use the hash to identify a command across languages or versions without care.** `name` is the *localized* name at save time. It is only a label.

#### Combo fields

- `key`: an event name.
  - Buttons: `JOY_BTN1`…`JOY_BTN128` (1-based; DirectInput button 0 is `JOY_BTN1`), and `JOY_BTN<n>_OFF` for the release-side event.
  - Hats: `JOY_BTN_POV1_U|UR|R|DR|D|DL|L|UL` up to `POV4`.
  - Axes: `JOY_X, JOY_Y, JOY_Z, JOY_RX, JOY_RY, JOY_RZ, JOY_SLIDER1, JOY_SLIDER2` (`SLIDER1` is DirectInput slider 0). Rarer axes: `JOY_V*`, `JOY_A*`, `JOY_F*`.
  - Keyboard: `LShift`, `F`, `Num+` and so on.
  - Full list: `INSTALL\Scripts\Input\InputEvents.lua` [source].
- `reformers`: a list of modifier names (keys of the effective `modifiers` table). Order does not matter for matching (`getComboReformersAreEqual_`).
- `filter` (axes only): `deadzone`, `saturationX`, `saturationY`, `hardwareDetent`, `hardwareDetentAB`, `hardwareDetentMax`, `invert`, `slider`, `curvature`.
  - Defaults are `0, 1, 1, false, 0, 0, false, false, {0}` [source `createAxisFilter`, `Data.lua` line 2184].
  - A one-element `curvature` is the standard curve. A multi-element `curvature` is a user curve with that many points.
  - When saving `added`, DCS leaves out a filter that equals the defaults (`cleanupCombo_(combo, true)`).
- `column`: optional, kept as-is if present (UI column). The owner's files do not have it.

#### Diff sections

- `added`: combos to add to this command.
- `removed`: default combos to remove from this command.
- `changed` (**axes only**): a default combo, same key and reformers, with a different `filter` [source `getCommandDiffAxis`].

#### How DCS applies a diff

From `applyDiffToCommands_`, `Data.lua` lines 757-800 [source]:

1. Build a map of every combo (key plus reformers) that appears in any `added` or `removed` entry in the file, recording which command it was added to or removed from.
2. For each **default** command: if one of its default combos is mentioned in the diff for **another** command, and *not* also removed from this command, DCS marks the command `updated` and **keeps** the default combo. Otherwise DCS strips from this command's defaults every combo mentioned anywhere in the diff (`added`, `removed` and `changed`).
3. Then, for this command's own entry: apply `removed`, then `added` (duplicates skipped), then `changed`. The default was stripped in step 2, so the `changed` combo with the new filter is re-added.

**Consequence for writers:** to move a button that DCS binds by default from command A to command B, write **both** `B.added` and `A.removed`. That is exactly what DCS's own save produces. If you write only `B.added`, A keeps the default too, and the button fires both commands.

### 1.5 Where the defaults come from

For each device the profile loads a **base layout**, then exactly one **diff** [source `Data.lua` `loadDeviceProfile_`, `loadProfileDefaultDeviceProfile_`, `loadProfile` lines 2093-2162].

**Base layout, first file found** (`folder` = the aircraft's InputProfiles path, `<type>` = `joystick`/`keyboard`/…, `<Template>` = device name with the ` {GUID}` suffix removed by `gsub('(.*)(%s{.*})','%1')`):

1. `<folder>\<type>\<Template>.lua`: a full, device-specific layout. Example: `INSTALL\Mods\aircraft\Uh-1H\Input\UH-1H\joystick\Joystick - HOTAS Warthog.lua` [verified that it exists].
2. `<folder>\<type>\default.lua`
3. `INSTALL\Config\Input\Aircrafts\Default\<type>\<Template>.lua` (aircraft profiles only)
4. `INSTALL\Config\Input\Aircrafts\Default\<type>\default.lua`

**Diff, the first one found, used on its own and never merged:**

1. User: `SG\Config\Input\<UnitName>\<type>\<Template> {GUID}.diff.lua`
2. Otherwise the **template diff** shipped by ED or the vendor: `<folder>\<type>\<Template>.diff.lua`. For example `INSTALL\Mods\aircraft\FA-18C\Input\FA-18C\joystick\WINWING MFD1-C.diff.lua`, which has the same format but no GUID [verified].

The source says so outright: `--!!! NOTE USERS DIFF IS COMPLETELY REPLACE TEMPLATE DIFF !!!` and `TEMPLATE DIFF IS NOT PART OF DEFAULT, USER DIFF WILL BE COPY OF TEMPLATE DIFF`. Two consequences follow:

- When DCS saves a device, the diff is computed against the base layout **without** the template diff (`baseKeyCommands`, `loadDefaults(false)`). Anything the template added is therefore written into the user file.
- Creating a user diff for a device that has a vendor template diff **throws the template away**. A tool that creates a user diff from nothing must first copy the template diff's entries in, if the user wants to keep them.

Template diffs present for FA-18C [verified]:

- WINWING: F18 COMBAT READY PANEL, F18 STARTUP PANEL, F18 TAKEOFF PANEL, JOYSTICK BASE1/BASE2 + F18 GRIP, JOYSTICK BASE2 + JGRIP-F16, MFD1-A, MFD1-B, MFD1-C, Orion Joystick Base 2 + JGRIP-F16 + MFSSB, Orion Throttle Base II + F18 HANDLE, THROTTLE BASE1 + F18 HANDLE, THROTTLE BASE2 (+ TGRIP-F16), UFC1 + HUD1.
- Others: Warthog, T.16000M, TWCS, VPC, MOZA, VKB, F16 MFD 1/2.

**Exact-name matches with the owner's devices:** "WINWING F18 STARTUP PANEL", "WINWING MFD1-C" and "WINWING UFC1 + HUD1". The owner has user diffs for all three, so the templates are ignored. There are no `.lua` full-layout templates for FA-18C.

UH-1H template files [verified]: CH PRO PEDALS USB.lua, Joystick - HOTAS Warthog(.lua/.diff.lua), Logitech G940 Joystick/Throttle.lua, Saitek Pro Flight Rudder Pedals.lua, Saitek X52 Flight Control System.lua, SideWinder Force Feedback 2 Joystick.lua, T.16000M, T.Flight Hotas X, Throttle - HOTAS Warthog, TWCS Throttle, VPC WarBRD + MT50, VPC-Throttle. **None matches the owner's hardware.**

#### What `default.lua` binds on every device

1. **Literal combos.**
   - FA-18C: `joystick\default.lua` starts with `external_profile("Config/Input/Aircrafts/common_joystick_binding.lua")`. That file binds `JOY_BTN_POV1_L/R/U/D/UR/DR/DL/UL` to "View … slow" **on every joystick device** [verified, lines 42-49].
   - UH-1H: `joystick\default.lua` has its own list. It binds the 8 POV views **plus `JOY_BTN5` = Center View, `JOY_BTN2` = "Pilot weapon release/Machinegun fire", `JOY_BTN1` = "Pilot's radio trigger RADIO", `JOY_BTN3` = "Pilot Trimmer"** [verified, lines 38-46, 207, 210, 225].
   - **[inferred]** The first time the owner opens the Huey, every one of the 11 devices will have buttons 1, 2, 3 and 5 and hat 1 bound.
2. **Axis assignments via `defaultDeviceAssignmentFor("roll"|"pitch"|"rudder"|"thrust"|"left_wheel_brake"|...)`**, which reads `INSTALL\Scripts\Input\DefaultAssignments.lua` [source, `Data.lua` lines 300-345]:
   - `wizard.lua` result for this full device name, if present; otherwise
   - `default_assignments[<Template>]`; if the device is not listed,
   - `default_assignments.default = { pitch='JOY_Y', roll='JOY_X', rudder='JOY_RZ', thrust='JOY_Z', fire='JOY_BTN1' }`.
   - Panels on the "no default assignments for panels" list (`AUX_PANEL_DEFAULT`) get **no** axes. The list includes WINWING ICP, MFD1-C/L/R, F18 COMBAT READY PANEL, F18 TAKEOFF PANEL (and PANEL 2), UFC1 (+ HUD1), F16 MFD 1-6, `RIGHT VPC Panel #1` and others [verified, lines 406-434].
   - **The owner's Virpil panel is named `R-VPC Panel #1`, not `RIGHT VPC Panel #1`. It is not on the list, so it gets the generic pitch/roll/rudder/thrust defaults.** Same for `WINWING F18 STARTUP PANEL` and `WINWING THROTTLE BASE1 + F15EX …` [verified].
   - The list only stops the axis defaults. **Literal combos (POV views, Huey buttons) still apply to panels.**
   - FA-18C axis commands using these: Roll, Pitch, Rudder, Thrust/Thrust Left/Thrust Right (via `MultiEngineDefaultDeviceAssignmentForThrust`), Wheel Brake Left/Right. UH-1H: Cyclic Roll, Cyclic Pitch, Rudder, Collective (`thrust`).
3. **Keyboard:** `<folder>\keyboard\default.lua` (FA-18C: 905 lines).

### 1.6 Recipes

**(a) Everything effectively bound on a device, defaults included.**

1. Find the base file using the order above. Evaluate it in a Lua 5.1 VM (for example `wasmoon` or `fengari`) with a sandbox that provides:
   - `folder`, `filename`, `deviceName`
   - `_ = identity`
   - `join`, `ignore_features`, `external_profile(path)` (paths are relative to `INSTALL`)
   - `defaultDeviceAssignmentFor`, `MultiEngineDefaultDeviceAssignmentForThrust`, `defaultFFB`, `bindKeyboardCommandsToMouse`
   - `dofile` (the files `dofile` `devices.lua` and `command_defs.lua` from the cockpit folder)
   - an `__index` metamethod that resolves `iCommand*` names
2. Build each command's combo list. Compute its hash. Apply the single effective diff (user, else template) using the algorithm in 1.4.
3. **The problem is `iCommand*` values.** Two workable approaches:
   - Ship an ID table. It can be harvested once from a running DCS by a `Scripts\Hooks` script that dumps `require('Input').getEnvTable().Actions` [inferred, not tested]. A community list exists on the forum [web: [forum.dcs.world/showthread.php?p=2472727](https://forum.dcs.world/showthread.php?p=2472727)].
   - Fall back to matching default commands to diff entries by English `name` plus the kind of action (down/pressed/axis). Diff entries always carry `name`.

   Cockpit-device commands (most of what panels bind) need no table.

**(b) Removing an unwanted default binding.** In the user diff for that device, add an entry for that command with a `removed` combo, for example the `dnilp32u214cdnilvdnilvpnilvunil` / `View Left slow` / `removed JOY_BTN_POV1_L` entry shown above.

- For an axis, use `["a2001cdnil"] = { name = "Pitch", removed = { { key = "JOY_Y" } } }`. This is exactly what the owner's STARTUP PANEL file does for Pitch/Roll/Rudder/Thrust and the 8 POV views.
- The `removed` combo needs only `key` (plus `reformers` if the default had them). DCS writes it without `filter` (`cleanupCombo_(combo)` without the default-filter check; the filter is only included if the default had one).
- If no user diff exists yet, start from the template diff's contents (see 1.5), or the template's bindings are lost.
- To silence a whole device, `disabled.lua` (`["devices"] = { ["<full id>"] = true }`) also works, but it removes all of the device's bindings.

**(c) Plain-language names and categories.**

- Each command in `default.lua` has `name = _('…')` and `category = _('…')` or `{ _('…'), _('…') }`; for example, `category = {_('Stick'), _('HOTAS')}` [verified].
- The English text inside `_()` is the msgid. For English (`SG\Config\lang.cfg` = `en`) it is the displayed name.
- Translations: `INSTALL\l10n\<lang>\LC_MESSAGES\input.mo` (gettext domain `input`, `InputUtils.localizeInputString` → `gettext.dtranslate('input', s)`) and per-module `Mods\aircraft\<X>\l10n\<lang>\LC_MESSAGES\messages.mo` [verified that the files exist].
- Key and button display names: `inputEvents.mo` with msgid `key-<EVENT>`, plus `Scripts\Input\DeviceSpecificInputEvents.lua` for per-device labels (Xbox and VR controllers only, no WinWing) [source].
- Axis commands in the UH-1H "joystick axes" block have no category [verified].

### 1.7 modifiers.lua

- Defaults: `<folder>\modifiers.lua`, falling back to `INSTALL\Config\Input\Aircrafts\modifiers.lua`:

  ```lua
  return {
    ['LShift'] = {key = 'LShift', device = 'Keyboard'},
    ... RShift, LAlt, RAlt, LCtrl, RCtrl, LWin, RWin
  }
  ```

  [verified]
- User file: `SG\Config\Input\<UnitName>\modifiers.lua`. A legacy fallback is `SG\Config\Input\modifiers.lua`. DCS writes it with `serialize_sorted('local modifiers', { [name] = { key=…, device=<full id>, switch=bool } })` and `return modifiers`. DCS **deletes** it when it equals the defaults [source `saveProfileModifiers_`, `loadProfileUserModifiers_`].
- **In the user file, `device` is the full id including ` {GUID}`.** In the default files it is the template name without GUID (`getDevicesHash_`) [source].
- A joystick button used as a modifier ("switch" or "modifier") therefore ties the file to a GUID.
- The owner has no user `modifiers.lua`. The reformers used (`LCtrl`, `LWin`) are keyboard defaults [verified].

### 1.8 Edge cases seen on this PC

- **Stale diffs are harmless.** `T-Pendular-Rudder` removes Pitch JOY_Y, Roll JOY_X and Thrust JOY_Z, and adds Rudder JOY_Z and brakes JOY_Y/JOY_X. That was written when the TPR used the generic defaults. The current `DefaultAssignments.lua` already gives the TPR rudder Z and brakes Y/X. `removeFoundCombos` ignores misses and `applyAddedCombos_` skips duplicates [source]. The same goes for the ICP's Pitch/Roll removals, now that the ICP is on the panel list.
- **DCS fixes up `Backspace` to `Back`** when it loads user key diffs (an old key rename) [source].
- **An entry whose command no longer exists in the defaults** is ignored on load. On the next save in DCS's UI it is dropped, with the log message "Cannot find base command for hash" [source].
- **The install's template diff for `WINWING MFD1-C` binds the Right MDI** (cockpit device 36). The owner's own MFD1-C diff binds other commands [verified]. Do not assume templates match how the owner uses a device.

---

## 2. GUID migration: what has to change

**Diff files: the file name only.** None of the owner's `.diff.lua` files contains a GUID or a device name; the device identity is only in the file name [verified: `grep` for GUID patterns over `SG\Config\Input` found nothing in contents]. The loader builds the path as `folder .. deviceName .. '.diff.lua'` [source].

A correct migration does all of the following:

1. **Rename** `…\<Unit>\joystick\<OldName> {OLD}.diff.lua` to `<NewName> {NEW}.diff.lua`, **in every unit folder** (FA-18C_hornet, UH-1H, UiLayer, CameraFree, …) and every device-type folder.
   - Write the GUID in DCS's casing (Data3 lower case).
   - Keep the name byte for byte, trailing spaces included.
2. **Rewrite contents** of:
   - `SG\Config\Input\<Unit>\modifiers.lua` and the legacy `SG\Config\Input\modifiers.lua`: every `device = "<Name> {OLD}"`.
   - `SG\Config\Input\disabled.lua`: the `devices` keys.
   - `SG\Config\Input\wizard.lua`: keys are the full device name [source `defaultDeviceAssignmentFor`].
3. **If the name also changed** (grip swap), the template, `DefaultAssignments` entry and base layout may differ. The old diff may then refer to buttons and axes the new device does not have. Warn; do not migrate silently.
4. **Collision:** if a file already exists for the new full id (DCS creates one only when the user saves in the controls screen), do not overwrite it. Offer a merge or replace with a backup.
5. Back up before renaming. DCS must not be running (section 8).

Mapping an old GUID to a new one: both are per VID/PID. Match on VID/PID (and the slot index, or serial when identical devices exist), using the registry plus the `dcs.log` "created … full id" lines. Do not match on the name alone (PRODUCT.md rule 4). The three WinWing MFDs have distinct PIDs, so they map one to one.

---

## 3. MonitorSetup

### 3.1 Where DCS looks

The options screen lists files from **both** `INSTALL\Config\MonitorSetup\*.lua` and `SG\Config\MonitorSetup\*.lua` [source `INSTALL\MissionEditor\modules\Options\optionsUtils.lua`]:

```lua
loadMonitorProfiles('Config/MonitorSetup/', values)
loadMonitorProfiles(lfs.writedir() .. 'Config/MonitorSetup/', values)
```

- Option value = **file name without `.lua`, lower-cased** (`string.lower(string.sub(fileName,1,-5))`). Display text = the file's `name`.
- When listing, each file runs in a sandbox with only `screen = {width=1,height=1,aspect=1}` and `math`. There is **no `displays`**, so a file must not error when `displays` is nil. ED's auto-placement samples guard with `if displays and #displays > 1`.
- `options.lua` → `graphics.multiMonitorSetup` picks the setup. On this PC it is `"wwtMonitor"`, with mixed case written by SimAppPro, while DCS's own value would be `"wwtmonitor"`. The log shows DCS loading it at runtime anyway [verified, `dcs.log` line 144]. **[inferred]** If the user changes graphics options in DCS, the value may be rewritten in lower case. That is harmless.
- `SG\Config\MonitorSetup\` **does not exist on this PC.** SimAppPro wrote its file into the **install** folder: `INSTALL\Config\MonitorSetup\wwtMonitor.lua`, modified 2026-07-26 14:11:10, about 1 minute before DCS started [verified]. Writing under `Program Files (x86)` normally needs admin rights. **RigReady should write to `SG\Config\MonitorSetup\` with its own file name.** What happens when two files share a name is undetermined.
- The built-in viewport editor saves to `SG\Config\MonitorSetup\` (`userFolder_ = lfs.writedir() .. 'Config\\MonitorSetup\\'`) [source `Scripts/UI/ViewportEditor.lua` line 59].

### 3.2 Format

A MonitorSetup file is a Lua chunk. Globals provided at runtime are `screen` (`width`, `height`, `aspect`, `x`, `y`) and `displays` (a list of `{x,y,width,height}`) [source, ED samples]. It sets:

- `name` (display name, usually `_('...')`) and `Description`
- `Viewports = { Center = { x, y, width, height, aspect, viewDx, viewDy }, … }`: 3D camera viewports.
- `UIMainView`: where the menus and UI draw. `GU_MAIN_VIEWPORT`: the main game viewport. Both usually `= Viewports.Center`.
- Exported displays as global tables `{ x, y, width, height }` named after the viewport names the aircraft asks for.

Coordinates are pixels **relative to the DCS window's top-left corner**. The window is sized from `options.lua` `graphics.width/height`. On this PC that is `7424×1440`, windowed (`fullScreen = false`), with `appSettings.lua` `windowPlacement = {x=0,y=0,w=7424,h=1440}` [verified]. In practice the desktop layout decides where each region lands.

The owner's file (`INSTALL\Config\MonitorSetup\wwtMonitor.lua`, **CRLF line endings**, written by SimAppPro) [verified]:

```lua
_  = function(p) return p; end;
name = _('winwing');
Description = 'Auto script by winwing,please no changes.'

Viewports =
{
	Center =
	{
		x = 0;
		y = 0;
		width = 5120;
		height = 1440;
		aspect = 3.5555555555555554;
	}
}
UIMainView = Viewports.Center
GU_MAIN_VIEWPORT = Viewports.Center

LEFT_MFCD =
{
	x = 5896;
	y = 256;
	width = 752;
	height = 762;
}

RIGHT_MFCD =
{
	x = 5128;
	y = 256;
	width = 752;
	height = 762;
}

CENTER_MFCD =
{
	x = 6664;
	y = 256;
	width = 752;
	height = 762;
}
```

### 3.3 Viewport names

- **F/A-18C:** `LEFT_MFCD` (left DDI), `RIGHT_MFCD` (right DDI), `CENTER_MFCD` (AMPCD) [source]:
  - `Mods\aircraft\FA-18C\Cockpit\Scripts\Multipurpose_Display_Group\MDI_IP1556A\indicator\MDI_left_viewport_cfg.lua` → `try_find_assigned_viewport("LEFT_MFCD")`
  - `MDI_right_viewport_cfg.lua` → `"RIGHT_MFCD"`
  - `AMPCD\indicator\AMPCD_viewport_cfg.lua` → `"CENTER_MFCD"`

  `try_find_assigned_viewport(name)` (in `Scripts\Aircrafts\_Common\Cockpit\ViewportHandling.lua`) copies `x,y,width,height` into `dedicated_viewport` and forces the display to render always. **There is no "AMPCD" name.**
- **UH-1H:** no exportable display. The only viewport script (`CARGO_CAM_init.lua`) uses `make_viewport` with no `try_find_assigned_viewport` [verified]. A Huey setup needs only `Center`, `UIMainView` and `GU_MAIN_VIEWPORT`.

### 3.4 How the three USB screens are addressed (this rig)

SimAppPro's own state is in `C:\Users\Owner\AppData\Roaming\SimAppPro\GameExtendDisplay\MFD\DCS_config.json` [verified]:

- Main monitor `\\.\DISPLAY2`: 5120×1440 at (0,0), landscape.
- Three DisplayLink USB screens, **rotated to portrait 768×1024**, at desktop x = 5120 (`DISPLAY5`), 5888 (`DISPLAY6`) and 6656 (`DISPLAY7`), y = 0.
- `modsInfo.FA-18C.instruments.LEFT_MFCD` → screen id `002` (DISPLAY6), with crop `tailorMonitor {left 8, top 256, right -8, bottom -6}`. Result: `gameMonitor {left 5896, top 256, width 752, height 762}`.
- RIGHT_MFCD → DISPLAY5 (x 5128). CENTER_MFCD → DISPLAY7 (x 6664). Each region is the screen minus a bezel crop (8 px left/right, 256 px top, 6 px bottom).

`SG\Config\appSettings.lua` (written by DCS) records the same layout under `monitors`: main at 0-5120, USB screens at 5120-5888, 5888-6656 and 6656-7424, each 1024 tall [verified].

**Right now the desk layout is active** [verified via `System.Windows.Forms.Screen`]: Dell `DISPLAY2` is primary at (0,0) 2560×1440, ultrawide `DISPLAY1` at x=2560, and the USB screens are **landscape 1024×768** at x = 7680/8704/9728 (DISPLAY7/6/5). So:

- MonitorSetup coordinates only fit one specific Windows layout. RigReady must apply (and check) the flying layout before launch: ultrawide primary at (0,0), USB screens portrait to its right, in a known order.
- The display numbers (`\\.\DISPLAYn`) differ between the two layouts. Identify screens by monitor hardware id (EDID or DisplayLink device path), not by `DISPLAYn` or position.
- Generating the file: for each display, take its desktop rectangle in the flying layout. Subtract the DCS window origin (0,0 when the main screen is primary and the window is at 0,0). Apply the optional bezel crop. Write `LEFT_MFCD`/`RIGHT_MFCD`/`CENTER_MFCD`.
- Set `options.lua` `graphics.width` = the bounding width (7424), `height` = 1440 and `multiMonitorSetup` = the file stem. SimAppPro also writes `aspect = width/height` (5.1555…); see `gameOptions` in its JSON.
- Which physical screen sits on the left of the rig cannot be told from files. SimAppPro's mapping (RIGHT DDI on the leftmost USB screen, LEFT DDI in the middle) may reflect cabling order. Confirm with the owner using a "show number on screen" step.

---

## 4. Export.lua

### 4.1 What is on disk now

The owner's file, `SG\Scripts\Export.lua`, is 143 bytes [verified]:

```
local wwtlfs=require('lfs')␍␊
dofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')␍␊
␍␊
dofile(lfs.writedir() .. [[Scripts\DCS-BIOS\BIOS.lua]])␊
```

- **Mixed line endings:** CRLF on the WinWing lines, LF on the DCS-BIOS line.
- **SimAppPro rewrites this file every time it starts.** The file's mtime is 2026-10-03 15:01:35.97, and `SimAppPro\log.log` shows `15:01:35.477 server listening` [verified]. So a RigReady edit can be overwritten by SimAppPro's own edit. Check the result after SimAppPro starts, and keep RigReady's lines independent of where they sit in the file.
- Installed tools: `SG\Scripts\wwt\{wwtExport.lua,wwtNetwork.lua}` and `SG\Scripts\DCS-BIOS\` (BIOS.lua, BIOSConfig.lua: TCP 7778, UDP multicast 239.255.50.10:5010). There is no SRS (`SG\Mods\Services` is absent), no Tacview (`SG\Mods\tech` is empty), no Helios and no `Scripts\Hooks`.

### 4.2 How each tool chains

DCS calls the global functions `LuaExportStart`, `LuaExportBeforeNextFrame`, `LuaExportAfterNextFrame`, `LuaExportActivityNextEvent(t)` and `LuaExportStop`. Each tool saves the previous global and wraps it.

- **WinWing (`wwtExport.lua`)** [verified]:
  - Runs once (`if g_winwingInit==nil`). Stores `LuaExportStart`, `LuaExportBeforeNextFrame`, `LuaExportActivityNextEvent` and `LuaExportStop`, and calls its own function first, then the previous one.
  - `ActivityNextEvent` passes its own return value `t` into the previous function and returns that function's result.
  - Talks UDP JSON to `127.0.0.1:16536` (SimAppPro listens there).
  - Needs `Scripts\JSON.lua` from the install and LuaSocket.
  - Line convention: `local wwtlfs=require('lfs')` + `dofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')`.
- **DCS-BIOS (`BIOS.lua`)** [verified, lines 88-177]: stores `PrevExport.LuaExportStart/Stop/BeforeNextFrame/AfterNextFrame` and calls them through `call_function_safe` (pcall) after its own work. Line: `dofile(lfs.writedir() .. [[Scripts\DCS-BIOS\BIOS.lua]])`.
- **SRS:**
  - Legacy line: `local dcsSr=require('lfs');dofile(dcsSr.writedir()..[[Scripts\DCS-SimpleRadioStandalone.lua]])`.
  - Current line (wrapped in pcall): `pcall(function() local dcsSr=require('lfs');dofile(dcsSr.writedir()..[[Mods\Services\DCS-SRS\Scripts\DCS-SimpleRadioStandalone.lua]]); end,nil);`

  [web: [forum.dcs.world/topic/244304](https://forum.dcs.world/topic/244304-exportlua-mess-hard-to-maintain/), [topic/203881](https://forum.dcs.world/topic/203881-trying-to-manage-exportlua-for-simshaker-voiceattack-vaicom-tacview/)]
- **Tacview:** legacy line `local Tacviewlfs=require('lfs');dofile(Tacviewlfs.writedir()..'Scripts/TacviewGameExport.lua')` [web: [tacview.fandom.com/wiki/Installation](https://tacview.fandom.com/wiki/Installation?oldid=784)]. Newer Tacview versions install as a mod under `SG\Mods\tech\Tacview` and need no Export.lua line [web/recollection, not confirmed here].
- **Helios:** `dofile(lfs.writedir()..[[Scripts\Helios\HeliosExport16.lua]])`. Helios can also manage Export.lua itself [web: [github.com/HeliosVirtualCockpit/Helios/wiki/DCS-Interface](https://github.com/HeliosVirtualCockpit/Helios/wiki/DCS-Interface)].
- Note that `lfs` is a global in the export environment. The `local xxx=require('lfs')` prefix is just each vendor's habit.

### 4.3 A safe algorithm to add or remove one tool

1. Read the file as bytes. Remember the BOM (none here) and keep each line's own ending. **Do not normalize line endings.**
2. Split into lines. A tool is identified by a **signature regex on the `dofile` target path** (case-insensitive, `/` and `\` treated as the same), not by exact text:
   - `Scripts[/\\]wwt[/\\]wwtExport\.lua`
   - `Scripts[/\\]DCS-BIOS[/\\]BIOS\.lua`
   - `DCS-SimpleRadioStandalone\.lua`
   - `TacviewGameExport\.lua`
   - `Scripts[/\\]Helios[/\\]HeliosExport\d*\.lua`
   - A tool's line may be one line that also holds a `local x=require('lfs')` prefix (SRS, Tacview), or two lines (WinWing). The WinWing `local wwtlfs=require('lfs')` line belongs to the following `dofile`. Remove it only if no other line still uses `wwtlfs`.
3. **Add:** if the signature is already present on a line that is not commented out, do nothing. Otherwise append the tool's canonical line at the **end** (each tool wraps the previous globals, so order is about precedence, not correctness). Use the line ending that dominates the file, or CRLF for an empty file. Wrapping in `pcall(function() … end)` is optional. It protects other tools if the target file is missing.
4. **Remove:** delete only the lines that match the signature, plus a `local <x>=require('lfs')` line whose variable is no longer referenced. Never touch other lines, comments or blank lines.
5. Leave lines that start with `--` alone (the user disabled them on purpose). Report them as "present but disabled".
6. Write atomically: temp file, then rename. Back up first. Do this only when DCS is not running (Export.lua is read at mission start, section 8).
7. **Afterwards:** if SimAppPro is running or will start, re-check after it starts, because it rewrites the file.

---

## 5. Kneeboard pages

From `INSTALL\Scripts\Aircrafts\_Common\Cockpit\KNEEBOARD\indicator\init.lua` [source]:

```lua
local user_path    = lfs.writedir().."KNEEBOARD"
local unit_name    = get_aircraft_type()
...
scan_path(terrain_path..'/'..unit_name); scan_path(common_path ..'/'..unit_name); scan_path(user_path ..'/'..unit_name)
scan_path(terrain_path); scan_path(common_path); scan_path(user_path)
```

- **Folders:** `SG\Kneeboard\<unit type>\` for one aircraft, and `SG\Kneeboard\` for every aircraft. Windows is case-insensitive; the existing folder is `SG\Kneeboard`, and it is empty [verified].
  - `<unit type>` is the unit type name: `FA-18C_hornet` and `UH-1H` (the same as the input profile keys). WinWing's export logged `WWT (Main): FA-18C_hornet` from `LoGetSelfData().Name` [verified].
  - Per-map folders also exist: `<terrain>\KNEEBOARD\<unit>`.
- **Formats:** files whose **last 4 characters** are exactly `.dds`, `.bmp`, `.jpg`, `.png` or `.tga`. **The match is case-sensitive**, so `.PNG` and `.jpeg` are ignored. A `.lua` file becomes a scripted page. Subfolders are not scanned recursively.
- **Order:** the order `lfs.dir` returns (alphabetical on NTFS in practice). Use zero-padded prefixes: `01-…png`.
- **Size:** the image is stretched onto a quad of aspect `GetAspect()` (the kneeboard's own aspect). No fixed resolution is required. A portrait 3:4 image such as **768×1024** is the usual recommendation; 1536×2048 is sharper in VR [web: [flyawaysimulation.com kneeboard guide](https://flyawaysimulation.com/ask/answers/dcs-world-kneeboard-files-custom-pages/), [forum topic/214760](https://forum.dcs.world/topic/214760-custom-kneeboards/)]. PNG is best for text-heavy cheat sheets.
- Pages are loaded when the cockpit loads, so new files show up in the next mission [inferred].

---

## 6. options.lua and other pre-flight checks

`SG\Config\options.lua`: `options = { ... }` with **no `return`**. LF line endings, tabs, sorted keys, no BOM, and a trailing `\n` after the closing `}` [verified]. DCS writes it with the same serializer style. Top-level keys: `VR`, `difficulty`, `format` (= 1), `graphics`, `miscellaneous`, `plugins`, `sound`, `views`.

Useful checks (owner's values in brackets) [verified]:

| Check | Path in options.lua | Owner value |
|---|---|---|
| VR on or off | `VR.enable` | `false` |
| Monitor setup | `graphics.multiMonitorSetup` | `"wwtMonitor"` (file must exist in INSTALL or SG `Config\MonitorSetup`, case-insensitive) |
| Render size | `graphics.width` / `graphics.height` / `graphics.aspect` | 7424 / 1440 / 5.1555555555556 |
| Fullscreen | `graphics.fullScreen` | `false` (needed for multi-monitor spanning) |
| Sync / FPS cap | `graphics.sync`, `graphics.maxFPS` | false, 180 |
| Audio devices | `sound.main_output`, `sound.hp_output`, `sound.voice_chat_input/output` | all `""` (system default) |
| Force feedback | `miscellaneous.force_feedback_enabled` | `true` |
| New launcher on start | `miscellaneous.launcher` | `true` |
| Synchronize cockpit controls | `miscellaneous.synchronize_controls` | `false` |
| TrackIR outside views | `miscellaneous.TrackIR_external_views` | `true` |

Other files a pre-flight check can use:

- `SG\Config\appSettings.lua` (written by DCS): `windowPlacement {x,y,w,h}` and `monitors[]` with `rcMonitor` and `rcWork`. This is the monitor layout DCS saw last time [verified]. Compare it to the current layout.
- `SG\Config\Input\disabled.lua`: no device that a profile needs should be listed.
- Monitor setup sanity: every `*_MFCD` rectangle must fall inside one physical display of the current Windows layout, after adding the DCS window origin.
- `SG\Scripts\Export.lua` contains the signatures the profile needs (section 4). Optionally, the UDP/TCP ports are free: SimAppPro 16536, DCS-BIOS 7778/5010.
- `SG\Logs\dcs.log` after a run: the input device list (section 1.2), the `DX11Renderer initialization (w:7424 h:1440 fullscrn:0 …)` line, and `WWT (Main): Winwing export installed!` [verified].
- `SG\Config\lang.cfg` (`en`) decides which `.mo` files apply.

---

## 7. Launching DCS and detecting its version

**Steam (this PC):**

- Install folder from `C:\Program Files (x86)\Steam\steamapps\libraryfolders.vdf` (app `223750`) and `appmanifest_223750.acf` (`installdir "DCSWorld"`). Also from `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 223750` → `InstallLocation` [verified].
- Steam path: `HKCU\Software\Valve\Steam\SteamExe` [verified].
- The install root contains a 2-byte marker file `_DCS_Steam` (`ED`) [verified]. There are no Eagle Dynamics registry keys for the Steam edition [verified].
- Launch options:
  - `steam://rungameid/223750` (no `shell:` string building; open the URL with the shell API).
  - `steam.exe -applaunch 223750 [args]`.
  - Launching `INSTALL\bin\DCS.exe` directly. The last run's log shows `Command line: "…\bin\DCS.exe" --restarted` and `MT` in the version string, so `bin\DCS.exe` is the multithreaded build [verified]. Steam must be running for authorization (`Successfully got Steam authorization data`).
  - `bin-mt\DCS.exe` also exists, with the same version 2.9.29.27468 [verified]. It is legacy; newer builds put MT in `bin` [web: [forum topic/353716](https://forum.dcs.world/topic/353716-multithread-or-single-thread-option-in-launcher/), [steamcommunity discussion](https://steamcommunity.com/app/223750/discussions/0/4301571777486010728)].
- **Version:**
  - `INSTALL\bin\DCS.exe` file version (`2.9.29.27468`).
  - `appmanifest_223750.acf` `buildid` (`25079893`).
  - **Update pending:** `TargetBuildID 25625823 ≠ buildid` and `StateFlags 6` (4 = installed + 2 = update required), `BytesToDownload 2372391645` [verified]. So an update is waiting right now.
  - "DCS updated since the last snapshot" = DCS.exe version or `buildid` changed. Also `Launcher.edce` and `manifest.bin` mtimes (2026-09-04 on this PC). `dcs.log` line 2 also has `DCS/<version>`.

**Standalone (not on this PC; [web]):**

- Exe: `<install>\bin\DCS.exe`. Updater: `<install>\bin\DCS_updater.exe` (update, repair, branch switching).
- `<install>\dcs_variant.txt` sets the write dir name: `Saved Games\DCS.<variant>`, for example the old `DCS.openbeta` [web: [forum topic/293895](https://forum.dcs.world/topic/293895-question-on-directory-and-folders-for-multiple-installs), [topic/290157](https://forum.dcs.world/topic/290157-stable-install-messed-up-uses-open-beta-saved-games-folder/)].
- `autoupdate.cfg` in the install root lists the branch and modules.
- Install path in `HKCU\Software\Eagle Dynamics\DCS World` (`Path`) [recollection, not confirmed].

**Arguments [web]:**

- `--force_enable_VR`, `--force_disable_VR`, `--force_OpenXR` [web: [vronlinux.org DCS page](https://wiki.vronlinux.org/docs/games/dcs-world/), [forum topic/147322](https://forum.dcs.world/topic/147322-how-to-switch-between-vr-and-monitor-mode)].
- `-w <name>` (write dir suffix) is widely used but no official documentation was found; treat it as unconfirmed.
- Use `--force_disable_VR` for "Fly flat" profiles instead of editing `VR.enable`.

**Write dir:** resolve Saved Games through the Known Folder API (`FOLDERID_SavedGames`), not `%USERPROFILE%\Saved Games`. Then add `DCS` (Steam), or `DCS.<variant>` when a standalone `dcs_variant.txt` exists.

---

## 8. Risks

- **Files DCS rewrites on exit** (all mtimes 2026-07-26 14:28, the time of the last exit) [verified]:
  - `SG\Config\options.lua`, `appSettings.lua`, `ChatPosition.lua`, `imgui.ini`, `loaderSettings.json`, `vc_options.json`
  - `SG\logbook.db`, `SG\launcher.sqlite3`

  Edits to these while DCS runs are **lost**. Write them only when `DCS.exe` is not running.
- **Input diffs:**
  - DCS writes them when the user presses OK in Controls. A save recomputes every changed device's file from DCS's in-memory state, which overwrites outside edits and **deletes** files that end up empty.
  - DCS re-reads diffs when a device is plugged or unplugged (`onDeviceChange` → `unloadProfile`/`createProfile`) [source `Loader.lua`]. A half-written file could be loaded mid-flight. **Never edit input files while DCS runs.** Write atomically.
- **Export.lua** is loaded at mission start [inferred from the `WWT` log order: installed, then start]. Edits during a session take effect next mission. SimAppPro rewrites it when it starts (section 4.1).
- **MonitorSetup** is read when DCS starts. SimAppPro writes `wwtMonitor.lua` into the install folder when the user applies a layout. A DCS repair may remove that file, since it is not ED's [inferred].
- **Encoding:**
  - DCS's own files are ASCII/UTF-8 without BOM, with LF line endings [verified]. DCS's Lua 5.1 loader does not accept a UTF-8 BOM in `loadfile`, so never write one [inferred from Lua 5.1 behaviour].
  - Third-party files mix line endings (WinWing uses CRLF, and Chinese comments in UTF-8 in `wwtExport.lua`). Preserve whatever is there.
  - Device names are UTF-8. Paths may need long-path handling, since file names reach about 100 characters.
- **Lua evaluation safety:** do not run user or vendor Lua with full I/O. Use a sandboxed VM with no `io` or `os`, or a strict data-only parser for `.diff.lua`, `options.lua`, `modifiers.lua` and `disabled.lua`. Those are pure table literals.
  - MonitorSetup files are real code (`if displays…`) and need a sandboxed evaluator with `screen`, `displays` and `math`.
  - `default.lua` needs the sandbox described in 1.6.
- **Admin rights:** `INSTALL` is under `Program Files (x86)`. Only read it. Write to `SG`.

---

## Implementation checklist

1. Resolve `SG` via `FOLDERID_SavedGames` + `DCS` (or `DCS.<dcs_variant>`). Resolve `INSTALL` via Steam's `libraryfolders.vdf` / `appmanifest_223750.acf` or the uninstall key. Never write to `INSTALL`.
2. Refuse to write any DCS file while `DCS.exe` (from `bin` or `bin-mt`) is running. Back up first, then write via temp file and rename.
3. Treat `.diff.lua`, `options.lua`, `modifiers.lua` and `disabled.lua` as Lua table literals. Parse them with a data-only parser that accepts `["k"] = v,` and `[n] = v,`, `true/false`, numbers and `%q` strings, with an optional leading `local x =` and trailing `return x` (or `options = {…}` with no return).
4. Write `.diff.lua` exactly as DCS does: `local diff = {` + LF; keys sorted by byte order; tab indent; `["key"] = value,`; numbers as `%.14g`; strings `%q`-escaped; inner tables end with `},`, the outer with `}`; then `return diff` with **no trailing newline**; no BOM. If `axisDiffs`, `keyDiffs` and `ffDiffs` are all empty, delete the file instead.
5. Identify commands by their hash key (`d…p…u…cd…vd…vp…vu…` / `a…cd…`). Use `name` for display only (it is localized).
6. Match combos on `key` plus the *set* of `reformers`. `changed` applies to axes only.
7. To cancel a default, add `removed = { { key = … [, reformers = …] } }` under the default command's hash in the **user** diff. To move a default button, write both `removed` (old command) and `added` (new command).
8. Effective bindings = base (`<Template>.lua` → `default.lua` → `Config\Input\Aircrafts\Default\…`) + **exactly one** diff (user `<Name> {GUID}.diff.lua`, else template `<Template>.diff.lua`). Never merge the two. When creating a user diff where a template diff exists, start from the template's entries.
9. Template name = the full id with `\s{…}` removed. Keep trailing spaces in names.
10. GUID text: Data1/Data2/Data4 upper case, Data3 lower case. Match GUIDs case-insensitively.
11. Current full ids come from `SG\Logs\dcs.log` `created [...] with full id [...]` plus the registry `DirectInput\VID_&PID_\Calibration\n\GUID`. Key profiles by VID/PID (+ slot or serial), not by name.
12. GUID migration: rename `.diff.lua` files in every unit folder and type folder, **and** rewrite full ids inside `modifiers.lua` (per unit and legacy root), `disabled.lua` and `wizard.lua`. Never overwrite an existing target file. Warn if the device name also changed.
13. Effective-binding display needs `iCommand*` IDs. Ship or harvest an ID table, and fall back to name matching. Cockpit commands come from `command_defs.lua` and `devices.lua`.
14. Defaults to offer to clean up: on FA-18C, POV1 views on every device, plus generic axes on devices missing from `DefaultAssignments.lua` (owner: R-VPC Panel #1, F18 STARTUP PANEL, WinWing THROTTLE BASE1). On UH-1H, also `JOY_BTN1/2/3/5` on every device.
15. MonitorSetup: write `SG\Config\MonitorSetup\<RigReadyName>.lua` (LF, ASCII). Define `name`, `Description`, `Viewports.Center`, `UIMainView`, `GU_MAIN_VIEWPORT`, plus `LEFT_MFCD`/`RIGHT_MFCD`/`CENTER_MFCD` for the Hornet. Guard any `displays` use. Set `options.lua` `graphics.multiMonitorSetup` to the lower-cased file stem and `width`/`height`/`aspect` to the bounding box. Check that the flying Windows layout is active first.
16. Export.lua: add or remove by `dofile`-target signature. Preserve each line's ending and every unrelated line. Leave commented lines alone. Re-check after SimAppPro starts.
17. Kneeboard export: lower-case `.png` files named `NN-title.png`, portrait 3:4 (for example 1536×2048), in `SG\Kneeboard\FA-18C_hornet\` or `SG\Kneeboard\UH-1H\`.
18. Version and update detection: `bin\DCS.exe` FileVersion + `appmanifest` `buildid`/`TargetBuildID`/`StateFlags`. Re-validate defaults-dependent data (default.lua, DefaultAssignments.lua) when the version changes.

## Still open

- The numeric values of the `iCommand*` engine constants, and whether a Hooks script can read `Input.getEnvTable().Actions`.
- Which MonitorSetup file wins when the same name exists in both `INSTALL` and `SG`.
- Whether DCS normalizes the mixed-case `multiMonitorSetup` value when it saves options.
- Whether MFD1-L, MFD1-C and R-VPC Panel #1 expose POV hats, which would mean the default view bindings are live on them.
- How the owner's WinWing-related diffs were created (DCS's UI or SimAppPro presets).
- Whether `-w` is an official command-line argument.
- The exact layout of current Tacview and SRS installs. Neither is installed here.
