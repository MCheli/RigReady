import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../../tests/helpers';
import type { LmuView } from '../../contract';
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
