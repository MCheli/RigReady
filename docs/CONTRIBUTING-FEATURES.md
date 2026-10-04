# Adding a feature

How to add a feature to RigReady without touching a shared file. Read `docs/PRODUCT.md` and `docs/ARCHITECTURE.md` first; this page is the mechanics and the inventory of what the shared foundation gives you.

Contents: [ground rules](#ground-rules) · [working in a worktree](#working-in-a-worktree) · [commands](#commands) · [1 the feature folder](#1-the-feature-folder) · [2 IPC](#2-ipc-contract) · [3 checks](#3-a-check-type-and-its-fix-and-its-capture) · [4 renderer](#4-renderer-manifest-pages-navigation) · [5 game modules](#5-a-game-module) · [6 ports](#6-ports-what-ctxports-gives-you) · [7 core helpers](#7-core-helpers) · [8 unit tests](#8-unit-tests) · [9 scenarios and mutations](#9-scenarios) · [10 the recorded rig and the generic rig](#10-the-recorded-rig-mark-full) · [11 e2e](#11-an-e2e-flow) · [12 ledger](#12-ledger-evidence) · [13 before you commit](#13-before-you-commit) · [14 the features being built now](#14-the-features-being-built-in-parallel)

## Ground rules

- You own `src/features/<your-feature>/`, your scenario files, your e2e spec, your screenshot folders and your ledger entries. Nothing else.
- **Shared, do not edit:** `src/core`, `src/shared`, `src/main`, `src/renderer`, `src/platform`, `src/features/settings`, `src/features/safety`, `tests/helpers.ts`, `tests/e2e/harness.ts`, `scripts/`, `package.json`, the config files, `fixtures/rigs/`, existing scenario files, this document. If you need a change there (a port method, a mutation, a dependency), write down exactly what and why in your final report and work with what exists; do not work around it by reaching past the ports.
- A feature imports from `src/core`, `src/shared`, and (renderer side) `src/renderer/ipc.ts` and `src/renderer/machine.ts`. Never from another feature, `src/main`, `src/platform` or `src/legacy` (ESLint and `tests/unit/architecture.test.ts` enforce this).
- Only `src/platform` imports `fs`, `child_process` or `koffi`. Everything else, your `main.ts` included, goes through `ctx.ports` (`src/core/ports/index.ts`).
- Files outside RigReady's data folder are changed only through `ctx.ports.files` (`write`, `copy`, `move`, `remove`, `copyTree`, `extractZip`). It backs up first and journals the change; the user sees it on the Safety page and can undo it. Give every change a `reason` a user can read ("Migrate 3 device ids"), and put the changes of one user action in one group (`beginGroup`).
- Programs are started only with `ctx.ports.processes.start` or `ctx.ports.shell.run(exe, args[])`. Never a command string.
- Expected failures are returned as `Result` (`ok(value)` / `err(code, message, detail?)` from `src/core/result.ts`). Throw only for bugs.
- Never report success for something that did not happen: after changing the machine, read it back, then return `ok`.
- `src/legacy/` holds old code to mine (see its README). Copy what you need into your `core/`, port it to the ports, test it, and delete the legacy file.

## Working in a worktree

Each feature is built in its own git worktree. A fresh one works like this:

```
git worktree add ../rigready-<feature> -b feature/<feature>
cd ../rigready-<feature>
npm ci
npm run check        # typecheck, lint, format, unit tests with coverage, ledger
npm run test:e2e     # builds, then runs every scenario flow (downloads Electron on first use)
```

Nothing else is needed for unit and e2e work: both run on fake providers. `npm run setup:python` (the DirectInput sidecar's runtime) is needed only for `rig:smoke`, `pack` and `smoke:packaged`. Worktrees do not interfere with each other: every test run uses its own temp folders, and e2e launches are isolated per instance. Do not run `rig:smoke:apply` from a feature worktree unless your feature is displays or audio; it changes the real monitors and default audio device (and restores them).

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Typecheck (node and web projects), lint, format check, unit tests with coverage threshold, ledger check. Must pass before every commit. |
| `npm run format` | Fix formatting. |
| `npm test` / `npm run test:watch` | Unit tests. |
| `npm run test:e2e` | Build, then run every scenario flow. Screenshots land in `artifacts/screens/<flow>/`. |
| `npx playwright test tests/e2e/<file>.e2e.ts` | One e2e file (run `npm run build` first). |
| `npm run dev:scenario -- <scenario>` | The app in dev mode on a scenario (fake providers, temp data folder). |
| `npm run ledger:check` | Validate `docs/requirements/ledger.yaml`. |
| `npm run rig:smoke` | Read-only checks against the real hardware. Not for CI. |
| `npm run rig:smoke:apply` | Also changes and restores the real monitor layout and default audio devices. Owner's PC only. |
| `npm run smoke:packaged` | `electron-builder --dir`, then enumeration, a scenario and a real start against the unpacked app. |
| `npm run rig:record -- <name> [--only=files,registry,...]` | Record this PC into `fixtures/rigs/<name>/` (coordinator only). |

Never run `npm run dev` or the built app without a scenario for testing: that uses the real machine and the real `~/.rigready`.

## 1. The feature folder

```
src/features/<name>/
  contract.ts     IPC contract: channel -> zod input/output, events
  core/           domain logic against ports, with *.test.ts next to it
  main.ts         default-exports defineFeatureMain({...}); discovered by glob
  index.ts        default-exports defineFeature({...}) manifest; discovered by glob
  renderer/       pages, components, Pinia store
```

`main.ts` and `index.ts` are found with `import.meta.glob`; there is no registry to edit. The feature id is lower-case letters, digits and dashes, and is the prefix of its IPC channels.

`src/features/devices/` is the smallest complete example; `src/features/displays/` shows a check, a remediation, a capture, a stand-down step, events and an overlay; `src/features/settings/` and `src/features/safety/` show pages that change things and report errors.

## 2. IPC contract

`contract.ts`:

```ts
import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';

export const audioContract = defineContract(
  'audio',
  {
    read: channel(noInput, AudioStateSchema),
    setDefault: channel(z.object({ id: z.string() }), z.object({ changed: z.boolean() })),
  },
  { changed: z.object({ id: z.string() }) } // events (optional)
);
```

`main.ts`:

```ts
import { bind, defineFeatureMain } from '../../core/feature';
import { audioContract } from './contract';

export default defineFeatureMain({
  id: 'audio',
  setup(ctx) {
    // ctx: ports, log, checks (registry), games (registry), profiles, settings, layouts,
    //      names, bindings, backupSources, emit
    return [
      bind(audioContract, {
        read: () => ctx.ports.audio.read(),          // handlers return Promise<Result<output>>
        setDefault: async ({ id }) => { /* ... */ },
      }),
    ];
  },
  dispose() {},                                      // optional, on quit
});
```

- The compiler rejects a missing or mistyped handler. Input is validated before your handler runs and output after; anything thrown becomes an error result.
- Send an event with `ctx.emit(audioContract, 'changed', { id })`.
- A path that arrives from the renderer must be validated before use: `resolveAllowedPath(path, await allowedRoots(ctx.ports))` from `src/core/paths.ts`. A path the user picked in `ctx.ports.dialogs` needs no such check; keep it in main and hand the renderer only what it needs to display.

Renderer:

```ts
import { errorText, useClient } from '../../../renderer/ipc';
const api = useClient(audioContract);
const result = await api.read();                 // Result<AudioState>, never throws
if (!result.ok) error.value = errorText(result.error);
const off = api.on('changed', (p) => { /* ... */ });   // call off() in onBeforeUnmount
```

## 3. A check type (and its fix, and its capture)

Register in `main.ts` `setup`, implement in `core/`:

```ts
ctx.checks.registerCheck({
  type: 'audio.defaultDevice',            // "<feature>.<name>", unique
  group: 'audio',                         // devices | apps | displays | audio | files | other
  label: 'Default audio device',
  params: z.object({ id: z.string(), flow: z.enum(['playback', 'recording']) }),
  async run(params, ctx) {                // ctx: { ports, log, profile? } (profile: the setup being checked)
    return { pass, summary: 'Speakers are the default', details: [] };
  },
  async standDown(params, ctx) { return ok(null); },   // optional; ok('what was done') or ok(null)
});

ctx.checks.registerRemediation({
  type: 'audio.setDefault',
  label: 'Set the default device',
  order: 150,                             // Make ready runs ascending: apps 100, displays 200, files 300
  params: z.object({ id: z.string() }),
  describe: (p) => 'Make Speakers the default',        // shown beside the failing check
  async run(params, ctx) { return ok('Made Speakers the default'); },   // or err(...)
});

ctx.checks.registerCapture({
  id: 'audio',
  label: 'Audio',
  async capture(ctx) {                    // propose checks from the machine as it is now
    return ok([{ key, group: 'audio', title, description, selectedByDefault: true,
      check: { type: 'audio.defaultDevice', title, required: true, params,
               remediation: { type: 'audio.setDefault', params } } }]);
  },
});

ctx.checks.registerStandDownStep({        // something Stand down does once, whatever the profile's checks
  id: 'audio.restoreDefault', label: 'Audio', order: 300,
  async run(ctx) { return ok(null); },    // ok('what was done'), ok(null) for nothing to do, or err
});
```

That is all: the Fly screen, Make ready, Stand down and the capture screen pick the new types up through the registry. Rules the engine applies for you: a required check that is not met is `fail` (red) and makes the setup Not ready; an optional one is `warn` (yellow) and never does. A check that throws, has bad params, an unknown type, or runs longer than the check timeout from the settings is reported as not met, never as a crash. A remediation must not report success for something that did not happen: verify, then return `ok`.

An item with `disabled: true` in the setup (`CheckItem.disabled`, the On/Off switch in the setup editor) is not run at all: its result carries `disabled: true` (status `pass` only so it never counts against readiness), it has no fix, Make ready and Stand down leave it alone, and the Fly screen shows it muted as "Off", never as passed. Anything that lists results must look at `result.disabled` before calling an item passed. Imports use it for checks whose device is not on this PC.

A fix that does something useful without making its check pass (the backup feature's `backup.gameFiles`, "Back up now" on the game-updated warning) uses `kind: 'navigate'`: its button works on the item and its message is shown as it is, and Make ready lists the item under "Needs you" instead of running it on every pass.

More that the registries offer (all optional; `src/core/checks/registry.ts` has the details):

- **The setup a check runs for.** `ctx.profile` is `{ id, name, game?, install? }` whenever a check, fix or launch action runs for a setup (the engine sets it; Configure pages have none). `allPathVariables(ctx, games)` follows it: when the setup names the install it uses (`Profile.gameInstall`, the "Install this setup uses" field in the editor), `{DCS_INSTALL}` and `{DCS_USER}` are that install's folders, and unresolvable when it is gone (never another install's). A feature with its own path lookup should honour `ctx.profile.install` the same way (dcs-setup's `service.for(ctx)` and dcs-bindings' per-install service are the examples).
- **Program output.** A fix or action that ran a program calls `ctx.output?.(text)` with what it printed; the step shows it whether it worked or not.
- **Scripts get the setup as environment variables**, never as command text: `scriptEnvironment(ctx, games)` from `core/scriptEnv.ts` gives `RIGREADY_PROFILE_NAME`, `_ID`, `RIGREADY_GAME`, `RIGREADY_GAME_PATH`, `RIGREADY_USER_DATA`, `RIGREADY_HOME`; pass it as `env` to `ports.shell`.
- **A fix that waits.** A fix may take as long as the user needs: the monitor layout fix applies the layout and resolves only when "Keep this layout?" is answered (`LayoutApplier.applyAndWait`), and fails with `display.reverted` when it was not kept. Make ready and Stand down therefore always know which layout is really there.
- **Capture candidates** can say more than what to check: `game: 'dcs'` (kept by default only in a setup for that game), `program: 'StreamDeck.exe'` (two candidates for one program collapse into the more specific one; the list of running apps marks its own with `generic: true`), `covers: ['TrackIR5.exe']` (this candidate replaces the generic "is running" one and takes over its tick), and `ask: { param, label, placeholder?, hint? }` (one question on the capture screen; the answer lands in `params[param]`).
- **`adopt(item, ctx)` on a check type** runs when a setup is created from the capture screen, before it is saved, and may finish the item. The monitor check uses it to save the captured arrangement as a named layout when the user gave a name.
- **Core never names a check type** (`checks-generic/core/registration.test.ts` enforces it): anything the engine must know about an item is a field on the definition or the candidate.

The displays feature already registers the stand-down step `displays.deskLayout`: when the settings name a desk layout, Stand down applies it (with the keep-or-revert countdown).

Also list the types in your manifest (`checkTypes`, `remediationTypes`) so editors can label them.

## 4. Renderer: manifest, pages, navigation

`index.ts`:

```ts
import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'audio',
  nav: [{ title: 'Audio', icon: 'mdi-volume-high', to: '/configure/audio', order: 320, section: 'Hardware' }],
  routes: [{ path: '/configure/audio', component: () => import('./renderer/AudioPage.vue') }],
  checkTypes: [{ type: 'audio.defaultDevice', label: 'Default audio device', group: 'audio' }],
  // overlays: [Prompt]   components mounted at the app root on every screen
  // settings: [{ title: 'Audio', component: () => import('./renderer/AudioSettings.vue') }]
});
```

- Routes must start with `/configure/` (they render inside the Configure layout). Sections: `Setup` (100s), `Bindings` (200s), `Hardware` (300s), `App` (900s; Settings is 910, Safety 920).
- Use the design system in `src/renderer/styles.css`: `rr-page`, `rr-page-title`, `rr-page-sub`, `rr-panel`, `rr-row` / `rr-row-main` / `rr-row-title` / `rr-row-sub`, `rr-section-title`, `rr-empty`, `rr-mono`, and the status colours `rr-ok` / `rr-warn` / `rr-bad`. Vuetify components are auto-imported. Green, yellow and red mean status and nothing else.
- State that outlives a component goes in a Pinia store in `renderer/`.
- After your feature changes the machine, call `notifyMachineChanged()` from `src/renderer/machine.ts`; to refresh when others do, subscribe with `onMachineChanged(fn)` (it returns the unsubscribe). The shell also calls it when a USB device is plugged in or removed, when the tray acts, and when a test changes the fake machine.
- Give every element a test drives a `data-testid`.
- Do not render a button for something that is not implemented.
- A setting of your own that belongs on the Settings page: list it in the manifest as `settings: [{ title, component, order? }]`. Settings gives the component a titled panel below its own sections; the component reads and stores the setting through your feature's IPC (`src/features/devices/renderer/NotificationSettings.vue` is the example, shown on the Devices page too).
- Linking to another feature's page is done by route, never by import. Two routes take parameters, validated on arrival: `/configure/devices?profile=<setup id>&item=<checklist item id>` opens the device a checklist item is about, connected or not (the Fly screen's Diagnose link), and the route a `BindingReader` gives (`ctx.bindings.get('dcs')?.route({ guid, aircraftId })`) opens a controller's bindings.

## 5. A game module

`src/features/games/<game>/module.ts` default-exports a `GameModule` (`src/core/games.ts`):

| Member | What it gives |
|---|---|
| `id`, `name` | |
| `detect(ctx)` | Every install: all Steam libraries from `ctx.ports.folders.steamLibraries()`, standalone, Store. |
| `configLocations(ctx)` | Where the game keeps per-user configuration. |
| `trackedFiles?(ctx)` | Files worth tracking and backing up, absolute paths. The backup page offers each with one-click add, so put one whole-folder item first (`kind: 'folder'`, `include` / `exclude` globs, a `description` of what it holds and leaves out) and the single files after it. Only what exists on this PC. |
| `processes?` | Image names that mean the game is running (`['iRacingUI.exe', 'iRacingSim64DX11.exe']`). The Games page and the Steam-launch watcher use it, and backup: the game must be closed before its files are restored. |
| `closeBeforeRestore?` | `{ processes?, why }`: which of the game's programs write its files (default: all of `processes`) and one sentence the user reads when a restore is refused ("iRacing writes these files when the simulator exits, which would undo the restore."). |
| `installedVersion?(ctx, install)` | `{ version, updatePending? }` for "updated since you last verified". Steam games: `readSteamApp` (section 7). |
| `pathVariables?(ctx)` | The game's path variables, e.g. `{ DCS_USER, DCS_INSTALL }` (section 7). |
| `bindings?` | Marker for the binding feature. |

`src/features/games/core/helpers.ts` `GameModuleExtras` (a module's `export const extras`) holds only what the Games page needs: `kind`, `manualFolder`, `notes`, `facts`. Process names are on the module itself.

It is discovered by glob from `src/features/games/main.ts` and is the only place that game's paths may appear. `src/features/games/dcs/module.ts` is the example. Game-specific checks and screens live in your own feature folder and are registered from your `main.ts` using `ctx.games.get('<id>')`.

### A backup source (tools that are not games)

A helper tool registers what is worth backing up from its `main.ts` (`src/core/backupSources.ts`); Stream Deck, TrackIR and Fanatec do:

```ts
ctx.backupSources.register({
  id: 'stream-deck',
  label: 'Stream Deck',                       // the group heading on Backups -> Tracked files
  async suggest(ctx) {                        // absolute or stored paths; missing ones are left out for you
    return ok([{ label: 'Stream Deck profiles', path: profilesDir, kind: 'folder',
      description: 'Every profile with its pages, actions and icons.' }]);
  },
  program: {                                  // optional: what must be closed before these files are restored
    name: 'Stream Deck', processes: ['StreamDeck.exe'], restart: true,
    why: 'Stream Deck keeps its profiles in memory and writes them when it quits, which would undo the restore.',
  },
  async records(ctx) {                        // optional: settings that are not files (registry values)
    return ok([{ id: 'service', label: 'Fanatec driver settings (registry)',
      from: 'HKEY_CURRENT_USER\\Software\\Endor\\FanatecService', data }]);
  },
});
```

- Suggestions become tracked items only when the user adds them; a full backup then includes them. `backup:backUp` with scope `{ kind: 'game', gameId }` (the `backup.gameFiles` fix) backs up everything a game's module and sources suggest without tracking anything.
- `records` are stored in every full backup under `records/` and listed in the backup and on the restore screen as "Kept as a record": readable, never restored (the registry port is read-only).
- Before a restore (and before a snapshot is put back) the backup feature looks for running programs that hold the files it would write: game modules by `processes` / `closeBeforeRestore`, sources by `program`, matched by the item's `game` or by its path lying in the game's `configLocations` / `trackedFiles` or the source's suggestions. The restore is refused with the name and the reason; with `closePrograms: true` it asks each one to close (`ports.processes.close`, never forced), restores, and starts the ones marked `restart` again. Nothing for a feature to call: declare the facts and the restore screen does the rest.

## 6. Ports: what `ctx.ports` gives you

Every port has a real implementation (`src/platform/windows`, `src/platform/electron`, `src/platform/node`) and a fake (`src/platform/fake`) that unit tests and scenario runs use. The fake column lists what a test can inspect or steer; `rig.ports` in a test has the fake types.

| Port | Methods | Fake extras |
|---|---|---|
| `devices` | `list()` USB devices with identity and hub chain; `subscribe(fn)` called on plug/unplug | `emitChanged()`; state in `ports.state.devices` |
| `input` | `start()` the DirectInput controllers a game sees, each with `guid` (instance GUID), `productGuid`, `vendorId`, `productId`, `axisNames`; `devices()`; `subscribe(fn)` live state, starting with the last known state of every device; `stop()` | `emit(states)` |
| `displays` | `read()` (each monitor with `id`, EDID `serial`, `usbSerial` / `usbId` for a USB screen, `connector`, `modes` while it is on), `apply(targets)` (position, rotation, on/off, main display, and `width`/`height`/`refreshHz` when the mode should change; one call, monitors being turned on included), `canRevert()`, `revert()` | state in `ports.state.displays`; refuses a mode the monitor does not list (`display.mode`) |
| `processes` | `list()`, `start(target)`, `stop(pid)` (terminate), `close(pid, { waitMs, force })` (ask politely, wait, terminate only if `force`; `process.stillRunning` otherwise) | `started`, `closed`, `stubborn` (names that ignore a polite close) |
| `services` | `list()`, `get(name)` Windows services with state | `ports.state.services` |
| `audio` | `read()`, `setDefault(id, { roles? })` (all three roles by default; flow follows the device) | `calls` |
| `registry` | read-only: `getValue(hive, key, name)`, `listKeys`, `listValues`; hives `HKCU`, `HKLM`; values are `{ type: 'string' \| 'number' \| 'binary' (hex) \| 'strings', value }` | `ports.state.registry` (keys recorded from the rig) |
| `files` | see FileStore below | real files in a temp folder |
| `folders` | `home`, `documents`, `savedGames`, `appData`, `localAppData`, `programFiles`, `programFilesX86`, `programData`, `dataRoot`, `steamLibraries()`, `machineName()` (this PC's name; never use `os.hostname()`) | all under the fake home; the machine is `RIG-PC` |
| `shell` | `run(exe, args[], { cwd, timeoutMs, env, hidden })`, `launch(exe, args[], { cwd, env, hidden })`. `env` is added to RigReady's own environment; `run` hides the console window unless `hidden: false`. Batch files (`.cmd`, `.bat`) and `.ps1` scripts are started through cmd.exe / powershell.exe by the platform, each argument as one literal value; a batch file refuses an argument containing a double quote (`shell.argument`) | `calls` (with the options given), `scripts` (canned answers); emulates `HidHideCLI.exe` |
| `clock` | `now()` | `TestClock` with `advance(ms)` |
| `secrets` | `get/set/remove(name)`; encrypted with Electron safeStorage in the app | in-memory `values` |
| `http` | `request({ method, url, headers, body, timeoutMs })` (https only); a response with any status is `ok`. `stream({ ...the same, idleTimeoutMs, signal }, onChunk)` hands the body of a 2xx response over as raw bytes while it arrives (a chunk may end mid-line or mid-character) and resolves when the server closes it; any other status comes back whole. It fails with `http.idle` (nothing for `idleTimeoutMs`, default 60 s), `http.timeout` (only when `timeoutMs` is given), `http.cancelled` (`signal` aborted) or `http.network` | `calls`, `scripts`, `respond(urlPart, { status, json \| body \| stream: { chunks, delayMs, chunkBytes, end } })`; an unscripted request is an error; scripted pauses run in real time |
| `dialogs` | `open({ title, filters, directory, multiple })` -> paths (empty = cancelled); `save({ defaultPath, filters })` -> path or null | `script.open` / `script.save` queues, `calls` |
| `render` | `png(html, { width, height })` exact pixel size; `pdf(html, { pageSize, landscape })`. No scripts run in the HTML. | returns a real one-colour PNG of that size and a stub PDF; `calls` holds the HTML |
| `notifications` | `notify({ title, body })` | `sent` |
| `loginItem` | `isEnabled()`, `setEnabled(bool)` (start with Windows) | `enabled` |
| `overlays` | `showLabels([{ x, y, width, height, text, caption, up? }], durationMs)` big labels on monitors ("Identify"); `up` draws a "this side up" arrow | `shown` |
| `window` | `showOn(areas)`: RigReady's own window, shown on one of these desktop areas (moved there when it is elsewhere). The layout applier calls it before and after a change so "Keep this layout?" is on a monitor that is on | `shown` |

**The input reader's lifetime.** One DirectInput reader (the sidecar) serves the whole app. A feature calls `ctx.ports.input.start()` every time it needs controllers and never calls `stop()`: `start()` is idempotent (it answers at once while the reader runs, calls made while it is starting share that one start, and after a failed start the next call tries again). Only the app shell stops the reader, on quit. A feature that listens to live input keeps the function `subscribe` returns and calls it when it is done; do not cache the result of `start()`, ask again (`tests/unit/inputLifetime.test.ts`).

In a scenario run of the real app (e2e, `dev:scenario`) everything is fake except `secrets` and `render`, which are the real Electron ones working inside the temp data root.

### FileStore (`ctx.ports.files`)

| Method | Notes |
|---|---|
| `readText`, `readBytes`, `exists`, `stat` | `stat` gives `{ name, path, isDirectory, size, mtimeMs }` or undefined |
| `list(dir)`, `listEntries(dir)` | names; entries with metadata. A missing folder is empty, not an error |
| `listTree(dir, { include, exclude, maxEntries })` | every file below, with `relativePath` (forward slashes). Globs: `*.lua` matches a name at any depth, `Config/Input/**` a subtree, `Config/*.lua` one level; case-insensitive; exclude wins |
| `mkdir(dir)` | not journaled |
| `write(path, content, { reason, group?, journal? })` | text or bytes. Outside the data root: backup, journal entry returned. Inside: plain write, returns null, unless `journal: true` (a file inside the data root that an undo should cover, e.g. the setup an import creates). A change made without a `group` is a journal group of its own, named by its `reason`: every journal entry carries `groupId` and `groupReason`, and the Safety page lists every change as an action |
| `copy(from, to, opts)`, `move(from, to, opts)`, `remove(path, opts)` | journaled like `write`; `move` is a write plus a remove in one group |
| `copyTree(fromDir, toDir, { reason, group?, include, exclude })` | one group for the whole copy |
| `beginGroup(reason)` | pass the returned group to every change of one user action |
| `journal()`, `journalGroups()` | newest first |
| `undo(entryId, { force })`, `undoGroup(groupId, { force })` | fails with `journal.changed` when a file was modified since, unless forced; the undo is itself journaled |
| `prune({ days, groups })`, `backupBytes()` | used by the shell at startup and the Safety page |

Preview (`src/core/files/preview.ts`): `previewWrites(files, planned)` takes the writes a feature is about to make (`{ path, content }`, `{ path, content, from }` for a rename, `{ path, remove: true }`) and says, without writing, what each one does to the file on disk: `created`, `modified` (with a one-line summary: lines added and removed for text, sizes for binary), `renamed`, `deleted` or `unchanged`, with sizes and a one-line total ("2 files modified, 1 file created"). Use it for the "this is what will change" list before any user-triggered write outside the data root, then apply the same plan under one `beginGroup()`. The racing restore and the BeamNG older-bindings copy are the examples (`racing:restorePreview`, `racing:beamngCopyOlderPreview`).

Zip (`src/core/files/zip.ts`): `createZip(entries)`, `readZip(bytes, { maxTotalBytes, maxEntries })`, `zipFolder(files, dir, { include, exclude, prefix })`, `extractZip(files, bytes, destDir, { reason, group?, maxTotalBytes })`. Unsafe entry names (absolute, drive letters, `..`) fail the whole archive before anything is written; extraction goes through FileStore as one group. Use the import cap from the settings: `settings.importMaxMegabytes * 1024 * 1024`.

## 7. Core helpers

| Module | What |
|---|---|
| `core/settings.ts` | `ctx.settings.get()` / `update(patch)` / `onChange(fn)`. Fields: `deskLayoutId`, `startWithWindows`, `minimizeToTray`, `aiKeyPresent`, `retention.autoBackupDays` (30) / `autoBackupGroups` (50), `displayRevertSeconds` (15), `checkTimeoutSeconds` (5), `importMaxMegabytes` (200). The Anthropic key itself is in `ctx.ports.secrets` under `AI_KEY_SECRET`; the Settings page stores and removes it. |
| `core/displays/layouts.ts` | `ctx.layouts`: named monitor layouts in `<data root>/displays/layouts.json`: `list`, `get`, `create(name, targets)`, `createFromCurrent(name, provider)`, `rename`, `replace`, `remove`; `layoutToTargets(layout)`. |
| `core/jsonStore.ts` | `new JsonStore(files, file, zodSchema)`: `read()` (defaults when missing, error when damaged), `write`, `update(fn)`. The way to keep your feature's own data under the data root. |
| `core/profile/schema.ts` | `profileExtension(profile, '<feature>', schema)` and `withProfileExtension(profile, '<feature>', value)`: your feature's per-profile data lives in `profile.extensions[<feature id>]`, validated by your schema. Do not add fields to `ProfileSchema`. |
| `core/pathVariables.ts` | `allPathVariables(ctx, ctx.games)` -> `{ USER, DOCUMENTS, SAVED_GAMES, APPDATA, LOCALAPPDATA, PROGRAM_FILES, PROGRAM_FILES_X86, RIGREADY_HOME, STEAM?, DCS_USER?, DCS_INSTALL?, ... }`; `expandPath('{DCS_USER}/Config/options.lua', vars)`; `collapsePath(absolute, vars)` (longest match wins). Store paths in the collapsed form in profiles, backups and shared files. |
| `core/paths.ts` | `isWithin`, `resolveAllowedPath`, `allowedRoots(ports)`. |
| `core/backupSources.ts` | `ctx.backupSources.register(source)`: what a tool suggests backing up, the program that holds those files, and records (section 5). |
| `core/tracked.ts` | `resolveTrackedItem(files, item, variables)`: where a tracked item is on this PC and which files it covers now (credentials withheld); `trackedFileTarget`. `TrackedItemSchema`, `BACKUP_EXTENSION` for a profile's tracked items. |
| `core/steam.ts` | `readSteamApp(ports, appId)` / `listSteamApps(ports)` -> `{ installDir, buildId, targetBuildId?, lastUpdated?, stateFlags, updatePending }`; `steamRoot(registry)`. |
| `core/names.ts` | `ctx.names`: the names the owner gave things. `await ctx.names.monitors()` (by monitor id) and `(await ctx.names.devices()).nameOf({ vendorId, productId, serial?, instanceId?, guid? })`. The displays and devices features provide them (`provideMonitors`, `provideDevices`); every other feature only reads. A name is something to show beside the hardware name; never match on it, and never guess between identical devices (the lookup returns nothing when it cannot tell). |
| `core/bindings.ts` | `ctx.bindings`: what is bound in a game, for features that do not own its files (input tester, cheat sheets, AI guidance). `ctx.bindings.get('dcs')` / `all()` give a `BindingReader`: `available()`, `aircraft()` (id, name, hasUserBindings), `bindings(aircraftId)` (per device: kind, name, givenName, guid, vendorId, productId, connected, and per binding: `input` such as JOY_BTN3, `inputLabel`, `kind`, `modifiers`, `actionId`, `action`, `category`, `source: 'user' \| 'default'`), `route({ guid?, aircraftId? })`. Read only. A bindings feature registers its reader with `ctx.bindings.register(reader)`. |
| `core/directInput.ts` | `readDirectInputIdentities(ports.registry)` -> per VID/PID: product name (the name in DCS file names), product GUID, instance GUID per calibration slot; `identityForDevice`, `identityForGuid`, `dcsGuidText` (DCS's casing), `sameGuid`, `guidFromBytes`. For the controllers attached now, `ports.input.start()` gives the live instance GUID. |
| `core/lua/data.ts` | `parseLuaData(text)` / `writeLuaDocument(doc)` for DCS data files (binding diffs, `options.lua`, `appSettings.lua`): an unchanged file is written back byte for byte. `LuaTable` keeps order and key types (`get`, `set`, `table`, `list`, `toJs`, `LuaTable.from(plain)`). Anything that is not table data fails with a line number. |
| `core/lua/sandbox.ts` | `runLua(source, { prelude, globals, files, read, maxInstructions })` evaluates Lua that is a real program (input `default.lua`, MonitorSetup) with no io/os, `dofile` limited to what `files` hands out, and an instruction budget. `tests/unit/lua.test.ts` shows the prelude that evaluates the F/A-18C and UH-1H joystick defaults. |
| `core/vdf.ts` | `parseVdf` for Valve KeyValues files. |
| `core/usb.ts` | `buildUsbTree(devices)`. |
| `core/displays/identity.ts` | `matchMonitors(expected, actual)` / `findMonitor`: which connected monitor a stored one is. In order: the USB device serial of a USB screen (the same on any port), the id (model plus connector), an EDID serial only one monitor of the model has, then being the only one of its model. Every feature that stores monitors uses this (layouts, setups, the DCS screen setup); store `serial` and `usbSerial` next to the id (`layoutToTargets` does). `core/displays/edid.ts` parses an EDID block. |
| `core/scriptEnv.ts` | `scriptEnvironment(ctx, games)`: what a script is told about the setup, as environment variables. |

## 8. Unit tests

Tests live next to the code (`core/thing.test.ts`) and run on fake ports backed by the recorded rig, with real files in a temp directory. From `tests/helpers.ts`:

```ts
const rig = await scenarioRig('flying-all-good');   // { ports, ctx, clock, home, cleanup }
const rig = await scenarioRig('flying-all-good', { files: ['Saved Games/DCS/**'] });  // copy only these recorded files
const app = await wiredApp('flying-trackir-not-running', { files: [] });               // every feature wired; no files
const report = await app.invoke('fly:check', { profileId: 'dcs-f-a-18c' });   // through IPC validation
await mutate(rig, [{ op: 'unplugDevice', match: { productId: 'B68F' } }]);    // any scenario mutation, live
rig.ports.http.respond('api.anthropic.com', { json: { content: [] } });       // script a port
rig.ports.dialogs.script.open.push(['Documents/setup.rigready']);
app.events;                                          // events emitted to the renderer
app.layoutAnswer = 'wait';                           // 'keep' (default) | 'revert' | 'wait': the answer to "Keep this layout?"
await rig.cleanup();                                 // in afterEach
```

- `rig.home` is the fake user folder; every `ports.folders.*` path is under it, Program Files included. A scenario copies the rig's recorded files there (section 10). Copying all of them takes about a tenth of a second per test, so pass `files` with the globs you need (or `[]`) when a test does not need everything.
- To make a provider fail, replace the method: `rig.ports.devices.list = async () => err('x', 'nope')`. To make it hang, or a program fail to start, use the `hangProvider` and `failProcessStart` mutations.
- A fix that applies a monitor layout waits for the keep-or-revert answer. `wiredApp` answers "keep" by itself; set `app.layoutAnswer` to `'revert'` or to `'wait'` (then answer through `displays:keep` / `displays:revert`).
- Do not mock `fs`. Test code may use `node:fs` to arrange and inspect the temp folder.
- Temp folders (`rigready-test-*`, `rigready-e2e-*`, `rigready-scenario-*` in `%TEMP%`) are removed when a test ends; what a killed run leaves behind is cleared by the next run once it is an hour old.
- Coverage thresholds (80% lines/functions/statements, 70% branches) apply to `src/core`, `src/shared`, `src/platform/fake`, `src/platform/node` and every feature's `core/`.

## 9. Scenarios

A scenario is `fixtures/scenarios/<name>.yaml`: a recorded rig plus mutations and scripted answers.

```yaml
description: Flying, pedals unplugged       # shown in the app's scenario banner
rig: mark-full                              # fixtures/rigs/<rig>
extends: flying-all-good.yaml               # optional: its mutations, profiles, data and scripts apply first
mutations:
  - { op: unplugDevice, match: { vendorId: 044F, productId: B68F } }
profiles:
  - profiles/dcs-f-a-18c.yaml               # copied into <data root>/profiles at startup
data:
  displays/layouts.json: data/my-layouts.json   # any other file for the data root: target -> source
http:
  - match: { url: api.anthropic.com, method: POST, body: 'F/A-18C' }   # all optional, substring matches
    response: { status: 200, json: { content: [{ type: text, text: '...' }] } }   # or body: '...'
    times: 1                                # optional; then the next matching entry is used
  - match: { url: down.example }
    error: ECONNREFUSED                     # fails like a dead network
shell:
  - match: { exe: tasklist, args: ['/FO'] } # exe: substring of the path; args: all must be present
    result: { code: 0, stdout: '...', stderr: '' }
dialogs:
  open: [['Documents/setup.rigready'], []]  # one entry per open() call; [] = cancelled
  save: ['Documents/out.rigready', null]    # one entry per save() call; null = cancelled
```

Quote ids that YAML would read as numbers (`'4098'`, `'17E9'`). A mutation that matches nothing is an error. Paths in `writeFile`, `removeFile`, `dialogs` are relative to the fake user folder. A request to `ports.http` that no entry matches fails with `http.unscripted`.

A body that arrives in pieces (for `ports.http.stream`) is a `stream` in place of `json` or `body`:

```yaml
http:
  - match: { url: api.anthropic.com/v1/messages, method: POST }
    response:
      status: 200
      stream:
        delayMs: 90                         # real-time wait before every chunk (default 0)
        chunkBytes: 7                       # optional: cut the whole body again every 7 bytes, mid-line and mid-character
        end: close                          # close (default) | hang (silent until the idle timeout or Cancel)
                                            # | stall (fails as the idle timeout does, at once) | reset (connection breaks)
        chunks:
          - "event: ping\ndata: {}\n\n"     # text as it is
          - { text: ': comment', delayMs: 500 }
          - { event: message_stop, data: { type: message_stop } }   # one Server-Sent Event: event + JSON data + empty line
```

A status that is not 2xx is never streamed (its whole body is the result), and a response without `stream` reaches `ports.http.stream` as one chunk. `ai-assist-stream.yaml` and `ai-assist-stream-trouble.yaml` are the examples; `tests/aiStream.ts` builds a Messages API event stream for unit tests (`rig.ports.http.respond(url, streamedMessage(text))`).

### Mutations

| op | Fields | Effect |
|---|---|---|
| `unplugDevice` | `match: { vendorId?, productId?, serial?, name? }` (name = substring) | Removes the USB device, and its controller from DirectInput |
| `plugDevice` | `match` (as above), or `device: { instanceId, vendorId, productId, name, isHid, isGameController, isHub, hubChain }` with an optional `controller: { name, guid, vendorId, productId, ... }` | Plugs a device back in that `unplugDevice` removed (with its controller), or adds a new device and the DirectInput controller a game would see for it |
| `setController` | `match: { guid?, name?, vendorId?, productId?, nth? }`, `set: { guid?, name? }` | Gives a DirectInput controller a new instance GUID (what Windows does when it re-enumerates a device) or another name; `nth` picks one of several identical ones |
| `hangProvider` | `port: devices \| displays \| processes \| services \| audio`, `hang?: false` | Every read of that port never answers (a hung driver call), until `hang: false` |
| `failProcessStart` | `name` (image name), `mode?: error \| neverRuns \| off` | Starting that program fails ("Access is denied"), or is accepted but the program never shows up |
| `stopProcess` | `name` | Removes every process with that name |
| `startProcess` | `name`, `path` | Adds a running process |
| `setDisplay` | `match: { name?, id?, index? }`, `set: { enabled?, primary?, x?, y?, width?, height?, rotation?, refreshHz?, id?, serial?, usbSerial? }` | Changes monitors (`index` picks one of several with the same name). A new `id` is the monitor moved to another connector or USB port |
| `unplugDisplay` | `match` | Removes a monitor |
| `plugDisplay` | `display`: a whole monitor as in `displays.json` (`id`, `name`, `enabled`, `primary`, `x`, `y`, `width`, `height`, `rotation`, and optionally `serial`, `connector`, `modes`, ...) | Connects a monitor the rig does not have (the TV in `mark-racing-tv`). An id that is already connected is an error; plugged in as `primary`, it takes over as the main display |
| `setAudioDefault` | `flow: playback \| recording`, `match: { name? , id? }`, `role?: default \| communications \| both` | Makes an endpoint the default |
| `unplugAudio` | `match` | Removes an endpoint; a default pointing at it moves on |
| `setRegistryValue` | `hive`, `key`, `name`, `value: { type, value } \| null` | Sets or (null) deletes a value; creates the key |
| `removeRegistryKey` | `hive`, `key` | Deletes a key and everything below (e.g. a DirectInput calibration slot, to simulate a changed device id) |
| `setService` | `name`, `state: running \| stopped \| ... \| absent`, `displayName?` | Changes, adds or removes a Windows service |
| `hideDevice` | `match` (device), `cloak?: true` | Puts the device on HidHide's hidden list and turns cloaking on |
| `setHidHide` | `installed?`, `cloak?`, `inverse?`, `apps?` | Changes HidHide itself |
| `writeFile` | `path`, `content` or `from` (file relative to the scenario) | Writes a file in the fake user folder |
| `removeFile` | `path` | Removes a file or folder |
| `setSteamBuild` | `appId`, `buildId?`, `stateFlags?` (6 = update required), `targetBuildId?`, `lastUpdated?` | Edits the game's `appmanifest_<appId>.acf` |

HidHide is queried the way the real one is: `ports.shell.run(<HidHideCLI.exe>, ['--cloak-state', '--inv-state', '--dev-list', '--app-list', '--cancel'])` answers `--cloak-on|off`, `--inv-on|off`, `--dev-hide "<HID path>"` and `--app-reg "<exe>"` lines; `--dev-gaming` answers the recorded JSON. Always end read-only queries with `--cancel` (the real CLI saves on exit otherwise). The `--dev-hide` line format is inferred: nothing was hidden on the rig when it was recorded.

Existing scenarios: `desk-mfds-wrong` (the rig exactly as recorded), `flying-fresh` (known-good flying layout, no setups), `flying-all-good`, `flying-pedals-unplugged`, `flying-mfd-rotated`, `flying-trackir-not-running`, `flying-optional-missing`, `racing-fresh`, `app-old-backups`, and one or more per feature (`audio-*`, `backup-*`, `dcs-bindings-*` (`dcs-bindings-identical`: three panels with one name whose IDs all changed), `dcs-setup-*`, `dcs-two-installs`, `devices-*`, `displays-*`, `share-*`, `stream-deck-*`, `trackir-*`).

The racing rig and the generic PC, which the ledger names as fixtures, are scenarios too:

| Scenario | What it is |
|---|---|
| `mark-racing` | The ledger's `mark-racing`: `mark-full` with all flight gear unplugged (WinWing devices, TPR pedals, Virpil panel, TrackIR camera, the three USB MFD screens), TrackIR and SimAppPro closed, the Dell off, the ultrawide the main display. The Fanatec DD2, Fanatec Service, trophi.ai and the Stream Deck stay. It extends `racing-fresh` (which keeps the TrackIR camera) and adds nothing that was not recorded |
| `mark-racing-tv` | `mark-racing` plus two things that were **not** on the PC when it was recorded: the TV (3840x2160 at 640,-2160, above the ultrawide; the same monitor id the saved "Racing" layout in `data/displays/layouts.json` names) and SimHub installed and running |
| `generic-fresh` | `fixtures/rigs/generic-rig` as written: a PC that is not the owner's, with one joystick, one monitor, no sim, no helper apps, no setups (section 10) |
| `generic-custom-game` | `generic-fresh` plus a game RigReady has no module for: `Games/Star Hauler/StarHauler.exe` and `Documents/Star Hauler` (settings, controls, a save) |
| `generic-dcs` | `generic-fresh` plus the standalone (not Steam) DCS World: the Eagle Dynamics registry key, `Program Files/Eagle Dynamics/DCS World/bin/DCS.exe`, `Saved Games/DCS/Config/options.lua` |

Add your own file, prefixed with your feature (`audio-wrong-default.yaml`); do not change existing ones or `fixtures/rigs/`. Put helper files next to it under `fixtures/scenarios/data/<feature>/` and profiles under `fixtures/scenarios/profiles/`.

Backup and sharing scenarios added later: `backup-racing` (racing rig with TrackIR files, nothing tracked), `backup-game-updated` (a setup whose game-updated check has the "Back up now" fix), `share-old-ids` (a squadron setup whose binding files carry another PC's device IDs).

## 10. The recorded rig (`mark-full`)

`fixtures/rigs/mark-full/` is the owner's PC with everything connected, in the desk monitor state. `NOTES.md` there has the details. What a scenario gives you:

- **State** (JSON): 62 USB devices, 5 monitors, the running processes, 718 services, 10 audio endpoints, 12 DirectInput controllers (with instance GUIDs), HidHide state, and registry keys: DirectInput (`...\MediaProperties\PrivateProperties\DirectInput` and `Joystick\OEM`), Steam path, uninstall entries of the sims and helper apps (DCS, iRacing, LMU, BeamNG, MSFS 2024, Assetto Corsa/EVO/Rally, TrackIR, Stream Deck, HidHide, ViGEm, Fanatec, SimAppPro, Steam), `HKCU\Software\Endor\FanatecService`, `HKLM\SOFTWARE\WOW6432Node\Fanatec Endor AG`. There are no Eagle Dynamics keys: the Steam edition of DCS has none.
- **Files**, copied under the fake user folder:

| Under the fake home | What |
|---|---|
| `Saved Games\DCS\Config` | `Input\` (11 F/A-18C binding diffs, `disabled.lua`, a `.backup` folder), `options.lua`, `appSettings.lua` |
| `Saved Games\DCS\Scripts` | `Export.lua`, `wwt\` (SimAppPro's export scripts), `DCS-BIOS\BIOS.lua` |
| `Saved Games\DCS\Kneeboard`, `Logs\dcs.log` | empty kneeboard folder; the log cut down to the version and controller lines |
| `Documents\iRacing` | `controls.cfg`, `joyCalib.yaml`, `app.ini`, `core.ini`, `camera.ini`, `rendererDX11Monitor.ini` |
| `Documents\Assetto Corsa\cfg` | `controls.ini`, `video.ini` |
| `AppData\Roaming` | `SimAppPro\GameExtendDisplay\MFD\DCS_config.json`; `NaturalPoint\TrackIR 5\ProfileMap.dat`; `Elgato\StreamDeck\ProfilesV3\` (2 profiles, manifests only, action settings emptied) and `Plugins\*\manifest.json`; `com.example\Fanatec\shared_preferences.json`; `Microsoft Flight Simulator 2024\UserCfg.opt` |
| `AppData\Local\BeamNG` | `BeamNG.drive.ini`, `BeamNG.drive\current\settings\inputmaps\`, `settings.json` |
| `Program Files (x86)\Steam\steamapps` | `libraryfolders.vdf`, `appmanifest_*.acf` for the eight sims |
| `...\common\DCSWorld` | `Config\MonitorSetup`, `Config\Input`, `Scripts\Input`, `Mods\aircraft\FA-18C\Input` and `Uh-1H\Input` (defaults and vendor template diffs), their `Cockpit\Scripts\devices.lua` and `command_defs.lua`, every module's `entry.lua` |
| `...\common\Le Mans Ultimate\UserData` | `player\*.json`, `Controller\` presets |
| `Program Files (x86)\iRacing` | `version_system.txt`, `updater\version.txt` |
| `Program Files\Fanatec` | `FanatecService\Service\xml\Configuration.xml`, `Fanatec Wheel\fw\versions.xml` |

- **Programs are empty files.** `DCS.exe`, `iRacingUI.exe`, `TrackIR5.exe`, `HidHideCLI.exe`, `StreamDeck.exe`, `SimAppPro.exe` and so on exist with zero bytes so `files.exists()` detection works. There is nothing to run and no file version to read.
- **Recorded paths are re-pointed.** In registry values and in the recorded text files, `C:\Users\User`, `C:\Program Files`, `C:\Program Files (x86)` and `C:\ProgramData` become the matching folder under the fake home, in `\`, `\\` and `/` spellings. Process paths in `processes.json` are left as recorded (`C:\Program Files (x86)\TrackIR5\TrackIR5.exe`).
- Never recorded: `%APPDATA%\SimAppPro\config.json` (account credentials), DCS `network.vault` and `steam_authdata.bin`, images, binaries. Steam ids and the LMU player name are replaced.

### The generic rig (`generic-rig`)

`fixtures/rigs/generic-rig/` is a second rig that is **not recorded**: it was written by hand to be a PC with nothing of the owner's on it, and it loads through the same loader with the same files and schemas (`NOTES.md` there lists them). One Logitech Extreme 3D joystick (`046D:C215`) with its DirectInput controller, a keyboard and a mouse on a hub, one 1920x1080 monitor, one playback and one recording endpoint, a handful of processes and services, a registry without any sim, Steam, Fanatec, TrackIR or Stream Deck key, HidHide not installed, and no game file.

Use it (`wiredApp('generic-fresh')`, `rig.launch('generic-fresh', ...)`) whenever a feature must behave on a PC that lacks what it is about: its page should render an empty state that says what is missing, never an error, never a red status for hardware nobody asked for, and its capture should offer nothing. `tests/unit/genericRig.test.ts` and `tests/e2e/generic-rig.e2e.ts` do this for the whole app (every Configure page, capture, a setup for an "Other" game); a new Configure page must be added to the `PAGES` list in that e2e file, which fails when the navigation offers a page it does not visit. `tests/unit/notHardcoded.test.ts` fails when code under `src/` (comments and tests aside) contains a serial, device instance, monitor id, audio endpoint id or controller GUID of `mark-full`, the owner's name, or the name or user folder of the PC the test runs on.

## 11. An e2e flow

`tests/e2e/<feature>.e2e.ts`:

```ts
import { checkRow, expect, test } from './harness';

test('audio: wrong default device is fixed by Make ready', async ({ rig }) => {
  const run = await rig.launch('audio-wrong-default', 'audio-wrong-default');
  const { page, shot } = run;
  await expect(checkRow(page, 'Default playback')).toHaveAttribute('data-status', 'fail');
  await shot('wrong');            // artifacts/screens/audio-wrong-default/01-wrong.png
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('fixed');
});
```

`rig.launch(scenario, flow, options?)` starts the built app isolated (temp `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `RIGREADY_HOME`) on fake providers. What comes back:

| Member | Use |
|---|---|
| `page`, `app` | Playwright page and Electron app |
| `shot(name)` | Numbered screenshot in `artifacts/screens/<flow>/`; waits for fonts and for dialogs to finish appearing |
| `dataRoot`, `home` | The data root and the fake user folder on disk, for arranging and asserting files with `node:fs` |
| `mutate([...])` | Scenario mutations applied while the app runs; screens refresh by themselves |
| `sendInput([{ index, name, axes, buttons, hats, timestamp }])` | Controller input as if the user pressed something |
| `changeFiles(reason, [{ path, content }])` | A journaled change through FileStore, as a feature would make it |
| `render(html, { width, height })` | Calls the real Render port; returns PNG size and PDF header |
| `showLabels(items, durationMs)` | Shows the real Identify labels |
| `restart()` | Quits and starts again on the same data root and fake home; returns a new run (use its `page`) |

Options: `{ dialogs: { open: [['Documents/x.rigready']], save: ['Documents/out.zip'] }, env: { ... } }` (dialog answers given here come before those of the scenario file).

Use a flow name no other spec uses (prefix it with your feature); its screenshot folder is emptied on launch. No `waitForTimeout`, no `if (await x.isVisible())`: assert with `expect(locator)`, which waits. `toContainText` passes on an element that is still fading in; assert `toBeVisible()` on a dialog before you act on it. Passing checklist groups are collapsed on the Fly screen; click `group-toggle-<group>` to see their rows. Look at your screenshots before you call the work done.

## 12. Ledger evidence

In `docs/requirements/ledger.yaml`, set `status: done` only with evidence, in the same commit as the work:

```yaml
    status: done
    evidence:
      - "src/features/audio/core/defaultDevice.test.ts#fails when another device is the default"
      - "tests/e2e/audio.e2e.ts#audio: wrong default device is fixed by Make ready"
      - "artifacts/screens/audio-wrong-default/02-fixed.png"
```

A test is `<file>#<test title>`; the file must exist and contain that title (quote the line: titles often contain `:`). A screenshot or other file is a path from the repository root and must exist (commit `artifacts/screens/<flow>/`). `done` needs at least one test. `npm run ledger:check` (part of `npm run check`) enforces this. Where an entry says `mark-flight`, use `mark-full` with mutations (`flying-fresh` and the scenarios that extend it); `mark-racing` is the scenario `mark-racing` (or `mark-racing-tv` when the entry needs the TV or SimHub); `generic-rig` is `fixtures/rigs/generic-rig` through the `generic-*` scenarios (section 9). Edit only your own entries, and only their `status` and `evidence` lines, so parallel branches merge cleanly.

## 13. Before you commit

1. `npm run check` passes.
2. `npm run test:e2e` passes and you have looked at your screenshots.
3. `git add` your own paths only (your feature folder, your scenario and e2e files, your screenshot folders, the ledger). Never `git add -A`. Other flows' screenshots change on every e2e run (they show temp paths and times); do not commit them: `git checkout -- artifacts/screens/<their-flow>`.

## 14. The features being built in parallel

Eight features are being built at the same time, one worktree each. The table says which existing folders each one takes over, so nobody edits the same file.

| Feature | Owns | Uses from the foundation |
|---|---|---|
| **fly, profiles, generic checks** | `src/features/fly`, `profiles`, `processes`; new generic checks (service, file exists, file content, script, HidHide, game updated). The one exception to "shared, do not edit": this feature may extend `src/core/checks/engine.ts` and `src/core/profile/` for Fly-mode behaviour (single check run, fix verification, progress, launch actions), keeping every existing export working. | `settings.checkTimeoutSeconds`, `processes.close`, `services`, `shell` + HidHide emulation, `readSteamApp` / `GameModule.installedVersion`, path variables, `registerStandDownStep`, profile extensions |
| **displays + audio** | `src/features/displays`, new `audio` | `ctx.layouts`, `settings.deskLayoutId` / `displayRevertSeconds`, the `displays.deskLayout` stand-down step (already registered in `displays/main.ts`), `audio.setDefault`, `overlays.showLabels`, mutations `setDisplay`, `setAudioDefault`, `unplugAudio` |
| **devices, input tester, USB map** | `src/features/devices`, new `input-tester` / `usb-map` as needed | `devices.subscribe`, `input` (live state, DirectInput GUIDs, axis names), `core/usb.ts`, `core/directInput.ts`, `notifications`, HidHide through `shell`, `sendInput` and `mutate` in e2e, `JsonStore` for device names |
| **dcs-bindings** | new `dcs-bindings` (bindings, cheat sheets, AI guidance) | `core/lua/*`, `core/directInput.ts`, `files.move` for GUID migration, `render` for cheat sheets and kneeboard PNGs, `http` + `secrets` (`AI_KEY_SECRET`) for AI, `ctx.games.get('dcs')` for paths. Does not edit `games/dcs`. |
| **dcs-setup** | `src/features/games/dcs` (the game module: installs, versions, path variables, aircraft modules) and new `dcs-setup` (MonitorSetup, Export.lua, options.lua, SimAppPro import) | `core/lua/*` (`runLua` for MonitorSetup files), `files` groups, `ctx.layouts`, `readSteamApp`, the recorded `DCS_config.json` |
| **backup + sharing** | new `backup`, `sharing` | `files.listTree` / `copyTree` / `zipFolder` / `extractZip`, `dialogs`, path variables, `settings.importMaxMegabytes`, profile extensions (tracked files), `GameModule.trackedFiles`, `allowedRoots` |
| **racing** | `src/features/games/<iracing, lmu, beamng, msfs2024, assetto-corsa, ...>` and new `racing` / `fanatec` | `readSteamApp`, `registry` (uninstall keys, Fanatec keys, DirectInput), `core/directInput.ts`, recorded iRacing, LMU, BeamNG, Assetto Corsa and MSFS files |
| **stream deck** | new `stream-deck` | `files.copyTree` / `zipFolder`, `processes.close` and `start` (Stream Deck must be closed to restore), `registry` uninstall entry, recorded `ProfilesV3` and `Plugins` |

Things two features both need are in core already, so do not build a second copy: the Lua reader/writer and sandbox, DirectInput identities, Steam manifests, path variables, named monitor layouts, settings, the journal and Undo (the Safety page), zip, the JSON store.

Known limits, so you do not look for what is not there:

- The registry port is read-only. Restoring `HKCU\Software\Endor\FanatecService` or any other key is not possible; back such settings up as data and show them, do not promise a restore.
- There is no port for a program's file version. Use Steam build ids, `dcs.log`, or version files (`iRacing\version_system.txt`).
- `ports.devices.subscribe` on the real machine polls a cheap device-list size every 1.5 s: expect a notification within about 2 s of a plug or unplug.
- `engine commands` (`iCommand...`) used by DCS input defaults have no numeric values in any Lua file (see `docs/research/dcs.md` 1.6); the sandbox example resolves them to their names.
- Screenshots that show paths contain the temp folder of that run, so they differ from run to run.
- Which of the two portrait orientations (90 or 270) is upright on a monitor mounted on its side cannot be read from Windows. Monitors > Identify shows an arrow and asks "Which way is up?"; the answer is stored in the saved layouts.
- Real-hardware tests: `tests/rig/*.rig.test.ts` (`npm run rig:smoke` reads only; `npm run rig:smoke:apply` also changes and restores monitors and audio defaults: `displayApply`, `displayIdentity`, `audioApply`). The packaged smoke (`tests/packaged`) additionally writes and removes the real "start with Windows" entry and runs a real batch file, hidden and not.
