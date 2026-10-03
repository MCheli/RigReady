/**
 * Read-only checks of the registry, services, DirectInput identities, Steam and process
 * closing against the real PC this runs on. They assert what must be true of any
 * working Windows machine, not what the owner's rig contains.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { identityForGuid, readDirectInputIdentities } from '../../src/core/directInput';
import { nullLogger } from '../../src/core/logger';
import { allowedRoots } from '../../src/core/paths';
import { listSteamApps } from '../../src/core/steam';
import { createWindowsPorts } from '../../src/platform/windows';
import { windowsOf } from '../../src/platform/windows/processes';
import { RegistryValueSchema, ServiceInfoSchema } from '../../src/shared/models';

const projectRoot = path.resolve(__dirname, '../..');
const ports = createWindowsPorts({ log: nullLogger, projectRoot });
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('real registry (read-only)', () => {
  it('reads strings, numbers and lists; missing keys and values are empty, not errors', async () => {
    const key = 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';
    const product = await ports.registry.getValue('HKLM', key, 'ProductName');
    expect(product.ok && product.value).toMatchObject({ type: 'string' });
    const build = await ports.registry.getValue('HKLM', key, 'CurrentMajorVersionNumber');
    expect(build).toEqual({ ok: true, value: { type: 'number', value: 10 } });
    const values = await ports.registry.listValues('HKLM', key);
    expect(values.ok).toBe(true);
    if (values.ok) {
      expect(Object.keys(values.value).length).toBeGreaterThan(10);
      for (const value of Object.values(values.value)) RegistryValueSchema.parse(value);
      // A binary value comes back as hex.
      expect(values.value['DigitalProductId']).toMatchObject({ type: 'binary' });
    }
    const keys = await ports.registry.listKeys('HKLM', 'SOFTWARE\\Microsoft\\Windows');
    expect(keys.ok && keys.value).toContain('CurrentVersion');
    const user = await ports.registry.listKeys('HKCU', 'Software');
    expect(user.ok && user.value.length).toBeGreaterThan(3);

    expect(await ports.registry.getValue('HKLM', key, 'NoSuchValue-RigReady')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await ports.registry.getValue('HKCU', 'Software\\NoSuchKey-RigReady', 'x')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await ports.registry.listKeys('HKCU', 'Software\\NoSuchKey-RigReady')).toEqual({
      ok: true,
      value: [],
    });
    expect(await ports.registry.listValues('HKCU', 'Software\\NoSuchKey-RigReady')).toEqual({
      ok: true,
      value: {},
    });
  });

  it('gives DirectInput instance GUIDs that match the live DirectInput list', async () => {
    const identities = await readDirectInputIdentities(ports.registry);
    expect(identities.ok).toBe(true);
    if (!identities.ok) return;
    for (const identity of identities.value) {
      for (const instance of identity.instances) {
        expect(instance.guid).toMatch(
          /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/
        );
      }
    }
    const started = await ports.input.start();
    await ports.input.stop();
    if (!started.ok) return;
    for (const device of started.value) {
      const identity = identityForGuid(identities.value, device.guid);
      expect(identity, `${device.name} ${device.guid}`).toBeDefined();
      expect(identity!.vendorId).toBe(device.vendorId);
      expect(identity!.productId).toBe(device.productId);
      // The registry's product name is the name DirectInput reports (DCS names files after it).
      if (identity!.name) expect(identity!.name).toBe(device.name);
    }
    console.log(
      `  ${identities.value.length} controller models in the registry, ${started.value.length} attached`
    );
  });
});

describe('real services, Steam and folders (read-only)', () => {
  it('lists Windows services with their state', async () => {
    const services = await ports.services.list();
    expect(services.ok).toBe(true);
    if (!services.ok) return;
    for (const service of services.value) ServiceInfoSchema.parse(service);
    expect(services.value.length).toBeGreaterThan(50);
    // Present and running on every Windows PC.
    const rpc = await ports.services.get('rpcss');
    expect(rpc.ok && rpc.value).toMatchObject({ name: 'RpcSs', state: 'running' });
    expect(rpc.ok && rpc.value!.pid).toBeGreaterThan(0);
    expect(await ports.services.get('NoSuchService-RigReady')).toEqual({
      ok: true,
      value: undefined,
    });
    console.log(
      `  ${services.value.length} services, ${services.value.filter((s) => s.state === 'running').length} running`
    );
  });

  it('resolves program folders, allowed roots and installed Steam games', async () => {
    for (const dir of [
      ports.folders.programFiles(),
      ports.folders.programFilesX86(),
      ports.folders.programData(),
    ]) {
      expect(path.isAbsolute(dir)).toBe(true);
    }
    const roots = await allowedRoots(ports);
    expect(roots).toContain(ports.folders.savedGames());
    const apps = await listSteamApps(ports);
    expect(apps.ok).toBe(true);
    if (apps.ok) {
      for (const app of apps.value) expect(app.buildId).toMatch(/^\d*$/);
      console.log(
        `  Steam games: ${apps.value.map((a) => `${a.name} (${a.buildId}${a.updatePending ? ', update pending' : ''})`).join('; ') || 'none'}`
      );
    }
  });

  it('notices nothing while no device is plugged or unplugged, and stops watching on unsubscribe', async () => {
    let changes = 0;
    const off = ports.devices.subscribe(() => changes++);
    await sleep(1800);
    off();
    expect(changes).toBe(0);
  });
});

describe('real process close', () => {
  it('closes a windowed program politely, and reports one that will not close unless forced', async () => {
    const system32 = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32');

    // Character Map: a classic windowed program that exits when its window is closed.
    const windowed = await ports.processes.start({
      exe: path.join(system32, 'charmap.exe'),
      args: [],
    });
    expect(windowed.ok && windowed.value.pid).toBeGreaterThan(0);
    if (!windowed.ok || !windowed.value.pid) return;
    const pid = windowed.value.pid;
    try {
      await expect
        .poll(() => windowsOf(pid).some((w) => w.visible), { timeout: 10_000 })
        .toBe(true);
      expect(await ports.processes.close(pid, { waitMs: 8000 })).toEqual({
        ok: true,
        value: { outcome: 'closed' },
      });
    } finally {
      await ports.processes.stop(pid);
    }

    // A console program without a window ignores the request.
    const hidden = await ports.processes.start({
      exe: path.join(system32, 'ping.exe'),
      args: ['-n', '30', '127.0.0.1'],
    });
    expect(hidden.ok && hidden.value.pid).toBeGreaterThan(0);
    if (!hidden.ok || !hidden.value.pid) return;
    try {
      expect(await ports.processes.close(hidden.value.pid, { waitMs: 700 })).toMatchObject({
        ok: false,
        error: { code: 'process.stillRunning' },
      });
      const still = await ports.processes.list();
      expect(still.ok && still.value.some((p) => p.pid === hidden.value.pid)).toBe(true);
      expect(await ports.processes.close(hidden.value.pid, { waitMs: 300, force: true })).toEqual({
        ok: true,
        value: { outcome: 'terminated' },
      });
    } finally {
      await ports.processes.stop(hidden.value.pid);
    }
    expect(await ports.processes.close(0x7ffffff0)).toMatchObject({
      ok: false,
      error: { code: 'process.stop' },
    });
  });
});
