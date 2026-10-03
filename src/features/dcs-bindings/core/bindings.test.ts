import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseLuaData, writeLuaDocument } from '../../../core/lua/data';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
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
import { readDiff } from './diff';
import type { AircraftView, DeviceView } from './model';
import { parseDiffFileName } from './names';

let rig: TestRig;
afterEach(() => rig?.cleanup());

const start = async (): Promise<TestRig> =>
  (rig = await scenarioRig('flying-fresh', { files: BINDING_FILES }));

async function view(aircraft = HORNET): Promise<AircraftView> {
  const result = await bindingsFor(rig).view(aircraft);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const device = (v: AircraftView, prefix: string): DeviceView => {
  const found = v.devices.find((d) => d.name.startsWith(prefix));
  if (!found) throw new Error(`no device ${prefix}`);
  return found;
};

const nameOf = (v: AircraftView, commandId: string): string =>
  v.commands.find((c) => c.id === commandId)?.name ?? commandId;

const bound = (v: AircraftView, d: DeviceView): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const b of d.bindings.filter((x) => !x.inert)) {
    (out[b.combo.key] ??= []).push(nameOf(v, b.commandId));
  }
  return out;
};

async function everyDiffFile(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await everyDiffFile(full)));
    else if (entry.name.endsWith('.diff.lua')) out.push(full);
  }
  return out;
}

describe('reading binding files', () => {
  it('parses every diff file of the recorded rig and of the older backup into added, removed and changed entries', async () => {
    await start();
    const files = [
      ...(await everyDiffFile(inputDir(rig.home))),
      ...(await everyDiffFile(path.join(fixtureData, 'old-ids'))),
    ];
    expect(files.length).toBeGreaterThanOrEqual(37);
    let added = 0;
    let removed = 0;
    let changed = 0;
    let withReformers = 0;
    let withFilter = 0;
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      const parsed = parseLuaData(text);
      expect(parsed.ok, file).toBe(true);
      if (!parsed.ok) continue;
      const model = readDiff(parsed.value);
      expect(model.entries.length, file).toBeGreaterThan(0);
      for (const entry of model.entries) {
        expect(entry.name, `${file} ${entry.hash}`).not.toBe('');
        expect(entry.hash).toMatch(entry.kind === 'axis' ? /^a.+cd/ : /^d.+p.+u.+cd.+vd.+vp.+vu/);
        added += entry.added.length;
        removed += entry.removed.length;
        changed += entry.changed.length;
        for (const combo of [...entry.added, ...entry.removed, ...entry.changed]) {
          expect(combo.key).toMatch(/^JOY_/);
          if (combo.reformers.length > 0) withReformers++;
          if (combo.filter) withFilter++;
        }
      }
      // Reading and writing back without edits gives the same bytes and the same model.
      const written = writeLuaDocument(parsed.value);
      expect(written, file).toBe(text);
      const again = parseLuaData(written);
      expect(again.ok && readDiff(again.value)).toEqual(model);
    }
    expect(added).toBeGreaterThan(500);
    expect(removed).toBeGreaterThan(30);
    expect(changed).toBeGreaterThan(0);
    expect(withReformers).toBeGreaterThan(0);
    expect(withFilter).toBeGreaterThan(3);
  });

  it('splits file names into device name and GUID, also with spaces and braces in the name', () => {
    expect(
      parseDiffFileName('WINWING UFC1 + HUD1 {806E0610-B756-11f0-8026-444553540000}.diff.lua')
    ).toEqual({
      deviceName: 'WINWING UFC1 + HUD1',
      guid: '806E0610-B756-11f0-8026-444553540000',
      fullId: 'WINWING UFC1 + HUD1 {806E0610-B756-11f0-8026-444553540000}',
    });
    expect(
      parseDiffFileName(' VKBsim Gladiator  {AAAAAAAA-0000-11ee-8001-444553540000}.diff.lua')
    ).toMatchObject({
      deviceName: ' VKBsim Gladiator ',
      guid: 'AAAAAAAA-0000-11ee-8001-444553540000',
    });
    expect(
      parseDiffFileName('Pad {v2} {x} {BBBBBBBB-0000-11ee-8001-444553540000}.diff.lua')
    ).toMatchObject({ deviceName: 'Pad {v2} {x}', guid: 'BBBBBBBB-0000-11ee-8001-444553540000' });
    expect(parseDiffFileName('Keyboard.diff.lua')).toEqual({
      deviceName: 'Keyboard',
      fullId: 'Keyboard',
    });
    expect(parseDiffFileName('Odd {not-a-guid}.diff.lua')).toEqual({
      deviceName: 'Odd {not-a-guid}',
      fullId: 'Odd {not-a-guid}',
    });
    expect(parseDiffFileName('default.lua')).toBeUndefined();
    expect(parseDiffFileName('.diff.lua')).toBeUndefined();
  });

  it('reports a malformed file with its path and line and still loads the others', async () => {
    await start();
    const broken = await diffFile(rig.home, 'WINWING ICP');
    await fs.writeFile(
      broken,
      'local diff = {\n\t["keyDiffs"] = {\n\t\toops(),\n\t},\n}\nreturn diff'
    );
    const v = await view();
    expect(v.warnings.join('\n')).toContain(broken);
    expect(v.warnings.join('\n')).toMatch(/line 3/);
    expect(device(v, 'WINWING ICP').file.error).toMatch(/line 3/);
    expect(device(v, 'WINWING UFC1').counts.fromUser).toBeGreaterThan(20);
  });
});

describe('DCS default input definitions', () => {
  it('loads the full F/A-18C and UH-1H command lists from the install, names and categories included', async () => {
    await start();
    const hornet = await view(HORNET);
    const huey = await view(HUEY);
    // Counts of distinct actions (by hash) across the joystick and keyboard layouts of the recorded install.
    expect(hornet.commands.filter((c) => !c.unmatched).length).toBe(1072);
    expect(huey.commands.filter((c) => !c.unmatched).length).toBe(525);
    for (const v of [hornet, huey]) {
      expect(v.warnings).toEqual([]);
      expect(v.commands.every((c) => c.name !== '' && !c.name.startsWith('d'))).toBe(true);
    }
    const trigger = hornet.commands.find((c) => c.name.startsWith('Gun Trigger - SECOND DETENT'))!;
    expect(trigger).toMatchObject({
      id: 'key:d3002pnilu3002cd13vd1vpnilvu0',
      category: ['Stick', 'HOTAS'],
      editable: true,
    });
    expect(hornet.commands.find((c) => c.name === 'Pitch')).toMatchObject({
      id: 'axis:a2001cdnil',
      category: ['Flight Control'],
    });
    expect(huey.commands.find((c) => c.name === 'Flight Control Collective')).toMatchObject({
      id: 'axis:a2087cdnil',
    });
    // Engine commands whose number nobody has told RigReady yet are listed, named, and marked.
    const unknown = hornet.commands.filter((c) => !c.editable);
    expect(unknown.length).toBe(hornet.uneditableCommands);
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown.length).toBeLessThan(250);
    expect(unknown.every((c) => /iCommand|ICommand/.test(c.hash) && !/iCommand/.test(c.name))).toBe(
      true
    );
  });

  it('a file DCS evaluates with code that is missing or broken is reported, not skipped silently', async () => {
    await start();
    const folder = path.join(
      rig.home,
      'Program Files (x86)/Steam/steamapps/common/DCSWorld/Mods/aircraft/FA-18C'
    );
    await fs.rm(path.join(folder, 'Cockpit', 'Scripts', 'command_defs.lua'));
    const v = await view();
    expect(v.warnings.join('\n')).toMatch(
      /default bindings for .* could not be read: .*command_defs\.lua/
    );
  });
});

describe('effective bindings', () => {
  it('are the defaults that apply to the device plus added minus removed from its diff', async () => {
    await start();
    const v = await view();
    // The pedals: the old diff removes pitch, roll and thrust and adds rudder and toe brakes.
    const pedals = device(v, 'T-Pendular-Rudder');
    expect(bound(v, pedals)).toEqual({
      JOY_X: ['Wheel Brake Right'],
      JOY_Y: ['Wheel Brake Left'],
      JOY_Z: ['Rudder'],
    });
    expect(pedals.bindings.some((b) => nameOf(v, b.commandId) === 'Pitch')).toBe(false);

    // The stick keeps its default pitch (with the user's curve) and roll; the default rudder twist is removed.
    const stick = device(v, 'WINWING Orion Joystick');
    const pitch = stick.bindings.find((b) => nameOf(v, b.commandId) === 'Pitch')!;
    expect(pitch).toMatchObject({ source: 'default', filterChanged: true, label: 'Y axis' });
    expect(pitch.combo.filter?.curvature).toEqual([0.15]);
    expect(bound(v, stick)['JOY_X']).toEqual(['Roll']);
    // Its diff cancels the default view on hat left; the hat trims instead.
    expect(stick.removed.map((r) => `${nameOf(v, r.commandId)} ${r.combo.key}`)).toContain(
      'View Left slow JOY_BTN_POV1_L'
    );
    expect(bound(v, stick)['JOY_BTN_POV1_L']).toEqual(['Trimmer Switch - LEFT WING DOWN']);
    expect(bound(v, stick)['JOY_BTN5']).toEqual(['Gun Trigger - SECOND DETENT (Press to shoot)']);

    // Modifiers are part of the input: LCtrl+LWin+Button 34 on the Virpil panel.
    const panel = device(v, 'R-VPC Panel');
    expect(
      panel.bindings.find((b) => b.combo.key === 'JOY_BTN34' && b.combo.reformers.length === 2)
    ).toMatchObject({ label: 'LCtrl + LWin + Button 34', source: 'user' });
  });

  it('a device with no diff file gets the full default set: this is why every new device has pitch and roll', async () => {
    await start();
    await fs.rm(await diffFile(rig.home, 'WINWING F18 STARTUP PANEL'));
    await fs.rm(await diffFile(rig.home, 'WINWING THROTTLE'));
    const v = await view();
    // The throttle is not in DCS's DefaultAssignments.lua, so it gets the generic stick axes.
    const throttle = device(v, 'WINWING THROTTLE');
    expect(throttle.file.source).toBe('none');
    expect(throttle.counts.fromUser).toBe(0);
    expect(bound(v, throttle)).toEqual({
      JOY_X: ['Roll'],
      JOY_Y: ['Pitch'],
      JOY_RZ: ['Rudder'],
      JOY_Z: ['Thrust'],
    });
    expect(throttle.bindings.find((b) => b.combo.key === 'JOY_Y')).toMatchObject({
      source: 'default',
      purpose: 'pitch',
    });
    // DCS ships a template for the startup panel, which it uses when the user has no file.
    const panel = device(v, 'WINWING F18 STARTUP PANEL');
    expect(panel.file.source).toBe('template');
    expect(panel.bindings.filter((b) => b.source === 'template').length).toBeGreaterThan(20);

    // The racing wheel has no file and no template: generic defaults on everything it has.
    const wheel = device(v, 'FANATEC');
    expect(wheel.file.source).toBe('none');
    expect(bound(v, wheel)).toMatchObject({
      JOY_X: ['Roll'],
      JOY_Y: ['Pitch'],
      JOY_RZ: ['Rudder'],
      JOY_Z: ['Thrust'],
      JOY_BTN_POV1_U: ['View Up slow'],
    });
    // The takeoff panel has no axes and no hat: its defaults exist but can never fire.
    const takeoff = device(v, 'WINWING F18 TAKEOFF PANEL 2');
    expect(takeoff.bindings.filter((b) => b.source === 'default').every((b) => b.inert)).toBe(true);
    expect(takeoff.counts.inert).toBe(8);
  });

  it('matches files to attached devices by GUID and lists files of devices that are not attached separately', async () => {
    await start();
    const names = await useOldBindings(rig.home, HORNET);
    const v = await view();
    const attached = v.devices.filter((d) => d.type === 'joystick' && d.connected);
    const files = v.devices.filter((d) => d.type === 'joystick' && !d.connected);
    expect(attached).toHaveLength(12);
    expect(files).toHaveLength(names.length);
    expect(files.every((d) => d.file.source === 'user' && d.guid !== undefined)).toBe(true);
    // The attached stick no longer has the user's bindings: they sit under the old id.
    expect(device({ ...v, devices: attached }, 'WINWING Orion Joystick').counts.fromUser).toBe(0);
    expect(joystickDir(rig.home)).toContain('FA-18C_hornet');
  });
});
