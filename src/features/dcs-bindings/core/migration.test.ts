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
  fixtureData,
  inputDir,
  joystickDir,
  useOldBindings,
} from '../../../../tests/dcsBindings';
import type { DcsBindings } from './bindings';
import { listenForInput, type PressedInput } from './capture';
import {
  applyMigration,
  mergeDiffText,
  planMigration,
  proposedMappings,
  scanMigration,
  type Mapping,
  type MigrationScan,
} from './migration';

let rig: TestRig;
let bindings: DcsBindings;
afterEach(() => rig?.cleanup());

async function start(scenario = 'flying-fresh'): Promise<void> {
  rig = await scenarioRig(scenario, { files: BINDING_FILES });
  bindings = bindingsFor(rig);
}

async function scan(): Promise<MigrationScan> {
  const result = await scanMigration(bindings);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const OLD_STICK =
  'WINWING Orion Joystick Base 2 + JGRIP-F16 {D3437B70-A035-11EE-8001-444553540000}';
const NEW_STICK =
  'WINWING Orion Joystick Base 2 + JGRIP-F16 {806DDF00-B756-11f0-8023-444553540000}';

describe('detecting device id changes', () => {
  it('finds nothing on the rig as recorded, and does not call an unplugged device a changed id', async () => {
    await start();
    expect((await scan()).orphans).toEqual([]);
    await mutate(rig, [{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
    const unplugged = await scan();
    expect(unplugged.orphans).toHaveLength(1);
    expect(unplugged.orphans[0]).toMatchObject({
      name: 'T-Pendular-Rudder',
      status: 'unplugged',
      candidates: [],
    });
    // Both the live folder and the owner's manual backup folder hold a file for the pedals.
    expect(unplugged.orphans[0]!.files.map((f) => f.folder).sort()).toEqual([
      'FA-18C_hornet',
      'FA-18C_hornet.backup',
    ]);
    expect(proposedMappings(unplugged)).toEqual([]);
  });

  it("lists all ten devices of the owner's older backup with their old and new ids", async () => {
    await start();
    await useOldBindings(rig.home, HORNET);
    const found = await scan();
    const stale = found.orphans.filter((o) => o.files.some((f) => f.folder === HORNET));
    expect(stale).toHaveLength(10);
    expect(stale.every((o) => o.status === 'ready' && o.candidates.length === 1)).toBe(true);
    const ids = Object.fromEntries(stale.map((o) => [o.name, [o.oldGuid, o.proposed]]));
    expect(ids).toEqual({
      'R-VPC Panel #1': [
        '4BB05F90-9AA7-11ee-8021-444553540000',
        'DF6F4BD0-FA0C-11f0-8002-444553540000',
      ],
      'T-Pendular-Rudder': [
        '4770BA10-9AA7-11ee-801C-444553540000',
        '7F3956A0-B756-11f0-801B-444553540000',
      ],
      'WINWING F18 STARTUP PANEL': [
        '4B36E9D0-9AA7-11ee-801D-444553540000',
        '806D90E0-B756-11f0-801E-444553540000',
      ],
      'WINWING F18 TAKEOFF PANEL 2': [
        '4F222DC0-9AA7-11ee-8024-444553540000',
        '806E0610-B756-11f0-8025-444553540000',
      ],
      'WINWING MFD1-C': [
        '4F916A50-9AA7-11ee-8027-444553540000',
        '806DDF00-B756-11f0-8021-444553540000',
      ],
      'WINWING MFD1-L': [
        '4B3710E0-9AA7-11ee-801E-444553540000',
        '7F3956A0-B756-11f0-801A-444553540000',
      ],
      'WINWING MFD1-R': [
        '5206D720-9AA7-11ee-8028-444553540000',
        '806E0610-B756-11f0-8024-444553540000',
      ],
      'WINWING Orion Joystick Base 2 + JGRIP-F16': [
        'D3437B70-A035-11ee-8001-444553540000',
        '806DDF00-B756-11f0-8023-444553540000',
      ],
      'WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R': [
        '4F6FD890-9AA7-11ee-8026-444553540000',
        '806DDF00-B756-11f0-8022-444553540000',
      ],
      'WINWING UFC1 + HUD1': [
        '4F2206B0-9AA7-11ee-8023-444553540000',
        '806E0610-B756-11f0-8026-444553540000',
      ],
    });
    // The attached devices now have no bindings of the user's.
    const view = await bindings.view(HORNET);
    expect(
      view.ok &&
        view.value.devices
          .filter((d) => d.connected && d.type === 'joystick')
          .every((d) => d.file.source !== 'user')
    ).toBe(true);
  });
});

describe('migrating', () => {
  async function arrange(): Promise<{ modifiers: string; disabled: string; wizard: string }> {
    await start();
    await useOldBindings(rig.home, HORNET);
    await useOldBindings(rig.home, HUEY);
    const modifiers = path.join(inputDir(rig.home), HORNET, 'modifiers.lua');
    await fs.writeFile(
      modifiers,
      `local modifiers = {\n\t["JOY_BTN3"] = {\n\t\t["device"] = "${OLD_STICK}",\n\t\t["key"] = "JOY_BTN3",\n\t\t["switch"] = false,\n\t},\n\t["LCtrl"] = {\n\t\t["device"] = "Keyboard",\n\t\t["key"] = "LCtrl",\n\t\t["switch"] = false,\n\t},\n}\nreturn modifiers`
    );
    const disabled = path.join(inputDir(rig.home), 'disabled.lua');
    await fs.writeFile(
      disabled,
      `local disabled = {\n\t["devices"] = {\n\t\t["${OLD_STICK.replace('11EE', '11ee')}"] = true,\n\t},\n\t["pnp"] = false,\n}\nreturn disabled`
    );
    const wizard = path.join(inputDir(rig.home), 'wizard.lua');
    await fs.writeFile(
      wizard,
      `local wizard = {\n\t["${OLD_STICK}"] = {\n\t\t["pitch"] = {\n\t\t\t["key"] = "JOY_Y",\n\t\t},\n\t},\n}\nreturn wizard`
    );
    return { modifiers, disabled, wizard };
  }

  it('flags a modifier that is a button on a device id that is not attached', async () => {
    const { modifiers } = await arrange();
    const view = await bindings.view(HORNET);
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value.modifiers).toEqual([
      {
        name: 'JOY_BTN3',
        key: 'JOY_BTN3',
        device: OLD_STICK,
        label: 'Button 3 on WINWING Orion Joystick Base 2 + JGRIP-F16',
        isSwitch: false,
        deviceConnected: false,
        fromUser: true,
      },
      {
        name: 'LCtrl',
        key: 'LCtrl',
        device: 'Keyboard',
        label: 'LCtrl',
        isSwitch: false,
        deviceConnected: true,
        fromUser: true,
      },
    ]);
    // The stale id is part of what migration will fix.
    const stick = (await scan()).orphans.find((o) => o.name.includes('Orion'))!;
    expect(stick.references).toContain(modifiers);

    // A binding that uses the device-button modifier is shown with the button and its device.
    const pedals = await diffFile(rig.home, 'T-Pendular-Rudder');
    const text = await fs.readFile(pedals, 'utf8');
    await fs.writeFile(
      pedals,
      text.replace(
        '}\nreturn diff',
        '\t["keyDiffs"] = {\n\t\t["d3003pnilu3003cd13vd1vpnilvu0"] = {\n\t\t\t["added"] = {\n\t\t\t\t[1] = {\n\t\t\t\t\t["key"] = "JOY_BTN1",\n\t\t\t\t\t["reformers"] = {\n\t\t\t\t\t\t[1] = "JOY_BTN3",\n\t\t\t\t\t},\n\t\t\t\t},\n\t\t\t},\n\t\t\t["name"] = "Weapon Release Button",\n\t\t},\n\t},\n}\nreturn diff'
      )
    );
    const again = await bindings.view(HORNET);
    if (!again.ok) throw new Error(again.error.message);
    const labels = again.value.devices.flatMap((d) => d.bindings.map((b) => b.label));
    expect(labels).toContain('Button 3 on WINWING Orion Joystick Base 2 + JGRIP-F16 + Button 1');
  });

  it('renames every file in every aircraft folder and rewrites the ids in modifiers, disabled and wizard files, as one undoable change', async () => {
    const { modifiers, disabled, wizard } = await arrange();
    const before = await scan();
    const mappings = proposedMappings(before);
    expect(mappings).toHaveLength(10);

    const plan = await planMigration(bindings, mappings);
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value.summary).toBe(
      'Move bindings of 10 devices to their current device IDs (20 files)'
    );
    // Every rename is listed with where it goes, plus the three files whose contents change.
    const renames = plan.value.files.filter((f) => f.action === 'rename');
    expect(renames).toHaveLength(20);
    expect(renames.find((f) => f.path.includes('Orion') && f.path.includes(HUEY))).toMatchObject({
      path: path.join(joystickDir(rig.home, HUEY), `${OLD_STICK}.diff.lua`),
      to: path.join(joystickDir(rig.home, HUEY), `${NEW_STICK}.diff.lua`),
      title: 'WINWING Orion Joystick Base 2 + JGRIP-F16 · UH-1H',
      lines: ["Rename to the attached device's id 806DDF00-B756-11f0-8023-444553540000"],
    });
    const rewrites = plan.value.files.filter((f) => f.action === 'change');
    expect(rewrites.map((f) => path.basename(f.path)).sort()).toEqual([
      'disabled.lua',
      'modifiers.lua',
      'wizard.lua',
    ]);
    expect(rewrites[0]!.diff.some((l) => l.type === 'add' && l.text.includes(NEW_STICK))).toBe(
      true
    );
    expect(plan.value.blocked).toBeUndefined();

    // Nothing has moved yet.
    expect((await fs.readdir(joystickDir(rig.home))).every((f) => !f.includes('806D'))).toBe(true);
    const originalModifiers = await fs.readFile(modifiers, 'utf8');

    const applied = await applyMigration(bindings, mappings);
    if (!applied.ok) throw new Error(applied.error.message);
    expect(applied.value.files).toBe(23);
    for (const aircraft of [HORNET, HUEY]) {
      const names = await fs.readdir(joystickDir(rig.home, aircraft));
      expect(names).toHaveLength(10);
      expect(names).toContain(`${NEW_STICK}.diff.lua`);
      expect(names.some((n) => n.includes('9AA7') || n.includes('A035'))).toBe(false);
    }
    // File contents are untouched by a rename.
    expect(
      await fs.readFile(path.join(joystickDir(rig.home), `${NEW_STICK}.diff.lua`), 'utf8')
    ).toBe(
      await fs.readFile(
        path.join(fixtureData, 'old-ids', HORNET, 'joystick', `${OLD_STICK}.diff.lua`),
        'utf8'
      )
    );
    expect(await fs.readFile(modifiers, 'utf8')).toBe(
      originalModifiers.replace(OLD_STICK, NEW_STICK)
    );
    expect(await fs.readFile(disabled, 'utf8')).toContain(`["${NEW_STICK}"] = true`);
    expect(await fs.readFile(wizard, 'utf8')).toContain(`["${NEW_STICK}"] = {`);

    // The attached devices have their bindings back.
    expect((await scan()).orphans).toEqual([]);
    const view = await bindings.view(HORNET);
    if (!view.ok) throw new Error(view.error.message);
    const stick = view.value.devices.find((d) => d.name.includes('Orion'))!;
    expect(stick).toMatchObject({ connected: true, file: { source: 'user' } });
    expect(stick.counts.fromUser).toBeGreaterThan(15);
    expect(view.value.devices.filter((d) => !d.connected)).toEqual([]);
    expect(view.value.modifiers[0]).toMatchObject({ device: NEW_STICK, deviceConnected: true });

    // One journal group; undoing it puts all 23 files back.
    const groups = await rig.ports.files.journalGroups();
    if (!groups.ok) throw new Error('journal');
    expect(groups.value[0]).toMatchObject({
      id: applied.value.groupId,
      reason: plan.value.summary,
    });
    expect((await rig.ports.files.undoGroup(applied.value.groupId)).ok).toBe(true);
    expect(await fs.readdir(joystickDir(rig.home))).toContain(`${OLD_STICK}.diff.lua`);
    expect(await fs.readFile(modifiers, 'utf8')).toBe(originalModifiers);
    expect((await scan()).orphans).toHaveLength(10);
  });

  it('when a file for the new id already exists the user chooses keep, replace or merge', async () => {
    await start();
    // The current stick file stays; the older one from the backup is added next to it.
    const current = await diffFile(rig.home, 'WINWING Orion Joystick');
    const currentText = await fs.readFile(current, 'utf8');
    const old = path.join(joystickDir(rig.home), `${OLD_STICK}.diff.lua`);
    // In the old file the trigger was on Button 41, which the current file does not mention.
    const oldText = (
      await fs.readFile(
        path.join(fixtureData, 'old-ids', HORNET, 'joystick', `${OLD_STICK}.diff.lua`),
        'utf8'
      )
    ).replace('"JOY_BTN5"', '"JOY_BTN41"');
    await fs.writeFile(old, oldText);
    const found = await scan();
    expect(found.orphans).toHaveLength(1);
    expect(found.orphans[0]).toMatchObject({ status: 'ready' });
    expect(found.orphans[0]!.candidates[0]!.ownFiles).toBe(1);
    const mappings = (onConflict: Mapping['onConflict']): Mapping[] => [
      { from: found.orphans[0]!.id, toGuid: found.orphans[0]!.proposed!, onConflict },
    ];

    // keep: nothing to do, and the plan says why.
    const keep = await planMigration(bindings, mappings('keep'));
    expect(keep.ok && keep.value.files).toEqual([]);
    expect(keep.ok && keep.value.notes[0]).toMatch(
      /already has a binding file under its current id/
    );
    expect(await applyMigration(bindings, mappings('keep'))).toMatchObject({
      ok: false,
      error: { code: 'dcs.nothingToDo' },
    });

    // merge: bindings from the old file are added where the current file says nothing about the input.
    const merge = await planMigration(bindings, mappings('merge'));
    if (!merge.ok) throw new Error(merge.error.message);
    expect(merge.value.files.map((f) => f.action)).toEqual(['change', 'delete']);
    const merged = mergeDiffText(currentText, oldText);
    if (!merged.ok) throw new Error(merged.error.message);
    // Everything both files speak about stays as the current file has it; only Button 41 is new.
    expect(merged.value.match(/"JOY_BTN5"/g)).toHaveLength(
      currentText.match(/"JOY_BTN5"/g)!.length
    );
    expect(currentText).not.toContain('"JOY_BTN41"');
    expect(merged.value).toContain(
      [
        '\t\t\t\t[2] = {',
        '\t\t\t\t\t["key"] = "JOY_BTN41",',
        '\t\t\t\t},',
        '\t\t\t},',
        '\t\t\t["name"] = "Gun Trigger - SECOND DETENT (Press to shoot)",',
      ].join('\n')
    );
    const applied = await applyMigration(bindings, mappings('merge'));
    if (!applied.ok) throw new Error(applied.error.message);
    expect(await fs.readFile(current, 'utf8')).toBe(merged.value);
    await expect(fs.access(old)).rejects.toThrow();
    expect((await rig.ports.files.undoGroup(applied.value.groupId)).ok).toBe(true);

    // replace: the old bindings take the place of the current file (which is backed up).
    const replaced = await applyMigration(bindings, mappings('replace'));
    if (!replaced.ok) throw new Error(replaced.error.message);
    expect(await fs.readFile(current, 'utf8')).toBe(oldText);
    await expect(fs.access(old)).rejects.toThrow();
    const groups = await rig.ports.files.journalGroups();
    const backup = groups.ok ? groups.value[0]!.entries.find((e) => e.path === current) : undefined;
    expect(await fs.readFile(backup!.backupPath!, 'utf8')).toBe(currentText);
  });

  it('refuses while DCS is running, and refuses a target that is not that kind of device', async () => {
    await start();
    await useOldBindings(rig.home, HORNET);
    const found = await scan();
    const stick = found.orphans.find((o) => o.name.includes('Orion'))!;
    const pedals = found.orphans.find((o) => o.name === 'T-Pendular-Rudder')!;
    expect(
      await planMigration(bindings, [
        { from: stick.id, toGuid: pedals.proposed!, onConflict: 'keep' },
      ])
    ).toMatchObject({ ok: false, error: { code: 'dcs.migration.target' } });
    expect(
      await planMigration(bindings, [
        { from: 'Nothing {00000000-0000-0000-0000-000000000000}', toGuid: 'x', onConflict: 'keep' },
      ])
    ).toMatchObject({ ok: false, error: { code: 'dcs.migration.unknown' } });

    await mutate(rig, [{ op: 'startProcess', name: 'DCS.exe', path: 'C:\\DCS\\bin\\DCS.exe' }]);
    const plan = await planMigration(bindings, proposedMappings(found));
    expect(plan.ok && plan.value.blocked).toMatch(/DCS is running/);
    expect(await applyMigration(bindings, proposedMappings(found))).toMatchObject({
      ok: false,
      error: { code: 'dcs.running' },
    });
    expect(await fs.readdir(joystickDir(rig.home))).toContain(`${OLD_STICK}.diff.lua`);
  });

  it('uses the registry to tell which model an old id was, when Windows still remembers it', async () => {
    await start();
    // The Virpil panel's first calibration slot (…8001) is still in the registry; its file was
    // written under that id, and the panel now has …8002.
    const dir = joystickDir(rig.home);
    const now = (await fs.readdir(dir)).find((f) => f.startsWith('R-VPC'))!;
    const stale = 'R-VPC Panel #1 {DF6F4BD0-FA0C-11f0-8001-444553540000}.diff.lua';
    await fs.rename(path.join(dir, now), path.join(dir, stale));
    const found = await scan();
    expect(found.orphans).toHaveLength(1);
    expect(found.orphans[0]).toMatchObject({
      status: 'ready',
      oldGuid: 'DF6F4BD0-FA0C-11f0-8001-444553540000',
      proposed: 'DF6F4BD0-FA0C-11f0-8002-444553540000',
      candidates: [{ vendorId: '3344', productId: 'C259', nameChanged: false }],
    });
  });
});

describe('identical devices', () => {
  it('never guesses between three identical MFD panels: each old file goes to the device whose button was pressed', async () => {
    await start();
    // Three panels that report the same name, as WinWing MFD frames without the L/C/R suffix do.
    const state = rig.ports.state;
    const mfds = state.input.filter((d) => d.name.startsWith('WINWING MFD1-'));
    expect(mfds).toHaveLength(3);
    for (const mfd of mfds) mfd.name = 'WINWING MFD1';
    const dir = joystickDir(rig.home);
    for (const file of await fs.readdir(dir)) {
      if (file.startsWith('WINWING MFD1-')) await fs.rm(path.join(dir, file));
    }
    const old = ['AAAAAAA1', 'AAAAAAA2', 'AAAAAAA3'].map(
      (start) => `WINWING MFD1 {${start}-9AA7-11ee-8027-444553540000}`
    );
    const source = await fs.readFile(
      path.join(
        fixtureData,
        'old-ids',
        HORNET,
        'joystick',
        'WINWING MFD1-L {4B3710E0-9AA7-11EE-801E-444553540000}.diff.lua'
      ),
      'utf8'
    );
    for (const [index, id] of old.entries()) {
      await fs.writeFile(
        path.join(dir, `${id}.diff.lua`),
        source.replace('PB 5', `PB 5 (${index})`)
      );
    }

    const everything = await scan();
    // (The owner's manual backup folder still has a file under the centre panel's old name: a
    // changed name is never moved without asking either.)
    expect(everything.orphans.find((o) => o.name === 'WINWING MFD1-C')).toMatchObject({
      status: 'choose',
      candidates: [{ name: 'WINWING MFD1', nameChanged: true }],
    });
    const found = {
      ...everything,
      orphans: everything.orphans.filter((o) => o.name === 'WINWING MFD1'),
    };
    expect(found.orphans).toHaveLength(3);
    for (const orphan of found.orphans) {
      expect(orphan.status).toBe('choose');
      expect(orphan.proposed).toBeUndefined();
      expect(orphan.candidates).toHaveLength(3);
      expect(orphan.reason).toBe(
        '3 attached devices are called "WINWING MFD1". Press a button on the one these bindings belong to.'
      );
    }
    expect(proposedMappings(found)).toEqual([]);

    // The user presses a button on a panel for each old file, in the order right, left, centre.
    const pressed: PressedInput[] = [];
    const stop = listenForInput(rig.ports.input, (p) => pressed.push(p));
    const idle = (index: number, down: boolean) => ({
      index,
      name: 'WINWING MFD1',
      axes: [0],
      buttons: Array.from({ length: 50 }, (_, i) => down && i === 6),
      hats: [] as [number, number][],
      timestamp: 1,
    });
    const order = [mfds[2]!, mfds[1]!, mfds[0]!];
    for (const mfd of order) rig.ports.input.emit([idle(mfd.index, false)]);
    for (const mfd of order) {
      rig.ports.input.emit([idle(mfd.index, true)]);
      rig.ports.input.emit([idle(mfd.index, false)]);
    }
    stop();
    expect(pressed.map((p) => p.key)).toEqual(['JOY_BTN7', 'JOY_BTN7', 'JOY_BTN7']);
    expect(new Set(pressed.map((p) => p.guid)).size).toBe(3);

    const mappings: Mapping[] = found.orphans.map((orphan, index) => ({
      from: orphan.id,
      toGuid: pressed[index]!.guid,
      onConflict: 'keep',
    }));
    const applied = await applyMigration(bindings, mappings);
    if (!applied.ok) throw new Error(applied.error.message);
    for (const [index, orphan] of found.orphans.entries()) {
      const target = path.join(dir, `WINWING MFD1 {${pressed[index]!.guid}}.diff.lua`);
      const text = await fs.readFile(target, 'utf8');
      const which = old.indexOf(orphan.id);
      expect(text).toContain(`PB 5 (${which})`);
    }
    expect((await scan()).orphans.filter((o) => o.name === 'WINWING MFD1')).toEqual([]);
  });

  it('two old ids for one device are not both moved onto it without the user choosing', async () => {
    await start();
    const dir = joystickDir(rig.home);
    const current = (await fs.readdir(dir)).find((f) => f.startsWith('WINWING ICP'))!;
    const text = await fs.readFile(path.join(dir, current), 'utf8');
    await fs.rm(path.join(dir, current));
    const a = 'WINWING ICP {AAAAAAA1-9AA7-11ee-8027-444553540000}';
    const b = 'WINWING ICP {AAAAAAA2-9AA7-11ee-8027-444553540000}';
    await fs.writeFile(path.join(dir, `${a}.diff.lua`), text);
    await fs.writeFile(path.join(dir, `${b}.diff.lua`), text);
    const found = await scan();
    expect(found.orphans.map((o) => [o.status, o.reason])).toEqual([
      [
        'choose',
        '2 old device IDs could belong to this device. Choose which bindings to move to it.',
      ],
      [
        'choose',
        '2 old device IDs could belong to this device. Choose which bindings to move to it.',
      ],
    ]);
    const guid = found.orphans[0]!.candidates[0]!.guid;
    // Asking for both anyway moves the first and leaves the second where it is, with a note.
    const plan = await planMigration(bindings, [
      { from: a, toGuid: guid, onConflict: 'keep' },
      { from: b, toGuid: guid, onConflict: 'keep' },
    ]);
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value.files).toHaveLength(1);
    expect(plan.value.notes[0]).toMatch(/another old file is already being moved to WINWING ICP/);
  });
});
