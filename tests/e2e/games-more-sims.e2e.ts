import { expect, test } from './harness';

/**
 * The game modules added in November 2026 on a generic PC that has them
 * (fixtures/scenarios/generic-more-sims.yaml): the Games page lists them as found, and a
 * game page shows where it was found, what Launch starts and what is worth backing up.
 */
test('games: the flight and racing sims added in November 2026 are found on a fixture rig', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('generic-more-sims', 'games-more-sims');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-games').click();
  const row = (id: string) => page.locator(`[data-testid="game-row"][data-game="${id}"]`);
  for (const id of [
    'msfs2020',
    'x-plane-12',
    'x-plane-11',
    'il2-great-battles',
    'falcon-bms',
    'acc',
    'rfactor2',
    'ams2',
    'ea-wrc',
    'f1-25',
    'dirt-rally-2',
    'raceroom',
  ]) {
    await expect(row(id)).toContainText('worth backing up');
  }
  await expect(row('falcon-bms')).toContainText('4.38');
  await expect(row('f1-24')).not.toContainText('worth backing up');
  await shot('games');

  await row('falcon-bms').click();
  await expect(page.getByTestId('game-title')).toHaveText('Falcon BMS');
  await expect(page.getByTestId('game-glance')).toContainText('Launcher.exe');
  await expect(page.locator('[data-testid="game-tracked"]')).toHaveCount(5);
  await shot('falcon-bms');

  await page.getByTestId('nav-games').click();
  await row('acc').click();
  await expect(page.getByTestId('game-title')).toHaveText('Assetto Corsa Competizione');
  await expect(page.locator('[data-testid="game-tracked"]')).toHaveCount(4);
  await page.getByTestId('game-launch').click();
  await expect(page.getByTestId('game-message')).toHaveText(
    'Asked Steam to start Assetto Corsa Competizione.'
  );
  await shot('acc');
});
