# RigReady

A Windows desktop app for flight and racing sim rigs. It checks that the rig is ready (devices plugged in, helper apps running, monitors arranged, audio and config files right), fixes what it can, and launches the game. It also manages bindings, backups and hardware troubleshooting.

Website: [rigready.io](https://rigready.io) · License: MIT

**Status:** version 2 is being rebuilt from the ground up. The Fly screen, setup capture, monitor layouts with timed revert, settings and the safety journal work; most of the rest is in progress. `docs/requirements/ledger.yaml` lists every requirement with its status and evidence.

## What it does

- **Fly:** one screen with a checklist for the setup you used last. **Make ready** runs every fix in order, **Launch** starts the game, **Stand down** closes the helper apps and puts the monitors back.
- **Configure:** create setups by capturing the rig while it works; manage bindings, backups, monitor layouts and devices.
- **Safety:** every file RigReady changes outside its own folder is backed up first and can be undone.

DCS World comes first (F/A-18C, UH-1H), then iRacing, Le Mans Ultimate, BeamNG.drive and others. See `docs/PRODUCT.md`.

## Develop

Windows 10 or 11, Node.js 22.12 or newer.

```
npm ci
npm run check                           # typecheck, lint, format, unit tests, ledger
npm run test:e2e                        # build, then drive the app on recorded scenarios
npm run dev:scenario -- flying-all-good # the app on a recorded rig; touches nothing real
```

`npm run dev` runs against the real machine and the real `~/.rigready`; use a scenario unless you mean that. `npm run setup:python` installs the small Python runtime the controller reader needs (for `npm run dev`, `rig:smoke` and packaging); `npm run dist` builds the installer.

## Documents

| | |
|---|---|
| `docs/PRODUCT.md` | What the product is. |
| `docs/ARCHITECTURE.md` | Layers, ports, test harness, safety rules. |
| `docs/CONTRIBUTING-FEATURES.md` | How to add a feature, and everything the shared foundation provides. |
| `docs/requirements/ledger.yaml` | Requirements, status, evidence. |
| `docs/research/` | Findings on game file formats and hardware. |
