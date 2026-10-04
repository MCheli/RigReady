import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok } from '../../../../core/result';
import { fixturesDir, mutate, wiredApp, type WiredApp } from '../../../../../tests/helpers';
import type { LmuView, RacingOverview, WritePreviewView } from '../../contract';
import { lmuInputLabel } from './lmu';

describe('Le Mans Ultimate bindings', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  it('decodes the input ids: axis halves, hats and buttons', () => {
    expect(lmuInputLabel(5, '0EB7', '0007')).toBe('Accelerator (Z−)');
    expect(lmuInputLabel(11, '0EB7', '0007')).toBe('Brake (RZ−)');
    expect(lmuInputLabel(0, '0EB7', '0007')).toBe('Wheel (X+)');
    expect(lmuInputLabel(1)).toBe('X axis (X−)');
    expect(lmuInputLabel(16)).toBe('D-pad up');
    expect(lmuInputLabel(17)).toBe('D-pad right');
    expect(lmuInputLabel(23)).toBe('Hat 2 left');
    expect(lmuInputLabel(36)).toBe('Button 5');
    expect(lmuInputLabel(-1)).toBe('Input -1');
  });

  it('lists each control with its English name, device and input, matched to the connected wheel', async () => {
    app = await wiredApp('racing-fresh');
    const view = await app.invoke<LmuView>('racing:lmu');
    expect(view.installed).toBe(true);
    expect(view.devices).toHaveLength(1);
    expect(view.devices[0]).toMatchObject({
      name: 'FANATEC Podium Wheel Base DD2',
      vendorId: '0EB7',
      productId: '0007',
      type: 'Wheel',
      state: 'connected',
      bindingCount: 37,
    });
    expect(view.devices[0]!.forceFeedback).toContainEqual({
      label: 'Steering torque minimum',
      value: '0',
    });
    expect(view.devices[0]!.options).toContainEqual({
      label: 'Steering Wheel Maximum Rotation From Driver',
      value: 'On',
    });
    const throttle = view.bindings.find((b) => b.action === 'Throttle' && b.slot === 'primary');
    expect(throttle).toMatchObject({
      deviceName: 'FANATEC Podium Wheel Base DD2',
      input: 'Accelerator (Z−)',
    });
    expect(view.bindings.find((b) => b.action === 'Shift Up')!.input).toBe('Button 5');
    expect(
      view.bindings.find((b) => b.action === 'Bias Forward' && b.slot === 'alternative')!.input
    ).toBe('Button 104');
    expect(view.steering).toContainEqual({ label: 'Steering Wheel Range', value: '360' });
    expect(view.updatePending).toBe(false);
  });

  it('flags a referenced controller that is not connected, and the base in compatibility mode', async () => {
    app = await wiredApp('racing-fresh');
    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '0EB7', productId: '0007' } }]);
    expect((await app.invoke<LmuView>('racing:lmu')).devices[0]!.state).toBe('missing');
    // The same base back in yellow mode: it now reports itself as a ClubSport V2.5.
    app.ports.state.input.push({
      index: 0,
      name: 'FANATEC ClubSport Wheel Base V2.5',
      guid: '20B0BED0-03A4-11F1-8001-444553540000',
      productGuid: '00040EB7-0000-0000-0000-504944564944',
      vendorId: '0EB7',
      productId: '0004',
      numAxes: 8,
      numButtons: 108,
      numHats: 1,
      axisNames: [],
    });
    expect((await app.invoke<LmuView>('racing:lmu')).devices[0]!.state).toBe('other-mode');
  });

  it('shows an update waiting in Steam and the game running', async () => {
    app = await wiredApp('racing-fresh');
    await mutate(app, [
      { op: 'setSteamBuild', appId: '2399420', stateFlags: 6 },
      { op: 'startProcess', name: 'Le Mans Ultimate.exe', path: 'C:\\Games\\Le Mans Ultimate.exe' },
    ]);
    const view = await app.invoke<LmuView>('racing:lmu');
    expect(view.updatePending).toBe(true);
    expect(view.running).toBe(true);
  });

  it('reports a damaged bindings file instead of failing', async () => {
    app = await wiredApp('racing-fresh');
    const player = (await app.invoke<LmuView>('racing:lmu')).userFolder!;
    await fs.writeFile(path.join(player, 'direct input.json'), '{ not json');
    const view = await app.invoke<LmuView>('racing:lmu');
    expect(view.problems[0]).toContain('direct input.json is not valid JSON');
    expect(view.bindings).toEqual([]);
  });
});

/**
 * RACE-LMU-004. The scenario's direct input.json is the recorded one as it was before a
 * driver update renamed the wheel base: "Fanatec Podium DD2 Wheel Base" in the key, the
 * entry and all 37 bindings, while the connected base (same vendor and product id) is
 * "FANATEC Podium Wheel Base DD2".
 */
describe('Le Mans Ultimate: a controller Windows renamed', () => {
  const OLD = 'Fanatec Podium DD2 Wheel Base';
  const NEW = 'FANATEC Podium Wheel Base DD2';
  const SUFFIX = ':FSDeviceWheelDD-4EDAB5C3015B4FC5';
  const recorded = path.join(
    fixturesDir,
    'rigs/mark-full/files/Program Files (x86)/Steam/steamapps/common/Le Mans Ultimate/UserData/player/direct input.json'
  );

  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  const bindingsFile = async (target: WiredApp): Promise<string> =>
    path.join((await target.invoke<LmuView>('racing:lmu')).userFolder!, 'direct input.json');

  it('offers to update the name, shows the change first, writes only the name, and can be undone', async () => {
    app = await wiredApp('racing-lmu-renamed-wheel');
    const view = await app.invoke<LmuView>('racing:lmu');
    expect(view.devices).toHaveLength(1);
    expect(view.devices[0]).toMatchObject({
      key: `${OLD}${SUFFIX}`,
      name: OLD,
      vendorId: '0EB7',
      productId: '0007',
      state: 'renamed',
      bindingCount: 37,
      rename: { name: NEW, exact: false, bindings: 37 },
    });
    const overview = await app.invoke<RacingOverview>('racing:overview');
    expect(overview.games.find((g) => g.id === 'lmu')).toMatchObject({
      bindings: '1 controller has a new name',
      attention: true,
    });

    const file = await bindingsFile(app);
    const before = await fs.readFile(file, 'utf8');
    const preview = await app.invoke<WritePreviewView>('racing:lmuRepairPreview');
    expect(preview.summary).toBe('1 file modified');
    expect(preview.files).toMatchObject([
      { path: file, label: 'direct input.json', change: 'modified' },
    ]);
    // Looking wrote nothing.
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    const none = await app.ports.files.journal();
    expect(none.ok && none.value).toEqual([]);

    const done = await app.invoke<{ message: string }>('racing:lmuRepair');
    expect(done.message).toBe(
      `Pointed 37 bindings at ${NEW}. Start Le Mans Ultimate once and check they are still there. Undo is on the Safety page.`
    );
    // Only the name moved: the file is now, byte for byte, the one recorded from the rig.
    expect(await fs.readFile(file, 'utf8')).toBe(await fs.readFile(recorded, 'utf8'));
    const after = await app.invoke<LmuView>('racing:lmu');
    expect(after.devices[0]).toMatchObject({ name: NEW, state: 'connected', bindingCount: 37 });
    expect(after.devices[0]!.rename).toBeUndefined();
    expect(after.bindings.find((b) => b.action === 'Throttle')!.deviceName).toBe(NEW);
    // Nothing left to repair, so nothing is offered or done.
    await expect(app.invoke('racing:lmuRepairPreview')).rejects.toThrow('needs a new name');
    await expect(app.invoke('racing:lmuRepair')).rejects.toThrow('needs a new name');

    // One action on the Safety page, backed up first; Undo puts the old file back.
    const groups = await app.ports.files.journalGroups();
    if (!groups.ok) throw new Error(groups.error.message);
    expect(groups.value).toHaveLength(1);
    expect(groups.value[0]!.reason).toBe(`Point Le Mans Ultimate at the new name of ${NEW}`);
    expect(groups.value[0]!.entries).toMatchObject([
      { path: file, action: 'write', reason: 'Update the controller name in direct input.json' },
    ]);
    const backup = groups.value[0]!.entries[0]!.backupPath!;
    expect(await fs.readFile(backup, 'utf8')).toBe(before);
    const undone = await app.ports.files.undoGroup(groups.value[0]!.id);
    expect(undone.ok).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect((await app.invoke<LmuView>('racing:lmu')).devices[0]!.state).toBe('renamed');
  });

  it('is refused while the game runs, and never reports a change the file did not keep', async () => {
    app = await wiredApp('racing-lmu-renamed-wheel');
    const file = await bindingsFile(app);
    const before = await fs.readFile(file, 'utf8');
    await mutate(app, [
      { op: 'startProcess', name: 'Le Mans Ultimate.exe', path: 'C:\\Games\\Le Mans Ultimate.exe' },
    ]);
    await expect(app.invoke('racing:lmuRepair')).rejects.toThrow(
      'Close Le Mans Ultimate first. Le Mans Ultimate rewrites its player files when it starts and exits.'
    );
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    await mutate(app, [{ op: 'stopProcess', name: 'Le Mans Ultimate.exe' }]);

    // A write that is accepted and does not happen (a locked or redirected file).
    const write = app.ports.files.write.bind(app.ports.files);
    app.ports.files.write = async () => ok(null);
    await expect(app.invoke('racing:lmuRepair')).rejects.toThrow(
      'direct input.json did not keep the change.'
    );
    app.ports.files.write = write;
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  it('moves the bindings to the entry the game already made under the new name', async () => {
    app = await wiredApp('racing-lmu-renamed-wheel');
    const file = await bindingsFile(app);
    // The game ran once since the update: it added the base under its new name, with an id
    // of its own, and left the old entry and its bindings where they were.
    const di = JSON.parse(await fs.readFile(file, 'utf8')) as {
      Devices: Record<string, Record<string, unknown>>;
    };
    const newKey = `${NEW}:FSDeviceWheelDD-0123456789ABCDEF`;
    di.Devices[newKey] = {
      ...di.Devices[`${OLD}${SUFFIX}`],
      'product name': NEW,
      'instance name': `${NEW}:FSDeviceWheelDD`,
    };
    await fs.writeFile(file, JSON.stringify(di, null, 2));

    const view = await app.invoke<LmuView>('racing:lmu');
    expect(view.devices.map((d) => [d.name, d.state, d.bindingCount, d.rename?.exact])).toEqual([
      [OLD, 'renamed', 37, true],
      [NEW, 'connected', 0, undefined],
    ]);
    await app.invoke('racing:lmuRepair');
    const repaired = JSON.parse(await fs.readFile(file, 'utf8')) as {
      Devices: Record<string, unknown>;
      Input: Record<string, { device: string }>;
    };
    // Both entries are still there, untouched; every binding names the game's own new id.
    expect(repaired.Devices).toEqual(di.Devices);
    expect(new Set(Object.values(repaired.Input).map((b) => b.device))).toEqual(new Set([newKey]));
    const after = await app.invoke<LmuView>('racing:lmu');
    expect(after.devices.map((d) => [d.name, d.state, d.bindingCount])).toEqual([
      [OLD, 'connected', 0],
      [NEW, 'connected', 37],
    ]);
  });

  it('offers nothing where there is nothing to repair or the file is not as expected', async () => {
    // The name in the file is the name of the connected wheel.
    app = await wiredApp('racing-fresh');
    expect((await app.invoke<LmuView>('racing:lmu')).devices[0]!.rename).toBeUndefined();
    await expect(app.invoke('racing:lmuRepairPreview')).rejects.toThrow(
      'No controller in the Le Mans Ultimate bindings needs a new name.'
    );
    await app.cleanup();

    app = await wiredApp('racing-lmu-renamed-wheel');
    const file = await bindingsFile(app);
    const original = await fs.readFile(file, 'utf8');

    // A key that is not built from the product name: a layout this repair does not know.
    await fs.writeFile(file, original.replaceAll(`${OLD}${SUFFIX}`, 'Wheel-1'));
    let device = (await app.invoke<LmuView>('racing:lmu')).devices[0]!;
    expect(device).toMatchObject({ state: 'connected', bindingCount: 37 });
    expect(device.rename).toBeUndefined();
    await expect(app.invoke('racing:lmuRepair')).rejects.toThrow('needs a new name');
    expect(await fs.readFile(file, 'utf8')).toBe(original.replaceAll(`${OLD}${SUFFIX}`, 'Wheel-1'));
    await fs.writeFile(file, original);

    // Two connected controllers of the model with different names: RigReady does not guess.
    app.ports.state.input.push({
      ...app.ports.state.input.find((d) => d.vendorId === '0EB7')!,
      index: 9,
      name: 'FANATEC Podium Wheel Base DD2 (2)',
      guid: '20B0BED0-03A4-11F1-8002-444553540000',
    });
    device = (await app.invoke<LmuView>('racing:lmu')).devices[0]!;
    expect(device.state).toBe('connected');
    expect(device.rename).toBeUndefined();
    app.ports.state.input.pop();

    // The wheel is not connected at all: missing, not renamed.
    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '0EB7', productId: '0007' } }]);
    device = (await app.invoke<LmuView>('racing:lmu')).devices[0]!;
    expect(device.state).toBe('missing');
    expect(device.rename).toBeUndefined();

    // No bindings file at all.
    await fs.rm(file);
    await expect(app.invoke('racing:lmuRepair')).rejects.toThrow('has no bindings file');
  });
});
