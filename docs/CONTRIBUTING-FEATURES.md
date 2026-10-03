# Adding a feature

How to add a feature to RigReady without touching a shared file. Read `docs/PRODUCT.md` and `docs/ARCHITECTURE.md` first; this page is the mechanics.

## Ground rules

- You own `src/features/<your-feature>/`, your scenario files, your e2e spec, and your ledger entries. Nothing else.
- **Shared, do not edit:** `src/core`, `src/shared`, `src/main`, `src/renderer`, `src/platform`, `tests/helpers.ts`, `tests/e2e/harness.ts`, `package.json`, the config files, `fixtures/rigs/`. If you need a change there (a new port method, a new mutation, a dependency), ask the coordinator; do not work around it.
- A feature imports from `src/core`, `src/shared`, and (renderer side) `src/renderer/ipc.ts` and `src/renderer/machine.ts`. Never from another feature, `src/main`, `src/platform` or `src/legacy` (ESLint enforces this).
- Code under `core/` is pure: no `fs`, `child_process`, `electron` or `koffi` imports. Everything that touches the machine goes through `ctx.ports` (`src/core/ports/index.ts`).
- Files outside RigReady's data folder are written only with `ctx.ports.files.write(path, content, { reason })`. It backs up first and journals the change. Programs are started only with `ctx.ports.processes.start` or `ctx.ports.shell.run(exe, args[])`.
- Expected failures are returned as `Result` (`ok(value)` / `err(code, message, detail?)` from `src/core/result.ts`). Throw only for bugs.
- `src/legacy/` holds old code to mine (see its README). Copy what you need into your `core/`, port it to the ports, test it, and delete the legacy file.

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
| `npm run rig:smoke:apply` | Also changes and restores the real monitor layout. Owner's PC only. |
| `npm run smoke:packaged` | `electron-builder --dir`, then enumeration + a scenario against the unpacked app. |
| `npm run rig:record -- <name>` | Record this PC into `fixtures/rigs/<name>/`. |

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

`src/features/devices/` is the smallest complete example; `src/features/displays/` shows a check, a remediation, a capture, events and an overlay.

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
    // ctx: ports, log, checks (registry), games (registry), profiles (store), emit
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
- A path that arrives from the renderer must be validated with `resolveAllowedPath(path, roots)` from `src/core/paths.ts` before use; build `roots` from `ctx.ports.folders`.

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
  async run(params, ctx) {                // ctx: { ports, log }
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
```

That is all: the Fly screen, Make ready, Stand down and the capture screen pick the new types up through the registry. Rules the engine applies for you: a required check that is not met is `fail` (red) and makes the setup Not ready; an optional one is `warn` (yellow) and never does. A check that throws, has bad params or an unknown type is reported as not met, never as a crash. A remediation must not report success for something that did not happen: verify, then return `ok`.

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
});
```

- Routes must start with `/configure/` (they render inside the Configure layout). Sections: `Setup` (100s), `Bindings` (200s), `Hardware` (300s), `App` (900s).
- Use the design system in `src/renderer/styles.css`: `rr-page`, `rr-page-title`, `rr-page-sub`, `rr-panel`, `rr-row` / `rr-row-main` / `rr-row-title` / `rr-row-sub`, `rr-section-title`, `rr-empty`, `rr-mono`, and the status colours `rr-ok` / `rr-warn` / `rr-bad`. Vuetify components are auto-imported. Green, yellow and red mean status and nothing else.
- State that outlives a component goes in a Pinia store in `renderer/`.
- After your feature changes the machine, call `notifyMachineChanged()` from `src/renderer/machine.ts`; to refresh when others do, subscribe with `onMachineChanged(fn)` (it returns the unsubscribe).
- Give every element a test drives a `data-testid`.
- Do not render a button for something that is not implemented.

## 5. A game module

`src/features/games/<game>/module.ts` default-exports a `GameModule` (`src/core/games.ts`): `id`, `name`, `detect` (every install: all Steam libraries from `ctx.ports.folders.steamLibraries()`, standalone, Store), `configLocations`, optional `trackedFiles` and `bindings`. It is discovered by glob from `src/features/games/main.ts` and is the only place that game's paths may appear. `src/features/games/dcs/module.ts` is the example. Game-specific checks and screens live in the same folder and are registered from your own feature's `main.ts` using `ctx.games.get('<id>')`.

## 6. Unit tests

Tests live next to the code (`core/thing.test.ts`) and run on fake ports backed by the recorded rig, with real files in a temp directory. From `tests/helpers.ts`:

```ts
const rig = await scenarioRig('flying-all-good');   // { ports, ctx, clock, home, cleanup }
const app = await wiredApp('flying-trackir-not-running');
const report = await app.invoke('fly:check', { profileId: 'dcs-f-a-18c' });   // through IPC validation
app.ports.state.devices = ...;                       // change the fake machine mid-test
app.events;                                          // events emitted to the renderer
await rig.cleanup();                                 // in afterEach
```

`rig.home` is the fake user profile; `ports.folders.savedGames()` etc. are under it and already contain the rig's recorded files (`fixtures/rigs/mark-full/files/`, e.g. `Saved Games\DCS\Config\Input`). To make a provider fail, replace the method: `rig.ports.devices.list = async () => err('x', 'nope')`. Do not mock `fs`. Coverage thresholds (80% lines/functions/statements, 70% branches) apply to `src/core`, `src/shared`, `src/platform/fake`, `src/platform/node` and every feature's `core/`.

## 7. Scenarios

A scenario is `fixtures/scenarios/<name>.yaml`: a recorded rig plus mutations.

```yaml
description: Flying, pedals unplugged       # shown in the app's scenario banner
rig: mark-full                              # fixtures/rigs/<rig>
extends: flying-all-good.yaml               # optional: its mutations and profiles apply first
mutations:
  - { op: unplugDevice, match: { vendorId: 044F, productId: B68F } }   # also: serial, name (substring)
  - { op: stopProcess, name: TrackIR5.exe }
  - { op: startProcess, name: DCS.exe, path: 'C:\DCS\bin\DCS.exe' }
  - { op: setDisplay, match: { name: USB_Monitor, index: 1 }, set: { rotation: 0, width: 1024, height: 768 } }
  - { op: unplugDisplay, match: { name: DELL G3223D } }
profiles:
  - profiles/dcs-f-a-18c.yaml               # copied into the data root at startup
```

Quote ids that YAML would read as numbers (`'4098'`, `'17E9'`). A mutation that matches nothing is an error. Existing scenarios: `desk-mfds-wrong` (the rig exactly as recorded), `flying-fresh` (known-good flying layout, no setups), `flying-all-good`, `flying-pedals-unplugged`, `flying-mfd-rotated`, `flying-trackir-not-running`, `flying-optional-missing`, `racing-fresh`. Add your own file; do not change existing ones or `fixtures/rigs/`.

## 8. An e2e flow

`tests/e2e/<feature>.e2e.ts`:

```ts
import { checkRow, expect, test } from './harness';

test('audio: wrong default device is fixed by Make ready', async ({ rig }) => {
  const { page, shot, dataRoot } = await rig.launch('flying-audio-wrong', 'audio-wrong-default');
  await expect(checkRow(page, 'Default playback')).toHaveAttribute('data-status', 'fail');
  await shot('wrong');            // artifacts/screens/audio-wrong-default/01-wrong.png
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('fixed');
});
```

`rig.launch(scenario, flow)` starts the built app isolated (temp `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `RIGREADY_HOME`) on fake providers. Use a flow name no other spec uses; its screenshot folder is emptied on launch. No `waitForTimeout`, no `if (await x.isVisible())`: assert with `expect(locator)`, which waits. Passing checklist groups are collapsed on the Fly screen; click `group-toggle-<group>` to see their rows. Look at your screenshots before you call the work done.

## 9. Ledger evidence

In `docs/requirements/ledger.yaml`, set `status: done` only with evidence, in the same commit as the work:

```yaml
    status: done
    evidence:
      - src/features/audio/core/defaultDevice.test.ts#fails when another device is the default
      - tests/e2e/audio.e2e.ts#audio: wrong default device is fixed by Make ready
      - artifacts/screens/audio-wrong-default/02-fixed.png
```

A test is `<file>#<test title>`; the file must exist and contain that title. A screenshot or other file is a path from the repository root and must exist (commit `artifacts/screens/<flow>/`). `done` needs at least one test. `npm run ledger:check` (part of `npm run check`) enforces this.

## 10. Before you commit

1. `npm run check` passes.
2. `npm run test:e2e` passes and you have looked at your screenshots.
3. `git add` your own paths only (your feature folder, your scenario and e2e files, your screenshot folder, the ledger). Never `git add -A`.
