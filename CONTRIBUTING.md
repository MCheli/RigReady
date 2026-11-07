# Contributing to RigReady

Thank you for helping. RigReady changes files that take people many hours to recreate, so the rules below are strict on purpose.

## Before you start

Read `docs/PRODUCT.md` (what the app is), `docs/ARCHITECTURE.md` (how it is put together) and `docs/CONTRIBUTING-FEATURES.md` (how to add a feature, step by step, and what the shared code already provides). The manual in `docs/manual/` describes the app as a user sees it and is published at <https://rigready.io/docs/>; a change to what the app does changes its page too (`site/README.md` says how the manual is built and checked).

## Setup

Windows 10 or 11 and Node.js 22.12 or newer.

```
npm ci
npm run check       # must pass before every commit
npm run test:e2e    # the app driven on recorded rigs; no real hardware needed
```

Use `npm run dev:scenario -- <scenario>` to run the app while developing. It runs on a recorded rig in a temp folder. `npm run dev` uses your real machine and your real `~/.rigready`.

## Rules

- A feature lives in `src/features/<name>/` and touches the machine only through the ports in `src/core/ports`. Only `src/platform` imports `fs`, `child_process` or native bindings.
- Files outside RigReady's data folder are changed only through `FileStore`, which backs them up and journals the change first.
- Programs are started with an executable and an argument array. Never a command string.
- No success message for something that did not happen, and no button for something that is not built.
- A requirement is done only with evidence in `docs/requirements/ledger.yaml`: a test that exercises the real code path, plus a scenario screenshot for anything visible.
- Tests use the fake ports and real files in a temp folder. Do not mock `fs`. E2E tests do not sleep and do not branch on visibility.

## Pull requests

Keep them small. `npm run check` and `npm run test:e2e` must pass (CI runs both on Windows). Say what you tested and, for anything on screen, attach the screenshot the scenario run produced.

The maintainer reads every pull request before it is merged, against the rules above: writes go through `FileStore`, programs start with an argument array, the ledger entry and its evidence are in the same pull request. A green CI run is needed, not sufficient.

## AI-assisted contributions

Most of RigReady was written by AI coding agents directed by the maintainer ([how this was built](https://rigready.io/how-it-was-built/)), so a pull request written with one is welcome. The same rules apply to it, plus three:

- Say so in the pull request: which tool, and which parts it wrote.
- You must be able to explain every change in it. A pull request whose author cannot answer a question about its own diff is closed.
- The evidence is the test and the screenshot, not the agent's summary. "The agent says it works" is not evidence; a test that exercises the real code path is.

## Reporting a problem

Open an issue at <https://github.com/MCheli/rigready/issues/new/choose>: there is a form for something that went wrong and one for a report of how RigReady does on your hardware. Paste the diagnostics report (Configure > Diagnostics > Copy diagnostics), which has personal details removed. A security problem is reported privately, as `SECURITY.md` describes.
