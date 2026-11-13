import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from './harness';

test('racing: Assetto Corsa controllers in another order are renumbered in controls.ini after a preview', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch('racing-ac-moved-controllers', 'racing-ac-repair');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-games').click();
  await page.getByTestId('game-card-racing').click();
  const card = page.locator('[data-testid="racing-game-card"][data-game="assetto-corsa"]');
  await expect(card).toContainText('2 controllers are at another number now');
  await card.click();

  const controllers = page.getByTestId('ac-controller');
  await expect(controllers).toHaveCount(2);
  await expect(controllers.nth(0)).toHaveAttribute('data-state', 'moved');
  await expect(controllers.nth(0).getByTestId('state-chip')).toHaveText('New Windows id');
  await expect(controllers.nth(1)).toHaveAttribute('data-state', 'reordered');
  await expect(controllers.nth(1).getByTestId('state-chip')).toHaveText('New number');
  await expect(controllers.nth(1)).toContainText("now number 0 in Windows' list");
  await expect(page.getByTestId('ac-repair-item')).toHaveCount(2);
  // Steering is stored on the DD2, but the number it names is the pedals now.
  const steering = page.locator('[data-testid="binding-row"]', { hasText: 'Steering' });
  await expect(steering.getByTestId('ac-acts-on')).toHaveText('Fanatec ClubSport Pedals V3');
  await shot('moved');

  await page.getByTestId('ac-repair').click();
  await expect(page.getByTestId('ac-repair-confirm')).toBeVisible();
  await expect(page.getByTestId('ac-repair-confirm')).toContainText('controls.ini');
  await expect(page.getByTestId('ac-repair-confirm')).toContainText('1 file modified');
  await expect(page.getByTestId('ac-unverified')).toContainText(
    'Not yet verified on real hardware'
  );
  await shot('confirm');
  await page.getByTestId('ac-repair-go').click();
  await expect(page.getByTestId('ac-message')).toContainText('Updated 8 bindings');
  await expect(controllers.nth(0)).toHaveAttribute('data-state', 'connected');
  await expect(controllers.nth(1)).toHaveAttribute('data-state', 'connected');
  await expect(page.getByTestId('ac-repair-panel')).toHaveCount(0);
  await shot('repaired');

  const ini = await fs.readFile(
    path.join(home, 'Documents', 'Assetto Corsa', 'cfg', 'controls.ini'),
    'utf8'
  );
  expect(ini).toContain('CON0=FANATEC Podium Wheel Base DD2');
  expect(ini).toContain('__IGUID1=5E6F7A80-1111-11F1-8003-444553540000');
  expect(ini).toMatch(/\[STEER\]\r?\nJOY=0\r?\n/);
  await page.getByTestId('nav-safety').click();
  await expect(page.locator('[data-testid="change-group"]').first()).toHaveAttribute(
    'data-reason',
    "Point Assetto Corsa's controls at Fanatec ClubSport Pedals V3, FANATEC Podium Wheel Base DD2 where Windows lists them now"
  );
  await shot('safety');
});
