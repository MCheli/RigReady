# Add your game

Clone the repository, open Claude Code in it (`claude`), and name your game: "I play Assetto Corsa Competizione, can RigReady read its bindings?", or "RigReady does not find my X-Plane install". The `add-game` skill walks you through this page one step at a time. [Add your hardware or game](README.md) has the rules every contribution meets.

## What works without code

**Add a game** on the Games page makes any game found, launched, offered in new setups and backed up, with the program and settings folders you choose ([Any other game](../manual/games/other-games.md)). If that is all you need, you need nothing else.

## Three stages, one at a time

A game gets support the way DCS World and iRacing did: first found and launched, then its bindings read, and only then changed. Each stage is a pull request of its own, and each is proven on your rig before the next one starts.

| Stage | What RigReady then does | Where it goes | The example to follow |
|---|---|---|---|
| 1. The game module | Finds every install (all Steam libraries, a standalone or Store install), launches it, knows when it runs, offers its settings on Backups, and refuses a restore while it runs | `src/features/games/<id>/module.ts`, usually with `simpleGame()` from `games/core/simpleGame.ts` | `games/ams2/module.ts`; its sources in `docs/research/game-modules-2026-11.md`; its tests in `games/core/moreGames.test.ts` on the scenario `generic-more-sims` |
| 2. Reading the bindings | A bindings page for the game under **Bindings**, and through `ctx.bindings` the cheat sheets, the trainer and the overlay for it, with no change to those features | A feature of its own, `src/features/<game>-bindings/`, which registers a `BindingReader` (`src/core/bindings.ts`) | The reader `dcs-bindings` registers; the page and the reader of `controls.cfg` in `iracing-bindings`; the research in `docs/research/iracing-bindings.md` |
| 3. Changing the bindings | One binding changed at a time: shown first, backed up, undone on the Safety page, refused while the game runs | The same feature | `iracing-bindings/core/edit.ts` and `core/change.ts`; the rig test `tests/rig/iracingBindingsEdit.rig.test.ts` |

The binding guide works on DCS's own files today; a guide for another game is a larger change, so ask in an issue first.

## Stage 1: found, launched, backed up

1. **Say what you have.** The game, where you bought it (Steam, its own launcher, the Microsoft Store), and its version.
2. **Where it keeps its files.** Claude reads public sources (the Steam store's own data, PCGamingWiki, the publisher's pages) and writes them into the research note, each marked. You open those folders in File Explorer and say which exist on your PC and what is in them, by name. Nobody opens or changes a file in them.
3. **Before.** Claude starts the code as it is now, with a data folder of its own ([Build and run your own copy](local-build.md)). The game is not on the Games page.
4. **The module.** Claude writes it, its tests, and a scenario with the game's program and settings files made up in a recorded PC's folders (`generic-more-sims` is the model), plus the manual page.
5. **After, on your rig.** The Games page lists the game with the right install and folders. **Launch** starts it (you watch). **Backups > Tracked files** suggests its settings. A backup holds those files. With the game running, a restore is refused with the game's name.

## Stage 2: reading the bindings

1. **The research.** Every place the game keeps bindings (for all cars or aircraft, per car or aircraft, per profile), how it chooses one, and the format, byte by byte or line by line. Claude works on a copy: it gives you one command that copies the folder to a scratch folder, and reads only that.
2. **Before, in the game.** You open the game's own controls screen and read out five bindings: a button, an axis, a key, and a hat if you have one, on two devices if you have two.
3. **The reader.** It takes the file apart and can put it together again unchanged, refuses what it cannot read with a plain reason, and never throws on a damaged file (it goes on the `PARSERS` list of `tests/unit/fuzzParsers.test.ts`). Its fixture is a trimmed copy of your file with made-up controller ids.
4. **The page.** A route under `/configure/`, declared with `bindings: [...]` in the feature's manifest so it joins the game picker on the Bindings page, its manual page, its entry in `src/shared/manualLinks.ts`, and its place on the `PAGES` list of `tests/e2e/generic-rig.e2e.ts`.
5. **After, on your rig.** RigReady's page shows the same five bindings as the game. Each device's cheat sheet shows them. The trainer asks one, and your press counts. In a session, the overlay names a press.

## Stage 3: changing the bindings

A write to the file the game reads is the change that can cost someone hours, so it follows every rule of `docs/CONTRIBUTING-FEATURES.md` and one more: compose only what a real file of this game showed. It is shown first, as a preview the user confirms, written through `FileStore` (a backup first, one entry on the Safety page), read back before it reports success, and refused while the game runs or while RigReady cannot tell whether it runs.

The proof on your rig follows "The second look" of `docs/research/iracing-bindings.md`, about ten minutes:

1. **A safety copy.** Copy the game's bindings folder somewhere yourself, in File Explorer.
2. **The "before" step.** With the game closed, Claude runs the read-only "before" step of the feature's rig test: it copies the files to a temp folder, tries the change on the copy, and keeps a copy of the real file as it is now.
3. **In the game.** The button and the key you will use do nothing yet. Close the game.
4. **The change.** In your build, change two bindings, a button and a key, and press Save on each.
5. **In the game again.** Both do their action. The wheel or stick, the pedals and a few controls you know work as before. Change nothing in the game's options, then close it.
6. **The "after" step.** Read-only: the real file differs from the kept copy in those two actions alone, each exactly as RigReady writes it. When it fails, it prints every difference.
7. **Undo.** On the Safety page of your build, press Undo on both entries, the newer one first. The file is back as it was.

What was not tried (a hat switch, a second controller, a per-car file) is written in the research note and in the pull request.
