import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * BACKUP-011: before RigReady writes a game's or a tool's files, the confirmation lists which
 * files change and how. These are the flows that got the shared list (ChangePreview.vue); the
 * ones that already had a preview of their own are covered by their feature's spec.
 */

async function invoke(page: Page, channel: string, input?: unknown): Promise<unknown> {
  const result = (await page.evaluate(
    ([c, i]) =>
      (
        globalThis as unknown as {
          rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
        }
      ).rigready.invoke(c as string, i),
    [channel, input] as const
  )) as { ok: boolean; value?: unknown; error?: { message: string } };
  if (!result.ok) throw new Error(`${channel}: ${result.error?.message}`);
  return result.value;
}

const changed = (page: Page, scope: string) =>
  page.getByTestId(scope).locator('[data-testid="change-preview-file"]');

test('change preview: the iRacing id repair lists the files it rewrites before it does', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch(
    'racing-iracing-moved-wheel',
    'backup-change-preview-iracing'
  );
  const controls = path.join(home, 'Documents', 'iRacing', 'controls.cfg');
  const before = await fs.readFile(controls);
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-racing').click();
  await page.locator('[data-testid="racing-game-card"][data-game="iracing"]').click();
  await page.getByTestId('iracing-repair').click();

  const confirm = page.getByTestId('iracing-repair-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm.getByTestId('change-preview-summary')).toHaveText('2 files modified');
  const files = changed(page, 'iracing-repair-confirm');
  await expect(files).toHaveCount(2);
  await expect(files.nth(0)).toHaveAttribute('data-change', 'modified');
  await expect(files.nth(0)).toContainText('controls.cfg');
  await expect(files.nth(0)).toContainText('Changed');
  await expect(files.nth(0)).toContainText('Different content, same size');
  await expect(files.nth(1)).toContainText('joyCalib.yaml');
  await expect(files.nth(1)).toContainText('1 line added, 1 removed');
  // Looking is not writing.
  expect((await fs.readFile(controls)).equals(before)).toBe(true);
  await shot('iracing-repair');

  await page.getByTestId('iracing-repair-cancel').click();
  await expect(confirm).toBeHidden();
  expect((await fs.readFile(controls)).equals(before)).toBe(true);

  await page.getByTestId('iracing-repair').click();
  await expect(confirm.getByTestId('change-preview-summary')).toBeVisible();
  await page.getByTestId('iracing-repair-go').click();
  await expect(page.getByTestId('iracing-message')).toContainText('Updated 17 bindings');
  expect((await fs.readFile(controls)).equals(before)).toBe(false);
});

test('change preview: copying BeamNG bindings to a new controller names the file it creates', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch('racing-fresh', 'backup-change-preview-beamng');
  const inputmaps = path.join(
    home,
    'AppData',
    'Local',
    'BeamNG',
    'BeamNG.drive',
    'current',
    'settings',
    'inputmaps'
  );
  await fs.rm(path.join(inputmaps, '00070eb7.diff'));
  await fs.writeFile(
    path.join(inputmaps, '00010eb7.diff'),
    JSON.stringify({
      bindings: [
        { action: 'steering', control: 'xaxis', angle: 900, isForceEnabled: true },
        { action: 'shiftUp', control: 'button4' },
      ],
      name: 'ClubSport Wheel Base V2',
      vidpid: '00010EB7',
      devicetype: 'joystick',
    })
  );
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-racing').click();
  await page.locator('[data-testid="racing-game-card"][data-game="beamng"]').click();
  const old = page.locator('[data-testid="beamng-map"][data-file="00010eb7.diff"]');
  await old.getByTestId('beamng-copy-target').click();
  await page.getByRole('option', { name: 'FANATEC Podium Wheel Base DD2' }).click();
  await old.getByTestId('beamng-copy').click();

  const confirm = page.getByTestId('beamng-copy-controller-confirm');
  await expect(confirm.getByTestId('change-preview-summary')).toHaveText('1 file created');
  const files = changed(page, 'beamng-copy-controller-confirm');
  await expect(files).toHaveCount(1);
  await expect(files).toHaveAttribute('data-change', 'created');
  await expect(files).toContainText('00070eb7.diff');
  await expect(files).toContainText('New');
  await shot('beamng-copy');
  await page.getByTestId('beamng-copy-controller-go').click();
  await expect(page.getByTestId('beamng-message')).toContainText('now has the bindings');
  await expect(fs.stat(path.join(inputmaps, '00070eb7.diff'))).resolves.toBeTruthy();
});

test("change preview: restoring RigReady's DCS files shows what is put back, and the Safety page lists it", async ({
  rig,
}) => {
  const run = await rig.launch('dcs-setup-flying', 'backup-change-preview-dcs');
  const { page, shot, home } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-dcs').click();
  await page.getByTestId('dcs-tab-screens').click();
  await expect(page.getByTestId('screen-map-box')).toHaveCount(3);
  await page.getByTestId('screens-apply').click();
  await expect(page.getByTestId('screens-done')).toContainText(
    'DCS will use the RigReady screen setup'
  );
  // Another tool selects its own monitor setup again and the screen setup file is deleted.
  const options = path.join(home, 'Saved Games', 'DCS', 'Config', 'options.lua');
  const good = await fs.readFile(options, 'utf8');
  await run.mutate([
    {
      op: 'writeFile',
      path: 'Saved Games/DCS/Config/options.lua',
      content: good.replace('"rigready"', '"wwtMonitor"'),
    },
    { op: 'removeFile', path: 'Saved Games/DCS/Config/MonitorSetup/RigReady.lua' },
  ]);

  await page.getByTestId('dcs-tab-simapppro').click();
  await expect(
    page.locator('[data-testid="sap-managed-file"][data-status="changed"]')
  ).toContainText('Monitor setup is "wwtMonitor"');
  await page.getByTestId('sap-restore').click();
  const confirm = page.getByTestId('sap-restore-confirm');
  await expect(confirm.getByTestId('change-preview-summary')).toHaveText(
    '1 file modified, 1 file created'
  );
  const files = changed(page, 'sap-restore-confirm');
  await expect(files).toHaveCount(2);
  await expect(files.nth(0)).toHaveAttribute('data-change', 'created');
  await expect(files.nth(0)).toContainText('RigReady.lua');
  await expect(files.nth(1)).toHaveAttribute('data-change', 'modified');
  await expect(files.nth(1)).toContainText('options.lua');
  await expect(files.nth(1)).toContainText('1 line added, 1 removed');
  expect(await fs.readFile(options, 'utf8')).not.toBe(good);
  await shot('dcs-restore');

  await page.getByTestId('sap-restore-go').click();
  await expect(confirm).toBeHidden();
  await expect(page.locator('[data-testid="sap-managed-file"][data-status="changed"]')).toHaveCount(
    0
  );
  expect(await fs.readFile(options, 'utf8')).toBe(good);

  await page.getByTestId('nav-safety').click();
  await expect(page.getByTestId('safety-page')).toContainText(
    'Restore the DCS files RigReady manages'
  );
  await shot('dcs-restore-on-safety-page');
});

test('change preview: a Stream Deck restore and a snapshot put-back list their files', async ({
  rig,
}) => {
  const run = await rig.launch('stream-deck-owner', 'backup-change-preview-restores');
  const { page, shot, home } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-stream-deck').click();
  await page.getByTestId('sd-tab-backups').click();
  await page.getByTestId('sd-backup').click();
  await page.getByTestId('sd-backup-name-input').locator('input').fill('Known good');
  await page.getByTestId('sd-backup-confirm').click();
  await expect(page.getByTestId('sd-backup-row')).toHaveCount(1);

  const profile = path.join(
    home,
    'AppData',
    'Roaming',
    'Elgato',
    'StreamDeck',
    'ProfilesV3',
    '042F7366-9A23-444F-9AE6-327A9DB7979F.sdProfile'
  );
  const manifest = path.join(profile, 'manifest.json');
  const good = await fs.readFile(manifest, 'utf8');
  await fs.writeFile(manifest, good.replace('"DCS World"', '"DCS World (broken)"'));
  await fs.writeFile(path.join(profile, 'left-over.json'), '{}');

  await page.getByTestId('sd-restore').click();
  const dialog = page.getByTestId('sd-restore-dialog');
  await expect(dialog).toBeVisible();
  const files = changed(page, 'sd-restore-files');
  await expect(files).toHaveCount(2);
  await expect(files.nth(0)).toHaveAttribute('data-change', 'modified');
  await expect(files.nth(0)).toContainText('manifest.json');
  await expect(files.nth(1)).toHaveAttribute('data-change', 'deleted');
  await expect(files.nth(1)).toContainText('left-over.json');
  await expect(files.nth(1)).toContainText('Deleted');
  await shot('stream-deck-restore');
  await page.getByTestId('sd-restore-cancel').click();
  expect(await fs.readFile(manifest, 'utf8')).not.toBe(good);

  // A snapshot of a tracked folder, changed since, put back.
  await invoke(page, 'backup:saveItem', {
    scope: '@always',
    item: { label: 'DCS export scripts', path: '{DCS_USER}/Scripts', kind: 'folder' },
  });
  await page.getByTestId('nav-backups').click();
  await page.getByTestId('backups-tab-snapshots').click();
  await page.getByTestId('snapshot-item').click();
  await page.getByRole('option', { name: /DCS export scripts/ }).click();
  await page.getByTestId('snapshot-name').locator('input').fill('Before the update');
  await page.getByTestId('snapshot-take').click();
  await expect(page.getByTestId('snapshot-row')).toHaveCount(1);
  const scripts = path.join(home, 'Saved Games', 'DCS', 'Scripts');
  const exportLua = await fs.readFile(path.join(scripts, 'Export.lua'), 'utf8');
  await fs.writeFile(path.join(scripts, 'Export.lua'), `${exportLua}-- added by an installer\n`);
  await fs.rm(path.join(scripts, 'DCS-BIOS', 'BIOS.lua'));

  await page.getByTestId('snapshot-menu').click();
  await page.getByTestId('snapshot-restore').click();
  const putBack = page.getByTestId('snapshot-restore-dialog');
  await expect(putBack.getByTestId('change-preview-summary')).toHaveText(
    '1 file modified, 1 file created'
  );
  await expect(changed(page, 'snapshot-restore-dialog')).toHaveCount(2);
  await expect(putBack).toContainText('DCS-BIOS/BIOS.lua');
  await expect(putBack).toContainText('1 line removed');
  await shot('snapshot-put-back');
  await page.getByTestId('snapshot-restore-confirm').click();
  await expect(page.getByTestId('snapshot-message')).toContainText('Put back 2 files');
  expect(await fs.readFile(path.join(scripts, 'Export.lua'), 'utf8')).toBe(exportLua);
});
