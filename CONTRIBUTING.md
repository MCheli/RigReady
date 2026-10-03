# Contributing to RigReady

Thank you for helping. RigReady changes files that take people many hours to recreate, so the rules below are strict on purpose.

## Before you start

Read `docs/PRODUCT.md` (what the app is), `docs/ARCHITECTURE.md` (how it is put together) and `docs/CONTRIBUTING-FEATURES.md` (how to add a feature, step by step, and what the shared code already provides).

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

## Reporting a problem

Open an issue at <https://github.com/MCheli/rigready/issues> with what you did, what you expected, what happened, and the log from `%USERPROFILE%\.rigready\logs\rigready.log`. Remove anything personal first.
