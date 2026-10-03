import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readZip } from '../../../core/files/zip';
import { err } from '../../../core/result';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import { ARCHIVE_EXT, StreamDeckBackups, safeFileName } from './backups';
import { readArchiveManifests } from './archive';

let rig: TestRig;
afterEach(() => rig?.cleanup());

const MB = 1024 * 1024;
const FILES = ['AppData/Roaming/Elgato/**', 'Program Files/Elgato/**'];
const OLD_BACKUP = 'Documents/DCS Backup/Stream Deck - 02-03-2024 - 19-16.streamDeckProfilesBackup';
const ELGATO_AUTO = 'Stream Deck - 2026-10-01-09-12-44.streamDeckProfilesBackup';
const DCS_WORLD = '042F7366-9A23-444F-9AE6-327A9DB7979F';
const F16 = '7D3A1C55-2B64-4E2F-9C0E-5F1A9E6B2D10';

async function setup(scenario = 'stream-deck-owner', maxBytes = 200 * MB) {
  rig = await scenarioRig(scenario, { files: FILES });
  const backups = new StreamDeckBackups(rig.ports, {
    maxBytes: async () => maxBytes,
    sleep: async (ms) => rig.clock.advance(ms),
  });
  const profiles = path.join(rig.home, 'AppData', 'Roaming', 'Elgato', 'StreamDeck', 'ProfilesV3');
  const data = path.join(rig.ports.folders.dataRoot(), 'stream-deck', 'backups');
  return { backups, profiles, data };
}

const value = <T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } }
): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const running = (): boolean => rig.ports.state.processes.some((p) => p.name === 'StreamDeck.exe');

describe('Stream Deck backup', () => {
  it('copies every profile and the plugin list into the data folder while the app keeps running', async () => {
    const { backups, data } = await setup();
    const backup = value(await backups.create({ name: 'Before the F-16 rework' }));

    expect(backup).toMatchObject({
      name: 'Before the F-16 rework',
      kind: 'manual',
      format: 'v3',
      appVersion: '7.4.2.22730',
      includesPluginFolders: false,
    });
    expect(backup.profiles.map((p) => p.name).sort()).toEqual([
      'DCS World',
      'F-16 stream deck xl profile',
      'SFX MFS 2024 XL',
    ]);
    expect(backup.plugins.map((p) => p.id)).toEqual(
      expect.arrayContaining(['com.ctytler.dcs', 'com.elgato.discord'])
    );
    expect(backup.pluginsUsed).toEqual(
      expect.arrayContaining([
        { pluginId: 'avionics.madjack.dcs', name: 'DCS-BIOS plugin by Mad Jack', actions: 65 },
        { pluginId: 'com.ctytler.dcs', name: 'DCS Interface', actions: 32 },
      ])
    );
    // Read-only: the app was left alone and nothing outside the data folder changed.
    expect(running()).toBe(true);
    expect(rig.ports.processes.closed).toEqual([]);
    expect(value(await rig.ports.files.journal())).toEqual([]);

    // The archive has Stream Deck 7's own layout, so the Stream Deck app can import it too.
    const zip = value(readZip(await fs.readFile(path.join(data, `${backup.id}${ARCHIVE_EXT}`))));
    const names = zip.map((e) => e.path);
    expect(names).toContain('Resources/manifest.json');
    expect(names).toContain(`Profiles/${DCS_WORLD}.sdProfile/manifest.json`);
    expect(
      value(
        readArchiveManifests(await fs.readFile(path.join(data, `${backup.id}${ARCHIVE_EXT}`)), MB)
      ).format
    ).toBe('v3');
    // The manifest is next to it.
    const manifest = JSON.parse(await fs.readFile(path.join(data, `${backup.id}.json`), 'utf8'));
    expect(manifest.profiles).toHaveLength(3);

    const listed = value(await backups.list());
    expect(listed.backups.map((b) => b.id)).toEqual([backup.id]);
    expect(listed.backups[0]!.bytes).toBeGreaterThan(1000);
  });

  it('can include the plugin folders, in a separate archive', async () => {
    const { backups, data } = await setup();
    const backup = value(await backups.create({ includePlugins: true }));
    expect(backup.includesPluginFolders).toBe(true);
    expect(backup.name).toBe('Stream Deck profiles, 2026-10-03');
    const plugins = value(readZip(await fs.readFile(path.join(data, `${backup.id}.plugins.zip`))));
    expect(plugins.map((e) => e.path)).toContain('com.ctytler.dcs.sdPlugin/manifest.json');
    const archive = await fs.stat(path.join(data, `${backup.id}${ARCHIVE_EXT}`));
    expect(backup.bytes).toBeGreaterThan(archive.size);
  });

  it('copies again when Stream Deck writes during the copy, and gives up when it keeps writing', async () => {
    const { backups } = await setup();
    const listTree = rig.ports.files.listTree.bind(rig.ports.files);
    let calls = 0;
    let always = false;
    rig.ports.files.listTree = async (dir, options) => {
      const result = await listTree(dir, options);
      calls++;
      if (result.ok && (always || calls === 2) && result.value[0]) {
        result.value[0] = { ...result.value[0], mtimeMs: result.value[0].mtimeMs + calls };
      }
      return result;
    };
    value(await backups.create());
    expect(calls).toBeGreaterThanOrEqual(4);
    always = true;
    const failed = await backups.create();
    expect(!failed.ok && failed.error.code).toBe('streamDeck.busy');
  });

  it('refuses when there are no profiles to back up', async () => {
    const { backups } = await setup('stream-deck-new-pc');
    const result = await backups.create();
    expect(!result.ok && result.error.code).toBe('streamDeck.noProfiles');
  });
});

describe('Stream Deck backup management', () => {
  it('renames, exports and deletes a backup', async () => {
    const { backups, data } = await setup();
    const backup = value(await backups.create());
    rig.clock.advance(60_000);
    const second = value(await backups.create({ name: 'Second' }));
    expect(value(await backups.list()).backups.map((b) => b.name)).toEqual(['Second', backup.name]);

    expect(value(await backups.rename(backup.id, '  Known good  ')).name).toBe('Known good');
    const empty = await backups.rename(backup.id, '   ');
    expect(!empty.ok && empty.error.code).toBe('streamDeck.name');
    const gone = await backups.rename('nope', 'x');
    expect(!gone.ok && gone.error.code).toBe('streamDeck.noBackup');

    rig.ports.dialogs.script.save.push('Documents/Known good.streamDeckProfilesBackup', null);
    const exported = value(await backups.exportTo(backup.id));
    expect(exported).toBe(path.join(rig.home, 'Documents', 'Known good.streamDeckProfilesBackup'));
    expect(
      (await fs.readFile(exported!)).equals(
        await fs.readFile(path.join(data, `${backup.id}${ARCHIVE_EXT}`))
      )
    ).toBe(true);
    expect(rig.ports.dialogs.calls[0]!.options).toMatchObject({
      defaultPath: path.join(rig.home, 'Documents', `Known good${ARCHIVE_EXT}`),
    });
    // Outside the data folder: journaled like every other change.
    expect(value(await rig.ports.files.journal())[0]).toMatchObject({
      path: exported,
      reason: 'Export Stream Deck backup "Known good"',
    });
    expect(value(await backups.exportTo(backup.id))).toBeNull();

    value(await backups.remove(second.id));
    expect(value(await backups.list()).backups.map((b) => b.id)).toEqual([backup.id]);
    await expect(fs.access(path.join(data, `${second.id}${ARCHIVE_EXT}`))).rejects.toThrow();
  });

  it('skips a damaged manifest or a manifest without its archive', async () => {
    const { backups, data } = await setup();
    const backup = value(await backups.create());
    await fs.writeFile(path.join(data, 'broken.json'), '{');
    await fs.writeFile(path.join(data, 'wrong.json'), '{"schemaVersion":2}');
    const orphan = JSON.parse(await fs.readFile(path.join(data, `${backup.id}.json`), 'utf8'));
    await fs.writeFile(path.join(data, 'orphan.json'), JSON.stringify({ ...orphan, id: 'orphan' }));
    const listed = value(await backups.list());
    expect(listed.backups).toHaveLength(1);
    expect(listed.damaged).toBe(3);
  });

  it('names exports safely', () => {
    expect(safeFileName('F-16: before/after?')).toBe('F-16 before after');
    expect(safeFileName(' ... ')).toBe('Stream Deck backup');
  });
});

describe('Importing Stream Deck backup files', () => {
  it("imports an older-format file like the owner's February 2024 backup", async () => {
    const { backups } = await setup();
    rig.ports.dialogs.script.open.push([OLD_BACKUP], []);
    const imported = value(await backups.importFile())!;
    expect(imported).toMatchObject({
      kind: 'imported',
      format: 'v2',
      name: 'Stream Deck - 02-03-2024 - 19-16',
      sourceFile: 'Stream Deck - 02-03-2024 - 19-16.streamDeckProfilesBackup',
      plugins: [],
      sourceModifiedAt: expect.stringMatching(/^\d{4}-/),
    });
    expect(imported.profiles.map((p) => p.name).sort()).toEqual(['DCS World', 'SFX MFS 2024 XL']);
    expect(value(await backups.importFile())).toBeNull();
  });

  it("imports one of Stream Deck's own automatic backups by name", async () => {
    const { backups } = await setup();
    const files = value(await backups.elgatoBackups());
    expect(files.map((f) => f.fileName)).toEqual([ELGATO_AUTO]);
    const imported = value(await backups.importElgato(ELGATO_AUTO));
    expect(imported.format).toBe('v3');
    const bad = await backups.importElgato('..\\..\\secret.streamDeckProfilesBackup');
    expect(!bad.ok && bad.error.code).toBe('streamDeck.import');
    const missing = await backups.importElgato('gone.streamDeckProfilesBackup');
    expect(!missing.ok && missing.error.code).toBe('streamDeck.import');
  });

  it('rejects files that are not Stream Deck backups, are unsafe or too big', async () => {
    const { backups } = await setup('stream-deck-owner', 2000);
    await fs.writeFile(
      path.join(rig.home, 'Documents', 'notes.streamDeckProfilesBackup'),
      'not a zip'
    );
    rig.ports.dialogs.script.open.push(['Documents/notes.streamDeckProfilesBackup'], [OLD_BACKUP]);
    const notZip = await backups.importFile();
    expect(!notZip.ok && notZip.error.code).toBe('streamDeck.archive');
    const tooBig = await backups.importFile();
    expect(!tooBig.ok && tooBig.error.code).toBe('zip.tooBig');
    // An archive without profiles, and one whose names escape the folder.
    const { zipSync, strToU8 } = await import('fflate');
    expect(!readArchiveManifests(zipSync({ 'readme.txt': strToU8('x') }), MB).ok).toBe(true);
    expect(
      readArchiveManifests(zipSync({ '../evil.sdProfile/manifest.json': strToU8('{}') }), MB)
    ).toMatchObject({ ok: false, error: { code: 'zip.unsafePath' } });
    expect(
      readArchiveManifests(zipSync({ 'A.sdProfile/manifest.json': strToU8('x'.repeat(5000)) }), 100)
    ).toMatchObject({ ok: false, error: { code: 'zip.tooBig' } });
  });
});

describe('Stream Deck restore', () => {
  it('previews which profiles are added, replaced and kept', async () => {
    const { backups } = await setup();
    const imported = value(await backups.importElgato(ELGATO_AUTO));
    const preview = value(await backups.preview(imported.id));
    expect(preview).toMatchObject({
      method: 'files',
      appRunning: true,
      appInstalled: true,
      add: [],
    });
    expect(preview.replace.map((p) => p.name).sort()).toEqual(['DCS World', 'SFX MFS 2024 XL']);
    expect(preview.keep.map((p) => p.name)).toEqual(['F-16 stream deck xl profile']);
  });

  it('refuses while Stream Deck runs, then closes it, restores with a backup first, verifies and can be undone', async () => {
    const { backups, profiles } = await setup();
    const known = value(await backups.create({ name: 'Known good' }));
    // Since then: a profile was renamed, a page added to it, and a profile deleted.
    const dcsManifest = path.join(profiles, `${DCS_WORLD}.sdProfile`, 'manifest.json');
    const original = await fs.readFile(dcsManifest, 'utf8');
    await fs.writeFile(dcsManifest, original.replace('"DCS World"', '"DCS World (broken)"'));
    const extraPage = path.join(
      profiles,
      `${DCS_WORLD}.sdProfile`,
      'Profiles',
      'EXTRA',
      'manifest.json'
    );
    await fs.mkdir(path.dirname(extraPage), { recursive: true });
    await fs.writeFile(extraPage, '{}');
    await fs.rm(path.join(profiles, `${F16}.sdProfile`), { recursive: true });

    const preview = value(await backups.preview(known.id));
    expect(preview.add.map((p) => p.name)).toEqual(['F-16 stream deck xl profile']);
    expect(preview.replace.find((p) => p.name === 'DCS World')?.currentName).toBe(
      'DCS World (broken)'
    );

    const refused = await backups.restore(known.id);
    expect(!refused.ok && refused.error.code).toBe('streamDeck.running');
    expect(await fs.readFile(dcsManifest, 'utf8')).toContain('DCS World (broken)');

    const outcome = value(await backups.restore(known.id, { closeApp: true }));
    expect(outcome).toMatchObject({ method: 'files', restored: 3, closedApp: true });
    expect(rig.ports.processes.closed.map((c) => c.name)).toEqual(['StreamDeck.exe']);
    expect(rig.ports.processes.closed[0]!.options.force).toBe(false);
    expect(running()).toBe(false);
    expect(await fs.readFile(dcsManifest, 'utf8')).toBe(original);
    await expect(fs.access(extraPage)).rejects.toThrow();
    await expect(
      fs.access(path.join(profiles, `${F16}.sdProfile`, 'manifest.json'))
    ).resolves.toBeUndefined();

    // What was there before is a backup of its own, and the change is one journal group.
    const safety = value(await backups.get(outcome.safetyBackupId!));
    expect(safety).toMatchObject({ kind: 'before-restore', name: 'Before restoring "Known good"' });
    expect(safety.profiles.map((p) => p.name)).toContain('DCS World (broken)');
    const group = value(await rig.ports.files.journalGroups()).find(
      (g) => g.id === outcome.groupId
    )!;
    expect(group.reason).toBe('Restore Stream Deck backup "Known good"');
    expect(group.entries.some((e) => e.action === 'remove')).toBe(true);

    value(await backups.undoRestore(outcome.groupId!));
    expect(await fs.readFile(dcsManifest, 'utf8')).toContain('DCS World (broken)');
    expect(await fs.readFile(extraPage, 'utf8')).toBe('{}');
  });

  it('asks before ending a Stream Deck that will not quit', async () => {
    const { backups } = await setup();
    const known = value(await backups.create());
    rig.ports.processes.stubborn.add('streamdeck.exe');
    const polite = await backups.restore(known.id, { closeApp: true });
    expect(!polite.ok && polite.error.code).toBe('streamDeck.stillRunning');
    expect(running()).toBe(true);
    value(await backups.restore(known.id, { closeApp: true, force: true }));
    expect(running()).toBe(false);
  });

  it('puts plugin folders back when asked', async () => {
    const { backups } = await setup();
    const withPlugins = value(await backups.create({ includePlugins: true }));
    const manifest = path.join(
      rig.home,
      'AppData',
      'Roaming',
      'Elgato',
      'StreamDeck',
      'Plugins',
      'com.ctytler.dcs.sdPlugin',
      'manifest.json'
    );
    const before = await fs.readFile(manifest, 'utf8');
    await fs.rm(manifest);
    await rig.ports.processes.stop(
      rig.ports.state.processes.find((p) => p.name === 'StreamDeck.exe')!.pid
    );
    value(await backups.restore(withPlugins.id));
    await expect(fs.access(manifest)).rejects.toThrow();
    value(await backups.restore(withPlugins.id, { restorePlugins: true }));
    expect(await fs.readFile(manifest, 'utf8')).toBe(before);
  });

  it('reports a restore that does not read back, and refuses to undo while the app runs', async () => {
    const { backups } = await setup();
    const known = value(await backups.create());
    rig.ports.processes.stubborn.clear();
    const write = rig.ports.files.write.bind(rig.ports.files);
    rig.ports.files.write = async (file, content, options) =>
      file.includes(`${DCS_WORLD}.sdProfile`) &&
      file.endsWith(`${DCS_WORLD}.sdProfile${path.sep}manifest.json`)
        ? write(file, '{"Name":"Something else"}', options)
        : write(file, content, options);
    const result = await backups.restore(known.id, { closeApp: true });
    expect(!result.ok && result.error.code).toBe('streamDeck.verify');
    expect(!result.ok && result.error.message).toContain('DCS World');

    rig.ports.files.write = async (file, content, options) =>
      file.includes('ProfilesV3') ? err('file.write', 'Disk full') : write(file, content, options);
    const failed = await backups.restore(known.id, { closeApp: true });
    expect(!failed.ok && failed.error).toMatchObject({
      code: 'streamDeck.restore',
      message: 'The restore stopped part way: Disk full',
    });

    await rig.ports.processes.start({ exe: 'C:\\x\\StreamDeck.exe', args: [] });
    const undo = await backups.undoRestore('any');
    expect(!undo.ok && undo.error.code).toBe('streamDeck.running');
  });

  it('hands an older-format backup to the Stream Deck app and checks the result by name', async () => {
    const { backups, data } = await setup();
    rig.ports.dialogs.script.open.push([OLD_BACKUP]);
    const old = value(await backups.importFile())!;
    const preview = value(await backups.preview(old.id));
    expect(preview.method).toBe('app');
    expect(preview.methodReason).toContain('older Stream Deck format');
    const outcome = value(await backups.restore(old.id));
    expect(outcome).toMatchObject({
      method: 'app',
      restored: 0,
      expected: expect.arrayContaining(['DCS World']),
    });
    expect(outcome.safetyBackupId).toBeDefined();
    const started = rig.ports.processes.started.at(-1)!;
    expect(path.basename(started.exe)).toBe('StreamDeck.exe');
    expect(started.args).toEqual([path.join(data, `${old.id}${ARCHIVE_EXT}`)]);
    // Both profiles are on this PC already, so the check finds them.
    expect(value(await backups.verifyAppRestore(old.id))).toEqual({
      found: expect.arrayContaining(['DCS World', 'SFX MFS 2024 XL']),
      missing: [],
    });
  });

  it('needs the app for an app restore', async () => {
    const { backups } = await setup('stream-deck-new-pc');
    rig.ports.dialogs.script.open.push([OLD_BACKUP]);
    const old = value(await backups.importFile())!;
    expect(value(await backups.preview(old.id))).toMatchObject({
      appInstalled: false,
      keep: [],
      add: [{ name: 'DCS World' }, { name: 'SFX MFS 2024 XL' }].map((p) =>
        expect.objectContaining(p)
      ),
    });
    const result = await backups.restore(old.id);
    expect(!result.ok && result.error.code).toBe('streamDeck.notInstalled');
    expect(value(await backups.verifyAppRestore(old.id)).missing).toHaveLength(2);
  });

  it('restores onto a new PC that has the app but no profiles yet', async () => {
    const { backups, profiles } = await setup();
    const known = value(await backups.create());
    await fs.rm(profiles, { recursive: true });
    const outcome = value(await backups.restore(known.id, { closeApp: true }));
    expect(outcome.safetyBackupId).toBeUndefined();
    expect(outcome.restored).toBe(3);
    const missing = await backups.preview('nope');
    expect(!missing.ok && missing.error.code).toBe('streamDeck.noBackup');
  });
});
