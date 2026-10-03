import { promises as fs } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { readZip } from '../../../core/files/zip';
import type { GameModule } from '../../../core/games';
import { ok } from '../../../core/result';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type {
  BackupOutcomeView,
  BackupView,
  ChangesViewData,
  ItemPreview,
  Overview,
  RestorePreviewView,
  RestoreReportView,
  Suggestion,
} from '../contract';
import { LaunchWatcher } from './fingerprints';
import { DCS_USER_EXCLUDES } from './suggestions';

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

const DCS_FILES = ['Saved Games/DCS/**'];

async function start(scenario = 'flying-all-good', files: string[] = DCS_FILES): Promise<WiredApp> {
  const app = await wiredApp(scenario, { files });
  apps.push(app);
  return app;
}

const dcsUser = (app: WiredApp, ...parts: string[]): string =>
  path.join(app.home, 'Saved Games', 'DCS', ...parts);

async function track(
  app: WiredApp,
  scope: string,
  item: {
    label: string;
    path: string;
    kind: 'file' | 'folder';
    include?: string[];
    exclude?: string[];
  }
): Promise<Overview> {
  return app.invoke<Overview>('backup:saveItem', { scope, item });
}

const INPUT = { label: 'DCS bindings', path: '{DCS_USER}/Config/Input', kind: 'folder' } as const;
const OPTIONS = {
  label: 'DCS options',
  path: '{DCS_USER}/Config/options.lua',
  kind: 'file',
} as const;

async function archiveEntries(app: WiredApp, backup: BackupView): Promise<Map<string, Uint8Array>> {
  const bytes = await fs.readFile(path.join(app.ports.folders.dataRoot(), 'backups', backup.id));
  const entries = readZip(new Uint8Array(bytes));
  if (!entries.ok) throw new Error(entries.error.message);
  return new Map(entries.value.map((e) => [e.path, e.data]));
}

describe('tracked items', () => {
  it('tracks files and folders per setup and in the always list, with resolved path, count and size', async () => {
    const app = await start();
    await track(app, 'dcs-f-a-18c', INPUT);
    await track(app, '@always', OPTIONS);
    const overview = await track(app, '@always', {
      label: 'iRacing',
      path: '{DOCUMENTS}/iRacing (not installed)',
      kind: 'folder',
    });
    const always = overview.scopes.find((s) => s.id === '@always')!;
    const setup = overview.scopes.find((s) => s.id === 'dcs-f-a-18c')!;
    expect(always.name).toBe('Always back up');
    expect(setup.name).toBe('DCS F/A-18C');

    const input = setup.items[0]!;
    expect(input.item).toMatchObject({ label: 'DCS bindings', path: '{DCS_USER}/Config/Input' });
    expect(input.absolute).toBe(dcsUser(app, 'Config', 'Input'));
    expect(input.exists).toBe(true);
    // 11 F/A-18C diffs, disabled.lua and the 6 files of the .backup folder.
    expect(input.fileCount).toBe(18);
    expect(input.totalBytes).toBeGreaterThan(1000);

    const options = always.items.find((i) => i.item.label === 'DCS options')!;
    expect(options).toMatchObject({ exists: true, fileCount: 1 });
    // Documents was not copied in this test: the item is kept but flagged.
    const iracing = always.items.find((i) => i.item.label === 'iRacing')!;
    expect(iracing).toMatchObject({ exists: false, fileCount: 0 });

    // The setup's list lives in its profile, so it travels with the profile.
    const profile = await app.wiring.context.profiles.get('dcs-f-a-18c');
    expect(profile.ok && profile.value.extensions['backup']).toMatchObject({
      items: [{ id: 'dcs-bindings', path: '{DCS_USER}/Config/Input' }],
    });
  });

  it('stores typed full paths with a variable, and refuses unknown variables, relative paths and the data folder', async () => {
    const app = await start();
    const overview = await track(app, '@always', {
      label: 'Options',
      path: dcsUser(app, 'Config', 'options.lua'),
      kind: 'file',
    });
    expect(overview.scopes[0]!.items[0]!.item.path).toBe('{DCS_USER}/Config/options.lua');

    await expect(
      track(app, '@always', { label: 'X', path: 'relative/path', kind: 'folder' })
    ).rejects.toThrow(/full path/);
    await expect(
      track(app, '@always', { label: 'X', path: '{NOPE}/x', kind: 'folder' })
    ).rejects.toThrow(/Unknown path variable/);
    await expect(
      track(app, '@always', { label: 'X', path: '{RIGREADY_HOME}/profiles', kind: 'folder' })
    ).rejects.toThrow(/own folder/);
  });

  it('a path whose game is not on this PC is flagged with the reason', async () => {
    const app = await start('flying-all-good', []);
    // No Saved Games\DCS: {DCS_USER} does not exist here.
    await fs.rm(path.join(app.home, 'Saved Games'), { recursive: true });
    await expect(track(app, '@always', INPUT)).rejects.toThrow(/DCS_USER/);
  });

  it('edits and removes items without touching the files', async () => {
    const app = await start();
    let overview = await track(app, '@always', INPUT);
    const id = overview.scopes[0]!.items[0]!.item.id;
    overview = await app.invoke<Overview>('backup:saveItem', {
      scope: '@always',
      item: { ...INPUT, id, label: 'Bindings', include: ['FA-18C_hornet/**'] },
    });
    expect(overview.scopes[0]!.items).toHaveLength(1);
    expect(overview.scopes[0]!.items[0]).toMatchObject({
      item: { label: 'Bindings' },
      fileCount: 11,
    });
    overview = await app.invoke<Overview>('backup:removeItem', { scope: '@always', id });
    expect(overview.scopes[0]!.items).toHaveLength(0);
    expect(await fs.readdir(dcsUser(app, 'Config', 'Input'))).toContain('disabled.lua');
  });

  it('browse turns a picked folder into a stored path, and cancel is null', async () => {
    const app = await start();
    app.ports.dialogs.script.open.push(['Saved Games/DCS/Kneeboard'], []);
    expect(await app.invoke('backup:browse', { kind: 'folder' })).toEqual({
      path: '{DCS_USER}/Kneeboard',
      label: 'Kneeboard',
    });
    expect(await app.invoke('backup:browse', { kind: 'folder' })).toBeNull();
    expect(app.ports.dialogs.calls[0]!.options).toMatchObject({ directory: true });
  });
});

describe('include and exclude patterns', () => {
  it('previews exactly which files match before the item is saved', async () => {
    const app = await start();
    const all = await app.invoke<ItemPreview>('backup:previewItem', {
      label: 'Scripts',
      path: '{DCS_USER}/Scripts',
      kind: 'folder',
    });
    expect(all.files.map((f) => f.relativePath)).toEqual([
      'DCS-BIOS/BIOS.lua',
      'DCS-BIOS/BIOSConfig.lua',
      'Export.lua',
      'wwt/wwtExport.lua',
      'wwt/wwtNetwork.lua',
    ]);
    const some = await app.invoke<ItemPreview>('backup:previewItem', {
      label: 'Scripts',
      path: '{DCS_USER}/Scripts',
      kind: 'folder',
      include: ['**/*.lua'],
      exclude: ['wwt/**'],
    });
    expect(some.files.map((f) => f.relativePath)).toEqual([
      'DCS-BIOS/BIOS.lua',
      'DCS-BIOS/BIOSConfig.lua',
      'Export.lua',
    ]);
    expect(some.fileCount).toBe(3);
    // Nothing was saved by previewing.
    const overview = await app.invoke<Overview>('backup:overview');
    expect(overview.scopes[0]!.items).toEqual([]);
  });

  it('the default DCS item leaves out Logs, Tracks, Temp and the shader caches', async () => {
    const app = await start();
    for (const junk of [
      'Tracks/mission.trk',
      'Temp/x.tmp',
      'fxo/a.fxo',
      'metashaders2/b.bin',
      'Screenshots/s.png',
    ]) {
      await fs.mkdir(path.dirname(dcsUser(app, junk)), { recursive: true });
      await fs.writeFile(dcsUser(app, junk), 'x');
    }
    const suggestions = await app.invoke<Suggestion[]>('backup:suggestions');
    const whole = suggestions.find((s) => s.path === '{DCS_USER}')!;
    expect(whole.exclude).toEqual(DCS_USER_EXCLUDES);
    const preview = await app.invoke<ItemPreview>('backup:previewItem', {
      label: whole.label,
      path: whole.path,
      kind: whole.kind,
      exclude: whole.exclude,
    });
    const names = preview.files.map((f) => f.relativePath);
    expect(names).toContain('Config/options.lua');
    expect(names).toContain('Scripts/Export.lua');
    for (const prefix of ['Logs/', 'Tracks/', 'Temp/', 'fxo/', 'metashaders2/', 'Screenshots/']) {
      expect(
        names.filter((n) => n.startsWith(prefix)),
        prefix
      ).toEqual([]);
    }
  });
});

describe('suggestions', () => {
  it('suggests DCS items that exist here, and anything game modules and backup sources offer', async () => {
    const app = await start();
    const module: GameModule = {
      id: 'testgame',
      name: 'Test Game',
      detect: async () => ok([]),
      configLocations: async () => ok([]),
      trackedFiles: async () =>
        ok([{ label: 'Test settings', path: path.join(app.home, 'Saved Games', 'DCS', 'Config') }]),
    };
    app.wiring.context.games.register(module);
    app.wiring.context.backupSources.register({
      id: 'tool',
      label: 'Some Tool',
      suggest: async () =>
        ok([{ label: 'Tool profiles', path: '{DOCUMENTS}/Tool', kind: 'folder' as const }]),
    });
    const suggestions = await app.invoke<Suggestion[]>('backup:suggestions');
    expect(suggestions.map((s) => s.label)).toEqual([
      'DCS settings and bindings',
      'DCS bindings',
      'DCS options',
      'DCS export scripts',
      'DCS kneeboard',
      'Test settings',
    ]);
    // MonitorSetup does not exist in the fixture, the tool's folder neither: not suggested.
    const test = suggestions.find((s) => s.label === 'Test settings')!;
    expect(test).toMatchObject({ path: '{DCS_USER}/Config', kind: 'folder', game: 'testgame' });

    await track(app, 'dcs-f-a-18c', INPUT);
    const after = await app.invoke<Suggestion[]>('backup:suggestions');
    expect(after.find((s) => s.label === 'DCS bindings')!.trackedIn).toEqual(['dcs-f-a-18c']);
  });
});

describe('full and scoped backups', () => {
  it('backs up everything into one zip named by date, and every tracked file is inside', async () => {
    const app = await start();
    await track(app, 'dcs-f-a-18c', INPUT);
    await track(app, '@always', OPTIONS);
    await track(app, '@always', { label: 'Scripts', path: '{DCS_USER}/Scripts', kind: 'folder' });
    await app.wiring.context.settings.update({ displayRevertSeconds: 20 });
    const outcome = await app.invoke<BackupOutcomeView>('backup:backUp', {
      scope: { kind: 'full' },
    });

    expect(outcome.backup.name).toMatch(/^\d{4}-\d\d-\d\d \d\d-\d\d Everything$/);
    expect(outcome.skipped).toEqual([]);
    expect(outcome.backup.fileCount).toBe(18 + 1 + 5 + 3); // + profile, settings, tracked list
    expect(await fs.readdir(path.join(app.ports.folders.dataRoot(), 'backups'))).toContain(
      outcome.backup.id
    );
    const entries = await archiveEntries(app, outcome.backup);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
    expect(manifest).toMatchObject({
      format: 'rigready-backup',
      appVersion: expect.any(String),
      machine: expect.any(String),
      scope: { kind: 'full', label: 'Everything', profileIds: ['dcs-f-a-18c'] },
    });
    // Every tracked file of the fixture is in the archive, byte for byte.
    for (const item of manifest.items) {
      const folder = item.path.replace('{DCS_USER}', dcsUser(app));
      for (const file of item.files) {
        const disk = await fs.readFile(
          item.kind === 'file' ? folder : path.join(folder, file.path)
        );
        expect(Buffer.from(entries.get(`items/${item.key}/${file.path}`)!)).toEqual(disk);
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    expect(manifest.items.map((i: { files: unknown[] }) => i.files.length)).toEqual([1, 5, 18]);
    expect([...entries.keys()].filter((k) => k.startsWith('rigready/')).sort()).toEqual([
      'rigready/backup/tracked.json',
      'rigready/profiles/dcs-f-a-18c.yaml',
      'rigready/settings.json',
    ]);
    // Progress was reported to the renderer.
    const progress = app.events.filter((e) => e.channel === 'backup:event:progress');
    expect(progress.length).toBeGreaterThan(5);
    expect(progress.at(-1)!.payload).toMatchObject({ done: 27, total: 27 });
  });

  it('reports files it could not read and says the backup completed with them skipped', async () => {
    const app = await start();
    await track(app, '@always', INPUT);
    const read = app.ports.files.readBytes.bind(app.ports.files);
    app.ports.files.readBytes = async (file) =>
      file.endsWith('disabled.lua') ? read(path.join(app.home, 'locked', 'nope')) : read(file);
    const outcome = await app.invoke<BackupOutcomeView>('backup:backUp', {
      scope: { kind: 'full' },
    });
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0]!.path).toMatch(/disabled\.lua$/);
    expect(outcome.backup.fileCount).toBe(17 + 1 + 1);
  });

  it('refuses, before reading anything, a backup larger than it can hold', async () => {
    const app = await start();
    await track(app, '@always', INPUT);
    const listTree = app.ports.files.listTree.bind(app.ports.files);
    app.ports.files.listTree = async (dir, options) => {
      const real = await listTree(dir, options);
      return real.ok ? ok(real.value.map((f) => ({ ...f, size: 200 * 1024 ** 2 }))) : real;
    };
    await expect(app.invoke('backup:backUp', { scope: { kind: 'full' } })).rejects.toThrow(
      /3\.5 GB, more than one backup can hold \(2 GB\)\. The largest is "DCS bindings"/
    );
  });

  it('refuses to make an empty backup', async () => {
    const app = await start('flying-fresh', []);
    await expect(app.invoke('backup:backUp', { scope: { kind: 'full' } })).rejects.toThrow(
      /nothing to back up/i
    );
  });

  it('backs up one setup or a chosen set of items, with the scope in the manifest', async () => {
    const app = await start();
    await track(app, 'dcs-f-a-18c', INPUT);
    await track(app, '@always', OPTIONS);
    const one = await app.invoke<BackupOutcomeView>('backup:backUp', {
      scope: { kind: 'profile', profileId: 'dcs-f-a-18c' },
    });
    expect(one.backup).toMatchObject({
      scopeKind: 'profile',
      scopeLabel: 'DCS F/A-18C',
      fileCount: 19,
      items: [{ label: 'DCS bindings', fileCount: 18, sourceName: 'DCS F/A-18C' }],
    });
    const overview = await app.invoke<Overview>('backup:overview');
    const optionsId = overview.scopes[0]!.items[0]!.item.id;
    const custom = await app.invoke<BackupOutcomeView>('backup:backUp', {
      scope: {
        kind: 'custom',
        label: 'Just options',
        items: [{ scope: '@always', id: optionsId }],
      },
    });
    expect(custom.backup).toMatchObject({
      scopeKind: 'custom',
      scopeLabel: 'Just options',
      fileCount: 1,
    });
    const entries = await archiveEntries(app, custom.backup);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
    expect(manifest.items[0]).toMatchObject({
      path: '{DCS_USER}/Config/options.lua',
      files: [{ path: 'options.lua', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }],
    });
    expect(manifest.createdAt).toBe('2026-10-03T12:00:00.000Z');
  });
});

describe('managing backups', () => {
  it('lists, renames, exports, reveals and deletes backups', async () => {
    const app = await start();
    await track(app, '@always', OPTIONS);
    const made = await app.invoke<BackupOutcomeView>('backup:backUp', { scope: { kind: 'full' } });
    let overview = await app.invoke<Overview>('backup:overview');
    expect(overview.backups).toHaveLength(1);
    expect(overview.backups[0]).toMatchObject({ scopeKind: 'full', imported: false });

    const renamed = await app.invoke<BackupView>('backup:rename', {
      id: made.backup.id,
      name: 'Before the big rebind',
    });
    expect(renamed.id).toBe('Before the big rebind.zip');
    await expect(app.invoke('backup:rename', { id: renamed.id, name: '  ' })).rejects.toThrow(
      /name/
    );

    app.ports.dialogs.script.save.push('Documents/USB/backup.zip', null);
    const exported = await app.invoke<{ path: string }>('backup:exportBackup', { id: renamed.id });
    expect(exported.path).toBe(path.join(app.home, 'Documents', 'USB', 'backup.zip'));
    expect(await fs.readFile(exported.path)).toEqual(
      await fs.readFile(path.join(app.ports.folders.dataRoot(), 'backups', renamed.id))
    );
    expect(await app.invoke('backup:exportBackup', { id: renamed.id })).toBeNull();

    await app.invoke('backup:reveal', { id: renamed.id });
    expect(app.ports.shell.calls.at(-1)).toEqual({
      exe: expect.stringMatching(/\\explorer\.exe$/),
      args: ['/select,', path.join(app.ports.folders.dataRoot(), 'backups', renamed.id)],
    });

    await app.invoke('backup:remove', { id: renamed.id });
    overview = await app.invoke<Overview>('backup:overview');
    expect(overview.backups).toEqual([]);
    await expect(app.invoke('backup:remove', { id: '../settings.json' })).rejects.toThrow(
      /Not a backup/
    );
  });

  it('adds a backup file from elsewhere, and keeps only the newest of its own', async () => {
    const app = await start();
    await track(app, '@always', OPTIONS);
    const made = await app.invoke<BackupOutcomeView>('backup:backUp', { scope: { kind: 'full' } });
    const source = path.join(app.ports.folders.dataRoot(), 'backups', made.backup.id);
    await fs.mkdir(path.join(app.home, 'USB'), { recursive: true });
    await fs.copyFile(source, path.join(app.home, 'USB', 'from the old PC.zip'));
    await fs.rm(source);

    app.ports.dialogs.script.open.push(['USB/from the old PC.zip']);
    const added = await app.invoke<BackupView>('backup:openFile');
    expect(added).toMatchObject({ name: 'from the old PC', imported: true, fileCount: 3 });

    await app.invoke('backup:setKeep', { keepBackups: 2 });
    for (let i = 0; i < 3; i++) {
      app.clock.advance(60_000);
      await app.invoke('backup:backUp', { scope: { kind: 'full' } });
    }
    const overview = await app.invoke<Overview>('backup:overview');
    // Two of its own, and the imported one is never deleted.
    expect(overview.backups.map((b) => b.imported)).toEqual([false, false, true]);
    expect(overview.keepBackups).toBe(2);
  });

  it('shows a file that is not a backup as damaged, with delete still possible', async () => {
    const app = await start();
    const dir = path.join(app.ports.folders.dataRoot(), 'backups');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'junk.zip'), 'not a zip');
    const overview = await app.invoke<Overview>('backup:overview');
    expect(overview.backups[0]).toMatchObject({
      name: 'junk',
      damaged: expect.stringMatching(/zip/),
    });
    await app.invoke('backup:remove', { id: 'junk.zip' });
  });
});

describe('restore', () => {
  async function prepared(): Promise<{ app: WiredApp; backup: BackupView }> {
    const app = await start();
    await track(app, 'dcs-f-a-18c', INPUT);
    await track(app, '@always', OPTIONS);
    await track(app, '@always', { label: 'Scripts', path: '{DCS_USER}/Scripts', kind: 'folder' });
    await app.wiring.context.settings.update({ displayRevertSeconds: 15 });
    const outcome = await app.invoke<BackupOutcomeView>('backup:backUp', {
      scope: { kind: 'full' },
    });
    return { app, backup: outcome.backup };
  }

  it('previews every entry with its target here and whether it is new, identical or different', async () => {
    const { app, backup } = await prepared();
    await fs.writeFile(dcsUser(app, 'Config', 'options.lua'), 'options = {}\n');
    await fs.rm(dcsUser(app, 'Scripts', 'Export.lua'));
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: backup.id,
    });
    expect(preview.otherMachine).toBe(false);
    expect(preview.backup.name).toBe(backup.name);
    const options = preview.items.find((i) => i.label === 'DCS options')!;
    expect(options).toMatchObject({
      stored: '{DCS_USER}/Config/options.lua',
      target: dcsUser(app, 'Config', 'options.lua'),
      restorable: true,
      files: [{ status: 'different', target: dcsUser(app, 'Config', 'options.lua') }],
    });
    const scripts = preview.items.find((i) => i.label === 'Scripts')!;
    expect(scripts.files.find((f) => f.relativePath === 'Export.lua')!.status).toBe('new');
    expect(scripts.files.find((f) => f.relativePath === 'wwt/wwtExport.lua')!.status).toBe('same');
    expect(preview.own).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'profile:dcs-f-a-18c',
          status: 'same',
          label: 'DCS F/A-18C',
        }),
        expect.objectContaining({ ref: 'tracked', status: 'same' }),
      ])
    );
  });

  it('marks entries whose path variable does not exist here as not restorable, with the reason', async () => {
    const { app, backup } = await prepared();
    await fs.rm(dcsUser(app), { recursive: true });
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: backup.id,
    });
    for (const item of preview.items) {
      expect(item.restorable).toBe(false);
      expect(item.problem).toMatch(/\{DCS_USER\} is not on this PC/);
    }
  });

  it('overwrite, skip and keep both per file; replaced files are saved first and the restore is one undo', async () => {
    const { app, backup } = await prepared();
    const optionsFile = dcsUser(app, 'Config', 'options.lua');
    const exportFile = dcsUser(app, 'Scripts', 'Export.lua');
    const biosFile = dcsUser(app, 'Scripts', 'DCS-BIOS', 'BIOS.lua');
    const original = await fs.readFile(optionsFile);
    const originalExport = await fs.readFile(exportFile);
    await fs.writeFile(optionsFile, 'options = { mine = true }\n');
    await fs.writeFile(exportFile, '-- my own export\n');
    await fs.writeFile(biosFile, '-- local BIOS\n');
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: backup.id,
    });
    const ref = (label: string, file: string): string =>
      preview.items.find((i) => i.label === label)!.files.find((f) => f.relativePath === file)!.ref;

    const report = await app.invoke<RestoreReportView>('backup:restore', {
      id: backup.id,
      choices: {
        [ref('DCS options', 'options.lua')]: 'overwrite',
        [ref('Scripts', 'Export.lua')]: 'keepBoth',
        // BIOS.lua is not chosen: skipped.
      },
    });
    expect(report.failed).toEqual([]);
    expect(report.restored.map((r) => r.label)).toEqual([optionsFile]);
    expect(report.keptBoth).toHaveLength(1);
    const kept = dcsUser(app, 'Scripts', 'Export (restored 2026-10-03).lua');
    expect(report.keptBoth[0]!.detail).toBe(kept);
    expect(report.skipped.map((s) => s.label)).toContain(biosFile);

    expect(await fs.readFile(optionsFile)).toEqual(original);
    expect(await fs.readFile(exportFile, 'utf8')).toBe('-- my own export\n');
    expect(await fs.readFile(kept)).toEqual(originalExport);
    expect(await fs.readFile(biosFile, 'utf8')).toBe('-- local BIOS\n');

    // What was replaced is in a "Before restoring" backup.
    expect(report.safetyBackup).toMatch(/^Before restoring /);
    const safety = await archiveEntries(app, { id: `${report.safetyBackup}.zip` } as BackupView);
    expect(
      new TextDecoder().decode([...safety.entries()].find(([k]) => k.endsWith('options.lua'))![1])
    ).toBe('options = { mine = true }\n');

    // One action on the Safety page undoes the file changes.
    const groups = await app.ports.files.journalGroups();
    const group = groups.ok ? groups.value.find((g) => g.id === report.groupId)! : undefined;
    expect(group?.reason).toBe(`Restore backup "${backup.name}"`);
    expect(group?.entries).toHaveLength(2);
    await app.invoke('safety:undo', { groupId: report.groupId });
    expect(await fs.readFile(optionsFile, 'utf8')).toBe('options = { mine = true }\n');
    await expect(fs.access(kept)).rejects.toThrow();
  });

  it('restores setups with overwrite or keep both, settings and the always list', async () => {
    const { app, backup } = await prepared();
    const { profiles, settings } = app.wiring.context;
    const profile = await profiles.get('dcs-f-a-18c');
    if (!profile.ok) throw new Error('no profile');
    await profiles.save({ ...profile.value, checks: [] });
    await settings.update({ displayRevertSeconds: 40 });
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: backup.id,
    });
    expect(preview.own.find((o) => o.ref === 'profile:dcs-f-a-18c')!.status).toBe('different');
    expect(preview.own.find((o) => o.ref === 'settings')!.status).toBe('different');

    const report = await app.invoke<RestoreReportView>('backup:restore', {
      id: backup.id,
      choices: { 'profile:dcs-f-a-18c': 'keepBoth', settings: 'overwrite' },
    });
    expect(report.keptBoth).toEqual([
      expect.objectContaining({
        label: 'DCS F/A-18C',
        detail: 'Saved as "DCS F/A-18C (restored)"',
      }),
    ]);
    const restored = await profiles.get('dcs-f-a-18c-restored');
    expect(restored.ok && restored.value.checks.length).toBe(16);
    const unchanged = await profiles.get('dcs-f-a-18c');
    expect(unchanged.ok && unchanged.value.checks).toEqual([]);
    const now = await settings.get();
    expect(now.ok && now.value.displayRevertSeconds).toBe(15);

    const again = await app.invoke<RestoreReportView>('backup:restore', {
      id: backup.id,
      choices: { 'profile:dcs-f-a-18c': 'overwrite' },
    });
    expect(again.restored.map((r) => r.ref)).toEqual(['profile:dcs-f-a-18c']);
    const back = await profiles.get('dcs-f-a-18c');
    expect(back.ok && back.value.checks.length).toBe(16);
  });

  it('claims success only for files that match the backup after writing', async () => {
    const { app, backup } = await prepared();
    const optionsFile = dcsUser(app, 'Config', 'options.lua');
    await fs.writeFile(optionsFile, 'changed\n');
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: backup.id,
    });
    const ref = preview.items.find((i) => i.label === 'DCS options')!.files[0]!.ref;
    const write = app.ports.files.write.bind(app.ports.files);
    // A write that "succeeds" but leaves different bytes behind (an antivirus, a full disk).
    app.ports.files.write = async (file, content, options) =>
      file === optionsFile ? write(file, 'garbled', options) : write(file, content, options);
    const report = await app.invoke<RestoreReportView>('backup:restore', {
      id: backup.id,
      choices: { [ref]: 'overwrite' },
    });
    expect(report.restored).toEqual([]);
    expect(report.failed).toEqual([
      expect.objectContaining({
        label: optionsFile,
        detail: expect.stringMatching(/does not match/),
      }),
    ]);
  });

  it('points at the device repair when restored bindings name controllers this PC does not have', async () => {
    const { app, backup } = await prepared();
    await fs.rm(dcsUser(app, 'Config', 'Input'), { recursive: true });
    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: backup.id,
    });
    const input = preview.items.find((i) => i.label === 'DCS bindings')!;
    const choices = Object.fromEntries(input.files.map((f) => [f.ref, 'overwrite']));
    const report = await app.invoke<RestoreReportView>('backup:restore', {
      id: backup.id,
      choices,
    });
    expect(report.restored).toHaveLength(18);
    expect(report.deviceIds?.files.map((f) => path.basename(f))).toEqual([
      'T-Pendular-Rudder {7F3956A0-B756-11f0-801B-444553540000}.diff.lua',
      'T-Pendular-Rudder {7F3956A0-B756-11f0-801B-444553540000}.diff.lua',
    ]);
    expect(report.deviceIds?.message).toMatch(/device IDs this PC does not use/);
  });
});

describe('restoring on another PC', () => {
  it('writes to the new user folder and Steam library, and flags paths stored without a variable', async () => {
    const steam = ['Saved Games/DCS/**', 'Program Files (x86)/Steam/**'];
    const owner = await start('flying-all-good', steam);
    await track(owner, '@always', INPUT);
    // A file outside every known folder: stored as a full path.
    const loose = path.join(owner.home, '..', `${path.basename(owner.home)}-tools`, 'tool.ini');
    await fs.mkdir(path.dirname(loose), { recursive: true });
    await fs.writeFile(loose, 'volume=3\n');
    await track(owner, '@always', { label: 'Tool', path: loose, kind: 'file' });
    await track(owner, '@always', {
      label: 'DCS monitor config',
      path: '{DCS_INSTALL}/Config/MonitorSetup',
      kind: 'folder',
    });
    const made = await owner.invoke<BackupOutcomeView>('backup:backUp', {
      scope: { kind: 'full' },
    });
    const archive = path.join(owner.ports.folders.dataRoot(), 'backups', made.backup.id);

    // Bob's PC: another user folder, and DCS in a second Steam library.
    const bob = await start('flying-fresh', ['Program Files (x86)/Steam/**']);
    const steamRoot = path.join(bob.home, 'Program Files (x86)', 'Steam');
    const library = path.join(bob.home, 'Games', 'SteamLibrary');
    await fs.mkdir(path.join(library, 'steamapps', 'common'), { recursive: true });
    await fs.rename(
      path.join(steamRoot, 'steamapps', 'common', 'DCSWorld'),
      path.join(library, 'steamapps', 'common', 'DCSWorld')
    );
    const vdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
    await fs.writeFile(
      vdf,
      `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steamRoot.replace(/\\/g, '\\\\')}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${library.replace(/\\/g, '\\\\')}"\n\t}\n}\n`
    );
    await fs.mkdir(path.join(bob.home, 'Saved Games', 'DCS', 'Config'), { recursive: true });
    await fs.copyFile(archive, path.join(bob.home, 'Documents', 'owner.zip')).catch(async () => {
      await fs.mkdir(path.join(bob.home, 'Documents'), { recursive: true });
      await fs.copyFile(archive, path.join(bob.home, 'Documents', 'owner.zip'));
    });
    bob.ports.dialogs.script.open.push(['Documents/owner.zip']);
    const added = await bob.invoke<BackupView>('backup:openFile');
    const preview = await bob.invoke<RestorePreviewView>('backup:previewRestore', { id: added.id });

    const input = preview.items.find((i) => i.label === 'DCS bindings')!;
    expect(input.target).toBe(path.join(bob.home, 'Saved Games', 'DCS', 'Config', 'Input'));
    const monitor = preview.items.find((i) => i.label === 'DCS monitor config')!;
    expect(monitor.target).toBe(
      path.join(library, 'steamapps', 'common', 'DCSWorld', 'Config', 'MonitorSetup')
    );
    const tool = preview.items.find((i) => i.label === 'Tool')!;
    expect(tool).toMatchObject({ absolute: true, stored: path.resolve(loose) });

    const choices = Object.fromEntries(
      [...input.files, ...monitor.files].map((f) => [f.ref, 'overwrite'])
    );
    const report = await bob.invoke<RestoreReportView>('backup:restore', { id: added.id, choices });
    expect(report.failed).toEqual([]);
    const restoredFile = path.join(
      bob.home,
      'Saved Games',
      'DCS',
      'Config',
      'Input',
      'disabled.lua'
    );
    expect(await fs.readFile(restoredFile)).toEqual(
      await fs.readFile(dcsUser(owner, 'Config', 'Input', 'disabled.lua'))
    );
    expect(report.restored.every((r) => r.label.startsWith(bob.home))).toBe(true);
  });
});

describe('credentials are never copied', () => {
  it('leaves the SimAppPro account file and DCS vaults out of tracked folders and backups', async () => {
    const app = await start('flying-all-good', [...DCS_FILES, 'AppData/Roaming/SimAppPro/**']);
    const simAppPro = path.join(app.home, 'AppData', 'Roaming', 'SimAppPro');
    await fs.mkdir(simAppPro, { recursive: true });
    await fs.writeFile(path.join(simAppPro, 'config.json'), '{"AutoLoginSaveAccount":"c2VjcmV0"}');
    await fs.writeFile(dcsUser(app, 'Config', 'network.vault'), 'secret');
    await track(app, '@always', {
      label: 'SimAppPro',
      path: '{APPDATA}/SimAppPro',
      kind: 'folder',
    });
    const overview = await track(app, '@always', {
      label: 'DCS config',
      path: '{DCS_USER}/Config',
      kind: 'folder',
    });
    expect(overview.scopes[0]!.items.map((i) => i.withheld)).toEqual([1, 1]);
    await expect(
      track(app, '@always', { label: 'x', path: '{APPDATA}/SimAppPro/config.json', kind: 'file' })
    ).rejects.toThrow(/never backed up/);

    const outcome = await app.invoke<BackupOutcomeView>('backup:backUp', {
      scope: { kind: 'full' },
    });
    expect(outcome.withheld.map((w) => w.path)).toEqual([
      '{APPDATA}/SimAppPro/config.json',
      '{DCS_USER}/Config/network.vault',
    ]);
    const entries = await archiveEntries(app, outcome.backup);
    for (const [name, data] of entries) {
      expect(name).not.toMatch(/^items\/\d+\/config\.json$|network\.vault$/);
      expect(new TextDecoder().decode(data)).not.toContain('c2VjcmV0');
    }
  });
});

describe('untrusted backup files', () => {
  async function offer(
    app: WiredApp,
    files: Record<string, Uint8Array | [Uint8Array, object]>
  ): Promise<string> {
    const bytes = zipSync(files as never);
    await fs.mkdir(path.join(app.home, 'Downloads'), { recursive: true });
    await fs.writeFile(path.join(app.home, 'Downloads', 'evil.zip'), bytes);
    app.ports.dialogs.script.open.push(['Downloads/evil.zip']);
    try {
      await app.invoke('backup:openFile');
      return 'accepted';
    } catch (e) {
      return (e as Error).message;
    }
  }
  const text = (s: string): Uint8Array => new TextEncoder().encode(s);
  const manifest = (extra: object = {}): Uint8Array =>
    text(
      JSON.stringify({
        format: 'rigready-backup',
        schemaVersion: 1,
        createdAt: '2026-10-03T12:00:00.000Z',
        machine: 'EVIL',
        user: 'x',
        appVersion: '1',
        scope: { kind: 'full', label: 'Everything' },
        items: [],
        rigready: [],
        totals: { files: 0, bytes: 0 },
        ...extra,
      })
    );

  it('rejects traversal, links, undeclared files, bad checksums and malformed manifests; nothing is added', async () => {
    const app = await start('flying-fresh', []);
    expect(await offer(app, { 'manifest.json': manifest() })).toBe('accepted');
    expect(await offer(app, { 'manifest.json': manifest(), '../evil.txt': text('x') })).toMatch(
      /unsafe path/
    );
    expect(
      await offer(app, {
        'manifest.json': manifest(),
        link: [text('C:/Windows'), { os: 3, attrs: 0o120777 << 16 }],
      })
    ).toMatch(/link/);
    expect(await offer(app, { 'manifest.json': manifest(), 'items/0/x.exe': text('MZ') })).toMatch(
      /does not list/
    );
    const item = {
      id: 'x',
      label: 'X',
      path: '{DOCUMENTS}/x',
      kind: 'folder',
      key: '0',
      source: '@always',
      sourceName: 'Always',
      absolute: false,
      files: [{ path: 'a.txt', size: 1, sha256: 'a'.repeat(64) }],
    };
    expect(
      await offer(app, { 'manifest.json': manifest({ items: [item] }), 'items/0/a.txt': text('b') })
    ).toMatch(/damaged/);
    expect(await offer(app, { 'manifest.json': text('{ not json') })).toMatch(/not valid JSON/);
    expect(await offer(app, { 'manifest.json': manifest({ format: 'other' }) })).toMatch(
      /not valid/
    );
    expect(await offer(app, { 'readme.txt': text('hi') })).toMatch(/no manifest/);
    expect(
      await offer(app, {
        'manifest.json': manifest({
          rigready: [{ path: '../journal.jsonl', size: 1, sha256: 'a'.repeat(64) }],
        }),
      })
    ).toMatch(/not valid/);
    await app.wiring.context.settings.update({ importMaxMegabytes: 1 });
    expect(
      await offer(app, { 'manifest.json': manifest(), 'big.bin': new Uint8Array(2 * 1024 * 1024) })
    ).toMatch(/more than 1 MB/);
    const overview = await app.invoke<Overview>('backup:overview');
    expect(overview.backups).toHaveLength(1);
  });
});

describe('snapshots', () => {
  it('takes a named snapshot, shows a line-by-line diff against now, and puts it back as one undo', async () => {
    const app = await start();
    await track(app, '@always', { label: 'Scripts', path: '{DCS_USER}/Scripts', kind: 'folder' });
    const overview = await app.invoke<Overview>('backup:overview');
    const itemId = overview.scopes[0]!.items[0]!.item.id;
    await expect(
      app.invoke('backup:takeSnapshot', { scope: '@always', itemId, name: ' ' })
    ).rejects.toThrow(/name/);
    const snap = await app.invoke<{ id: string; fileCount: number }>('backup:takeSnapshot', {
      scope: '@always',
      itemId,
      name: 'Before DCS-BIOS update',
    });
    expect(snap.fileCount).toBe(5);

    const exportFile = dcsUser(app, 'Scripts', 'Export.lua');
    const original = await fs.readFile(exportFile, 'utf8');
    await fs.writeFile(exportFile, original.replace(/\n/, '\n-- added by a tool\n'));
    await fs.writeFile(dcsUser(app, 'Scripts', 'Hooks.lua'), 'x');
    await fs.rm(dcsUser(app, 'Scripts', 'wwt', 'wwtNetwork.lua'));
    const compared = await app.invoke<{
      comparison: {
        unchanged: number;
        changes: {
          key: string;
          status: string;
          diff?: { added: number; hunks: { lines: { kind: string; text: string }[] }[] };
        }[];
      };
    }>('backup:compareSnapshot', { id: snap.id });
    expect(compared.comparison.unchanged).toBe(3);
    expect(compared.comparison.changes.map((c) => [c.key, c.status])).toEqual([
      ['Export.lua', 'changed'],
      ['Hooks.lua', 'added'],
      ['wwt/wwtNetwork.lua', 'removed'],
    ]);
    const diff = compared.comparison.changes[0]!.diff!;
    expect(diff.added).toBe(1);
    expect(diff.hunks[0]!.lines).toContainEqual({ kind: '+', text: '-- added by a tool' });

    const restored = await app.invoke<{ written: number; leftAlone: number; groupId: string }>(
      'backup:restoreSnapshot',
      { id: snap.id }
    );
    expect(restored).toMatchObject({ written: 2, leftAlone: 1 });
    expect(await fs.readFile(exportFile, 'utf8')).toBe(original);
    const groups = await app.ports.files.journalGroups();
    expect(groups.ok && groups.value[0]!.reason).toBe(
      'Put back snapshot "Before DCS-BIOS update" of Scripts'
    );

    await app.invoke('backup:renameSnapshot', { id: snap.id, name: 'Known good' });
    expect((await app.invoke<{ name: string }[]>('backup:snapshots'))[0]!.name).toBe('Known good');
    await app.invoke('backup:removeSnapshot', { id: snap.id });
    expect(await app.invoke('backup:snapshots')).toEqual([]);
    // The stored copies went with it.
    const blobs = await fs
      .readdir(path.join(app.ports.folders.dataRoot(), 'backup', 'blobs'), { recursive: true })
      .catch(() => []);
    expect(blobs.filter((b) => /[0-9a-f]{64}$/.test(String(b)))).toEqual([]);
  });
});

describe('what changed since it last worked', () => {
  it('records the tracked files when the game starts, then shows what differs now', async () => {
    const app = await start();
    await track(app, 'dcs-f-a-18c', INPUT);
    await track(app, '@always', OPTIONS);
    let changes = await app.invoke<ChangesViewData>('backup:changes', { profileId: 'dcs-f-a-18c' });
    expect(changes).toEqual({ profileId: 'dcs-f-a-18c', trackedItems: 2 });

    const recorded: string[] = [];
    const watcher = new LaunchWatcher(app.wiring.context, (id) => recorded.push(id));
    expect(await watcher.poll()).toEqual([]); // learns what runs already
    await mutate(app, [
      { op: 'startProcess', name: 'Notepad.exe', path: 'C:\\Windows\\notepad.exe' },
    ]);
    expect(await watcher.poll()).toEqual([]);
    await mutate(app, [{ op: 'startProcess', name: 'DCS.exe', path: 'C:\\DCS\\bin\\DCS.exe' }]);
    expect(await watcher.poll()).toEqual(['dcs-f-a-18c']);
    expect(recorded).toEqual(['dcs-f-a-18c']);
    // Still running: not recorded again.
    expect(await watcher.poll()).toEqual([]);

    changes = await app.invoke<ChangesViewData>('backup:changes', { profileId: 'dcs-f-a-18c' });
    expect(changes.knownGood).toMatchObject({ reason: 'Launched DCS.exe', fileCount: 19 });
    expect(changes.comparison).toEqual({ changes: [], unchanged: 19 });

    const options = dcsUser(app, 'Config', 'options.lua');
    const text = await fs.readFile(options, 'utf8');
    await fs.writeFile(
      options,
      text.replace(/\["fullScreen"\] = (true|false)/, '["fullScreen"] = nil')
    );
    const rudder = dcsUser(
      app,
      'Config',
      'Input',
      'FA-18C_hornet',
      'joystick',
      'T-Pendular-Rudder {7F3956A0-B756-11f0-801B-444553540000}.diff.lua'
    );
    await fs.rm(rudder);
    changes = await app.invoke<ChangesViewData>('backup:changes', { profileId: 'dcs-f-a-18c' });
    const keys = changes.comparison!.changes.map((c) => [c.key, c.status]);
    expect(keys).toEqual([
      [
        '{DCS_USER}/Config/Input/FA-18C_hornet/joystick/T-Pendular-Rudder {7F3956A0-B756-11f0-801B-444553540000}.diff.lua',
        'removed',
      ],
      ['{DCS_USER}/Config/options.lua', 'changed'],
    ]);
    const diff = changes.comparison!.changes[1]!.diff!;
    expect(diff.removed).toBe(1);
    expect(diff.added).toBe(1);

    const marked = await app.invoke<ChangesViewData>('backup:markWorking', {
      profileId: 'dcs-f-a-18c',
    });
    expect(marked.knownGood?.reason).toBe('Marked as working');
    expect(marked.comparison?.changes).toEqual([]);
  });
});
