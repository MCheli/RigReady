import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  dcsGuidText,
  guidFromBytes,
  identityForDevice,
  identityForGuid,
  productGuidFor,
  readDirectInputIdentities,
  sameGuid,
} from '../../src/core/directInput';
import { allowedRoots, resolveAllowedPath } from '../../src/core/paths';
import { listSteamApps, parseAppManifest, readSteamApp, steamRoot } from '../../src/core/steam';
import {
  cleanupScenarioTemp,
  dialogScriptFromEnv,
  loadScenario,
  rehomePaths,
  seedScenario,
} from '../../src/platform/fake';
import { pngSize, solidPng } from '../../src/platform/fake/png';
import { MutationSchema, ScenarioSchema, applyMutations } from '../../src/platform/fake/scenario';
import { NodeHttp, NodeRawFs, headlessPorts } from '../../src/platform/node';
import {
  fixturesDir,
  markFull,
  mutate,
  rigFromState,
  scenarioRig,
  tempDir,
  type TestRig,
} from '../helpers';

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

const DI = 'System\\CurrentControlSet\\Control\\MediaProperties\\PrivateProperties\\DirectInput';

describe('registry (fake, from the recorded rig)', () => {
  it('reads values and lists keys and values, ignoring case; missing things are empty, not errors', async () => {
    rig = await rigFromState(await markFull());
    const { registry } = rig.ports;
    const steam = await registry.getValue(
      'HKLM',
      'software\\wow6432node\\VALVE\\steam',
      'installpath'
    );
    expect(steam.ok && steam.value).toEqual({
      type: 'string',
      // Recorded as C:\Program Files (x86)\Steam; in the fake it is inside the fake home.
      value: path.join(rig.home, 'Program Files (x86)', 'Steam'),
    });
    const models = await registry.listKeys('HKCU', DI);
    expect(models.ok && models.value).toContain('VID_044F&PID_B68F');
    const slots = await registry.listKeys('HKCU', `${DI}\\VID_3344&PID_C259\\Calibration`);
    expect(slots.ok && slots.value.sort()).toEqual(['0', '1']);
    const values = await registry.listValues('HKCU', `${DI}\\VID_044F&PID_B68F\\Calibration\\0`);
    expect(values.ok && values.value['GUID']).toEqual({
      type: 'binary',
      value: 'a056397f56b7f011801b444553540000',
    });
    expect(await registry.getValue('HKCU', 'Software\\Nope', 'x')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await registry.listKeys('HKCU', 'Software\\Nope')).toEqual({ ok: true, value: [] });
    expect(await registry.listValues('HKCU', 'Software\\Nope')).toEqual({ ok: true, value: {} });
  });
});

describe('DirectInput identities', () => {
  it('decodes registry GUID bytes and writes them the way DCS does', () => {
    expect(guidFromBytes('a056397f56b7f011801b444553540000')).toBe(
      '7F3956A0-B756-11F0-801B-444553540000'
    );
    expect(guidFromBytes('abcd')).toBeUndefined();
    expect(dcsGuidText('{7F3956A0-B756-11F0-801B-444553540000}')).toBe(
      '7F3956A0-B756-11f0-801B-444553540000'
    );
    expect(dcsGuidText('not-a-guid')).toBe('not-a-guid');
    expect(
      sameGuid('{7f3956a0-b756-11f0-801b-444553540000}', '7F3956A0-B756-11F0-801B-444553540000')
    ).toBe(true);
    expect(productGuidFor('044f', 'b68f')).toBe('B68F044F-0000-0000-0000-504944564944');
  });

  it('gives each controller model its name and instance GUIDs, joined to USB devices by VID/PID', async () => {
    rig = await rigFromState(await markFull());
    const identities = await readDirectInputIdentities(rig.ports.registry);
    if (!identities.ok) throw new Error(identities.error.message);

    const devices = await rig.ports.devices.list();
    if (!devices.ok) throw new Error('devices');
    const pedals = devices.value.find((d) => d.productId === 'B68F')!;
    expect(identityForDevice(identities.value, pedals)).toEqual({
      vendorId: '044F',
      productId: 'B68F',
      name: 'T-Pendular-Rudder',
      productGuid: 'B68F044F-0000-0000-0000-504944564944',
      instances: [{ slot: 0, guid: '7F3956A0-B756-11F0-801B-444553540000', joystickId: 1 }],
    });
    // The Virpil panel has a stale slot and a live one: two instance GUIDs for one VID/PID.
    const virpil = identityForDevice(identities.value, { vendorId: '3344', productId: 'C259' })!;
    expect(virpil.name).toBe('R-VPC Panel #1');
    expect(virpil.instances.map((i) => i.guid)).toEqual([
      'DF6F4BD0-FA0C-11F0-8001-444553540000',
      'DF6F4BD0-FA0C-11F0-8002-444553540000',
    ]);
    // A GUID from a DCS binding file name resolves back to the device model.
    expect(identityForGuid(identities.value, '{806E0610-B756-11f0-8024-444553540000}')?.name).toBe(
      'WINWING MFD1-R'
    );
    expect(
      identityForGuid(identities.value, '00000000-0000-0000-0000-000000000000')
    ).toBeUndefined();

    // Every game controller the live DirectInput list recorded has a matching registry slot.
    for (const input of rig.ports.input.devices()) {
      const identity = identityForGuid(identities.value, input.guid);
      expect(identity, input.name).toBeDefined();
      expect(`${identity!.vendorId}:${identity!.productId}`).toBe(
        `${input.vendorId}:${input.productId}`
      );
    }
    // Every DCS binding file in the recorded Saved Games folder names a known GUID.
    const seeded = await scenarioRig('desk-mfds-wrong', { files: ['Saved Games/DCS/Config/**'] });
    try {
      const folder = path.join(
        seeded.ports.folders.savedGames(),
        'DCS',
        'Config',
        'Input',
        'FA-18C_hornet',
        'joystick'
      );
      const files = (await fs.readdir(folder)).filter((f) => f.endsWith('.diff.lua'));
      expect(files.length).toBeGreaterThan(8);
      for (const file of files) {
        const guid = /\{([0-9A-Fa-f-]+)\}/.exec(file)![1]!;
        expect(identityForGuid(identities.value, guid), file).toBeDefined();
      }
    } finally {
      await seeded.cleanup();
    }
  });

  it('skips keys that are not controller models and slots without a GUID', async () => {
    rig = await rigFromState(await markFull());
    await mutate(rig, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: `${DI}\\NotAModel`,
        name: 'x',
        value: { type: 'number', value: 1 },
      },
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: `${DI}\\VID_1234&PID_5678\\Calibration\\0`,
        name: 'GUID',
        value: { type: 'string', value: 'not binary' },
      },
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: `${DI}\\VID_1234&PID_5678\\Calibration\\1`,
        name: 'GUID',
        value: { type: 'binary', value: '0102030405060708090a0b0c0d0e0f10' },
      },
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: `${DI}\\VID_1234&PID_5678\\Calibration\\1`,
        name: 'Joystick Id',
        value: { type: 'number', value: 7 },
      },
    ]);
    const identities = await readDirectInputIdentities(rig.ports.registry);
    if (!identities.ok) throw new Error('identities');
    expect(identities.value.some((i) => i.vendorId === 'NOTA')).toBe(false);
    expect(identityForDevice(identities.value, { vendorId: '1234', productId: '5678' })).toEqual({
      vendorId: '1234',
      productId: '5678',
      name: '',
      productGuid: '56781234-0000-0000-0000-504944564944',
      instances: [{ slot: 1, guid: '04030201-0605-0807-090A-0B0C0D0E0F10', joystickId: 7 }],
    });
  });
});

describe('Steam', () => {
  it('finds the library through the registry and reads app manifests from the recorded files', async () => {
    rig = await scenarioRig('desk-mfds-wrong', { files: ['Program Files (x86)/Steam/**'] });
    const library = path.join(rig.home, 'Program Files (x86)', 'Steam');
    expect((await steamRoot(rig.ports.registry))!.toLowerCase()).toBe(library.toLowerCase());
    const libraries = await rig.ports.folders.steamLibraries();
    expect(libraries).toEqual({ ok: true, value: [library] });

    const dcs = await readSteamApp(rig.ports, 223750);
    expect(dcs.ok && dcs.value).toMatchObject({
      appId: '223750',
      name: 'DCS World Steam Edition',
      library,
      installDir: path.join(library, 'steamapps', 'common', 'DCSWorld'),
      stateFlags: 4,
      updatePending: false,
    });
    expect(dcs.ok && dcs.value!.buildId).toMatch(/^\d+$/);
    expect(dcs.ok && dcs.value!.lastUpdated).toMatch(/^20\d\d-/);
    expect(await readSteamApp(rig.ports, '999')).toEqual({ ok: true, value: undefined });
    const all = await listSteamApps(rig.ports);
    expect(all.ok && all.value.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        'BeamNG.drive',
        'DCS World Steam Edition',
        'iRacing',
        'Le Mans Ultimate',
      ])
    );

    // A game updated since: the build id changes and Steam queues the update.
    await mutate(rig, [
      { op: 'setSteamBuild', appId: 2399420, stateFlags: 6, targetBuildId: '99999999' },
      { op: 'setSteamBuild', appId: '223750', buildId: 25700000, lastUpdated: 1800000000 },
    ]);
    const lmu = await readSteamApp(rig.ports, 2399420);
    expect(lmu.ok && lmu.value).toMatchObject({
      stateFlags: 6,
      updatePending: true,
      targetBuildId: '99999999',
    });
    const updated = await readSteamApp(rig.ports, 223750);
    expect(updated.ok && updated.value).toMatchObject({
      buildId: '25700000',
      lastUpdated: '2027-01-15T08:00:00.000Z',
      updatePending: true, // TargetBuildID still names the old build
    });
    await expect(mutate(rig, [{ op: 'setSteamBuild', appId: 1, buildId: 2 }])).rejects.toThrow(
      /found no appmanifest_1\.acf/
    );
  });

  it('reports unreadable manifests and works without Steam', async () => {
    expect(parseAppManifest('"AppState" { "appid" "1" ', 'C:\\Lib')).toMatchObject({
      ok: false,
      error: { code: 'steam.manifest' },
    });
    expect(parseAppManifest('"Other" { }', 'C:\\Lib')).toMatchObject({ ok: false });
    expect(parseAppManifest('"AppState" { "name" "x" }', 'C:\\Lib')).toMatchObject({ ok: false });
    expect(
      parseAppManifest('"AppState" { "appid" "5" "installdir" "Game" "buildid" "7" }', 'C:\\Lib')
    ).toEqual({
      ok: true,
      value: {
        appId: '5',
        name: '',
        library: 'C:\\Lib',
        installDir: 'C:\\Lib\\steamapps\\common\\Game',
        buildId: '7',
        stateFlags: 0,
        updatePending: false,
      },
    });
    rig = await rigFromState(await markFull());
    await mutate(rig, [{ op: 'removeRegistryKey', hive: 'HKCU', key: 'Software\\Valve\\Steam' }]);
    // Falls back to the machine-wide key...
    expect(await steamRoot(rig.ports.registry)).toBe(
      path.join(rig.home, 'Program Files (x86)', 'Steam')
    );
    await mutate(rig, [
      { op: 'removeRegistryKey', hive: 'HKLM', key: 'SOFTWARE\\WOW6432Node\\Valve\\Steam' },
    ]);
    // ...and without either there is no Steam.
    expect(await steamRoot(rig.ports.registry)).toBeUndefined();
    expect(await rig.ports.folders.steamLibraries()).toEqual({ ok: true, value: [] });
    expect(await listSteamApps(rig.ports)).toEqual({ ok: true, value: [] });
    expect(await readSteamApp(rig.ports, 1)).toEqual({ ok: true, value: undefined });
  });
});

describe('allowed roots', () => {
  it('are the data root, the user folders and the Steam libraries', async () => {
    rig = await rigFromState(await markFull());
    const roots = await allowedRoots(rig.ports);
    const f = rig.ports.folders;
    expect(roots).toEqual(
      expect.arrayContaining([
        f.dataRoot(),
        f.documents(),
        f.savedGames(),
        f.appData(),
        f.localAppData(),
      ])
    );
    expect(roots.some((r) => r.toLowerCase().endsWith('program files (x86)\\steam'))).toBe(true);
    expect(resolveAllowedPath(path.join(f.savedGames(), 'DCS', 'x.lua'), roots).ok).toBe(true);
    expect(resolveAllowedPath('C:\\Windows\\System32\\drivers\\etc\\hosts', roots)).toMatchObject({
      ok: false,
      error: { code: 'path.outside' },
    });
    expect(resolveAllowedPath(path.join(f.home(), 'Desktop', 'x.txt'), roots).ok).toBe(false);
  });
});

describe('audio, services, processes (fake)', () => {
  it('setDefault changes the default for the device flow and the chosen roles', async () => {
    rig = await rigFromState(await markFull());
    const before = await rig.ports.audio.read();
    if (!before.ok) throw new Error('audio');
    const headphones = before.value.devices.find((d) => d.name.startsWith('Headphones'))!;
    const mic = before.value.devices.find((d) => d.name.startsWith('Microphone (Steam'))!;

    const all = await rig.ports.audio.setDefault(headphones.id);
    expect(all.ok && all.value.defaultPlayback?.id).toBe(headphones.id);
    expect(all.ok && all.value.defaultCommsPlayback?.id).toBe(headphones.id);
    expect(all.ok && all.value.defaultRecording?.id).toBe(before.value.defaultRecording?.id);

    const comms = await rig.ports.audio.setDefault(mic.id, { roles: ['communications'] });
    expect(comms.ok && comms.value.defaultCommsRecording?.id).toBe(mic.id);
    expect(comms.ok && comms.value.defaultRecording?.id).toBe(before.value.defaultRecording?.id);
    const console = await rig.ports.audio.setDefault(mic.id, { roles: ['console'] });
    expect(console.ok && console.value.defaultRecording?.id).toBe(mic.id);

    expect(await rig.ports.audio.setDefault('nope')).toMatchObject({
      ok: false,
      error: { code: 'audio.missing' },
    });
    expect(rig.ports.audio.calls.map((c) => c.roles.length)).toEqual([3, 1, 1]);
  });

  it('lists services and finds one by name', async () => {
    rig = await rigFromState(await markFull());
    const hidHide = await rig.ports.services.get('hidhide');
    expect(hidHide.ok && hidHide.value).toMatchObject({ name: 'HidHide', state: 'running' });
    expect(await rig.ports.services.get('NoSuchService')).toEqual({ ok: true, value: undefined });
    const all = await rig.ports.services.list();
    expect(all.ok && all.value.length).toBeGreaterThan(100);

    await mutate(rig, [
      { op: 'setService', name: 'iRacingService', state: 'stopped' },
      { op: 'setService', name: 'NewService', state: 'running', displayName: 'A New Service' },
      { op: 'setService', name: 'mosquitto', state: 'absent' },
    ]);
    const stopped = await rig.ports.services.get('iRacingService');
    expect(stopped.ok && stopped.value).toMatchObject({ state: 'stopped' });
    expect(stopped.ok && stopped.value!.pid).toBeUndefined();
    const added = await rig.ports.services.get('newservice');
    expect(added.ok && added.value).toEqual({
      name: 'NewService',
      displayName: 'A New Service',
      state: 'running',
      pid: 4242,
    });
    expect(await rig.ports.services.get('mosquitto')).toEqual({ ok: true, value: undefined });
    await expect(
      mutate(rig, [{ op: 'setService', name: 'nope', state: 'absent' }])
    ).rejects.toThrow(/matched no service/);
  });

  it('close asks politely; a stubborn program only goes when forced', async () => {
    rig = await rigFromState(await markFull());
    const list = await rig.ports.processes.list();
    if (!list.ok) throw new Error('processes');
    const trackIr = list.value.find((p) => p.name === 'TrackIR5.exe')!;
    expect(await rig.ports.processes.close(trackIr.pid)).toEqual({
      ok: true,
      value: { outcome: 'closed' },
    });
    expect(await rig.ports.processes.close(trackIr.pid)).toMatchObject({
      ok: false,
      error: { code: 'process.stop' },
    });

    const simApp = list.value.find((p) => p.name === 'SimAppPro.exe')!;
    rig.ports.processes.stubborn.add('simapppro.exe');
    expect(await rig.ports.processes.close(simApp.pid, { waitMs: 2000 })).toMatchObject({
      ok: false,
      error: { code: 'process.stillRunning', message: expect.stringContaining('2 s') },
    });
    const still = await rig.ports.processes.list();
    expect(still.ok && still.value.some((p) => p.pid === simApp.pid)).toBe(true);
    expect(await rig.ports.processes.close(simApp.pid, { force: true })).toEqual({
      ok: true,
      value: { outcome: 'terminated' },
    });
    expect(rig.ports.processes.closed.map((c) => c.name)).toEqual([
      'TrackIR5.exe',
      'SimAppPro.exe',
      'SimAppPro.exe',
    ]);
  });

  it('device subscribers hear about live changes; unplugging also removes the controller from DirectInput', async () => {
    rig = await rigFromState(await markFull());
    let changes = 0;
    const off = rig.ports.devices.subscribe(() => changes++);
    const inputBefore = rig.ports.input.devices();
    expect(inputBefore.some((d) => d.name === 'T-Pendular-Rudder')).toBe(true);
    await mutate(rig, [{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
    expect(changes).toBe(1);
    const devices = await rig.ports.devices.list();
    expect(devices.ok && devices.value.some((d) => d.productId === 'B68F')).toBe(false);
    const inputAfter = rig.ports.input.devices();
    expect(inputAfter).toHaveLength(inputBefore.length - 1);
    expect(inputAfter.map((d) => d.index)).toEqual(inputAfter.map((_, i) => i));
    off();
    await mutate(rig, [{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
    expect(changes).toBe(1);

    // A new input subscriber starts with the last known state.
    rig.ports.input.emit([
      { index: 1, name: 'x', axes: [0.5], buttons: [], hats: [], timestamp: 1 },
    ]);
    const seen: number[] = [];
    rig.ports.input.subscribe((states) => seen.push(...states.map((s) => s.index)));
    expect(seen).toEqual([1]);
  });
});

describe('scenario mutations for audio, registry, HidHide and files', () => {
  it('setAudioDefault and unplugAudio', async () => {
    const base = await markFull();
    const next = applyMutations(base, [
      MutationSchema.parse({
        op: 'setAudioDefault',
        flow: 'playback',
        match: { name: 'arctis pro wireless game' },
      }),
      MutationSchema.parse({
        op: 'setAudioDefault',
        flow: 'recording',
        match: { name: 'Steam Streaming' },
        role: 'communications',
      }),
    ]);
    expect(next.audio.defaultPlayback?.name).toBe('Headphones (Arctis Pro Wireless Game)');
    expect(next.audio.defaultCommsPlayback?.name).toBe('Headphones (Arctis Pro Wireless Game)');
    expect(next.audio.defaultCommsRecording?.name).toBe('Microphone (Steam Streaming Microphone)');
    expect(next.audio.defaultRecording).toEqual(base.audio.defaultRecording);

    const unplugged = applyMutations(next, [
      MutationSchema.parse({ op: 'unplugAudio', match: { name: 'Arctis Pro Wireless Game' } }),
    ]);
    expect(unplugged.audio.devices).toHaveLength(base.audio.devices.length - 1);
    // Windows moves the default to another endpoint of the same kind.
    expect(unplugged.audio.defaultPlayback?.flow).toBe('playback');
    expect(unplugged.audio.defaultPlayback?.name).not.toContain('Wireless Game');
    const none = applyMutations(base, [
      MutationSchema.parse({ op: 'unplugAudio', match: { name: 'Headset Microphone' } }),
      MutationSchema.parse({ op: 'unplugAudio', match: { name: 'Microphone (Steam' } }),
    ]);
    expect(none.audio.defaultRecording).toBeUndefined();
    expect(() =>
      applyMutations(base, [
        MutationSchema.parse({
          op: 'setAudioDefault',
          flow: 'recording',
          match: { name: 'Speakers' },
        }),
      ])
    ).toThrow(/matched no audio device/);
    expect(MutationSchema.safeParse({ op: 'unplugAudio', match: {} }).success).toBe(false);
  });

  it('setRegistryValue sets, replaces and deletes; removeRegistryKey removes a subtree', async () => {
    const base = await markFull();
    const key = 'Software\\Eagle Dynamics\\DCS World';
    const next = applyMutations(base, [
      MutationSchema.parse({
        op: 'setRegistryValue',
        hive: 'HKCU',
        key,
        name: 'Path',
        value: { type: 'string', value: 'D:\\DCS World' },
      }),
      MutationSchema.parse({
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: key.toUpperCase(),
        name: 'PATH',
        value: { type: 'string', value: 'E:\\DCS' },
      }),
    ]);
    expect(next.registry[`HKCU\\${key}`]).toEqual({ Path: { type: 'string', value: 'E:\\DCS' } });
    const deleted = applyMutations(next, [
      MutationSchema.parse({
        op: 'setRegistryValue',
        hive: 'HKCU',
        key,
        name: 'path',
        value: null,
      }),
    ]);
    expect(deleted.registry[`HKCU\\${key}`]).toEqual({});
    expect(() =>
      applyMutations(base, [
        MutationSchema.parse({ op: 'setRegistryValue', hive: 'HKCU', key, name: 'x', value: null }),
      ])
    ).toThrow(/found no value to delete/);

    const removed = applyMutations(base, [
      MutationSchema.parse({
        op: 'removeRegistryKey',
        hive: 'HKCU',
        key: `${DI}\\VID_3344&PID_C259\\Calibration\\1`,
      }),
    ]);
    expect(
      Object.keys(removed.registry).some((k) => k.includes('VID_3344&PID_C259\\Calibration\\1'))
    ).toBe(false);
    expect(
      Object.keys(removed.registry).some((k) => k.includes('VID_3344&PID_C259\\Calibration\\0'))
    ).toBe(true);
    expect(() =>
      applyMutations(base, [
        MutationSchema.parse({ op: 'removeRegistryKey', hive: 'HKLM', key: 'SOFTWARE\\Nope' }),
      ])
    ).toThrow(/matched no key/);
  });

  it('hideDevice puts a device on the HidHide list, and the fake HidHideCLI answers like the real one', async () => {
    rig = await rigFromState(await markFull());
    const cli = rig.ports.state.hidHide.cliPath!;
    expect(cli).toBe(
      path.join(
        rig.home,
        'Program Files',
        'Nefarius Software Solutions',
        'HidHide',
        'x64',
        'HidHideCLI.exe'
      )
    );
    const query = ['--cloak-state', '--inv-state', '--dev-list', '--app-list', '--cancel'];
    const before = await rig.ports.shell.run(cli, query);
    if (!before.ok) throw new Error('shell');
    const lines = before.value.stdout.trim().split('\r\n');
    expect(lines.slice(0, 2)).toEqual(['--cloak-off', '--inv-off']);
    expect(lines.filter((l) => l.startsWith('--app-reg "'))).toHaveLength(3);
    expect(lines.some((l) => l.startsWith('--dev-hide'))).toBe(false);

    await mutate(rig, [{ op: 'hideDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
    const after = await rig.ports.shell.run(cli, query);
    if (!after.ok) throw new Error('shell');
    expect(after.value.stdout).toContain('--cloak-on');
    expect(after.value.stdout).toMatch(/--dev-hide "HID\\VID_044F&PID_B68F\\[^"]+"/);

    const gaming = await rig.ports.shell.run(cli, ['--dev-gaming', '--cancel']);
    if (!gaming.ok) throw new Error('shell');
    const parsed = JSON.parse(gaming.value.stdout) as { friendlyName: string }[];
    expect(parsed.length).toBeGreaterThan(5);

    // Changes are saved only when --cancel is not the last argument, as with the real CLI.
    await rig.ports.shell.run(cli, ['--cloak-off', '--cancel']);
    expect(rig.ports.state.hidHide.cloak).toBe(true);
    await rig.ports.shell.run(cli, [
      '--cloak-off',
      '--app-reg',
      'C:\\DCS\\bin\\DCS.exe',
      '--dev-hide',
      'HID\\X',
    ]);
    expect(rig.ports.state.hidHide).toMatchObject({ cloak: false });
    expect(rig.ports.state.hidHide.apps).toContain('C:\\DCS\\bin\\DCS.exe');
    await rig.ports.shell.run(cli, ['--dev-unhide', 'hid\\x', '--cloak-on']);
    expect(rig.ports.state.hidHide.hidden).not.toContain('HID\\X');

    await mutate(rig, [
      { op: 'setHidHide', cloak: false, inverse: true, apps: [] },
      { op: 'hideDevice', match: { name: 'stream deck' }, cloak: false },
    ]);
    const inverse = await rig.ports.shell.run(cli, query);
    expect(inverse.ok && inverse.value.stdout).toContain('--inv-on');
    expect(inverse.ok && inverse.value.stdout).toContain('--cloak-off');
    expect(inverse.ok && inverse.value.stdout).not.toContain('--app-reg');
    // Not a gaming device: the hidden entry is built from its USB identity.
    expect(rig.ports.state.hidHide.hidden.some((h) => h.startsWith('HID\\VID_0FD9&'))).toBe(true);

    await mutate(rig, [{ op: 'setHidHide', installed: false }]);
    expect(await rig.ports.shell.run(cli, query)).toMatchObject({
      ok: false,
      error: { code: 'shell.spawn' },
    });
    await expect(
      mutate(rig, [{ op: 'hideDevice', match: { name: 'no such device' } }])
    ).rejects.toThrow(/matched no device/);
  });

  it('writeFile and removeFile change the fake home; paths cannot leave it', async () => {
    rig = await scenarioRig('desk-mfds-wrong', { files: ['Saved Games/DCS/Scripts/**'] });
    const scripts = path.join(rig.ports.folders.savedGames(), 'DCS', 'Scripts');
    expect(await rig.ports.files.exists(path.join(scripts, 'Export.lua'))).toBe(true);
    await mutate(rig, [
      { op: 'writeFile', path: 'Saved Games/DCS/Scripts/Export.lua', content: '-- emptied\n' },
      {
        op: 'writeFile',
        path: 'Documents\\note.txt',
        from: path.join(fixturesDir, 'scenarios', 'racing-fresh.yaml'),
      },
      { op: 'removeFile', path: 'Saved Games/DCS/Scripts/wwt' },
    ]);
    expect(await fs.readFile(path.join(scripts, 'Export.lua'), 'utf8')).toBe('-- emptied\n');
    expect(await fs.readFile(path.join(rig.home, 'Documents', 'note.txt'), 'utf8')).toContain(
      'rig:'
    );
    expect(await rig.ports.files.exists(path.join(scripts, 'wwt'))).toBe(false);
    await expect(mutate(rig, [{ op: 'removeFile', path: 'Saved Games/nope.txt' }])).rejects.toThrow(
      /matched no file/
    );
    for (const bad of ['C:\\Windows\\x.txt', '..\\outside.txt', '/etc/passwd', 'a/../../b']) {
      expect(MutationSchema.safeParse({ op: 'removeFile', path: bad }).success, bad).toBe(false);
    }
    expect(MutationSchema.safeParse({ op: 'writeFile', path: 'a.txt' }).success).toBe(false);
    expect(
      MutationSchema.safeParse({ op: 'writeFile', path: 'a.txt', content: 'x', from: 'y' }).success
    ).toBe(false);
  });
});

describe('scripted ports', () => {
  it('http answers from the script, records requests, and refuses anything unscripted', async () => {
    rig = await rigFromState(await markFull(), {
      http: ScenarioSchema.parse({
        description: 'x',
        rig: 'mark-full',
        http: [
          {
            match: { url: 'api.anthropic.com/v1/messages', method: 'post' },
            response: { json: { ok: 1 } },
            times: 1,
          },
          {
            match: { url: 'api.anthropic.com', body: 'second' },
            response: { status: 429, headers: { 'Retry-After': '3' }, body: 'slow down' },
          },
          { match: { url: 'down.example' }, error: 'ECONNREFUSED' },
        ],
      }).http,
      shell: [],
      dialogs: { open: [], save: [] },
    });
    const { http } = rig.ports;
    const first = await http.request({
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': 'test-key' },
      body: '{"first":true}',
    });
    expect(first).toEqual({
      ok: true,
      value: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":1}' },
    });
    // The first entry is used up; the next match needs the body to fit.
    expect(
      await http.request({
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        body: 'x',
      })
    ).toMatchObject({ ok: false, error: { code: 'http.unscripted' } });
    expect(
      await http.request({
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        body: 'second',
      })
    ).toEqual({
      ok: true,
      value: { status: 429, headers: { 'retry-after': '3' }, body: 'slow down' },
    });
    expect(await http.request({ url: 'https://down.example/' })).toMatchObject({
      ok: false,
      error: { code: 'http.network', detail: 'ECONNREFUSED' },
    });
    http.respond('example.org', { json: { hello: 'world' } });
    const added = await http.request({ url: 'https://example.org/x' });
    expect(added.ok && JSON.parse(added.value.body)).toEqual({ hello: 'world' });
    expect(http.calls).toHaveLength(5);
    expect(http.calls[0]!.headers).toEqual({ 'x-api-key': 'test-key' });
  });

  it('the real http port refuses anything but https and reports unreachable hosts', async () => {
    const http = new NodeHttp();
    expect(await http.request({ url: 'http://example.org/' })).toMatchObject({
      ok: false,
      error: { code: 'http.url' },
    });
    expect(await http.request({ url: 'not a url' })).toMatchObject({
      ok: false,
      error: { code: 'http.url' },
    });
    // Port 1 on this machine: nothing listens, so the request fails without leaving the PC.
    expect(await http.request({ url: 'https://127.0.0.1:1/', timeoutMs: 5000 })).toMatchObject({
      ok: false,
      error: { code: expect.stringMatching(/^http\.(network|timeout)$/) },
    });
  });

  it('dialogs return scripted paths in order, then "cancelled"', async () => {
    rig = await rigFromState(await markFull(), {
      http: [],
      shell: [],
      dialogs: { open: [['Documents/in.rigready'], []], save: ['Documents/out.zip', null] },
    });
    const { dialogs } = rig.ports;
    expect(await dialogs.open({ title: 'Import' })).toEqual({
      ok: true,
      value: [path.join(rig.home, 'Documents/in.rigready')],
    });
    expect(await dialogs.open()).toEqual({ ok: true, value: [] });
    expect(await dialogs.open()).toEqual({ ok: true, value: [] });
    expect(await dialogs.save({ defaultPath: 'x.zip' })).toEqual({
      ok: true,
      value: path.join(rig.home, 'Documents/out.zip'),
    });
    expect(await dialogs.save()).toEqual({ ok: true, value: null });
    expect(await dialogs.save()).toEqual({ ok: true, value: null });
    dialogs.script.open.push(['C:\\Absolute\\file.txt']);
    expect(await dialogs.open()).toEqual({ ok: true, value: ['C:\\Absolute\\file.txt'] });
    expect(dialogs.calls.map((c) => c.kind)).toEqual([
      'open',
      'open',
      'open',
      'save',
      'save',
      'save',
      'open',
    ]);

    expect(
      dialogScriptFromEnv({
        RIGREADY_DIALOG_OPEN: '[["a.txt"]]',
        RIGREADY_DIALOG_SAVE: '["b.txt", null]',
      })
    ).toEqual({ open: [['a.txt']], save: ['b.txt', null] });
    expect(dialogScriptFromEnv({})).toEqual({ open: [], save: [] });
    expect(() => dialogScriptFromEnv({ RIGREADY_DIALOG_OPEN: 'nope' })).toThrow(/must be JSON/);
  });

  it('shell answers from the script before falling back to "ran, no output"', async () => {
    rig = await rigFromState(await markFull(), {
      http: [],
      shell: [
        {
          match: { exe: 'tasklist', args: ['/FO'] },
          result: { code: 3, stdout: 'out', stderr: 'err' },
        },
      ],
      dialogs: { open: [], save: [] },
    });
    expect(
      await rig.ports.shell.run('C:\\Windows\\System32\\TASKLIST.exe', ['/FO', 'CSV'])
    ).toEqual({
      ok: true,
      value: { code: 3, stdout: 'out', stderr: 'err' },
    });
    expect(await rig.ports.shell.run('C:\\Windows\\System32\\tasklist.exe', [])).toEqual({
      ok: true,
      value: { code: 0, stdout: '', stderr: '' },
    });
    expect(rig.ports.shell.calls).toHaveLength(2);
  });

  it('render returns a real PNG of the asked size and a PDF, and records the HTML', async () => {
    rig = await rigFromState(await markFull());
    const png = await rig.ports.render.png('<h1>Cheat sheet</h1>', { width: 768, height: 1024 });
    if (!png.ok) throw new Error('png');
    expect(pngSize(png.value)).toEqual({ width: 768, height: 1024 });
    expect(pngSize(new Uint8Array(30))).toBeUndefined();
    expect(pngSize(solidPng(3, 2, [1, 2, 3]))).toEqual({ width: 3, height: 2 });
    expect(await rig.ports.render.png('x', { width: 0, height: 10 })).toMatchObject({
      ok: false,
      error: { code: 'render.size' },
    });
    const pdf = await rig.ports.render.pdf('<p>page</p>');
    expect(pdf.ok && new TextDecoder().decode(pdf.value).startsWith('%PDF-')).toBe(true);
    const fake = rig.ports.render as unknown as { calls: { kind: string; html: string }[] };
    expect(fake.calls.map((c) => [c.kind, c.html])).toEqual([
      ['png', '<h1>Cheat sheet</h1>'],
      ['pdf', '<p>page</p>'],
    ]);
  });

  it('secrets, notifications and the login item are in-memory stand-ins', async () => {
    rig = await rigFromState(await markFull());
    const { secrets, notifications, loginItem } = rig.ports;
    expect(await secrets.get('anthropic-api-key')).toEqual({ ok: true, value: undefined });
    await secrets.set('anthropic-api-key', 'test-key-not-real');
    expect(await secrets.get('anthropic-api-key')).toEqual({
      ok: true,
      value: 'test-key-not-real',
    });
    await secrets.remove('anthropic-api-key');
    expect(await secrets.get('anthropic-api-key')).toEqual({ ok: true, value: undefined });

    await notifications.notify({ title: 'Pedals unplugged', body: 'T-Pendular-Rudder' });
    expect(notifications.sent).toEqual([{ title: 'Pedals unplugged', body: 'T-Pendular-Rudder' }]);

    expect(await loginItem.isEnabled()).toEqual({ ok: true, value: false });
    await loginItem.setEnabled(true);
    expect(await loginItem.isEnabled()).toEqual({ ok: true, value: true });
  });

  it('outside the app, the Electron-only ports say so instead of pretending', async () => {
    for (const result of [
      await headlessPorts.secrets.get('x'),
      await headlessPorts.secrets.set('x', 'y'),
      await headlessPorts.secrets.remove('x'),
      await headlessPorts.dialogs.open(),
      await headlessPorts.dialogs.save(),
      await headlessPorts.render.png('x', { width: 1, height: 1 }),
      await headlessPorts.render.pdf('x'),
      await headlessPorts.notifications.notify({ title: 'a', body: 'b' }),
      await headlessPorts.loginItem.isEnabled(),
      await headlessPorts.loginItem.setEnabled(true),
      await headlessPorts.shortcuts.build({ target: 'C:\\x.exe', args: [] }),
      await headlessPorts.shortcuts.read('C:\\x.lnk'),
      await headlessPorts.taskbar.setJumpTasks([]),
      await headlessPorts.taskbar.setOverlay(null),
      await headlessPorts.taskbar.setTooltip('x'),
      await headlessPorts.taskbar.setProgress({ mode: 'none' }),
      await headlessPorts.taskbar.setButtons([]),
      await headlessPorts.hotkeys.register('makeReady', 'Control+Alt+R'),
      await headlessPorts.hotkeys.unregister('makeReady'),
      await headlessPorts.hotkeys.registered('makeReady'),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'port.unavailable' } });
    }
    // What starts this program is known without the app.
    expect(headlessPorts.shortcuts.self()).toEqual({ exe: process.execPath, args: [] });
    // Nothing presses a taskbar button outside the app: subscribing is harmless.
    const pressed: string[] = [];
    headlessPorts.taskbar.subscribe((id) => pressed.push(id))();
    headlessPorts.hotkeys.subscribe((id) => pressed.push(id))();
    expect(pressed).toEqual([]);
  });

  it('the fake hotkeys are what "Windows" has registered: one per name, none that another program has', async () => {
    rig = await rigFromState(await markFull());
    const { hotkeys } = rig.ports;
    const pressed: string[] = [];
    const off = hotkeys.subscribe((id) => pressed.push(id));
    expect(await hotkeys.registered('makeReady')).toEqual({ ok: true, value: undefined });
    // Nothing registered: a press reaches nobody.
    expect(hotkeys.press('makeReady')).toBe(false);

    expect(await hotkeys.register('makeReady', 'Control+Alt+R')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await hotkeys.registered('makeReady')).toEqual({ ok: true, value: 'Control+Alt+R' });
    expect(hotkeys.press('makeReady')).toBe(true);
    expect(pressed).toEqual(['makeReady']);

    // Another program has it, or another name of ours has it: refused, and the old one stays.
    hotkeys.taken.add('Control+Alt+F12');
    expect(await hotkeys.register('makeReady', 'Control+Alt+F12')).toMatchObject({
      ok: false,
      error: { code: 'hotkey.taken' },
    });
    expect(await hotkeys.register('other', 'Control+Alt+R')).toMatchObject({
      ok: false,
      error: { code: 'hotkey.taken' },
    });
    expect(await hotkeys.registered('makeReady')).toEqual({ ok: true, value: 'Control+Alt+R' });
    // The same combination again under the same name is fine; a new one replaces it.
    expect((await hotkeys.register('makeReady', 'Control+Alt+R')).ok).toBe(true);
    expect((await hotkeys.register('makeReady', 'Control+Shift+F9')).ok).toBe(true);
    expect([...hotkeys.active]).toEqual([['makeReady', 'Control+Shift+F9']]);

    await hotkeys.unregister('makeReady');
    await hotkeys.unregister('never-there');
    expect(hotkeys.active.size).toBe(0);
    expect(hotkeys.press('makeReady')).toBe(false);
    off();
    expect(pressed).toEqual(['makeReady']);
  });

  it('the fake taskbar button remembers what it was told, and a press reaches whoever listens', async () => {
    rig = await rigFromState(await markFull());
    const { taskbar } = rig.ports;
    const icon = { width: 1, height: 1, pixels: new Uint8Array(4) };
    expect([taskbar.jumpTasks, taskbar.overlay, taskbar.tooltip, taskbar.progress]).toEqual([
      [],
      null,
      '',
      { mode: 'none' },
    ]);
    const task = {
      title: 'Launch A',
      description: 'Make the rig ready for A',
      args: ['--launch=a'],
    };
    expect(await taskbar.setJumpTasks([task])).toEqual({ ok: true, value: undefined });
    await taskbar.setOverlay({ icon, description: 'A: Ready' });
    await taskbar.setTooltip('RigReady - A: Ready');
    await taskbar.setProgress({ mode: 'indeterminate' });
    await taskbar.setProgress({ mode: 'normal', value: 0.5 });
    await taskbar.setProgress({ mode: 'none' });
    expect(taskbar.jumpTasks).toEqual([task]);
    expect(taskbar.jumpListWrites).toBe(1);
    expect(taskbar.overlay?.description).toBe('A: Ready');
    expect(taskbar.tooltip).toBe('RigReady - A: Ready');
    expect(taskbar.progress).toEqual({ mode: 'none' });
    expect(taskbar.progressSeen).toEqual([
      { mode: 'indeterminate' },
      { mode: 'normal', value: 0.5 },
      { mode: 'none' },
    ]);
    await taskbar.setOverlay(null);
    expect(taskbar.overlay).toBeNull();

    // Buttons: one that is on reaches the listener, one that is off (or not there) does not.
    const pressed: string[] = [];
    const off = taskbar.subscribe((id) => pressed.push(id));
    expect(taskbar.press('launch')).toBe(false);
    await taskbar.setButtons([
      { id: 'makeReady', tooltip: 'Make ready', icon, enabled: true },
      { id: 'launch', tooltip: 'Launch', icon, enabled: false },
    ]);
    expect(taskbar.press('makeReady')).toBe(true);
    expect(taskbar.press('launch')).toBe(false);
    expect(taskbar.press('standDown')).toBe(false);
    expect(pressed).toEqual(['makeReady']);
    off();
    expect(taskbar.press('makeReady')).toBe(true);
    expect(pressed).toEqual(['makeReady']);
  });
});

describe('seeding the fake home', () => {
  it('re-points recorded paths at the fake home in every separator style', () => {
    const home = 'D:\\tmp\\home';
    expect(rehomePaths('C:\\Users\\User\\Saved Games\\DCS', home)).toBe(
      'D:\\tmp\\home\\Saved Games\\DCS'
    );
    expect(rehomePaths('"path"\t"C:\\\\Program Files (x86)\\\\Steam"', home)).toBe(
      '"path"\t"D:\\\\tmp\\\\home\\\\Program Files (x86)\\\\Steam"'
    );
    expect(rehomePaths('c:/program files (x86)/steam/steam.exe', home)).toBe(
      'D:/tmp/home/program files (x86)/steam/steam.exe'
    );
    expect(rehomePaths('C:\\Program Files\\Fanatec and C:\\ProgramData\\x', home)).toBe(
      'D:\\tmp\\home\\Program Files\\Fanatec and D:\\tmp\\home\\ProgramData\\x'
    );
    // Other users, other drives and look-alikes are left alone.
    for (const same of [
      'C:\\Users\\Username\\x',
      'D:\\Program Files\\x',
      'C:\\Program FilesX\\x',
      'C:\\Users\\Public',
    ]) {
      expect(rehomePaths(same, home)).toBe(same);
    }
  });

  it('copies the recorded files, re-points paths inside them, and leaves a seeded home alone', async () => {
    rig = await scenarioRig('desk-mfds-wrong');
    const { folders, files } = rig.ports;
    // User files and install files are both under the fake home.
    for (const file of [
      path.join(folders.savedGames(), 'DCS', 'Config', 'options.lua'),
      path.join(folders.savedGames(), 'DCS', 'Scripts', 'Export.lua'),
      path.join(folders.documents(), 'iRacing', 'controls.cfg'),
      path.join(folders.appData(), 'SimAppPro', 'GameExtendDisplay', 'MFD', 'DCS_config.json'),
      path.join(folders.localAppData(), 'BeamNG', 'BeamNG.drive.ini'),
      path.join(
        folders.programFilesX86(),
        'Steam',
        'steamapps',
        'common',
        'DCSWorld',
        'bin',
        'DCS.exe'
      ),
      path.join(folders.programFilesX86(), 'iRacing', 'version_system.txt'),
    ]) {
      expect(await files.exists(file), file).toBe(true);
    }
    // The account file SimAppPro keeps next to its settings is never recorded.
    expect(await files.exists(path.join(folders.appData(), 'SimAppPro', 'config.json'))).toBe(
      false
    );

    const config = await files.readText(
      path.join(folders.appData(), 'SimAppPro', 'GameExtendDisplay', 'MFD', 'DCS_config.json')
    );
    expect(config.ok && config.value).not.toContain('C:\\\\Users\\\\User');
    expect(config.ok && config.value).toContain(rig.home.replace(/\\/g, '\\\\'));

    // Binding files are byte-for-byte what was recorded.
    const relative = path.join('Saved Games', 'DCS', 'Config', 'Input', 'disabled.lua');
    expect(await fs.readFile(path.join(rig.home, relative))).toEqual(
      await fs.readFile(path.join(fixturesDir, 'rigs', 'mark-full', 'files', relative))
    );

    // A second start on the same home keeps what the user did meanwhile.
    const options = path.join(folders.savedGames(), 'DCS', 'Config', 'options.lua');
    await fs.writeFile(options, 'changed by the user');
    await fs.rm(path.join(folders.savedGames(), 'DCS', 'Scripts', 'Export.lua'));
    const loaded = await loadScenario(
      path.join(fixturesDir, 'scenarios', 'desk-mfds-wrong.yaml'),
      fixturesDir
    );
    await seedScenario(loaded, rig.ports);
    expect(await fs.readFile(options, 'utf8')).toBe('changed by the user');
    expect(
      await files.exists(path.join(folders.savedGames(), 'DCS', 'Scripts', 'Export.lua'))
    ).toBe(false);
  });

  it('the rehome list names every recorded file that holds a path to re-point', async () => {
    const rigDir = path.join(fixturesDir, 'rigs', 'mark-full');
    const list = new Set(
      JSON.parse(await fs.readFile(path.join(rigDir, 'rehome.json'), 'utf8')) as string[]
    );
    const raw = new NodeRawFs();
    const walk = async (dir: string, prefix: string): Promise<string[]> => {
      const out: string[] = [];
      for (const name of await raw.list(dir)) {
        const stat = await raw.stat(path.join(dir, name));
        if (stat?.isDirectory) out.push(...(await walk(path.join(dir, name), `${prefix}${name}/`)));
        else out.push(`${prefix}${name}`);
      }
      return out;
    };
    const holding: string[] = [];
    for (const relative of await walk(path.join(rigDir, 'files'), '')) {
      const text = await fs.readFile(path.join(rigDir, 'files', relative), 'latin1');
      if (rehomePaths(text, 'Z:\\h') !== text) holding.push(relative);
    }
    expect(holding.filter((f) => !list.has(f))).toEqual([]);
  });

  it('removes scenario temp folders left by earlier runs, but not recent ones', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const old = path.join(dir, 'rigready-scenario-old');
      const recent = path.join(dir, 'rigready-scenario-recent');
      const other = path.join(dir, 'something-else');
      for (const d of [old, recent, other])
        await fs.mkdir(path.join(d, 'sub'), { recursive: true });
      const now = Date.now();
      const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
      await fs.utimes(old, twoHoursAgo, twoHoursAgo);
      await fs.utimes(other, twoHoursAgo, twoHoursAgo);
      expect(await cleanupScenarioTemp(dir, now)).toEqual([old]);
      expect((await fs.readdir(dir)).sort()).toEqual([
        'rigready-scenario-recent',
        'something-else',
      ]);
      expect(await cleanupScenarioTemp(path.join(dir, 'missing'), now)).toEqual([]);
      // The test harnesses also clear their own leftovers.
      expect(await cleanupScenarioTemp(dir, now, 60 * 60 * 1000, ['something-'])).toEqual([other]);
    } finally {
      await cleanup();
    }
  });
});

describe('the recorded rig in the repository', () => {
  it('holds every file the recording wrote (none lost to .gitignore in a fresh checkout)', async () => {
    const rigDir = path.join(fixturesDir, 'rigs', 'mark-full');
    const meta = JSON.parse(await fs.readFile(path.join(rigDir, 'meta.json'), 'utf8')) as {
      counts: { files: number };
    };
    const count = async (dir: string): Promise<number> => {
      let total = 0;
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        total += entry.isDirectory() ? await count(path.join(dir, entry.name)) : 1;
      }
      return total;
    };
    expect(await count(path.join(rigDir, 'files'))).toBe(meta.counts.files);
    for (const relative of JSON.parse(
      await fs.readFile(path.join(rigDir, 'rehome.json'), 'utf8')
    ) as string[]) {
      await expect(
        fs.access(path.join(rigDir, 'files', relative)),
        relative
      ).resolves.toBeUndefined();
    }
  });
});
