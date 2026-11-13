import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/**
 * Every place that closes a program for the user closes it as one program, and says why
 * when it stays open: Stand down for the Stream Deck app and for TrackIR, the Stream Deck
 * restore, the restore of the wheel software's settings, and the restore of a backup.
 *
 * `failProcessClose` makes a program of the fake PC stay open when it is asked to close,
 * for a reason a real one has: `ignored` (its X only sends it to the tray) or `refused`
 * (it runs as administrator).
 */

const TRAY = 'it was asked to close and stayed open. Some apps only go to the tray when asked.';
const ADMIN = 'Windows did not let RigReady close it. It may be running as administrator.';
const NOT_RESTORED = 'Close it yourself, then restore again. Nothing was restored.';

/** Makes a setup from what is on this PC, with the candidates of these titles ticked. */
async function capture(page: Page, name: string, titles: string[]): Promise<void> {
  await page.getByTestId('fly-create').click();
  await expect(page.getByTestId('capture-page')).toBeVisible();
  await page.getByTestId('capture-name').locator('input').fill(name);
  for (const title of titles) {
    await page
      .locator(`[data-testid="capture-candidate"][data-title="${title}"]`)
      .getByRole('checkbox')
      .check();
  }
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
}

/** Opens one check of a setup in the setup editor. */
async function openCheck(page: Page, setup: string, title: string): Promise<Locator> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  await page
    .locator(`[data-testid="profile-row"][data-name="${setup}"]`)
    .getByTestId('profile-edit')
    .click();
  await expect(page.getByTestId('profile-edit-page')).toBeVisible();
  const row = page.locator(`[data-testid="edit-check"][data-title="${title}"]`);
  await row.getByTestId('edit-check-open').click();
  return row;
}

async function saveSetup(page: Page): Promise<void> {
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('stand-down')).toBeEnabled();
}

test('close together: Stand down says why the Stream Deck app is still running and names the Force switch, which the setup editor shows', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch(
    'stream-deck-owner',
    'close-together-stream-deck-stand-down'
  );
  await capture(page, 'Stream Deck only', ['Stream Deck app']);

  // The check closes the app at Stand down once it is told to. The switch that lets it be
  // ended is there under the name the Stand down line uses, and it is off.
  let check = await openCheck(page, 'Stream Deck only', 'Stream Deck app');
  await check.getByTestId('edit-params-closeOnStandDown').locator('input').check();
  const force = check.getByTestId('edit-params-forceClose');
  await expect(force).toContainText('Force it closed if it does not close');
  await expect(force.locator('input')).not.toBeChecked();
  await force.scrollIntoViewIfNeeded();
  await shot('the-switch-in-the-setup');
  await saveSetup(page);

  // Stream Deck's window closes to the tray: the app is still there afterwards.
  await mutate([{ op: 'failProcessClose', name: 'StreamDeck.exe', why: 'ignored' }]);
  await page.getByTestId('stand-down').click();
  const activity = page.getByTestId('fly-activity');
  await expect(activity).toContainText(
    `Stream Deck is still running: ${TRAY} Close it yourself, or switch on "Force it closed if it does not close" for this check in the setup.`
  );
  await expect(activity).not.toContainText('Closed Stream Deck');
  await expect(checkRow(page, 'Stream Deck app')).toHaveAttribute('data-status', 'pass');
  await activity.scrollIntoViewIfNeeded();
  await shot('still-running');

  // With the switch on, the same Stand down ends it and says that it had to.
  check = await openCheck(page, 'Stream Deck only', 'Stream Deck app');
  await check.getByTestId('edit-params-forceClose').locator('input').check();
  await saveSetup(page);
  await page.getByTestId('stand-down').click();
  await expect(activity).toContainText('Closed Stream Deck (it had to be forced)');
  await expect(checkRow(page, 'Stream Deck app')).not.toHaveAttribute('data-status', 'pass');
  await activity.scrollIntoViewIfNeeded();
  await shot('forced');
});

test('close together: Stand down says why TrackIR is still running when Windows will not let RigReady close it', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch(
    'trackir-ready',
    'close-together-trackir-stand-down'
  );
  await capture(page, 'Head tracking', ['TrackIR software']);

  // TrackIR runs as administrator here. It is always ended when it does not close, so
  // there is no switch to point at: the line says what is left to do.
  await mutate([{ op: 'failProcessClose', name: 'TrackIR5.exe', why: 'refused' }]);
  await page.getByTestId('stand-down').click();
  const activity = page.getByTestId('fly-activity');
  await expect(activity).toContainText(`TrackIR is still running: ${ADMIN} Close it yourself.`);
  await expect(activity).not.toContainText('Force it closed');
  await expect(activity).not.toContainText('Closed TrackIR');
  await expect(checkRow(page, 'TrackIR software')).toHaveAttribute('data-status', 'pass');
  await shot('still-running');

  // One that only goes to the tray is ended, and the line says so.
  await mutate([{ op: 'failProcessClose', name: 'TrackIR5.exe', why: 'ignored' }]);
  await page.getByTestId('stand-down').click();
  await expect(activity).toContainText('Closed TrackIR (it had to be forced)');
  await expect(checkRow(page, 'TrackIR software')).toHaveAttribute('data-status', 'fail');
  await shot('forced');
});

test('close together: the Stream Deck restore says why the app is still running, and offers to end it only where that can help', async ({
  rig,
}) => {
  const { page, shot, mutate, home } = await rig.launch(
    'stream-deck-owner',
    'close-together-stream-deck-restore'
  );
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-stream-deck').click();
  await expect(page.getByTestId('stream-deck-page')).toBeVisible();
  await page.getByTestId('sd-tab-backups').click();
  await page.getByTestId('sd-backup').click();
  await page.getByTestId('sd-backup-name-input').locator('input').fill('Known good');
  await page.getByTestId('sd-backup-confirm').click();
  await expect(page.getByTestId('sd-backup-row')).toHaveCount(1);
  const manifest = path.join(
    home,
    'AppData',
    'Roaming',
    'Elgato',
    'StreamDeck',
    'ProfilesV3',
    '042F7366-9A23-444F-9AE6-327A9DB7979F.sdProfile',
    'manifest.json'
  );
  const good = await fs.readFile(manifest, 'utf8');
  const broken = good.replace('"DCS World"', '"DCS World (broken)"');
  await fs.writeFile(manifest, broken);
  const stubborn = page.getByTestId('sd-restore-stubborn');
  const end = page.getByTestId('sd-restore-force');

  // It runs as administrator: ending it would fail the same way, so that is not offered.
  await mutate([{ op: 'failProcessClose', name: 'StreamDeck.exe', why: 'refused' }]);
  await page.getByTestId('sd-restore').click();
  await expect(page.getByTestId('sd-restore-dialog')).toBeVisible();
  await expect(page.getByTestId('sd-restore-confirm')).toHaveText('Close Stream Deck and restore');
  await page.getByTestId('sd-restore-confirm').click();
  await expect(stubborn).toHaveText(`Stream Deck is still running: ${ADMIN} ${NOT_RESTORED}`);
  await expect(end).toHaveCount(0);
  // The button no longer says RigReady will close it: that is what did not work.
  await expect(page.getByTestId('sd-restore-confirm')).toHaveText('Restore again');
  expect(await fs.readFile(manifest, 'utf8')).toBe(broken);
  await shot('windows-does-not-allow-it');

  // Its window only goes to the tray: the reason, the way to quit it, and the button that
  // ends it, named in the text as it is on the button.
  await mutate([{ op: 'failProcessClose', name: 'StreamDeck.exe', why: 'ignored' }]);
  await page.getByTestId('sd-restore-confirm').click();
  await expect(stubborn).toHaveText(
    `Stream Deck is still running: ${TRAY} Quit it from its tray icon (right-click, then Quit Stream Deck), or choose "End Stream Deck and restore". Nothing was restored.`
  );
  await expect(end).toHaveText('End Stream Deck and restore');
  await expect(page.getByTestId('sd-restore-confirm')).toHaveCount(0);
  expect(await fs.readFile(manifest, 'utf8')).toBe(broken);
  await shot('went-to-the-tray');

  await end.click();
  await expect(page.getByTestId('sd-restored')).toContainText(
    'Restored 3 profiles from "Known good"'
  );
  expect(await fs.readFile(manifest, 'utf8')).toBe(good);
  await shot('ended-and-restored');
});

test('close together: restoring the wheel software settings names the app that is open and says why it stayed open', async ({
  rig,
}) => {
  const { page, shot, mutate, home } = await rig.launch(
    'racing-fresh',
    'close-together-wheel-software-restore'
  );
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-wheel').click();
  const panel = page.getByTestId('backups-fanatec');
  await panel.scrollIntoViewIfNeeded();
  await panel.getByTestId('backup-now').click();
  await expect(panel.getByTestId('backup-row')).toHaveCount(1);
  const prefs = path.join(
    home,
    'AppData',
    'Roaming',
    'com.example',
    'Fanatec',
    'shared_preferences.json'
  );
  const original = await fs.readFile(prefs, 'utf8');
  await fs.writeFile(prefs, '{}');

  // The Fanatec App is open, and its X only sends it to the tray.
  await mutate([
    {
      op: 'startProcess',
      name: 'Fanatec.exe',
      path: path.join(home, 'Program Files', 'Fanatec', 'FanatecUI', 'UI', 'Fanatec.exe'),
    },
    { op: 'failProcessClose', name: 'Fanatec.exe', why: 'ignored' },
  ]);
  await panel.getByTestId('backup-restore').click();
  const dialog = page.getByTestId('restore-confirm');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('restore-go').click();
  await expect(dialog.getByTestId('restore-app-open')).toHaveText(
    'The Fanatec App is open. It must be closed while its settings are restored. RigReady can close it, restore, and start it again.'
  );
  await expect(dialog.getByTestId('restore-close-app')).toHaveText('Close the app and restore');
  await shot('the-app-is-open');

  await dialog.getByTestId('restore-close-app').click();
  await expect(dialog.getByTestId('restore-still-running')).toHaveText(
    `The Fanatec App is still running: ${TRAY} ${NOT_RESTORED}`
  );
  // The question stays, so the same restore can be asked again once the app is closed. The
  // button no longer says RigReady will close it: that is what did not work.
  await expect(dialog.getByTestId('restore-close-app')).toHaveText('Restore again');
  expect(await fs.readFile(prefs, 'utf8')).toBe('{}');
  await shot('still-running');

  // Closed from its tray icon by hand: the same button now restores.
  await mutate([{ op: 'stopProcess', name: 'Fanatec.exe' }]);
  await dialog.getByTestId('restore-close-app').click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByTestId('backup-message')).toContainText('Restored 1 file');
  expect(await fs.readFile(prefs, 'utf8')).toBe(original);
  await shot('restored');
});

test('close together: restoring a backup says why a program it was asked to close is still running, and restores nothing', async ({
  rig,
}) => {
  const { page, shot, mutate, home } = await rig.launch(
    'backup-racing',
    'close-together-backup-restore'
  );
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-backups').click();
  await page.getByTestId('backups-tab-tracked').click();
  const suggestion = page.locator('[data-testid="suggestion"][data-label="Fanatec App settings"]');
  await suggestion.getByTestId('suggestion-add').click();
  await expect(suggestion.getByTestId('suggestion-added')).toBeVisible();
  await page.getByTestId('backups-tab-backups').click();
  await page.getByTestId('backup-all').click();
  await expect(page.getByTestId('backup-outcome-title')).toContainText('Backed up');
  const prefs = path.join(
    home,
    'AppData',
    'Roaming',
    'com.example',
    'Fanatec',
    'shared_preferences.json'
  );
  const original = await fs.readFile(prefs, 'utf8');
  await fs.writeFile(prefs, '{}');

  // The Fanatec App is open and runs as administrator.
  await mutate([
    {
      op: 'startProcess',
      name: 'Fanatec.exe',
      path: path.join(home, 'Program Files', 'Fanatec', 'FanatecUI', 'UI', 'Fanatec.exe'),
    },
    { op: 'failProcessClose', name: 'Fanatec.exe', why: 'refused' },
  ]);
  await page.getByTestId('backup-restore').click();
  await expect(page.getByTestId('restore-page')).toBeVisible();
  await expect(page.getByTestId('restore-running')).toContainText('Fanatec App is running');
  await page.getByTestId('restore-close-programs').locator('input').check();
  await page.getByTestId('restore-apply').click();
  const error = page.getByTestId('restore-error');
  await expect(error).toContainText(`Fanatec App is still running: ${ADMIN} ${NOT_RESTORED}`);
  await expect(page.getByTestId('restore-report')).toHaveCount(0);
  expect(await fs.readFile(prefs, 'utf8')).toBe('{}');
  await error.scrollIntoViewIfNeeded();
  await shot('still-running');

  // Once it closes when asked, the same restore goes through.
  await mutate([{ op: 'failProcessClose', name: 'Fanatec.exe', why: 'off' }]);
  await page.getByTestId('restore-apply').click();
  await expect(page.getByTestId('restore-report-title')).toContainText('Restored 1 item');
  await expect(page.getByTestId('restore-closed')).toContainText('Fanatec App');
  expect(await fs.readFile(prefs, 'utf8')).toBe(original);
  await shot('restored');
});
