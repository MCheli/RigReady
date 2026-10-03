import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/** Configure mode: editing setups in full, cloning, copying, deleting, hand edits. */

const editRow = (page: Page, title: string) =>
  page.locator(`[data-testid="edit-check"][data-title="${title}"]`);
const menuItem = (page: Page, text: string | RegExp) =>
  page.locator('.v-overlay--active .v-list-item').filter({ hasText: text });

async function openEditor(page: Page, name: string): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  await page
    .locator(`[data-testid="profile-row"][data-name="${name}"]`)
    .getByTestId('profile-edit')
    .click();
  await expect(page.getByTestId('profile-edit-page')).toBeVisible();
}

test('setups: an item made optional is yellow on the Fly screen', async ({ rig }) => {
  const { page, shot, dataRoot } = await rig.launch(
    'flying-trackir-not-running',
    'profile-edit-item'
  );
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await openEditor(page, 'DCS F/A-18C');
  const trackir = editRow(page, 'TrackIR5');
  await trackir.getByTestId('edit-check-open').click();
  await expect(trackir.getByTestId('edit-params-name').locator('input')).toHaveValue(
    'TrackIR5.exe'
  );
  await expect(trackir.getByTestId('edit-fix-type')).toContainText('Start the app');
  await trackir.getByTestId('edit-optional').click();
  // Up one: TrackIR now comes before the Stream Deck.
  await trackir.getByTestId('edit-check-up').click();
  await shot('editing-trackir');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();
  const yaml = await fs.readFile(path.join(dataRoot, 'profiles', 'dcs-f-a-18c.yaml'), 'utf8');
  expect(yaml.indexOf('title: TrackIR5')).toBeLessThan(yaml.indexOf('title: Stream Deck XL'));

  await page.getByTestId('mode-fly').click();
  await expect(checkRow(page, 'TrackIR5')).toHaveAttribute('data-status', 'warn');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
  await shot('yellow-on-fly');
});

test('setups: checks and launch steps are added through the generic form, with pickers, Browse and field errors', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch('flying-all-good', 'profile-add-check', {
    dialogs: { open: [['Saved Games/DCS/Config/options.lua']] },
  });
  await openEditor(page, 'DCS F/A-18C');

  // A Windows service, picked from the services on this PC.
  await page.getByTestId('edit-add-check').click();
  await menuItem(page, 'Windows service running').click();
  const service = editRow(page, 'New check');
  await service.getByTestId('pick-service').click();
  await menuItem(page, 'Nefarius HidHide Service').click();
  const hidhide = editRow(page, 'Nefarius HidHide Service');
  await expect(hidhide.getByTestId('edit-params-name').locator('input')).toHaveValue('HidHide');

  // A config file, chosen with Browse; it is stored with its path variable.
  await page.getByTestId('edit-add-check').click();
  await menuItem(page, 'Config file or folder present').click();
  const file = editRow(page, 'New check');
  await file.getByTestId('edit-check-title').locator('input').fill('DCS options');
  const options = editRow(page, 'DCS options');
  await options.getByTestId('edit-params-path-browse').click();
  await expect(options.getByTestId('edit-params-path').locator('input')).toHaveValue(
    '{DCS_USER}/Config/options.lua'
  );
  await options.getByTestId('edit-fix-type').click();
  await menuItem(page, 'Restore from a backup').click();
  await options
    .getByTestId('edit-fix-params-path')
    .locator('input')
    .fill('{DCS_USER}/Config/options.lua');
  await options.getByTestId('edit-fix-prepare').click();
  await expect(options.getByTestId('edit-fix-prepared')).toContainText(
    'Kept a copy of options.lua'
  );
  await shot('file-check');

  // A step before launch, with its options.
  await page.getByTestId('edit-add-preLaunch').click();
  const step = page.locator('[data-testid="edit-action"][data-phase="preLaunch"]');
  await step.getByTestId('edit-action-title').locator('input').fill('Start VoiceAttack');
  await step
    .getByTestId('edit-action-params-exe')
    .locator('input')
    .fill('{PROGRAM_FILES}/VoiceAttack/VoiceAttack.exe');
  await step.getByTestId('edit-action-continue').locator('input').uncheck();

  // A field left wrong is refused, and the item says which field.
  await hidhide.getByTestId('edit-params-name').locator('input').fill('');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('edit-error')).toContainText('One field needs fixing.');
  await expect(hidhide.getByTestId('edit-check-problems')).toContainText('name:');
  await shot('field-error');
  await hidhide.getByTestId('edit-params-name').locator('input').fill('HidHide');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();

  const saved = await fs.readFile(path.join(dataRoot, 'profiles', 'dcs-f-a-18c.yaml'), 'utf8');
  expect(saved).toContain('type: service.running');
  expect(saved).toContain("path: '{DCS_USER}/Config/options.lua'");
  expect(saved).toContain('continueOnError: false');

  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('group-apps')).toContainText('4 of 4 OK');
  await expect(page.getByTestId('group-files')).toContainText('1 of 1 OK');
  await shot('on-fly');
});

test('setups: clone, copy items from another setup, delete with a confirm; broken files are listed with the reason', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('fly-two-setups', 'profile-clone-copy');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  const broken = page.getByTestId('profile-invalid');
  await expect(broken).toContainText('broken.yaml');
  await expect(broken).toContainText('The profile file broken.yaml is not valid.');
  await expect(broken.getByTestId('profile-invalid-detail')).toContainText('checks[0].required');
  await shot('list');

  // Clone: a copy opens in the editor to be renamed.
  await page
    .locator('[data-testid="profile-row"][data-name="DCS F/A-18C"]')
    .getByTestId('profile-clone')
    .click();
  await expect(page.getByTestId('edit-name').locator('input')).toHaveValue('DCS F/A-18C (copy)');
  await page.getByTestId('edit-name').locator('input').fill('DCS F/A-18C night');
  await page.getByTestId('edit-save').click();
  await expect(
    page.locator('[data-testid="profile-row"][data-name="DCS F/A-18C night"]')
  ).toBeVisible();

  // Copy TrackIR and the Stream Deck from the Hornet to the Huey; the pedals are there already.
  await page
    .locator('[data-testid="profile-row"][data-name="DCS UH-1H"]')
    .getByTestId('profile-edit')
    .click();
  await page.getByTestId('edit-copy-from').click();
  await page.getByTestId('copy-source').click();
  await menuItem(page, /^DCS F\/A-18C$/).click();
  const row = (title: string) => page.locator(`[data-testid="copy-row"][data-title="${title}"]`);
  await expect(row('T-Pendular-Rudder').getByTestId('copy-duplicate')).toBeVisible();
  await row('TrackIR5').getByRole('checkbox').check();
  await row('Stream Deck').getByRole('checkbox').check();
  await row('T-Pendular-Rudder').getByRole('checkbox').check();
  await shot('copy-dialog');
  await page.getByTestId('copy-confirm').click();
  await expect(page.getByTestId('edit-copied')).toContainText(
    'Copied 2 items from "DCS F/A-18C"; skipped 1 already here.'
  );
  await page.getByTestId('edit-save').click();
  await page
    .locator('[data-testid="profile-row"][data-name="DCS UH-1H"]')
    .getByTestId('profile-fly')
    .click();
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS UH-1H');
  await page.getByTestId('group-toggle-apps').click();
  await expect(checkRow(page, 'TrackIR5')).toHaveAttribute('data-status', 'pass');
  await expect(checkRow(page, 'Stream Deck')).toHaveAttribute('data-status', 'pass');
  await shot('copied-on-fly');

  // Delete asks first, names the setup, and Fly falls back to another.
  await page.getByTestId('mode-configure').click();
  await page
    .locator('[data-testid="profile-row"][data-name="DCS UH-1H"]')
    .getByTestId('profile-more')
    .click();
  await page.getByTestId('profile-delete').click();
  await expect(page.getByTestId('profile-delete-dialog')).toContainText('Delete "DCS UH-1H"?');
  await shot('delete-confirm');
  await page.getByTestId('profile-delete-confirm').click();
  await expect(page.getByTestId('profiles-message')).toContainText(
    'Deleted "DCS UH-1H". The Safety page can bring it back.'
  );
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  // And Safety lists the deletion, ready to undo.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-safety').click();
  await expect(page.getByTestId('safety-page')).toContainText('Delete setup "DCS UH-1H"');
  await shot('in-safety');
});

test('setups: a hand edit shows up on its own; a broken edit keeps the last good version with a banner', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch('flying-all-good', 'profile-hand-edit');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  const file = path.join(dataRoot, 'profiles', 'dcs-f-a-18c.yaml');
  const original = await fs.readFile(file, 'utf8');

  await fs.writeFile(
    file,
    original.replace('name: DCS F/A-18C', 'name: Hornet (edited in Notepad)')
  );
  await expect(page.getByTestId('profile-switcher')).toContainText('Hornet (edited in Notepad)', {
    timeout: 2500,
  });

  await fs.writeFile(file, original.replace('required: true', 'required: maybe'));
  await expect(page.getByTestId('fly-problem')).toContainText('checks[0].required', {
    timeout: 2500,
  });
  // Still flying on the version that worked.
  await expect(page.getByTestId('profile-switcher')).toContainText('Hornet (edited in Notepad)');
  await expect(page.getByTestId('group-devices')).toContainText('12 of 12 OK');
  await shot('broken-edit');

  await fs.writeFile(file, original);
  await expect(page.getByTestId('fly-problem')).toHaveCount(0, { timeout: 2500 });
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await shot('fixed');

  // A file with comments of its own: saving from RigReady says once that they go.
  await fs.writeFile(file, `# My notes on the Hornet\n${original}`);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-edit').click();
  await page.getByTestId('edit-name').locator('input').fill('Hornet');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('comments-warning')).toContainText('Your comments will be lost');
  await shot('comments-warning');
  await page.getByTestId('comments-save').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();
  expect(await fs.readFile(file, 'utf8')).not.toContain('# My notes');

  // The YAML file itself: open it in the editor Windows uses for it.
  await page
    .locator('[data-testid="profile-row"][data-name="Hornet"]')
    .getByTestId('profile-more')
    .click();
  await page
    .getByRole('option')
    .or(page.locator('.v-overlay--active .v-list-item'))
    .filter({ hasText: 'Open the YAML file' })
    .click();
  await expect(page.getByTestId('profiles-message')).toHaveText('Opened in your editor.');
});

test('setups: choosing a detected game fills in what Launch starts, and the setup can launch it', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch('flying-fresh', 'profile-capture-game');
  await page.getByTestId('fly-create').click();
  await page.getByTestId('capture-name').locator('input').fill('DCS UH-1H');
  await page.getByTestId('capture-game').click();
  await menuItem(page, 'DCS World').click();
  await expect(page.getByTestId('capture-launch-exe').locator('input')).toHaveValue(
    path.join(
      home,
      'Program Files (x86)',
      'Steam',
      'steamapps',
      'common',
      'DCSWorld',
      'bin',
      'DCS.exe'
    )
  );
  const version = page.locator(
    '[data-testid="capture-candidate"][data-title="DCS World not updated since verified"]'
  );
  await expect(version.getByRole('checkbox')).toBeChecked();
  await shot('game-chosen');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS UH-1H');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('group-toggle-other').click();
  await expect(checkRow(page, 'DCS World not updated since verified')).toHaveAttribute(
    'data-status',
    'pass'
  );
  await expect(page.getByTestId('launch')).toBeEnabled();
  await shot('on-fly');
});

test('setups: a device is added by pressing a button on it', async ({ rig }) => {
  const { page, shot, sendInput } = await rig.launch('flying-all-good', 'profile-press-button');
  await openEditor(page, 'DCS F/A-18C');
  await page.getByTestId('edit-add-check').click();
  await menuItem(page, 'Device connected').click();
  const item = editRow(page, 'New check');
  await item.getByTestId('press-button').click();
  await expect(item.getByTestId('press-waiting')).toContainText(
    'Press any button on the device now'
  );
  await shot('waiting');
  await sendInput([
    {
      index: 1,
      name: 'R-VPC Panel #1',
      axes: [],
      buttons: [false, false, true],
      hats: [],
      timestamp: 1,
    },
  ]);
  const found = page.locator('[data-testid="edit-check"][data-type="device.connected"]').last();
  await expect(found.getByTestId('press-result')).toContainText('Found');
  await expect(found.getByTestId('edit-params-vendorId').locator('input')).toHaveValue('3344');
  await expect(found.getByTestId('edit-params-productId').locator('input')).toHaveValue('C259');
  await shot('found');
});
