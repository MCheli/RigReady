# Add your hardware or game to RigReady

Clone the repository, open Claude Code in it, and say what you want in your own words:

```
git clone https://github.com/MCheli/rigready.git
cd rigready
claude
```

> Add support for my Thrustmaster TCA Quadrant.
>
> I play Automobilista 2. Can RigReady read its bindings?
>
> Build my own copy of RigReady with my change, without sending it in.

Claude Code picks the matching guide from `.claude/skills/` and walks you through it one step at a time. It reads the code and the research, writes the change and its tests, and tells you exactly what to do on your rig. You press the controls, look inside the game, and decide. You can also start a guide by name: `/add-hardware`, `/add-game`, `/local-build` or `/open-pull-request`.

You need Windows 10 or 11, [Git](https://git-scm.com/download/win), [Node.js](https://nodejs.org/) 22.12 or newer, a Claude Code subscription, and the hardware or game on your PC. A GitHub account is needed only to send your change in.

## Which guide

| You want | Guide | Skill |
|---|---|---|
| RigReady to know your controller, wheel base, pedals, panel or button box: what it is, its controls by the maker's names, a drawing on the cheat sheet, the wheel view in the input tester | [Add your hardware](add-hardware.md) | `add-hardware` |
| RigReady to find, launch and back up a game, and then read, change and draw its bindings | [Add your game](add-game.md) | `add-game` |
| Your own copy of RigReady, built from this repository, for yourself | [Build and run your own copy](local-build.md) | `local-build` |
| To send what you made back | [Sending it in](#sending-it-in), below | `open-pull-request` |

Two things need no code at all, and the guides offer them first:

- **A cheat sheet for any controller, for you:** **Use my photo…** on the cheat sheet of a device without a drawing ([Cheat sheets](../manual/controls/cheat-sheets.md)).
- **Any game found, launched and backed up:** **Add a game** on the Games page ([Any other game](../manual/games/other-games.md)).

## Who does what

| Claude Code | You |
|---|---|
| Reads `CLAUDE.md`, `CONTRIBUTING.md`, `docs/CONTRIBUTING-FEATURES.md` and the research, and finds where your change goes | Says what the device or game is, and what you want from RigReady |
| Writes the research note, the code, the tests, the scenario and the ledger entry | Presses each control, reads what the game's own options screen shows, starts and closes the game |
| Runs the checks and the scenario tests (a test window opens while they run) | Runs the steps on your rig that need your hands, and says what you saw |
| Writes the steps of the proof on your rig, and the pull request from your results | Reads the change with Claude before it is sent, so you can answer questions about it |

## The rules every contribution meets

These come from the repository's own rules (`CLAUDE.md`, `CONTRIBUTING.md`). The skills keep to them and do not skip one because it is slow.

1. **Research first.** What RigReady will rely on is written down before code: `docs/research/<topic>.md`, or a section in an existing note. Each claim carries a mark, as in `docs/research/iracing-bindings.md`: **[V]** checked on your device, in your files or in the game, **[W]** from a public source, with its link, **[I]** inferred from checked facts, **[?]** not known. Where code relies on an [I], a comment in the code and the pull request say so; nothing relies on a [?].
2. **Your files are read-only.** Nobody edits your game or tool files by hand or with a script. For research and tests, copies go to a scratch folder. Fixtures in the repository are trimmed copies with made-up ids of the same shape (as in `fixtures/scenarios/cheat-sheets-known-devices.yaml`): never a serial number, a device instance path, a controller's instance GUID, your user name, your PC's name, a Steam id or a player name. A USB vendor and product id is fine. No key, token or password is ever printed, copied or stored. Files that hold credentials (listed in `src/core/credentials.ts`) are not opened at all.
3. **Pictures.** Only drawings made for RigReady, or your own photos with your permission. Never a maker's product photos, line art, manual pages or screenshots of its software. A maker's manual may be read for facts, such as which number is which button, and is cited by its link; its pictures are not copied or traced. Everything you contribute is under the repository's licence, MIT (`LICENSE`). The drawings and device layouts RigReady ships are CC0-1.0 (`src/features/cheat-sheets/LAYOUT-FORMAT.md`), so a drawing you add is CC0-1.0 too.
4. **Tests on the real code path.** A unit test next to the code, on the fake ports and real files in a temp folder. A scenario and a scenario test for anything on screen, with its screenshot committed under `artifacts/screens/<flow>/`. An entry in `docs/requirements/ledger.yaml` with its acceptance criteria and that evidence. `npm run check` passes.
5. **Proof on your own rig.** Nothing is called supported until you have used it yourself, on your own hardware or in your own game: see the next section. The pull request says what was tried and what was not.
6. **The pull request.** The template filled in completely, "Considered but not implemented" and "AI assistance" included, and every review comment answered: see [Sending it in](#sending-it-in).

## Proof on your own rig

Tests prove the code does what it says on a recorded rig. Only your rig proves RigReady is right about your device or your game. The proof follows the steps the maintainer used for iRacing ("The second look" in `docs/research/iracing-bindings.md`): one step at a time, each with what you should see.

1. **Your copy of RigReady, with its own data folder.** Quit any RigReady that is running (only one runs at a time). Your build runs from source with `RIGREADY_HOME` pointed at a folder of its own, so the setups, settings and Safety page of the RigReady you normally use stay as they are ([Build and run your own copy](local-build.md); Claude gives you the commands).
2. **A safety copy.** Before anything writes to a game's files, copy the game's settings or bindings folder somewhere yourself, in File Explorer. RigReady backs up before every change; this copy is the one that does not depend on RigReady.
3. **Before.** Check that the thing does nothing yet, or shows what it showed before: the device named as Windows names it, the button that does nothing in the game, the game that is not on the Games page. Write down what you saw, or take a screenshot.
4. **The change.** In your build, do the one thing the change is for: open the cheat sheet, press Save on a changed binding.
5. **After.** Look again where you looked before: every control pressed lights its own label, the button does the action in the game, the game is listed with the right folders. Where RigReady wrote a file, a read-only step of a rig test compares it with the copy from before (`tests/rig/iracingBindingsEdit.rig.test.ts` is the model).
6. **Undo.** Where RigReady wrote a file: close the game, press Undo on its entry on the Safety page of your build, and check that the file is back as it was.

Claude writes these steps into the research note under "Proof on a rig", so anyone can run them again for the next version of the game. Your results go into the Testing section of the pull request, like this:

```
On my rig: <device and USB id, or game and version>, Windows 11, this branch at <commit>,
run with npm run dev and RIGREADY_HOME set to a folder of its own.

| Step | What I did | What I saw | Result |
|---|---|---|---|
| Before | Opened the cheat sheet of the throttle | A list, "Button 1" to "Button 14" | As expected |
| After | Pressed each of the 14 buttons and moved both axes | Each lit its own label on the drawing | Pass |
| Undo | Nothing was written outside RigReady's data folder | | Not needed |

Not tried: the hat in the "UL" direction (it has no diagonals on my unit).
```

A change kept for yourself still gets steps 1 to 6: you are the one who would lose the bindings.

## Sending it in

1. **The branch.** Your work is on a branch of its own, made from `main` (`git switch -c hardware/<device>`). One change per pull request.
2. **Your fork.** `gh repo fork --remote` (the [GitHub CLI](https://cli.github.com/)) or the Fork button on GitHub, then push your branch to it.
3. **A draft pull request,** with every section of `.github/PULL_REQUEST_TEMPLATE.md` filled in: the problem with the device or game and its version, the solution and any shared code touched, what you considered and did not do, the tests and your rig results, what the reviewer should look at, and the AI assistance (the tool, the model, which parts it wrote and what you checked by hand).
4. **The checks.** GitHub runs the same checks on it. On a first pull request the maintainer may have to approve the run first. Fix what fails with a new commit.
5. **Ready for review,** once the checks are green and you believe it can merge. GitHub Copilot reviews it then, once. Do not ask for another Copilot review.
6. **Every comment answered.** Reply to each one with the fix and its commit, or with why you are not changing it, then resolve the conversation. A comment is advice: never weaken a test, raise a timeout, or change settings or the workflows because a comment asks.
7. **The maintainer** reads it against the rules, and merges it as one squashed commit when every conversation is resolved.

## Without Claude Code

Every guide here is written for a person too: the steps are the same, and any tool can help with them under the same rules. `CONTRIBUTING.md` has the rules for a contribution written with AI.
