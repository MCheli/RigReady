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
  joystickDir,
} from '../../../../tests/dcsBindings';
import type { DcsBindings } from './bindings';
import { PlanBuilder, executePlan } from './changes';
import { applyEdits, cleanupOps, planEdits, type BindingOp } from './edits';
import type { AircraftView, DeviceView } from './model';

let rig: TestRig;
let bindings: DcsBindings;
afterEach(() => rig?.cleanup());

async function start(): Promise<void> {
  rig = await scenarioRig('flying-fresh', { files: BINDING_FILES });
  bindings = bindingsFor(rig);
}

async function view(aircraft = HORNET): Promise<AircraftView> {
  const result = await bindings.view(aircraft);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const device = (v: AircraftView, prefix: string): DeviceView =>
  v.devices.find((d) => d.name.startsWith(prefix))!;

const command = (v: AircraftView, name: string): string => {
  const found = v.commands.find((c) => c.name === name);
  if (!found) throw new Error(`no action "${name}"`);
  return found.id;
};

const on = (v: AircraftView, d: DeviceView, key: string): string[] =>
  d.bindings
    .filter((b) => b.combo.key === key && !b.inert)
    .map((b) => v.commands.find((c) => c.id === b.commandId)!.name);

async function apply(ops: BindingOp[], summary?: string): Promise<void> {
  const applied = await applyEdits(bindings, ops, summary);
  if (!applied.ok) throw new Error(`${applied.error.code} ${applied.error.message}`);
}

const STICK = 'WINWING Orion Joystick';

describe('editing button bindings', () => {
  it('removing a user binding deletes its added entry; removing a default writes a removed entry', async () => {
    await start();
    const before = await view();
    const stick = device(before, STICK);
    const file = await diffFile(rig.home, STICK);
    expect(on(before, stick, 'JOY_BTN19')).toEqual(['View Center']);
    expect(on(before, stick, 'JOY_BTN_POV1_UR')).toEqual(['View Up Right slow']);

    const ops: BindingOp[] = [
      {
        op: 'unbind',
        aircraft: HORNET,
        deviceId: stick.id,
        commandId: command(before, 'View Center'),
        combo: { key: 'JOY_BTN19', reformers: [] },
      },
      {
        op: 'unbind',
        aircraft: HORNET,
        deviceId: stick.id,
        commandId: command(before, 'View Up Right slow'),
        combo: { key: 'JOY_BTN_POV1_UR', reformers: [] },
      },
    ];
    const plan = await planEdits(bindings, ops);
    expect(plan.ok && plan.value).toMatchObject({
      summary: 'Change 2 bindings for F/A-18C',
      files: [
        {
          path: file,
          action: 'change',
          title: 'WINWING Orion Joystick Base 2 + JGRIP-F16 · F/A-18C',
          lines: [
            'View Center: remove Button 19',
            "View Up Right slow: cancel DCS's default Hat 1 up-right",
          ],
        },
      ],
    });
    // The preview shows the exact lines that go and come.
    const diff = plan.ok ? plan.value.files[0]!.diff : [];
    expect(diff.filter((l) => l.type === 'del').map((l) => l.text.trim())).toContain(
      '["key"] = "JOY_BTN19",'
    );
    expect(diff.filter((l) => l.type === 'add').map((l) => l.text.trim())).toContain(
      '["key"] = "JOY_BTN_POV1_UR",'
    );
    // Planning writes nothing.
    const original = await fs.readFile(file, 'utf8');

    await apply(ops);
    const text = await fs.readFile(file, 'utf8');
    expect(text).not.toBe(original);
    // The other View Center button stays, as the only added combo, renumbered.
    expect(text).toContain(
      [
        '\t\t["dnilp36unilcdnilvdnilvpnilvunil"] = {',
        '\t\t\t["added"] = {',
        '\t\t\t\t[1] = {',
        '\t\t\t\t\t["key"] = "JOY_BTN36",',
        '\t\t\t\t},',
        '\t\t\t},',
        '\t\t\t["name"] = "View Center",',
        '\t\t},',
      ].join('\n')
    );
    // The default is cancelled the way DCS writes it: name, then removed, with only the key.
    expect(text).toContain(
      [
        '\t\t\t["name"] = "View Up Right slow",',
        '\t\t\t["removed"] = {',
        '\t\t\t\t[1] = {',
        '\t\t\t\t\t["key"] = "JOY_BTN_POV1_UR",',
        '\t\t\t\t},',
        '\t\t\t},',
      ].join('\n')
    );
    // DCS's own layout of the file: LF, tabs, no BOM, no newline after "return diff".
    expect(text.startsWith('local diff = {\n\t["axisDiffs"] = {\n')).toBe(true);
    expect(text.endsWith('}\nreturn diff')).toBe(true);
    expect(text).not.toContain('\r');

    const after = await view();
    expect(on(after, device(after, STICK), 'JOY_BTN19')).toEqual([]);
    expect(on(after, device(after, STICK), 'JOY_BTN36')).toEqual(['View Center']);
    expect(on(after, device(after, STICK), 'JOY_BTN_POV1_UR')).toEqual([]);
  });

  it('binding an input moves it: added on the new action and removed from the default it had', async () => {
    await start();
    const before = await view();
    const stick = device(before, STICK);
    const ops: BindingOp[] = [
      {
        op: 'bind',
        aircraft: HORNET,
        deviceId: stick.id,
        commandId: command(before, 'Cage/Uncage Button'),
        combo: { key: 'JOY_BTN_POV1_UR', reformers: [] },
      },
      // With a modifier it is a different input, so nothing else is touched.
      {
        op: 'bind',
        aircraft: HORNET,
        deviceId: stick.id,
        commandId: command(before, 'Cage/Uncage Button'),
        combo: { key: 'JOY_BTN5', reformers: ['LCtrl'] },
      },
      // Taking a button from another user binding removes that one's added entry.
      {
        op: 'bind',
        aircraft: HORNET,
        deviceId: stick.id,
        commandId: command(before, 'Master Arm Switch - ARM/SAFE'),
        combo: { key: 'JOY_BTN20', reformers: [] },
      },
    ];
    const plan = await planEdits(bindings, ops);
    expect(plan.ok && plan.value.files[0]!.lines).toEqual([
      "View Up Right slow: cancel DCS's default Hat 1 up-right",
      'Cage/Uncage Button: bind Hat 1 up-right',
      'Cage/Uncage Button: bind LCtrl + Button 5',
      'Weapon Release Button: remove Button 20',
      'Master Arm Switch - ARM/SAFE: bind Button 20',
    ]);
    await apply(ops);
    const after = await view();
    const now = device(after, STICK);
    expect(on(after, now, 'JOY_BTN_POV1_UR')).toEqual(['Cage/Uncage Button']);
    expect(on(after, now, 'JOY_BTN20')).toEqual(['Master Arm Switch - ARM/SAFE']);
    expect(on(after, now, 'JOY_BTN5').sort()).toEqual([
      'Cage/Uncage Button',
      'Gun Trigger - SECOND DETENT (Press to shoot)',
    ]);
    expect(now.bindings.find((b) => b.combo.reformers.includes('LCtrl'))).toMatchObject({
      label: 'LCtrl + Button 5',
      source: 'user',
    });
    // Different modifiers: not one input bound to two actions.
    expect(after.problems.inputConflicts).toEqual([]);

    // Binding the default back takes the removed entry away again instead of adding.
    await apply([
      {
        op: 'bind',
        aircraft: HORNET,
        deviceId: stick.id,
        commandId: command(after, 'View Up Right slow'),
        combo: { key: 'JOY_BTN_POV1_UR', reformers: [] },
      },
    ]);
    const text = await fs.readFile(await diffFile(rig.home, STICK), 'utf8');
    expect(text).not.toContain('JOY_BTN_POV1_UR');
    const restored = await view();
    expect(on(restored, device(restored, STICK), 'JOY_BTN_POV1_UR')).toEqual([
      'View Up Right slow',
    ]);
  });

  it('refuses edits it cannot make correctly, and says why', async () => {
    await start();
    const v = await view();
    const stick = device(v, STICK);
    const unknown = v.commands.find((c) => !c.editable)!;
    const cases: [BindingOp, string, RegExp][] = [
      [
        {
          op: 'bind',
          aircraft: HORNET,
          deviceId: stick.id,
          commandId: unknown.id,
          combo: { key: 'JOY_BTN1', reformers: [] },
        },
        'dcs.command.unknownNumber',
        /does not know the number DCS uses internally for ".+"/,
      ],
      [
        {
          op: 'unbind',
          aircraft: HORNET,
          deviceId: stick.id,
          commandId: command(v, 'Weapon Release Button'),
          combo: { key: 'JOY_BTN1', reformers: [] },
        },
        'dcs.notBound',
        /Button 1 is not bound to Weapon Release Button/,
      ],
      [
        {
          op: 'unbind',
          aircraft: HORNET,
          deviceId: 'joystick/Nothing {00000000-0000-0000-0000-000000000000}',
          commandId: command(v, 'Weapon Release Button'),
          combo: { key: 'JOY_BTN1', reformers: [] },
        },
        'dcs.device.unknown',
        /no device/,
      ],
      [
        {
          op: 'unbind',
          aircraft: HORNET,
          deviceId: stick.id,
          commandId: 'nonsense',
          combo: { key: 'JOY_BTN1', reformers: [] },
        },
        'dcs.command.unknown',
        /not an action/,
      ],
      [
        {
          op: 'setFilter',
          aircraft: HORNET,
          deviceId: stick.id,
          commandId: command(v, 'Rudder'),
          combo: { key: 'JOY_Z', reformers: [] },
          filter: { ...FLAT, invert: true },
        },
        'dcs.notBound',
        /Z axis is not bound to Rudder/,
      ],
      [
        { op: 'clearDevice', aircraft: 'No-Such-Plane', deviceId: stick.id },
        'dcs.aircraft.unknown',
        /no aircraft/,
      ],
    ];
    for (const [op, code, message] of cases) {
      const plan = await planEdits(bindings, [op]);
      expect(plan.ok, code).toBe(false);
      if (!plan.ok) {
        expect(plan.error.code).toBe(code);
        expect(plan.error.message).toMatch(message);
      }
    }

    // A file RigReady cannot read is never rewritten.
    const icp = await diffFile(rig.home, 'WINWING ICP');
    await fs.writeFile(icp, 'local diff = { broken');
    const broken = await view();
    const refused = await applyEdits(bindings, [
      { op: 'clearDevice', aircraft: HORNET, deviceId: device(broken, 'WINWING ICP').id },
    ]);
    expect(refused).toMatchObject({ ok: false, error: { code: 'dcs.file.unreadable' } });
    expect(await fs.readFile(icp, 'utf8')).toBe('local diff = { broken');
  });
});

const FLAT = {
  deadzone: 0,
  saturationX: 1,
  saturationY: 1,
  hardwareDetent: false,
  hardwareDetentAB: 0,
  hardwareDetentMax: 0,
  invert: false,
  slider: false,
  curvature: [0],
};

describe('editing axis bindings', () => {
  it('setting curvature 0.15 and invert on pitch produces the filter table DCS writes', async () => {
    await start();
    const file = await diffFile(rig.home, STICK);
    const original = await fs.readFile(file, 'utf8');
    const v = await view();
    const stick = device(v, STICK);
    const pitch = { key: 'JOY_Y', reformers: [] };
    const setFilter = (filter: typeof FLAT): BindingOp => ({
      op: 'setFilter',
      aircraft: HORNET,
      deviceId: stick.id,
      commandId: command(v, 'Pitch'),
      combo: pitch,
      filter,
    });

    // Back to DCS's default curve: the `changed` entry goes away.
    await apply([setFilter(FLAT)]);
    expect(await fs.readFile(file, 'utf8')).not.toContain('"changed"');
    // The curve DCS itself saved for the owner (0.15, not inverted): the same bytes as DCS wrote.
    const plan = await planEdits(bindings, [setFilter({ ...FLAT, curvature: [0.15] })]);
    expect(plan.ok && plan.value.files[0]!.lines).toEqual(['Pitch: set Y axis to curve 0.15']);
    await apply([setFilter({ ...FLAT, curvature: [0.15] })]);
    expect(await fs.readFile(file, 'utf8')).toBe(original);

    // With invert as well.
    await apply([setFilter({ ...FLAT, curvature: [0.15], invert: true })]);
    expect(await fs.readFile(file, 'utf8')).toContain(
      [
        '\t\t["a2001cdnil"] = {',
        '\t\t\t["changed"] = {',
        '\t\t\t\t[1] = {',
        '\t\t\t\t\t["filter"] = {',
        '\t\t\t\t\t\t["curvature"] = {',
        '\t\t\t\t\t\t\t[1] = 0.15,',
        '\t\t\t\t\t\t},',
        '\t\t\t\t\t\t["deadzone"] = 0,',
        '\t\t\t\t\t\t["hardwareDetent"] = false,',
        '\t\t\t\t\t\t["hardwareDetentAB"] = 0,',
        '\t\t\t\t\t\t["hardwareDetentMax"] = 0,',
        '\t\t\t\t\t\t["invert"] = true,',
        '\t\t\t\t\t\t["saturationX"] = 1,',
        '\t\t\t\t\t\t["saturationY"] = 1,',
        '\t\t\t\t\t\t["slider"] = false,',
        '\t\t\t\t\t},',
        '\t\t\t\t\t["key"] = "JOY_Y",',
        '\t\t\t\t},',
        '\t\t\t},',
        '\t\t\t["name"] = "Pitch",',
        '\t\t},',
      ].join('\n')
    );
    const after = await view();
    expect(device(after, STICK).bindings.find((b) => b.combo.key === 'JOY_Y')).toMatchObject({
      filterChanged: true,
      combo: { filter: { invert: true, curvature: [0.15] } },
    });
  });

  it('binds an axis with deadzone, saturation, curve, invert and slider, and changes it later', async () => {
    await start();
    const v = await view();
    const throttle = device(v, 'WINWING THROTTLE');
    const filter = { ...FLAT, deadzone: 0.05, saturationX: 0.9, saturationY: 0.8, slider: true };
    const zoom = command(v, 'Zoom View');
    await apply([
      {
        op: 'bind',
        aircraft: HORNET,
        deviceId: throttle.id,
        commandId: zoom,
        combo: { key: 'JOY_SLIDER1', reformers: [], filter },
      },
    ]);
    let after = await view();
    const bound = (): DeviceView['bindings'][number] =>
      device(after, 'WINWING THROTTLE').bindings.find((b) => b.combo.key === 'JOY_SLIDER1')!;
    expect(bound()).toMatchObject({ commandId: zoom, source: 'user', combo: { filter } });

    // A user axis keeps its filter inside `added`; the default filter is left out, as DCS does.
    const next: BindingOp = {
      op: 'setFilter',
      aircraft: HORNET,
      deviceId: throttle.id,
      commandId: zoom,
      combo: { key: 'JOY_SLIDER1', reformers: [] },
      filter: { ...FLAT, curvature: [0, 0.1, 0.3, 0.6, 1] },
    };
    const plan = await planEdits(bindings, [next]);
    expect(plan.ok && plan.value.files[0]!.lines).toEqual([
      'Zoom View: set Slider 1 to custom curve with 5 points',
    ]);
    await apply([next]);
    after = await view();
    expect(bound().combo.filter?.curvature).toEqual([0, 0.1, 0.3, 0.6, 1]);
    await apply([{ ...next, filter: FLAT }]);
    const text = await fs.readFile(await diffFile(rig.home, 'WINWING THROTTLE'), 'utf8');
    expect(text).toContain(
      '\t\t["a2012cdnil"] = {\n\t\t\t["added"] = {\n\t\t\t\t[1] = {\n\t\t\t\t\t["key"] = "JOY_SLIDER1",\n\t\t\t\t},\n\t\t\t},'
    );
  });
});

describe('writing files', () => {
  it('goes through FileStore with a backup and a readable journal entry, and can be undone', async () => {
    await start();
    const file = await diffFile(rig.home, STICK);
    const original = await fs.readFile(file, 'utf8');
    const v = await view();
    const applied = await applyEdits(bindings, [
      {
        op: 'unbind',
        aircraft: HORNET,
        deviceId: device(v, STICK).id,
        commandId: command(v, 'View Center'),
        combo: { key: 'JOY_BTN19', reformers: [] },
      },
    ]);
    expect(applied).toMatchObject({
      ok: true,
      value: { summary: 'Change 1 binding for F/A-18C', files: 1 },
    });
    const groups = await rig.ports.files.journalGroups();
    if (!groups.ok || !applied.ok) throw new Error('no journal');
    expect(groups.value[0]).toMatchObject({
      id: applied.value.groupId,
      reason: 'Change 1 binding for F/A-18C',
      entries: [{ path: file, action: 'write' }],
    });
    const backup = groups.value[0]!.entries[0]!.backupPath!;
    expect(await fs.readFile(backup, 'utf8')).toBe(original);
    const undone = await rig.ports.files.undoGroup(applied.value.groupId);
    expect(undone.ok).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe(original);
  });

  it('is refused while DCS is running, with the reason, and nothing is written', async () => {
    await start();
    await mutate(rig, [
      { op: 'startProcess', name: 'DCS.exe', path: 'C:\\DCSWorld\\bin\\DCS.exe' },
    ]);
    const file = await diffFile(rig.home, STICK);
    const original = await fs.readFile(file, 'utf8');
    const v = await view();
    expect(v.dcsRunning).toBe(true);
    const ops: BindingOp[] = [
      { op: 'clearDevice', aircraft: HORNET, deviceId: device(v, STICK).id },
    ];
    const plan = await planEdits(bindings, ops);
    expect(plan.ok && plan.value.blocked).toMatch(/DCS is running.*would overwrite this change/);
    const applied = await applyEdits(bindings, ops);
    expect(applied).toMatchObject({ ok: false, error: { code: 'dcs.running' } });
    expect(!applied.ok && applied.error.message).toMatch(/Close DCS first/);
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    const journal = await rig.ports.files.journal();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('creates the file when a device has none, starting from the template DCS ships for it', async () => {
    await start();
    // No file and no template: a new file with just the change.
    let v = await view();
    const wheel = device(v, 'FANATEC');
    await apply([
      {
        op: 'unbind',
        aircraft: HORNET,
        deviceId: wheel.id,
        commandId: command(v, 'Pitch'),
        combo: { key: 'JOY_Y', reformers: [] },
      },
    ]);
    const created = path.join(
      joystickDir(rig.home),
      'FANATEC Podium Wheel Base DD2 {20B0BED0-03A4-11f1-8001-444553540000}.diff.lua'
    );
    expect(await fs.readFile(created, 'utf8')).toBe(
      [
        'local diff = {',
        '\t["axisDiffs"] = {',
        '\t\t["a2001cdnil"] = {',
        '\t\t\t["name"] = "Pitch",',
        '\t\t\t["removed"] = {',
        '\t\t\t\t[1] = {',
        '\t\t\t\t\t["key"] = "JOY_Y",',
        '\t\t\t\t},',
        '\t\t\t},',
        '\t\t},',
        '\t},',
        '}',
        'return diff',
      ].join('\n')
    );
    // Binding it back empties the diff, and an empty diff file is deleted, as DCS does.
    v = await view();
    const plan = await planEdits(bindings, [
      {
        op: 'bind',
        aircraft: HORNET,
        deviceId: wheel.id,
        commandId: command(v, 'Pitch'),
        combo: { key: 'JOY_Y', reformers: [] },
      },
    ]);
    expect(plan.ok && plan.value.files[0]).toMatchObject({ action: 'delete', path: created });
    await apply([
      {
        op: 'bind',
        aircraft: HORNET,
        deviceId: wheel.id,
        commandId: command(v, 'Pitch'),
        combo: { key: 'JOY_Y', reformers: [] },
      },
    ]);
    await expect(fs.access(created)).rejects.toThrow();

    // With a template: DCS drops the template once a user file exists, so its entries come along.
    const startup = await diffFile(rig.home, 'WINWING F18 STARTUP PANEL');
    await fs.rm(startup);
    v = await view();
    const panel = device(v, 'WINWING F18 STARTUP PANEL');
    const first = panel.bindings.find((b) => b.source === 'template')!;
    const templateCount = panel.bindings.filter((b) => b.source === 'template').length;
    const fromTemplate = await planEdits(bindings, [
      {
        op: 'unbind',
        aircraft: HORNET,
        deviceId: panel.id,
        commandId: first.commandId,
        combo: first.combo,
      },
    ]);
    expect(fromTemplate.ok && fromTemplate.value.files[0]).toMatchObject({
      action: 'create',
      path: startup,
    });
    expect(fromTemplate.ok && fromTemplate.value.files[0]!.lines[0]).toMatch(
      /^Starts from the bindings DCS ships for this device/
    );
    await apply([
      {
        op: 'unbind',
        aircraft: HORNET,
        deviceId: panel.id,
        commandId: first.commandId,
        combo: first.combo,
      },
    ]);
    v = await view();
    const now = device(v, 'WINWING F18 STARTUP PANEL');
    expect(now.file.source).toBe('user');
    expect(now.bindings.filter((b) => b.source === 'user')).toHaveLength(templateCount - 1);
  });

  it('never overwrites a file that changed after the preview, or an existing rename target', async () => {
    await start();
    const file = await diffFile(rig.home, STICK);
    const stale = new PlanBuilder();
    stale.write(file, 'what the preview saw', 'new content', { title: 't', lines: [] });
    expect(await executePlan(rig.ports, 'Test', stale, false)).toMatchObject({
      ok: false,
      error: { code: 'dcs.changedMeanwhile' },
    });
    const text = await fs.readFile(file, 'utf8');
    const collide = new PlanBuilder();
    collide.move(file, await diffFile(rig.home, 'WINWING ICP'), text, text, {
      title: 't',
      lines: [],
    });
    expect(await executePlan(rig.ports, 'Test', collide, false)).toMatchObject({
      ok: false,
      error: { code: 'dcs.targetExists' },
    });
    expect(await executePlan(rig.ports, 'Test', new PlanBuilder(), false)).toMatchObject({
      ok: false,
      error: { code: 'dcs.nothingToDo' },
    });
    // A rename that only changes the case of the name is the same file on Windows: a plain write.
    const sameFile = new PlanBuilder();
    sameFile.move(file, file.toUpperCase(), text, text, { title: 't', lines: [] });
    expect(sameFile.steps).toEqual([]);
    expect(await fs.readFile(file, 'utf8')).toBe(text);
  });
});

describe('clearing a device', () => {
  it('removes every default and every added binding, and the journal can undo it', async () => {
    await start();
    const file = await diffFile(rig.home, STICK);
    const original = await fs.readFile(file, 'utf8');
    const v = await view();
    const stick = device(v, STICK);
    expect(stick.counts.active).toBe(30);
    const ops: BindingOp[] = [{ op: 'clearDevice', aircraft: HORNET, deviceId: stick.id }];
    const plan = await planEdits(bindings, ops, `Clear all ${stick.counts.active} bindings`);
    expect(plan.ok && plan.value.files[0]!.lines).toHaveLength(30);
    const applied = await applyEdits(bindings, ops, 'Clear all 30 bindings on the stick (F/A-18C)');
    if (!applied.ok) throw new Error(applied.error.message);
    const after = await view();
    const cleared = device(after, STICK);
    expect(cleared.bindings).toEqual([]);
    expect(cleared.counts).toEqual({ active: 0, fromUser: 0, fromDefaults: 0, inert: 0 });
    // Defaults are cancelled, not just the user's entries deleted.
    expect(cleared.removed.map((r) => r.combo.key)).toEqual(
      expect.arrayContaining(['JOY_X', 'JOY_Y', 'JOY_BTN_POV1_UR'])
    );
    const groups = await rig.ports.files.journalGroups();
    expect(groups.ok && groups.value[0]!.reason).toBe(
      'Clear all 30 bindings on the stick (F/A-18C)'
    );
    expect((await rig.ports.files.undoGroup(applied.value.groupId)).ok).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe(original);
  });
});

describe('cleaning up unwanted defaults', () => {
  it('writes removed entries into the right files for one aircraft or for all, creating files where missing', async () => {
    await start();
    const before = await view();
    const unwanted = before.problems.unwantedDefaults;
    // On the recorded rig the racing wheel is the device with flight defaults on it.
    expect(unwanted.map((u) => `${u.deviceName}: ${u.reason} (${u.label})`)).toEqual(
      expect.arrayContaining([
        'FANATEC Podium Wheel Base DD2: Pitch on a device not used in DCS (Y axis)',
        'FANATEC Podium Wheel Base DD2: Throttle on a device not used in DCS (Z axis)',
        'FANATEC Podium Wheel Base DD2: View on a device not used in DCS (Hat 1 up)',
      ])
    );
    expect(unwanted).toHaveLength(12);

    // One aircraft, only some of them.
    const some = await cleanupOps(
      bindings,
      [HORNET],
      new Set(unwanted.slice(0, 4).map((u) => u.id))
    );
    expect(some.ok && some.value).toHaveLength(4);

    // Every aircraft at once: the Huey has never been bound and has many more.
    const all = await cleanupOps(bindings, [HORNET, HUEY]);
    if (!all.ok) throw new Error(all.error.message);
    const plan = await planEdits(bindings, all.value, 'Clean up default bindings');
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value.files.every((f) => f.action === 'create')).toBe(true);
    expect(plan.value.files.map((f) => f.title)).toEqual(
      expect.arrayContaining([
        'FANATEC Podium Wheel Base DD2 · F/A-18C',
        'FANATEC Podium Wheel Base DD2 · UH-1H',
        'WINWING MFD1-L · UH-1H',
        'WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R · UH-1H',
      ])
    );
    await apply(all.value, 'Clean up default bindings');

    const hornet = await view(HORNET);
    const huey = await view(HUEY);
    expect(hornet.problems.unwantedDefaults).toEqual([]);
    expect(huey.problems.unwantedDefaults).toEqual([]);
    // No flight axis is duplicated onto a panel, MFD frame or the wheel any more.
    for (const v of [hornet, huey]) {
      const axisDuplicates = v.problems.actionDuplicates.filter((d) =>
        /Pitch|Roll|Rudder|Thrust|Collective/.test(
          v.commands.find((c) => c.id === d.commandId)!.name
        )
      );
      expect(axisDuplicates).toEqual([]);
    }
    // The Huey file of an MFD frame cancels the four default buttons DCS puts on every device.
    const mfd = await fs.readFile(await diffFile(rig.home, 'WINWING MFD1-L', HUEY), 'utf8');
    for (const key of ['JOY_BTN1', 'JOY_BTN2', 'JOY_BTN3', 'JOY_BTN5']) expect(mfd).toContain(key);
    expect(mfd).not.toContain('"added"');
    // The stick keeps its defaults: they belong there.
    const stick = device(huey, STICK);
    expect(on(huey, stick, 'JOY_BTN2')).toEqual(['Pilot weapon release/Machinegun fire']);
    expect(on(huey, stick, 'JOY_Y')).toEqual(['Flight Control Cyclic Pitch']);
    // One undoable group for everything.
    const groups = await rig.ports.files.journalGroups();
    expect(groups.ok && groups.value[0]).toMatchObject({ reason: 'Clean up default bindings' });
    expect(groups.ok && groups.value[0]!.entries.length).toBe(plan.value.files.length);
  });
});
