import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/** Configure > Stream Deck on the owner's rig and on a new PC. */

const DCS_WORLD = '042F7366-9A23-444F-9AE6-327A9DB7979F';
const OLD_BACKUP = 'Documents/DCS Backup/Stream Deck - 02-03-2024 - 19-16.streamDeckProfilesBackup';

async function openStreamDeck(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-stream-deck').click();
  await expect(page.getByTestId('stream-deck-page')).toBeVisible();
}

/** Web pages open in the real browser; record them instead. */
async function captureExternalOpens(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { opened: string[] }).opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  return () => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
}

test('stream deck: health names the missing plugins and the missing DCS-ExportScript', async ({
  rig,
}) => {
  const { page, app, shot } = await rig.launch('stream-deck-owner', 'stream-deck-health');
  const opened = await captureExternalOpens(app);
  await openStreamDeck(page);

  await expect(page.getByTestId('sd-app-state')).toHaveText('Running');
  await expect(page.getByTestId('sd-tile-app')).toContainText('Stream Deck 7.4.2');
  await expect(page.getByTestId('sd-tile-device')).toContainText('Stream Deck XL');
  await expect(page.getByTestId('sd-tile-profiles')).toContainText('3');
  await expect(page.getByTestId('sd-tile-backup')).toContainText('None yet');

  const finding = (id: string) => page.locator(`[data-testid="sd-finding"][data-id="${id}"]`);
  await expect(finding('missing-plugins')).toContainText(
    '66 actions use 2 plugins that are not installed'
  );
  await expect(finding('missing-avionics.madjack.dcs')).toContainText(
    '65 actions use DCS-BIOS plugin by Mad Jack, which is not installed'
  );
  await expect(finding('dcs-interface-export')).toContainText(
    '32 actions will stay blank in DCS: DCS-ExportScript is not loaded'
  );
  await expect(finding('dcs-interface-export')).toContainText('does not load DCS-ExportScript');
  await expect(finding('no-backup')).toHaveAttribute('data-severity', 'warn');
  await shot('health');
  await finding('dcs-interface-export').scrollIntoViewIfNeeded();
  await shot('health-dcs');

  // A web page opens only after the user confirms where it goes.
  await finding('missing-avionics.madjack.dcs').getByTestId('sd-finding-link').click();
  await expect(page.getByTestId('external-confirm')).toBeVisible();
  await expect(page.getByTestId('external-confirm')).toContainText('forum.dcs.world');
  await shot('confirm-link');
  await page.getByTestId('external-cancel').click();
  expect(await opened()).toEqual([]);
  await finding('missing-avionics.madjack.dcs').getByTestId('sd-finding-link').click();
  await page.getByTestId('external-open').click();
  await expect
    .poll(opened)
    .toEqual(['https://forum.dcs.world/topic/230609-new-streamdeck-plugin/']);

  // The inventory: which profiles exist and how many actions use which plugin.
  await page.getByTestId('sd-tab-profiles').click();
  await expect(page.getByTestId('sd-profile')).toHaveCount(3);
  await expect(
    page.locator('[data-testid="sd-plugin"][data-id="avionics.madjack.dcs"]')
  ).toContainText('Not installed');
  await expect(page.locator('[data-testid="sd-plugin"][data-id="com.ctytler.dcs"]')).toContainText(
    '32'
  );
  await expect(
    page.locator('[data-testid="sd-plugin"][data-id="com.elgato.discord"]')
  ).toContainText('Installed, unused');
  await shot('inventory');
});

test('stream deck: back up while the app runs, then rename, export and delete backups', async ({
  rig,
}) => {
  const { page, shot, dataRoot, home } = await rig.launch(
    'stream-deck-owner',
    'stream-deck-backups',
    {
      dialogs: { save: ['Documents/Known good.streamDeckProfilesBackup'] },
    }
  );
  await openStreamDeck(page);
  await page.getByTestId('sd-tab-backups').click();
  await expect(page.getByTestId('sd-backups-empty')).toContainText('No Stream Deck backups yet');
  await expect(page.getByTestId('sd-elgato-row')).toContainText(
    'Stream Deck - 2026-10-01-09-12-44'
  );
  await shot('empty');

  await page.getByTestId('sd-backup').click();
  await expect(page.getByTestId('sd-backup-dialog')).toBeVisible();
  await page.getByTestId('sd-backup-name-input').locator('input').fill('Before the F-16 rework');
  await page.getByTestId('sd-backup-plugins').getByRole('checkbox').check();
  await shot('backup-dialog');
  await page.getByTestId('sd-backup-confirm').click();
  await expect(page.getByTestId('sd-message')).toContainText(
    'Backed up 3 profiles as "Before the F-16 rework"'
  );
  const row = page.getByTestId('sd-backup-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('3 profiles');
  await expect(row).toContainText('with plugin folders');
  // Read-only: Stream Deck kept running.
  await expect(page.getByTestId('sd-app-state')).toHaveText('Running');
  const files = await fs.readdir(path.join(dataRoot, 'stream-deck', 'backups'));
  expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(1);
  expect(files.some((f) => f.endsWith('.streamDeckProfilesBackup'))).toBe(true);

  // Stream Deck's own automatic backup can be brought in too.
  await page.getByTestId('sd-elgato-import').click();
  await expect(page.getByTestId('sd-backup-row')).toHaveCount(2);
  await expect(page.getByTestId('sd-elgato-imported')).toHaveText('Imported');
  await expect(page.getByTestId('sd-backup-row').first()).toContainText('(made ');
  await shot('two-backups');

  // Rename.
  await row.filter({ hasText: 'Before the F-16 rework' }).getByTestId('sd-backup-menu').click();
  await page.getByTestId('sd-rename').click();
  await expect(page.getByTestId('sd-rename-dialog')).toBeVisible();
  await page.getByTestId('sd-rename-input').locator('input').fill('Known good');
  await page.getByTestId('sd-rename-confirm').click();
  await expect(page.locator('[data-testid="sd-backup-row"][data-name="Known good"]')).toBeVisible();

  // Export: a .streamDeckProfilesBackup where the user chose.
  await page
    .locator('[data-testid="sd-backup-row"][data-name="Known good"]')
    .getByTestId('sd-backup-menu')
    .click();
  await page.getByTestId('sd-export').click();
  const exported = path.join(home, 'Documents', 'Known good.streamDeckProfilesBackup');
  await expect(page.getByTestId('sd-message')).toContainText(
    `Exported "Known good" to ${exported}`
  );
  expect((await fs.stat(exported)).size).toBeGreaterThan(1000);
  await shot('exported');

  // Delete asks first.
  await page
    .locator('[data-testid="sd-backup-row"][data-name="Known good"]')
    .getByTestId('sd-backup-menu')
    .click();
  await page.getByTestId('sd-delete').click();
  await expect(page.getByTestId('sd-delete-dialog')).toBeVisible();
  await shot('delete-confirm');
  await page.getByTestId('sd-delete-confirm').click();
  await expect(page.getByTestId('sd-message')).toContainText('Deleted "Known good"');
  await expect(page.getByTestId('sd-backup-row')).toHaveCount(1);
});

test('stream deck: restore closes the app, restores with a backup first, and starts it again', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch('stream-deck-owner', 'stream-deck-restore');
  await openStreamDeck(page);
  await page.getByTestId('sd-tab-backups').click();
  await page.getByTestId('sd-backup').click();
  await page.getByTestId('sd-backup-name-input').locator('input').fill('Known good');
  await page.getByTestId('sd-backup-confirm').click();
  await expect(page.getByTestId('sd-backup-row')).toHaveCount(1);

  // Later, a profile gets broken.
  const manifest = path.join(
    home,
    'AppData',
    'Roaming',
    'Elgato',
    'StreamDeck',
    'ProfilesV3',
    `${DCS_WORLD}.sdProfile`,
    'manifest.json'
  );
  const good = await fs.readFile(manifest, 'utf8');
  await fs.writeFile(manifest, good.replace('"DCS World"', '"DCS World (broken)"'));

  await page.getByTestId('sd-restore').click();
  const dialog = page.getByTestId('sd-restore-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('sd-restore-replace')).toContainText(
    'DCS World (now "DCS World (broken)")'
  );
  await expect(page.getByTestId('sd-restore-running')).toContainText('Stream Deck is running');
  await expect(page.getByTestId('sd-restore-confirm')).toHaveText('Close Stream Deck and restore');
  await shot('preview');
  await page.getByTestId('sd-restore-confirm').click();

  await expect(page.getByTestId('sd-restored')).toContainText(
    'Restored 3 profiles from "Known good"'
  );
  await expect(page.getByTestId('sd-restored')).toContainText(
    'Stream Deck was closed for the restore'
  );
  await expect(page.getByTestId('sd-app-state')).toHaveText('Not running');
  expect(await fs.readFile(manifest, 'utf8')).toBe(good);
  // The profiles that were there before were kept as a backup of their own.
  await expect(
    page.locator('[data-testid="sd-backup-row"][data-name=\'Before restoring "Known good"\']')
  ).toBeVisible();
  await shot('restored');

  await page.getByTestId('sd-start-after').click();
  await expect(page.getByTestId('sd-app-state')).toHaveText('Running');
  await expect(page.getByTestId('sd-message')).toContainText('Started Stream Deck');
  await shot('started-again');

  // The restore is one action on the Safety page.
  await page.getByTestId('nav-safety').click();
  await expect(
    page.locator(
      '[data-testid="change-group"][data-reason=\'Restore Stream Deck backup "Known good"\']'
    )
  ).toBeVisible();
});

test('stream deck: a new PC gets install guidance, a guided setup and can import an old backup', async ({
  rig,
}) => {
  const { page, app, shot } = await rig.launch('stream-deck-new-pc', 'stream-deck-new-pc', {
    dialogs: { open: [[OLD_BACKUP]] },
  });
  const opened = await captureExternalOpens(app);
  await openStreamDeck(page);
  await expect(page.getByTestId('sd-app-state')).toHaveText('Not installed');
  await expect(page.getByTestId('sd-install-guide')).toContainText('Install the Stream Deck app');
  await expect(page.getByTestId('sd-install-dcs')).toContainText('DCS-BIOS');
  // Nothing is here to be healthy or not: no green "no problems" on a PC without a Stream Deck.
  await expect(page.getByTestId('sd-findings-none')).toHaveCount(0);
  await shot('not-installed');

  await page.getByTestId('sd-download').click();
  await expect(page.getByTestId('external-confirm')).toContainText('www.elgato.com');
  await page.getByTestId('external-open').click();
  await expect.poll(opened).toEqual(['https://www.elgato.com/downloads']);

  await page.getByTestId('sd-setup-link').click();
  await expect(page.getByTestId('sd-setup-page')).toBeVisible();
  const step = (id: string) => page.locator(`[data-testid="sd-step"][data-step="${id}"]`);
  await expect(step('install')).toHaveAttribute('data-done', 'false');
  await expect(step('connect')).toContainText('No Stream Deck connected');
  await expect(page.getByTestId('sd-setup-progress')).toHaveText('0 of 6 done');
  await shot('setup');

  await page.getByTestId('sd-setup-import').click();
  await expect(page.getByTestId('sd-setup-message')).toContainText('with 2 profiles');
  await expect(page.locator('[data-testid="sd-step"][data-step="plugins"]')).toContainText(
    'Your backup needs 1 plugin'
  );
  await expect(page.getByTestId('sd-setup-backups')).toContainText('Go to Backups (1)');
  // What the profiles in that backup will need once they are back.
  await expect(page.getByTestId('sd-setup-expected-plugin')).toContainText('DCS Interface');
  await shot('setup-after-import');
  await page.getByTestId('sd-setup-backups').click();
  const row = page.getByTestId('sd-backup-row');
  await expect(row).toContainText('Stream Deck - 02-03-2024 - 19-16');
  await expect(row).toContainText('older Stream Deck format');
  await expect(row).toContainText(
    'Imported from Stream Deck - 02-03-2024 - 19-16.streamDeckProfilesBackup'
  );

  // The older format is restored by the Stream Deck app itself, which must be installed.
  await page.getByTestId('sd-restore').click();
  await expect(page.getByTestId('sd-restore-app')).toContainText('older Stream Deck format');
  await expect(page.getByTestId('sd-restore-confirm')).toBeDisabled();
  await shot('restore-needs-app');
  await page.getByTestId('sd-restore-cancel').click();
});

test('stream deck: the app and hardware checks are captured into a setup and fixed by Make ready', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('stream-deck-owner', 'stream-deck-checks');
  await page.getByTestId('fly-create').click();
  const capture = page.getByTestId('capture-page');
  await expect(capture).toBeVisible();
  await page.getByTestId('capture-name').locator('input').fill('Stream Deck only');
  for (const title of ['Stream Deck app', 'Stream Deck hardware']) {
    await page
      .locator(`[data-testid="capture-candidate"][data-title="${title}"]`)
      .getByRole('checkbox')
      .check();
  }
  await expect(page.getByTestId('capture-group-apps')).toContainText(
    'Finds the Stream Deck app wherever it is installed'
  );
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  await mutate([{ op: 'stopProcess', name: 'StreamDeck.exe' }]);
  const row = checkRow(page, 'Stream Deck app');
  await expect(row).toHaveAttribute('data-status', 'warn');
  await expect(row).toContainText('Not running');
  await expect(row.getByTestId('check-fix')).toContainText('Start the Stream Deck app');
  await shot('not-running');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('group-apps')).toContainText(/(\d+) of \1 OK/);
  await page.getByTestId('group-toggle-devices').click();
  await expect(checkRow(page, 'Stream Deck hardware')).toContainText('Stream Deck XL connected');
  await shot('fixed');
});
