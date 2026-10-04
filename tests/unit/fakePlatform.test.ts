import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../../src/platform/fake';
import { applyMutations } from '../../src/platform/fake/scenario';
import { fixturesDir, markFull, rigFromState, scenarioRig, tempDir } from '../helpers';

describe('mark-full fixture', () => {
  it('holds the recorded rig: flight gear, wheel, three identical MFD screens told apart by id', async () => {
    const rig = await markFull();
    const names = rig.devices.map((d) => d.name);
    expect(names).toContain('WINWING MFD1-L');
    expect(names).toContain('T-Pendular-Rudder');
    expect(names).toContain('FANATEC Podium Wheel Base DD2');
    const mfds = rig.displays.filter((d) => d.name === 'USB_Monitor');
    expect(mfds).toHaveLength(3);
    expect(new Set(mfds.map((d) => d.id)).size).toBe(3);
    expect(rig.processes.some((p) => p.name === 'TrackIR5.exe')).toBe(true);
    expect(rig.audio.defaultPlayback).toBeDefined();
    expect(rig.input.length).toBeGreaterThan(0);
  });

  it('contains no Windows user name in paths', async () => {
    const dir = path.join(fixturesDir, 'rigs', 'mark-full');
    const walk = async (d: string): Promise<string[]> =>
      (
        await Promise.all(
          (await fs.readdir(d, { withFileTypes: true })).map((e) =>
            e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
          )
        )
      ).flat();
    for (const file of await walk(dir)) {
      const text = await fs.readFile(file, 'utf8');
      expect(/[\\/]Users[\\/]+(?!User[\\/"']|Public[\\/"'])[A-Za-z]/.test(text), file).toBe(false);
    }
    // The DCS files keep their real names, GUIDs included.
    const joystick = path.join(
      dir,
      'files',
      'Saved Games',
      'DCS',
      'Config',
      'Input',
      'FA-18C_hornet',
      'joystick'
    );
    expect(
      (await fs.readdir(joystick)).some((f) =>
        /^WINWING MFD1-L \{[0-9A-Fa-f-]+\}\.diff\.lua$/.test(f)
      )
    ).toBe(true);
  });
});

describe('mutations', () => {
  it('unplug, stop, start, change and remove', async () => {
    const base = await markFull();
    const next = applyMutations(base, [
      { op: 'unplugDevice', match: { vendorId: '044f', productId: 'b68f' } },
      { op: 'unplugDevice', match: { name: 'stream deck' } },
      { op: 'stopProcess', name: 'trackir5.exe' },
      { op: 'startProcess', name: 'DCS.exe', path: 'C:\\DCS\\bin\\DCS.exe' },
      {
        op: 'setDisplay',
        match: { name: 'USB_Monitor', index: 1 },
        set: { rotation: 90, width: 768, height: 1024 },
      },
      { op: 'setDisplay', match: { name: 'DELL G3223D' }, set: { enabled: false } },
      { op: 'unplugDisplay', match: { name: 'USB_Monitor', index: 2 } },
    ]);
    expect(next.devices.some((d) => d.name === 'T-Pendular-Rudder')).toBe(false);
    expect(next.devices.some((d) => d.name.startsWith('Stream Deck'))).toBe(false);
    expect(next.processes.some((p) => p.name === 'TrackIR5.exe')).toBe(false);
    expect(next.processes.some((p) => p.name === 'DCS.exe')).toBe(true);
    const mfds = next.displays.filter((d) => d.name === 'USB_Monitor');
    expect(mfds.map((d) => d.rotation)).toEqual([0, 90]);
    expect(next.displays.find((d) => d.name === 'DELL G3223D')).toMatchObject({
      enabled: false,
      width: 0,
      primary: false,
    });
    // The input is not modified.
    expect(base.devices.some((d) => d.name === 'T-Pendular-Rudder')).toBe(true);
  });

  it('a mutation that matches nothing is an error, not a silent no-op', async () => {
    const base = await markFull();
    expect(() =>
      applyMutations(base, [{ op: 'unplugDevice', match: { vendorId: 'FFFF' } }])
    ).toThrow(/matched no device/);
    expect(() => applyMutations(base, [{ op: 'unplugDevice', match: { serial: 'nope' } }])).toThrow(
      /matched no device/
    );
    expect(() => applyMutations(base, [{ op: 'stopProcess', name: 'nope.exe' }])).toThrow(
      /matched no process/
    );
    expect(() =>
      applyMutations(base, [{ op: 'setDisplay', match: { name: 'Nope' }, set: {} }])
    ).toThrow(/matched no display/);
    expect(() => applyMutations(base, [{ op: 'unplugDisplay', match: { id: 'nope' } }])).toThrow(
      /matched no display/
    );
    expect(() =>
      applyMutations(base, [{ op: 'unplugDisplay', match: { name: 'USB_Monitor', index: 9 } }])
    ).toThrow(/matched no display/);
  });

  it('plugDisplay connects a monitor the rig does not have; the same id twice is an error', async () => {
    const base = await markFull();
    const tv = {
      id: '\\\\?\\DISPLAY#TV00001#5&1509d400&0&UID4361#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}',
      name: 'TV',
      enabled: true,
      primary: false,
      x: 640,
      y: -2160,
      width: 3840,
      height: 2160,
      rotation: 0 as const,
      connector: 'HDMI',
    };
    const next = applyMutations(base, [{ op: 'plugDisplay', display: tv }]);
    expect(next.displays).toHaveLength(base.displays.length + 1);
    // Ids are lower case, as Windows reports them, so layouts and matches find the monitor.
    expect(next.displays.at(-1)).toMatchObject({ name: 'TV', id: tv.id.toLowerCase(), y: -2160 });
    expect(next.displays.filter((d) => d.primary).map((d) => d.name)).toEqual(['DELL G3223D']);
    expect(base.displays.some((d) => d.name === 'TV')).toBe(false);
    expect(() =>
      applyMutations(next, [{ op: 'plugDisplay', display: { ...tv, id: tv.id.toLowerCase() } }])
    ).toThrow(/already connected/);
    // Plugged in as the main display, it takes over from the one that was.
    const main = applyMutations(base, [
      { op: 'plugDisplay', display: { ...tv, primary: true, x: 0, y: 0 } },
    ]);
    expect(main.displays.filter((d) => d.primary).map((d) => d.name)).toEqual(['TV']);
    // It can be changed and unplugged like any other monitor.
    const gone = applyMutations(next, [
      { op: 'setDisplay', match: { name: 'TV' }, set: { enabled: false } },
      { op: 'unplugDisplay', match: { name: 'TV' } },
    ]);
    expect(gone.displays).toHaveLength(base.displays.length);
  });
});

describe('scenario files', () => {
  it('every scenario in fixtures/scenarios loads', async () => {
    const dir = path.join(fixturesDir, 'scenarios');
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.yaml'));
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) {
      const loaded = await loadScenario(path.join(dir, file), fixturesDir);
      expect(loaded.scenario.description.length, file).toBeGreaterThan(0);
      expect(
        loaded.state.displays.filter((d) => d.enabled && d.primary),
        file
      ).toHaveLength(1);
    }
  });

  it('follows extends: mutations and profiles accumulate from the base', async () => {
    const loaded = await loadScenario(
      path.join(fixturesDir, 'scenarios', 'flying-pedals-unplugged.yaml'),
      fixturesDir
    );
    expect(loaded.profileFiles.map((f) => path.basename(f))).toEqual(['dcs-f-a-18c.yaml']);
    expect(loaded.state.devices.some((d) => d.productId === 'B68F')).toBe(false);
    expect(loaded.state.displays.find((d) => d.name === 'LC49G95T')).toMatchObject({
      primary: true,
      x: 0,
    });
    expect(loaded.state.displays.find((d) => d.name === 'DELL G3223D')!.enabled).toBe(false);
  });

  it('reports invalid scenario files and circular extends', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await fs.writeFile(
        path.join(dir, 'bad.yaml'),
        'rig: mark-full\nmutations: [{ op: explode }]\n'
      );
      await expect(loadScenario(path.join(dir, 'bad.yaml'), fixturesDir)).rejects.toThrow(
        /Invalid scenario/
      );
      await fs.writeFile(
        path.join(dir, 'loop.yaml'),
        'description: loop\nrig: mark-full\nextends: loop.yaml\n'
      );
      await expect(loadScenario(path.join(dir, 'loop.yaml'), fixturesDir)).rejects.toThrow(
        /extends itself/
      );
    } finally {
      await cleanup();
    }
  });
});

describe('fake providers behave like the machine', () => {
  it('started processes appear, stopped ones disappear', async () => {
    const rig = await rigFromState(await markFull());
    try {
      const before = await rig.ports.processes.list();
      const started = await rig.ports.processes.start({
        exe: 'C:\\Games\\Sim.exe',
        args: ['--vr'],
      });
      expect(started.ok).toBe(true);
      const during = await rig.ports.processes.list();
      expect(during.ok && during.value.some((p) => p.name === 'Sim.exe')).toBe(true);
      expect(rig.ports.processes.started).toEqual([{ exe: 'C:\\Games\\Sim.exe', args: ['--vr'] }]);
      if (started.ok) await rig.ports.processes.stop(started.value.pid!);
      expect(await rig.ports.processes.list()).toEqual(before);
      expect(await rig.ports.processes.stop(999999)).toMatchObject({ ok: false });
      expect(await rig.ports.processes.start({ exe: 'relative.exe', args: [] })).toMatchObject({
        ok: false,
      });
      // Shell.launch goes the same way; Shell.run only records.
      await rig.ports.shell.launch('C:\\Tools\\Helper.exe', ['a'], { cwd: 'C:\\Tools' });
      await rig.ports.shell.run('C:\\Tools\\Once.exe', ['b']);
      expect(rig.ports.shell.calls.map((c) => c.exe)).toEqual([
        'C:\\Tools\\Helper.exe',
        'C:\\Tools\\Once.exe',
      ]);
    } finally {
      await rig.cleanup();
    }
  });

  it('display apply changes what read returns, keeps one primary at 0,0, and reverts', async () => {
    const rig = await scenarioRig('desk-mfds-wrong');
    try {
      const displays = rig.ports.displays;
      const before = await displays.read();
      if (!before.ok) throw new Error('read failed');
      const dell = before.value.displays.find((d) => d.name === 'DELL G3223D')!;
      const ultrawide = before.value.displays.find((d) => d.name === 'LC49G95T')!;
      const mfd = before.value.displays.find((d) => d.name === 'USB_Monitor')!;
      expect(displays.canRevert()).toBe(false);
      expect(await displays.revert()).toMatchObject({
        ok: false,
        error: { code: 'display.norevert' },
      });

      const applied = await displays.apply([
        { id: dell.id, name: dell.name, enabled: false, primary: false, x: 0, y: 0, rotation: 0 },
        { id: mfd.id, name: mfd.name, enabled: true, primary: false, x: 7680, y: 0, rotation: 90 },
      ]);
      expect(applied.ok).toBe(true);
      const now = await displays.read();
      if (!now.ok) throw new Error('read failed');
      const byId = new Map(now.value.displays.map((d) => [d.id, d]));
      expect(byId.get(dell.id)).toMatchObject({ enabled: false, width: 0 });
      // The ultrawide took over as primary and everything shifted so it sits at 0,0.
      expect(byId.get(ultrawide.id)).toMatchObject({ primary: true, x: 0, y: 0 });
      expect(byId.get(mfd.id)).toMatchObject({
        rotation: 90,
        width: 768,
        height: 1024,
        x: 7680 - 2560,
      });

      // Turning a monitor back on needs its size.
      expect(
        await displays.apply([
          { id: dell.id, name: dell.name, enabled: true, primary: false, x: 0, y: 0, rotation: 0 },
        ])
      ).toMatchObject({ ok: false, error: { code: 'display.apply' } });
      expect(
        await displays.apply([
          { id: 'nope', name: 'Ghost', enabled: true, primary: false, x: 0, y: 0, rotation: 0 },
        ])
      ).toMatchObject({ ok: false, error: { code: 'display.missing' } });
      const allOff = now.value.displays.map((d) => ({
        id: d.id,
        name: d.name,
        enabled: false,
        primary: false,
        x: 0,
        y: 0,
        rotation: 0 as const,
      }));
      expect(await displays.apply(allOff)).toMatchObject({
        ok: false,
        error: { code: 'display.none' },
      });

      expect(displays.canRevert()).toBe(true);
      const reverted = await displays.revert();
      expect(reverted).toEqual(before);
    } finally {
      await rig.cleanup();
    }
  });

  it('serves devices, audio, input and folders under the temp home', async () => {
    const rig = await rigFromState(await markFull());
    try {
      const devices = await rig.ports.devices.list();
      expect(devices.ok && devices.value.length).toBe(rig.ports.state.devices.length);
      const audio = await rig.ports.audio.read();
      expect(audio.ok && audio.value.defaultPlayback?.name).toBeTruthy();
      const input = await rig.ports.input.start();
      expect(input.ok && input.value.length).toBe(rig.ports.input.devices().length);
      const seen: number[] = [];
      const off = rig.ports.input.subscribe((states) => seen.push(states.length));
      rig.ports.input.emit([
        { index: 0, name: 'x', axes: [], buttons: [true], hats: [], timestamp: 1 },
      ]);
      off();
      rig.ports.input.emit([]);
      await rig.ports.input.stop();
      expect(seen).toEqual([1]);
      const f = rig.ports.folders;
      for (const dir of [
        f.documents(),
        f.savedGames(),
        f.appData(),
        f.localAppData(),
        f.dataRoot(),
      ]) {
        expect(dir.startsWith(rig.home)).toBe(true);
      }
      expect(f.home()).toBe(rig.home);
      for (const dir of [f.programFiles(), f.programFilesX86(), f.programData()]) {
        expect(dir.startsWith(rig.home)).toBe(true);
      }
      // The recorded registry says where Steam is; in the fake that is inside the home too.
      const libraries = await f.steamLibraries();
      expect(libraries.ok && libraries.value).toHaveLength(1);
      expect(libraries.ok && libraries.value[0]!.toLowerCase()).toBe(
        path.join(rig.home, 'Program Files (x86)', 'Steam').toLowerCase()
      );
    } finally {
      await rig.cleanup();
    }
  });
});
