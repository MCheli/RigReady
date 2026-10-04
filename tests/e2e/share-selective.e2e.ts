import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/** Checks that are switched off, and what an import does with devices and bindings that are not here. */

const editRow = (page: Page, title: string): Locator =>
  page.locator(`[data-testid="edit-check"][data-title="${title}"]`);

test('setups: a check switched off in the editor is shown as Off on the Play screen and does not count', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch(
    'flying-trackir-not-running',
    'share-check-switched-off'
  );
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(checkRow(page, 'TrackIR5')).toHaveAttribute('data-status', 'fail');

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  await page
    .locator('[data-testid="profile-row"][data-name="DCS F/A-18C"]')
    .getByTestId('profile-edit')
    .click();
  const trackir = editRow(page, 'TrackIR5');
  await expect(trackir.getByTestId('edit-check-off')).toHaveCount(0);
  await trackir.getByTestId('edit-check-disabled').locator('input').uncheck();
  await expect(trackir.getByTestId('edit-check-off')).toContainText('off: not checked');
  await shot('switched-off-in-the-editor');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();
  const yaml = await fs.readFile(path.join(dataRoot, 'profiles', 'dcs-f-a-18c.yaml'), 'utf8');
  expect(yaml).toContain('disabled: true');

  // TrackIR is still not running; the setup no longer asks for it.
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('group-toggle-apps').click();
  const row = checkRow(page, 'TrackIR5');
  await expect(row).toHaveAttribute('data-status', 'off');
  await expect(row.getByTestId('check-off')).toHaveText('off');
  await expect(row).toContainText('Off: not checked and not counted');
  await expect(row.getByTestId('check-fix')).toHaveCount(0);
  await expect(page.getByTestId('group-toggle-apps')).toContainText('1 off');
  await expect(page.getByTestId('group-toggle-apps')).not.toContainText('3 of 3');
  await shot('off-on-fly');
});

async function exportSetup(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-share').click();
  await page.getByTestId('share-setup').click();
  await page.getByRole('option', { name: 'Squadron F/A-18C' }).click();
  await page.getByTestId('share-item-dcs-bindings').locator('input').check();
  await page.getByTestId('share-item-dcs-scripts').locator('input').check();
  await page.getByTestId('share-reviewed').locator('input').check();
  await page.getByTestId('share-save').click();
  await expect(page.getByTestId('share-saved')).toContainText('Squadron F-A-18C.rigready');
}

async function openImport(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-share').click();
  await page.getByTestId('share-mode-import').click();
  await page.getByTestId('import-open').click();
  await expect(page.getByTestId('import-apply')).toBeVisible();
}

test('share: checks for devices a PC does not have are imported switched off, and Undo removes the setup with the files', async ({
  rig,
}) => {
  const source = await rig.launch('share-dcs', 'share-selective-export', {
    dialogs: { save: ['Documents/Squadron F-A-18C.rigready'] },
  });
  await exportSetup(source.page);
  const file = path.join(source.home, 'Documents', 'Squadron F-A-18C.rigready');

  // A friend's racing PC: DCS installed, no flight gear, no bindings of its own yet.
  const friend = await rig.launch('share-racing-pc', 'share-selective-import', {
    dialogs: { open: [[file], [file]] },
  });
  const { page, shot, home, dataRoot } = friend;
  const input = path.join(home, 'Saved Games', 'DCS', 'Config', 'Input');
  await fs.rm(input, { recursive: true });
  const profiles = path.join(dataRoot, 'profiles');

  await openImport(page);
  await expect(page.locator('[data-testid="import-part"][data-part="profile"]')).toContainText(
    'kept, switched off and marked "device not found"'
  );
  await page.getByTestId('import-apply').click();
  await expect(page.getByTestId('import-result-summary')).toContainText(
    'Added the setup "Squadron F/A-18C"'
  );
  await expect(page.getByTestId('import-switched-off')).toContainText('imported switched off');
  await expect(page.getByTestId('import-switched-off')).toContainText('(device not found)');
  expect(await fs.readdir(profiles)).toEqual(['squadron-f-a-18c.yaml']);
  expect((await fs.readdir(path.join(input, 'FA-18C_hornet', 'joystick'))).length).toBeGreaterThan(
    3
  );
  await shot('imported');

  // One Undo takes back the files and the setup.
  await page.getByTestId('import-undo').click();
  await expect(page.getByTestId('import-undone')).toContainText('the setup was removed');
  expect(await fs.readdir(profiles)).toEqual([]);
  // Every file the import wrote is gone, and so are the folders it created for them:
  // Config was there before (it holds options.lua) and stays, Config/Input is gone again.
  const config = path.dirname(input);
  expect(await fs.readdir(config)).not.toContain('Input');
  expect(await fs.readdir(config)).toContain('options.lua');
  await shot('undone');

  // Again, this time kept: on the Play screen the missing gear is off, not failed, not passed.
  await page.getByTestId('import-another').click();
  await page.getByTestId('import-open').click();
  await page.getByTestId('import-apply').click();
  await expect(page.getByTestId('import-result')).toBeVisible();
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toBeVisible();
  const mfd = checkRow(page, 'WINWING MFD1-C (device not found)');
  if ((await mfd.count()) === 0) await page.getByTestId('group-toggle-devices').click();
  await expect(mfd).toHaveAttribute('data-status', 'off');
  await expect(page.getByTestId('group-toggle-devices')).toContainText('off');
  await shot('missing-devices-are-off');

  // The Safety page undoes the same import, setup included.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-safety').click();
  // Newest first: the import that was kept (the earlier one is already undone).
  const imported = page
    .locator(`[data-testid="change-group"][data-reason='Import shared setup "Squadron F/A-18C"']`)
    .first();
  await imported.getByTestId('change-toggle').click();
  await expect(imported).toContainText('squadron-f-a-18c.yaml');
  await shot('safety-lists-the-setup');
  await imported.getByTestId('change-undo').click();
  await expect(imported.getByTestId('change-undone')).toBeVisible();
  expect(await fs.readdir(profiles)).toEqual([]);
  // The Safety page's undo leaves no empty folders behind either.
  expect(await fs.readdir(config)).not.toContain('Input');
  expect(await fs.readdir(config)).toContain('options.lua');
});

test("share: imported binding files under another PC's device IDs open Bindings, Device IDs, ready to move", async ({
  rig,
}) => {
  // The sender's binding files carry the device IDs of the sender's Windows.
  const source = await rig.launch('share-old-ids', 'share-device-ids-export', {
    dialogs: { save: ['Documents/Squadron F-A-18C.rigready'] },
  });
  await exportSetup(source.page);
  const file = path.join(source.home, 'Documents', 'Squadron F-A-18C.rigready');

  // Here every controller is attached, under this PC's own IDs.
  const friend = await rig.launch('flying-fresh', 'share-device-ids', {
    dialogs: { open: [[file]] },
  });
  const { page, shot } = friend;
  await openImport(page);
  await page.getByTestId('import-apply').click();
  const notice = page.getByTestId('import-device-ids');
  await expect(notice).toContainText('device IDs this PC does not use');
  await expect(notice).toContainText('Bindings → Device IDs shows which can be moved');
  await notice.scrollIntoViewIfNeeded();
  await shot('notice-with-button');

  await page.getByTestId('import-open-device-ids').click();
  await expect(page).toHaveURL(/dcs-bindings\/device-ids/);
  await expect(page.getByTestId('bind-device-ids')).toBeVisible();
  // The imported files are listed there with the attached device each one can move to.
  await expect(page.getByTestId('ids-orphan').first()).toBeVisible();
  expect(await page.getByTestId('ids-orphan').count()).toBeGreaterThan(5);
  await expect(page.getByTestId('ids-new').first()).not.toHaveText('not chosen yet');
  await shot('device-ids');
});
