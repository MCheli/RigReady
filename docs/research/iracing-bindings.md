# iRacing bindings: what the files hold, what can be read, and what is left to prove before RigReady writes them

Research date: 2026-11-12, updated 2026-11-13 (control profiles, the rig test of 13 Nov, the key records). Machine: the owner's rig. Read `docs/research/racing.md` section 2 first; this document goes deeper into `controls.cfg`, describes the writer that is built and switched off, and gives the steps that prove it on the rig.

The marks are those of `racing.md`: **[V]** verified by reading the files on this machine, **[W]** from the web with the URL, **[I]** inferred from verified data, **[?]** unknown.

Everything here was learned read-only, from copies of the owner's `Documents\iRacing\controls.cfg` and `joyCalib.yaml`, by listing `Documents\iRacing\setups`, and on 13 Nov by reading the control profile, the `[ControlProfiles]` section of `app.ini` and the names of the files under `Documents\iRacing`. iRacing was not started for this research. Nothing was written to the iRacing folder: the writer has only run on the recorded files and on copies in temp folders. Of `app.ini` only the recorded copy is in the repository, with one section added for the scenario tests.

## The short answer

- **Since 2026 Season 3 iRacing reads a control profile, not `Documents\iRacing\controls.cfg`.** The build on the rig (2026.11.02.01) made `Documents\iRacing\profiles\controls\Baseline\controls.cfg` on its first run and reads that. RigReady read and wrote the older file until 13 Nov, so its page showed bindings iRacing no longer uses. It now reads, and writes, the profile `app.ini` names. See "Control profiles".
- **Reading is reliable.** Every byte of the real files is accounted for by position, each can be taken apart and put together again byte for byte, and each record says whether all of its 68 bytes are understood. All 367 of the older file and all 369 of the profile are.
- **Writing one binding is built and switched off.** `core/edit.ts` binds one action to a controller button or a key, or clears it, and changes 60 bytes of that one record and nothing else. It is not reachable in the product: unless RigReady is started with `RIGREADY_IRACING_EDIT=1` in its environment, the page has no edit buttons and the channels that change anything answer with an error. See "The writer" and "The switch".
- **One thing is not proven: that iRacing accepts a file RigReady changed.** The rig test of 13 Nov changed the older file, which iRacing 2026.11 does not read, so it proved nothing either way, for buttons or for keys (see "The rig test of 13 Nov 2026"). "The second look" below is the proof still to be done, now on the profile.
- With the switch off, `src/features/iracing-bindings` shows bindings, has no edit buttons, and says why on the page.

## The files

| File | What it holds | Format |
|---|---|---|
| `Documents\iRacing\profiles\controls\<name>\controls.cfg` | iRacing 2026 Season 3 and later: every action and its binding, in the control profile `<name>` | The same as the older file **[V]**, see "Control profiles" |
| `Documents\iRacing\profiles\controls\<name>\joyCalib.yaml` | The calibration of that profile | The same as the older file **[V]** |
| `Documents\iRacing\app.ini`, section `[ControlProfiles]` | `Global=<name>`: the profile iRacing loads for all cars | Text **[V]** |
| `Documents\iRacing\controls.cfg` | Before control profiles: every action and its binding, for all cars. Left as it was once a profile exists | Binary, described below **[V]** |
| `Documents\iRacing\joyCalib.yaml` | Each calibrated controller: its name, both GUIDs, and its axes with names and calibration | Text, one key per line **[V]** |
| `Documents\iRacing\setups\<car>\controls.cfg` | Before control profiles: the same, for one car with "Use custom controls for this car" | Assumed the same as the main file **[W/I]**, see "Per-car bindings" |
| `Documents\iRacing\setups\<car>\joyCalib.yaml` | Calibration for that car | Assumed the same **[W/I]** |

iRacing publishes no description of `controls.cfg`. Its support pages only say to delete `controls.cfg` and `joyCalib.yaml` to start again **[W]** (https://support.iracing.com/support/solutions/articles/31000133335).

## `controls.cfg`, byte by byte [V]

The recorded file is 30,412 bytes. All numbers are little-endian.

```
0x0000  "GFCC"
0x0004  u32 20
0x0008  u32 30400            the file size minus 12
0x000C  u32 2
0x0010  u32 3
0x0014  u32 900
0x0018  u32 900
0x001C  131 bytes of settings: floats (1.8, 25.22, 100.0, 25.18, 50.0, 1.0, 1.0) and single-byte flags
0x009F  "LRTC"
0x00A3  u32 8
0x00A7  u32 30239            the length of the records that follow
0x00AB  the records, up to byte 30410
30410   20 20                two bytes after the last record
```

**[?]** What the settings between `0x001C` and `0x009F` mean. They look like wheel and force feedback settings (floats near 25.2, 100, 50, 1.0), but nothing confirms it. **[?]** Whether any of the header values depends on the records (a count or a check value). Nothing in it equals 367 or an obvious sum, but that is not proof.

**The two bytes at the end.** The control profile that iRacing 2026.11 wrote from this file ends right after its last record, without them **[V]**. So they are not something iRacing needs; **[I]** they are left over from an older writer.

### A record

A record is the action's name in ASCII, a NUL, and exactly 68 bytes. The file has 367 records and they fill the `LRTC` length exactly.

| Offset after the NUL | Size | Meaning |
|---|---|---|
| +0 | u32 | A flag, 0 or 1. **[?]** Its meaning is not known. It is 0 on every action that accepts an axis and on 27 button or key actions, and 1 on the other 247. |
| +4 | u32 | Which kinds of input the action accepts, one bit each: `0x01` axis, `0x02` button, `0x04` key. Bits `0x08`, `0x10` and `0x20` also occur and are **[?]**. |
| +8 | u32 | The kind of binding: 0 nothing, 1 axis, 2 button, 4 key. The value is the same bit as in the mask. |
| +12 to +67 | | Depends on the kind, below. Unused bytes are zero in every record. |

| Kind | Fields |
|---|---|
| Axis (1) | +12 u32 iRacing's axis number on that device (the `Axis` of `joyCalib.yaml`); +16 u32 0; +20 instance GUID, 16 bytes; +36 product GUID, 16 bytes; +52 u32 direction: 1 on `SteerRight`, 0 everywhere else |
| Button (2) | +12 a 128-bit mask, bit n is button n counted from zero (RigReady shows n + 1, as Windows does); +28 eight zero bytes; +36 instance GUID; +52 product GUID |
| Key (4) | +12 u32 iRacing's own key code (the table is in `racing.md` 2.4); +18 one byte of modifiers |
| Nothing (0) | all zero |

Note that the GUIDs sit at different offsets for an axis and for a button.

**Modifiers [V/W].** The byte at +18 uses two bits per modifier: Shift `0x03`, Ctrl `0x0C`, Alt `0x30`. The recorded file has every combination (0, 3, 12, 15, 48, 51, 60, 63). The reading was checked against iRacing's own published default keys, which match binding for binding: https://www.iracing.com/keyboard-shortcuts/ and https://www.iracing.com/keyboard-shortcuts-camera-editor/. **[I]** The two bits are probably the left and the right key; only both-set was seen.

**The mask groups in the recorded file [V]:**

| Flag | Mask | Count | Examples |
|---|---|---|---|
| 0 | `0x1F` | 54 | `Throttle`, `Brake`, `Clutch`, `ShiftUp`, `Handbrake`, `LookLeft` |
| 0 | `0x19` | 2 | `SteerLeft`, `SteerRight` (an axis only) |
| 0 | `0x06` | 27 | `GearReverse`, `Gear1` to `Gear6`, `Starter`, `PushToPass`, `DRS`, `HeadlightFlash` |
| 1 | `0x06` | 247 | `GearNeutral`, `Gear7` to `Gear16`, `Ignition`, `PitSpeedLimiter`, and most of the rest |
| 0 | `0x39` | 37 | the `...Level` actions (an axis that sets a value directly) |

Bits `0x08` and `0x10` are set wherever an axis is accepted, and `0x20` only on the `...Level` actions. **[?]** One of them may be the hat switch; no file here can tell. The flag looks like "held" against "pressed once" at first sight, but `Gear1` to `Gear6` have 0 and `Gear7` to `Gear16` have 1, so that reading does not hold.

**What is bound in the recorded file [V]:** 183 of 367 actions. 17 on the wheel base (5 axes, 12 buttons), all with the same pair of GUIDs, and 166 keys. 184 actions are not bound. Five actions have a second slot of their own (`Throttle2`, `Brake2`, `Clutch2`, `ShiftUp2`, `ShiftDown2`).

**Never seen [?]:** a hat switch (POV) binding; a binding kind other than 0, 1, 2 and 4; a button record with more than one bit set; a second controller; an axis with a direction other than on steering.

### What the code does with it

`src/features/iracing-bindings/core/controlsFile.ts` keeps the head, the 68 bytes of every record and the tail as they are. `encodeControlsFile(parseControlsFile(bytes))` gives back the same bytes for the recorded file (test: "reading the real file and writing it back gives the same bytes"). For each record it also builds the 68 bytes again from the fields it read; a record is `understood` only when that gives the same bytes (test: "every record is fully understood: its fields give back its 68 bytes"). A binding kind it does not know is kept as `unknown` and shown as "A binding RigReady cannot read", never guessed. A file that does not start with `GFCC`, has no `LRTC` chunk, has a chunk longer than the file, or has a record that is not a name and 68 bytes is refused.

The action names come from the file, so an action a newer iRacing adds shows up without a change to RigReady; one that the name table does not know is shown by iRacing's own id.

### The writer

`src/features/iracing-bindings/core/edit.ts` has one function, `changeBinding(bytes, action, binding)`. It gives back a new file in which one action is bound to one controller button or one key, or is cleared. Bytes in, bytes out; it touches no disk.

What it changes: bytes +8 to +67 of that one record. What it never changes: the header and its settings, the first field of the record (+0), the mask (+4), every other record, and the two bytes at the end. The file keeps its length, so the two sizes in the header stay right. So of the four things that are not understood, the writer sets none.

| Change | The 60 bytes it writes |
|---|---|
| A button | kind 2, the one bit of the button, the instance GUID and the product GUID of the controller. `core/change.ts` takes both from the controller as Windows lists it now; a controller that is not plugged in is refused |
| A key | kind 4, iRacing's key code, the modifier byte at +18 |
| A clear | all zero, which is what iRacing itself has for an action that was never bound |

It composes only what a real file showed. For the same button and the same key it gives the very bytes iRacing wrote in the recorded file (tests: "writes a button exactly as iRacing wrote the same button for another action", "writes a key exactly as iRacing wrote it, with Shift, Ctrl and Alt", "clears a binding to exactly what iRacing has for an action that was never bound").

What it refuses, with the reason in plain words:

- an axis, and an action that is on an axis now: iRacing calibrates an axis as it binds it and numbers axes its own way;
- a kind of input the action's mask does not take, a button outside 1 to 128, a key that is not in iRacing's table, modifiers other than Shift, Ctrl and Alt;
- a record it cannot read in full, an action that is in the file twice or not at all;
- a file that is damaged, or that it cannot take apart and put together again byte for byte.

The edit dialog turns away two more before the writer is asked: a hat switch, which no file here shows, and the number pad keys, whose codes in the file were not checked (`core/keys.ts`).

Before it hands a file back the writer checks its own result as it would a stranger's file: the same length, no byte changed outside those 60, and a file that reads back as the same actions with exactly the binding asked for. Tests: `core/edit.test.ts`, on the recorded file and on 150 made-up files ("no change gives the same bytes, for every action of 150 made-up files", "one change alters only the 60 bytes of that record, and they are the bytes of the new binding").

`core/change.ts` puts the file in place. It finds the file from the set (on an iRacing with control profiles, the profile's `controls.cfg`; the older file beside it is never written), shows the change first (what the action has now, what it would have, and every other action the same button or key already does in that set), and writes through `FileStore`: a backup first, one entry on the Safety page for each change, and Undo there. It refuses while `iRacingSim64DX11.exe` runs, and also when RigReady cannot see which programs run: not knowing is not "closed". Tests: `core/change.test.ts`.

### The switch

Changing a binding is on only when RigReady's main process has `RIGREADY_IRACING_EDIT=1` in its environment when it starts. It needs no rebuild. In PowerShell: `$env:RIGREADY_IRACING_EDIT = '1'`, then start RigReady from that window.

With the switch off, which is how the product ships:

- the page has no Change column, no edit dialog, and shows the notice that it does not change bindings;
- the channels `changePreview`, `change` and `listenStart` answer with the error `iracing-bindings.edit.off` and read, listen to and write nothing;
- those channels are kept out of the tools a local AI is given (tier `off`), whatever the switch says.

Tests: "refuses every channel of it, reads nothing, listens to nothing and writes nothing" in `core/change.test.ts`, and the first test of `tests/e2e/iracing-bindings.e2e.ts`, which looks for the column, the buttons and the dialog and calls `change` directly. `tests/e2e/iracing-bindings-edit.e2e.ts` turns the switch on for its own run of the app.

## `joyCalib.yaml` [V]

```
CalibrationInfo:
 DeviceList:
 - DeviceName: 'FANATEC Podium Wheel Base DD2'
   InstanceGUID: '{45D4BEA1-60A1-17D8-8001-444553540000}'
   ProductGUID: '{00070EB7-0000-0000-0000-504944564944}'
   AxisList:
   - Axis: 3
     AxisName: 'Wheel Axis'
     CalibMin: 0
     CalibCenter: 33145
     CalibMax: 65535
```

`controls.cfg` names a device only by its GUIDs and an axis only by a number. This file gives both a name. It lists only controllers that were calibrated, so a button box with no axes may be missing from it **[I]**. When the file is missing or cannot be read, axes are shown by number and the page says why.

## How devices are identified

- A binding names its controller by the DirectInput **instance GUID** and **product GUID** **[V]**. The product GUID holds the USB vendor and product ids and is the same on every PC. The instance GUID belongs to this PC and can change when Windows lists the controller again (`racing.md` 1.2).
- Keys name no device.
- RigReady matches a controller in the file to what is plugged in like this: the same instance GUID is **Connected**; no such GUID but a controller of the same vendor and product that the file does not name is **New Windows id**; neither is **Not connected**; when Windows gave no list the page says **Cannot tell**.
- The name shown is the name the owner gave the controller in RigReady, with the hardware name next to it. The hardware name is, in order: the `DeviceName` of `joyCalib.yaml`, the name of the connected controller, and last the USB ids from the product GUID.
- Pointing iRacing at a new instance GUID is the existing repair of `src/features/racing` (`racing.md` 2.5). The bindings page links to it and does not repeat it. That repair changes the older files only, not a control profile (see "Two readers of one file").

## Control profiles (iRacing 2026 Season 3 and later)

What iRacing says **[W]**: the 2026 Season 3 release notes (build 2026.06.09.01, https://support.iracing.com/support/solutions/articles/31000179016) add "Control Profiles": "set up, save, and load various different control configurations quickly from within the Sim", "swap control profiles from a dropdown in the Options screen", "This follows all of the patterns of the existing UI Profile System", and "Your default controls will be imported and labeled as Baseline, while any car specific controls will create profiles named after the car." Season 3 Patch 1 (https://support.iracing.com/support/solutions/articles/31000179039) fixes the import of "a Legacy car-specific profile" when a global default is already defined. The HUD profiles of 2026 Season 2, the "UI Profile System" that the controls follow, are said to live in `Documents\iRacing\profiles\hud`, to be assignable "as a global default or a car specific default", and to be "loaded at Sim startup" (from a web search summary of the Season 2 notes, not read on iRacing's own page). None of these sources names the controls files.

What the rig shows **[V]**, read on 13 Nov 2026 after iRacing updated itself to 2026.11.02.01 that morning:

- `Documents\iRacing\profiles\controls\Baseline\` holds `controls.cfg` (30,584 bytes) and `joyCalib.yaml` (654 bytes). Both were written at 10:45, the first run of the new build, and not since. `profiles\hud\Baseline.ini` sits beside them.
- `app.ini` has a section `[ControlProfiles]` with one line, `Global=Baseline`, next to `[AutoLoadHUD]` with `global=Baseline`.
- `Documents\iRacing\controls.cfg` and `joyCalib.yaml` were still the files of 11 April (the build of April 2026), 367 records, although the new build ran for a test drive at 10:45 and again at about 11:15. The new build knows 369 actions; it did not write the older file.
- The profile's `joyCalib.yaml` is byte for byte the older one.
- The profile's `controls.cfg` is the older file with two records added and nothing else changed. Walking the `LRTC` chunk gives 369 records: the 367 older ones in the same order with the same 68 bytes each, and two new ones among them, `PitSummaryToggle` after `DashBoxToggle` and `ToggleUIVisibleDrive` after `ToggleUIVisible`, both unbound with first field 1 and mask `0x06`. (Counting every NUL-ended run of letters in the chunk gives 390, because it also counts the `DEST` and `PIDVID` inside the device ids; that count is not the number of records.)
- The header is the older one but for the size at `0x08` (the file's size less 12: 30,572) and the length of the `LRTC` chunk (30,413, which the records now fill exactly). The settings between `0x001C` and `0x009F` are unchanged.
- The profile has no bytes after its last record (the older file has `20 20`).
- So a profile is read with the same reader, and the writer works on it as on the older file. Test: "is the recorded file with two new actions, no bytes after them, and a new size" in `core/carFixture.test.ts`, on the real profile with the made-up wheel id of the recorded rig (`fixtures/scenarios/data/iracing-bindings/profile-controls.cfg`).

What RigReady does with it:

- When `Documents\iRacing\profiles\controls` exists, the set for all cars is `profiles\controls\<Global>\controls.cfg`, where `<Global>` is the `Global` line of `[ControlProfiles]` in `app.ini` (section and key matched whatever their case). Calibration names come from the `joyCalib.yaml` beside it.
- The older `controls.cfg` files are then not shown; the page names them as not read by iRacing. They are read only when there is no profiles folder, which is an iRacing from before Season 3.
- When `app.ini` names no profile, or one that has no `controls.cfg`, the page says it cannot tell which bindings iRacing uses and shows no list. It does not fall back to the older file: iRacing does not read it. A profile name that is not one plain folder name (`..`, a slash, a drive) is never turned into a path.
- **[I]** A car's own profile. No real one has been seen. RigReady takes a line of `[ControlProfiles]` whose key is a car's folder name under `setups` (for example `mx5 mx52016=mx5 mx52016`) as that car's profile, by analogy with `Global`. A line for anything else is ignored. If iRacing keys cars another way, no car set shows: a missing set, not a wrong one.
- Tests: the "control profiles" block of `core/view.test.ts`, "writes the control profile iRacing uses, never the older controls.cfg beside it" in `core/change.test.ts`, and the scenario `iracing-bindings-profiles` with its tests in `tests/e2e/iracing-bindings.e2e.ts` and `tests/e2e/iracing-bindings-edit.e2e.ts`.

**[?]** Whether iRacing writes the profile when it closes, or only when something is changed in Options (it did not rewrite either file on 13 Nov, when nothing was changed). Whether it ever imports the older file again (for instance when the older file is newer than the profile). How a car's profile is named in `app.ini`.

## The rig test of 13 Nov 2026: what it showed, and why the key failed

What happened (11:09 to 11:33, beta.5 with the switch on, sitting log of 13 Nov): RigReady bound "Flash headlights" (`HeadlightFlash`, first field 0) to button 8 of the wheel base and "Black box show next" (`BlackBoxShowNext`, first field 1) to Shift+J, in `Documents\iRacing\controls.cfg`. In a test drive button 8 flashed the headlights; Shift+J did nothing, and Options > Controls showed the black box entry as unassigned. iRacing did not rewrite the file on close; the "after" step passed (only those two records differed, each as RigReady writes it), and Undo put the file back byte for byte.

Why it proves nothing:

- **[V]** RigReady wrote the older file, and iRacing 2026.11 reads the profile, which still had both actions unbound (written at 10:45, before the change, and not since).
- **[V, from the rig, 11:40, reported by the coordinator]** Button 8 still flashes the headlights after Undo, and neither file binds button 8 or `HeadlightFlash`. The flash comes from something outside iRacing's control files. So the button "worked" without RigReady's record.
- The key failing, in the car and in Options, is what reading the profile predicts. No fault in the key record is needed to explain it.

The key record itself, checked against the 166 key bindings of the real file (the older file and the profile have the same ones):

- **[V]** It has exactly the form of iRacing's own records with Shift. The file has 11 records with first field 1 and Shift (`SplitsDeltaPrev`, `PrevRpyCamCam`, `PrevRpyCamGroup`, `RpyRew`, `RpyFF`, `RpyLapFF`, `RpyLapRew`, `FocusPrevCar`, `ToggleWindshieldWipers`, `CamAcquireEnd`, `CamToggleSensorType`). Each is `01000000 06000000 04000000`, the key code as a u32, two zero bytes, `03`, then zeros to the end. RigReady's `BlackBoxShowNext` record, `01000000 06000000 04000000 4a000000 0000 03 00…`, differs from them only in the code. Bytes `+16`, `+17` and `+19` to `+67` are zero in all 166 key records.
- **[V]** The first field does not decide whether a key is taken: 123 key records have 1 and 43 have 0, with and without modifiers, and the shift byte is `03` on both kinds (13 records in all).
- **[V/W]** `0x4a` (74) is J. iRacing's published camera editor keys "Ctrl+J – Toggle Pitch Gyro" and "Alt+J – Toggle Roll Gyro" (https://www.iracing.com/keyboard-shortcuts-camera-editor/) are the records `CamTogglePitchGyro` and `CamToggleRollGyro`, code 74 with `0x0C` and `0x30`. For letters iRacing's own table (`racing.md` 2.4) uses the ASCII code, which is also the Windows virtual-key code of the letter (J is `0x4A`). It is not the keyboard scan code (J is `0x24`). No other record uses Shift+J.
- **[V]** All 166 keys in the file are iRacing's published defaults. So the file has never shown a key that a user set, and nothing on this PC yet proves that iRacing takes a key from the file. That is what the next rig check must show, now on the profile.
- **[W/V] The black box actions.** iRacing's own list (https://support.iracing.com/support/solutions/articles/31000133517, "Black Box Controls") has "Next Black Box" and "Previous Black Box" not assigned by default, F1 to F10 for the boxes, and the arrows, Home and Space for the selected control inside the box shown. In the file the arrows are on `BlackBoxNext` (Down), `BlackBoxPrev` (Up), `BlackBoxInc` (Right), `BlackBoxDec` (Left), Space is on `BlackBoxToggle`, and the only unbound pair is `BlackBoxShowNext` and `BlackBoxShowPrev`. **[I]** `BlackBoxShowNext` is iRacing's "Next Black Box". The same page says the boxes are for when "you are on track"; the test drive was on track, so the action had its screen. Nothing marks it as special beyond that.
- RigReady named `BlackBoxNext` "Next black box" and `BlackBoxShowNext` "Black box show next", which could send someone to the wrong entry in iRacing's Options. The names now follow iRacing: `BlackBoxShowNext` "Next black box", `BlackBoxNext` "Black box next control", `BlackBoxToggle` "Black box toggle control" (`core/names.ts`; the `racing` feature's own table still has the old names).

## Per-car bindings

- `Documents\iRacing\setups` has 184 car folders on this PC **[V]**. None holds a `controls.cfg` or a `joyCalib.yaml`: the owner has no car with custom controls. So no real per-car file has been read.
- That ticking "Use custom controls for this car" makes iRacing keep a `controls.cfg` in the car's folder comes from the web **[W]**: the README of https://github.com/jackhumbert/iracing-controls-editor-app and the thread https://community.granitedevices.com/t/iracing-wheel-turn-the-oposite/724. Neither is iRacing's own word.
- **[I]** The per-car file is a whole copy in the same format, not a list of differences. RigReady reads it with the same reader, and a file in another format is refused with a plain message instead of being shown wrongly.
- A car is listed only when its folder has a `controls.cfg`. The set is named by the folder (`mx5 mx52016`); RigReady has no table of proper car names.
- What a car "changes" is worked out by RigReady: each action of the car's file is compared with the same action in the file for all cars.
- The car file of the scenario tests (`fixtures/scenarios/data/iracing-bindings/controls-car.cfg`) is made up: the recorded file with exactly eight records changed, built by a script from the layout above. It proves what RigReady does with such a file. It does not prove what iRacing writes.

## Shared inputs

Ten keys of the recorded file are bound to more than one action **[V]**. Nine of them pair a driving key with an action of the camera editor (`Cam...`), which is how iRacing ships its defaults, and one is Space (`BlackBoxToggle`, the selected control of a black box, and `ToggleUIVisible`). So "bound twice" is normal in iRacing and is not shown as a fault: the page lists the inputs that do more than one thing and keeps the camera editor ones folded away.

## Is writing safe?

Not proven yet. What stood in the way, and what the writer does about each:

1. **One sample.** One file, one rig, one bound controller, iRacing's build of April 2026. A layout taken from one file is a description of that file. So the writer composes only a button and a key, the two kinds that file shows, and gives the same bytes iRacing wrote for them.
2. **Parts not understood.** The settings block in the header, the first field of each record, three bits of the mask and the two bytes at the end. The writer copies all four and sets none. Whether iRacing ties any of them to a binding is not known **[?]**: nothing in the one sample says so, and the second look checks it.
3. **Kinds never seen.** No hat switch binding, no second controller, no button record with two bits, no real per-car file. A hat switch and two buttons at once are refused. A button of a controller the file does not name yet is written like a button of the one it does name, with that controller's own two GUIDs; that is a fair guess, not a fact **[I]**. A car's file is changed only when iRacing made it and RigReady reads it byte for byte.
4. **Never loaded by iRacing.** Still true, and the one thing no test on this side can show. The rig test of 13 Nov wrote the older file, which iRacing 2026.11 does not read, so no file changed by RigReady has been opened by iRacing yet. A byte-identical round trip proves the reader loses nothing; it says nothing about whether iRacing accepts a record RigReady composed.
5. **What iRacing does with a file it does not like is unknown [?].** Its own advice for trouble is to delete the file and bind everything again, which for 183 bindings is a real loss. So every write makes a backup first and can be undone on the Safety page, and the rig test keeps one more copy of the file as it was. A backup lowers the cost; it does not make the write right.
6. **The simulator rewrites the file when it closes [I, from the `.ini` behaviour in `racing.md` 2.2].** A write while it runs would be lost or would mix two states. RigReady refuses to save while iRacing runs, and says so before saving.

What is left, in this order:

1. **The second look**, below: one button and one key in the control profile for all cars. It settles point 4 for those two kinds and shows whether iRacing keeps the four parts of point 2 as they were. When it passes, the switch can go and `BIND-IRACING-007` can be closed for buttons and keys of all cars. The button must be one that does nothing yet, checked in a test drive before the change (on 13 Nov button 8 flashed the headlights without any binding).
2. Give one car a control profile of its own in iRacing and record its file and the `[ControlProfiles]` lines of `app.ini`. Until a real per-car file has been read, changing one car's bindings rests on the made-up file of the scenario tests.
3. Bind a hat switch and a button of a second controller in iRacing, record the files again and diff them against today's. That says how a hat switch is stored, and turns the guess of point 3 into a fact.
4. Change one option at a time in iRacing (a force feedback value, a binding, a modifier) and diff, until the header settings and the first field are explained or shown not to matter.

The id repair in `src/features/racing` is a narrower case: it replaces 16 bytes with 16 other bytes of the same meaning and changes nothing else. It is shipped with a notice that it has not yet been verified on real hardware.

## The second look

About ten minutes at the rig. iRacing is closed at the start. Steps 1 and 5 are run for the owner; steps 2, 3, 4 and 6 are the owner's.

1. **Get ready.** Copy `%TEMP%\rigready-rig-iracing-second-look` somewhere first if the copy of 13 Nov is still wanted: this step writes over it. Run the "before" step of `tests/rig/iracingBindingsEdit.rig.test.ts`; the command is at the top of that file. It copies the bindings files, `app.ini` and the control profiles to a temp folder, finds the file for all cars as the page does (the profile `app.ini` names) and prints it, tries the change on the copy, and keeps the real file as it is now, with a note of which file it was. Then quit RigReady if it runs (a second start only wakes the one that runs), and start a build that has this work with `RIGREADY_IRACING_EDIT=1`, on the real profile, because iRacing has to read the file.
2. **Change two bindings in RigReady.** Open iRacing bindings, All cars; the line beside "Bindings for" names the profile. On "Flash headlights" press Change, press a wheel button that does nothing in iRacing yet (try it in a test drive first: button 8 flashes the headlights without a binding), then Save. On "Next black box" press Change, press Shift+J, then Save. Each Save writes 60 bytes of that one action into `Documents\iRacing\profiles\controls\Baseline\controls.cfg`, after a backup of the whole file. If the question before Save names another action, cancel and press something else.
3. **Look in iRacing.** Start iRacing, open a test session, then Options, Controls. Both actions show the new button and Shift+J ("Headlight Flash" and "Next Black Box" in iRacing's words). On track, with a black box shown (F1), Shift+J moves to the next box; the wheel, the pedals, the shifters and two or three buttons you know work as before. Change nothing in iRacing.
4. **Close iRacing.**
5. **Check the file.** Run the "after" step of the rig test with the two ids, `HeadlightFlash,BlackBoxShowNext`. It only reads. It passes when the same real file differs from the copy of step 1 in those two actions alone, each byte for byte as RigReady writes it. When it fails it prints every difference: that list is the finding to bring back.
6. **If iRacing lost a binding, showed a wrong one or complained:** close iRacing. In RigReady open Safety and press Undo on the two "iRacing bindings" entries, the newer one first. If RigReady asks "Undo anyway?", the file changed since, which is iRacing's own save: press Undo anyway. The file as it was is also at `%TEMP%\rigready-rig-iracing-second-look\controls-before.cfg`, and `kept-from.txt` beside it names where it came from; with iRacing closed, copying it back there does the same by hand.

The two actions are picked on purpose: they have no binding in the recorded file, and their records differ in the first field (0 and 1), the one whose meaning is not known. If either is bound by then, the "before" step takes the next free one of its list and prints which.

## Two readers of one file

`src/features/racing/core/iracing` already read `controls.cfg` for the iRacing page, the id repair, the check and the cheat sheets. Features may not import each other, so `src/features/iracing-bindings` has its own reader and its own table of action names. The two tables now differ in a few labels and groups (the new one fixes labels such as "Boost (axis) (axis)", and since 13 Nov the black box names). When the game picker lands, the reader and the names should move to one shared place and the racing page should use them.

**[V, by reading the code, 13 Nov]** The racing feature still reads only `Documents\iRacing\controls.cfg` and `setups\<car>\controls.cfg`. On an iRacing with control profiles its iRacing page, cheat sheets and check show the older file, and its id repair changes the older file, which iRacing no longer reads. It needs the same change as this feature.

## Open questions

- Whether iRacing loads and keeps a record RigReady composed. "The second look" answers it for one button and one key, now on the profile.
- How `app.ini` names a car's own control profile, and whether iRacing ever reads the older `controls.cfg` again once a profile exists.
- Whether iRacing takes a button of a controller that no other record and no `joyCalib.yaml` names yet.
- The header settings, the first field of a record, mask bits `0x08`, `0x10`, `0x20`.
- How a hat switch is stored.
- Whether a per-car file is a whole copy, and whether iRacing falls back to the main file for an action the car file leaves unbound.
- Whether iRacing checks anything in the header against the records.
