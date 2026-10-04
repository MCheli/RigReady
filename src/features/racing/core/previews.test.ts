import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { BindingBackup, WritePreviewView } from '../contract';

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

describe('what a racing restore or copy will write, before it does', () => {
  it('a restore lists each file as changed, new or the same, and writes nothing', async () => {
    app = await wiredApp('racing-fresh');
    const dir = path.join(app.ports.folders.documents(), 'iRacing');
    const backup = await app.invoke<BindingBackup>('racing:backup', { game: 'iracing' });

    const same = await app.invoke<WritePreviewView>('racing:restorePreview', {
      game: 'iracing',
      id: backup.id,
    });
    expect(same.summary).toBe('3 files unchanged');
    expect(same.files.map((f) => [f.label, f.change])).toEqual([
      ['Bindings (controls.cfg)', 'unchanged'],
      ['Calibration (joyCalib.yaml)', 'unchanged'],
      ['Options and force feedback (app.ini)', 'unchanged'],
    ]);

    const ini = await fs.readFile(path.join(dir, 'app.ini'), 'utf8');
    await fs.writeFile(path.join(dir, 'app.ini'), ini + 'addedByTheGame=1\n');
    await fs.rm(path.join(dir, 'joyCalib.yaml'));
    await fs.writeFile(path.join(dir, 'controls.cfg'), new Uint8Array([0, 1, 2]));
    const preview = await app.invoke<WritePreviewView>('racing:restorePreview', {
      game: 'iracing',
      id: backup.id,
    });
    expect(preview.summary).toBe('2 files modified, 1 file created');
    expect(preview.files.map((f) => [path.basename(f.path), f.change, f.detail])).toEqual([
      ['controls.cfg', 'modified', expect.stringMatching(/^3 bytes to \d+ KB$/)],
      ['joyCalib.yaml', 'created', expect.stringMatching(/^New file \(/)],
      ['app.ini', 'modified', '1 line removed'],
    ]);
    // Nothing was written by looking.
    expect(await fs.readFile(path.join(dir, 'controls.cfg'))).toEqual(Buffer.from([0, 1, 2]));
    const journal = await app.ports.files.journal();
    expect(journal.ok && journal.value).toEqual([]);

    await expect(
      app.invoke('racing:restorePreview', { game: 'iracing', id: 'gone' })
    ).rejects.toThrow('That backup no longer exists.');
  });

  it('copying older BeamNG bindings names the files it creates and the ones it replaces', async () => {
    app = await wiredApp('racing-fresh');
    const local = app.ports.folders.localAppData();
    const current = path.join(local, 'BeamNG', 'BeamNG.drive', 'current', 'settings', 'inputmaps');
    const old = path.join(local, 'BeamNG.drive', '0.31', 'settings', 'inputmaps');
    await fs.mkdir(old, { recursive: true });
    await fs.writeFile(path.join(old, '00060eb7.diff'), '{"bindings":[]}');
    const existing = (await fs.readdir(current)).find((f) => f.endsWith('.diff'))!;
    await fs.writeFile(path.join(old, existing), '{"bindings":[],"name":"older"}');

    const preview = await app.invoke<WritePreviewView>('racing:beamngCopyOlderPreview', {
      version: '0.31',
    });
    expect(preview.summary).toBe('1 file modified, 1 file created');
    expect(preview.files.map((f) => [f.label, f.change]).sort()).toEqual(
      [
        ['00060eb7.diff', 'created'],
        [existing, 'modified'],
      ].sort()
    );
    expect(await fs.readdir(current)).not.toContain('00060eb7.diff');
    await expect(app.invoke('racing:beamngCopyOlderPreview', { version: '0.29' })).rejects.toThrow(
      'no user folder of version 0.29'
    );
  });
});
