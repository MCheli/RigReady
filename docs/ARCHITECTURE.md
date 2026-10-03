# RigReady — Architecture

Binding decisions for the rebuild that started 2026-10-03. Read `docs/PRODUCT.md` first. The previous code under `src/` is legacy: mine it for working logic (the DCS Lua tokenizer, the pygame input server, HID handling), but do not preserve its structure.

## Stack

Electron + electron-vite, Vue 3 (`<script setup>`), Vuetify, TypeScript strict, Pinia, vue-router. Vitest for unit and integration tests, Playwright for end-to-end. zod for every schema that crosses a boundary (files on disk, IPC, imported bundles). YAML for profiles, JSON elsewhere. Dependencies are upgraded to current majors as part of the foundation.

## Layers

```
src/core/        Pure TypeScript. No electron, no fs/child_process imports except through ports.
src/platform/    Implementations of the ports: windows/ and electron/ (real), node/ (shared), fake/ (fixture-backed).
                 The only code that imports fs, child_process or native bindings.
src/features/    One folder per feature area; each self-registers (see below).
src/main/        Electron bootstrap, window, tray, IPC wiring. Thin.
src/renderer/    Vue shell: router, layout, design system, the two modes.
src/shared/      Types and zod schemas shared by main and renderer.
```

### Ports (`src/core/ports/`)

Everything that touches the machine goes through an interface, so tests and scenario runs can swap it:

`DeviceProvider` (enumerate, identity, USB topology, plug/unplug notification), `InputProvider` (the DirectInput controllers a game sees, with instance GUIDs, and their live state), `DisplayProvider` (read and apply layouts, rotation, enable/disable), `ProcessProvider` (list, start, close politely, stop), `ServiceProvider` (Windows services), `AudioProvider` (read and set default devices), `Registry` (read-only), `FileStore` (all reads and writes, with backup-before-write and an undo journal built in), `KnownFolders` (home, Documents, Saved Games, AppData, Program Files, Steam libraries, RigReady data root), `Shell` (run a program with an argument array; never a command string), `Clock`, `Secrets` (encrypted, for the API key), `Http`, `Dialogs` (file pickers), `Render` (HTML to PNG and PDF), `Notifications`, `LoginItem` (start with Windows), `Overlays` (labels on monitors). `docs/CONTRIBUTING-FEATURES.md` lists every method and what each fake offers to tests.

`KnownFolders` is the only place a user path is computed. The data root honors `RIGREADY_HOME`.

### Features (`src/features/<name>/`)

```
core/       domain logic against ports, unit tested
main.ts     exports registerFeature({ ipc, ... }) — IPC handlers for this feature
renderer/   routes, pages, components, store
index.ts    feature manifest: id, nav entries, routes, check types, remediation types
```

Features are discovered with `import.meta.glob`, so adding one never edits a shared registry file. This is what lets several agents work in parallel without merge conflicts. A feature may import from `src/core` and `src/shared`, never from another feature's internals; cross-feature needs go through core interfaces.

Check types and remediation types are registered by features (`registerCheck`, `registerRemediation`), not by a switch statement.

### Game modules (`src/features/games/<game>/`)

Each game implements one `GameModule` interface: detection (all Steam libraries via `libraryfolders.vdf`, standalone, Store), config locations, tracked-file suggestions, optional `BindingManager`, optional specialized checks. One registry; no path tables anywhere else.

### IPC

One typed contract per feature (`contract.ts`: channel name → zod input and output). `main` registers handlers from the contract; the preload exposes a generic typed `invoke`; the renderer calls through a typed client. No hand-duplicated channel strings. Every handler validates its input. Paths received from the renderer are validated against allowed roots.

## Test harness

| Layer | What it is |
|---|---|
| Gates | `npm run check` = typecheck (both projects, for real), lint, unit tests with coverage threshold, ledger validation. CI runs it. |
| Unit | Vitest against `src/core` and feature `core/` using fake ports and real fixture files in a temp directory. No wholesale `fs` mocking. |
| Fixtures | `fixtures/rigs/<name>/` holds a recorded rig: devices, USB tree, displays, processes, services, audio, DirectInput controllers, registry keys, HidHide state, and a sanitized copy of game and tool config files (user folders and install folders). `fixtures/rigs/mark-full/` is recorded from the owner's machine. |
| Scenarios | `RIGREADY_SCENARIO=<file>` starts the app on fake providers from a fixture plus mutations ("pedals unplugged", "MFD 2 rotated", "TrackIR not running"), with scripted answers for HTTP, shell commands and file pickers. The recorded files are copied into a fake user folder that also holds Program Files and the Steam library. |
| E2E | Playwright launches the built app per scenario with `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and `RIGREADY_HOME` pointed at a temp directory, drives a user flow, asserts, and saves screenshots to `artifacts/screens/<flow>/`. Tests never use `if (visible)` guards or fixed sleeps. |
| Rig smoke | `npm run rig:smoke` runs read-only checks against the real hardware on the owner's PC. Display-apply tests restore the original layout in a `finally`. |
| Packaged smoke | Builds the unpacked app and runs a scenario plus a real device/display enumeration against it, to catch packaging failures (asar, Python sidecar). |

## Requirements ledger

`docs/requirements/ledger.yaml`: one entry per requirement with `id`, `title`, `job` (fly / configure / troubleshoot / platform), `done_means` (observable acceptance criteria), `status` (`todo` / `in_progress` / `done`), and `evidence` (test ids and screenshot paths). `npm run ledger:check` fails if a `done` entry has no evidence or its evidence does not exist. Agents update the ledger in the same commit as the work.

## Safety

- `FileStore.write` outside the data root always snapshots the previous content to `<data root>/backups/auto/<timestamp>/` first and records it in a journal that the UI can show and undo.
- `Shell.run` takes an executable and an argument array and uses `spawn` without a shell.
- Changes made under one `FileStore.beginGroup()` are one user action: the Safety page lists them together and Undo puts every file back. Undo refuses a file that was changed again since, unless the user confirms. Automatic backups are pruned at startup by the retention settings.
- Lua from the game or from other tools is never run with file or process access: data files go through a strict parser, programs through a sandboxed VM with an instruction budget (`src/core/lua`).
- Imported bundles are validated with zod, never write outside resolved known folders, and never carry runnable content silently: scripts and launch commands are stripped and listed for the user.
- Display apply uses the Windows display configuration API directly, captures the prior layout, and exposes revert.

## Conventions

- Errors: core returns `Result<T, RigError>` for expected failures; throws only for bugs. One logger with levels, async, rotating file under the data root.
- No dead code: anything not reachable from a mounted route or a registered handler is deleted, not parked.
- Commits are small and each leaves `npm run check` green.
