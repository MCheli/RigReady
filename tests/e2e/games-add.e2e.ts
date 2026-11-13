import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, openOption, test } from './harness';

/**
 * "Add a game" (GAME-ADD-001 to GAME-ADD-006): a game RigReady does not know is added on the
 * Games page from its program and settings folder, chosen in the native pickers; it is then
 * on the Games page, in a new setup and in the setup editor beside "Another game". A game
 * the user added is changed and removed, and its setup keeps working as "Another game"; a
 * shared setup for it arrives on a PC without it as "Another game", and says so.
 */

async function openEditor(page: Page, name: string): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  await page
    .locator(`[data-testid="profile-row"][data-name="${name}"]`)
    .getByTestId('profile-edit')
    .click();
  await expect(page.getByTestId('profile-edit-page')).toBeVisible();
}

const gameRow = (page: Page, id: string) =>
  page.locator(`[data-testid="game-row"][data-game="${id}"]`);

test('games: a game is added from its program and settings folder, and a new setup offers it beside Another game', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch('generic-custom-game', 'games-add-a-game', {
    dialogs: {
      open: [['Games/Star Hauler/StarHauler.exe'], ['C:\\'], ['Documents/Star Hauler']],
    },
  });
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-games').click();
  await page.getByTestId('games-add').click();
  const dialog = page.getByTestId('add-game-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('add-game-why')).toHaveText('Give the game a name.');
  await expect(dialog.getByTestId('add-game-save')).toBeDisabled();
  await shot('empty');

  // The program from the file picker names the game and the program that means it runs.
  await dialog.getByTestId('add-game-choose-program').click();
  await expect(dialog.getByTestId('add-game-program')).toContainText(
    path.join('Games', 'Star Hauler', 'StarHauler.exe')
  );
  await expect(dialog.getByTestId('add-game-name').locator('input')).toHaveValue('Star Hauler');
  await expect(dialog.getByTestId('add-game-processes')).toContainText('StarHauler.exe');
  // A whole drive is not a settings folder.
  await dialog.getByTestId('add-game-add-folder').click();
  await expect(dialog.getByTestId('add-game-error')).toContainText(
    'RigReady cannot use C:\\: it is a whole drive.'
  );
  await expect(dialog.getByTestId('add-game-folder')).toHaveCount(0);
  await shot('folder-refused');
  await dialog.getByTestId('add-game-add-folder').click();
  await expect(dialog.getByTestId('add-game-folder')).toContainText(
    path.join('Documents', 'Star Hauler')
  );
  await dialog.getByTestId('add-game-kind-flight').locator('input').check();
  await expect(dialog.getByTestId('add-game-save')).toBeEnabled();
  await shot('filled');
  await dialog.getByTestId('add-game-save').click();

  await expect(page.getByTestId('games-message')).toHaveText(
    'Added Star Hauler, found on this PC.'
  );
  const row = gameRow(page, 'user-star-hauler');
  await expect(row).toContainText('Added by you');
  await expect(row).toContainText('Standalone');
  await expect(row).toContainText('1 settings file worth backing up');
  await shot('games');
  const stored = JSON.parse(await fs.readFile(path.join(dataRoot, 'games', 'custom.json'), 'utf8'));
  expect(stored.games).toEqual([
    {
      id: 'user-star-hauler',
      name: 'Star Hauler',
      kind: 'flight',
      program: '{USER}/Games/Star Hauler/StarHauler.exe',
      settingsFolders: ['{DOCUMENTS}/Star Hauler'],
      processes: ['StarHauler.exe'],
    },
  ]);

  await row.click();
  await expect(page.getByTestId('game-title')).toHaveText('Star Hauler');
  await expect(page.getByTestId('game-page').locator('.rr-page-sub')).toContainText(
    'Flight · added by you · found on this PC'
  );
  await expect(page.getByTestId('game-glance')).toContainText('StarHauler.exe');
  await expect(page.locator('[data-testid="game-tracked"]')).toHaveCount(1);
  await expect(page.getByTestId('game-edit')).toBeVisible();
  await expect(page.getByTestId('game-launch')).toBeEnabled();
  await shot('game');

  // A new setup offers it, last of the games found and beside "Another game".
  await page.getByTestId('mode-fly').click();
  await page.getByTestId('fly-create').click();
  const tiles = page.getByTestId('capture-game').locator('[data-testid^="capture-game-"]');
  await expect(page.getByTestId('capture-game-user-star-hauler')).toContainText('added by you');
  const order = await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(order.slice(-3)).toEqual([
    'capture-game-user-star-hauler',
    'capture-game-other',
    'capture-game-none',
  ]);
  await page.getByTestId('capture-game-user-star-hauler').click();
  await expect(page.getByTestId('capture-name').locator('input')).toHaveValue('Star Hauler');
  await expect(page.getByTestId('capture-launch')).toContainText('StarHauler.exe');
  await shot('capture');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('profile-switcher')).toContainText('Star Hauler');
  await expect(page.getByTestId('fly-status-title')).toBeVisible();
  await shot('play');
  const setup = await fs.readFile(path.join(dataRoot, 'profiles', 'star-hauler.yaml'), 'utf8');
  expect(setup).toContain('game: user-star-hauler');

  // The setup editor lists it beside "Other game…".
  await openEditor(page, 'Star Hauler');
  await expect(page.getByTestId('edit-game')).toContainText('Star Hauler (added by you)');
  await page.getByTestId('edit-game').click();
  await expect(openOption(page, 'Star Hauler (added by you)')).toBeVisible();
  const options = await page
    .locator('.v-overlay--active')
    .getByRole('option')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
  expect(options.slice(-2)).toEqual(['Star Hauler (added by you)', 'Other game…']);
  await shot('editor');
  await page.keyboard.press('Escape');
});

test('games: a game the user added is changed and removed, and its setup keeps working as Another game', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch(
    'games-own-star-hauler',
    'games-own-change-remove'
  );
  await expect(page.getByTestId('profile-switcher')).toContainText('Star Hauler');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-games').click();
  // The hand-edited file: what could not be used is left out, and said.
  await expect(page.getByTestId('games-own-problem')).toContainText(
    'A game in custom.json was left out: it is not a game RigReady can read.'
  );
  await expect(gameRow(page, 'user-star-hauler')).toContainText('Added by you');
  await expect(gameRow(page, 'user-star-hauler')).toContainText(
    'The settings folder C:\\ is not used: it is a whole drive.'
  );
  await shot('games');

  await gameRow(page, 'user-star-hauler').click();
  await expect(page.getByTestId('game-title')).toHaveText('Star Hauler');
  await page.getByTestId('game-edit').click();
  const dialog = page.getByTestId('add-game-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('add-game-folder')).toHaveCount(1);
  await dialog.getByTestId('add-game-name').locator('input').fill('Star Hauler Deluxe');
  await dialog.getByTestId('add-game-kind-racing').locator('input').check();
  await shot('change');
  await dialog.getByTestId('add-game-save').click();
  await expect(page.getByTestId('game-message')).toHaveText(
    'Saved the changes to Star Hauler Deluxe.'
  );
  await expect(page.getByTestId('game-title')).toHaveText('Star Hauler Deluxe');
  await shot('changed');

  await page.getByTestId('game-remove').click();
  const ask = page.getByTestId('game-remove-dialog');
  await expect(ask).toBeVisible();
  await expect(ask.getByTestId('game-remove-used')).toContainText(
    'This setup is for it: Star Hauler. It keeps working, as a setup for “Another game” called Star Hauler Deluxe'
  );
  await shot('remove-asks');
  await ask.getByTestId('game-remove-go').click();
  await expect(page.getByTestId('game-removed-setups')).toContainText(
    'Star Hauler is now a setup for “Another game” called Star Hauler Deluxe'
  );
  await shot('removed');

  const setup = await fs.readFile(
    path.join(dataRoot, 'profiles', 'games-star-hauler.yaml'),
    'utf8'
  );
  expect(setup).toContain('game: other');
  expect(setup).toContain('gameName: Star Hauler Deluxe');
  expect(setup).toContain('{DOCUMENTS}/Star Hauler/settings.ini');
  await page.getByTestId('nav-games').click();
  await expect(page.getByTestId('games-page')).toBeVisible();
  await expect(gameRow(page, 'user-star-hauler')).toHaveCount(0);

  // The setup checks and launches as before.
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('launch')).toBeEnabled();
  await shot('play');
  await openEditor(page, 'Star Hauler');
  await expect(page.getByTestId('edit-game')).toContainText('Other game…');
  await expect(page.getByTestId('edit-game-name').locator('input')).toHaveValue(
    'Star Hauler Deluxe'
  );
  await shot('editor');
  await page.getByTestId('edit-cancel').click();

  // "Add a game" in the command palette opens the dialog on the Games page.
  await page.getByTestId('mode-fly').click();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.type('Add a game');
  await expect(
    page.locator('[data-testid="palette-row"][aria-selected="true"] .rr-palette-title')
  ).toHaveText('Add a game');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('add-game-dialog')).toBeVisible();
  await expect(page.getByTestId('games-page')).toBeVisible();
  await expect(page.getByTestId('add-game-why')).toHaveText('Give the game a name.');
  await shot('palette-add');
  await page.getByTestId('add-game-cancel').click();
  await expect(page.getByTestId('add-game-dialog')).toBeHidden();
});

test('games: a shared setup for a game added by hand arrives on a PC without it as Another game, and the import says so', async ({
  rig,
}) => {
  test.setTimeout(180_000);
  const owner = await rig.launch('games-own-star-hauler', 'games-share-own-export', {
    dialogs: { save: ['Documents/Star Hauler.rigready'] },
  });
  await owner.page.getByTestId('mode-configure').click();
  await owner.page.getByTestId('nav-share').click();
  await expect(owner.page.getByTestId('share-setup')).toContainText('Star Hauler');
  await owner.page.getByTestId('share-reviewed').locator('input').check();
  await owner.page.getByTestId('share-save').click();
  await expect(owner.page.getByTestId('share-saved')).toContainText('Star Hauler.rigready');
  const file = path.join(owner.home, 'Documents', 'Star Hauler.rigready');

  const friend = await rig.launch('generic-fresh', 'games-share-own-import', {
    dialogs: { open: [[file]] },
  });
  const p = friend.page;
  await p.getByTestId('mode-configure').click();
  await p.getByTestId('nav-share').click();
  await p.getByTestId('share-mode-import').click();
  await p.getByTestId('import-open').click();
  await expect(p.getByTestId('import-compat')).toBeVisible();
  const game = p.locator('[data-testid="import-software"]').filter({ hasText: 'Star Hauler' });
  await expect(game).toContainText(
    'Added by hand on the other PC: the setup comes in for “Another game”'
  );
  await expect(p.locator('[data-testid="import-part"][data-part="profile"]')).toContainText(
    'for “Another game” called Star Hauler, a game added by hand on the other PC'
  );
  await game.scrollIntoViewIfNeeded();
  await friend.shot('report');
  await p.getByTestId('import-apply').click();
  await expect(p.getByTestId('import-result-summary')).toContainText('Added the setup');

  await openEditor(p, 'Star Hauler');
  await expect(p.getByTestId('edit-game')).toContainText('Other game…');
  await expect(p.getByTestId('edit-game-name').locator('input')).toHaveValue('Star Hauler');
  await friend.shot('imported');
});
