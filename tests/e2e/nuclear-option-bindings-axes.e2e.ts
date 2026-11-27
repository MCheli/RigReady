import type { Locator, Page } from '@playwright/test';
import { expect, test } from './harness';

interface Controller {
  index: number;
  name: string;
  guid: string;
  numAxes: number;
  numButtons: number;
  numHats: number;
}

/** The plugged-in controllers, asked of the app as a page asks. */
const controllers = async (page: Page): Promise<Controller[]> =>
  (
    (await page.evaluate(() =>
      (
        globalThis as unknown as {
          rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
        }
      ).rigready.invoke('devices:inputDevices', undefined)
    )) as { value?: Controller[] }
  ).value ?? [];

let clock = 30_000;
/** A controller with the given axes moved (the first is 0) and buttons held, the rest at rest. */
const stateOf = (c: Controller, axes: number[] = [], buttons: number[] = []) => ({
  index: c.index,
  name: c.name,
  axes: Array.from({ length: c.numAxes }, (_, i) => axes[i] ?? 0),
  buttons: Array.from({ length: c.numButtons }, (_, i) => buttons.includes(i + 1)),
  hats: Array.from({ length: c.numHats }, (): [number, number] => [0, 0]),
  timestamp: clock++,
});

/**
 * An axis of a controller, and a button on one side of an axis action, on
 * fixtures/scenarios/nuclear-option-bindings.yaml: reversed, bound by moving the axis, bound to
 * one side by its own name, and cleared, each after a review and with Undo on the Safety page.
 */
test('nuclear option bindings: an axis is reversed, bound by moving it and cleared, and a button goes on one side of an axis', async ({
  rig,
}) => {
  const run = await rig.launch('nuclear-option-bindings', 'nuclear-option-bindings-axes');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();
  await page
    .locator(
      '[data-testid="nuclear-option-bindings-device"][data-device="Joystick - HOTAS Warthog"]'
    )
    .click();
  const rows = page.getByTestId('nuclear-option-bindings-row');
  const row = (action: string): Locator => rows.filter({ hasText: action });
  await expect(rows).toHaveCount(7);
  const confirm = page.getByTestId('nuclear-option-bindings-edit-confirm');
  const go = page.getByTestId('nuclear-option-bindings-edit-go');
  const review = page.getByTestId('nuclear-option-bindings-edit-review');
  const axis = page.getByTestId('nuclear-option-bindings-edit-axis');
  const invert = page.getByTestId('nuclear-option-bindings-edit-invert').locator('input');
  const saved = page.getByTestId('nuclear-option-bindings-saved');

  // 1. Pitch Axis is on the Y axis, reversed. Its row opens on what it has: one tick turns it.
  await expect(row('Pitch Axis')).toContainText('reversed');
  await row('Pitch Axis').getByTestId('nuclear-option-bindings-change').click();
  await expect(confirm).toContainText('Bind Pitch Axis to an axis?');
  await expect(axis).toContainText('Y axis');
  await expect(invert).toBeChecked();
  await expect(review).toContainText('That is how it is now: nothing to save.');
  await expect(go).toBeDisabled();
  await invert.uncheck();
  await expect(review).toContainText('Y axis, reversed');
  await expect(review).not.toContainText('nothing to save');
  await expect(go).toBeEnabled();
  await shot('reverse');
  await go.click();
  await expect(saved).toHaveText(
    /Saved: Pitch Axis is now on Y axis of Joystick - HOTAS Warthog\. Undo is on the Safety page\./
  );
  await expect(row('Pitch Axis')).not.toContainText('reversed');

  // 2. An axis action with nothing on this controller, bound by moving the axis. The axis
  //    already rolls the aircraft, and the review says so.
  const all = await controllers(page);
  const stick = all.find((c) => c.name === 'Joystick - HOTAS Warthog')!;
  const throttle = all.find((c) => c.name === 'Throttle - HOTAS Warthog')!;
  await page.getByTestId('nuclear-option-bindings-bind').click();
  await page.getByTestId('nuclear-option-bindings-edit-action').locator('input').click();
  await page.keyboard.type('Yaw');
  await page.getByRole('option', { name: 'Yaw Axis', exact: true }).click();
  await expect(confirm).toContainText('Bind Yaw Axis to an axis?');
  await expect(confirm).toContainText('Move the axis on the controller, or choose it here.');
  await expect(go).toBeDisabled();
  await run.sendInput([stateOf(stick), stateOf(throttle)]);
  // Another controller's axis is not taken, and the dialog says whose it was.
  await run.sendInput([stateOf(throttle, [1])]);
  await expect(page.getByTestId('nuclear-option-bindings-edit-elsewhere')).toHaveText(
    'That was an axis on Throttle - HOTAS Warthog. This change is for Joystick - HOTAS Warthog.'
  );
  await run.sendInput([stateOf(throttle)]);
  await run.sendInput([stateOf(stick, [1])]);
  await expect(axis).toContainText('X axis');
  await expect(review).toContainText('Not bound');
  await expect(review).toContainText(
    'That axis already does Roll Axis. One movement will do both.'
  );
  await shot('moved');
  await run.sendInput([stateOf(stick)]);
  await go.click();
  await expect(saved).toHaveText(/Saved: Yaw Axis is now on X axis of Joystick - HOTAS Warthog\./);
  await expect(rows).toHaveCount(8);
  await expect(row('Yaw Axis')).toContainText('X axis');

  // 3. One side of an axis action goes on a button, under the side's own name.
  await page.getByTestId('nuclear-option-bindings-bind').click();
  await page.getByTestId('nuclear-option-bindings-edit-action').locator('input').click();
  await page.keyboard.type('Zoom');
  await page.getByRole('option', { name: 'Zoom In', exact: true }).click();
  await expect(confirm).toContainText('Bind Zoom In to a button?');
  await page.getByTestId('nuclear-option-bindings-edit-button').locator('input').fill('20');
  await expect(review).toContainText('Zoom In');
  await expect(review).toContainText('Button 20');
  await shot('side');
  await go.click();
  await expect(saved).toHaveText(
    /Saved: Zoom In is now on Button 20 of Joystick - HOTAS Warthog\./
  );
  await expect(row('Zoom In')).toContainText('Button 20');
  await expect(row('Zoom In').getByTestId('nuclear-option-bindings-change')).toHaveCount(1);

  // 4. An axis is cleared from its row.
  await row('Yaw Axis').getByTestId('nuclear-option-bindings-clear').click();
  await expect(confirm).toContainText('Clear Yaw Axis?');
  await expect(review).toContainText('X axis');
  await expect(review).toContainText('Not bound');
  await go.click();
  await expect(saved).toHaveText(
    /Saved: Yaw Axis is no longer bound on Joystick - HOTAS Warthog\./
  );
  await expect(row('Yaw Axis')).toHaveCount(0);
  await expect(rows).toHaveCount(8);

  // 5. Each is one entry on the Safety page.
  await page.getByTestId('nav-safety').click();
  await expect(page.getByTestId('safety-page')).toBeVisible();
  for (const reason of [
    'Nuclear Option bindings: Pitch Axis bound to Y axis on Joystick - HOTAS Warthog',
    'Nuclear Option bindings: Yaw Axis bound to X axis on Joystick - HOTAS Warthog',
    'Nuclear Option bindings: Zoom In bound to Button 20 on Joystick - HOTAS Warthog',
    'Nuclear Option bindings: Yaw Axis cleared on Joystick - HOTAS Warthog',
  ]) {
    await expect(
      page.locator(`[data-testid="change-group"][data-reason="${reason}"]`),
      reason
    ).toHaveCount(1);
  }
  await shot('safety-page');
});
