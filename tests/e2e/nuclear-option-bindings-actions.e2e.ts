import type { Locator } from '@playwright/test';
import { expect, test } from './harness';

/**
 * Every action of Nuclear Option in one list with each place it is bound, on
 * fixtures/scenarios/nuclear-option-bindings.yaml: what is on more than one controller is
 * marked, and a place leads to its device, where it is changed or cleared.
 */
test('nuclear option bindings: every action with where it is bound, those on several controllers marked, and a place leads to its device', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch(
    'nuclear-option-bindings',
    'nuclear-option-bindings-actions'
  );
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();
  const action = (name: string): Locator =>
    page.locator(`[data-testid="nuclear-option-bindings-action-row"][data-action="${name}"]`);
  const actions = page.getByTestId('nuclear-option-bindings-action-row');
  const search = page.getByTestId('nuclear-option-bindings-action-search').locator('input');

  await page.getByTestId('nuclear-option-bindings-by-action').click();
  // Bound and unbound alike.
  await expect(action('Fire')).toContainText('Joystick - HOTAS Warthog · Button 1');
  await expect(action('Fire')).toContainText('Keyboard · Space');
  await expect(action('Pitch Axis')).toContainText('Joystick - HOTAS Warthog · Y axis · reversed');
  await expect(action('Toggle Navigation Lights')).toContainText('Not bound');
  // The gear is on the throttle only: one controller, no mark.
  await expect(action('Toggle Gear').getByTestId('nuclear-option-bindings-several')).toHaveCount(0);
  await expect(page.getByTestId('nuclear-option-bindings-several-count')).toHaveText(
    'No action is on more than one controller'
  );
  // The pedals are not plugged in, and their place says so.
  await expect(action('Yaw Axis')).toContainText('T-Rudder · Z axis (not plugged in)');
  await shot('all-actions');

  // A search looks in the devices and the inputs too.
  await search.fill('throttle button');
  // The gear, eject, the two zooms, and an action a game update added, by its number.
  await expect(actions).toHaveCount(5);
  await expect(action('Action 99')).toContainText('Throttle - HOTAS Warthog · Button 9');
  await search.fill('nothing like it');
  await expect(page.getByTestId('nuclear-option-bindings-actions-none')).toBeVisible();
  await search.fill('');

  // The same action bound on a second controller, as the game does by itself: it is marked.
  await page
    .locator(
      '[data-testid="nuclear-option-bindings-device"][data-device="Throttle - HOTAS Warthog"]'
    )
    .click();
  await page.getByTestId('nuclear-option-bindings-bind').click();
  const dialog = page.getByTestId('nuclear-option-bindings-edit-confirm');
  await expect(dialog).toBeVisible();
  await page.getByTestId('nuclear-option-bindings-edit-action').locator('input').click();
  await page.keyboard.type('Fire');
  await page.getByRole('option', { name: 'Fire', exact: true }).click();
  await page.getByTestId('nuclear-option-bindings-edit-button').locator('input').fill('5');
  await expect(page.getByTestId('nuclear-option-bindings-edit-go')).toBeEnabled();
  await page.getByTestId('nuclear-option-bindings-edit-go').click();
  await expect(page.getByTestId('nuclear-option-bindings-saved')).toContainText('Saved: Fire');

  await page.getByTestId('nuclear-option-bindings-by-action').click();
  await expect(action('Fire').getByTestId('nuclear-option-bindings-several')).toHaveText(
    'On 2 controllers'
  );
  await expect(page.getByTestId('nuclear-option-bindings-several-count')).toHaveText(
    '1 action is on more than one controller'
  );
  await page.getByTestId('nuclear-option-bindings-only-several').locator('input').check();
  await expect(actions).toHaveCount(1);
  await shot('on-several');

  // The list's search is its own: the device's box is as it was.
  // A place leads to its device with the action in the search box: Change and Clear are there.
  await action('Fire')
    .getByTestId('nuclear-option-bindings-place')
    .filter({ hasText: 'Throttle - HOTAS Warthog' })
    .click();
  await expect(page.getByTestId('nuclear-option-bindings-device-title')).toHaveText(
    'Throttle - HOTAS Warthog'
  );
  await expect(page.getByTestId('nuclear-option-bindings-row')).toHaveCount(1);
  await expect(page.getByTestId('nuclear-option-bindings-row')).toContainText('Button 5');
  await expect(page.getByTestId('nuclear-option-bindings-clear')).toBeVisible();
  await shot('place-opened');
});
