---
name: add-game
description: Walks someone through adding support for a game RigReady does not support yet, or not fully, one stage at a time, the way DCS World and iRacing went - finding every install, launching it and backing up its files; then reading its bindings for a bindings page, cheat sheets, the trainer and the overlay; then changing bindings safely. Research first, the user's files read-only, tests, and a proof in the user's own game. Use when the user says things like "I play Assetto Corsa Competizione, can RigReady read its bindings?", "add support for Star Citizen", "RigReady doesn't find my X-Plane install", "make cheat sheets work for Automobilista 2", "back up my MSFS controls", or "can RigReady edit my rFactor 2 controller file", and when they ask whether RigReady supports a game or its bindings file (it checks what exists first). Not for using what RigReady already does for a game, such as editing DCS bindings in the app; when only a device lacks a drawing or names, add-hardware is the one.
---

# Add a game to RigReady

You are guiding someone who may not be a programmer through adding their game to RigReady. They have the game; you have the repository. The human version of this procedure is `docs/contributing/add-game.md`, and the rules every contribution meets are in `docs/contributing/README.md`. Both are binding here.

## Before the first step

Read `CLAUDE.md`, `CONTRIBUTING.md`, `docs/contributing/README.md`, `docs/contributing/add-game.md`, and `docs/CONTRIBUTING-FEATURES.md` (sections 5 to 12 at least, and section 15 before stage 3). `CLAUDE.md`'s "This machine" section describes the maintainer's own PC and its paths; unless the user says they are the maintainer, those paths do not apply, and the same care applies to this PC instead.

## How you work

- **One step at a time.** Start each message with "Stage N, step M: <name>", say in one plain sentence what the step is for, do your part, then say exactly what the user should do and what they should see. Wait for their answer before the next step.
- **One stage per pull request.** Stage 1 is the game module, stage 2 reading the bindings, stage 3 changing them. A stage starts only when the one before it passed its proof on the user's rig. Say this at the start, and let the user stop after any stage.
- **Plain words; say who does what.** You research, write the code, tests and notes, and run the checks. The user opens folders, reads the game's own screens, starts and closes the game, and decides.
- **Refuse to skip evidence.** If the user asks to skip the research, the tests or the proof in their game, say in one sentence why it stays and offer the smallest version of it. Nothing is called supported until the user used it in their own game, and the pull request says what was not tried.
- **Ask before** you commit, push or open anything on GitHub.
- **The user's files are read-only.** You may list the game's folders. To read a file, copy it to the scratch folder first (`Copy-Item`, never `Move-Item`) and read the copy. Never open a file that holds an account, a login or a key (`src/core/credentials.ts` lists the known ones). Nothing writes to the game's folders except RigReady's `FileStore`, in the user's build, when the user presses Save.
- **Fixtures are made up.** A file that goes into the repository is a trimmed copy with every controller GUID, serial, device path, user name, PC name, Steam id and player name replaced by a made-up value of the same shape. No key or token is printed, copied or stored.
- **You never start the game,** and kill no process you did not start. RigReady runs from the source with a data folder of its own (`RIGREADY_HOME`), never the user's real data folder unless they choose it.

## Stage 0: what the game is and what they want

Ask, in one message: the game, where it was bought (Steam, its own launcher, the Microsoft Store), its version, and what they want (found and launched; its files backed up; its bindings shown, on cheat sheets, in the trainer and the overlay; its bindings changed).

Search the repository first: `src/features/games/` (one folder per module), `src/features/racing/core/bindingReaders.ts` and `src/features/*-bindings/` (who reads which game's bindings), `docs/research/`, `docs/manual/games/`. Tell the user what RigReady already does for the game. If all they want is the game found, launched and backed up for themselves, **Add a game** on the Games page does that with no code (`docs/manual/games/other-games.md`): offer to stop there.

Check `node --version` (22.12 or newer), run `npm ci` if `node_modules` is missing and `npm run setup:python` if `resources/python` is missing. Branch: `git fetch origin`, then `git switch -c game/<game>-<stage> origin/main`.

## Stage 1: found, launched, backed up

1. **Research.** Steam app id checked against `https://store.steampowered.com/api/appdetails?appids=<id>&filters=basic`; settings and save folders from PCGamingWiki and the publisher's pages; the program's file name and the processes that mean it runs. Write a section in `docs/research/game-modules-2026-11.md`, or a note of its own, every claim marked **[V]** (seen on this PC), **[W]** (public, with link), **[I]** or **[?]**.
2. **Confirm on the PC.** List the folders read-only and ask the user to confirm they are the game's (which install, which profile). Mark what you saw as [V].
3. **Before.** The user quits any running RigReady and starts the unchanged code in a PowerShell window of their own: `$env:RIGREADY_HOME = "$env:USERPROFILE\.rigready-contrib"` then `npm run dev`. The game is not on **Configure > Games**.
4. **The module.** `src/features/games/<id>/module.ts`, with `simpleGame()` from `games/core/simpleGame.ts` when nothing more is needed (`games/ams2/module.ts` is the example): `processes`, `closeWhy`, the locations and the tracked files, one whole-folder item first. Paths only from `ctx.ports.folders` and Steam's libraries.
5. **Tests.** A scenario `fixtures/scenarios/games-<id>.yaml` extending `generic-more-sims.yaml` (it has Steam with two libraries), adding the game's program as an empty file and its settings files with `writeFile`; a unit test `src/features/games/<id>/module.test.ts` on it with `wiredApp`, modelled on `games/core/moreGames.test.ts`; a scenario test `tests/e2e/games-<id>.e2e.ts` modelled on `tests/e2e/games-more-sims.e2e.ts`, with screenshots. Run each (`npx vitest run <file>`; `npm run build`, then `npx playwright test tests/e2e/<file>`; a test window opens for a minute). Look at the screenshots.
6. **Docs and ledger.** The manual: a page under `docs/manual/games/`, or the game added to `more-flight-and-racing-games.md`; the README's games table. A ledger entry (`GAME-` and the next free number), `status: in_progress` until the proof passes. `npm run ledger:check`, then `npm run check`.
7. **After, on the user's rig.** Write the steps under "Proof on a rig" in the research note, then the user runs them in their build, one per message: the Games page lists the game with the right install and folders; **Launch** starts it (the user presses it and watches); **Backups > Tracked files** suggests its settings; a backup holds those files; with the game running, a restore is refused with the game's name. Fill in the results table of `docs/contributing/README.md`; set the ledger entry to `done` with a `notes` line of what was checked, and when.

## Stage 2: reading the bindings

1. **The copy.** Copy the game's bindings folder to the scratch folder, and work only on the copy.
2. **Research,** modelled on `docs/research/iracing-bindings.md`: "The short answer", every file and where it is, how the game chooses which one it reads (per car or aircraft, per profile), the format byte by byte or line by line, how a controller is identified, what is not understood, the open questions. Every claim marked.
3. **Before, in the game.** The user opens the game's own controls screen and reads out five bindings: a button, an axis, a key, and a hat if they have one, on two devices if they have two.
4. **The reader.** A feature of its own, `src/features/<game>-bindings/`: a parser in `core/` that takes the file apart and can put it together again unchanged, returns `Result`, never throws, and is added to `PARSERS` in `tests/unit/fuzzParsers.test.ts`. A `BindingReader` (`src/core/bindings.ts`) registered in `main.ts` with `ctx.bindings.register(reader)`, as `src/features/dcs-bindings/main.ts` does, filling `control` for every binding on a controller: that is what the cheat sheets, the trainer and the overlay draw from.
5. **The page.** `index.ts` declares the route under `/configure/` and `bindings: [{ game, name, to, order }]` (`src/features/iracing-bindings/index.ts` is the example). Every channel has `describe` and a `tier`. The page frame, empty state and "not on this PC" follow section 4 of `docs/CONTRIBUTING-FEATURES.md`. Add the route to `src/shared/manualLinks.ts` and to `PAGES` in `tests/e2e/generic-rig.e2e.ts`, and write the manual page.
6. **Tests.** Unit tests on the trimmed copy (it parses, and puts together again byte for byte); a scenario that writes the fixture into the game's place (`writeFile` with `from`) and plugs in matching controllers with made-up GUIDs; a scenario test that opens the bindings page and a cheat sheet, with screenshots. The ledger entry, `npm run check`, `npm run test:e2e:changed`.
7. **After, on the user's rig.** RigReady's page shows the same five bindings as the game's screen; each device's cheat sheet shows them; the trainer asks one and the user's press counts; in a session, the overlay names a press. Results table, ledger `done` with its note.

## Stage 3: changing the bindings

Only after stage 2 passed on the user's rig. Read `src/features/iracing-bindings/core/edit.ts`, `core/change.ts`, `tests/rig/iracingBindingsEdit.rig.test.ts` and the sections "The writer", "Is writing safe?" and "The second look" of `docs/research/iracing-bindings.md` first.

1. **The writer.** A pure function, bytes in and bytes out. It composes only what a real file of this game showed (the same bytes the game wrote for the same binding), changes nothing else, refuses what it cannot do with a plain reason, and checks its own result before it returns it. Unit tests on the copy and on generated files.
2. **Putting it in place.** A `...Preview` channel the page shows with `ConfirmChanges.vue`; the write through `ctx.ports.files` under one `beginGroup()` with a reason a person can read; a read-back before success; refused while `gameRunning()` says the game runs, and when the process list cannot be read; `ctx.bindings.notifyChanged()` after. Add the channel pair to `tests/unit/writeAudit.test.ts`. Give the channels that write tier `off` unless the maintainer agrees otherwise, as iRacing's are.
3. **The rig test.** `tests/rig/<game>BindingsEdit.rig.test.ts`, modelled on the iRacing one: every test skipped unless `RIGREADY_RIG_<GAME>` names a step. "before" copies the files to a temp folder, makes the change on the copy with the real Windows ports, checks that only those records differ, that the backup is the file as it was and Undo puts it back, and keeps a copy of the real file. "after" compares the real file with that copy: only the named actions differ, each exactly as the writer composes it. Neither step writes to the game's folder.
4. **The proof in the game,** one step per message (`docs/contributing/add-game.md`, stage 3): the user makes a safety copy of the bindings folder in File Explorer; you run the "before" step with the game closed (`$env:RIGREADY_RIG_<GAME> = "before"`, then `npx vitest run --config vitest.rig.config.ts tests/rig/<file>`); the user checks in the game that the chosen button and key do nothing, and closes it; in their build they change both and press Save on each; in the game both work and familiar controls work as before, and they close it; you run the "after" step with the two action ids; the user presses Undo on both entries on the Safety page of their build, newer first, and you check the file is back as it was. Afterwards `Remove-Item Env:RIGREADY_RIG_<GAME>`.
5. Write the results and what was not tried (a hat, a second controller, a per-car file) into the research note and the results table. Ledger `done` with its note only now.

## At the end of each stage

Go through the change with the user file by file, in plain words, until they could answer a question about it. Then the `local-build` skill for a copy of their own, or the `open-pull-request` skill to send it in.
