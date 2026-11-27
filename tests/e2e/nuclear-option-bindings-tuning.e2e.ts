import type { Locator } from '@playwright/test';
import { expect, test } from './harness';

/**
 * The axes of a controller tuned on fixtures/scenarios/nuclear-option-bindings.yaml: the dead
 * zones and the sensitivity the game saved in its calibration, shown for each axis, changed
 * after a review, one entry on the Safety page, and refused while the game runs.
 */
test('nuclear option bindings: the dead zones and the sensitivity of an axis are shown, changed after a review, and undone', async ({
  rig,
}) => {
  const run = await rig.launch('nuclear-option-bindings', 'nuclear-option-bindings-tuning');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();
  const tab = (name: string): Locator =>
    page.locator(`[data-testid="nuclear-option-bindings-device"][data-device="${name}"]`);
  const tune = page.getByTestId('nuclear-option-bindings-tune');
  const panel = page.getByTestId('nuclear-option-tuning');
  const row = (axis: string): Locator =>
    page.locator(`[data-testid="nuclear-option-tuning-row"][data-axis="${axis}"]`);
  const field = (axis: string, name: string): Locator =>
    row(axis).getByTestId(`nuclear-option-tuning-${name}`).locator('input');
  const confirm = page.getByTestId('nuclear-option-tuning-dialog-confirm');
  const go = page.getByTestId('nuclear-option-tuning-dialog-go');

  // The keyboard has no axes to tune.
  await tab('Keyboard').click();
  await expect(tune).toHaveCount(0);

  // 1. The stick's axes as the game saved them: X as the game sets a new controller up, Y
  //    as a player set it in the game's Calibrate window.
  await tab('Joystick - HOTAS Warthog').click();
  await tune.click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Axis tuning: Joystick - HOTAS Warthog');
  await expect(page.getByTestId('nuclear-option-tuning-row')).toHaveCount(2);
  await expect(field('X axis', 'dead-zone')).toHaveValue('10');
  await expect(field('X axis', 'upper')).toHaveValue('0');
  await expect(field('X axis', 'sensitivity')).toHaveValue('1');
  await expect(field('Y axis', 'dead-zone')).toHaveValue('5');
  await expect(field('Y axis', 'upper')).toHaveValue('2');
  await expect(field('Y axis', 'sensitivity')).toHaveValue('0.8');
  // Nothing to review until something differs.
  await expect(row('X axis').getByTestId('nuclear-option-tuning-review')).toBeDisabled();
  await shot('axes');

  // 2. A value the game's own window does not offer is not reviewed.
  await field('X axis', 'dead-zone').fill('85');
  await expect(row('X axis').getByTestId('nuclear-option-tuning-invalid')).toBeVisible();
  await expect(row('X axis').getByTestId('nuclear-option-tuning-review')).toBeDisabled();

  // 3. The review: before and after in words, and nothing written yet.
  await field('X axis', 'dead-zone').fill('3');
  await field('X axis', 'sensitivity').fill('0.75');
  await row('X axis').getByTestId('nuclear-option-tuning-review').click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Tune X axis of Joystick - HOTAS Warthog?');
  await expect(page.getByTestId('nuclear-option-tuning-change')).toContainText(
    'dead zone 10 %, upper dead zone 0 %, sensitivity 1'
  );
  await expect(page.getByTestId('nuclear-option-tuning-change')).toContainText(
    'dead zone 3 %, upper dead zone 0 %, sensitivity 0.75'
  );
  await expect(confirm).toContainText(
    'Nuclear Option’s saved calibration for Joystick - HOTAS Warthog'
  );
  await expect(go).toBeEnabled();
  await shot('review');
  await go.click();
  await expect(page.getByTestId('nuclear-option-bindings-saved')).toHaveText(
    /Saved: X axis of Joystick - HOTAS Warthog now has dead zone 3 %, upper dead zone 0 %, sensitivity 0\.75\. Undo is on the Safety page\./
  );
  await expect(page.getByTestId('nuclear-option-tuning-saved')).toContainText(
    'Saved: X axis of Joystick - HOTAS Warthog now has dead zone 3 %'
  );
  // The panel reads the calibration again: the row is what was saved, and has nothing to review.
  await expect(field('X axis', 'dead-zone')).toHaveValue('3');
  await expect(field('X axis', 'sensitivity')).toHaveValue('0.75');
  await expect(row('X axis').getByTestId('nuclear-option-tuning-review')).toBeDisabled();
  await shot('saved');

  // 4. While the game runs the review says why, and Save is off.
  await run.mutate([
    { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
  ]);
  await field('Y axis', 'dead-zone').fill('8');
  await row('Y axis').getByTestId('nuclear-option-tuning-review').click();
  await expect(page.getByTestId('nuclear-option-tuning-blocked')).toContainText(
    'Close Nuclear Option first'
  );
  await expect(go).toBeDisabled();
  await shot('blocked');
  await page.getByTestId('nuclear-option-tuning-dialog-cancel').click();
  await run.mutate([{ op: 'stopProcess', name: 'NuclearOption.exe' }]);
  await page.getByTestId('nuclear-option-tuning-close').click();

  // 5. The throttle's calibration is an earlier build's: no upper dead zone to set, and its
  //    third axis is reversed in the game.
  await tab('Throttle - HOTAS Warthog').click();
  await tune.click();
  await expect(page.getByTestId('nuclear-option-tuning-row')).toHaveCount(5);
  await expect(row('Z axis')).toContainText("Reversed in the game's calibration");
  await expect(row('Z axis')).toContainText('Not in this calibration');
  await expect(row('Z axis').getByTestId('nuclear-option-tuning-upper')).toHaveCount(0);
  await shot('older-calibration');
  await page.getByTestId('nuclear-option-tuning-close').click();

  // 6. One entry on the Safety page; its Undo puts the calibration back.
  await page.getByTestId('nav-safety').click();
  const group = page.locator(
    '[data-testid="change-group"][data-reason="Nuclear Option axis tuning: X axis of Joystick - HOTAS Warthog: dead zone 3 %, upper dead zone 0 %, sensitivity 0.75"]'
  );
  await expect(group).toBeVisible();
  await shot('safety-page');
  await group.getByTestId('change-undo').click();
  await page.getByTestId('nav-bindings').click();
  await tab('Joystick - HOTAS Warthog').click();
  await tune.click();
  await expect(field('X axis', 'dead-zone')).toHaveValue('10');
  await expect(field('X axis', 'sensitivity')).toHaveValue('1');
});
