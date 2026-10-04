import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ActionReport, ChecklistReport } from '../../src/core/checks/engine';
import { isWithin } from '../../src/core/paths';
import type { JournalEntry } from '../../src/core/ports';
import type { CheckItem } from '../../src/core/profile/schema';
import { ChangePreviewSchema, type ChangePreview } from '../../src/shared/changePreview';
import type { Contract } from '../../src/shared/ipc';
import { repoRoot, wiredApp, type WiredApp } from '../helpers';

/**
 * BACKUP-011, "a visible description of every change": nothing outside RigReady's folder is
 * written unless the user asked for it and was shown, first, which files change and how.
 *
 * Four things are checked here, each as mechanically as it can be:
 *
 *  1. The journal schema: every entry carries the user action it belongs to (`groupId`,
 *     `groupReason`) and a reason a person can read.
 *  2. No background writes: starting the app, letting it idle and calling every IPC channel
 *     that takes no input (every read) leaves the journal empty. Channels are enumerated from
 *     the wired app, so a new feature is covered without editing this file.
 *  3. A source rule per feature folder (enumerated from disk): a feature whose code calls a
 *     FileStore write must build a preview with `previewWrites` / `changePreview` and expose a
 *     preview channel, or be on the reasoned list below.
 *  4. For every previewed flow: what the preview said is exactly what the journal then shows.
 *     And for fixes that Make ready runs in one click: the fix text beside the failing check
 *     names each file it then writes, and the Make ready summary names it again.
 */

let app: WiredApp | undefined;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
  app = undefined;
});

const contracts = Object.values(
  import.meta.glob<Record<string, unknown>>('../../src/features/*/contract.ts', { eager: true })
)
  .flatMap((module) => Object.values(module))
  .filter(
    (value): value is Contract =>
      typeof value === 'object' && value !== null && 'feature' in value && 'channels' in value
  );
const channelsOf = (feature: string): string[] =>
  contracts.filter((c) => c.feature === feature).flatMap((c) => Object.keys(c.channels));

async function journal(target: WiredApp): Promise<JournalEntry[]> {
  const entries = await target.ports.files.journal();
  if (!entries.ok) throw new Error(entries.error.message);
  return entries.value;
}

/** The journal entries an action added, oldest first. */
async function during(target: WiredApp, action: () => Promise<unknown>): Promise<JournalEntry[]> {
  const before = new Set((await journal(target)).map((e) => e.id));
  await action();
  return (await journal(target)).filter((e) => !before.has(e.id)).reverse();
}

const lower = (file: string): string => path.resolve(file).toLowerCase();

// ---------------------------------------------------------------- 1. journal schema

const JournalEntrySchema = z.object({
  id: z.string().min(1),
  time: z.iso.datetime(),
  path: z.string().refine((p) => path.isAbsolute(p), 'absolute path'),
  action: z.enum(['write', 'remove']),
  /** Words a person can read, not an empty string or a code. */
  reason: z.string().regex(/[A-Za-z]{3,}/),
  /** The user action the change belongs to. */
  groupId: z.string().min(1),
  groupReason: z.string().regex(/[A-Za-z]{3,}/),
  backupPath: z.string().nullable(),
  undone: z.boolean(),
});

describe('the journal schema: every change belongs to a user action', () => {
  it('gives every kind of change a group id, a group reason and a readable reason', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { files } = app.ports;
    const dir = path.join(app.home, 'Documents', 'Some Game');
    await fs.mkdir(path.join(dir, 'tree'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tree', 'a.cfg'), 'a');
    await fs.writeFile(path.join(dir, 'tree', 'b.cfg'), 'b');

    // Every writing method of FileStore, alone and as part of a group.
    await files.write(path.join(dir, 'one.cfg'), 'x=1', { reason: 'Write one file' });
    await files.copy(path.join(dir, 'one.cfg'), path.join(dir, 'two.cfg'), { reason: 'Copy it' });
    await files.move(path.join(dir, 'two.cfg'), path.join(dir, 'three.cfg'), {
      reason: 'Rename it',
    });
    await files.remove(path.join(dir, 'three.cfg'), { reason: 'Remove it' });
    await files.copyTree(path.join(dir, 'tree'), path.join(dir, 'copy'), {
      reason: 'Copy a folder',
    });
    const group = files.beginGroup('Two files in one action');
    await files.write(path.join(dir, 'g1.cfg'), '1', { reason: 'First of two', group });
    await files.write(path.join(dir, 'g2.cfg'), '2', { reason: 'Second of two', group });
    const undone = await files.undoGroup(group.id);
    expect(undone.ok).toBe(true);

    const entries = await journal(app);
    // write, copy, move (2), remove, copyTree (2), group (2), their undo (2)
    expect(entries).toHaveLength(11);
    for (const entry of entries) {
      const parsed = JournalEntrySchema.safeParse(entry);
      expect(parsed.success ? '' : `${entry.path}: ${z.prettifyError(parsed.error)}`).toBe('');
    }
    // One action, one id: the grouped writes share it, a single change is its own action.
    const grouped = entries.filter((e) => e.groupReason === 'Two files in one action');
    expect(new Set(grouped.map((e) => e.groupId))).toEqual(new Set([group.id]));
    const single = entries.find((e) => e.reason === 'Write one file')!;
    expect(single.groupId).toBe(single.id);
    // Every entry is listed under exactly one action on the Safety page.
    const groups = await files.journalGroups();
    expect(groups.ok && groups.value.flatMap((g) => g.entries).length).toBe(entries.length);
  });
});

// ---------------------------------------------------------------- 2. no background writes

describe('no background writes', () => {
  it('writes nothing outside its folder while starting, idling and answering every read', async () => {
    // The whole recorded rig, a setup, and every feature wired: as much as there is to tempt it.
    app = await wiredApp('flying-all-good');
    const running = app;
    const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    await settle(200);
    expect(await journal(running)).toEqual([]);

    // Idle: watchers poll on the clock; move it on by a day in steps.
    for (let i = 0; i < 24; i++) running.clock.advance(60 * 60 * 1000);
    await settle(200);
    expect(await journal(running)).toEqual([]);

    // Every channel that takes no input. A channel that needs input refuses `undefined` in
    // validation and never runs; the ones that run are the reads (and a few no-argument
    // actions, which on this healthy rig have nothing to write either).
    const ran: string[] = [];
    for (const [channel, handler] of running.wiring.handlers) {
      const envelope = await handler(undefined);
      if (envelope.ok || envelope.error.code !== 'ipc.input') ran.push(channel);
      const entries = await journal(running);
      expect(entries.map((e) => `${channel} wrote ${e.path}`)).toEqual([]);
    }
    // The enumeration is real: every feature with a contract answered at least one read.
    for (const feature of ['fly', 'backup', 'dcs-bindings', 'dcs-setup', 'racing', 'stream-deck']) {
      expect(ran.some((c) => c.startsWith(`${feature}:`))).toBe(true);
    }
    expect(ran.length).toBeGreaterThan(40);

    // The Fly screen's own traffic: checking a setup, over and over, is a read.
    const state = await running.invoke<{ profiles: { id: string }[] }>('fly:state');
    expect(state.profiles.length).toBeGreaterThan(0);
    for (const profile of state.profiles) {
      await running.invoke('fly:check', { profileId: profile.id });
      await running.invoke('fly:view', { profileId: profile.id });
      await running.invoke('fly:gameStatus', { profileId: profile.id });
    }
    await settle(100);
    expect(await journal(running)).toEqual([]);
  });
});

// ---------------------------------------------------------------- 3. the source rule

/**
 * Features whose code calls a FileStore write and that do not build their preview with
 * `previewWrites` / `changePreview`. Each needs a reason; `previews` names the channels that
 * show the change first (checked against the contract).
 */
const REASONED: Record<string, { why: string; previews?: Record<string, string> }> = {
  'ai-assist': {
    why: 'Its own writes are inside the data folder (the guide a model drafted, kept as a YAML file there). Changes to binding files are not written by this feature: they go to the bindings feature as proposals (core/bindings.ts), whose plan is shown in the review dialog before Apply.',
  },
  'checks-generic': {
    why: 'No screen and no IPC of its own. Its one write outside the data folder is the "Restore from a backup" fix, which Make ready runs in one click by design: the fix text beside the failing check names the file and the copy it comes from (tested below). Its saved copies live inside the data folder.',
  },
  'dcs-bindings': {
    why: 'Has a richer preview of its own: every write goes through executePlan (core/changes.ts), and the plan channels return the same plan as a ChangePlan (per file: created, changed, renamed or deleted, what it means, and the exact line diff), shown in PlanDialog before Apply. Snapshots are stored inside the data folder.',
    previews: {
      apply: 'plan',
      migrationApply: 'migrationPlan',
      snapshotRestore: 'snapshotRestorePlan',
    },
  },
  diagnostics: {
    why: 'Its one write is the diagnostics zip, a new file at the place the user names in a Save dialog (the page lists what goes into it, with the redacted text shown, before Export). It changes no existing game or tool file.',
  },
  displays: {
    why: 'Writes only inside the data folder (monitor names, the pending-revert note, upright answers).',
  },
  sharing: {
    why: 'Has a preview of its own: openImport reports every file of the bundle with where it lands and whether it is new, the same or different, shown on the import screen with a tick per group before Import. Export writes the one file the user names in a Save dialog.',
    previews: { import: 'openImport' },
  },
};

const WRITE_CALL = /\bfiles\s*\.\s*(?:write|copy|move|remove|copyTree)\s*\(|\bextractZip\s*\(/;
const USES_PREVIEW = /core\/files\/preview['"]/;

async function featureSources(feature: string): Promise<string> {
  const root = path.join(repoRoot, 'src', 'features', feature);
  const texts: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'renderer') await walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        texts.push(await fs.readFile(full, 'utf8'));
      }
    }
  };
  await walk(root);
  return texts.join('\n');
}

describe('the source rule: a feature that writes files shows the change first', () => {
  it('every feature that calls a FileStore write builds a preview or is on the reasoned list', async () => {
    const features = (
      await fs.readdir(path.join(repoRoot, 'src', 'features'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(features.length).toBeGreaterThan(10);

    const problems: string[] = [];
    const writers: string[] = [];
    for (const feature of features) {
      const source = await featureSources(feature);
      if (!WRITE_CALL.test(source)) continue;
      writers.push(feature);
      if (REASONED[feature]) continue;
      const previewChannels = channelsOf(feature).filter((c) => /preview/i.test(c));
      if (!USES_PREVIEW.test(source)) {
        problems.push(
          `${feature} writes files through FileStore but never builds a preview. Describe the change with changePreview() from src/core/files/preview.ts, return it from a "...Preview" channel, show it with ConfirmChanges.vue, then apply the same plan under one beginGroup(). (A feature that only writes inside the data folder: use JsonStore, or add it to REASONED in this test with the reason.)`
        );
      } else if (previewChannels.length === 0) {
        problems.push(
          `${feature} builds a preview but its contract has no channel named "...Preview" to show it before the write.`
        );
      }
    }
    expect(problems).toEqual([]);
    // The rule is live: these are known to write game or tool files.
    expect(writers).toEqual(
      expect.arrayContaining(['backup', 'dcs-bindings', 'dcs-setup', 'racing', 'stream-deck'])
    );

    // The reasoned list stays honest: no entry for a feature that is gone or no longer writes,
    // and the preview channels it names exist.
    for (const [feature, entry] of Object.entries(REASONED)) {
      expect(writers, `${feature} is on the reasoned list but does not write files`).toContain(
        feature
      );
      expect(entry.why.length).toBeGreaterThan(40);
      for (const [apply, preview] of Object.entries(entry.previews ?? {})) {
        expect(channelsOf(feature), `${feature}:${apply}`).toContain(apply);
        expect(channelsOf(feature), `${feature}:${preview}`).toContain(preview);
      }
    }
  });

  it('every channel that writes game or tool files is paired with the channel that shows the change first', () => {
    // The audit table, as data. "save": the one file is named by the user in a Save dialog.
    const WRITERS: Record<string, string> = {
      'backup:restore': 'backup:previewRestore',
      'backup:restoreSnapshot': 'backup:restoreSnapshotPreview',
      'backup:exportBackup': 'save',
      'sharing:import': 'sharing:openImport',
      'sharing:export': 'save',
      'dcs-setup:applyScreens': 'dcs-setup:previewScreens',
      'dcs-setup:applyExport': 'dcs-setup:previewExport',
      'dcs-setup:restoreManaged': 'dcs-setup:restoreManagedPreview',
      'dcs-bindings:apply': 'dcs-bindings:plan',
      'dcs-bindings:migrationApply': 'dcs-bindings:migrationPlan',
      'dcs-bindings:snapshotRestore': 'dcs-bindings:snapshotRestorePlan',
      'stream-deck:restore': 'stream-deck:previewRestore',
      'stream-deck:exportBackup': 'save',
      'racing:restore': 'racing:restorePreview',
      'racing:beamngCopyOlder': 'racing:beamngCopyOlderPreview',
      'racing:beamngCopyToController': 'racing:beamngCopyToControllerPreview',
      'racing:iracingRepair': 'racing:iracingRepairPreview',
      'racing:lmuRepair': 'racing:lmuRepairPreview',
    };
    const all = new Set(
      contracts.flatMap((c) => Object.keys(c.channels).map((k) => `${c.feature}:${k}`))
    );
    for (const [write, preview] of Object.entries(WRITERS)) {
      expect(all, write).toContain(write);
      if (preview !== 'save') expect(all, `${write} -> ${preview}`).toContain(preview);
    }
  });
});

// ---------------------------------------------------------------- 4. preview = what happens

/** The preview's changed files and the journal of the apply are the same set of files. */
function expectSame(preview: ChangePreview, written: JournalEntry[], dataRoot: string): void {
  expect(ChangePreviewSchema.safeParse(preview).success).toBe(true);
  const said = preview.files
    .filter((f) => f.change !== 'unchanged')
    .map((f) => lower(f.path))
    .sort();
  const outside = written.filter((e) => !isWithin(dataRoot, e.path));
  const did = [...new Set(outside.map((e) => lower(e.path)))].sort();
  expect(did).toEqual(said);
  expect(said.length).toBeGreaterThan(0);
  // One user action: every file under one group, with a reason.
  expect(new Set(outside.map((e) => e.groupId)).size).toBe(1);
  for (const f of preview.files) {
    const entry = outside.find((e) => lower(e.path) === lower(f.path));
    if (f.change === 'deleted') expect(entry?.action).toBe('remove');
    if (f.change === 'created') expect(entry?.backupPath).toBeNull();
    if (f.change === 'modified') expect(entry?.backupPath).not.toBeNull();
  }
}

describe('a preview says exactly what is then written', () => {
  it('iRacing: pointing the files at a wheel base with a new Windows id', async () => {
    app = await wiredApp('racing-iracing-moved-wheel');
    const view = await app.invoke<{
      devices: { key: string; state: string; suggested?: string }[];
    }>('racing:iracing');
    const moved = view.devices.find((d) => d.state === 'moved')!;
    const mapping = [{ from: moved.key, to: moved.suggested! }];
    const before = await journal(app);
    const preview = await app.invoke<ChangePreview>('racing:iracingRepairPreview', { mapping });
    expect(await journal(app)).toEqual(before);
    expect(preview.files.map((f) => [f.label, f.change])).toEqual([
      ['controls.cfg', 'modified'],
      ['joyCalib.yaml', 'modified'],
    ]);
    expect(preview.summary).toBe('2 files modified');
    const target = app;
    const written = await during(target, () => target.invoke('racing:iracingRepair', { mapping }));
    expectSame(preview, written, target.ports.folders.dataRoot());
  });

  it('Le Mans Ultimate: putting the new name of a renamed wheel base into the bindings', async () => {
    app = await wiredApp('racing-lmu-renamed-wheel');
    const preview = await app.invoke<ChangePreview>('racing:lmuRepairPreview');
    expect(await journal(app)).toEqual([]);
    expect(preview.files.map((f) => [f.label, f.change])).toEqual([
      ['direct input.json', 'modified'],
    ]);
    const target = app;
    const written = await during(target, () => target.invoke('racing:lmuRepair'));
    expectSame(preview, written, target.ports.folders.dataRoot());
  });

  it("BeamNG.drive: giving a new controller another one's bindings", async () => {
    app = await wiredApp('racing-fresh');
    const inputmaps = path.join(
      app.ports.folders.localAppData(),
      'BeamNG',
      'BeamNG.drive',
      'current',
      'settings',
      'inputmaps'
    );
    // The wheel base was replaced: the old one's map is there, the DD2 has none yet.
    await fs.rm(path.join(inputmaps, '00070eb7.diff'));
    await fs.writeFile(
      path.join(inputmaps, '00010eb7.diff'),
      JSON.stringify({
        bindings: [{ action: 'shiftUp', control: 'button4' }],
        name: 'ClubSport Wheel Base V2',
        vidpid: '00010EB7',
        devicetype: 'joystick',
      })
    );
    const input = { file: '00010eb7.diff', to: '00070eb7' };
    const preview = await app.invoke<ChangePreview>('racing:beamngCopyToControllerPreview', input);
    expect(preview.files).toMatchObject([{ label: '00070eb7.diff', change: 'created' }]);
    expect(await journal(app)).toEqual([]);
    const target = app;
    const written = await during(target, () =>
      target.invoke('racing:beamngCopyToController', input)
    );
    expectSame(preview, written, target.ports.folders.dataRoot());
  });

  it('racing: restoring a quick backup of iRacing', async () => {
    app = await wiredApp('racing-fresh');
    const backup = await app.invoke<{ id: string }>('racing:backup', { game: 'iracing' });
    const ini = path.join(app.ports.folders.documents(), 'iRacing', 'app.ini');
    await fs.appendFile(ini, '\n; changed since\n');
    const input = { game: 'iracing', id: backup.id };
    const preview = await app.invoke<ChangePreview>('racing:restorePreview', input);
    expect(preview.files.filter((f) => f.change === 'modified')).toHaveLength(1);
    const target = app;
    const written = await during(target, () => target.invoke('racing:restore', input));
    // A restore writes every file of the backup; the preview marks the identical ones.
    const changed = written.filter((e) => e.hashBefore !== e.hashAfter);
    expectSame(preview, changed, target.ports.folders.dataRoot());
  });

  it('DCS: putting back the files RigReady manages after another tool rewrote them', async () => {
    app = await wiredApp('flying-fresh', {
      files: [
        'Saved Games/DCS/**',
        'Program Files (x86)/Steam/**',
        'AppData/Roaming/SimAppPro/**',
        'AppData/Local/Programs/SimAppPro/**',
      ],
    });
    const { setup } = await app.invoke<{ setup: unknown }>('dcs-setup:importSimAppPro', {
      desktopId: 'current',
    });
    await app.invoke('dcs-setup:applyScreens', { setup });
    await app.invoke('dcs-setup:applyExport', { kind: 'add', tool: 'dcs-bios' });
    const dcs = path.join(app.ports.folders.savedGames(), 'DCS');
    const options = path.join(dcs, 'Config', 'options.lua');
    await fs.writeFile(
      options,
      (await fs.readFile(options, 'utf8')).replace('"rigready"', '"wwtMonitor"')
    );
    await fs.writeFile(path.join(dcs, 'Scripts', 'Export.lua'), '-- rewritten by another tool\r\n');
    await fs.rm(path.join(dcs, 'Config', 'MonitorSetup', 'RigReady.lua'));

    const before = await journal(app);
    const preview = await app.invoke<ChangePreview>('dcs-setup:restoreManagedPreview');
    expect(await journal(app)).toEqual(before);
    expect(preview.files.map((f) => [f.label, f.change])).toEqual([
      ['RigReady.lua', 'created'],
      ['options.lua', 'modified'],
      ['Export.lua', 'modified'],
    ]);
    const target = app;
    const written = await during(target, () => target.invoke('dcs-setup:restoreManaged'));
    expectSame(preview, written, target.ports.folders.dataRoot());
    // Asked again, there is nothing left to do, and it says so.
    const again = await app.invoke<ChangePreview>('dcs-setup:restoreManagedPreview');
    expect(again).toEqual({ summary: 'Nothing to write', files: [] });
  });

  it('Stream Deck: restoring a backup over changed profiles', async () => {
    app = await wiredApp('stream-deck-owner', {
      files: ['AppData/Roaming/Elgato/**', 'Program Files/Elgato/**'],
    });
    const backup = await app.invoke<{ id: string }>('stream-deck:createBackup', {
      name: 'Known good',
    });
    const profiles = path.join(app.ports.folders.appData(), 'Elgato', 'StreamDeck', 'ProfilesV3');
    const [first] = (await fs.readdir(profiles)).filter((n) => n.endsWith('.sdProfile'));
    const manifest = path.join(profiles, first!, 'manifest.json');
    await fs.writeFile(
      manifest,
      (await fs.readFile(manifest, 'utf8')).replace(/"Name"/, '"Name" ')
    );
    await fs.writeFile(path.join(profiles, first!, 'stray.json'), '{}');

    const preview = await app.invoke<{ method: string; changes?: ChangePreview }>(
      'stream-deck:previewRestore',
      { id: backup.id }
    );
    expect(preview.method).toBe('files');
    const changes = preview.changes!;
    expect(changes.files.filter((f) => f.change !== 'unchanged').map((f) => f.change)).toEqual([
      'modified',
      'deleted',
    ]);
    expect(changes.files.find((f) => f.change === 'deleted')!.label).toBe(`${first}/stray.json`);
    const target = app;
    const written = await during(target, () =>
      target.invoke('stream-deck:restore', { id: backup.id, closeApp: true })
    );
    const changed = written.filter((e) => e.action === 'remove' || e.hashBefore !== e.hashAfter);
    expectSame(changes, changed, target.ports.folders.dataRoot());
  });

  it('Backups: putting a snapshot back', async () => {
    app = await wiredApp('flying-all-good', { files: ['Saved Games/DCS/**'] });
    const overview = await app.invoke<{ scopes: { items: { item: { id: string } }[] }[] }>(
      'backup:saveItem',
      {
        scope: '@always',
        item: { label: 'Scripts', path: '{DCS_USER}/Scripts', kind: 'folder' },
      }
    );
    const itemId = overview.scopes[0]!.items[0]!.item.id;
    const snapshot = await app.invoke<{ id: string }>('backup:takeSnapshot', {
      scope: '@always',
      itemId,
      name: 'Before',
    });
    const scripts = path.join(app.ports.folders.savedGames(), 'DCS', 'Scripts');
    await fs.appendFile(path.join(scripts, 'Export.lua'), '\n-- added by a tool\n');
    await fs.rm(path.join(scripts, 'DCS-BIOS', 'BIOS.lua'));
    await fs.writeFile(path.join(scripts, 'Hooks.lua'), 'x');

    const input = { id: snapshot.id };
    const preview = await app.invoke<ChangePreview>('backup:restoreSnapshotPreview', input);
    expect(preview.files.map((f) => [f.label, f.change]).sort()).toEqual([
      ['DCS-BIOS/BIOS.lua', 'created'],
      ['Export.lua', 'modified'],
    ]);
    expect(await journal(app)).toEqual([]);
    const target = app;
    const written = await during(target, () => target.invoke('backup:restoreSnapshot', input));
    expectSame(preview, written, target.ports.folders.dataRoot());
  });
});

// ---------------------------------------------------------------- fixes that Make ready runs

async function saveSetup(target: WiredApp, id: string, checks: Omit<CheckItem, 'id'>[]) {
  const saved = await target.wiring.context.profiles.save({
    schemaVersion: 1,
    id,
    name: id,
    game: 'dcs',
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:00:00.000Z',
    checks: checks.map((c, i) => ({ ...c, id: `c${i + 1}` })),
    extensions: {},
  });
  if (!saved.ok) throw new Error(saved.error.message);
}

/**
 * Make ready is one click, so the description is the fix text beside the failing check.
 * Every file a fix writes must be named there before, and in the summary after.
 */
async function expectFixesNameTheirFiles(target: WiredApp, profileId: string): Promise<string[]> {
  const before = await target.invoke<ChecklistReport>('fly:check', { profileId });
  const offered = before.results.filter((r) => r.status !== 'pass' && r.fix).map((r) => r.fix!);
  let made!: ActionReport;
  const written = await during(target, async () => {
    made = await target.invoke<ActionReport>('fly:makeReady', { profileId });
  });
  const outside = written.filter((e) => !isWithin(target.ports.folders.dataRoot(), e.path));
  expect(outside.length).toBeGreaterThan(0);
  const names = [...new Set(outside.map((e) => path.basename(e.path)))];
  for (const name of names) {
    expect(
      offered.some((fix) => fix.includes(name)),
      `no fix said it would write ${name}; offered: ${offered.join(' | ')}`
    ).toBe(true);
    expect(
      made.steps.some((step) => step.ok && step.message.includes(name)),
      `the Make ready summary does not name ${name}: ${made.steps.map((s) => s.message).join(' | ')}`
    ).toBe(true);
  }
  for (const entry of outside) expect(JournalEntrySchema.safeParse(entry).success).toBe(true);
  return names.sort();
}

describe('fixes Make ready runs name the files they write, before and after', () => {
  const FILES = [
    'Saved Games/DCS/**',
    'Program Files (x86)/Steam/**',
    'AppData/Roaming/SimAppPro/**',
    'AppData/Local/Programs/SimAppPro/**',
  ];

  it('DCS: the screen setup, the managed files and Export.lua', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const { setup } = await app.invoke<{ setup: unknown }>('dcs-setup:importSimAppPro', {
      desktopId: 'current',
    });
    await app.invoke('dcs-setup:applyScreens', { setup });
    await app.invoke('dcs-setup:applyExport', { kind: 'add', tool: 'dcs-bios' });
    await saveSetup(app, 'p', [
      {
        type: 'dcs.managedFiles',
        title: 'DCS files',
        required: false,
        params: {},
        remediation: { type: 'dcs.restoreManaged', params: {} },
      },
      {
        type: 'dcs.monitorSetup',
        title: 'Screens',
        required: false,
        params: { setup: 'rigready' },
        remediation: { type: 'dcs.writeScreenSetup', params: {} },
      },
    ]);
    const dcs = path.join(app.ports.folders.savedGames(), 'DCS');
    const options = path.join(dcs, 'Config', 'options.lua');
    await fs.writeFile(
      options,
      (await fs.readFile(options, 'utf8')).replace('"rigready"', '"wwtMonitor"')
    );
    await fs.writeFile(path.join(dcs, 'Scripts', 'Export.lua'), '-- rewritten\r\n');
    expect(await expectFixesNameTheirFiles(app, 'p')).toEqual(['Export.lua', 'options.lua']);
  });

  it('DCS: Export.lua lines and graphics options', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    await saveSetup(app, 'p', [
      {
        type: 'dcs.exportLua',
        title: 'Export',
        required: true,
        params: { tools: ['wwt', 'dcs-bios'] },
        remediation: { type: 'dcs.repairExportLua', params: { tools: ['wwt', 'dcs-bios'] } },
      },
      {
        type: 'dcs.options',
        title: 'Options',
        required: true,
        params: { width: 5120, height: 1440 },
        remediation: { type: 'dcs.setOptions', params: { width: 5120, height: 1440 } },
      },
    ]);
    const dcs = path.join(app.ports.folders.savedGames(), 'DCS');
    await fs.writeFile(path.join(dcs, 'Scripts', 'Export.lua'), '-- emptied\r\n');
    expect(await expectFixesNameTheirFiles(app, 'p')).toEqual(['Export.lua', 'options.lua']);
  });

  it('any game: restoring a config file from the copy that was kept', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const stored = '{DCS_USER}/Config/autoexec.cfg';
    const file = path.join(app.ports.folders.savedGames(), 'DCS', 'Config', 'autoexec.cfg');
    await fs.writeFile(file, 'options.graphics.maxfps = 120\n');
    await app.invoke('profiles:prepareFix', { type: 'file.restore', params: { path: stored } });
    await fs.rm(file);
    await saveSetup(app, 'p', [
      {
        type: 'file.exists',
        title: 'autoexec.cfg',
        required: true,
        params: { path: stored },
        remediation: { type: 'file.restore', params: { path: stored } },
      },
    ]);
    expect(await expectFixesNameTheirFiles(app, 'p')).toEqual(['autoexec.cfg']);
    expect(await fs.readFile(file, 'utf8')).toBe('options.graphics.maxfps = 120\n');
  });
});
