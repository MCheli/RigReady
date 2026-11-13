/**
 * Changing an iRacing binding, held against the owner's real bindings files. It goes with
 * the six steps in docs/research/iracing-bindings.md, "The second look".
 *
 * Not part of `npm run rig:smoke`: every test here is skipped unless RIGREADY_RIG_IRACING
 * says which step to run. Neither step writes to Documents\iRacing or starts iRacing. They
 * read the real files; whatever they change is a copy under the temp folder.
 *
 * Before the owner tries a change in iRacing, with iRacing closed:
 *
 *   cross-env RIGREADY_RIG_IRACING=before npx vitest run --config vitest.rig.config.ts tests/rig/iracingBindingsEdit.rig.test.ts
 *
 *   Copies the bindings files (with app.ini and the control profiles, which say which file
 *   iRacing reads) to a temp profile and lets RigReady bind one button and one key there,
 *   with the real Windows ports, in the set for all cars as the page finds it: the control
 *   profile app.ini names, or on an iRacing without profiles, controls.cfg. The copy must
 *   differ in those two records only, the backup must be the file as it was, Undo must put
 *   it back, and the real files must be as they were. It also keeps a copy of that real
 *   file as it is now, and which file it was, for the step below.
 *
 * After the owner changed bindings with RigReady, looked at them in iRacing and closed it:
 *
 *   cross-env RIGREADY_RIG_IRACING=after RIGREADY_RIG_IRACING_ACTIONS=HeadlightFlash,BlackBoxShowNext npx vitest run --config vitest.rig.config.ts tests/rig/iracingBindingsEdit.rig.test.ts
 *
 *   Reads the same real file as iRacing left it and the copy kept before. The two must
 *   differ in the named actions only, and each of those records must be byte for byte
 *   what RigReady writes for that binding.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nullLogger } from '../../src/core/logger';
import type { Ports } from '../../src/core/ports';
import type {
  ChangeRequest,
  ChangeResult,
  ChangeReview,
  Overview,
  SetView,
  WantedBinding,
} from '../../src/features/iracing-bindings/contract';
import {
  RECORD_BYTES,
  encodeControlsFile,
  parseControlsFile,
  type ControlRecord,
  type ControlsFile,
} from '../../src/features/iracing-bindings/core/controlsFile';
import { KEPT_BYTES } from '../../src/features/iracing-bindings/core/edit';
import { discoverFeatures, wireFeatures, type Wiring } from '../../src/main/bootstrap';
import { createWindowsPorts } from '../../src/platform/windows';
import type { InputDevice } from '../../src/shared/models';

const step = process.env['RIGREADY_RIG_IRACING'];
const projectRoot = path.resolve(__dirname, '../..');
const CONTROLS = 'controls.cfg';
/** The real file for all cars as it was at the "before" step, for the "after" step to read. */
const KEPT = path.join(os.tmpdir(), 'rigready-rig-iracing-second-look', 'controls-before.cfg');
/** Which file that was, relative to Documents\iRacing. */
const KEPT_FROM = path.join(os.tmpdir(), 'rigready-rig-iracing-second-look', 'kept-from.txt');

/** The actions the second look changes; any other free one is taken when these are in use. */
const FOR_A_BUTTON = ['HeadlightFlash', 'PushToPass', 'DRS'];
const FOR_A_KEY = ['BlackBoxShowNext', 'BlackBoxShowPrev', 'TellTaleReset'];
/** Keys to try, in iRacing's own codes: a letter with Shift, then with Ctrl. */
const KEYS: WantedBinding[] = ['J', 'H', 'K', 'Y', 'U'].flatMap((letter) =>
  [0x03, 0x0c].map((modifiers): WantedBinding => ({
    kind: 'key',
    keyCode: letter.charCodeAt(0),
    modifiers,
  }))
);

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
const plain = (guid: string): string => guid.replace(/[{}]/g, '').toUpperCase();
const inside = (folder: string, file: string): boolean =>
  path
    .resolve(file)
    .toLowerCase()
    .startsWith(path.resolve(folder).toLowerCase() + path.sep);

function parsed(bytes: Uint8Array, what: string): ControlsFile {
  const file = parseControlsFile(bytes);
  if (!file.ok) throw new Error(`${what}: ${file.error.message} ${file.error.detail ?? ''}`);
  return file.value;
}

/** Where two byte runs of one length differ, as offsets. */
function differing(a: Uint8Array, b: Uint8Array): number[] {
  const at: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) at.push(i);
  return at;
}

/**
 * The real folder's bindings files, as paths under it: the older controls.cfg and
 * joyCalib.yaml, each car's controls.cfg, each control profile's two files, and app.ini,
 * which names the profile iRacing uses. Nothing else.
 */
async function bindingFiles(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of [CONTROLS, 'joyCalib.yaml', 'app.ini']) {
    if (await exists(path.join(folder, name))) found.push(name);
  }
  const setups = path.join(folder, 'setups');
  const cars = (await exists(setups)) ? await fs.readdir(setups, { withFileTypes: true }) : [];
  for (const car of cars) {
    const file = path.join('setups', car.name, CONTROLS);
    if (car.isDirectory() && (await exists(path.join(folder, file)))) found.push(file);
  }
  const profiles = path.join(folder, 'profiles', 'controls');
  const named = (await exists(profiles)) ? await fs.readdir(profiles, { withFileTypes: true }) : [];
  for (const profile of named) {
    if (!profile.isDirectory()) continue;
    for (const name of [CONTROLS, 'joyCalib.yaml']) {
      const file = path.join('profiles', 'controls', profile.name, name);
      if (await exists(path.join(folder, file))) found.push(file);
    }
  }
  return found;
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false
  );
}

/** Enough to tell that a file was not written: its content, its size and when it last changed. */
async function fingerprint(file: string): Promise<string> {
  const stat = await fs.stat(file);
  const hash = createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
  return `${hash} ${stat.size} ${stat.mtimeMs}`;
}

describe.skipIf(step !== 'before')(
  'changing an iRacing binding on a copy of the real files (manual)',
  () => {
    let ports: Ports;
    let wiring: Wiring;
    let home: string;
    let realFolder: string;
    let copyFolder: string;
    let copy: string;
    let original: Buffer;
    const untouched = new Map<string, string>();
    const changed: string[] = [];

    const call = async <T>(channel: string, input?: unknown): Promise<T> => {
      const answer = await wiring.handlers.get(`iracing-bindings:${channel}`)!(input);
      if (!answer.ok) throw new Error(`${channel}: ${answer.error.code} ${answer.error.message}`);
      return answer.value as T;
    };
    const allCars = (): Promise<SetView> => call<SetView>('set', { id: 'all' });

    beforeAll(async () => {
      // The real folder is found the way the product finds it, and is only ever read.
      realFolder = path.join(
        createWindowsPorts({ log: nullLogger, projectRoot }).folders.documents(),
        'iRacing'
      );
      home = await fs.mkdtemp(path.join(os.tmpdir(), 'rigready-test-rig-iracing-'));
      copyFolder = path.join(home, 'Documents', 'iRacing');
      for (const file of await bindingFiles(realFolder)) {
        untouched.set(file, await fingerprint(path.join(realFolder, file)));
        await fs.mkdir(path.dirname(path.join(copyFolder, file)), { recursive: true });
        await fs.copyFile(path.join(realFolder, file), path.join(copyFolder, file));
      }
      // The profiles folder alone says iRacing keeps control profiles, even when no file in
      // it was copied: without it the copy would look like an older iRacing, and RigReady
      // would read the older controls.cfg that the real page refuses to fall back to.
      const profiles = path.join('profiles', 'controls');
      if (await exists(path.join(realFolder, profiles))) {
        await fs.mkdir(path.join(copyFolder, profiles), { recursive: true });
      }
      expect(await exists(path.join(copyFolder, profiles))).toBe(
        await exists(path.join(realFolder, profiles))
      );
      // RigReady itself gets the temp profile: its Documents folder and its own data folder.
      ports = createWindowsPorts({
        log: nullLogger,
        projectRoot,
        env: {
          ...process.env,
          USERPROFILE: home,
          APPDATA: path.join(home, 'AppData', 'Roaming'),
          LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
          RIGREADY_HOME: path.join(home, 'rigready'),
        },
      });
      if (path.resolve(ports.folders.documents()) !== path.resolve(home, 'Documents')) {
        throw new Error('RigReady did not take the temp profile. Nothing was changed.');
      }
      wiring = wireFeatures({ features: discoverFeatures(), ports, log: nullLogger, send() {} });
      // The file for all cars as the page finds it: the control profile iRacing uses.
      const general = (await call<Overview>('overview')).sets.find((s) => s.general);
      if (!general) throw new Error('RigReady found no bindings for all cars in the copies.');
      copy = general.file;
      original = await fs.readFile(copy);
    });

    afterAll(async () => {
      for (const feature of wiring?.features ?? []) await feature.dispose?.();
      await ports?.input.stop();
      if (home) await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    });

    /** One change through the same two channels the page uses, held to its one record. */
    async function changeOne(request: ChangeRequest): Promise<void> {
      const before = await fs.readFile(copy);
      const record = parsed(before, 'the copy').records.find((r) => r.action === request.action)!;
      const review = await call<ChangeReview>('changePreview', request);
      expect(review.blocked, 'iRacing is open. Close it and run this again.').toBeUndefined();
      expect(review.same).toBe(false);
      expect(same(await fs.readFile(copy), before), 'the review wrote nothing').toBe(true);

      const result = await call<ChangeResult>('change', request);
      expect(result.changed).toBe(true);
      expect(path.resolve(result.file)).toBe(path.resolve(copy));
      const after = await fs.readFile(copy);
      expect(after.length).toBe(before.length);
      const at = differing(before, after).map((i) => i - record.offset);
      expect(at.length).toBeGreaterThan(0);
      expect(Math.min(...at), 'first changed byte of the record').toBeGreaterThanOrEqual(
        KEPT_BYTES
      );
      expect(Math.max(...at), 'last changed byte of the record').toBeLessThan(RECORD_BYTES);
      const written = parsed(after, 'the changed copy').records.find(
        (r) => r.action === request.action
      )!;
      expect(written.understood).toBe(true);
      changed.push(request.action);
      console.log(
        `  ${request.action}: ${review.before} -> ${review.after}\n` +
          `    was ${hex(record.data)}\n    now ${hex(written.data)}`
      );
    }

    /** The first of the wanted actions that has nothing on it and takes this kind of input. */
    function freeAction(view: SetView, wanted: string[], kind: 'button' | 'key'): string {
      const free = view.actions.filter((a) => !a.binding && a.accepts.includes(kind));
      const pick = wanted.find((id) => free.some((a) => a.id === id)) ?? free[0]?.id;
      if (!pick) throw new Error(`No action without a binding takes a ${kind}.`);
      return pick;
    }

    /** The first of these bindings that nothing in the set uses yet. */
    async function unused(action: string, candidates: WantedBinding[]): Promise<WantedBinding> {
      for (const binding of candidates) {
        const review = await call<ChangeReview>('changePreview', { set: 'all', action, binding });
        if (review.conflicts.length === 0) return binding;
      }
      throw new Error(`Every button or key that was tried for ${action} is already in use.`);
    }

    it('works on copies: RigReady sees the temp profile, and iRacing is closed', async () => {
      expect(path.resolve(ports.folders.dataRoot())).toBe(path.resolve(home, 'rigready'));
      const overview = await call<Overview>('overview');
      expect(path.resolve(overview.folder ?? '')).toBe(path.resolve(copyFolder));
      expect(overview.simRunning, 'iRacing is open. Close it and run this again.').toBe(false);
      for (const set of overview.sets) expect(inside(copyFolder, set.file)).toBe(true);
      expect(inside(copyFolder, copy)).toBe(true);
      console.log(
        `  ${overview.sets.length} sets, read from copies of ${realFolder}\n` +
          `  For all cars: ${path.relative(copyFolder, copy)}` +
          (overview.source.profile ? ` (control profile "${overview.source.profile}")` : '') +
          (overview.source.oldFiles.length
            ? `\n  Not read by iRacing: ${overview.source.oldFiles.map((f) => path.relative(copyFolder, f)).join(', ')}`
            : '')
      );
    });

    it('takes the real file apart and puts it together again, byte for byte', () => {
      const file = parsed(original, CONTROLS);
      expect(same(encodeControlsFile(file), original)).toBe(true);
      const unread = file.records.filter((r) => !r.understood).map((r) => r.action);
      const bound = file.records.filter((r) => r.binding.kind !== 'none').length;
      console.log(
        `  ${file.records.length} actions, ${bound} bound, ${unread.length} RigReady cannot read` +
          (unread.length ? `: ${unread.join(', ')}` : '')
      );
    });

    it('binds a key: only that record of the copy changes', async () => {
      const action = freeAction(await allCars(), FOR_A_KEY, 'key');
      await changeOne({ set: 'all', action, binding: await unused(action, KEYS) });
    });

    it('binds a button of a controller that is plugged in, with the ids Windows gives it', async () => {
      const started = await ports.input.start();
      expect(started.ok, 'the controllers could not be read').toBe(true);
      const plugged: InputDevice[] = started.ok ? started.value : [];
      const view = await allCars();
      // A controller iRacing already has bindings for, when one is plugged in.
      const known = view.devices.filter((d) => d.kind === 'controller' && d.state === 'connected');
      const device =
        plugged.find((p) => known.some((d) => plain(d.key) === plain(p.guid))) ??
        plugged.find((p) => p.numButtons > 0);
      if (!device) {
        console.log('  No controller with buttons is plugged in: the button was not tried.');
        return;
      }
      const action = freeAction(view, FOR_A_BUTTON, 'button');
      const buttons = Array.from({ length: device.numButtons }, (_, i) => device.numButtons - i);
      const binding = await unused(
        action,
        buttons.map((button): WantedBinding => ({ kind: 'button', device: device.guid, button }))
      );
      await changeOne({ set: 'all', action, binding });
      const record = parsed(await fs.readFile(copy), 'the changed copy').records.find(
        (r) => r.action === action
      )!;
      expect(record.binding).toMatchObject({
        kind: 'button',
        instanceGuid: plain(device.guid),
        productGuid: plain(device.productGuid),
      });
      console.log(`  on ${device.name.trim()}, ${device.numButtons} buttons`);
    });

    it('keeps the file as it was in RigReady’s own folder, and Undo puts it back', async () => {
      const journal = await ports.files.journal();
      expect(journal.ok).toBe(true);
      const entries = (journal.ok ? journal.value : []).filter(
        (entry) => path.resolve(entry.path) === path.resolve(copy)
      );
      expect(entries).toHaveLength(changed.length);
      const backups: Buffer[] = [];
      for (const entry of entries) {
        expect(inside(ports.folders.dataRoot(), entry.backupPath ?? '')).toBe(true);
        backups.push(await fs.readFile(entry.backupPath!));
      }
      expect(
        backups.some((backup) => same(backup, original)),
        'one backup is the file as it was before any change'
      ).toBe(true);
      // Newest first, as on the Safety page.
      const newestFirst = [...entries].sort((a, b) => b.time.localeCompare(a.time));
      for (const entry of newestFirst) {
        expect((await ports.files.undoGroup(entry.groupId!)).ok).toBe(true);
      }
      expect(same(await fs.readFile(copy), original)).toBe(true);
    });

    it('leaves the real files as they were, and keeps a copy for the step after iRacing', async () => {
      expect(await bindingFiles(realFolder)).toEqual([...untouched.keys()]);
      for (const [file, was] of untouched) {
        expect(await fingerprint(path.join(realFolder, file)), file).toBe(was);
      }
      const from = path.relative(copyFolder, copy);
      await fs.mkdir(path.dirname(KEPT), { recursive: true });
      await fs.copyFile(path.join(realFolder, from), KEPT);
      await fs.writeFile(KEPT_FROM, from, 'utf8');
      console.log(`  ${from} as it is now is kept at ${KEPT}`);
    });
  }
);

describe.skipIf(step !== 'after')(
  'the file iRacing saved after it loaded RigReady’s changes (manual, reads only)',
  () => {
    it('differs from the file before in the changed actions only, each as RigReady writes it', async () => {
      const actions = (process.env['RIGREADY_RIG_IRACING_ACTIONS'] ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      expect(
        actions.length,
        'Set RIGREADY_RIG_IRACING_ACTIONS to the ids of the actions that were changed.'
      ).toBeGreaterThan(0);
      expect(await exists(KEPT), `Run the "before" step first: ${KEPT} is not there.`).toBe(true);
      // The same real file the "before" step kept: the control profile for all cars.
      const from = (await exists(KEPT_FROM))
        ? (await fs.readFile(KEPT_FROM, 'utf8')).trim()
        : CONTROLS;
      const realFile = path.join(
        createWindowsPorts({ log: nullLogger, projectRoot }).folders.documents(),
        'iRacing',
        from
      );
      console.log(`  Compares ${realFile} with ${KEPT}`);
      const before = parsed(await fs.readFile(KEPT), 'the copy kept before');
      const now = parsed(await fs.readFile(realFile), realFile);

      // The same actions in the same order, so records can be compared one to one.
      expect(now.records.map((r) => r.action)).toEqual(before.records.map((r) => r.action));
      const moved: ControlRecord[] = [];
      now.records.forEach((record, i) => {
        const was = before.records[i]!;
        if (same(record.data, was.data)) return;
        moved.push(record);
        console.log(
          `  ${record.action} differs at bytes ${differing(was.data, record.data).join(' ')}\n` +
            `    was ${hex(was.data)}\n    now ${hex(record.data)}`
        );
        // The two fields RigReady keeps are kept by iRacing too.
        expect(differing(was.data, record.data)[0]!).toBeGreaterThanOrEqual(KEPT_BYTES);
        // RigReady's writer gives exactly these bytes for the binding iRacing saved.
        expect(record.understood, `${record.action} is as RigReady writes it`).toBe(true);
      });
      const head = differing(before.head, now.head);
      const tail = differing(before.tail, now.tail);
      if (head.length) console.log(`  The header differs at bytes ${head.slice(0, 64).join(' ')}`);
      if (tail.length) console.log(`  The end of the file differs at bytes ${tail.join(' ')}`);

      expect(moved.map((r) => r.action).sort()).toEqual([...actions].sort());
      expect(head, 'the header and its settings').toEqual([]);
      expect(tail, 'the bytes after the last record').toEqual([]);
    });
  }
);
