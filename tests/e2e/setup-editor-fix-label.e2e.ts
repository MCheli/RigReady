import { expect, test } from './harness';

/**
 * The setup editor names each item's fix in the line under its title ("fix: start
 * SimAppPro"). Only the first word loses its capital; a name keeps its own. It used to lower
 * the whole label: "start simapppro", "switch iracing’s control profile".
 */
test('setup editor: the fix of an item keeps the names in its label', async ({ rig }) => {
  const { page, shot } = await rig.launch('dcs-setup-flying', 'setup-editor-fix-label');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  await page
    .locator('[data-testid="profile-row"][data-name="DCS F/A-18C"]')
    .getByTestId('profile-edit')
    .click();
  await expect(page.getByTestId('profile-edit-page')).toBeVisible();
  const row = page.locator('[data-testid="edit-check"][data-title="SimAppPro running"]');
  await expect(row).toContainText('fix: start SimAppPro');
  await expect(row).not.toContainText('simapppro');
  await row.scrollIntoViewIfNeeded();
  await shot('fix-label');
});
