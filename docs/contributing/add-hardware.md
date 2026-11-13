# Add your hardware

Clone the repository, open Claude Code in it (`claude`), and describe your device: "Add support for my Moza R9 wheel base", or "RigReady shows my button box as Button 1 to 32". The `add-hardware` skill walks you through this page one step at a time. [Add your hardware or game](README.md) has the rules every contribution meets.

## What works without code

- Every USB game controller Windows sees is on **Configure > Devices** and in the input tester, its buttons, axes and hats numbered as games number them.
- **What it is** and **Used for** on a device's page tell RigReady a stick from pedals, and flight gear from racing gear, where it cannot tell by itself ([Devices](../manual/hardware/devices.md)).
- **Use my photo…** makes a cheat sheet drawing of any controller from your own photos, for you ([Cheat sheets](../manual/controls/cheat-sheets.md)).

## What a contribution adds

| For everyone who has the device | Where it goes | What it needs |
|---|---|---|
| Flight or racing gear, so a new setup keeps it by default | `src/features/devices/core/family.ts` | Its USB id in one of the public lists named there (`docs/research/device-ids.md`) |
| Its controls named the maker's way, on the cheat sheet, in the trainer and when it is placed on a photo | `src/features/cheat-sheets/core/known/<maker>.ts`, listed in `known/index.ts` | A source for every number: the maker's manual, a game's default profile for the device, your presses (`docs/research/device-control-names.md`) |
| A drawing on the cheat sheet | `src/features/cheat-sheets/core/drawings/<device>.ts`, listed in `drawings/builtin.ts` | The named map above, and a source for where each control is (`docs/research/controller-drawings.md`) |
| The wheel view and the maker's axis names in the input tester | The tables `tests/unit/wheelAxisNames.test.ts` holds together (`devices/core/wheelAxes.ts`, `racing/core/wheelbases/`, `iracing-bindings/core/calibration.ts`) | The maker's driver or manual naming the axes (`docs/research/wheelbases.md`) |

What kind of device a name means ("Throttle", "Pedals") is read in `src/core/gearKind.ts`, which every feature shares: a change there is its own commit, with the reason.

## The steps

1. **Say what it is.** The maker, the model, and what you want RigReady to do with it. Claude looks for it in the files above first: part of it may be there already.
2. **Its USB id.** On **Configure > Devices**, click **Find a device** at the top of the page, then press a button on the device: RigReady says "That was <name>" and highlights its row. Click the row to open its details, and copy **Vendor : product** (for example `044F:0404`) and the name it reports. Leave out the serial number and the instance path. In the **Input tester** tab, note how many axes, buttons and hats it has.
3. **Before.** Claude starts the code as it is now, from the source, with a data folder of its own ([Build and run your own copy](local-build.md)). You open the device's cheat sheet and the input tester, and say what they show, or take a screenshot.
4. **Sources.** Claude looks for the maker's manual with a numbered diagram of the controls, the default profiles a game ships for the device (DCS has them per aircraft for popular devices), and the public USB id lists. It writes the research note with every claim marked. Links only: no picture of the maker's goes into the repository.
5. **Press every control.** In the input tester with **Raw values** on, you press one control at a time and say what lit: "the red button is 3", "the rotary is SLIDER1, 0 at full left". Claude writes each answer into the note as checked on your device. A control nobody pressed stays marked `assumed` on a drawing, and its label shows "?".
6. **The change.** Claude writes the parts from the table that apply, and the unit tests next to them.
7. **The scenario test.** A scenario adds your device, with made-up ids, to a recorded PC (`plugDevice`, as `fixtures/scenarios/cheat-sheets-known-devices.yaml` does), and a scenario test opens its cheat sheet and input tester and takes screenshots. You look at them with Claude.
8. **After, on your rig.** Your build, the same pages as in step 3: every control you press lights its own label, the axes carry the maker's names, the wheel view follows the wheel and the pedals. What you did not try is written down too.
9. **Keep it or send it.** For yourself: [Build and run your own copy](local-build.md). For everyone: [Sending it in](README.md#sending-it-in).

## Drawings

- A drawing is made for RigReady, in the flat style of the shipped ones: shapes with colour roles, so it works on a dark screen, on paper and on a night kneeboard page (`src/features/cheat-sheets/LAYOUT-FORMAT.md`, "Drawings"). Its controls come from the device's named map (`placeKnown` in `drawings/shapes.ts`), so the drawing cannot name a control differently from the list.
- Where a control is comes from a source: the maker's numbered diagram (read for the facts, never traced), a game's default profile, your presses. A control whose number or direction no source settles is `assumed`. A control no source places is left off, and the sheet lists it under "More controls".
- Your own photos can be what the drawing is drawn from: you look, Claude draws the shapes. A photo itself goes into the repository only if you took it, you agree to publish it under CC0-1.0, and the maintainer agreed to it in an issue first. Keep people, serial labels and your room out of the frame.
- The drawing is CC0-1.0, like every drawing RigReady ships; the code is MIT.

## Wheel bases and pedals

- Axis names come from the maker's driver or manual only. A base without such a source keeps Windows' names and the general view.
- The proof on your rig: turn the wheel to each end and press each pedal to the floor, one at a time. The wheel view and each bar follow, and each axis carries its own name.
