import { expect, test } from './harness';

/**
 * Nuclear Option's bindings on a generic PC with the game, a Warthog stick and throttle,
 * and the registry values the game saved (fixtures/scenarios/nuclear-option-bindings.yaml):
 * the Bindings page shows them per device, and a cheat sheet draws them.
 */
test('nuclear option bindings: each device’s bindings as the game saved them, and on a cheat sheet', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('nuclear-option-bindings', 'nuclear-option-bindings');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();

  // The one game with a bindings page on this PC, so Bindings opens it and the picker names it.
  await expect(page.getByTestId('nuclear-option-bindings-page')).toBeVisible();
  await expect(page.getByTestId('bindings-game')).toContainText('Nuclear Option');
  await expect(page.getByTestId('nuclear-option-bindings-note')).toContainText(
    'writes nothing until you press Save'
  );
  const devices = page.getByTestId('nuclear-option-bindings-device');
  await expect(devices).toHaveCount(5);
  await expect(devices.first()).toContainText('Throttle - HOTAS Warthog');

  const rows = page.getByTestId('nuclear-option-bindings-row');
  await expect(page.getByTestId('nuclear-option-bindings-device-title')).toHaveText(
    'Throttle - HOTAS Warthog'
  );
  await expect(page.getByTestId('nuclear-option-bindings-device-state')).toContainText(
    'Plugged in'
  );
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0)).toContainText('Throttle Axis');
  await expect(rows.nth(0)).toContainText('Z axis · reversed');
  await expect(rows.nth(2)).toContainText('Toggle Gear');
  await expect(rows.nth(2)).toContainText('Button 18');
  await expect(rows.nth(2)).toContainText('Button 17');
  await shot('throttle');

  await page
    .locator(
      '[data-testid="nuclear-option-bindings-device"][data-device="Joystick - HOTAS Warthog"]'
    )
    .click();
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(2)).toContainText('Fire');
  await expect(rows.nth(2)).toContainText('Button 1');
  await page.getByTestId('nuclear-option-bindings-search').locator('input').fill('target');
  await expect(rows).toHaveCount(2);
  await shot('stick-search');
  await page.getByTestId('nuclear-option-bindings-search').locator('input').fill('');

  // The pedals the game has bindings for are not plugged in: said so, and still shown.
  await page
    .locator('[data-testid="nuclear-option-bindings-device"][data-device="T-Rudder"]')
    .click();
  await expect(page.getByTestId('nuclear-option-bindings-device-state')).toContainText(
    'Not plugged in'
  );
  await expect(page.getByTestId('nuclear-option-bindings-unplugged')).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Yaw Axis');

  await page
    .locator('[data-testid="nuclear-option-bindings-device"][data-device="Keyboard"]')
    .click();
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(4)).toContainText('Eject');
  await expect(rows.nth(4)).toContainText('Ctrl + Shift + E');
  await shot('keyboard');

  // The command palette offers the page here, where the game is found.
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.type('nuclear option bindings');
  await expect(
    page.locator('[data-testid="palette-row"][data-to="/configure/nuclear-option-bindings"]')
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toBeHidden();

  // The cheat sheets draw the same bindings, through the reader this feature registers.
  await page.getByTestId('nuclear-option-bindings-cheat-sheet').click();
  await expect(page.locator('.rr-page')).toContainText('Nuclear Option');
  await expect(page.locator('.rr-page')).toContainText('Fire');
  await shot('cheat-sheet');
});
