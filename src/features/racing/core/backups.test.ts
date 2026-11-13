import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { err } from '../../../core/result';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { BindingBackup } from '../contract';

describe('binding backups', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  it('backs up and restores the iRacing bindings byte for byte, refusing while the simulator runs', async () => {
    app = await wiredApp('racing-fresh');
    const dir = path.join(app.ports.folders.documents(), 'iRacing');
    const original = await fs.readFile(path.join(dir, 'controls.cfg'));
    const backup = await app.invoke<BindingBackup>('racing:backup', { game: 'iracing' });
    expect(backup.files.map((f) => path.basename(f.path))).toEqual([
      'controls.cfg',
      'joyCalib.yaml',
      'app.ini',
    ]);
    expect(backup.files.every((f) => f.restorable)).toBe(true);

    await fs.writeFile(path.join(dir, 'controls.cfg'), 'broken');
    await mutate(app, [
      {
        op: 'startProcess',
        name: 'iRacingSim64DX11.exe',
        path: 'C:\\iRacing\\iRacingSim64DX11.exe',
      },
    ]);
    await expect(app.invoke('racing:restore', { game: 'iracing', id: backup.id })).rejects.toThrow(
      'Close iRacing first. iRacing writes its settings when the simulator exits'
    );
    expect(await fs.readFile(path.join(dir, 'controls.cfg'), 'utf8')).toBe('broken');

    await mutate(app, [{ op: 'stopProcess', name: 'iRacingSim64DX11.exe' }]);
    const restored = await app.invoke<{ message: string }>('racing:restore', {
      game: 'iracing',
      id: backup.id,
    });
    expect(restored.message).toMatch(/^Restored 3 files from /);
    expect((await fs.readFile(path.join(dir, 'controls.cfg'))).equals(original)).toBe(true);
    // The restore is one journaled action, so it can be undone.
    const groups = await app.ports.files.journalGroups();
    expect(groups.ok && groups.value[0]!.reason).toMatch(/^Restore iRacing bindings from /);
    expect(groups.ok && groups.value[0]!.entries).toHaveLength(3);
  });

  it('refuses to restore Le Mans Ultimate while it runs, because it rewrites its files', async () => {
    app = await wiredApp('racing-fresh');
    const backup = await app.invoke<BindingBackup>('racing:backup', { game: 'lmu' });
    expect(backup.files.map((f) => path.basename(f.path))).toEqual([
      'direct input.json',
      'current controls.json',
      'Settings.JSON',
    ]);
    await mutate(app, [
      {
        op: 'startProcess',
        name: 'start_protected_game.exe',
        path: 'C:\\Games\\start_protected_game.exe',
      },
    ]);
    await expect(app.invoke('racing:restore', { game: 'lmu', id: backup.id })).rejects.toThrow(
      'Close Le Mans Ultimate first'
    );
  });

  it('lists backups newest first and deletes one', async () => {
    app = await wiredApp('racing-fresh');
    const first = await app.invoke<BindingBackup>('racing:backup', { game: 'beamng' });
    app.clock.advance(60_000);
    const second = await app.invoke<BindingBackup>('racing:backup', { game: 'beamng' });
    expect(second.files.map((f) => f.label)).toEqual([
      'Bindings: 00070eb7.diff',
      'Bindings: keyboard.diff',
    ]);
    expect(
      (await app.invoke<BindingBackup[]>('racing:backups', { game: 'beamng' })).map((b) => b.id)
    ).toEqual([second.id, first.id]);
    await app.invoke('racing:deleteBackup', { game: 'beamng', id: first.id });
    expect(
      (await app.invoke<BindingBackup[]>('racing:backups', { game: 'beamng' })).map((b) => b.id)
    ).toEqual([second.id]);
    await expect(app.invoke('racing:restore', { game: 'beamng', id: first.id })).rejects.toThrow(
      'no longer exists'
    );
    // Two backups in the same second get different ids.
    const third = await app.invoke<BindingBackup>('racing:backup', { game: 'beamng' });
    expect(third.id).not.toBe(second.id);
  });

  it('backs up the Fanatec App settings and the service registry as a record; restoring closes and restarts the app', async () => {
    app = await wiredApp('racing-fresh');
    const prefs = path.join(
      app.ports.folders.appData(),
      'com.example',
      'Fanatec',
      'shared_preferences.json'
    );
    const original = await fs.readFile(prefs, 'utf8');
    const backup = await app.invoke<BindingBackup>('racing:backup', { game: 'fanatec' });
    expect(backup.files.map((f) => [f.label, f.restorable])).toEqual([
      ['Fanatec App settings', true],
      ['Fanatec Service settings (registry, kept as a record)', false],
    ]);
    const record = JSON.parse(
      await fs.readFile(
        path.join(
          app.ports.folders.dataRoot(),
          'racing',
          'backups',
          'fanatec',
          backup.id,
          backup.files[1]!.stored
        ),
        'utf8'
      )
    );
    expect(Object.keys(record.keys)).toContain('Games');

    await fs.writeFile(prefs, '{}');
    await mutate(app, [
      {
        op: 'startProcess',
        name: 'Fanatec.exe',
        path: path.join(app.home, 'Program Files', 'Fanatec', 'FanatecUI', 'UI', 'Fanatec.exe'),
      },
    ]);
    await expect(app.invoke('racing:restore', { game: 'fanatec', id: backup.id })).rejects.toThrow(
      'The Fanatec App is open'
    );
    const done = await app.invoke<{ message: string }>('racing:restore', {
      game: 'fanatec',
      id: backup.id,
      closeApp: true,
    });
    expect(done.message).toContain('Restored 1 file');
    expect(done.message).toContain('The Fanatec App was started again.');
    expect(await fs.readFile(prefs, 'utf8')).toBe(original);
    expect(app.ports.processes.closed.map((c) => c.name)).toContain('Fanatec.exe');
    expect(app.ports.processes.started.at(-1)!.exe).toContain('Fanatec.exe');
  });

  it('a Fanatec App that stays open is named with the reason, is never forced, and nothing is restored', async () => {
    app = await wiredApp('racing-fresh');
    const prefs = path.join(
      app.ports.folders.appData(),
      'com.example',
      'Fanatec',
      'shared_preferences.json'
    );
    const original = await fs.readFile(prefs, 'utf8');
    const backup = await app.invoke<BindingBackup>('racing:backup', { game: 'fanatec' });
    await fs.writeFile(prefs, '{}');
    await mutate(app, [
      {
        op: 'startProcess',
        name: 'Fanatec.exe',
        path: path.join(app.home, 'Program Files', 'Fanatec', 'FanatecUI', 'UI', 'Fanatec.exe'),
      },
    ]);
    const restore = (): Promise<{ message: string }> =>
      app!.invoke('racing:restore', { game: 'fanatec', id: backup.id, closeApp: true });
    const after = 'Close it yourself, then restore again. Nothing was restored.';

    // Its X only sends it to the tray.
    await mutate(app, [{ op: 'failProcessClose', name: 'Fanatec.exe', why: 'ignored' }]);
    await expect(restore()).rejects.toThrow(
      `racing.stillRunning The Fanatec App is still running: it was asked to close and stayed open. Some apps only go to the tray when asked. ${after}`
    );
    // It runs as administrator.
    await mutate(app, [{ op: 'failProcessClose', name: 'Fanatec.exe', why: 'refused' }]);
    await expect(restore()).rejects.toThrow(
      `racing.stillRunning The Fanatec App is still running: Windows did not let RigReady close it. It may be running as administrator. ${after}`
    );
    // A provider that gives no reason: none is made up.
    await mutate(app, [{ op: 'failProcessClose', name: 'Fanatec.exe', why: 'off' }]);
    app.ports.processes.stubborn.add('fanatec.exe');
    await expect(restore()).rejects.toThrow(
      `racing.stillRunning The Fanatec App is still running: it did not close when asked. ${after}`
    );
    expect(app.ports.processes.closed).toHaveLength(3);
    expect(app.ports.processes.closed.every((c) => c.options.force === false)).toBe(true);
    expect(await fs.readFile(prefs, 'utf8')).toBe('{}');
    expect(app.ports.processes.started).toEqual([]);

    // Once it closes when asked, the same restore goes through and starts it again.
    app.ports.processes.stubborn.clear();
    expect((await restore()).message).toContain('The Fanatec App was started again.');
    expect(await fs.readFile(prefs, 'utf8')).toBe(original);
  });

  it('G HUB is two processes and one program: its agent has no window, comes first, and goes with the window', async () => {
    app = await wiredApp('wheel-logitech-g923', { files: [] });
    const db = path.join(app.ports.folders.localAppData(), 'LGHUB', 'settings.db');
    const original = await fs.readFile(db, 'utf8');
    const backup = await app.invoke<BindingBackup>('racing:backup', { game: 'logitech' });
    await fs.writeFile(db, 'changed by G HUB');
    // The scenario runs the agent; the window is another process, listed after it.
    await mutate(app, [
      { op: 'startProcess', name: 'lghub.exe', path: 'C:\\Program Files\\LGHUB\\lghub.exe' },
    ]);
    const pidOf = (name: string): number =>
      app!.ports.state.processes.find((p) => p.name === name)!.pid;
    const agent = pidOf('lghub_agent.exe');
    const window = pidOf('lghub.exe');
    const close = app.ports.processes.close.bind(app.ports.processes);
    const asked: number[] = [];
    app.ports.processes.close = async (pid, options) => {
      asked.push(pid);
      if (pid === agent) {
        return err('process.stillRunning', `Process ${pid} has no window to close.`, 'noWindow');
      }
      await close(agent, options);
      return close(pid, options);
    };
    const restored = await app.invoke<{ message: string }>('racing:restore', {
      game: 'logitech',
      id: backup.id,
      closeApp: true,
    });
    expect(asked).toEqual([agent, window]);
    expect(restored.message).toMatch(/Logitech G HUB was started again\.$/);
    expect(await fs.readFile(db, 'utf8')).toBe(original);
  });

  it('says so when there is nothing to back up', async () => {
    app = await wiredApp('racing-fresh');
    await fs.rm(path.join(app.ports.folders.documents(), 'Assetto Corsa', 'cfg', 'controls.ini'));
    await expect(app.invoke('racing:backup', { game: 'assetto-corsa' })).rejects.toThrow(
      'no binding files to back up'
    );
  });
});
