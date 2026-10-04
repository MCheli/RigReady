import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { Locator, Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/** Backups of the racing games and helper tools, and a restore that waits for a running game. */

const suggestion = (page: Page, label: string): Locator =>
  page.locator(`[data-testid="suggestion"][data-label="${label}"]`);

test('backup: racing games and tools are suggested, backed up together, and a restore closes the running game first', async ({
  rig,
}) => {
  const run = await rig.launch('backup-racing', 'backup-sources');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-backups').click();
  await page.getByTestId('backups-tab-tracked').click();

  // One group per game or tool, the whole-folder item first.
  for (const source of [
    'iRacing',
    'Le Mans Ultimate',
    'BeamNG.drive',
    'Stream Deck',
    'TrackIR',
    'Fanatec',
  ]) {
    await expect(
      page.locator(`[data-testid="suggestion-group"][data-source="${source}"]`)
    ).toBeVisible();
  }
  await expect(suggestion(page, 'Le Mans Ultimate settings and bindings')).toContainText(
    'Logs are left out'
  );
  await expect(suggestion(page, 'Stream Deck plugin list')).toContainText('{APPDATA}/Elgato');
  await shot('suggested');

  for (const label of [
    'iRacing settings and bindings',
    'Le Mans Ultimate settings and bindings',
    'BeamNG.drive settings and bindings',
    'Stream Deck profiles',
    'Stream Deck plugin list',
    'TrackIR settings and profiles',
    'Fanatec App settings',
  ]) {
    await suggestion(page, label).getByTestId('suggestion-add').click();
    await expect(suggestion(page, label).getByTestId('suggestion-added')).toBeVisible();
  }
  await expect(
    page.locator('[data-testid="tracked-item"][data-label="TrackIR settings and profiles"]')
  ).toContainText('3 files');
  await shot('tracked');

  // Stream Deck and the Fanatec service are running: a backup only reads.
  await page.getByTestId('backups-tab-backups').click();
  await expect(page.getByTestId('backup-summary')).toContainText('7 tracked items');
  await page.getByTestId('backup-all').click();
  await expect(page.getByTestId('backup-outcome-title')).toContainText('Backed up');
  await page.getByTestId('backup-toggle').click();
  await expect(page.getByTestId('backup-contents')).toContainText('iRacing settings and bindings');
  await expect(page.getByTestId('backup-record')).toContainText(
    'Fanatec driver settings (registry)'
  );
  await expect(page.getByTestId('backup-record')).toContainText('kept as a record, not restored');
  await shot('backed-up');

  const dir = path.join(run.dataRoot, 'backups');
  const [name] = (await fs.readdir(dir)).filter((f) => f.endsWith('.zip'));
  const entries = Object.keys(unzipSync(new Uint8Array(await fs.readFile(path.join(dir, name!)))));
  for (const file of [
    'controls.cfg',
    'joyCalib.yaml',
    'player/direct input.json',
    'ProfileMap.dat',
    'Profiles/driving.xml',
    'shared_preferences.json',
  ]) {
    expect(entries.some((e) => e.endsWith(`/${file}`))).toBe(true);
  }
  expect(entries).toContain('records/fanatec-service.json');
  expect(entries.some((e) => e.toLowerCase().includes('/log/'))).toBe(false);

  // A new wheel later: the bindings changed, and the simulator is open.
  const controls = path.join(run.home, 'Documents', 'iRacing', 'controls.cfg');
  const original = await fs.readFile(controls);
  await fs.writeFile(controls, 'bindings after the new wheel');
  await run.mutate([
    { op: 'startProcess', name: 'iRacingSim64DX11.exe', path: 'C:\\iRacing\\iRacingSim64DX11.exe' },
  ]);
  await page.getByTestId('backup-restore').click();
  await expect(page.getByTestId('restore-page')).toBeVisible();
  const running = page.getByTestId('restore-running');
  await expect(running).toContainText('iRacing is running (iRacingSim64DX11.exe)');
  await expect(running).toContainText(
    'iRacing writes these files when the simulator exits, which would undo the restore.'
  );
  await expect(page.getByTestId('restore-running-program')).toHaveCount(1);
  await expect(page.getByTestId('restore-apply')).toBeDisabled();
  await shot('restore-waits-for-iracing');
  await expect(page.getByTestId('restore-record')).toContainText('Not restored');
  await page.getByTestId('restore-record-toggle').click();
  // A table a person can read: a heading per registry key, a label and a value per row.
  const values = page.getByTestId('restore-record-values');
  await expect(values).toBeVisible();
  await expect(page.getByTestId('restore-record-group').first()).toHaveText('Games › 0_0');
  const row = page.getByTestId('restore-record-row').filter({ hasText: 'IsSteamInstalled' });
  await expect(row.first()).toContainText('Steam edition installed');
  await expect(row.first()).toContainText('On');
  await expect(values).not.toContainText('"type"');
  await expect(page.getByTestId('restore-record-text')).toHaveCount(0);
  await page.getByTestId('restore-record').scrollIntoViewIfNeeded();
  await shot('registry-record');
  // The stored data as it is, behind a switch.
  await page.getByTestId('restore-record-raw').click();
  await expect(page.getByTestId('restore-record-text')).toContainText('"Games"');
  await page.getByTestId('restore-record-raw').click();
  await expect(values).toBeVisible();
  await page.getByTestId('restore-record-toggle').click();

  await page.getByTestId('restore-close-programs').locator('input').check();
  await page.getByTestId('restore-apply').click();
  await expect(page.getByTestId('restore-report-title')).toContainText('Restored 1 item');
  await expect(page.getByTestId('restore-closed')).toContainText(
    'iRacing was closed for the restore. Start it again when you are ready.'
  );
  expect(await fs.readFile(controls)).toEqual(original);
  await shot('restored');
});

test('backup: after a game update, Back up now saves the files of the game before the version is marked verified', async ({
  rig,
}) => {
  const run = await rig.launch('backup-game-updated', 'backup-game-updated');
  const { page, shot } = run;
  // A warning only: the rig is still ready.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
  const game = checkRow(page, 'DCS not updated since verified');
  await expect(game).toHaveAttribute('data-status', 'warn');
  await expect(game).toContainText(
    'DCS World updated Steam build 25000000 -> Steam build 25625823 since you last verified'
  );
  await expect(game.getByTestId('check-fix')).toHaveText(
    'Back up DCS World settings and bindings now'
  );
  await expect(game.getByTestId('check-acknowledge')).toHaveText('Mark verified');
  await shot('updated-warning');

  await game.getByTestId('check-fix').click();
  await expect(game.getByTestId('fix-result')).toContainText('Backed up 27 files');
  await expect(game.getByTestId('fix-result')).toContainText('DCS World files');
  // Still a warning: the backup does not verify the new version.
  await expect(game).toHaveAttribute('data-status', 'warn');
  await shot('backed-up');
  const zips = (await fs.readdir(path.join(run.dataRoot, 'backups'))).filter((f) =>
    f.endsWith('.zip')
  );
  expect(zips).toHaveLength(1);
  expect(zips[0]).toMatch(/DCS World files\.zip$/);
  const entries = Object.keys(
    unzipSync(new Uint8Array(await fs.readFile(path.join(run.dataRoot, 'backups', zips[0]!))))
  );
  expect(entries.filter((e) => e.includes('Config/Input/')).length).toBe(18);

  await game.getByTestId('check-acknowledge').click();
  // The group passes now and folds; open it to see the row.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('group-toggle-other').click();
  await expect(game).toHaveAttribute('data-status', 'pass');

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-backups').click();
  await expect(page.getByTestId('backup-row')).toHaveCount(1);
  await expect(page.getByTestId('backup-sub')).toContainText('DCS World files');
  await shot('on-the-backups-page');
});

test('backup: a racing restore and a BeamNG copy show what each file becomes before anything is written, and every change is an action on the Safety page', async ({
  rig,
}) => {
  const run = await rig.launch('racing-fresh', 'backup-write-preview', {
    dialogs: { save: ['Documents/USB stick/rig.zip'] },
  });
  const { page, shot, home } = run;
  const iracing = path.join(home, 'Documents', 'iRacing');
  const local = path.join(home, 'AppData', 'Local');
  const older = path.join(local, 'BeamNG.drive', '0.31', 'settings', 'inputmaps');
  await fs.mkdir(older, { recursive: true });
  await fs.writeFile(path.join(older, '00060eb7.diff'), JSON.stringify({ bindings: [] }));

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-racing').click();
  await page.locator('[data-testid="racing-game-card"][data-game="iracing"]').click();
  await page.getByTestId('backup-now').click();
  await expect(page.getByTestId('backup-message')).toHaveText('Backed up 3 files.');

  // The game rewrote one file and another is gone: the confirmation says so per file.
  const ini = await fs.readFile(path.join(iracing, 'app.ini'), 'utf8');
  await fs.writeFile(path.join(iracing, 'app.ini'), `${ini}addedLater=1\n`);
  await fs.rm(path.join(iracing, 'joyCalib.yaml'));
  await page.getByTestId('backup-restore').click();
  const confirm = page.getByTestId('restore-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm.getByTestId('restore-preview-summary')).toHaveText(
    '1 file modified, 1 file created, 1 file unchanged'
  );
  const files = confirm.getByTestId('restore-preview-file');
  await expect(files).toHaveCount(3);
  await expect(files.nth(0)).toHaveAttribute('data-change', 'unchanged');
  await expect(files.nth(1)).toHaveAttribute('data-change', 'created');
  await expect(files.nth(2)).toHaveAttribute('data-change', 'modified');
  await expect(files.nth(2)).toContainText('1 line removed');
  // Looking wrote nothing.
  expect(await fs.readFile(path.join(iracing, 'app.ini'), 'utf8')).toContain('addedLater=1');
  await shot('restore-preview');
  await confirm.getByTestId('restore-go').click();
  await expect(page.getByTestId('backup-message')).toContainText('Restored 3 files');
  expect(await fs.readFile(path.join(iracing, 'app.ini'), 'utf8')).toBe(ini);

  await page.getByTestId('nav-racing').click();
  await page.locator('[data-testid="racing-game-card"][data-game="beamng"]').click();
  await page.getByTestId('beamng-copy-older').click();
  const copy = page.getByTestId('beamng-copy-confirm');
  await expect(copy).toBeVisible();
  await expect(copy.getByTestId('beamng-copy-preview')).toContainText('1 file created');
  await expect(copy.getByTestId('beamng-copy-preview-file')).toContainText('00060eb7.diff');
  await shot('copy-preview');
  await copy.getByTestId('beamng-copy-go').click();
  await expect(page.getByTestId('beamng-message')).toContainText('Copied 1 binding file');

  // A single file written on its own (a backup exported to a USB stick) is an action too.
  await page.getByTestId('nav-backups').click();
  await page.getByTestId('backups-tab-tracked').click();
  const fanatec = suggestion(page, 'Fanatec App settings');
  await fanatec.getByTestId('suggestion-add').click();
  // The row says so once it is tracked. The other tab reads what is tracked when it opens:
  // opened before that, on a slow machine, it found nothing to back up.
  await expect(fanatec.getByTestId('suggestion-added')).toBeVisible();
  await page.getByTestId('backups-tab-backups').click();
  await page.getByTestId('backup-all').click();
  await expect(page.getByTestId('backup-outcome-title')).toContainText('Backed up');
  await page.getByTestId('backup-menu').click();
  await page.getByTestId('backup-export').click();
  await expect(page.getByTestId('backup-message')).toContainText('Exported to');

  await page.getByTestId('nav-safety').click();
  const groups = page.getByTestId('change-group');
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0)).toContainText('Export backup');
  await expect(groups.nth(1)).toContainText('Copy BeamNG.drive 0.31 bindings');
  await expect(groups.nth(2)).toContainText('Restore iRacing bindings');
  await shot('every-change-is-an-action');
});

test('restore: bindings for a controller this PC does not have come with a button to Bindings, Device IDs', async ({
  rig,
}) => {
  const run = await rig.launch('backup-dcs', 'backup-restore-device-ids');
  const { page, shot, home } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-backups').click();
  await page.getByTestId('backups-tab-tracked').click();
  await suggestion(page, 'DCS bindings').getByTestId('suggestion-add').click();
  await expect(suggestion(page, 'DCS bindings').getByTestId('suggestion-added')).toBeVisible();
  await page.getByTestId('backups-tab-backups').click();
  await page.getByTestId('backup-all').click();
  await expect(page.getByTestId('backup-outcome-title')).toContainText('Backed up');

  // The bindings are lost and the pedals are no longer on this PC.
  await fs.rm(path.join(home, 'Saved Games', 'DCS', 'Config', 'Input'), { recursive: true });
  await run.mutate([{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await page.getByTestId('backup-restore').click();
  await expect(page.getByTestId('restore-page')).toBeVisible();
  await page.getByTestId('restore-apply').click();
  await expect(page.getByTestId('restore-report-title')).toContainText('Restored');
  const notice = page.getByTestId('restore-device-ids');
  await expect(notice).toContainText('device IDs this PC does not use');
  await expect(notice).toContainText('T-Pendular-Rudder');
  await shot('notice-with-button');
  await page.getByTestId('restore-open-device-ids').click();
  await expect(page).toHaveURL(/dcs-bindings\/device-ids/);
  await expect(page.getByTestId('bind-device-ids')).toContainText('T-Pendular-Rudder');
  await shot('device-ids');
});
