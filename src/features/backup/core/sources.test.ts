import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readZip } from '../../../core/files/zip';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type {
  BackupOutcomeView,
  BackupView,
  Overview,
  RestorePreviewView,
  RestoreReportView,
  Suggestion,
} from '../contract';

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

async function start(scenario = 'racing-fresh'): Promise<WiredApp> {
  const app = await wiredApp(scenario);
  apps.push(app);
  return app;
}

const suggestionsOf = (app: WiredApp): Promise<Suggestion[]> =>
  app.invoke<Suggestion[]>('backup:suggestions');

/** What the Add button does: the suggestion as it is, into "Always back up". */
async function add(app: WiredApp, label: string): Promise<Suggestion> {
  const suggestion = (await suggestionsOf(app)).find((s) => s.label === label);
  if (!suggestion) throw new Error(`No suggestion "${label}"`);
  await app.invoke<Overview>('backup:saveItem', {
    scope: '@always',
    item: {
      label: suggestion.label,
      path: suggestion.path,
      kind: suggestion.kind,
      include: suggestion.include ?? [],
      exclude: suggestion.exclude ?? [],
      ...(suggestion.game ? { game: suggestion.game } : {}),
    },
  });
  return suggestion;
}

async function archive(app: WiredApp, backup: BackupView): Promise<Map<string, Uint8Array>> {
  const bytes = await fs.readFile(path.join(app.ports.folders.dataRoot(), 'backups', backup.id));
  const entries = readZip(new Uint8Array(bytes));
  if (!entries.ok) throw new Error(entries.error.message);
  return new Map(entries.value.map((e) => [e.path, e.data]));
}

interface ManifestItem {
  key: string;
  label: string;
  path: string;
  files: { path: string }[];
}

async function manifestOf(
  app: WiredApp,
  backup: BackupView
): Promise<{ items: ManifestItem[]; records: { path: string; label: string; from: string }[] }> {
  const entries = await archive(app, backup);
  return JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
}

const filesOf = (items: ManifestItem[], label: string): string[] =>
  items.find((i) => i.label === label)!.files.map((f) => f.path);

const fullBackup = (app: WiredApp): Promise<BackupOutcomeView> =>
  app.invoke<BackupOutcomeView>('backup:backUp', { scope: { kind: 'full' } });

/** Ticks everything that differs, the way the restore screen starts out. */
function choicesOf(preview: RestorePreviewView): Record<string, 'overwrite'> {
  const choices: Record<string, 'overwrite'> = {};
  for (const item of preview.items)
    for (const f of item.files) if (f.status !== 'same') choices[f.ref] = 'overwrite';
  return choices;
}

const iracing = (app: WiredApp, ...parts: string[]): string =>
  path.join(app.ports.folders.documents(), 'iRacing', ...parts);
const trackIr = (app: WiredApp, ...parts: string[]): string =>
  path.join(app.ports.folders.appData(), 'NaturalPoint', 'TrackIR 5', ...parts);
const fanatecPrefs = (app: WiredApp): string =>
  path.join(app.ports.folders.appData(), 'com.example', 'Fanatec', 'shared_preferences.json');

describe('what games and tools suggest', () => {
  it('suggests the racing games, MSFS, Stream Deck, TrackIR and Fanatec, each one click to add', async () => {
    const app = await start();
    const suggestions = await suggestionsOf(app);
    const bySource = (source: string): string[] =>
      suggestions.filter((s) => s.source === source).map((s) => s.label);

    expect(bySource('iRacing')[0]).toBe('iRacing settings and bindings');
    expect(bySource('Le Mans Ultimate')[0]).toBe('Le Mans Ultimate settings and bindings');
    expect(bySource('BeamNG.drive')[0]).toBe('BeamNG.drive settings and bindings');
    expect(bySource('Assetto Corsa')[0]).toBe('Assetto Corsa settings and bindings');
    expect(bySource('Microsoft Flight Simulator 2024')).toContain(
      'Graphics and paths (UserCfg.opt)'
    );
    expect(bySource('Stream Deck')).toEqual([
      'Stream Deck profiles',
      'Stream Deck plugin list',
      'Stream Deck plugins (whole folders)',
    ]);
    expect(bySource('TrackIR')[0]).toBe('TrackIR settings and profiles');
    expect(bySource('Fanatec')).toEqual(['Fanatec App settings']);

    // Stored with a path variable, with patterns and a line on what it holds.
    const lmu = suggestions.find((s) => s.label === 'Le Mans Ultimate settings and bindings')!;
    expect(lmu).toMatchObject({
      path: '{LMU_USER}',
      kind: 'folder',
      game: 'lmu',
      include: ['player/*.json', 'player/*.gal', 'player/Settings/**', 'Config_DX11*.ini'],
      exclude: ['Log/**'],
    });
    expect(lmu.description).toContain('Logs are left out');
    expect(lmu.fileCount).toBeGreaterThan(2);
    expect(suggestions.find((s) => s.label === 'iRacing settings and bindings')).toMatchObject({
      path: '{IRACING_USER}',
      kind: 'folder',
      game: 'iracing',
    });
    expect(suggestions.find((s) => s.label === 'Stream Deck profiles')!.path).toBe(
      '{APPDATA}/Elgato/StreamDeck/ProfilesV3'
    );
    expect(suggestions.find((s) => s.label === 'Fanatec App settings')).toMatchObject({
      path: '{APPDATA}/com.example/Fanatec/shared_preferences.json',
      kind: 'file',
    });

    await add(app, 'iRacing settings and bindings');
    const after = await suggestionsOf(app);
    expect(after.find((s) => s.label === 'iRacing settings and bindings')!.trackedIn).toEqual([
      '@always',
    ]);
  });

  it('a full backup holds the added iRacing, Le Mans Ultimate, BeamNG, Stream Deck, TrackIR and Fanatec files', async () => {
    const app = await start();
    await fs.mkdir(trackIr(app, 'Profiles'), { recursive: true });
    await fs.writeFile(trackIr(app, 'Settings.xml'), '<Settings/>');
    await fs.writeFile(trackIr(app, 'Profiles', 'flying.xml'), '<Profile/>');
    await fs.writeFile(trackIr(app, 'Profiles', 'notes.txt'), 'not a profile');
    for (const label of [
      'iRacing settings and bindings',
      'Le Mans Ultimate settings and bindings',
      'BeamNG.drive settings and bindings',
      'Assetto Corsa settings and bindings',
      'Stream Deck profiles',
      'Stream Deck plugin list',
      'TrackIR settings and profiles',
      'Fanatec App settings',
    ]) {
      await add(app, label);
    }
    // Stream Deck and the Fanatec service run in this scenario: a backup only reads.
    const outcome = await fullBackup(app);
    expect(outcome.skipped).toEqual([]);
    const { items } = await manifestOf(app, outcome.backup);

    expect(filesOf(items, 'iRacing settings and bindings')).toEqual(
      expect.arrayContaining(['controls.cfg', 'joyCalib.yaml', 'app.ini', 'core.ini'])
    );
    const lmu = filesOf(items, 'Le Mans Ultimate settings and bindings');
    expect(lmu).toEqual(
      expect.arrayContaining([
        'Config_DX11.ini',
        'player/direct input.json',
        'player/Settings.JSON',
      ])
    );
    expect(lmu.some((f) => f.toLowerCase().startsWith('log/'))).toBe(false);
    expect(
      filesOf(items, 'BeamNG.drive settings and bindings').some((f) => f.startsWith('inputmaps/'))
    ).toBe(true);
    expect(filesOf(items, 'Assetto Corsa settings and bindings')).toEqual(
      expect.arrayContaining(['controls.ini', 'video.ini'])
    );
    expect(filesOf(items, 'TrackIR settings and profiles').sort()).toEqual([
      'ProfileMap.dat',
      'Profiles/flying.xml',
      'Settings.xml',
    ]);
    const profiles = filesOf(items, 'Stream Deck profiles');
    expect(profiles.length).toBeGreaterThan(1);
    expect(profiles.every((f) => f.endsWith('manifest.json'))).toBe(true);
    const plugins = filesOf(items, 'Stream Deck plugin list');
    expect(plugins.length).toBeGreaterThan(0);
    expect(plugins.every((f) => /^[^/]+\/manifest\.json$/.test(f))).toBe(true);
    expect(filesOf(items, 'Fanatec App settings')).toEqual(['shared_preferences.json']);

    // Byte for byte.
    const entries = await archive(app, outcome.backup);
    const key = items.find((i) => i.label === 'iRacing settings and bindings')!.key;
    expect(Buffer.from(entries.get(`items/${key}/controls.cfg`)!)).toEqual(
      await fs.readFile(iracing(app, 'controls.cfg'))
    );
  });

  it('keeps the Fanatec driver settings from the registry as a record that is shown and never restored', async () => {
    const app = await start();
    await add(app, 'Fanatec App settings');
    const outcome = await fullBackup(app);
    expect(outcome.backup.records).toEqual([
      {
        label: 'Fanatec driver settings (registry)',
        from: 'HKEY_CURRENT_USER\\Software\\Endor\\FanatecService',
      },
    ]);
    // The record is not counted with the files that can be restored (the settings file
    // and RigReady's own tracked list).
    expect(outcome.backup.fileCount).toBe(2);
    const entries = await archive(app, outcome.backup);
    const record = JSON.parse(
      new TextDecoder().decode(entries.get('records/fanatec-service.json'))
    );
    expect(Object.keys(record.keys)).toContain('Games');

    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: outcome.backup.id,
    });
    expect(preview.records).toHaveLength(1);
    expect(preview.records[0]).toMatchObject({
      label: 'Fanatec driver settings (registry)',
      source: 'Fanatec',
      truncated: false,
    });
    expect(preview.records[0]!.text).toContain('"Games"');
    // Nothing in the restore plan refers to it: there is no choice that would write it.
    const refs = [
      ...preview.items.flatMap((i) => i.files.map((f) => f.ref)),
      ...preview.own.map((o) => o.ref),
    ];
    expect(refs.some((r) => r.includes('record'))).toBe(false);
  });

  it('a backup file whose record does not match its checksum is rejected', async () => {
    const app = await start();
    await add(app, 'Fanatec App settings');
    const outcome = await fullBackup(app);
    const file = path.join(app.ports.folders.dataRoot(), 'backups', outcome.backup.id);
    const { zipSync } = await import('fflate');
    const entries = await archive(app, outcome.backup);
    entries.set('records/fanatec-service.json', new TextEncoder().encode('{"keys":{}}'));
    await fs.writeFile(file, zipSync(Object.fromEntries(entries)));
    await expect(app.invoke('backup:previewRestore', { id: outcome.backup.id })).rejects.toThrow(
      /damaged: records\/fanatec-service\.json/
    );
  });
});

describe('restoring while the game or tool is running', () => {
  it('iRacing: refused while the simulator runs, saying why; the UI alone does not block; restores byte for byte', async () => {
    const app = await start();
    await add(app, 'iRacing settings and bindings');
    const original = await fs.readFile(iracing(app, 'controls.cfg'));
    const outcome = await fullBackup(app);
    await fs.writeFile(iracing(app, 'controls.cfg'), 'changed by a new wheel');
    await fs.writeFile(iracing(app, 'app.ini'), '[Force Feedback]\n');

    await mutate(app, [
      {
        op: 'startProcess',
        name: 'iRacingSim64DX11.exe',
        path: 'C:\\iRacing\\iRacingSim64DX11.exe',
      },
    ]);
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: outcome.backup.id,
    });
    expect(preview.running).toEqual([
      {
        id: 'game:iracing',
        name: 'iRacing',
        why: 'iRacing writes these files when the simulator exits, which would undo the restore.',
        processes: ['iRacingSim64DX11.exe'],
        restart: false,
        items: ['iRacing settings and bindings'],
      },
    ]);
    const choices = choicesOf(preview);
    await expect(app.invoke('backup:restore', { id: outcome.backup.id, choices })).rejects.toThrow(
      /iRacing is running \(iRacingSim64DX11\.exe\)\. iRacing writes these files when the simulator exits.*Nothing was restored/
    );
    expect(await fs.readFile(iracing(app, 'controls.cfg'), 'utf8')).toBe('changed by a new wheel');

    // The launcher UI does not write these files.
    await mutate(app, [
      { op: 'stopProcess', name: 'iRacingSim64DX11.exe' },
      { op: 'startProcess', name: 'iRacingUI.exe', path: 'C:\\iRacing\\ui\\iRacingUI.exe' },
    ]);
    const report = await app.invoke<RestoreReportView>('backup:restore', {
      id: outcome.backup.id,
      choices,
    });
    expect(report.failed).toEqual([]);
    expect(report.restored).toHaveLength(2);
    expect(report.closed).toEqual([]);
    expect(await fs.readFile(iracing(app, 'controls.cfg'))).toEqual(original);
    expect(app.ports.processes.closed).toEqual([]);
  });

  it('Le Mans Ultimate: asks the game to close when told to, and leaves it closed', async () => {
    const app = await start();
    const suggestion = await add(app, 'Le Mans Ultimate settings and bindings');
    expect(suggestion.path).toBe('{LMU_USER}');
    const outcome = await fullBackup(app);
    const variables = await app.wiring.context.games.get('lmu')!.pathVariables!(app.ctx);
    const user = variables.ok ? variables.value['LMU_USER']! : '';
    const bindings = path.join(user, 'player', 'direct input.json');
    const original = await fs.readFile(bindings);
    await fs.writeFile(bindings, '{}');

    await mutate(app, [
      { op: 'startProcess', name: 'Le Mans Ultimate.exe', path: 'D:\\LMU\\Le Mans Ultimate.exe' },
    ]);
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: outcome.backup.id,
    });
    expect(preview.running.map((p) => [p.name, p.why])).toEqual([
      [
        'Le Mans Ultimate',
        'Le Mans Ultimate rewrites its player files when it starts and when it exits.',
      ],
    ]);
    const choices = choicesOf(preview);
    await expect(app.invoke('backup:restore', { id: outcome.backup.id, choices })).rejects.toThrow(
      /Le Mans Ultimate is running/
    );

    // A game that ignores the request is never ended by force.
    app.ports.processes.stubborn.add('le mans ultimate.exe');
    await expect(
      app.invoke('backup:restore', { id: outcome.backup.id, choices, closePrograms: true })
    ).rejects.toThrow(/Le Mans Ultimate did not close when asked.*Nothing was restored/);
    expect(app.ports.processes.closed.at(-1)!.options.force).toBe(false);
    expect(await fs.readFile(bindings, 'utf8')).toBe('{}');

    app.ports.processes.stubborn.clear();
    const report = await app.invoke<RestoreReportView>('backup:restore', {
      id: outcome.backup.id,
      choices,
      closePrograms: true,
    });
    expect(report.failed).toEqual([]);
    expect(report.closed).toEqual([{ name: 'Le Mans Ultimate' }]);
    expect(await fs.readFile(bindings)).toEqual(original);
    // A game is not started again by a restore.
    expect(app.ports.processes.started).toEqual([]);
  });

  it('Fanatec: round-trips the App settings, closing the Fanatec App first and starting it again', async () => {
    const app = await start();
    await add(app, 'Fanatec App settings');
    const original = await fs.readFile(fanatecPrefs(app));
    const outcome = await fullBackup(app);
    await fs.writeFile(fanatecPrefs(app), '{}');
    const exe = path.join(app.home, 'Program Files', 'Fanatec', 'FanatecUI', 'UI', 'Fanatec.exe');
    await mutate(app, [{ op: 'startProcess', name: 'Fanatec.exe', path: exe }]);

    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: outcome.backup.id,
    });
    expect(preview.running).toMatchObject([
      { name: 'Fanatec App', restart: true, items: ['Fanatec App settings'] },
    ]);
    const choices = choicesOf(preview);
    await expect(app.invoke('backup:restore', { id: outcome.backup.id, choices })).rejects.toThrow(
      /Fanatec App is running \(Fanatec\.exe\)\. The Fanatec App writes its settings when it closes/
    );
    const report = await app.invoke<RestoreReportView>('backup:restore', {
      id: outcome.backup.id,
      choices,
      closePrograms: true,
    });
    expect(report.failed).toEqual([]);
    expect(report.closed).toEqual([{ name: 'Fanatec App', restarted: true }]);
    expect(await fs.readFile(fanatecPrefs(app))).toEqual(original);
    expect(app.ports.processes.closed.map((c) => c.name)).toEqual(['Fanatec.exe']);
    expect(app.ports.processes.started.at(-1)).toEqual({ exe, args: [] });

    // The restore is one action on the Safety page and can be undone.
    const undone = await app.ports.files.undoGroup(report.groupId!);
    expect(undone.ok).toBe(true);
    expect(await fs.readFile(fanatecPrefs(app), 'utf8')).toBe('{}');
  });

  it('TrackIR: restores Settings.xml, ProfileMap.dat and the profiles through the change journal', async () => {
    const app = await start('trackir-ready');
    await add(app, 'TrackIR settings and profiles');
    const outcome = await fullBackup(app);
    const { items } = await manifestOf(app, outcome.backup);
    expect(filesOf(items, 'TrackIR settings and profiles').sort()).toEqual([
      'ProfileMap.dat',
      'Profiles/default.xml',
      'Profiles/driving.xml',
      'Profiles/flying.xml',
      'Profiles/smooth.xml',
      'Settings.xml',
    ]);
    const settings = await fs.readFile(trackIr(app, 'Settings.xml'));
    const profile = await fs.readFile(trackIr(app, 'Profiles', 'flying.xml'));
    await fs.writeFile(trackIr(app, 'Settings.xml'), '<broken/>');
    await fs.rm(trackIr(app, 'Profiles', 'flying.xml'));

    // TrackIR runs in this scenario: it is closed for the restore and started again.
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: outcome.backup.id,
    });
    expect(preview.running.map((p) => p.name)).toEqual(['TrackIR']);
    const report = await app.invoke<RestoreReportView>('backup:restore', {
      id: outcome.backup.id,
      choices: choicesOf(preview),
      closePrograms: true,
    });
    expect(report.failed).toEqual([]);
    expect(report.restored).toHaveLength(2);
    expect(report.closed).toEqual([{ name: 'TrackIR', restarted: true }]);
    expect(await fs.readFile(trackIr(app, 'Settings.xml'))).toEqual(settings);
    expect(await fs.readFile(trackIr(app, 'Profiles', 'flying.xml'))).toEqual(profile);

    const groups = await app.ports.files.journalGroups();
    const group = groups.ok ? groups.value.find((g) => g.id === report.groupId) : undefined;
    expect(group?.reason).toMatch(/^Restore backup "/);
    expect(group?.entries.map((e) => path.basename(e.path)).sort()).toEqual([
      'Settings.xml',
      'flying.xml',
    ]);
  });

  it('Stream Deck: profiles in a full backup restore only with the app closed', async () => {
    const app = await start();
    await add(app, 'Stream Deck profiles');
    const outcome = await fullBackup(app);
    const folder = path.join(app.ports.folders.appData(), 'Elgato', 'StreamDeck', 'ProfilesV3');
    const first = (await fs.readdir(folder))[0]!;
    const manifest = path.join(folder, first, 'manifest.json');
    const original = await fs.readFile(manifest);
    await fs.writeFile(manifest, '{}');
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: outcome.backup.id,
    });
    expect(preview.running).toMatchObject([{ name: 'Stream Deck', restart: true }]);
    await expect(
      app.invoke('backup:restore', { id: outcome.backup.id, choices: choicesOf(preview) })
    ).rejects.toThrow(/Stream Deck is running.*writes them when it quits/);
    const report = await app.invoke<RestoreReportView>('backup:restore', {
      id: outcome.backup.id,
      choices: choicesOf(preview),
      closePrograms: true,
    });
    expect(report.closed).toEqual([{ name: 'Stream Deck', restarted: true }]);
    expect(await fs.readFile(manifest)).toEqual(original);
  });

  it('does not restore on a guess when the running programs cannot be read', async () => {
    const app = await start();
    await add(app, 'Fanatec App settings');
    const outcome = await fullBackup(app);
    await fs.writeFile(fanatecPrefs(app), '{}');
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: outcome.backup.id,
    });
    app.ports.processes.list = async () => ({
      ok: false,
      error: { code: 'process.list', message: 'tasklist failed' },
    });
    await expect(
      app.invoke('backup:restore', { id: outcome.backup.id, choices: choicesOf(preview) })
    ).rejects.toThrow(/could not see which programs are running/);
    expect(await fs.readFile(fanatecPrefs(app), 'utf8')).toBe('{}');
  });

  it('a snapshot is not put back while its game runs', async () => {
    const app = await start();
    await add(app, 'iRacing settings and bindings');
    const overview = await app.invoke<Overview>('backup:overview');
    const item = overview.scopes[0]!.items[0]!.item;
    const snapshot = await app.invoke<{ id: string }>('backup:takeSnapshot', {
      scope: '@always',
      itemId: item.id,
      name: 'Before the league race',
    });
    await fs.writeFile(iracing(app, 'controls.cfg'), 'changed');
    await mutate(app, [
      {
        op: 'startProcess',
        name: 'iRacingSim64DX11.exe',
        path: 'C:\\iRacing\\iRacingSim64DX11.exe',
      },
    ]);
    await expect(app.invoke('backup:restoreSnapshot', { id: snapshot.id })).rejects.toThrow(
      /iRacing is running.*Nothing was put back/
    );
    await mutate(app, [{ op: 'stopProcess', name: 'iRacingSim64DX11.exe' }]);
    expect(await app.invoke('backup:restoreSnapshot', { id: snapshot.id })).toMatchObject({
      written: 1,
    });
  });
});
