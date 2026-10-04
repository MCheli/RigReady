# RigReady — Architecture

Binding decisions for the rebuild that started 2026-10-03 (version 2). Read `docs/PRODUCT.md` first. `src/legacy/` holds a few files of the 1.1.0 app as reference material: nothing there is compiled, linted or tested, and nothing may import from it (see its README).

## Stack

Electron + electron-vite, Vue 3 (`<script setup>`), Vuetify, TypeScript strict, Pinia, vue-router. Vitest for unit and integration tests, Playwright for end-to-end. zod for every schema that crosses a boundary (files on disk, IPC, imported bundles). YAML for profiles, JSON elsewhere. koffi for the Windows API, fengari for sandboxed Lua, fflate for zip, electron-updater for updates. A small Python sidecar (`python/input_server.py`) reads DirectInput controllers.

## Layers

```
src/core/        Pure TypeScript. No electron, no fs/child_process imports except through ports.
src/platform/    Implementations of the ports: windows/ and electron/ (real), node/ (shared), fake/ (fixture-backed).
                 The only code that imports fs, child_process or native bindings.
src/features/    One folder per feature area; each self-registers (see below).
src/main/        Electron bootstrap, windows, tray, IPC wiring, logging, error hooks. Thin.
src/renderer/    Vue shell: router, layout, design system, shared components, the two modes.
src/shared/      Types and zod schemas shared by main and renderer.
```

ESLint (`eslint.config.mjs`) and `tests/unit/architecture.test.ts` enforce the import rules.

### Ports (`src/core/ports/`)

Everything that touches the machine goes through an interface, so tests and scenario runs can swap it:

`DeviceProvider` (enumerate, identity, USB topology, plug/unplug notification), `InputProvider` (the DirectInput controllers a game sees, with instance GUIDs, and their live state), `DisplayProvider` (read and apply layouts, rotation, enable/disable, revert), `ProcessProvider` (list, start, close politely, stop), `ServiceProvider` (Windows services), `AudioProvider` (read and set default devices), `Registry` (read-only), `FileStore` (all reads and writes, with backup-before-write and an undo journal built in), `KnownFolders` (home, Documents, Saved Games, the Desktop, AppData, Program Files, ProgramData, the Windows folder, Steam libraries, the machine name, RigReady's data root), `Shell` (run a program with an argument array; never a command string), `Clock`, `Secrets` (encrypted, for the API key), `Http`, `Dialogs` (file pickers), `Render` (HTML to PNG and PDF), `Notifications`, `Clipboard`, `LoginItem` (start with Windows), `Overlays` (labels on monitors), `AppWindow` (RigReady's own window: `showOn`, and `openPanel` for a small extra window on an app route), `UpdateFeed` (where new versions come from), `Shortcuts` (the content of a Windows shortcut and what one says; the file is written through `FileStore`), `Taskbar` (the Jump List, the status badge, the tooltip, the progress bar and the thumbnail buttons of RigReady's taskbar button), `Hotkeys` (system-wide key combinations, registered by name, and who is told when one is pressed). `LogSink` is what the logger writes to. `docs/CONTRIBUTING-FEATURES.md` section 6 lists every method and what each fake offers to tests.

`KnownFolders` is the only place a user path is computed (`src/platform/windows/knownFolders.ts`; a lint rule and `tests/unit/knownFolders.test.ts` keep it that way). The data root is `~/.rigready` and honors `RIGREADY_HOME`.

Two wrappers sit between the platform and the code that uses it:

- **`ctx.ports` is not the platform's object.** `wireFeatures` (`src/main/bootstrap.ts`) hands features a copy whose `processes` port is `verifiedProcesses(...)` (`src/core/processes.ts`): after a close or stop that Windows reported as done, the process list is read again, and a program that is still there makes the call fail with `process.stillRunning`.
- **One machine read per check run.** The check engine runs a checklist on `cachedReads(ports)` (`src/core/checks/readCache.ts`): within one run, `devices.list`, `displays.read`, `processes.list`, `services.list`/`get` and `audio.read` are asked once and shared (as copies). The next run reads again. Everything that changes the machine, and everything a fix reads, goes to the real port.

### Features (`src/features/<name>/`)

```
contract.ts IPC contract: channel -> zod input and output, events
core/       domain logic against ports, unit tested
main.ts     default-exports defineFeatureMain({ id, setup(ctx), dispose? })
renderer/   pages, components, store
index.ts    default-exports defineFeature({ id, nav, routes, checkTypes, ... })
```

Features are discovered with `import.meta.glob` in exactly two places (`src/main/bootstrap.ts` for `main.ts`, `src/renderer/features.ts` for `index.ts`), so adding one never edits a shared registry file (`tests/unit/selfRegistration.test.ts`). A feature may import from `src/core` and `src/shared`, never from another feature's internals; cross-feature needs go through core registries on the context: `ctx.checks`, `ctx.games`, `ctx.profiles`, `ctx.settings`, `ctx.layouts`, `ctx.names`, `ctx.bindings`, `ctx.backupSources`.

Check types, remediation types, capture sources and stand-down steps are registered by features (`registerCheck`, `registerRemediation`, `registerCapture`, `registerStandDownStep`), not by a switch statement. Core never names a check type.

The current features: `ai-assist`, `audio`, `backup`, `cheat-sheets`, `checks-generic`, `dcs-bindings`, `dcs-setup`, `devices`, `diagnostics`, `displays`, `fly`, `games`, `one-click`, `processes`, `profiles`, `racing`, `safety`, `settings`, `sharing`, `stream-deck`, `trackir`, `updates`. `docs/CONTRIBUTING-FEATURES.md` section 14 says what each owns.

### Navigation

The app has two modes: **Fly** (one screen, `/fly`) and **Configure** (every route under `/configure/`). The Configure navigation has five sections, declared per entry in a feature's manifest (`src/shared/feature.ts`):

| Section | Order | What belongs there |
|---|---|---|
| `Setups` | 100s | What you fly or race with, and keeping it safe: setups, backups, sharing |
| `Games` | 200s | The games found on this PC and what each needs set up |
| `Controls` | 300s | What the buttons do: bindings, the binding guide, cheat sheets |
| `Hardware` | 400s | Devices, monitors, audio and the helper tools of the rig |
| `RigReady` | 900s | The app itself: settings, the record of changes, diagnostics |

The whole navigation must fit the default window without scrolling (`tests/e2e/tour.e2e.ts`).

### Game modules (`src/features/games/<game>/module.ts`)

Each game implements one `GameModule` interface (`src/core/games.ts`): detection (all Steam libraries via `libraryfolders.vdf`, standalone, Store), config locations, tracked-file suggestions, processes, installed version, path variables. One registry; no path tables anywhere else. Modules exist for DCS World, iRacing, Le Mans Ultimate, BeamNG.drive, Assetto Corsa, Assetto Corsa EVO, Assetto Corsa Rally and Microsoft Flight Simulator 2024.

What is bound in a game is read by other features through `ctx.bindings` (`src/core/bindings.ts`): a `BindingReader` per game, plain-language action labels (`ctx.bindings.labels`), and proposals that only the feature owning the game's files may write.

### IPC

One typed contract per feature (`contract.ts`: channel name → zod input and output). `main` registers handlers from the contract; the preload exposes only `invoke` and `on`, each checking the channel name against a fixed pattern first; the renderer calls through a typed client. No hand-duplicated channel strings. Every handler validates its input and its output. Paths received from the renderer are validated against allowed roots (`src/core/paths.ts`); a path picked in a native dialog is the user's own word and needs no such check. The shell's own channels (`src/shared/appContract.ts`) are bound from their contract too.

Every window (the main one and panels opened with `openPanel`) is created with context isolation on, node integration off and the sandbox on, under a Content-Security-Policy that allows scripts from the app only. A panel receives the same events as the main window and closes with the app.

### Logging and errors

- One logger (`src/core/logger.ts`): lines are `<ISO time> <LEVEL> [scope] message {data}`, written without blocking. Every line goes through a redactor: API keys, authorization headers and passwords are masked, the user's folder is written as `~`, long texts are cut.
- The file is `<data root>/logs/rigready.log`, at most 5 MB, with four older files kept (`RotatingFileSink` in `src/platform/node`). The logger exists before the data root is known; what is logged that early is kept and written once the file opens (`src/main/logging.ts`).
- Level: `RIGREADY_LOG_LEVEL` wins, then the `logLevel` setting (the "Detailed log" switch on the Diagnostics page), then `info`.
- Expected failures travel as `Result` and are shown by the screen that asked. Unexpected ones (an exception at the top of main or the window, a crashed helper process) go to the error center (`src/core/errorCenter.ts`, `src/main/errorHooks.ts`): logged, and shown as a notice in the window. A window whose page crashed is loaded again, at most three times a minute.
- Damaged data files are never silently replaced: they are set aside or left in place, named in a startup notice, and listed on the Diagnostics page (`src/core/dataHealth.ts`).
- Silent catches are not allowed without a reason in a comment (`tests/unit/swallowedErrors.test.ts`).

### Updates

`UpdateFeed` only fetches and installs; the `updates` feature decides when. Settings: `updates.check` (default on: at start and once a day) and `updates.channel` (`stable` or `beta`). A newer version downloads in the background and is installed when the user says so or when RigReady quits, never while a game is running. `docs/RELEASING.md` has the release process.

### The shell

`src/main/index.ts` refuses to start on anything but Windows (`platformGuard.ts`), holds a single-instance lock, picks the platform (real machine, or fake when `RIGREADY_SCENARIO` is set), wires the features, opens the window and keeps the tray (status, setup switch, Make ready, Launch, Stand down; its tooltip names what is not met; a double-click opens the window, one click brings it out or puts it away). While the window is hidden in the tray, unused memory is handed back to Windows (`trayMemory.ts`).

**Started to do something.** `RigReady.exe --fly "<setup id or name>"` makes the rig ready and launches, `--make-ready` stops before launching, `--setup` only shows the setup. The arguments are read by a pure function (`src/core/commandLine.ts`); the shell runs the command (`src/main/rigCommand.ts`) through the same IPC handlers the Fly screen and the tray use, so fixes run in Make ready order and a monitor layout still asks "Keep this layout?". One rule is the command's own: the game is launched only when every required item is met; anything else stops with the window in front and the reason on it. A second start hands what it parsed to the RigReady already running (the single-instance lock's `additionalData`), which comes forward and does it. The window shows the command on every screen (`src/features/one-click`), from the shell's contract (`app:command`, `app:cancelCommand`).

**The taskbar button.** The shell keeps RigReady's taskbar button current through the `Taskbar` port, from a pure model (`src/main/taskbarModel.ts`) fed by what it sees go by (every IPC call and every event): a Jump List of "Fly <setup>" tasks for the setups used most recently, the status badge of the setup in use (the tray's shapes) with its words, a progress bar while a check, Make ready, Launch or Stand down runs, and Make ready, Launch and Stand down as buttons under the window's thumbnail, which do what the tray's menu does.

**The hotkey.** A system-wide key combination, off until one is chosen on the Settings page (the `one-click` feature keeps it and registers it through the `Hotkeys` port). When it is pressed the shell brings the window forward and runs the `--make-ready` command for the setup in use. It never launches.

**The menu.** RigReady has no menu bar. Its application menu (`src/main/appMenu.ts`, a pure model) exists only for the keys a menu gives a window: zoom (Ctrl and +, with or without Shift; Ctrl and -; Ctrl+0) and full screen (F11). Without a menu of its own a program is handed Electron's, whose Ctrl+R loads the window again in the middle of an edit and whose Ctrl+Shift+I opens the developer tools; a run from source keeps those two. Every window, the main one and the ones a feature opens, is without a menu bar, and Alt does not bring one up.

## Test harness

| Layer | What it is |
|---|---|
| Gates | `npm run check` = typecheck (both projects), lint, format check, unit tests with coverage threshold, ledger validation. CI runs it on every push. |
| Unit | Vitest against `src/core` and feature `core/` using fake ports and real fixture files in a temp directory. No wholesale `fs` mocking. |
| Audits | Unit tests that scan every feature without a hand-written list, so a new feature is covered the moment its folder exists: silent catches, writes without a preview, IPC input and path handling, success claimed for a change that did not happen (the sabotage audit), stub controls, user paths outside `KnownFolders`, shell command strings, anything hardcoded to the owner's rig, layer imports, self-registration, check-run performance, behaviour on damaged files (fuzz). `docs/CONTRIBUTING-FEATURES.md` section 15 lists each one. |
| Fixtures | `fixtures/rigs/<name>/` holds a rig: devices, USB tree, displays, processes, services, audio, DirectInput controllers, registry keys, HidHide state, and a sanitized copy of game and tool config files. `mark-full` is recorded from the owner's machine; `generic-rig` is written by hand to be a PC with nothing of the owner's on it. |
| Scenarios | `RIGREADY_SCENARIO=<file>` starts the app on fake providers from a fixture plus mutations ("pedals unplugged", "MFD 2 rotated", "TrackIR not running"), with scripted answers for HTTP, shell commands and file pickers. The recorded files are copied into a fake user folder that also holds Program Files and the Steam library. |
| E2E | Playwright launches the built app per scenario with `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and `RIGREADY_HOME` pointed at a temp directory, drives a user flow, asserts, and saves screenshots to `artifacts/screens/<flow>/`. Tests never use `if (visible)` guards or fixed sleeps. Whole-app specs: accessibility (axe), keyboard-only use, a crawl of every route, every page on a generic PC, and a page-by-page tour on four rigs. |
| Rig smoke | `npm run rig:smoke` runs read-only checks against the real hardware on the owner's PC. `rig:smoke:apply` also changes and restores monitors and audio defaults. |
| Packaged smoke | `npm run smoke:packaged` builds the unpacked app and runs a scenario, real enumeration, live input, the updater against a local feed and start with Windows against it. |
| Installer smoke | `npm run smoke:installer` builds a test variant of the installer ("RigReady Test", separate app id and data folder), installs it without elevation, starts it, updates it on quit and uninstalls it. |

## Requirements ledger

`docs/requirements/ledger.yaml`: one entry per requirement with `id`, `title`, `job` (fly / configure / troubleshoot / platform), `done_means` (observable acceptance criteria), `status` (`todo` / `in_progress` / `done`), and `evidence` (test ids and screenshot paths). `npm run ledger:check` fails if a `done` entry has no evidence or its evidence does not exist. The ledger is updated in the same commit as the work.

## Safety

- `FileStore.write` outside the data root always snapshots the previous content to `<data root>/backups/auto/<timestamp>/` first and records it in a journal that the UI can show and undo.
- **The write preview rule.** A user-triggered write to game or tool files is shown first: main builds the plan, describes it with `changePreview()` (`src/core/files/preview.ts`), the renderer shows it (`ConfirmChanges.vue`), and the same plan is then applied under one `beginGroup()`. Nothing is written in the background: starting, idling and every read leave the journal empty. A fix that Make ready runs in one click names the files it writes beside the failing check. `tests/unit/writeAudit.test.ts` enforces all of this.
- `Shell.run` takes an executable and an argument array and uses `spawn` without a shell. Lint rules, a source scan and real-shell tests keep command strings out (`tests/unit/shellAudit.test.ts`).
- Changes made under one `FileStore.beginGroup()` are one user action: the Safety page lists them together and Undo puts every file back. Undo refuses a file that was changed again since, unless the user confirms. Automatic backups are pruned at startup by the retention settings.
- **No success without a read-back.** After changing the machine, a fix or action reads the result before it answers. The sabotage audit (`tests/unit/verifiedActions.test.ts`) makes the fake machine accept every change and carry out none, then runs every fix and every IPC channel; none may say "done".
- **IPC audit.** Every channel answers malformed and hostile input with a validation error, and no string from the renderer makes main read, write or start anything outside the allowed folders (`tests/unit/ipcAudit.test.ts`).
- **Tracked paths are confined.** A file or folder may be tracked for backup only when it is under the allowed roots or a game's own folder, or when main vouches for it (picked in the native dialog, already tracked, or suggested by a game module or backup source). Never a network or device path. Credential files are never read into a backup, snapshot or shared setup (`src/core/credentials.ts`).
- Lua from the game or from other tools is never run with file or process access: data files go through a strict parser, programs through a sandboxed VM with an instruction budget (`src/core/lua`).
- Imported bundles are validated with zod, inspected before unpacking, never write outside resolved known folders, and never carry runnable content silently: scripts and launch commands are stripped and listed for the user.
- Display apply uses the Windows display configuration API directly, captures the prior layout, and exposes revert. A new layout reverts by itself unless the user keeps it.
- No administrator rights: nothing asks for elevation, the installer is per user (`tests/unit/noAdmin.test.ts`).

## Conventions

- Errors: core returns `Result<T, RigError>` for expected failures; throws only for bugs.
- No dead code and no stubs: anything not reachable from a mounted route or a registered handler is deleted, not parked; no control without a working handler (`tests/unit/noStubs.test.ts`).
- Status is never colour alone: the status classes bring an icon and words (`tests/unit/statusNotColourOnly.test.ts`).
- Commits are small and each leaves `npm run check` green.
