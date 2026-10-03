import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('says so when there is nothing to back up', async () => {
    app = await wiredApp('racing-fresh');
    await fs.rm(path.join(app.ports.folders.documents(), 'Assetto Corsa', 'cfg', 'controls.ini'));
    await expect(app.invoke('racing:backup', { game: 'assetto-corsa' })).rejects.toThrow(
      'no binding files to back up'
    );
  });
});
