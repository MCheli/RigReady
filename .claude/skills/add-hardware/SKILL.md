---
name: add-hardware
description: Walks someone through adding support for their own sim hardware to RigReady, one step at a time - a joystick, HOTAS, grip, throttle, rudder pedals, wheel base, wheel rim, racing pedals, shifter, handbrake, button box or cockpit panel. Covers recognising the device by its USB id as flight or racing gear, naming its buttons and axes the maker's way, a cheat-sheet drawing, and the wheel view and axis names in the input tester, with research, tests and a proof on the user's own rig. Use when the user says things like "add support for my Thrustmaster Warthog", "RigReady doesn't know my Moza R9", "my button box shows up as Button 1 to 32", "draw my VKB Gladiator on the cheat sheet", "the input tester names my pedal axes wrong", or "can I add my controller to RigReady". When the device is known and only a game's bindings are missing, add-game is the one; when the change is finished and only needs sending in, open-pull-request.
---

# Add hardware to RigReady

You are guiding someone who may not be a programmer through adding their device to RigReady. They have the device; you have the repository. The human version of this procedure is `docs/contributing/add-hardware.md`, and the rules every contribution meets are in `docs/contributing/README.md`. Both are binding here.

## Before the first step

Read `CLAUDE.md`, `CONTRIBUTING.md`, `docs/contributing/README.md`, `docs/contributing/add-hardware.md`, and sections 8 to 12 of `docs/CONTRIBUTING-FEATURES.md`. `CLAUDE.md`'s "This machine" section describes the maintainer's own PC and its paths; unless the user says they are the maintainer, those paths do not apply, and the same care applies to this PC instead.

## How you work

- **One step at a time.** Start each message with "Step N of 9: <name>", say in one plain sentence what the step is for, do your part, then say exactly what the user should do and what they should see. Wait for their answer before the next step. Never put two things for their hands in one message.
- **Plain words.** No jargon without a one-line explanation. Name buttons and pages exactly as RigReady shows them.
- **Say who does what.** You read, research, write code, tests and notes, and run the checks. The user presses controls, reads screens, takes screenshots and decides.
- **Refuse to skip evidence.** If the user asks to skip the research, the pressing, the tests or the proof on their rig, say in one sentence why it stays and offer the smallest version of it. What was not done is written down, and a device is never called supported, or a control verified, without it.
- **Ask before** you commit, push or open anything on GitHub.
- **Safety.** RigReady runs from the source with a data folder of its own (`RIGREADY_HOME`), never on the user's real data folder unless they choose it. Device serial numbers, instance paths, controller instance GUIDs, the user's name and the PC's name never go into the repository or a message to an outside service. No key or token is printed, copied or stored. You start no game and kill no process you did not start.
- **Pictures.** Only drawings made for RigReady, or the user's own photos with their permission. Never a maker's product photo, line art, manual page or software screenshot, in the repository or traced. A maker's manual is read for facts and cited by its link. Drawings RigReady ships are CC0-1.0; code is MIT (`LICENSE`).

## Step 1 of 9: what the device is and what they want

Ask, in one message: the maker and model; which of these they want (RigReady knowing it is flight or racing gear; the maker's names for its controls; a drawing on the cheat sheet; the wheel view and axis names in the input tester; something else); and whether it is for everyone (a pull request) or for themselves.

If all they want is a picture of the device for themselves, tell them about **Use my photo…** on its cheat sheet (`docs/manual/controls/cheat-sheets.md`, "Your own photos") and offer to stop there. If RigReady guesses the wrong kind of device, **What it is** and **Used for** on its Devices page fix that for them without code.

Search the repository for the maker and model: `src/features/devices/core/family.ts`, `src/features/cheat-sheets/core/known/`, `src/features/cheat-sheets/core/drawings/`, `src/features/devices/core/wheelAxes.ts`, `src/features/racing/core/wheelbases/`, `docs/research/`. Tell the user what RigReady already knows about it.

## Step 2 of 9: get ready

Check `node --version` (22.12 or newer) and `git --version`. Run `npm ci` if `node_modules` is missing, and `npm run setup:python` if `resources/python` is missing (RigReady needs it to read real controllers). Make the branch: `git fetch origin`, then `git switch -c hardware/<maker>-<model> origin/main`.

## Step 3 of 9: before, and the device's identity

Give the user these commands for a PowerShell window of their own, in the repository's folder, after they quit any RigReady that runs (tray icon, right-click, **Quit**):

```powershell
$env:RIGREADY_HOME = "$env:USERPROFILE\.rigready-contrib"
npm run dev
```

Then, one at a time:

1. **Configure > Devices**, click **Find a device** at the top of the page, then press a button on the device: the banner says "That was <name>" and its row is highlighted. Click the row to open its details. Ask for **Vendor : product** and the name it reports. Tell them not to send the serial number or the instance path.
2. **Input tester** tab: how many axes, buttons and hats it has.
3. **Cheat sheets**: what the device's sheet shows now (a list of numbered controls, cards, or a drawing). A screenshot (Win+Shift+S) helps; ask them to check that it shows no serial number or instance path before they share it.

Write the "before" down; it goes into the pull request.

## Step 4 of 9: research first

Find sources, and write what they say before any code:

- The maker's manual or support page with a numbered diagram of the controls (facts only: which number is which control, which axis is which).
- Default profiles a game ships for the device. If the user has DCS World, `Mods/aircraft/<aircraft>/Input/<aircraft>/joystick/<device name>.diff.lua` in its install folder, read only (`docs/research/device-control-names.md`, "Method").
- For `family.ts`: the public USB id lists its comment names (`docs/research/device-ids.md`). An id goes there only when one of them has it.
- For a wheel base: the maker's driver or manual naming the axes (`docs/research/wheelbases.md`).

Write a section in the note for the kind of change (`device-control-names.md`, `controller-drawings.md`, `wheelbases.md`, `device-ids.md`), or `docs/research/<maker>-<model>.md` when it is long. Mark every claim: **[V]** checked on the user's device, **[W]** public source with its link, **[I]** inferred, **[?]** unknown. Tell the user in a few lines what the sources settle and what only pressing can.

## Step 5 of 9: press every control

In the input tester, with **Raw values** on, go through the device one control at a time: "Push the top hat up, then right, down and left, and tell me what lit each time." For a switch with positions, ask which button each position gives and where it rests with no hand on it. For an axis, which one moves and which end is 0. Record each answer in the note as [V], with the date. A control nobody pressed stays `assumed` (its label shows "?"), or is left off a drawing.

## Step 6 of 9: the change

Read an existing example first and copy its shape. Make only the parts the user asked for:

| Part | Files | Example |
|---|---|---|
| Flight or racing gear | `src/features/devices/core/family.ts`, `family.test.ts` | the vendor sets at its top |
| The maker's names | `src/features/cheat-sheets/core/known/<maker>.ts`, `known/index.ts` (`KNOWN_DEVICES`), `known/known.test.ts`; schema in `known/schema.ts` | `known/thrustmaster.ts` |
| A drawing | `src/features/cheat-sheets/core/drawings/<device>.ts` placed from the named map (`placeKnown`, `drawings/shapes.ts`), added to `DRAWINGS` in `drawings/builtin.ts`; `drawings/drawings.test.ts` | `drawings/thrustmaster.ts` |
| Wheel base axes | every table `tests/unit/wheelAxisNames.test.ts` holds together | the Fanatec entries |

Key on vendor and product id or on the reported name, never on a serial or instance id (`tests/unit/notHardcoded.test.ts`). A drawing is flat shapes with colour roles, in RigReady's style, with each source in the table "What each drawing was checked against" of `docs/research/controller-drawings.md`. `src/core/gearKind.ts` is shared: change it only with a reason, in its own commit. Update the docs that list devices: `src/features/cheat-sheets/LAYOUT-FORMAT.md` (shipped drawings), the manual page, and the README's hardware row. Leave `CHANGELOG.md` alone: the `open-pull-request` skill suggests its lines in the pull request.

## Step 7 of 9: tests, scenario, screenshots, ledger

- Unit tests: `npx vitest run <file>` for each one you changed.
- A scenario `fixtures/scenarios/<feature>-<device>.yaml` that adds the device to a recorded PC with `plugDevice`, with a made-up `instanceId` and controller `guid` in the shape of `fixtures/scenarios/cheat-sheets-known-devices.yaml` (its `productGuid` is derived from the ids, as there). Run `npx vitest run tests/unit/scenarioMode.test.ts`.
- A scenario test `tests/e2e/<feature>-<device>.e2e.ts`, modelled on `tests/e2e/cheat-sheets-known-devices.e2e.ts`: it opens the sheet or the tester, checks the names, sends a press with `sendInput` and checks the right label lights, and takes `shot()`s. Run `npm run build`, then `npx playwright test tests/e2e/<file>`. Tell the user a test window opens for a minute and is best left alone. Look at every screenshot, and show the user their paths.
- A ledger entry in `docs/requirements/ledger.yaml`: the next free id of its area (`SHEET-` for cheat sheets, `DEV-` for devices; check with a search), `title`, `job`, `done_means` a user could observe, `status: in_progress` until step 8 passes, and `evidence` (test ids as `file#title`, screenshot paths). `npm run ledger:check`.
- `npm run check`, then `npm run test:e2e:changed`.

## Step 8 of 9: after, on the user's rig

Write the proof as numbered steps under "Proof on a rig" in the research note: what to do, and what they should see. Then the user runs it in their build (close `npm run dev`, start it again with the same `RIGREADY_HOME`), one step per message:

- The same pages as step 3. Every control pressed lights its own label, and each is named as the maker names it.
- Every axis moved end to end; for a wheel base, the wheel to each end and each pedal to the floor, one at a time.
- Nothing outside RigReady's data folder is written by this change, so there is nothing to undo; the RigReady they normally use is unchanged.

A failure is fixed, and that step run again. Fill in the results table of `docs/contributing/README.md` ("Proof on your own rig"), with what was not tried. Then set the ledger entry to `done`, with a `notes` line: the date and what was checked on the contributor's device.

## Step 9 of 9: keep it or send it

Go through the change with the user file by file, in plain words, until they could answer a question about it. Then commit it on its branch, with their OK: only the change's own paths (never `git add -A`), with other flows' screenshots put back (`git checkout -- artifacts/screens/<their flow>`), until `git status --short` prints nothing. Then:

- For themselves: the `local-build` skill.
- For everyone: the `open-pull-request` skill. The rig results go into the Testing section.
