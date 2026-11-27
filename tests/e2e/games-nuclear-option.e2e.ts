import { expect, test } from './harness';

/**
 * Nuclear Option on a generic PC that has it in Steam
 * (fixtures/scenarios/games-nuclear-option.yaml): the Games page lists it as found, and its
 * page shows where it was found, says that its settings are in the registry, and launches it.
 */
test('games: Nuclear Option is found in Steam, launched, and says where its settings are', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('games-nuclear-option', 'games-nuclear-option');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-games').click();
  const row = page.locator('[data-testid="game-row"][data-game="nuclear-option"]');
  await expect(row).toContainText('Nuclear Option');
  await expect(row).toContainText('Build 20000021');
  await expect(row).not.toContainText('worth backing up');
  await shot('games');

  await row.click();
  await expect(page.getByTestId('game-title')).toHaveText('Nuclear Option');
  await expect(page.getByTestId('game-glance')).toContainText('Steam');
  await expect(page.locator('[data-testid="game-tracked"]')).toHaveCount(0);
  await expect(page.locator('.rr-page')).toContainText('Nuclear Option has no settings file');
  await expect(page.locator('.rr-page')).not.toContainText('start the game once');
  await expect(page.locator('.rr-page')).toContainText('in the Windows registry, not in files');
  await page.getByTestId('game-launch').click();
  await expect(page.getByTestId('game-message')).toHaveText('Asked Steam to start Nuclear Option.');
  await shot('nuclear-option');
});
