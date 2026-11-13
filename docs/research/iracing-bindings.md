# iRacing bindings: what the files hold, what can be read, and what is left to prove before RigReady writes them

Research date: 2026-11-12. Machine: the owner's rig. Read `docs/research/racing.md` section 2 first; this document goes deeper into `controls.cfg`, describes the writer that is built and switched off, and gives the steps that prove it on the rig.

The marks are those of `racing.md`: **[V]** verified by reading the files on this machine, **[W]** from the web with the URL, **[I]** inferred from verified data, **[?]** unknown.

Everything here was learned read-only, from a copy of the owner's `Documents\iRacing\controls.cfg` and `joyCalib.yaml` and by listing `Documents\iRacing\setups`. iRacing was not started. Nothing was written to the iRacing folder: the writer has only run on the recorded file and on copies in temp folders. `app.ini` was not used and is not in the repository.

## The short answer

- **Reading is reliable.** Every byte of the one real file is accounted for by position, the file can be taken apart and put together again byte for byte, and each record says whether all of its 68 bytes are understood. All 367 are.
- **Writing one binding is built and switched off.** `core/edit.ts` binds one action to a controller button or a key, or clears it, and changes 60 bytes of that one record and nothing else. It is not reachable in the product: unless RigReady is started with `RIGREADY_IRACING_EDIT=1` in its environment, the page has no edit buttons and the channels that change anything answer with an error. See "The writer" and "The switch".
- **One thing is not proven: that iRacing accepts a file RigReady changed.** No game may be started on the rig in this round, so no such file has been loaded by iRacing. "The second look" below is that proof, in six steps.
- With the switch off, `src/features/iracing-bindings` shows bindings, has no edit buttons, and says why on the page.

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

`core/change.ts` puts the file in place. It finds the file from the set, shows the change first (what the action has now, what it would have, and every other action the same button or key already does in that set), and writes through `FileStore`: a backup first, one entry on the Safety page for each change, and Undo there. It refuses while `iRacingSim64DX11.exe` runs, and also when RigReady cannot see which programs run: not knowing is not "closed". Tests: `core/change.test.ts`.

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

Not proven yet. What stood in the way, and what the writer does about each:

1. **One sample.** One file, one rig, one bound controller, iRacing's build of April 2026. A layout taken from one file is a description of that file. So the writer composes only a button and a key, the two kinds that file shows, and gives the same bytes iRacing wrote for them.
2. **Parts not understood.** The settings block in the header, the first field of each record, three bits of the mask and the two bytes at the end. The writer copies all four and sets none. Whether iRacing ties any of them to a binding is not known **[?]**: nothing in the one sample says so, and the second look checks it.
3. **Kinds never seen.** No hat switch binding, no second controller, no button record with two bits, no real per-car file. A hat switch and two buttons at once are refused. A button of a controller the file does not name yet is written like a button of the one it does name, with that controller's own two GUIDs; that is a fair guess, not a fact **[I]**. A car's file is changed only when iRacing made it and RigReady reads it byte for byte.
4. **Never loaded by iRacing.** Still true, and the one thing no test on this side can show. No game may be started on the rig in this round, so no file changed by RigReady has been opened by iRacing. A byte-identical round trip proves the reader loses nothing; it says nothing about whether iRacing accepts a record RigReady composed.
5. **What iRacing does with a file it does not like is unknown [?].** Its own advice for trouble is to delete the file and bind everything again, which for 183 bindings is a real loss. So every write makes a backup first and can be undone on the Safety page, and the rig test keeps one more copy of the file as it was. A backup lowers the cost; it does not make the write right.
6. **The simulator rewrites the file when it closes [I, from the `.ini` behaviour in `racing.md` 2.2].** A write while it runs would be lost or would mix two states. RigReady refuses to save while iRacing runs, and says so before saving.

What is left, in this order:

1. **The second look**, below: one button and one key in the set for all cars. It settles point 4 for those two kinds and shows whether iRacing keeps the four parts of point 2 as they were. When it passes, the switch can go and `BIND-IRACING-007` can be closed for buttons and keys of all cars.
2. Tick "Use custom controls for this car" for one car in iRacing and record its file. Until a real per-car file has been read, changing one car's bindings rests on the made-up file of the scenario tests.
3. Bind a hat switch and a button of a second controller in iRacing, record the files again and diff them against today's. That says how a hat switch is stored, and turns the guess of point 3 into a fact.
4. Change one option at a time in iRacing (a force feedback value, a binding, a modifier) and diff, until the header settings and the first field are explained or shown not to matter.

The id repair in `src/features/racing` is a narrower case: it replaces 16 bytes with 16 other bytes of the same meaning and changes nothing else. It is shipped with a notice that it has not yet been verified on real hardware.

## The second look

About ten minutes at the rig. iRacing is closed at the start. Steps 1 and 5 are run for the owner; steps 2, 3, 4 and 6 are the owner's.

1. **Get ready.** Run the "before" step of `tests/rig/iracingBindingsEdit.rig.test.ts`; the command is at the top of that file. It tries the change on copies in a temp folder and keeps the real `controls.cfg` as it is now. Then quit RigReady if it runs (a second start only wakes the one that runs), and start a build that has this work with `RIGREADY_IRACING_EDIT=1`, on the real profile, because iRacing has to read the file.
2. **Change two bindings in RigReady.** Open iRacing bindings, All cars. On "Flash headlights" press Change, press a wheel button that does nothing in iRacing yet, then Save. On "Black box show next" press Change, press Shift+J, then Save. Each Save writes 60 bytes of that one action into `Documents\iRacing\controls.cfg`, after a backup of the whole file. If the question before Save names another action, cancel and press something else.
3. **Look in iRacing.** Start iRacing, open a test session, then Options, Controls. Both actions show the new button and Shift+J (iRacing's own names for the two may differ a little). On track the wheel, the pedals, the shifters and two or three buttons you know work as before. Change nothing in iRacing.
4. **Close iRacing.** It saves the file again as it closes.
5. **Check the file.** Run the "after" step of the rig test with the two ids, `HeadlightFlash,BlackBoxShowNext`. It only reads. It passes when iRacing's file differs from the copy of step 1 in those two actions alone, each byte for byte as RigReady writes it. When it fails it prints every difference: that list is the finding to bring back.
6. **If iRacing lost a binding, showed a wrong one or complained:** close iRacing. In RigReady open Safety and press Undo on the two "iRacing bindings" entries, the newer one first. If RigReady asks "Undo anyway?", the file changed since, which is iRacing's own save: press Undo anyway. The file as it was is also at `%TEMP%\rigready-rig-iracing-second-look\controls-before.cfg`; with iRacing closed, copying it over `Documents\iRacing\controls.cfg` does the same by hand.

The two actions are picked on purpose: they have no binding in the recorded file, and their records differ in the first field (0 and 1), the one whose meaning is not known. If either is bound by then, the "before" step takes the next free one of its list and prints which.

## Two readers of one file

`src/features/racing/core/iracing` already read `controls.cfg` for the iRacing page, the id repair, the check and the cheat sheets. Features may not import each other, so `src/features/iracing-bindings` has its own reader and its own table of action names. The two tables now differ in a few labels and groups (the new one fixes labels such as "Boost (axis) (axis)"). When the game picker lands, the reader and the names should move to one shared place and the racing page should use them.

## Open questions

- Whether iRacing loads and keeps a record RigReady composed. "The second look" answers it for one button and one key.
- Whether iRacing takes a button of a controller that no other record and no `joyCalib.yaml` names yet.
- The header settings, the first field of a record, mask bits `0x08`, `0x10`, `0x20`, the last two bytes.
- How a hat switch is stored.
- Whether a per-car file is a whole copy, and whether iRacing falls back to the main file for an action the car file leaves unbound.
- Whether iRacing checks anything in the header against the records.
