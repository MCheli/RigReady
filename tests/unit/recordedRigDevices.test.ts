import { afterEach, describe, expect, it } from 'vitest';
import type { Overview } from '../../src/features/devices/core/model';
import { wiredApp, type WiredApp } from '../helpers';

/** DEV-001: what the Devices page is given for the recorded rig, through IPC as the page asks for it. */

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

describe('the recorded rig on the Devices page', () => {
  it('lists the nine WinWing game controllers, the TPR pedals, the Virpil panel, the Fanatec DD2, TrackIR and the Stream Deck, each with its ids', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const overview = await app.invoke<Overview>('devices:overview');
    const controllers = overview.devices.filter((d) => d.kind === 'controller');
    // Stick, throttle, three MFD frames, UFC + HUD, ICP, startup panel, takeoff panel.
    const winwing = controllers.filter((d) => d.vendorId === '4098');
    expect(winwing.map((d) => d.productName).sort()).toHaveLength(9);
    const byIds = (vendorId: string, productId: string) =>
      overview.devices.find((d) => d.vendorId === vendorId && d.productId === productId);
    // Thrustmaster TPR pedals, Virpil control panel, Fanatec Podium DD2: game controllers.
    for (const [vendorId, productId] of [
      ['044F', 'B68F'],
      ['3344', 'C259'],
      ['0EB7', '0007'],
    ] as const) {
      expect(byIds(vendorId, productId)?.kind, `${vendorId}:${productId}`).toBe('controller');
    }
    // TrackIR and the Stream Deck are devices, not game controllers.
    for (const name of ['TrackIR', 'Stream Deck']) {
      const device = overview.devices.find((d) => d.productName.includes(name));
      expect(device, name).toBeDefined();
      expect(device!.kind, name).toBe('other');
    }
    // Every row carries what the page shows: a name, VID and PID, where it is plugged in,
    // and for a game controller the DirectInput instance GUID a game knows it by.
    for (const device of overview.devices) {
      expect(device.name.length, device.key).toBeGreaterThan(0);
      expect(device.vendorId, device.key).toMatch(/^[0-9A-F]{4}$/);
      expect(device.productId, device.key).toMatch(/^[0-9A-F]{4}$/);
    }
    for (const device of controllers) {
      expect(device.instanceId, device.name).toBeTruthy();
      expect(device.controllers.length, device.name).toBeGreaterThan(0);
      for (const controller of device.controllers) {
        expect(controller.guid, device.name).toMatch(/^[0-9A-F-]{36}$/i);
      }
    }
    // Some devices report a serial and some do not: both are listed.
    expect(overview.devices.some((d) => d.serial)).toBe(true);
    expect(overview.devices.some((d) => !d.serial)).toBe(true);
  });
});
