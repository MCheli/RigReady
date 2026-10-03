import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../../tests/helpers';
import type { BeamngView } from '../../contract';
import { beamngActionLabel, beamngControlLabel, parseRelaxedJson } from './beamng';

describe('BeamNG.drive bindings', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  const inputmaps = (a: WiredApp): string =>
    path.join(
      a.ports.folders.localAppData(),
      'BeamNG',
      'BeamNG.drive',
      'current',
      'settings',
      'inputmaps'
    );
  const installDir = (a: WiredApp): string =>
    path.join(a.home, 'Program Files (x86)', 'Steam', 'steamapps', 'common', 'BeamNG.drive');

  it('names actions and controls in plain English', () => {
    expect(beamngActionLabel('accelerate')).toBe('Throttle');
    expect(beamngActionLabel('parkingbrake_temporary')).toBe('Parking Brake (hold)');
    expect(beamngActionLabel('some_newAction')).toBe('Some new action');
    expect(beamngControlLabel('zaxis', '0EB7', '0007')).toBe('Accelerator');
    expect(beamngControlLabel('rzaxis', '0EB7', '0007')).toBe('Brake');
    expect(beamngControlLabel('zaxis')).toBe('Z axis');
    expect(beamngControlLabel('button11')).toBe('Button 12');
    expect(beamngControlLabel('upov')).toBe('D-pad up');
    expect(beamngControlLabel('space')).toBe('Space');
    expect(beamngControlLabel('a')).toBe('A');
    expect(parseRelaxedJson('{ "a": 1, // note\n "b": [1, 2,], /* x */ }')).toEqual({
      a: 1,
      b: [1, 2],
    });
  });

  it('lists the diff bindings per device with the force feedback of the steering binding', async () => {
    app = await wiredApp('racing-fresh');
    const view = await app.invoke<BeamngView>('racing:beamng');
    expect(view.installed).toBe(true);
    const wheel = view.maps.find((m) => m.vidpid === '00070eb7')!;
    expect(wheel).toMatchObject({
      name: 'FANATEC Podium Wheel Base DD2',
      state: 'connected',
      factoryLoaded: false,
    });
    expect(wheel.bindings).toContainEqual({
      action: 'accelerate',
      label: 'Throttle',
      input: 'Accelerator',
      detail: 'inverted',
      yours: true,
    });
    expect(wheel.removed).toContainEqual({
      action: 'accelerate',
      label: 'Throttle',
      input: 'Combined pedals',
    });
    expect(wheel.forceFeedback).toContainEqual({
      label: 'Steering rotation (degrees)',
      value: '2520',
    });
    expect(wheel.forceFeedback).toContainEqual({ label: 'Strength', value: '200' });
    expect(wheel.forceFeedback).toContainEqual({ label: 'Soft-lock force', value: '0.81' });
    expect(view.maps.find((m) => m.file === 'keyboard.diff')!.state).toBe('keyboard');
  });

  it('merges the default map of the game with the diff into the effective bindings, and shows per-vehicle maps', async () => {
    app = await wiredApp('racing-fresh');
    const factory = path.join(installDir(app), 'settings', 'inputmaps');
    await fs.mkdir(factory, { recursive: true });
    await fs.writeFile(
      path.join(factory, '00070eb7.json'),
      `{ // the game's own default map\n "bindings": [ {"action":"accelerate","control":"yaxis"}, {"action":"brake","control":"rzaxis"}, {"action":"shiftUp","control":"button4"}, ],\n "name": "FANATEC Podium Wheel Base DD2", "vidpid": "00070EB7" }`
    );
    const vehicle = path.join(inputmaps(app), 'pickup');
    await fs.mkdir(vehicle, { recursive: true });
    await fs.writeFile(
      path.join(vehicle, '00070eb7.diff'),
      JSON.stringify({
        bindings: [{ action: 'horn', control: 'button7' }],
        removed: [],
        name: 'FANATEC Podium Wheel Base DD2',
        vidpid: '00070EB7',
        devicetype: 'joystick',
      })
    );
    const view = await app.invoke<BeamngView>('racing:beamng');
    const wheel = view.maps.find((m) => m.file === '00070eb7.diff')!;
    expect(wheel.factoryLoaded).toBe(true);
    const labels = wheel.bindings.map((b) => `${b.label}=${b.input}${b.yours ? '*' : ''}`);
    // accelerate on Y was removed by the diff; brake and shift up come from the defaults.
    expect(labels).toContain('Brake=Brake');
    expect(labels).toContain('Shift Up=Button 5');
    expect(labels).toContain('Throttle=Accelerator*');
    expect(labels).not.toContain('Throttle=Combined pedals');
    const pickup = view.maps.find((m) => m.vehicle === 'pickup')!;
    expect(pickup.bindings[0]).toMatchObject({ label: 'Horn', input: 'Button 8' });
  });

  it('flags a map for a controller that is gone and gives its bindings to the new one', async () => {
    app = await wiredApp('racing-fresh');
    const csw = {
      bindings: [{ action: 'steering', control: 'xaxis', angle: 900 }],
      name: 'ClubSport Wheel Base V2',
      vidpid: '00010EB7',
      devicetype: 'joystick',
    };
    await fs.writeFile(path.join(inputmaps(app), '00010eb7.diff'), JSON.stringify(csw));
    await fs.rm(path.join(inputmaps(app), '00070eb7.diff'));
    const view = await app.invoke<BeamngView>('racing:beamng');
    const old = view.maps.find((m) => m.vidpid === '00010eb7')!;
    expect(old.state).toBe('missing');
    expect(old.targets).toContainEqual({
      vidpid: '00070eb7',
      name: 'FANATEC Podium Wheel Base DD2',
    });
    const done = await app.invoke<{ message: string }>('racing:beamngCopyToController', {
      file: '00010eb7.diff',
      to: '00070eb7',
    });
    expect(done.message).toContain('FANATEC Podium Wheel Base DD2 now has the bindings');
    const written = JSON.parse(
      await fs.readFile(path.join(inputmaps(app), '00070eb7.diff'), 'utf8')
    );
    expect(written).toMatchObject({
      vidpid: '00070EB7',
      guid: '{00070EB7-0000-0000-0000-504944564944}',
      bindings: csw.bindings,
    });
    // It never overwrites bindings the new controller already has: it is no longer offered.
    const after = await app.invoke<BeamngView>('racing:beamng');
    expect(after.maps.find((m) => m.vidpid === '00010eb7')!.targets).toEqual([]);
    await expect(
      app.invoke('racing:beamngCopyToController', { file: '00010eb7.diff', to: '00070eb7' })
    ).rejects.toThrow('Choose a controller that is connected now');
    await expect(
      app.invoke('racing:beamngCopyToController', { file: '00010eb7.diff', to: '0000aaaa' })
    ).rejects.toThrow('Choose a controller that is connected now');
  });

  it('finds the user folder from startup.ini, the registry override, or the newest version folder', async () => {
    app = await wiredApp('racing-fresh');
    const local = app.ports.folders.localAppData();
    const module = app.wiring.context.games.get('beamng')!;
    const location = async (): Promise<{ id: string; path: string }[]> => {
      const l = await module.configLocations(app!.ctx);
      if (!l.ok) throw new Error('locations');
      return l.value;
    };
    expect((await location())[0]).toMatchObject({
      id: 'user',
      path: path.join(local, 'BeamNG', 'BeamNG.drive', 'current'),
    });

    // Without the 0.37+ folder: the newest version folder of the old layout, older ones listed.
    await fs.rm(path.join(local, 'BeamNG', 'BeamNG.drive', 'current'), { recursive: true });
    for (const v of ['0.31', '0.32', '0.30'])
      await fs.mkdir(path.join(local, 'BeamNG.drive', v, 'settings'), { recursive: true });
    expect((await location()).map((l) => l.id)).toEqual(['user', 'legacy-0.31', 'legacy-0.30']);
    expect((await location())[0]!.path).toBe(path.join(local, 'BeamNG.drive', '0.32'));

    // The old registry override wins over the default folders.
    const custom = path.join(app.home, 'BeamNGUser');
    await fs.mkdir(custom, { recursive: true });
    await mutate(app, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: 'Software\\BeamNG\\BeamNG.drive',
        name: 'userpath_override',
        value: { type: 'string', value: custom },
      },
    ]);
    expect((await location())[0]!.path).toBe(custom);

    // And startup.ini next to the game wins over everything; relative to the ini's folder.
    const ini = path.join(installDir(app), 'startup.ini');
    await fs.mkdir(path.join(installDir(app), 'MyUser'), { recursive: true });
    await fs.writeFile(ini, '[filesystem]\nUserPath = MyUser\n');
    expect((await location())[0]!.path).toBe(path.join(installDir(app), 'MyUser'));
  });

  it('copies the bindings of an older version folder into the current one', async () => {
    app = await wiredApp('racing-fresh');
    const old = path.join(
      app.ports.folders.localAppData(),
      'BeamNG.drive',
      '0.31',
      'settings',
      'inputmaps'
    );
    await fs.mkdir(old, { recursive: true });
    await fs.writeFile(
      path.join(old, '00060eb7.diff'),
      JSON.stringify({ bindings: [], name: 'Podium DD1', vidpid: '00060EB7' })
    );
    const view = await app.invoke<BeamngView>('racing:beamng');
    expect(view.older).toEqual([expect.objectContaining({ version: '0.31', bindingFiles: 1 })]);
    const done = await app.invoke<{ message: string }>('racing:beamngCopyOlder', {
      version: '0.31',
    });
    expect(done.message).toBe('Copied 1 binding file from 0.31. Undo is on the Safety page.');
    expect(await fs.readFile(path.join(inputmaps(app), '00060eb7.diff'), 'utf8')).toContain(
      'Podium DD1'
    );
    await expect(app.invoke('racing:beamngCopyOlder', { version: '0.29' })).rejects.toThrow(
      'no user folder of version 0.29'
    );
    await mutate(app, [
      { op: 'startProcess', name: 'BeamNG.drive.exe', path: 'C:\\Games\\BeamNG.drive.exe' },
    ]);
    await expect(app.invoke('racing:beamngCopyOlder', { version: '0.31' })).rejects.toThrow(
      'Close BeamNG.drive first'
    );
  });
});
