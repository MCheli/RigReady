import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ActionReport,
  CheckResult,
  ChecklistReport,
  StepResult,
} from '../../../core/checks/engine';
import type { CaptureCandidate } from '../../../core/checks/registry';
import { readZip } from '../../../core/files/zip';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { BackupView, Overview } from '../contract';

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

const PROFILE = 'backup-game-updated';

async function zipNames(a: WiredApp, backup: BackupView): Promise<string[]> {
  const bytes = await fs.readFile(path.join(a.ports.folders.dataRoot(), 'backups', backup.id));
  const entries = readZip(new Uint8Array(bytes));
  if (!entries.ok) throw new Error(entries.error.message);
  return entries.value.map((e) => e.path);
}

describe('"Back up now" on the game-updated warning', () => {
  it('warns that DCS was updated, offers the backup and Mark verified, and never makes the rig Not ready', async () => {
    app = await wiredApp('backup-game-updated');
    const report = await app.invoke<ChecklistReport>('fly:check', { profileId: PROFILE });
    expect(report.ready).toBe(true);
    const item = report.results.find((r) => r.itemId === 'g1')!;
    expect(item).toMatchObject({
      status: 'warn',
      required: false,
      summary:
        'DCS World updated Steam build 25000000 -> Steam build 25625823 since you last verified',
      fix: 'Back up DCS World settings and bindings now',
      fixKind: 'navigate',
      acknowledge: 'Mark verified',
    });
  });

  it('makes one backup of everything the game keeps, without the user tracking anything first', async () => {
    app = await wiredApp('backup-game-updated');
    const fixed = await app.invoke<{ step: StepResult; result: CheckResult }>('fly:fix', {
      profileId: PROFILE,
      itemId: 'g1',
    });
    expect(fixed.step.ok).toBe(true);
    expect(fixed.step.message).toMatch(
      /^Backed up 27 files \(\d+ KB\) as "\d{4}-\d\d-\d\d \d\d-\d\d DCS World files"\. It is on the Backups page\.$/
    );
    // The warning stays until the user has looked and marks the version verified.
    expect(fixed.result.status).toBe('warn');

    const overview = await app.invoke<Overview>('backup:overview');
    expect(overview.backups).toHaveLength(1);
    const backup = overview.backups[0]!;
    expect(backup).toMatchObject({ scopeKind: 'custom', scopeLabel: 'DCS World files' });
    expect(backup.fileCount).toBe(27);
    const names = await zipNames(app, backup);
    expect(names.some((n) => n.endsWith('Config/options.lua'))).toBe(true);
    expect(names.filter((n) => n.includes('Config/Input/')).length).toBe(18);
    expect(names.some((n) => n.endsWith('Scripts/Export.lua'))).toBe(true);
    expect(names.some((n) => n.includes('/Logs/'))).toBe(false);
    // The whole-folder suggestion already holds every file: none is stored twice.
    expect(names.filter((n) => n.endsWith('options.lua'))).toHaveLength(1);
    // Nothing was added to the lists of tracked files.
    expect(overview.scopes.flatMap((s) => s.items)).toEqual([]);

    const verified = await app.invoke<CheckResult>('fly:acknowledge', {
      profileId: PROFILE,
      itemId: 'g1',
    });
    expect(verified).toMatchObject({ status: 'pass' });
  });

  it('includes what the user tracks for the game, and is left to the user by Make ready', async () => {
    app = await wiredApp('backup-game-updated');
    const missions = path.join(app.ports.folders.documents(), 'Squadron missions');
    await fs.mkdir(missions, { recursive: true });
    await fs.writeFile(path.join(missions, 'red-flag.miz'), 'mission');
    await app.invoke('backup:saveItem', {
      scope: '@always',
      item: {
        label: 'Squadron missions',
        path: '{DOCUMENTS}/Squadron missions',
        kind: 'folder',
        game: 'dcs',
      },
    });
    const ready = await app.invoke<ActionReport>('fly:makeReady', {
      profileId: PROFILE,
      approved: [],
    });
    // Make ready does not make a backup on every run: the item is the user's to press.
    expect(ready.steps).toEqual([]);
    expect(ready.needsYou).toEqual([
      expect.objectContaining({
        itemId: 'g1',
        open: 'Back up DCS World settings and bindings now',
      }),
    ]);
    expect((await app.invoke<Overview>('backup:overview')).backups).toEqual([]);

    await app.invoke('fly:fix', { profileId: PROFILE, itemId: 'g1' });
    const backup = (await app.invoke<Overview>('backup:overview')).backups[0]!;
    expect(backup.fileCount).toBe(28);
    expect((await zipNames(app, backup)).some((n) => n.endsWith('/red-flag.miz'))).toBe(true);
  });

  it('says so when there is nothing to back up or the game is unknown', async () => {
    app = await wiredApp('backup-game-updated', { files: ['Program Files (x86)/Steam/**'] });
    const fixed = await app.invoke<{ step: StepResult }>('fly:fix', {
      profileId: PROFILE,
      itemId: 'g1',
    });
    expect(fixed.step.ok).toBe(false);
    expect(fixed.step.message).toContain(
      'Nothing to back up: no settings files of DCS World were found on this PC.'
    );
    const definition = app.wiring.context.checks.remediation('backup.gameFiles')!;
    expect(await definition.available!({ game: 'falcon-bms' }, app.ctx)).toEqual({
      ok: false,
      reason: 'This version of RigReady does not know "falcon-bms".',
    });
    expect(definition.describe({ game: 'falcon-bms' })).toBe(
      'Back up falcon-bms settings and bindings now'
    );
  });

  it('capture proposes the game-updated check with the backup as its fix', async () => {
    app = await wiredApp('backup-game-updated', { files: ['Program Files (x86)/Steam/**'] });
    const capture = app.wiring.context.checks.allCaptures().find((c) => c.id === 'game-updated')!;
    const found = await capture.capture(app.ctx);
    const dcs = (found.ok ? found.value : []).find((c: CaptureCandidate) => c.key === 'game:dcs')!;
    expect(dcs.check).toMatchObject({
      type: 'game.updated',
      required: false,
      remediation: { type: 'backup.gameFiles', params: { game: 'dcs' } },
    });
    expect(app.wiring.context.checks.check('game.updated')!.fixes![0]).toBe('backup.gameFiles');
  });
});
