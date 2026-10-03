import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, scenarioRig, type TestRig } from '../../../../tests/helpers';
import {
  BINDING_FILES,
  HORNET,
  HUEY,
  bindingsFor,
  diffFile,
  inputDir,
  joystickDir,
  useOldBindings,
} from '../../../../tests/dcsBindings';
import type { DcsBindings } from './bindings';
import { applyEdits } from './edits';
import {
  applyRestore,
  compareSnapshots,
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  planRestore,
  renameSnapshot,
} from './snapshots';

let rig: TestRig;
let bindings: DcsBindings;
afterEach(() => rig?.cleanup());

async function start(): Promise<void> {
  rig = await scenarioRig('flying-fresh', { files: BINDING_FILES });
  bindings = bindingsFor(rig);
}

async function deviceSummary(aircraft = HORNET): Promise<Record<string, string[]>> {
  const view = await bindings.view(aircraft);
  if (!view.ok) throw new Error(view.error.message);
  const out: Record<string, string[]> = {};
  for (const device of view.value.devices.filter((d) => d.type === 'joystick')) {
    out[device.name] = device.bindings.map((b) => `${b.label}=${b.commandId}/${b.source}`);
  }
  return out;
}

const STICK = 'WINWING Orion Joystick';

describe('binding snapshots', () => {
  it('copies the chosen aircraft into RigReady with date, DCS version and device ids; lists, renames and deletes', async () => {
    await start();
    const snapshotsDir = path.join(rig.ports.folders.dataRoot(), 'snapshots', 'dcs');
    const created = await createSnapshot(bindings, '  Before the Huey  ', [HORNET]);
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value).toMatchObject({
      id: 'before-the-huey',
      name: 'Before the Huey',
      createdAt: '2026-10-03T12:00:00.000Z',
      dcsVersion: '2.9.28.26283',
      aircraft: [HORNET],
      folders: [HORNET],
      files: 11,
    });
    expect(created.value.bytes).toBeGreaterThan(40_000);
    expect(created.value.devices).toHaveLength(11);
    expect(created.value.devices).toContainEqual({
      name: 'WINWING UFC1 + HUD1',
      guid: '806E0610-B756-11f0-8026-444553540000',
    });
    // The files are byte-for-byte copies under <data root>/snapshots/dcs/<id>/Input/<aircraft>.
    const original = await diffFile(rig.home, STICK);
    expect(
      await fs.readFile(
        path.join(
          snapshotsDir,
          'before-the-huey',
          'Input',
          HORNET,
          'joystick',
          path.basename(original)
        ),
        'utf8'
      )
    ).toBe(await fs.readFile(original, 'utf8'));

    // Everything: also the files directly in the Input folder, and every other folder.
    rig.clock.advance(60_000);
    const all = await createSnapshot(bindings, 'Before the Huey', []);
    if (!all.ok) throw new Error(all.error.message);
    expect(all.value).toMatchObject({ id: 'before-the-huey-2', aircraft: [] });
    expect(all.value.folders).toEqual([HORNET, 'FA-18C_hornet.backup']);
    expect(all.value.files).toBe(18);

    const listed = await listSnapshots(bindings);
    expect(listed.ok && listed.value.map((s) => s.id)).toEqual([
      'before-the-huey-2',
      'before-the-huey',
    ]);
    const renamed = await renameSnapshot(bindings, 'before-the-huey-2', 'Everything, October');
    expect(renamed.ok && renamed.value).toMatchObject({
      id: 'before-the-huey-2',
      name: 'Everything, October',
      files: 18,
    });
    expect(await renameSnapshot(bindings, 'before-the-huey-2', '  ')).toMatchObject({
      ok: false,
      error: { code: 'dcs.snapshot.name' },
    });
    expect((await deleteSnapshot(bindings, 'before-the-huey-2')).ok).toBe(true);
    const after = await listSnapshots(bindings);
    expect(after.ok && after.value.map((s) => s.name)).toEqual(['Before the Huey']);

    // Things that cannot work say so.
    expect(await createSnapshot(bindings, '', [])).toMatchObject({
      ok: false,
      error: { code: 'dcs.snapshot.name' },
    });
    expect(await createSnapshot(bindings, 'Huey', [HUEY])).toMatchObject({
      ok: false,
      error: {
        code: 'dcs.snapshot.empty',
        message: expect.stringContaining('they are on DCS defaults'),
      },
    });
    expect(await deleteSnapshot(bindings, 'nope')).toMatchObject({ ok: false });
    expect(await renameSnapshot(bindings, 'nope', 'x')).toMatchObject({ ok: false });
    await fs.mkdir(path.join(snapshotsDir, 'damaged'), { recursive: true });
    await fs.writeFile(path.join(snapshotsDir, 'damaged', 'snapshot.json'), '{ not json');
    expect(await planRestore(bindings, 'damaged', true)).toMatchObject({
      ok: false,
      error: { code: 'dcs.snapshot.invalid' },
    });
    await fs.writeFile(path.join(snapshotsDir, 'damaged', 'snapshot.json'), '{"name": 5}');
    expect(await compareSnapshots(bindings, 'damaged', undefined)).toMatchObject({ ok: false });
    // A damaged snapshot does not hide the good ones.
    const still = await listSnapshots(bindings);
    expect(still.ok && still.value).toHaveLength(1);
  });

  it('restores a snapshot through a preview and FileStore, and the per-device view matches it afterwards', async () => {
    await start();
    const before = await deviceSummary();
    const created = await createSnapshot(bindings, 'Good', [HORNET]);
    if (!created.ok) throw new Error(created.error.message);

    // Then things change: a device is cleared, a file is deleted, and a new one appears.
    const view = await bindings.view(HORNET);
    if (!view.ok) throw new Error(view.error.message);
    const stick = view.value.devices.find((d) => d.name.startsWith(STICK))!;
    const wheel = view.value.devices.find((d) => d.name.startsWith('FANATEC'))!;
    const pitch = view.value.commands.find((c) => c.name === 'Pitch')!;
    expect(
      (
        await applyEdits(bindings, [
          { op: 'clearDevice', aircraft: HORNET, deviceId: stick.id },
          {
            op: 'unbind',
            aircraft: HORNET,
            deviceId: wheel.id,
            commandId: pitch.id,
            combo: { key: 'JOY_Y', reformers: [] },
          },
        ])
      ).ok
    ).toBe(true);
    const ufc = await diffFile(rig.home, 'WINWING UFC1');
    await fs.rm(ufc);
    expect(await deviceSummary()).not.toEqual(before);

    // The difference between the snapshot and now, per device, in words.
    const comparison = await compareSnapshots(bindings, created.value.id, undefined);
    if (!comparison.ok) throw new Error(comparison.error.message);
    expect(comparison.value).toMatchObject({
      left: 'Good',
      right: 'Current bindings',
      identical: 9,
    });
    expect(comparison.value.devices.map((d) => d.device)).toEqual([
      'FANATEC Podium Wheel Base DD2',
      'WINWING Orion Joystick Base 2 + JGRIP-F16',
      'WINWING UFC1 + HUD1',
    ]);
    const [fanatec, orion, ufcDiff] = comparison.value.devices;
    expect(fanatec).toMatchObject({
      folder: HORNET,
      added: ["Pitch: DCS's default Y axis cancelled"],
      removed: [],
    });
    expect(orion!.removed).toEqual(
      expect.arrayContaining([
        'Gun Trigger - SECOND DETENT (Press to shoot): Button 5',
        'Pitch: curve of Y axis',
      ])
    );
    expect(orion!.added).toContain("Roll: DCS's default X axis cancelled");
    expect(ufcDiff!.removed.length).toBeGreaterThan(50);
    expect(ufcDiff!.added).toEqual([]);

    const plan = await planRestore(bindings, created.value.id, true);
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value.summary).toBe('Restore binding snapshot "Good"');
    expect(plan.value.notes).toEqual([]);
    expect(plan.value.files.map((f) => [f.action, f.title]).sort()).toEqual([
      ['change', `${HORNET}/joystick/${path.basename(await diffFile(rig.home, STICK))}`],
      ['create', `${HORNET}/joystick/${path.basename(ufc)}`],
      [
        'delete',
        `${HORNET}/joystick/FANATEC Podium Wheel Base DD2 {20B0BED0-03A4-11f1-8001-444553540000}.diff.lua`,
      ],
    ]);

    const applied = await applyRestore(bindings, created.value.id, true);
    if (!applied.ok) throw new Error(applied.error.message);
    expect(await deviceSummary()).toEqual(before);
    const same = await compareSnapshots(bindings, created.value.id, undefined);
    expect(same.ok && same.value).toMatchObject({ devices: [], identical: 11 });
    // Backed up and journaled as one action that can be undone.
    const groups = await rig.ports.files.journalGroups();
    expect(groups.ok && groups.value[0]).toMatchObject({
      id: applied.value.groupId,
      reason: 'Restore binding snapshot "Good"',
    });
    expect(groups.ok && groups.value[0]!.entries).toHaveLength(3);
    // Restoring again: nothing to do.
    expect(await applyRestore(bindings, created.value.id, true)).toMatchObject({
      ok: false,
      error: { code: 'dcs.nothingToDo' },
    });
    // Not while DCS runs.
    await fs.rm(ufc);
    await mutate(rig, [{ op: 'startProcess', name: 'DCS.exe', path: 'C:\\DCS\\bin\\DCS.exe' }]);
    expect(await applyRestore(bindings, created.value.id, true)).toMatchObject({
      ok: false,
      error: { code: 'dcs.running' },
    });
  });

  it('a snapshot made under old device ids is restored under the attached devices ids instead of as orphaned files', async () => {
    await start();
    // A snapshot from "the old PC": both aircraft, old ids, and a modifier on the old stick id.
    await useOldBindings(rig.home, HORNET);
    await useOldBindings(rig.home, HUEY);
    const oldStick =
      'WINWING Orion Joystick Base 2 + JGRIP-F16 {D3437B70-A035-11EE-8001-444553540000}';
    const newStick =
      'WINWING Orion Joystick Base 2 + JGRIP-F16 {806DDF00-B756-11f0-8023-444553540000}';
    await fs.writeFile(
      path.join(inputDir(rig.home), HUEY, 'modifiers.lua'),
      `local modifiers = {\n\t["JOY_BTN3"] = {\n\t\t["device"] = "${oldStick}",\n\t\t["key"] = "JOY_BTN3",\n\t\t["switch"] = false,\n\t},\n}\nreturn modifiers`
    );
    const created = await createSnapshot(bindings, 'Old PC', [HORNET, HUEY]);
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value.files).toBe(21);
    // On the new PC there is nothing yet.
    await fs.rm(path.join(inputDir(rig.home), HORNET), { recursive: true });
    await fs.rm(path.join(inputDir(rig.home), HUEY), { recursive: true });

    // By default the restore goes to the current ids, and says so.
    const plan = await planRestore(bindings, created.value.id, true);
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value.notes).toEqual([
      '10 devices have a different device ID now than in this snapshot. Their files are restored under the current IDs, so DCS finds them.',
    ]);
    expect(plan.value.files).toHaveLength(21);
    expect(plan.value.files.every((f) => f.action === 'create')).toBe(true);
    expect(plan.value.files.some((f) => f.path.includes('D3437B70'))).toBe(false);

    // The user can ask for the snapshot's own ids; then it warns that DCS will not find them.
    const literal = await planRestore(bindings, created.value.id, false);
    expect(literal.ok && literal.value.notes[0]).toMatch(
      /^10 devices have a different device ID now.*restored under the old IDs, where DCS will not find them/
    );
    expect(literal.ok && literal.value.files.some((f) => f.path.includes('D3437B70'))).toBe(true);

    expect((await applyRestore(bindings, created.value.id, true)).ok).toBe(true);
    for (const aircraft of [HORNET, HUEY]) {
      const names = await fs.readdir(joystickDir(rig.home, aircraft));
      expect(names).toHaveLength(10);
      expect(names).toContain(`${newStick}.diff.lua`);
    }
    expect(
      await fs.readFile(path.join(inputDir(rig.home), HUEY, 'modifiers.lua'), 'utf8')
    ).toContain(`["device"] = "${newStick}"`);
    const view = await bindings.view(HORNET);
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value.devices.filter((d) => !d.connected)).toEqual([]);
    expect(view.value.devices.find((d) => d.name.startsWith(STICK))!.file.source).toBe('user');
    // Compared by device name, the snapshot and the restored bindings are the same.
    const same = await compareSnapshots(bindings, created.value.id, undefined);
    expect(same.ok && same.value.devices).toEqual([]);
  });

  it('compares two snapshots', async () => {
    await start();
    const first = await createSnapshot(bindings, 'First', [HORNET]);
    const view = await bindings.view(HORNET);
    if (!view.ok || !first.ok) throw new Error('setup');
    const stick = view.value.devices.find((d) => d.name.startsWith(STICK))!;
    const arm = view.value.commands.find((c) => c.name === 'Master Arm Switch - ARM/SAFE')!;
    const pitch = view.value.commands.find((c) => c.name === 'Pitch')!;
    await applyEdits(bindings, [
      {
        op: 'bind',
        aircraft: HORNET,
        deviceId: stick.id,
        commandId: arm.id,
        combo: { key: 'JOY_BTN20', reformers: [] },
      },
      {
        op: 'setFilter',
        aircraft: HORNET,
        deviceId: stick.id,
        commandId: pitch.id,
        combo: { key: 'JOY_Y', reformers: [] },
        filter: {
          ...stick.bindings.find((b) => b.combo.key === 'JOY_Y')!.combo.filter!,
          invert: true,
        },
      },
    ]);
    rig.clock.advance(1000);
    const second = await createSnapshot(bindings, 'Second', [HORNET]);
    if (!second.ok) throw new Error(second.error.message);
    const comparison = await compareSnapshots(bindings, first.value.id, second.value.id);
    expect(comparison.ok && comparison.value).toEqual({
      left: 'First',
      right: 'Second',
      identical: 10,
      devices: [
        {
          folder: HORNET,
          device: 'WINWING Orion Joystick Base 2 + JGRIP-F16',
          added: ['Master Arm Switch - ARM/SAFE: Button 20'],
          removed: ['Weapon Release Button: Button 20'],
          changed: ['Pitch: curve of Y axis'],
        },
      ],
    });
    expect(await compareSnapshots(bindings, first.value.id, 'nope')).toMatchObject({ ok: false });
  });
});
