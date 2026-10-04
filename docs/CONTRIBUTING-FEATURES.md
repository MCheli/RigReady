# Adding a feature

How to add a feature to RigReady without touching a shared file. Read `docs/PRODUCT.md` and `docs/ARCHITECTURE.md` first; this page is the mechanics and the inventory of what the shared foundation gives you.

Contents: [ground rules](#ground-rules) · [working in a worktree](#working-in-a-worktree) · [commands](#commands) · [1 the feature folder](#1-the-feature-folder) · [2 IPC](#2-ipc-contract) · [3 checks](#3-a-check-type-and-its-fix-and-its-capture) · [4 renderer](#4-renderer-manifest-pages-navigation) · [5 game modules](#5-a-game-module) · [6 ports](#6-ports-what-ctxports-gives-you) · [7 core helpers](#7-core-helpers) · [8 unit tests](#8-unit-tests) · [9 scenarios and mutations](#9-scenarios) · [10 the recorded rig and the generic rig](#10-the-recorded-rig-mark-full) · [11 e2e](#11-an-e2e-flow) · [12 ledger](#12-ledger-evidence) · [13 before you commit](#13-before-you-commit) · [14 the features and what each owns](#14-the-features-and-what-each-owns) · [15 the audits your feature must pass](#15-the-audits-your-feature-must-pass)

## Ground rules

- You own `src/features/<your-feature>/`, your scenario files, your e2e spec, your screenshot folders and your ledger entries. Nothing else.
- **Shared, change deliberately:** `src/core`, `src/shared`, `src/main`, `src/renderer`, `src/platform`, `tests/helpers.ts`, `tests/e2e/harness.ts`, the audit tests in `tests/unit`, `scripts/`, `package.json`, the config files, `fixtures/rigs/`, existing scenario files, this document. A change there (a port method, a mutation, a dependency, an entry on an audit's exception list) is a change for every feature: make it in its own commit, say what and why, and never work around a missing piece by reaching past the ports.
- A feature imports from `src/core`, `src/shared`, and (renderer side) `src/renderer/ipc.ts` and `src/renderer/machine.ts`. Never from another feature, `src/main`, `src/platform` or `src/legacy` (ESLint and `tests/unit/architecture.test.ts` enforce this).
- Only `src/platform` imports `fs`, `child_process` or `koffi`. Everything else, your `main.ts` included, goes through `ctx.ports` (`src/core/ports/index.ts`).
- Files outside RigReady's data folder are changed only through `ctx.ports.files` (`write`, `copy`, `move`, `remove`, `copyTree`, `extractZip`). It backs up first and journals the change; the user sees it on the Safety page and can undo it. Give every change a `reason` a user can read ("Migrate 3 device ids"), and put the changes of one user action in one group (`beginGroup`).
- Programs are started only with `ctx.ports.processes.start` or `ctx.ports.shell.run(exe, args[])`. Never a command string.
- Expected failures are returned as `Result` (`ok(value)` / `err(code, message, detail?)` from `src/core/result.ts`). Throw only for bugs.
- Never report success for something that did not happen: after changing the machine, read it back, then return `ok`.
- A write to game or tool files that the user triggers is shown first: build the plan, describe it with `changePreview()`, show it with `ConfirmChanges.vue`, then apply the same plan under one `beginGroup()` (section 6, Preview). Nothing is written in the background.
- No silent `catch`: report the error, or say in a comment inside the block why nothing needs reporting.
- `src/legacy/` holds a few files of the 1.1.0 app to mine (see its README). Copy what you need into your `core/`, port it to the ports, test it, and delete the legacy file.

Section 15 lists the audits that enforce these rules on every feature folder.

## Working in a worktree

A feature is best built in its own git worktree. A fresh one works like this:

```
git worktree add ../rigready-<feature> -b feature/<feature>
cd ../rigready-<feature>
npm ci
npm run check        # typecheck, lint, format, unit tests with coverage, ledger
npm run test:e2e     # builds, then runs every scenario flow (downloads Electron on first use)
```

Nothing else is needed for unit and e2e work: both run on fake providers. `npm run setup:python` (the DirectInput sidecar's runtime) is needed only for `npm run dev`, `rig:smoke`, `pack`, `smoke:packaged`, `smoke:installer` and `dist`. Worktrees do not interfere with each other: every test run uses its own temp folders, and e2e launches are isolated per instance. Do not run `rig:smoke:apply` from a feature worktree unless your feature is displays or audio; it changes the real monitors and default audio device (and restores them).

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Typecheck (node and web projects), lint, format check, unit tests with coverage threshold, ledger check. Must pass before every commit. |
| `npm run typecheck` / `npm run lint` / `npm run format` | The single gates; `format` fixes formatting, `lint:fix` fixes what ESLint can. |
| `npm test` / `npm run test:watch` | Unit tests. `npx vitest run tests/unit/<file>.test.ts` runs one file. |
| `npm run test:e2e` | Build, then run every scenario flow. Screenshots land in `artifacts/screens/<flow>/`. |
| `npx playwright test tests/e2e/<file>.e2e.ts` | One e2e file (run `npm run build` first). |
| `npm run dev:scenario -- <scenario>` | The app in dev mode on a scenario (fake providers, temp data folder). Without a name it lists the scenarios. |
| `npm run ledger:check` | Validate `docs/requirements/ledger.yaml`. |
| `npm run rig:smoke` | Read-only checks against the real hardware. Not for CI. |
| `npm run rig:smoke:apply` | Also changes and restores the real monitor layout and default audio devices. Owner's PC only. |
| `npm run pack` | Build the unpacked app into `release/win-unpacked` (never publishes). |
| `npm run smoke:packaged` | `pack`, then against the unpacked app: enumeration, a scenario, live input, the input reader failing, the updater on a local feed, start with Windows, startup time, one click (`--fly`, a second start, a real desktop shortcut, the Jump List, a hotkey), and the window's menu and keys. |
| `npm run smoke:installer` | Builds a test variant of the installer ("RigReady Test": its own app id, install folder and data folder), installs it without elevation, starts it, updates it on quit, uninstalls it, and checks that a real RigReady install on the PC is untouched. |
| `npm run dist` | Build the installer into `release/` (never publishes). `docs/RELEASING.md` has the release steps. |
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

`src/features/audio/` and `src/features/trackir/` are small complete examples; `src/features/displays/` shows a check, a remediation, a capture, a stand-down step, events and an overlay; `src/features/racing/` shows writes with a preview and a confirmation; `src/features/settings/` and `src/features/safety/` show pages that change things and report errors. A feature without a screen (`checks-generic`, `processes`) has no `contract.ts` and no `renderer/`.

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
- A path that arrives from the renderer must be validated before use: `resolveAllowedPath(path, await allowedRoots(ctx.ports))` from `src/core/paths.ts`. A path the user picked in `ctx.ports.dialogs` needs no such check; keep it in main and hand the renderer only what it needs to display. The IPC audit (section 15) finds every path-like field of your contract by its name and calls it with hostile paths.
- Channel and event names must fit the pattern the preload script lets through: the feature id (lower-case letters, digits, dashes), a colon, and a camelCase key. `defineContract` builds them; do not write channel strings by hand.
- A channel that writes game or tool files has a partner that shows the change first, named `...Preview` (`restore` / `restorePreview`).
- `ctx.ports` is a wrapped copy of the platform's ports (section 8): use `ctx.ports`, never a ports object you kept from somewhere else.

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
- **One machine read per run.** Inside a check's `run`, `ctx.ports` is a cached view (`src/core/checks/readCache.ts`): `devices.list()`, `displays.read()`, `processes.list()`, `services.list()` / `get()` and `audio.read()` are asked once per checklist run and every check gets a copy of that answer. Always read through the `ctx` your `run` is given, never through the ports your `setup` captured, or twenty device checks cost twenty USB enumerations (`tests/unit/performance.test.ts` counts them). Fixes and stand-down steps get the uncached ports.
- **A fix that writes a file** names the file in `describe` (the text beside the failing check) and again in its result message: Make ready runs it in one click, so that text is the preview (`tests/unit/writeAudit.test.ts`).

The displays feature already registers the stand-down step `displays.deskLayout`: when the settings name a desk layout, Stand down applies it (with the keep-or-revert countdown).

Also list the types in your manifest (`checkTypes`, `remediationTypes`) so editors can label them.

## 4. Renderer: manifest, pages, navigation

`index.ts`:

```ts
import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'audio',
  nav: [{ title: 'Audio', icon: 'mdi-volume-high', to: '/configure/audio', order: 420, section: 'Hardware' }],
  routes: [{ path: '/configure/audio', component: () => import('./renderer/AudioPage.vue') }],
  checkTypes: [{ type: 'audio.defaultDevice', label: 'Default audio device', group: 'audio' }],
  // overlays: [Prompt]   components mounted at the app root on every screen
  // settings: [{ title: 'Audio', component: () => import('./renderer/AudioSettings.vue') }]
});
```

- Routes must start with `/configure/` (they render inside the Configure layout). The navigation has five sections; pick the one your page belongs to and an `order` in its range:

  | Section | Order | What belongs there | Taken now |
  |---|---|---|---|
  | `Setups` | 100s | What you fly or race with, and keeping it safe | Setups 100, Backups 120, Share 130 |
  | `Games` | 200s | The games on this PC and what each needs set up | Games 200, DCS World 210, Racing 220 |
  | `Controls` | 300s | What the buttons do | DCS bindings 300, Binding guide 310, Cheat sheets 320 |
  | `Hardware` | 400s | Devices, monitors, audio, helper tools | Devices 400, Monitors 410, Audio 420, Wheel 430, Stream Deck 440, TrackIR 450 |
  | `RigReady` | 900s | The app itself | Settings 910, Safety 920, Diagnostics 930 |

  The whole navigation must fit the default window without scrolling (the tour, section 11, measures it), so a new entry needs a reason; a sub-page reached by tabs inside an existing page costs nothing.
- **The page frame.** Every page's root element has the class `rr-page`, with an `rr-page-title` (the page's name) and under it an `rr-page-sub`: one or two sentences that say what the page is for, not a repeat of the title. The tour fails a page without them, with a sub line shorter than 15 characters, or one that never stops loading. A page that is still reading says so with text ending in an ellipsis ("Reading the files…") or a Vuetify progress indicator, and stops when it is done.
- Use the design system in `src/renderer/styles.css`: `rr-panel`, `rr-row` / `rr-row-main` / `rr-row-title` / `rr-row-sub`, `rr-section-title`, `rr-empty`, `rr-mono`, `rr-muted`, and the status classes `rr-ok` / `rr-warn` / `rr-bad`. Vuetify components are auto-imported. Green, yellow and red mean status and nothing else, and status is never colour alone: a status-coloured element carries an icon and words (`tests/unit/statusNotColourOnly.test.ts`, and axe in `tests/e2e/a11y.e2e.ts`).
- **Shared components** (`src/renderer/components/`), so the same thing looks and reads the same everywhere:

  | Component | Use |
  |---|---|
  | `ConfirmChanges.vue` | The confirmation every file-writing action asks for: your words in the default slot, the list of files that will change (`:preview`, a `ChangePreview` from your `...Preview` channel), Cancel and the action. The action stays disabled until the list is there. Props: `open`, `title`, `confirm-text`, `preview`, `error`, `busy`, `blocked`, `testid`; events `cancel`, `confirm`. Test ids: `<testid>-confirm`, `<testid>-go`, `<testid>-cancel`. |
  | `ChangePreview.vue` | The list alone ("this is what will change"), for a page that shows the plan inline. Each kind of change has its own icon and word. |
  | `NotOnThisPc.vue` | The one way a page says that the game or tool it is about is not on this PC: what is missing, where RigReady looked (`:looked`), and what to do (`game-page` links to the page where the folder can be chosen by hand; the default slot and the `action` slot replace the text and add a button). |
  | `PageSkeleton.vue` | What a page shows while it is still reading, instead of a line of text: `<PageSkeleton v-if="!view && !error" label="Reading the monitors…" />`. The label (ending in an ellipsis) is on the page for a screen reader, and the tour, the accessibility scan and the crawl all see the outline as "still loading". Props: `label`, `rows` (4), `shape` (`rows` \| `cards` \| `text`). It fades in after a moment, so a page that answers at once never flashes it. |
  | `EmptyState.vue` | The one way a page says there is nothing to show yet: a small line drawing (`art`: `nothing`, `search`, `backup`, `snapshot`, `shield`, `monitor`, `device`, `file`, `setup`, `game`; drawn by `EmptyArt.vue`), a `title`, a sentence in the default slot, and one action in the `action` slot that leads where the thing is made. `bare` when it sits inside a panel that is already there. Never for an error and never in a status colour. A panel that only carries `rr-panel rr-empty` and words gets a plain drawing from the stylesheet, so no empty panel is bare. |

- **An empty state leads somewhere.** A page with nothing to show says what is missing and what to do next, with a link or a button to the place where it is done ("No setups yet" leads to the capture page). Never an error, never a red status for hardware nobody asked for, never a blank panel. `tests/e2e/generic-rig.e2e.ts` opens every page on a PC that has nothing.
- Every control is keyboard reachable and has a name (an `aria-label` where there is no visible text); `tests/e2e/a11y.e2e.ts` and `keyboard.e2e.ts` check it.
- State that outlives a component goes in a Pinia store in `renderer/`.
- After your feature changes the machine, call `notifyMachineChanged()` from `src/renderer/machine.ts`; to refresh when others do, subscribe with `onMachineChanged(fn)` (it returns the unsubscribe). The shell also calls it when a USB device is plugged in or removed, when the tray acts, and when a test changes the fake machine.
- Give every element a test drives a `data-testid`.
- Do not render a button for something that is not implemented, and do not disable a control for good: every `disabled` depends on something, and the page says why (`tests/unit/noStubs.test.ts`, and the crawl in `tests/e2e/nfr.e2e.ts`).
- **A small extra window.** `ctx.ports.window.openPanel({ id, route, title, width, height, alwaysOnTop? })` opens one of your routes in a window of its own, or brings it forward when a window with that id is already open. It receives the same events as the main window and closes with the app. A panel opens where the user left it and as large as it was (per `id`, in `<data root>/panels.json`): `width` and `height` are its size the first time, and its position is not used once it is no longer on a connected screen. The cheat-sheet quick look (`/configure/cheat-sheets/quick`) is the example.
- A setting of your own that belongs on the Settings page: list it in the manifest as `settings: [{ title, component, order? }]`. Settings gives the component a titled panel below its own sections; the component reads and stores the setting through your feature's IPC (`src/features/devices/renderer/NotificationSettings.vue` is the example, shown on the Devices page too).
- Linking to another feature's page is done by route, never by import. Two routes take parameters, validated on arrival: `/configure/devices?profile=<setup id>&item=<checklist item id>` opens the device a checklist item is about, connected or not (the Fly screen's Diagnose link), and the route a `BindingReader` gives (`ctx.bindings.get('dcs')?.route({ guid, aircraftId })`) opens a controller's bindings.

### The command palette: `commands.ts`

Ctrl+K opens one field over every page and over the commands features contribute. Your pages are in it already: every navigation entry, and every other route of your manifest that a link can open (named after the page it belongs to, "DCS World: Screens"). To give a page a better name, more words to be found by, or to offer something to do, add `src/features/<name>/commands.ts`; it is found by glob like the manifest (`tests/unit/selfRegistration.test.ts` proves it on the test feature):

```ts
import { commandFailed, defineCommands } from '../../shared/feature';
import { backupContract } from './contract';

export default defineCommands({
  feature: 'backup',                                   // the folder's name
  commands: [
    { id: 'backup.now', title: 'Back up now', icon: 'mdi-backup-restore', keywords: ['save'],
      async run(shell) {                               // something to do
        shell.progress('Backing up…');                 // shown while it runs
        const done = await shell.client(backupContract).backUp({ scope: { kind: 'full' } });
        if (!done.ok) return commandFailed(done.error, { label: 'Open Backups', to: '/configure/backups' });
        return { tone: 'ok', text: `Backed up ${done.value.backup.fileCount} files` };
      } },
    { id: 'backup.tracked', title: 'Tracked files', to: '/configure/backups?tab=tracked' },  // a page to open
  ],
  async list(shell) { return []; },                    // optional: one command per setup, layout, aircraft
});
```

- An id starts with the feature's name; a command has either `to` (an in-app route) or `run`, never neither: a command that does nothing is refused by name.
- `run` gets a `CommandShell`: `client(contract)` (the typed client, as `useClient` gives a page), `go(route)` (opens a page, afresh when it is the one on screen), `route()`, `machineChanged()` (call it after changing the machine) and `progress(text)`. It imports nothing from `src/renderer`, so `tests/unit/paletteCommands.test.ts` runs every command against the wired main side.
- What `run` returns is shown as a toast: `tone` (`ok`, `warn`, `bad`, `info`), `text`, an optional `detail` line and an optional `action` (`{ label, to }`). Report what the channel answered, never a "done" of your own: under the sabotage of section 15 no command may come back `ok`. Nobody can be asked from the palette, so a step that needs a confirmation is reported as not run, with the way to the page where it can be confirmed.
- A `to` command for a route that already has a page takes its place when that page is reached from inside another; for a navigation entry, which keeps its name, the command's title and `keywords` become words the entry is found by.
- `list` is asked each time the palette opens. When the list cannot be read, throw with the error result's message: the palette names your feature with that reason, and everything else in it still works.
- The two modes have their names in one place: `MODE_NAMES` in `src/shared/feature.ts` (`fly: 'Play'`, `configure: 'Configure'`). Copy that names a mode reads it from there (`` `Open ${MODE_NAMES.fly}` ``), so the word is the same in the header, the shortcuts, the palette and a toast. Only the word on screen is "Play": the folder, the routes, the IPC channels, `meta.mode` and the test ids keep `fly`. The palette calls the page the mode switch opens "Play" whatever its route's title says, and lists that feature's commands under "Play".

### Toasts, motion and the tokens

- The shell's toasts (`src/renderer/shell/toast.ts`: `toasts.show({ tone, text, detail?, action? })`) are how a command reports. A `v-snackbar` of your own gets the same look from the stylesheet (a dark raised panel, its `color` as an icon in front).
- Tokens (`src/renderer/styles.css`), beyond the colours: `--rr-border-strong` (the edge of what floats), `--rr-text-2` (running explanation), `--rr-elev-1` (a panel on the page; `rr-panel` has it) and `--rr-elev-2` (a dialog, a menu, a toast), `--rr-motion-fast` (120 ms), `--rr-motion-base` (180 ms) and `--rr-ease`, `--rr-font`, `--rr-font-display`, `--rr-font-mono`, and the sizes `--rr-text-xs` to `--rr-text-xl`. Classes: `rr-kbd` (a key), `rr-num` (digits of one width, which `body` has anyway), `rr-sr-only` (for a screen reader only).
- Animate with the two durations and the one easing, never with a number of your own: under "reduce motion" the tokens are zero and every other animation and transition takes no time (`0s`, exactly). Only the time is taken away: how often an animation repeats and whether it is paused stay yours, so `animation: none` or a still picture of your own under `@media (prefers-reduced-motion: reduce)` is what the page gets. Pages and dialogs already arrive on them (`.rr-page`, the `rr-dialog` transition every `v-dialog` uses). `tests/unit/designSystem.test.ts` fails a `var(--rr-…)` that is not defined.

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

Modules exist for `dcs`, `iracing`, `lmu`, `beamng`, `assetto-corsa`, `assetto-corsa-evo`, `assetto-corsa-rally` and `msfs2024`.

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

Every port has a real implementation (`src/platform/windows`, `src/platform/electron`, `src/platform/node`) and a fake (`src/platform/fake`) that unit tests and scenario runs use. The fake column lists what a test can inspect or steer; `rig.ports` in a test has the fake types. The table follows `src/core/ports/index.ts` (the `Ports` interface); when a port changes there, change the row here.

| Port | Methods | Fake extras |
|---|---|---|
| `devices` | `list()` USB devices with identity and hub chain; `subscribe(fn)` called on plug/unplug | `emitChanged()`; state in `ports.state.devices` |
| `input` | `start()` the DirectInput controllers a game sees, each with `guid` (instance GUID), `productGuid`, `vendorId`, `productId`, `axisNames`; `devices()`; `subscribe(fn)` live state, starting with the last known state of every device; `stop()` | `emit(states)` |
| `displays` | `read()` (each monitor with `id`, EDID `serial`, `usbSerial` / `usbId` for a USB screen, `connector`, `modes` while it is on), `apply(targets)` (position, rotation, on/off, main display, and `width`/`height`/`refreshHz` when the mode should change; one call, monitors being turned on included), `canRevert()`, `revert()` | state in `ports.state.displays`; refuses a mode the monitor does not list (`display.mode`) |
| `processes` | `list()`, `start(target)` (detached, never through a shell), `stop(pid)` (terminate), `close(pid, { waitMs, force })` (ask politely, wait, terminate only if `force`; `process.stillRunning` otherwise). What a feature gets is wrapped by `verifiedProcesses` (`src/core/processes.ts`): a close or stop is believed only when the process is gone from the list. A start is not verified for you: poll `list()` for the image name you expect | `started`, `closed`, `stubborn` (names that ignore a polite close) |
| `services` | `list()`, `get(name)` Windows services with state | `ports.state.services` |
| `audio` | `read()`, `setDefault(id, { roles? })` (all three roles by default; flow follows the device) | `calls` |
| `registry` | read-only: `getValue(hive, key, name)`, `listKeys`, `listValues`; hives `HKCU`, `HKLM`; values are `{ type: 'string' \| 'number' \| 'binary' (hex) \| 'strings', value }` | `ports.state.registry` (keys recorded from the rig) |
| `files` | see FileStore below | real files in a temp folder |
| `folders` | `home`, `documents`, `savedGames`, `desktop` (where a desktop shortcut goes), `appData`, `localAppData`, `programFiles`, `programFilesX86`, `programData`, `windows()` (`C:\Windows`, where Windows' own programs such as `explorer.exe` are), `dataRoot` (honors `RIGREADY_HOME`), `steamLibraries()`, `machineName()` (this PC's name; never use `os.hostname()`) | all under the fake home, the Windows folder included; the machine is `RIG-PC`; the `setKnownFolder` mutation moves Documents or Saved Games |
| `shell` | `run(exe, args[], { cwd, timeoutMs, env, hidden })`, `launch(exe, args[], { cwd, env, hidden })`. `env` is added to RigReady's own environment; `run` hides the console window unless `hidden: false`. Batch files (`.cmd`, `.bat`) and `.ps1` scripts are started through cmd.exe / powershell.exe by the platform, each argument as one literal value; a batch file refuses an argument containing a double quote (`shell.argument`) | `calls` (with the options given), `scripts` (canned answers); emulates `HidHideCLI.exe` |
| `clock` | `now()` | `TestClock` with `advance(ms)` |
| `secrets` | `get/set/remove(name)`; encrypted with Electron safeStorage in the app | in-memory `values` |
| `http` | `request({ method, url, headers, body, timeoutMs })` (https only; default timeout 60 s); a response with any status is `ok`, header names in lower case. `stream({ ...the same, idleTimeoutMs, signal }, onChunk)` hands the body of a 2xx response over as raw bytes while it arrives (a chunk may end mid-line or mid-character) and resolves when the server closes it; any other status comes back whole. It fails with `http.idle` (nothing for `idleTimeoutMs`, default 60 s), `http.timeout` (only when `timeoutMs` is given), `http.cancelled` (`signal` aborted) or `http.network` | `calls`, `scripts`, `respond(urlPart, { status, json \| body \| stream: { chunks, delayMs, chunkBytes, end } })`; an unscripted request is an error (`http.unscripted`); scripted pauses run in real time |
| `dialogs` | `open({ title, filters, directory, multiple })` -> paths (empty = cancelled); `save({ defaultPath, filters })` -> path or null | `script.open` / `script.save` queues, `calls` |
| `render` | `png(html, { width, height })` exact pixel size; `pdf(html, { pageSize, landscape })`. No scripts run in the HTML. | returns a real one-colour PNG of that size and a stub PDF; `calls` holds the HTML |
| `notifications` | `notify({ title, body })` | `sent` |
| `clipboard` | `writeText(text)`: puts text on the Windows clipboard (Copy diagnostics) | `copied` |
| `loginItem` | `isEnabled()`, `setEnabled(bool)` (start with Windows) | `enabled` |
| `overlays` | `showLabels([{ x, y, width, height, text, caption, up? }], durationMs)` big labels on monitors ("Identify"); `up` draws a "this side up" arrow | `shown` |
| `window` | `showOn(areas)`: RigReady's own window, shown on one of these desktop areas (moved there when it is elsewhere). The layout applier calls it before and after a change so "Keep this layout?" is on a monitor that is on. `openPanel({ id, route, title, width, height, alwaysOnTop? })`: a small extra window on an app route, one per id (brought forward and sent to the route when it is already open); it receives the same events as the main window, closes with the app, and opens where the user left it (`core/windowPlace.ts` says whether that place is still on a screen) | `shown`, `panels` |
| `updates` | `currentVersion()`, `unavailable()` (why updating cannot work in this run, e.g. a development run), `check(channel)` (`stable` \| `beta`; the newest published version or null), `download(onProgress)`, `setInstallOnQuit(bool)`, `quitAndInstall()`. The port only fetches and installs; the `updates` feature decides when | `FakeUpdateFeed`: `version`, `reason`, `feed` (`stable`, `beta`, `checkError`, `downloadError`, `hold`), `checks`, `downloads`, `installs`, `installOnQuit`. A scenario run of the real app is steered through `<fake home>/rigready-update-feed.json` |
| `shortcuts` | Windows shortcuts (.lnk). `self()` (the program and leading arguments that start this copy of RigReady), `build(link)` (the bytes of a .lnk for `{ target, args[], description?, icon?, cwd? }`; writes nothing outside the data folder), `read(file)` (what a .lnk says; undefined when there is no file, an error when it is not a shortcut). Arguments are a list of values, never a command line (`core/windowsArgs.ts` turns them into the one text a shortcut stores and back). The file itself goes where it belongs through `files.write`, so it is backed up, journaled and undone like any other change | `built`; a link's content is a small text file that `read` understands, and the fake RigReady is at `<fake home>/AppData/Local/Programs/RigReady/RigReady.exe` |
| `taskbar` | RigReady's taskbar button. `setJumpTasks([{ title, description, args[] }])` (the Jump List; each task starts this RigReady with the arguments), `setOverlay({ icon, description } \| null)` (the status badge, with its words), `setTooltip(text)`, `setProgress({ mode: none \| indeterminate \| normal \| paused \| error, value? })`, `setButtons([{ id, tooltip, icon, enabled }])` (the buttons under the window's thumbnail), `subscribe(fn)` (called with a button's id when it is pressed). Pictures are `{ width, height, pixels }` (BGRA, top row first). The shell is its only caller (`src/main/taskbarModel.ts` is the pure model); a feature has no reason to touch it | `jumpTasks`, `jumpListWrites`, `overlay`, `tooltip`, `progress`, `progressSeen` (every state there was), `buttons`, `press(id)` |
| `hotkeys` | System-wide hotkeys, one per name. `register(id, accelerator)` (e.g. `'Control+Alt+R'`; fails when Windows does not give it, and the one the name had stays), `unregister(id)`, `registered(id)` (what Windows has under the name right now), `subscribe(fn)` (called with the id when one is pressed). `core/hotkeys.ts` reads and writes a hotkey ("Ctrl+Alt+R") and turns a key press into one | `active` (id to accelerator), `taken` (accelerators another program has), `press(id)` |

Not on `Ports`, but defined in the same file: `LogSink` (`write(line)`, what the logger writes to; the app uses `RotatingFileSink` from `src/platform/node`, and a test that wants to read what was logged passes its own sink to `createLogger`) and `RawFs` (the minimal file access under `FileStore`; only `FileStore` and platform code use it).

**The input reader's lifetime.** One DirectInput reader (the sidecar) serves the whole app. A feature calls `ctx.ports.input.start()` every time it needs controllers and never calls `stop()`: `start()` is idempotent (it answers at once while the reader runs, calls made while it is starting share that one start, and after a failed start the next call tries again). Only the app shell stops the reader, on quit. A feature that listens to live input keeps the function `subscribe` returns and calls it when it is done; do not cache the result of `start()`, ask again (`tests/unit/inputLifetime.test.ts`).

In a scenario run of the real app (e2e, `dev:scenario`) the machine is fake. Three things are real because they do not depend on the rig: `secrets` and `render` (the Electron ones, working inside the temp data root) and the panels `window.openPanel` opens, which are real windows of the app.

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

Preview (`src/core/files/preview.ts`): `previewWrites(files, planned)` takes the writes a feature is about to make (`{ path, content }`, `{ path, content, from }` for a rename, `{ path, remove: true }`) and says, without writing, what each one does to the file on disk: `created`, `modified` (with a one-line summary: lines added and removed for text, sizes for binary), `renamed`, `deleted` or `unchanged`, with sizes and a one-line total ("2 files modified, 1 file created"). It fails rather than guess when a file that is there cannot be read.

`changePreview(files, planned, label?)` gives the same thing in the shape that crosses IPC (`ChangePreviewSchema` in `src/shared/changePreview.ts`: a `summary` and per file `path`, `label`, `change`, `detail`). The rule for every user-triggered write outside the data root:

1. Build the plan (the list of planned writes) in main.
2. Return `changePreview(ctx.ports.files, plan)` from a channel named `...Preview`.
3. Show it with `ConfirmChanges.vue` (section 4); the action button stays disabled until the list is there.
4. On confirm, apply the same plan under one `beginGroup()`.

The racing restore, the BeamNG copies and the iRacing id repair are the examples (`racing:restorePreview`, `racing:beamngCopyOlderPreview`, `racing:iracingRepairPreview`). A feature with a richer preview of its own (dcs-bindings' plan with line diffs, sharing's import report) is listed with its reason in `tests/unit/writeAudit.test.ts` (section 15).

Zip (`src/core/files/zip.ts`): `createZip(entries)`, `readZip(bytes, { maxTotalBytes, maxEntries })`, `zipFolder(files, dir, { include, exclude, prefix })`, `extractZip(files, bytes, destDir, { reason, group?, maxTotalBytes })`. Unsafe entry names (absolute, drive letters, `..`) fail the whole archive before anything is written; extraction goes through FileStore as one group. Use the import cap from the settings: `settings.importMaxMegabytes * 1024 * 1024`. `createZipInSteps` builds a large archive without blocking the main process: it gives the thread back between files, reports each file, and stops with `zip.cancelled` when asked (the full backup uses it for progress and Cancel). `inspectZip` (`src/core/files/zipInspect.ts`) reads an untrusted archive's directory without unpacking anything, so it can be refused for links, encrypted entries, unsafe names, or too many entries or bytes.

## 7. Core helpers

| Module | What |
|---|---|
| `core/settings.ts` | `ctx.settings.get()` / `update(patch)` / `onChange(fn)`. Fields: `deskLayoutId`, `startWithWindows` (false), `minimizeToTray` (true), `aiKeyPresent`, `retention.autoBackupDays` (30) / `autoBackupGroups` (50), `displayRevertSeconds` (15), `checkTimeoutSeconds` (5), `importMaxMegabytes` (200), `logLevel` (`debug` \| `info` \| `warn` \| `error`, default `info`; `RIGREADY_LOG_LEVEL` wins over it), `updates.check` (true: at start and once a day) and `updates.channel` (`stable` \| `beta`). Stored as `<data root>/settings.json`; a file that is not settings is set aside as `settings.corrupt-<time>.json`, never deleted, and defaults are used with a notice. The Anthropic key itself is in `ctx.ports.secrets` under `AI_KEY_SECRET`; the Settings page stores and removes it. A setting of your feature's own does not go here: keep it in a `JsonStore` and show it through a settings section (section 4). |
| `core/logger.ts` | `ctx.log` is your feature's logger (scope = feature id): `debug`, `info`, `warn`, `error(message, data?)`, `child(scope)`. Every line is redacted before it is written: API keys, authorization headers and passwords are masked, the user's folder becomes `~`, long texts are cut at 600 characters, binary data is counted instead of dumped. Still, never pass a secret to the log. The file is `<data root>/logs/rigready.log` (5 MB, four older files kept). `createRedactor`, `parseLog` and `filterLog` are there for a feature that shows or exports log text (diagnostics). |
| `core/errorCenter.ts` | `appErrors`: where unexpected errors (not `Result` failures) are collected, logged and shown as a notice. A feature does not report to it; return `err(...)` and let the screen show it. An error result of any IPC call is in the detailed log by itself. |
| `core/dataHealth.ts` | `dataFileStatus(ctx)` (settings, setups, layouts, journal: readable or what is wrong) and `startupNotices(ctx)`, which the shell runs once at startup. The model for your own store: a damaged file is kept and named, never silently replaced. |
| `core/processes.ts` | `verifiedProcesses(provider)`: the wrapper every feature's `ctx.ports.processes` already is (section 6). |
| `core/checks/readCache.ts` | `cachedReads(ports)`: the per-run cache the check engine applies (section 3). A feature does not call it. |
| `core/displays/layouts.ts` | `ctx.layouts`: named monitor layouts in `<data root>/displays/layouts.json`: `list`, `get`, `create(name, targets)`, `createFromCurrent(name, provider)`, `rename`, `replace`, `remove`; `layoutToTargets(layout)`. |
| `core/jsonStore.ts` | `new JsonStore(files, file, zodSchema)`: `read()` (defaults when missing, error when damaged), `write`, `update(fn)`. The way to keep your feature's own data under the data root. An update never overwrites a damaged file. |
| `core/files/text.ts` | `readDataText(files, file)`: reads one of RigReady's own data files without a byte order mark and refuses one larger than 16 MB; `stripBom`. |
| `core/profile/schema.ts` | `profileExtension(profile, '<feature>', schema)` and `withProfileExtension(profile, '<feature>', value)`: your feature's per-profile data lives in `profile.extensions[<feature id>]`, validated by your schema. Do not add fields to `ProfileSchema`. |
| `core/pathVariables.ts` | `allPathVariables(ctx, ctx.games)` -> `{ USER, DOCUMENTS, SAVED_GAMES, APPDATA, LOCALAPPDATA, PROGRAM_FILES, PROGRAM_FILES_X86, RIGREADY_HOME, STEAM?, DCS_USER?, DCS_INSTALL?, ... }`; `expandPath('{DCS_USER}/Config/options.lua', vars)`; `collapsePath(absolute, vars)` (longest match wins). Store paths in the collapsed form in profiles, backups and shared files. |
| `core/paths.ts` | `isWithin`, `resolveAllowedPath`, `allowedRoots(ports)`. |
| `core/backupSources.ts` | `ctx.backupSources.register(source)`: what a tool suggests backing up, the program that holds those files, and records (section 5). |
| `core/tracked.ts`, `core/trackedSchema.ts` | `resolveTrackedItem(files, item, variables)`: where a tracked item is on this PC and which files it covers now (credentials withheld); `trackedFileTarget`. `TrackedItemSchema`, `BACKUP_EXTENSION` for a profile's tracked items. |
| `core/credentials.ts` | `CREDENTIAL_RULES` and `credentialReason(path, variables)`: files that hold credentials (SimAppPro's account file, DCS vaults, Steam sign-in files, keys) and are never read into a backup, snapshot, shared setup or import, whatever folder is tracked. |
| `core/privacy.ts` | Finds personal details in what would leave this PC (paths under the user's folders, the Windows user and machine name, serials, device instance paths, audio endpoint ids) and replaces the ones the user chose to remove. Sharing and the diagnostics export use it; anything new that leaves the PC must too. |
| `core/steam.ts` | `readSteamApp(ports, appId)` / `listSteamApps(ports)` -> `{ installDir, buildId, targetBuildId?, lastUpdated?, stateFlags, updatePending }`; `steamRoot(registry)`. |
| `core/names.ts` | `ctx.names`: the names the owner gave things. `await ctx.names.monitors()` (by monitor id) and `(await ctx.names.devices()).nameOf({ vendorId, productId, serial?, instanceId?, guid? })`. The displays and devices features provide them (`provideMonitors`, `provideDevices`); every other feature only reads. A name is something to show beside the hardware name; never match on it, and never guess between identical devices (the lookup returns nothing when it cannot tell). |
| `core/bindings.ts` | `ctx.bindings`: what is bound in a game, for features that do not own its files (input tester, cheat sheets, the binding guide). `ctx.bindings.get('dcs')` / `all()` give a `BindingReader`: `game`, `gameName`, `available()` (cheap), `aircraft()` (id, name, hasUserBindings, and `general: true` for the one set a game uses for everything, "All cars": a page about it is titled by the game), `bindings(aircraftId)` (per device: kind, name, givenName, guid, vendorId, productId, connected, `role`, `controls` (button and hat counts, axis names), and per binding: `input` (the game's own name for it: JOY_BTN3 in DCS, "button 4" in iRacing), `control`, `inputLabel`, `kind`, `modifiers`, `actionId`, `action`, `category`, `source: 'user' \| 'default'`), `route({ guid?, aircraftId? })` with `routesToDevice: true` when that route opens on the one controller asked for (DCS; a list of devices offers a link per controller only to such a page), and optionally `actions(aircraftId)` (every action, bound or not) and `proposals`. A bindings feature registers its reader with `ctx.bindings.register(reader)`; one reader per game. `dcs-bindings` registers DCS; `racing` registers iRacing, Le Mans Ultimate, BeamNG.drive and Assetto Corsa ("aircraft" there is the set for all cars, plus a set per car or vehicle where the game keeps one). So `all()` on a PC with a stick and a wheel gives several games: never take the first as the game the user means. |
| | **One vocabulary for controls.** Games name inputs their own way, so a reader also says which control of the controller a binding is on. `control` is a `BoundControl`: `{ kind: 'button', index }` (1 is the first button), `{ kind: 'hat', hat, direction }` (`U`, `UR`, `R`, ...) or `{ kind: 'axis', axis }` (`X`, `Y`, `Z`, `RX`, `RY`, `RZ`, `SLIDER1`, `SLIDER2`); absent for keys. Whatever draws, matches or looks up a control uses it, never the game's `input`. `controlFromDirectInput('JOY_BTN3')` and `directInputName(control)` convert from and to the names press detection gives (`core/inputPresses.ts`); `controlLabel(control)` says it in words ("Button 3", "Hat 1 up"). A reader for a new game fills `control` for every binding it can place on a controller. |
| | **Saying that bindings changed.** The feature that owns a game's binding files calls `ctx.bindings.notifyChanged({ game, aircraftId? })` after every change it made to them (an edit, a restore, an undo, a repair), once the files hold the change. A feature that shows bindings subscribes with `ctx.bindings.onChanged(fn)` (it returns the unsubscribe: call it in `dispose`) and tells its windows, as the cheat sheets do with their `changed` event, so an open sheet redraws, the pop-out included. A listener that throws does not stop the others. A change another feature makes to those files (an undo on the Safety page, a restore from Backups) is not announced. |
| | **Changing bindings from another feature.** Only the feature that owns the game's files writes them. Another feature hands it a `BindingProposal` (`bind` / `unbind` changes for one aircraft) through `reader.proposals`: `plan(proposal)` says exactly what would be written, file by file with the text diff (or `blocked`, with the reason, while the game runs); `apply(proposal)` writes it with a backup as one undoable change and returns the journal group; `undo(groupId)`. The binding guide's walkthrough and AI suggestions work this way. |
| | **Plain-language action labels.** `await ctx.bindings.labels(game, aircraftId)` gives a plain label by the game's own action name ("Sensor Control Switch - Fwd" is "Sensor select: HUD"). A feature that knows such labels registers them with `ctx.bindings.registerLabels({ id, game, labels(aircraftId) })` (the binding guide's shipped packs do); the first source to name an action wins, a failing source is ignored. A label is for reading, never for matching: show the game's own name beside it. |
| `core/inputPresses.ts` | "Press the control": turns live controller state into the input the user just used, by the names DCS gives inputs (`JOY_BTN5`, `JOY_BTN_POV1_U`, `JOY_RZ`). The first state seen is the resting position, so a switch held on or an off-centre throttle is not a press. Shared by every feature that binds or finds by pressing. |
| `core/loginItem.ts` | Reads whether Windows will really start RigReady at sign-in (the Run entry and Task Manager's switch) from registry values. |
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
const app = await wiredApp('flying-all-good', {     // steer the machine before any feature starts
  beforeWiring: (rig) => { rig.ports.updates.feed = { stable: { version: '2.1.0' } }; },
});
const report = await app.invoke('fly:check', { profileId: 'dcs-f-a-18c' });   // through IPC validation
app.wiring.context;                                  // the MainContext the features got (ports, registries)
app.wiring.handlers;                                 // channel name -> handler taking raw input, returning the envelope
await mutate(rig, [{ op: 'unplugDevice', match: { productId: 'B68F' } }]);    // any scenario mutation, live
rig.ports.http.respond('api.anthropic.com', { json: { content: [] } });       // script a port
rig.ports.dialogs.script.open.push(['Documents/setup.rigready']);
app.events;                                          // events emitted to the renderer
app.layoutAnswer = 'wait';                           // 'keep' (default) | 'revert' | 'wait': the answer to "Keep this layout?"
await rig.cleanup();                                 // in afterEach
```

- `rig.home` is the fake user folder; every `ports.folders.*` path is under it, Program Files included. A scenario copies the rig's recorded files there (section 10). Copying all of them takes about a tenth of a second per test, so pass `files` with the globs you need (or `[]`) when a test does not need everything.
- **The ports the features hold are wrapped.** `wireFeatures` gives features a copy of the ports object with `processes` wrapped by `verifiedProcesses`, so in a `wiredApp` test `app.wiring.context.ports !== rig.ports` and `ctx.ports.processes !== rig.ports.processes`. Consequences:
  - Steer a port by changing the fake port object the rig holds (`rig.ports.http.respond(...)`, `rig.ports.processes.stubborn.add('TrackIR5.exe')`, replacing a method: `rig.ports.devices.list = async () => err('x', 'nope')`). The wrapped copy shares those objects, so the features see it.
  - Replacing a whole port after wiring (`rig.ports.http = somethingElse`) is not seen by any feature: they hold the copy made at wiring.
  - Anything that must be true before a feature's `setup` runs (a feature that reads at startup, starts a watcher, or keeps a reference to a port method) goes in `wiredApp(scenario, { beforeWiring })`, which runs on the rig after the scenario is seeded and before any feature is set up.
  - Inside a check run the ports are wrapped once more by the read cache (section 3): assert on what the check returned, not on how often the fake was called, unless the call count is what you are testing.
- To make a provider fail with an error, hang, or a program fail to start, use the `failProvider`, `hangProvider` and `failProcessStart` mutations (they work in scenario files and live).
- Features start watchers in `setup`. In a test that wires the app, call `dispose` on them before cleanup: `for (const f of app.wiring.features) await f.dispose?.()`.
- A fix that applies a monitor layout waits for the keep-or-revert answer. `wiredApp` answers "keep" by itself; set `app.layoutAnswer` to `'revert'` or to `'wait'` (then answer through `displays:keep` / `displays:revert`).
- Do not mock `fs`. Test code may use `node:fs` to arrange and inspect the temp folder.
- Temp folders (`rigready-test-*`, `rigready-e2e-*`, `rigready-scenario-*` in `%TEMP%`) are removed when a test ends; what a killed run leaves behind is cleared by the next run once it is an hour old.
- Coverage thresholds (80% lines/functions/statements, 70% branches) apply to `src/core`, `src/shared`, `src/platform/fake`, `src/platform/node` and every feature's `core/`.
- Helpers for whole-app tests: `tests/schemaWalk.ts` (`discoverContracts()`, `sample(schema)` builds a valid input from a zod schema, `leaves`, `withValueAt`), `tests/sabotage.ts` (`sabotage(ports)` makes the fake machine accept every change and carry out none; `restore()` ends it), `tests/fuzz.ts` (damaged forms of a file). The unit suite runs under a guard that fails any test in which a file below Program Files is changed (`tests/guardProgramFiles.ts`).

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
| `failProvider` | `port` (as above), `message?`, `fail?: false` | Every read of that port answers with an error result (a driver or Windows API that fails), until `fail: false` |
| `setKnownFolder` | `folder: documents \| savedGames`, `path` | Moves Documents or Saved Games to another folder below the fake user folder, as a user does in Properties > Location. A file the scenario writes must go to the new place |
| `slowFiles` | `ms` (0 ends it) | Every read and write of a file's content takes that long (a slow disk, a big backup), so a long operation can be watched |
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
| `writeFile` | `path`, `content` or `from` (file relative to the scenario), `rehome?: true` | Writes a file in the fake user folder. With `rehome`, recorded paths in the content (`C:\Users\User`, `C:\Program Files`, ...) are pointed at the fake user folder, e.g. for a `libraryfolders.vdf` that names a second Steam library |
| `removeFile` | `path` | Removes a file or folder |
| `setSteamBuild` | `appId`, `buildId?`, `stateFlags?` (6 = update required), `targetBuildId?`, `lastUpdated?` | Edits the game's `appmanifest_<appId>.acf` |

HidHide is queried the way the real one is: `ports.shell.run(<HidHideCLI.exe>, ['--cloak-state', '--inv-state', '--dev-list', '--app-list', '--cancel'])` answers `--cloak-on|off`, `--inv-on|off`, `--dev-hide "<HID path>"` and `--app-reg "<exe>"` lines; `--dev-gaming` answers the recorded JSON. Always end read-only queries with `--cancel` (the real CLI saves on exit otherwise). The `--dev-hide` line format is inferred: nothing was hidden on the rig when it was recorded.

Existing scenarios (`fixtures/scenarios/`, 65 files; `npm run dev:scenario` without a name lists them):

| Group | Scenarios |
|---|---|
| The rig as it is | `desk-mfds-wrong` (exactly as recorded: desk layout, MFD screens landscape), `flying-fresh` (known-good flying layout, no setups: the first run), `racing-fresh` |
| Flying, one thing off | `flying-all-good`, `flying-pedals-unplugged`, `flying-mfd-rotated`, `flying-trackir-not-running`, `flying-streamdeck-not-running` (optional item), `flying-optional-missing`, `flying-options-lua-missing` (a kept copy can be restored) |
| The Fly screen in depth | `fly-make-ready-all` (four problems at once), `fly-two-setups` (and one broken setup file), `fly-actions` (steps before and after launch), `fly-generic-checks` (services, files, scripts, game version), `fly-trackir-refused` (the start does not bring it up), `fly-suggest` (the racing rig on the desk with the F/A-18C setup on screen: the gear is another setup's) |
| Damage | `damaged-data-files` (RigReady's own files), `damaged-game-folders` (the folders of DCS and iRacing deleted), `app-old-backups` |
| Per feature | `audio-*` (4), `backup-*` (5), `dcs-bindings-*` (6; `dcs-bindings-identical`: three panels with one name whose IDs all changed; `dcs-bindings-old-ids`), `dcs-setup-*` (4), `dcs-two-installs`, `devices-*` (3), `displays-*` (3), `share-*` (3; `share-old-ids`: binding files that carry another PC's device IDs), `stream-deck-*` (2), `trackir-*` (3), `cheat-sheets-hornet`, `cheat-sheets-kneeboard`, `ai-assist-hornet` (scripted Anthropic answers) |
| The shell | `shell-flight-and-racing` (the flying rig with a flight setup and a racing setup side by side, for the accent that follows the setup's kind of game), `shell-racing-pc` (a generic PC whose only game is iRacing, for the first-run welcome) |
| Racing | `racing-not-ready`, `racing-iracing-moved-wheel` (the wheel has a new Windows id), `racing-rim-variant`, `mark-racing`, `mark-racing-tv`, `tour-racing` (the racing rig with an iRacing setup, for the tour) |
| Not the owner's PC | `generic-fresh`, `generic-custom-game`, `generic-dcs`, `generic-second-pc` |
| One click | `one-click-fly` (the middle MFD screen rotated back and TrackIR closed; the window stays open after a launch), `one-click-slow-start` (TrackIR's start is accepted but it does not show up, so its fix keeps waiting until a test starts it) |

The racing rig and the generic PCs, which the ledger names as fixtures, are scenarios too:

| Scenario | What it is |
|---|---|
| `mark-racing` | The ledger's `mark-racing`: `mark-full` with all flight gear unplugged (WinWing devices, TPR pedals, Virpil panel, TrackIR camera, the three USB MFD screens), TrackIR and SimAppPro closed, the Dell off, the ultrawide the main display. The Fanatec DD2, Fanatec Service, trophi.ai and the Stream Deck stay. It extends `racing-fresh` (which keeps the TrackIR camera) and adds nothing that was not recorded |
| `mark-racing-tv` | `mark-racing` plus two things that were **not** on the PC when it was recorded: the TV (3840x2160 at 640,-2160, above the ultrawide; the same monitor id the saved "Racing" layout in `data/displays/layouts.json` names) and SimHub installed and running |
| `generic-fresh` | `fixtures/rigs/generic-rig` as written: a PC that is not the owner's, with one joystick, one monitor, no sim, no helper apps, no setups (section 10) |
| `generic-custom-game` | `generic-fresh` plus a game RigReady has no module for: `Games/Star Hauler/StarHauler.exe` and `Documents/Star Hauler` (settings, controls, a save) |
| `generic-dcs` | `generic-fresh` plus the standalone (not Steam) DCS World: the Eagle Dynamics registry key, `Program Files/Eagle Dynamics/DCS World/bin/DCS.exe`, `Saved Games/DCS/Config/options.lua` |
| `generic-second-pc` | A second generic PC: two monitors, two sticks of other makes, DCS World in a second Steam library, Saved Games moved out of its default place (`setKnownFolder`). The core flows are proven on it (`tests/unit/genericSecondPc.test.ts`, `tests/e2e/generic-second-pc.e2e.ts`) |

Add your own file, prefixed with your feature (`audio-wrong-default.yaml`); do not change existing ones or `fixtures/rigs/`. Put helper files next to it under `fixtures/scenarios/data/<feature>/` and profiles under `fixtures/scenarios/profiles/`. `tests/unit/scenarioMode.test.ts` starts every scenario file: its rig must exist, every mutation must match something, and every profile and data file must be there.

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

Use it (`wiredApp('generic-fresh')`, `rig.launch('generic-fresh', ...)`) whenever a feature must behave on a PC that lacks what it is about: its page should render an empty state that says what is missing, never an error, never a red status for hardware nobody asked for, and its capture should offer nothing. `tests/unit/genericRig.test.ts` and `tests/e2e/generic-rig.e2e.ts` do this for the whole app (every Configure page, capture, a setup for an "Other" game). **A new Configure page or sub-page must be added to the `PAGES` list in `tests/e2e/generic-rig.e2e.ts`** (its route, the test id of its root, what it must say on this PC, and what it must never say), and a new navigation entry also raises the expected number of navigation links in that test (`toHaveCount(18)` today). The test fails when the navigation offers a page the list does not visit. `tests/unit/notHardcoded.test.ts` fails when code under `src/` (comments and tests aside) contains a serial, device instance, monitor id, audio endpoint id or controller GUID of `mark-full`, the owner's name, or the name or user folder of the PC the test runs on.

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
| `secondStart(args?)` | Starts the app a second time on the same folders while this one runs, as a desktop shortcut or a Jump List task does (`secondStart(['--fly=dcs-f-a-18c'])`); resolves with the second start's exit code |

Options: `{ dialogs: { open: [['Documents/x.rigready']], save: ['Documents/out.zip'] }, env: { ... }, args: ['--fly', 'DCS F/A-18C'] }` (dialog answers given here come before those of the scenario file; `args` are command-line arguments for the app).

Use a flow name no other spec uses (prefix it with your feature); its screenshot folder is emptied on launch. No `waitForTimeout`, no `if (await x.isVisible())`: assert with `expect(locator)`, which waits. `toContainText` passes on an element that is still fading in; assert `toBeVisible()` on a dialog before you act on it. Passing checklist groups are collapsed on the Fly screen; click `group-toggle-<group>` to see their rows. Look at your screenshots before you call the work done.

### The whole-app specs your page is part of

These specs find routes from the running app's router and navigation, so a new page is in them without anyone adding it. What each asks of a page:

| Spec | What it does | What your page must do |
|---|---|---|
| `tour.e2e.ts` | Visits every page on four rigs (`flying-all-good`, `tour-racing`, `generic-fresh`, and `flying-fresh` as a first run) and saves one screenshot per page to `artifacts/screens/tour-flying`, `tour-racing`, `tour-generic` and `tour-first-run` (the user guide takes its pictures from there). | Have an `.rr-page` root, an `.rr-page-title` of at least three characters and an `.rr-page-sub` of at least fifteen; settle (the same text three times in a row, nothing loading) within 20 seconds on each rig; and leave the navigation fitting the window without scrolling. A tool panel that has no heading by design goes on the spec's `NO_HEADING` list with its reason (only the quick-look sheet is there). |
| `generic-rig.e2e.ts` | Every Configure page on a PC with one joystick and no sim. | Be on its `PAGES` list (section 10); show an honest empty state, no error element (`[data-testid$="-error"]`, an error alert), nothing still loading. |
| `generic-second-pc.e2e.ts` | Capture, Make ready, Launch, Stand down, backup, restore, share and import on a second generic PC; every route renders. | Work with a moved Saved Games folder and a second Steam library: take every path from `ctx.ports.folders` and the game modules. |
| `nfr.e2e.ts` | Crawls every route of every feature: renders, no "nothing at this address", no error alert, no visible control that is a stub, no disabled control that does not say why. Also proves the renderer sandbox and CSP, that a scenario run never touches the real `~/.rigready`, and that the window answers within 100 ms while a long backup runs. | Give every visible control a working handler; say why a control is disabled. |
| `a11y.e2e.ts` | axe-core on the Fly screen in each state, on every Configure route (tabs included), and on scenarios with something wrong. | Name every control, keep text contrast (use the design tokens), never say status by colour alone. A new scenario that shows your feature's problem state belongs on its list of troubled scenarios. |
| `keyboard.e2e.ts` | Operates the Fly screen from Not ready through Make ready to Launch with the keyboard only. | Keep focus order and focus visibility when you add to the Fly screen. |

Other real-machine suites, not part of `npm run check`: `tests/rig/*.rig.test.ts` (`npm run rig:smoke`: reads, check timings, no-admin; `rig:smoke:apply` adds monitor and audio changes that are restored), `tests/packaged/*.e2e.ts` (`npm run smoke:packaged`), `tests/installer/installer.e2e.ts` (`npm run smoke:installer`). Run them when your change touches `src/platform`, packaging, the sidecar, the updater or the installer.

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

1. `npm run check` passes. It includes every audit of section 15; the sabotage audit alone takes 60 to 80 seconds.
2. `npm run test:e2e` passes and you have looked at your screenshots, the tour's pictures of your page on all four rigs included.
3. A new page is on the `PAGES` list of `tests/e2e/generic-rig.e2e.ts` (section 10).
4. `git add` your own paths only (your feature folder, your scenario and e2e files, your screenshot folders, the ledger). Never `git add -A`. Other flows' screenshots change on every e2e run (they show temp paths and times); do not commit them: `git checkout -- artifacts/screens/<their-flow>`.

## 14. The features and what each owns

Every folder under `src/features/`. "Registers" lists what the feature adds to the core registries; check and fix types are in each feature's `index.ts`.

| Feature | Owns | Registers |
|---|---|---|
| `fly` | The Fly screen (`/fly`): the checklist of the setup used last, Re-check, the fix beside a failing item, Make ready, Launch with its before and after steps, Stand down; what the tray shows and does. | |
| `profiles` | Setups (`/configure/profiles`): the list, "New setup from this rig" (capture), the editor, clone, copy items between setups, hand-edited YAML, and a setup's desktop shortcut ("<setup name> - RigReady.lnk", which starts RigReady with `--fly=<setup id>`): shown first, written through FileStore, and reported only after it was read back. | |
| `checks-generic` | Checks any setup can use. No screen. | Checks `service.running`, `file.exists`, `file.content`, `script.check`, `game.updated`; fixes `script.run`, `instructions.show`, `file.restore` |
| `processes` | "This program is running", and starting it. No screen. | Check `process.running`, fix `process.launch`, the capture of running apps |
| `devices` | Devices, Input tester, Health check and USB map (`/configure/devices`); the names the owner gave devices (`ctx.names`); HidHide awareness; plug and unplug notifications. | Check `device.connected`, a capture source, a settings section |
| `displays` | Monitors (`/configure/displays`): the arrangement now, named layouts, Identify, "which way is up", the keep-or-revert prompt (an overlay on every screen); monitor names (`ctx.names`). | Check `display.layout`, fix `display.applyLayout`, stand-down step `displays.deskLayout`, a capture source |
| `audio` | Audio (`/configure/audio`): default playback and recording devices. | Check `audio.defaultDevice`, fix `audio.setDefault`, a capture source |
| `games` | Games (`/configure/games`, `/configure/games/:id`) and the game modules in `games/<game>/module.ts`: installs, versions, folders, tracked-file suggestions, launch through Steam. | The game modules (`ctx.games`) |
| `dcs-setup` | DCS World (`/configure/dcs`): Overview, Screens (MonitorSetup), Export.lua, SimAppPro (import of its screen plan, and when it is still needed). | Checks `dcs.install`, `dcs.monitorSetup`, `dcs.exportLua`, `dcs.options`, `dcs.simAppProRunning`, `dcs.managedFiles` and their fixes |
| `dcs-bindings` | DCS bindings (`/configure/dcs-bindings`): Overview, Devices, Actions, Problems, Device IDs, Copy, Snapshots. The only code that writes DCS input files. | The DCS `BindingReader` with `actions` and `proposals`; check `dcs-bindings.deviceIds` |
| `cheat-sheets` | Cheat sheets (`/configure/cheat-sheets`): a picture of each device with what every control does, device layouts and the layout editor (`LAYOUT-FORMAT.md`), notes, print and PDF, DCS kneeboard pages, the quick-look panel (`openPanel`). Reads bindings only through `ctx.bindings`, for every game that has a reader, and redraws when one says its bindings changed. Ships layouts for the owner's flight devices and the Fanatec wheel base. | Check `cheat-sheets.kneeboardCurrent`, fix `cheat-sheets.regenerate` |
| `ai-assist` | Binding guide (`/configure/ai-assist`): shipped guides for the F/A-18C and UH-1H (`packs/`), the press-to-bind walkthrough, priorities, and the optional AI help (Anthropic API through `http`, the key in `secrets`). Writes bindings only as proposals to the bindings feature. | Action labels (`ctx.bindings.registerLabels`), a settings section |
| `backup` | Backups (`/configure/backups`): tracked files, full and scoped backups, snapshots, "what changed", the restore wizard. | Fix `backup.gameFiles`; reads `ctx.backupSources` and `GameModule.trackedFiles` |
| `sharing` | Share (`/configure/share`): export a setup as a `.rigready` file with a privacy review; import with a compatibility report and a choice of what to bring in. | |
| `racing` | Racing (`/configure/racing`) with a page each for iRacing, Le Mans Ultimate, BeamNG.drive and Assetto Corsa, and Wheel (`/configure/racing/wheel`, Fanatec). | Checks `racing.wheelBase`, `racing.iracingDevices`, `racing.iracingService`, `racing.bindingSet`, `racing.wheelSettings`; fix `racing.restoreBindingSet`; a backup source; a `BindingReader` for each of the four games |
| `stream-deck` | Stream Deck (`/configure/stream-deck`): install detection, profile and plugin inventory with findings, backup, restore, guided setup on a new PC. | Checks `stream-deck.running`, `stream-deck.connected`, fix `stream-deck.start`; a backup source |
| `trackir` | TrackIR (`/configure/trackir`): detection, profiles and the game-to-profile map (read only). | Checks `trackir.running`, `trackir.connected`, fix `trackir.start`; a backup source |
| `settings` | Settings (`/configure/settings`): startup, desk layout, retention and limits, the AI key; hosts the settings sections other features add. | |
| `safety` | Safety (`/configure/safety`): every change RigReady made outside its own folder, by user action, with Undo. | |
| `diagnostics` | Diagnostics (`/configure/diagnostics`): what RigReady knows about this PC, the state of its data files, the log, the "Detailed log" switch, Copy and Export diagnostics (redacted). | |
| `updates` | Updates of RigReady itself: when to check, download and install; never while a game runs. | Two settings sections (Updates, About) |
| `one-click` | What the window shows when RigReady is started to do something at once (a desktop shortcut, a Jump List task, `RigReady.exe --fly "<setup>"`): the strip with the command's progress, "Do not launch", and why it stopped. The shell runs the command (`src/main/rigCommand.ts`); the strip reads it through the shell's own contract. Also the optional system-wide hotkey that runs Make ready: choosing it, keeping it (`<data root>/one-click.json`) and registering it; the shell acts on the press. No page. | An overlay, a settings section |

Things two features both need are in core already, so do not build a second copy: the Lua reader/writer and sandbox, DirectInput identities, press detection, Steam manifests, path variables, named monitor layouts, settings, the journal and Undo (the Safety page), write previews, zip, the JSON store, the redactor, the privacy scanner, the credential list.

Known limits, so you do not look for what is not there:

- The registry port is read-only. Restoring `HKCU\Software\Endor\FanatecService` or any other key is not possible; back such settings up as data and show them, do not promise a restore.
- There is no port for a program's file version. Use Steam build ids, `dcs.log`, or version files (`iRacing\version_system.txt`).
- `ports.devices.subscribe` on the real machine polls a cheap device-list size every 1.5 s: expect a notification within about 2 s of a plug or unplug.
- `engine commands` (`iCommand...`) used by DCS input defaults have no numeric values in any Lua file (see `docs/research/dcs.md` 1.6); the sandbox example resolves them to their names.
- Screenshots that show paths contain the temp folder of that run, so they differ from run to run.
- Which of the two portrait orientations (90 or 270) is upright on a monitor mounted on its side cannot be read from Windows. Monitors > Identify shows an arrow and asks "Which way is up?"; the answer is stored in the saved layouts.
- The Fanatec base keeps its tuning presets in its own memory; no file on the PC holds them, so RigReady cannot back them up.
- Real-hardware tests: `tests/rig/*.rig.test.ts` (`npm run rig:smoke` reads only; `npm run rig:smoke:apply` also changes and restores monitors and audio defaults: `displayApply`, `displayIdentity`, `audioApply`). The packaged smoke (`tests/packaged`) additionally writes and removes the real "start with Windows" entry and runs a real batch file, hidden and not; and in a profile of its own under a temp folder it makes, starts and removes a real desktop shortcut, has Windows write a Jump List, and registers and gives back a hotkey (`tests/packaged/oneClick.e2e.ts`).

## 15. The audits your feature must pass

These are unit tests in `tests/unit/` (part of `npm run check`) and ESLint rules. Almost none of them has a list of features to edit: they find feature folders, contracts, channels, check types and scenarios by themselves, so a new feature is audited the moment its folder exists. Where an audit has a list of exceptions, every entry needs a written reason and the test checks that the entry is still true. Adding an entry is a shared change (see the ground rules); the first answer to a failing audit is to fix the code.

**Silent catches (`swallowedErrors.test.ts`).** Every `catch` in `src/` that throws the error away (no binding, a binding the block never uses, or `.catch(() => ...)` with no argument) must either turn it into an error of its own (`return err(...)`, `throw`, set a message) or say why nothing needs reporting, in a comment inside the block (for a one-line `.catch`, on that line or the line before). To satisfy it: use the error, or write the sentence, e.g. `// No feed file yet: the test has not offered a version.`

**Writes are shown first (`writeAudit.test.ts`).** Four checks. (1) Every journal entry carries its action (`groupId`, `groupReason`) and a reason a person can read: always pass a real sentence as `reason`. (2) No background writes: the app is started on the full rig, idled for a simulated day, and every channel that takes no input is called; the journal must stay empty. A read never writes outside the data root, and neither does `setup`. (3) The source rule: a feature whose non-renderer code calls `files.write`, `copy`, `move`, `remove`, `copyTree` or `extractZip` must import `core/files/preview` and have a channel with "preview" in its name, or be on the `REASONED` list. (4) For previewed flows, the preview must say exactly what the journal then shows, and a fix Make ready runs must name its files before and after. To satisfy it: follow the four steps in section 6 (Preview). `REASONED` is for a feature that writes only inside the data folder, or that has a richer preview of its own; an entry holds `why` (more than 40 characters, and true) and optionally `previews`, a map from each applying channel to the channel that shows the change first. Today it lists `ai-assist`, `checks-generic`, `dcs-bindings`, `diagnostics`, `displays` and `sharing`; the test fails when an entry's feature no longer writes or a channel it names is gone. A feature that only keeps its own data should use `JsonStore` and stay off the list if it can. The same file holds a table that pairs every channel that writes game or tool files with its preview channel (or `save`, when the one file is named by the user in a Save dialog): add your pair there.

**IPC input and paths (`ipcAudit.test.ts`).** Every contract channel has exactly one handler and a name the preload lets through. Every channel answers each malformed shape (wrong types, missing fields, `undefined`, huge strings, deep objects, prototype keys) with a validation error and never throws or hangs. Every field whose name looks like a path (`path`, `file`, `dir`, `folder`, `exe`, `cwd`, `target`, `from`, `to`, `...Path`, `...File`, ...) is called with `C:/Windows/System32/x`, a traversal, a UNC path and a device path and must refuse them; and no string field at all may make main touch a file, start a program or run a command outside the allowed folders (a canary file proves it). To satisfy it: give every input a zod schema with real constraints, pass every renderer path through `resolveAllowedPath`, and keep dialog-picked paths in main. A path-like field that is stored as data and not used as a path by the call goes on `DATA_ONLY` with its reason (today only the launch target of a setup).

**No success for something that did not happen (`verifiedActions.test.ts`, the sabotage audit).** The fake machine is made to accept every change and carry out none: a program that is started and never shows up, a close that leaves the program running, a layout that is accepted and not applied, an audio default that stays, a file that is written and put back (`tests/sabotage.ts`). Then every registered fix is run with the parameters of every scenario setup whose check fails (and a generated sample otherwise), and Stand down, Launch and every other IPC channel are called with the ids the app hands out. None may answer "done". It takes 60 to 80 seconds. To satisfy it: after every change, read the machine again and compare before returning `ok` (poll `processes.list()` after a start, `displays.read()` after an apply, read the file after a write that another program might undo); return `err(...)` or a step with `ok: false` otherwise. Two exception lists, each proven by a test of its own: `VERIFIED_BY_EXIT_CODE` (only `script.run`: a script's exit code is its read-back) and `HAND_OFF` (channels that hand a file or a game to another program and have nothing to read back: `profiles:openFile`, `profiles:showFile`, `backup:reveal`, `diagnostics:openLogFolder`, `games:launch`). A hand-off's answer must say what was asked ("Asked Steam to start ..."), not that it happened.

**No stubs (`noStubs.test.ts`, and the crawl in `tests/e2e/nfr.e2e.ts`).** Every event handler in every template must exist in its component and do something; no empty handler; no "not implemented", "coming soon", TODO or FIXME anywhere in shipped code, comments or text; no control that is disabled for good (a bare `disabled`); every button has a click handler, a link, a form, or the menu or dialog it opens. To satisfy it: do not ship the control until it works.

**User paths only from KnownFolders (`knownFolders.test.ts`, and a lint rule).** No shipped source reads `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `ProgramFiles`, `TEMP`, `RIGREADY_HOME` and the like from the environment, or calls `os.homedir()` or `os.tmpdir()`. To satisfy it: `ctx.ports.folders`, and path variables (`allPathVariables`) for anything stored.

**Nothing hardcoded to the owner's rig (`notHardcoded.test.ts`).** No source file under `src/` (comments and tests aside) may contain the owner's name, the name or user folder of the PC the test runs on, or a serial number, device instance, monitor id, audio endpoint id or controller GUID of `fixtures/rigs/mark-full`. To satisfy it: identify hardware by what the ports report at run time; a built-in table keys on vendor and product id, never on a serial or instance. Examples in user-facing text name neutral hardware.

**Layers (`architecture.test.ts`, `lintRules.test.ts`, ESLint).** Only `src/platform` imports `fs`, `child_process` or `koffi`; features do not import each other, `src/main`, `src/platform`, `src/legacy` or `electron`; core imports nothing but `src/shared`. `eslint.config.mjs` also forbids, in everything that ships: `exec`, `execSync`, `execFile`, `execFileSync`; `shell: true`; a `spawn` that is given a `shell` option; `os.homedir()` / `os.tmpdir()`; and reading a path variable from `process.env`. To satisfy it: `ctx.ports.shell.run(exe, args[])`, `ctx.ports.processes.start`, `ctx.ports.folders`.

**No shell command strings (`shellAudit.test.ts`).** A text scan of `src/`, `scripts/` and the Python sidecar for every form of building or running a command line, plus proofs with hostile names and arguments (`x & calc.exe`, `$(whoami)`) through the real `cmd.exe` and PowerShell paths. To satisfy it: values from a setup reach a script as environment variables (`scriptEnvironment`) or as literal array elements, never as text in a command.

**Self-registration (`selfRegistration.test.ts`).** The features are found by exactly two globs; each `main.ts` default-exports `defineFeatureMain` with the id of its folder; a feature id or a channel registered twice stops the app at startup; no shared source (`core`, `main`, `renderer`, `shared`, `platform`) mentions a feature folder by name. To satisfy it: put everything in your folder, and offer what others need through a core registry.

**Performance (`performance.test.ts`).** The full F/A-18C checklist (25 items or more) runs in under 5 seconds on the fake platform, and one check run enumerates USB devices once and reads the process list once, however many checks there are. To satisfy it: read through the `ctx.ports` your check's `run` receives (section 3), and do not start a slow read per item.

**Damaged files (`fuzzParsers.test.ts`, `fuzzStores.test.ts`, `fuzzApp.test.ts`).** Every parser is fed damaged, foreign, cut-off, huge and deeply nested content; none may throw or hang. Every store keeps a damaged file aside instead of overwriting it. And the whole app is run with every recorded game and tool file replaced by a damaged version, locked, or gone, while every request a page makes when it opens is sent: each must come back as a value (data or an error result), never a throw, a malformed answer or a hang. To satisfy it: a parser returns `Result` and is added to the `PARSERS` list in `fuzzParsers.test.ts` (this one list is kept by hand: the test cannot discover functions); a reader treats a missing file as "not there" and an unreadable one as an error result; requests with input that read files go on `WITH_INPUT` in `fuzzApp.test.ts`.

**Also enforced for every feature:** `statusNotColourOnly.test.ts` (a status-coloured element has an icon and words) and `themeContrast.test.ts` (WCAG AA for the design tokens: use the tokens, not raw colours); `noAdmin.test.ts` (nothing asks Windows for elevation; no test changes a file below Program Files); `scenarioMode.test.ts` (every scenario file starts); `providerFailure.test.ts` (a failing port is reported by every check as not met, with the message); `inputLifetime.test.ts` (features never stop the input reader); `checks-generic/core/registration.test.ts` (core never names a check type); and the coverage thresholds of section 8.
