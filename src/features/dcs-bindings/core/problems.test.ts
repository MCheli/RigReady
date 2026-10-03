import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import {
  BINDING_FILES,
  HORNET,
  HUEY,
  bindingsFor,
  diffFile,
  inputDir,
  useOldBindings,
} from '../../../../tests/dcsBindings';
import { roleKey, type DcsBindings } from './bindings';
import { applyEdits, type BindingOp } from './edits';
import { importantActions } from './important';
import { applyMigration, proposedMappings, scanMigration } from './migration';
import type { AircraftView, CommandView, DeviceView } from './model';
import { findProblems, suggestRole } from './problems';

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
const nameOf = (v: AircraftView, id: string): string => v.commands.find((c) => c.id === id)!.name;
const idOf = (v: AircraftView, name: string): string => v.commands.find((c) => c.name === name)!.id;

describe('one input bound to several actions', () => {
  it('reports an MFD brightness knob that is also bound to pitch, and not bindings that differ by modifier', async () => {
    await start();
    expect((await view()).problems.inputConflicts).toEqual([]);

    // The left MFD frame's knob (its only axis) on the HUD brightness and, by accident, on pitch;
    // and one button twice with different modifiers, which is fine.
    const file = await diffFile(rig.home, 'WINWING MFD1-L');
    const text = await fs.readFile(file, 'utf8');
    const added = (key: string): string =>
      `\t\t\t["added"] = {\n\t\t\t\t[1] = {\n\t\t\t\t\t["key"] = "${key}",\n\t\t\t\t},\n\t\t\t},\n`;
    const withModifier =
      '\t\t["d3015pnilu3015cd25vd1vpnilvu0"] = {\n\t\t\t["added"] = {\n\t\t\t\t[1] = {\n\t\t\t\t\t["key"] = "JOY_BTN1",\n\t\t\t\t\t["reformers"] = {\n\t\t\t\t\t\t[1] = "LCtrl",\n\t\t\t\t\t},\n\t\t\t\t},\n\t\t\t},\n\t\t\t["name"] = "UFC I/P Pushbutton",\n\t\t},\n';
    await fs.writeFile(
      file,
      text
        .replace(
          'local diff = {\n',
          `local diff = {\n\t["axisDiffs"] = {\n\t\t["a2001cdnil"] = {\n${added('JOY_SLIDER1')}\t\t\t["name"] = "Pitch",\n\t\t},\n\t\t["a3012cd34"] = {\n${added('JOY_SLIDER1')}\t\t\t["name"] = "HUD Symbology Brightness Control Knob",\n\t\t},\n\t},\n`
        )
        .replace('\t["keyDiffs"] = {\n', `\t["keyDiffs"] = {\n${withModifier}`)
    );
    const v = await view();
    expect(v.warnings).toEqual([]);
    expect(v.problems.inputConflicts).toHaveLength(1);
    const conflict = v.problems.inputConflicts[0]!;
    expect(conflict).toMatchObject({ deviceName: 'WINWING MFD1-L', label: 'Slider 1' });
    expect(conflict.commandIds.map((id) => nameOf(v, id)).sort()).toEqual([
      'HUD Symbology Brightness Control Knob',
      'Pitch',
    ]);
    // Button 1 with and without LCtrl are two different inputs.
    const mfd = device(v, 'WINWING MFD1-L');
    expect(mfd.bindings.filter((b) => b.combo.key === 'JOY_BTN1').map((b) => b.label)).toEqual([
      'Button 1',
      'LCtrl + Button 1',
    ]);
  });
});

describe('one action bound on several inputs', () => {
  it('lists pitch on the stick and on other devices, clears the others in one change, and hides what is marked expected', async () => {
    await start();
    // Take the throttle's file away: DCS then gives it the generic stick axes.
    await fs.rm(await diffFile(rig.home, 'WINWING THROTTLE'));
    const v = await view();
    const pitch = v.problems.actionDuplicates.find((d) => nameOf(v, d.commandId) === 'Pitch')!;
    expect(pitch.acrossDevices).toBe(true);
    expect(pitch.occurrences.map((o) => `${o.deviceName}: ${o.label}`).sort()).toEqual([
      'FANATEC Podium Wheel Base DD2: Y axis',
      'WINWING Orion Joystick Base 2 + JGRIP-F16: Y axis',
      'WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R: Y axis',
    ]);
    // Bound twice on one device counts too (the owner's two View Center buttons).
    const center = v.problems.actionDuplicates.find(
      (d) => nameOf(v, d.commandId) === 'View Center'
    )!;
    expect(center).toMatchObject({ acrossDevices: false, expected: false });
    expect(center.occurrences.map((o) => o.label)).toEqual(['Button 19', 'Button 36']);

    // "Keep only this one": clear every other occurrence as one change.
    const keep = pitch.occurrences.find((o) => o.deviceName.includes('Orion'))!;
    const ops: BindingOp[] = pitch.occurrences
      .filter((o) => o !== keep)
      .map((o) => ({
        op: 'unbind',
        aircraft: HORNET,
        deviceId: o.deviceId,
        commandId: pitch.commandId,
        combo: { key: o.combo.key, reformers: o.combo.reformers },
      }));
    const applied = await applyEdits(bindings, ops, 'Keep Pitch only on the stick');
    expect(applied).toMatchObject({ ok: true, value: { files: 2 } });

    // Intentional multiples are marked expected per aircraft.
    await bindings.updateState((state) => ({
      ...state,
      expected: { ...state.expected, [HORNET]: [center.commandId] },
    }));
    const after = await view();
    expect(
      after.problems.actionDuplicates.some((d) => nameOf(after, d.commandId) === 'Pitch')
    ).toBe(false);
    expect(
      after.problems.actionDuplicates.find((d) => d.commandId === center.commandId)
    ).toMatchObject({ expected: true });
    // Another aircraft's marks are its own.
    expect((await view(HUEY)).problems.actionDuplicates.every((d) => !d.expected)).toBe(true);
  });
});

describe('default bindings on devices that should not have them', () => {
  it('suggests a role from the device name, and the user can change it', async () => {
    expect(suggestRole('WINWING Orion Joystick Base 2 + JGRIP-F16')).toBe('stick');
    expect(suggestRole('WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R')).toBe(
      'throttle'
    );
    expect(suggestRole('T-Pendular-Rudder')).toBe('pedals');
    expect(suggestRole('WINWING MFD1-L')).toBe('mfd');
    expect(suggestRole('WINWING UFC1 + HUD1')).toBe('panel');
    expect(suggestRole('R-VPC Panel #1')).toBe('panel');
    expect(suggestRole('FANATEC Podium Wheel Base DD2')).toBe('none');
    expect(suggestRole('Some Gadget')).toBe('other');

    await start();
    let v = await view();
    const wheel = device(v, 'FANATEC');
    expect(wheel).toMatchObject({ role: 'none', roleSuggested: true });
    expect(v.problems.unwantedDefaults.filter((u) => u.deviceId === wheel.id)).toHaveLength(12);
    // Tell RigReady the wheel is "something else": it has no opinion about it any more.
    await bindings.updateState((state) => ({
      ...state,
      roles: { ...state.roles, [roleKey(wheel)]: 'other' },
    }));
    v = await view();
    expect(device(v, 'FANATEC')).toMatchObject({ role: 'other', roleSuggested: false });
    expect(v.problems.unwantedDefaults).toEqual([]);
    // As a stick it may keep pitch, roll and the view hat; the throttle axis is unwanted
    // because a throttle is attached, the rudder twist because pedals are.
    await bindings.updateState((state) => ({
      ...state,
      roles: { ...state.roles, [roleKey(wheel)]: 'stick' },
    }));
    v = await view();
    expect(v.problems.unwantedDefaults.map((u) => u.reason).sort()).toEqual([
      'Rudder on a stick',
      'Throttle on a stick',
    ]);
  });

  it('a fresh WinWing ICP without a file shows its default pitch and roll when DCS does not list it as a panel', async () => {
    await start();
    await fs.rm(await diffFile(rig.home, 'WINWING ICP'));
    // DCS 2.9.29 lists the ICP among "no default assignments for panels": nothing to clean up.
    let v = await view();
    expect(v.problems.unwantedDefaults.filter((u) => u.deviceName === 'WINWING ICP')).toEqual([]);

    // Older DCS versions (and any panel DCS does not know) get the generic stick defaults.
    // That is the state the owner's ICP file was written in: it removes Pitch and Roll.
    const assignments = path.join(
      rig.home,
      'Program Files (x86)/Steam/steamapps/common/DCSWorld/Scripts/Input/DefaultAssignments.lua'
    );
    const text = await fs.readFile(assignments, 'utf8');
    expect(text).toMatch(/default_assignments\s*\["WINWING ICP"\]/);
    await fs.writeFile(
      assignments,
      text.replace(/^default_assignments\s*\["WINWING ICP"\].*$/m, '')
    );
    bindings = bindingsFor(rig);
    v = await view();
    const icp = device(v, 'WINWING ICP');
    expect(icp).toMatchObject({ role: 'panel', file: { source: 'none' } });
    expect(
      v.problems.unwantedDefaults
        .filter((u) => u.deviceId === icp.id)
        .map((u) => `${u.reason}: ${u.label}`)
        .sort()
    ).toEqual(['Pitch on a panel or button box: Y axis', 'Roll on a panel or button box: X axis']);
    // Rudder (RZ), thrust (Z) and the view hat are defaults too, but the ICP has no such controls.
    expect(icp.counts.inert).toBe(10);
  });

  it('pedals keep rudder and brakes; their other axes are flagged', async () => {
    await start();
    await fs.rm(await diffFile(rig.home, 'T-Pendular-Rudder'));
    const assignments = path.join(
      rig.home,
      'Program Files (x86)/Steam/steamapps/common/DCSWorld/Scripts/Input/DefaultAssignments.lua'
    );
    // As on a DCS that does not know these pedals: generic defaults.
    const text = await fs.readFile(assignments, 'utf8');
    await fs.writeFile(
      assignments,
      text.replace(
        'default_assignments\t["T-Pendular-Rudder"]',
        'default_assignments\t["Other Pedals"]'
      )
    );
    const v = await view();
    const pedals = device(v, 'T-Pendular-Rudder');
    expect(
      v.problems.unwantedDefaults
        .filter((u) => u.deviceId === pedals.id)
        .map((u) => `${u.reason}: ${u.label}`)
        .sort()
    ).toEqual([
      'Pitch on a pedals: Y axis',
      'Roll on a pedals: X axis',
      'Throttle on a pedals: Z axis',
    ]);
  });
});

describe('important but unbound', () => {
  it('every curated item matches a real action of its aircraft', async () => {
    await start();
    for (const aircraft of [HORNET, HUEY]) {
      const v = await view(aircraft);
      const list = importantActions(aircraft);
      expect(list.curated).toBe(true);
      expect(list.tiers.map((t) => t.tier)).toEqual([1, 2, 3, 4, 5]);
      for (const tier of list.tiers) {
        for (const item of tier.items) {
          const matches = v.commands.filter((c) => item.patterns.some((p) => p.test(c.name)));
          expect(matches.length, `${aircraft}: ${item.title}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('F/A-18C without a Sensor Control binding shows Sensor Control Switch in the top tier', async () => {
    await start();
    let v = await view();
    // The owner's Hornet has everything on the list bound somewhere.
    expect(v.problems.importantUnbound).toEqual([]);
    const stick = device(v, 'WINWING Orion Joystick');
    const sensor = stick.bindings.filter((b) =>
      nameOf(v, b.commandId).startsWith('Sensor Control Switch')
    );
    expect(sensor).toHaveLength(4);
    const applied = await applyEdits(
      bindings,
      sensor.map((b) => ({
        op: 'unbind' as const,
        aircraft: HORNET,
        deviceId: stick.id,
        commandId: b.commandId,
        combo: { key: b.combo.key, reformers: b.combo.reformers },
      }))
    );
    expect(applied.ok).toBe(true);
    v = await view();
    expect(v.problems.importantUnbound).toHaveLength(1);
    expect(v.problems.importantUnbound[0]).toMatchObject({
      id: 'sensor-control',
      tier: 1,
      tierTitle: 'Fly and fight (HOTAS essentials)',
      title: 'Sensor Control Switch',
    });
    // It still works from the keyboard, which is worth knowing.
    expect(v.problems.importantUnbound[0]!.keyboard).toMatch(/^RAlt \+ /);
    expect(v.problems.importantUnbound[0]!.commandIds).toContain(
      idOf(v, 'Sensor Control Switch - Fwd')
    );
  });

  it('uses a generic list for aircraft without a curated one', () => {
    const generic = importantActions('A-10C_2');
    expect(generic.curated).toBe(false);
    expect(generic.tiers.flatMap((t) => t.items.map((i) => i.id))).toEqual([
      'pitch',
      'roll',
      'rudder',
      'thrust',
      'trim',
      'wheel-brakes',
      'gear',
      'flaps',
      'comms',
      'view-center',
      'zoom',
    ]);
    const command = (name: string, kind: 'key' | 'axis' = 'key'): CommandView => ({
      id: `${kind}:${name}`,
      kind,
      hash: name,
      name,
      category: [],
      editable: true,
      unmatched: false,
    });
    const commands = [
      command('Pitch', 'axis'),
      command('Roll', 'axis'),
      command('Landing Gear Up/Down'),
      command('Trim Up'),
    ];
    const stick: DeviceView = {
      id: 'joystick/Stick',
      type: 'joystick',
      name: 'Stick',
      fullId: 'Stick',
      connected: true,
      numButtons: 4,
      numHats: 0,
      axisNames: ['X', 'Y'],
      role: 'stick',
      roleSuggested: true,
      file: { path: 'x', source: 'none' },
      bindings: [
        {
          commandId: 'axis:Pitch',
          combo: { key: 'JOY_Y', reformers: [] },
          label: 'Y axis',
          source: 'default',
          filterChanged: false,
          inert: false,
        },
      ],
      removed: [],
      counts: { active: 1, fromUser: 0, fromDefaults: 1, inert: 0 },
    };
    const problems = findProblems({
      aircraftId: 'A-10C_2',
      devices: [stick],
      commands,
      expected: new Set(),
    });
    // Pitch is bound; roll, trim and gear exist and are not; the rest does not exist in this aircraft.
    expect(problems.importantUnbound.map((p) => `${p.tier} ${p.title}`)).toEqual([
      '1 Roll',
      '1 Trim',
      '2 Landing gear',
    ]);
  });
});

describe('UH-1H', () => {
  it('names cyclic and collective, finds the defaults DCS puts on every device, and lists what matters', async () => {
    await start();
    const fresh = await view(HUEY);
    expect(fresh.aircraft).toMatchObject({ name: 'UH-1H', hasDefaults: true, userFiles: 0 });
    const throttle = device(fresh, 'WINWING THROTTLE');
    const axes = Object.fromEntries(
      throttle.bindings
        .filter((b) => b.combo.key.match(/^JOY_[XYZR]/) && !b.inert)
        .map((b) => [b.combo.key, nameOf(fresh, b.commandId)])
    );
    expect(axes).toEqual({
      JOY_X: 'Flight Control Cyclic Roll',
      JOY_Y: 'Flight Control Cyclic Pitch',
      JOY_Z: 'Flight Control Collective',
      JOY_RZ: 'Flight Control Rudder',
    });
    // Buttons 1, 2, 3 and 5 are bound on every one of the eleven devices that has buttons.
    const trimmer = fresh.problems.actionDuplicates.find(
      (d) => nameOf(fresh, d.commandId) === 'Pilot Trimmer'
    )!;
    expect(trimmer.occurrences).toHaveLength(11);
    expect(trimmer.occurrences.every((o) => o.label === 'Button 3')).toBe(true);
    // All of that is unwanted except on the stick, the collective axis on the throttle and the pedals.
    const unwanted = fresh.problems.unwantedDefaults;
    expect(unwanted.filter((u) => u.deviceName === 'WINWING MFD1-C').map((u) => u.label)).toEqual([
      'Button 1',
      'Button 2',
      'Button 3',
      'Button 5',
    ]);
    expect(unwanted.some((u) => u.deviceName.includes('Orion'))).toBe(false);
    expect(
      unwanted.filter((u) => u.deviceName.startsWith('WINWING THROTTLE')).map((u) => u.reason)
    ).not.toContain('Throttle on a throttle');
    expect(fresh.problems.importantUnbound.map((p) => p.title)).toEqual(
      expect.arrayContaining(['Armament Off/Safe/Armed', 'Engine start'])
    );

    // With the owner's real Huey bindings (from the older backup, moved to the current device ids).
    await useOldBindings(rig.home, HUEY);
    const scan = await scanMigration(bindings);
    if (!scan.ok) throw new Error(scan.error.message);
    expect((await applyMigration(bindings, proposedMappings(scan.value))).ok).toBe(true);
    const v = await view(HUEY);
    expect(v.warnings).toEqual([]);
    expect(v.aircraft.userFiles).toBe(10);
    // Every bound action has a name from DCS's default files.
    expect(v.commands.filter((c) => c.unmatched)).toEqual([]);
    const bound = new Map<string, string>();
    for (const d of v.devices.filter((x) => x.type === 'joystick')) {
      for (const b of d.bindings.filter((x) => x.source === 'user')) {
        bound.set(nameOf(v, b.commandId), `${d.name}: ${b.label}`);
      }
    }
    expect(bound.get('Flight Control Collective')).toMatch(/^WINWING THROTTLE.*axis$/);
    expect(bound.size).toBeGreaterThan(80);
    expect(await fs.readdir(path.join(inputDir(rig.home), HUEY, 'joystick'))).toHaveLength(10);
  });
});
