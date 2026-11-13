# iRacing bindings: what the files hold, what can be read, and why RigReady does not write them

Research date: 2026-11-12. Machine: the owner's rig. Read `docs/research/racing.md` section 2 first; this document goes deeper into `controls.cfg` and settles the question of editing.

The marks are those of `racing.md`: **[V]** verified by reading the files on this machine, **[W]** from the web with the URL, **[I]** inferred from verified data, **[?]** unknown.

Everything here was learned read-only, from a copy of the owner's `Documents\iRacing\controls.cfg` and `joyCalib.yaml` and by listing `Documents\iRacing\setups`. iRacing was not started. Nothing was written to the iRacing folder. `app.ini` was not used and is not in the repository.

## The short answer

- **Reading is reliable.** Every byte of the one real file is accounted for by position, the file can be taken apart and put together again byte for byte, and each record says whether all of its 68 bytes are understood. All 367 are.
- **Writing bindings is not shipped.** The layout comes from one file from one rig with one bound controller. Parts of the file are not understood, some kinds of binding have never been seen, and a changed file has never been loaded by iRacing. The reasons are listed in "Is writing safe?" below.
- `src/features/iracing-bindings` therefore shows bindings and has no edit buttons.

## The files

| File | What it holds | Format |
|---|---|---|
| `Documents\iRacing\controls.cfg` | Every action and its binding, for all cars | Binary, described below **[V]** |
| `Documents\iRacing\joyCalib.yaml` | Each calibrated controller: its name, both GUIDs, and its axes with names and calibration | Text, one key per line **[V]** |
| `Documents\iRacing\setups\<car>\controls.cfg` | The same, for one car with "Use custom controls for this car" | Assumed the same as the main file **[W/I]**, see "Per-car bindings" |
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

**[?]** What the settings between `0x001C` and `0x009F` mean. They look like wheel and force feedback settings (floats near 25.2, 100, 50, 1.0), but nothing confirms it. **[?]** What the two bytes at the end are. **[?]** Whether any of the header values depends on the records (a count or a check value). Nothing in it equals 367 or an obvious sum, but that is not proof.

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

## `joyCalib.yaml` [V]

```
CalibrationInfo:
 DeviceList:
 - DeviceName: 'FANATEC Podium Wheel Base DD2'
   InstanceGUID: '{20B0BED0-03A4-11F1-8001-444553540000}'
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
- Pointing iRacing at a new instance GUID is the existing repair of `src/features/racing` (`racing.md` 2.5). The bindings page links to it and does not repeat it.

## Per-car bindings

- `Documents\iRacing\setups` has 184 car folders on this PC **[V]**. None holds a `controls.cfg` or a `joyCalib.yaml`: the owner has no car with custom controls. So no real per-car file has been read.
- That ticking "Use custom controls for this car" makes iRacing keep a `controls.cfg` in the car's folder comes from the web **[W]**: the README of https://github.com/jackhumbert/iracing-controls-editor-app and the thread https://community.granitedevices.com/t/iracing-wheel-turn-the-oposite/724. Neither is iRacing's own word.
- **[I]** The per-car file is a whole copy in the same format, not a list of differences. RigReady reads it with the same reader, and a file in another format is refused with a plain message instead of being shown wrongly.
- A car is listed only when its folder has a `controls.cfg`. The set is named by the folder (`mx5 mx52016`); RigReady has no table of proper car names.
- What a car "changes" is worked out by RigReady: each action of the car's file is compared with the same action in the file for all cars.
- The car file of the scenario tests (`fixtures/scenarios/data/iracing-bindings/controls-car.cfg`) is made up: the recorded file with exactly eight records changed, built by a script from the layout above. It proves what RigReady does with such a file. It does not prove what iRacing writes.

## Shared inputs

Ten keys of the recorded file are bound to more than one action **[V]**. Nine of them pair a driving key with an action of the camera editor (`Cam...`), which is how iRacing ships its defaults, and one is Space (`BlackBoxToggle` and `ToggleUIVisible`). So "bound twice" is normal in iRacing and is not shown as a fault: the page lists the inputs that do more than one thing and keeps the camera editor ones folded away.

## Is writing safe?

Not yet. What stands in the way:

1. **One sample.** One file, one rig, one bound controller, iRacing's build of April 2026. A layout taken from one file is a description of that file.
2. **Parts not understood.** The settings block in the header, the first field of each record, three bits of the mask and the two bytes at the end.
3. **Kinds never seen.** No hat switch binding, no second controller, no button record with two bits, no real per-car file. RigReady could not write any of those correctly, and could not offer them in a picker without guessing.
4. **Never loaded by iRacing.** The rules of this work forbid starting a game on the rig, so no file changed by RigReady has been opened by iRacing. A byte-identical round trip proves the reader loses nothing; it says nothing about whether iRacing accepts a record RigReady composed.
5. **What iRacing does with a file it does not like is unknown [?].** Its own advice for trouble is to delete the file and bind everything again, which for 183 bindings is a real loss. A backup lowers the cost; it does not make the write right.
6. **The simulator rewrites the file when it closes [I, from the `.ini` behaviour in `racing.md` 2.2].** A write while it runs would be lost or would mix two states.

What would make it safe enough to ship, in this order:

1. With the owner at the rig: bind a hat switch and a button on a second controller in iRacing, tick custom controls for one car, and record the files again. Diff them against today's.
2. Change one option at a time in iRacing (a force feedback value, a binding, a modifier) and diff, until the header settings and the first field are explained or shown not to matter.
3. Write one changed binding into a copy with the codec, put it in place with `FileStore` (backup first) while iRacing is closed, start iRacing, and check that the binding is there and that nothing else changed. Then let iRacing save and diff its file against the one RigReady wrote.
4. Only then add editing, with the same plan, apply and undo steps as the DCS bindings page, refused while `iRacingSim64DX11.exe` runs.

The id repair in `src/features/racing` is a narrower case: it replaces 16 bytes with 16 other bytes of the same meaning and changes nothing else. It is shipped with a notice that it has not yet been verified on real hardware.

## Two readers of one file

`src/features/racing/core/iracing` already read `controls.cfg` for the iRacing page, the id repair, the check and the cheat sheets. Features may not import each other, so `src/features/iracing-bindings` has its own reader and its own table of action names. The two tables now differ in a few labels and groups (the new one fixes labels such as "Boost (axis) (axis)"). When the game picker lands, the reader and the names should move to one shared place and the racing page should use them.

## Open questions

- The header settings, the first field of a record, mask bits `0x08`, `0x10`, `0x20`, the last two bytes.
- How a hat switch is stored.
- Whether a per-car file is a whole copy, and whether iRacing falls back to the main file for an action the car file leaves unbound.
- Whether iRacing checks anything in the header against the records.
