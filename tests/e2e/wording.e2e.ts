import { expect, test } from './harness';

/**
 * Someone who only races meets no text that takes them for a DCS pilot on the pages every
 * game shares (findings 27 and 37 of the rig sitting, 12 November 2026). A PC whose only game
 * is iRacing, walked through the shared places the wording pass changed, one picture each.
 */

test('wording: on a PC whose only game is iRacing, the shared pages speak of any game', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('shell-racing-pc', 'wording-racing');
  await page.getByTestId('mode-configure').click();

  // Settings > AI: the assistant is for whatever you play; the binding guide names its games.
  await page.getByTestId('nav-settings').click();
  const who = page.getByTestId('ai-who-answers');
  await who.scrollIntoViewIfNeeded();
  await expect(who).toContainText(
    'the assistant answers questions about your rig, proposes setups and drafts scripts, whatever you play.'
  );
  await expect(who).toContainText(
    'For DCS aircraft and iRacing cars, the Binding guide page can also'
  );
  await shot('settings-ai');

  // Backups: a snapshot and a tracked item are explained with no DCS example.
  await page.getByTestId('nav-backups').click();
  await page.getByTestId('backups-tab-snapshots').click();
  await expect(page.getByTestId('snapshots-tab')).toContainText(
    'A named copy of one tracked item, for example before you change your bindings.'
  );
  await page.getByTestId('backups-tab-tracked').click();
  await page.getByTestId('tracked-add').click();
  const editor = page.getByTestId('item-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Use a variable such as {DOCUMENTS} or {SAVED_GAMES}');
  await expect(editor.getByTestId('item-label').locator('input')).toHaveAttribute(
    'placeholder',
    'e.g. Game settings'
  );
  await expect(editor.getByTestId('item-path').locator('input')).toHaveAttribute(
    'placeholder',
    '{DOCUMENTS}/My Game'
  );
  await expect(editor).not.toContainText('DCS');
  await shot('track-a-file');
  await editor.getByTestId('item-cancel').click();
  await expect(editor).toBeHidden();

  // Monitors: the example name of a layout is not a flying one alone.
  await page.getByTestId('nav-displays').click();
  await page.getByTestId('layout-save-open').click();
  await expect(page.getByTestId('layout-save-name').locator('input')).toHaveAttribute(
    'placeholder',
    'e.g. Racing or Flying'
  );
  await shot('save-layout');
  await page.locator('.v-overlay--active').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('layout-save-name')).toBeHidden();

  // The command palette, when nothing matches, offers a car as well as an aircraft.
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.getByTestId('palette-input').fill('qqqq');
  await expect(page.getByTestId('palette-none')).toHaveText(
    'Nothing matches “qqqq”. Try the name of a page, a setup, an aircraft or a car.'
  );
  await shot('palette-nothing');
});
