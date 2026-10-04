/**
 * Read-only checks against the real hardware of the PC this runs on.
 * They assert what must be true of any working rig, not what Mark's rig contains.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { matchMonitors } from '../../src/core/displays/identity';
import { layoutToTargets } from '../../src/core/displays/layouts';
import { nullLogger } from '../../src/core/logger';
import { buildUsbTree } from '../../src/core/usb';
import { createWindowsPorts } from '../../src/platform/windows';
import {
  AudioStateSchema,
  DeviceInfoSchema,
  DisplayLayoutSchema,
  ProcessInfoSchema,
} from '../../src/shared/models';

const projectRoot = path.resolve(__dirname, '../..');
const ports = createWindowsPorts({ log: nullLogger, projectRoot });

afterAll(() => ports.input.stop());

describe('real hardware (read-only)', () => {
  it('lists USB devices with identity and a hub chain', async () => {
    const result = await ports.devices.list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    for (const device of result.value) DeviceInfoSchema.parse(device);
    const peripherals = result.value.filter((d) => !d.isHub);
    expect(peripherals.some((d) => d.isHid)).toBe(true);
    expect(peripherals.every((d) => d.hubChain.length > 0)).toBe(true);
    expect(new Set(result.value.map((d) => d.instanceId)).size).toBe(result.value.length);
    const tree = buildUsbTree(result.value);
    expect(tree.length).toBeGreaterThan(0);
    console.log(
      `  ${result.value.length} USB devices, ${peripherals.filter((d) => d.isHid).length} HID, ${tree.length} root hubs`
    );
  });

  it('reads every monitor with a unique stable id and exactly one primary', async () => {
    const result = await ports.displays.read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { displays } = DisplayLayoutSchema.parse(result.value);
    const enabled = displays.filter((d) => d.enabled);
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.filter((d) => d.primary)).toHaveLength(1);
    expect(new Set(displays.map((d) => d.id)).size).toBe(displays.length);
    for (const display of enabled) {
      expect(display.id.startsWith('\\\\?\\display#')).toBe(true);
      expect(display.width).toBeGreaterThan(0);
      expect(display.height).toBeGreaterThan(0);
    }
    // Reading twice gives the same answer: the ids are not session-dependent handles.
    const again = await ports.displays.read();
    expect(again).toEqual(result);
    for (const d of displays) {
      console.log(
        `  ${d.name || '(unnamed)'} ${d.enabled ? `${d.width}x${d.height} @${d.x},${d.y} rot ${d.rotation} (raw ${d.rawRotation}) ${d.refreshHz ?? '?'} Hz` : 'off'}${d.primary ? ' primary' : ''}` +
          ` | ${d.connector ?? '?'} | serial ${d.serial ?? '-'} | usb ${d.usbId ?? '-'} ${d.usbSerial ?? '-'} | ${d.modes?.length ?? 0} modes`
      );
    }
  });

  it('gives every monitor a connector, and identical monitors something that outlives a port change', async () => {
    const result = await ports.displays.read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { displays } = result.value;
    for (const d of displays) expect(d.connector, d.name).toBeTruthy();
    // An enabled monitor lists its modes, and its current mode is one of them.
    for (const d of displays.filter((m) => m.enabled)) {
      expect(d.modes?.length ?? 0, `${d.name} modes`).toBeGreaterThan(0);
      const sideways = d.rotation === 90 || d.rotation === 270;
      const width = sideways ? d.height : d.width;
      const height = sideways ? d.width : d.height;
      expect(
        d.modes!.some((m) => m.width === width && m.height === height),
        `${d.name} ${width}x${height} is a listed mode`
      ).toBe(true);
    }
    // Monitors of the same model must differ in EDID serial or in USB device serial;
    // otherwise only the connector tells them apart (allowed, but said here).
    const byModel = new Map<string, typeof displays>();
    for (const d of displays) {
      const model = d.edid ?? d.name;
      byModel.set(model, [...(byModel.get(model) ?? []), d]);
    }
    for (const [model, same] of byModel) {
      if (same.length < 2) continue;
      const keys = same.map((d) => d.usbSerial ?? d.serial ?? '');
      const distinct = new Set(keys.filter(Boolean)).size === same.length;
      console.log(
        `  ${same.length} x ${model}: ${distinct ? 'told apart by serial' : 'told apart only by connector'} (${keys.join(', ')})`
      );
      // A USB screen always has a USB device above it.
      for (const d of same.filter((m) => m.connector === 'USB')) {
        expect(d.usbId, `${d.name} usb id`).toMatch(/^[0-9A-F]{4}:[0-9A-F]{4}$/);
      }
    }
  });

  it('finds every monitor of the recorded fixture on this PC, by the identity that follows the monitor', async () => {
    const result = await ports.displays.read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fixture = DisplayLayoutSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(projectRoot, 'fixtures', 'rigs', 'mark-full', 'displays.json'),
          'utf8'
        )
      )
    );
    const matches = matchMonitors(layoutToTargets(fixture), result.value.displays);
    const missing = matches.filter((m) => !m.actual).map((m) => m.expected.name);
    console.log(
      `  fixture mark-full: ${fixture.displays.length} monitors, this PC: ${result.value.displays.length}; matched by ${matches.map((m) => m.how ?? 'nothing').join(', ')}`
    );
    // A monitor that is gone, or a new one (the TV), means the fixture should be recorded again.
    expect(missing, 'fixture monitors not connected now').toEqual([]);
    expect(result.value.displays.length, 'monitor count as recorded in the fixture').toBe(
      fixture.displays.length
    );
  });

  it('lists processes including this one, with image paths', async () => {
    const result = await ports.processes.list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const p of result.value.slice(0, 50)) ProcessInfoSchema.parse(p);
    const self = result.value.find((p) => p.pid === process.pid);
    expect(self?.path?.toLowerCase()).toBe(process.execPath.toLowerCase());
  });

  it('reads the default audio devices', async () => {
    const result = await ports.audio.read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = AudioStateSchema.parse(result.value);
    if (state.devices.some((d) => d.flow === 'playback')) {
      expect(state.defaultPlayback).toBeDefined();
      expect(state.devices.map((d) => d.id)).toContain(state.defaultPlayback!.id);
    }
    console.log(
      `  playback: ${state.defaultPlayback?.name ?? 'none'}; recording: ${state.defaultRecording?.name ?? 'none'}`
    );
  });

  it('resolves known folders and Steam libraries', async () => {
    const folders = ports.folders;
    for (const dir of [
      folders.home(),
      folders.documents(),
      folders.savedGames(),
      folders.appData(),
      folders.localAppData(),
    ]) {
      expect(path.isAbsolute(dir)).toBe(true);
    }
    const libraries = await folders.steamLibraries();
    expect(libraries.ok).toBe(true);
    if (libraries.ok) console.log(`  Steam libraries: ${libraries.value.join(', ') || 'none'}`);
  });

  it('honors RIGREADY_HOME and never leaves a redirected profile', async () => {
    const { WindowsKnownFolders } = await import('../../src/platform/windows/knownFolders');
    const redirected = new WindowsKnownFolders({
      USERPROFILE: 'C:\\Temp\\fake-user',
      APPDATA: 'C:\\Temp\\fake-user\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Temp\\fake-user\\AppData\\Local',
      RIGREADY_HOME: 'C:\\Temp\\fake-user\\rr',
    });
    expect(redirected.dataRoot()).toBe('C:\\Temp\\fake-user\\rr');
    expect(redirected.savedGames()).toBe('C:\\Temp\\fake-user\\Saved Games');
    expect(redirected.documents()).toBe('C:\\Temp\\fake-user\\Documents');
    expect(redirected.appData()).toBe('C:\\Temp\\fake-user\\AppData\\Roaming');
  });

  it('runs a program through Shell with an argument array and no shell', async () => {
    const result = await ports.shell.run(process.execPath, [
      '-e',
      'console.log(process.argv[1])',
      'a b & echo injected',
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.stdout.trim()).toBe('a b & echo injected');
  });

  it('starts the DirectInput sidecar and lists game controllers', async () => {
    const started = await ports.input.start();
    expect(
      started.ok,
      started.ok ? '' : `${started.error.message} ${started.error.detail ?? ''}`
    ).toBe(true);
    if (!started.ok) return;
    console.log(`  ${started.value.length} DirectInput devices`);
    // Everything Windows classes as a game controller must be listed, including pedals
    // with no buttons and button boxes with no axes (SDL/pygame dropped those).
    const usb = await ports.devices.list();
    if (usb.ok) {
      const seen = new Set(started.value.map((d) => `${d.vendorId}:${d.productId}`));
      const missing = usb.value
        .filter((d) => d.isGameController)
        .filter((d) => !seen.has(`${d.vendorId}:${d.productId}`))
        .map((d) => `${d.name} ${d.vendorId}:${d.productId}`);
      expect(missing).toEqual([]);
    }
    for (const device of started.value) {
      expect(device.guid).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
      expect(device.axisNames).toHaveLength(device.numAxes);
    }
    // Live state arrives for every device shortly after start.
    const reported = new Set<number>();
    const unsubscribe = ports.input.subscribe((states) => {
      for (const state of states) reported.add(state.index);
    });
    await expect.poll(() => reported.size, { timeout: 5000 }).toBe(started.value.length);
    unsubscribe();
    await ports.input.stop();
  });
});
