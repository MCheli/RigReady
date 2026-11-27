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

let clock = 20_000;
/** A controller with the given buttons held (the first is 1), the rest at rest. */
const stateOf = (c: Controller, buttons: number[] = []) => ({
  index: c.index,
  name: c.name,
  axes: Array.from({ length: c.numAxes }, () => 0),
  buttons: Array.from({ length: c.numButtons }, (_, i) => buttons.includes(i + 1)),
  hats: Array.from({ length: c.numHats }, (): [number, number] => [0, 0]),
  timestamp: clock++,
});

/**
 * Changing a Nuclear Option binding on fixtures/scenarios/nuclear-option-bindings.yaml:
 * the change is shown first, Save writes it into what the game saved (the fake registry),
 * the Safety page lists it, Undo puts it back, and it is refused while the game runs.
 */
test('nuclear option bindings: bind, move and clear a button after a review, undo it, and refused while the game runs', async ({
  rig,
}) => {
  const run = await rig.launch('nuclear-option-bindings', 'nuclear-option-bindings-edit');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();
  await expect(page.getByTestId('nuclear-option-bindings-note')).toContainText(
    'writes nothing until you press Save'
  );
  await page
    .locator(
      '[data-testid="nuclear-option-bindings-device"][data-device="Joystick - HOTAS Warthog"]'
    )
    .click();
  const rows = page.getByTestId('nuclear-option-bindings-row');
  const row = (action: string): Locator => rows.filter({ hasText: action });
  await expect(rows).toHaveCount(7);
  // An axis has no Change: it is bound in the game.
  await expect(row('Pitch Axis').getByTestId('nuclear-option-bindings-change')).toHaveCount(0);
  await expect(row('Fire').getByTestId('nuclear-option-bindings-change')).toHaveCount(1);

  // 1. Bind an action that is not bound: nothing is written until Save.
  await page.getByTestId('nuclear-option-bindings-bind').click();
  const confirm = page.getByTestId('nuclear-option-bindings-edit-confirm');
  const go = page.getByTestId('nuclear-option-bindings-edit-go');
  await expect(confirm).toBeVisible();
  await expect(go).toBeDisabled();
  await page.getByTestId('nuclear-option-bindings-edit-action').locator('input').click();
  await page.keyboard.type('Navigation');
  await page.getByRole('option', { name: 'Toggle Navigation Lights' }).click();
  await expect(go).toBeDisabled();
  await page.getByTestId('nuclear-option-bindings-edit-button').locator('input').fill('1');
  const review = page.getByTestId('nuclear-option-bindings-edit-review');
  await expect(review).toContainText('Toggle Navigation Lights');
  await expect(review).toContainText('Not bound');
  await expect(review).toContainText('Button 1');
  await expect(review).toContainText('That button already does Fire. One press will do both.');
  await page.getByTestId('nuclear-option-bindings-edit-button').locator('input').fill('12');
  await expect(review).toContainText('Button 12');
  await expect(review).not.toContainText('already does');
  await expect(confirm).toContainText(
    'Nuclear Option’s saved bindings for Joystick - HOTAS Warthog'
  );
  await expect(confirm).toContainText('Each file is backed up first; Undo is on the Safety page.');
  await expect(go).toBeEnabled();
  await shot('review');
  await expect(rows).toHaveCount(7);
  await go.click();
  await expect(page.getByTestId('nuclear-option-bindings-saved')).toHaveText(
    /Saved: Toggle Navigation Lights is now on Button 12 of Joystick - HOTAS Warthog\. Undo is on the Safety page\./
  );
  await expect(rows).toHaveCount(8);
  await expect(row('Toggle Navigation Lights')).toContainText('Button 12');
  await expect(row('Toggle Navigation Lights')).toContainText('Button 11');
  await shot('saved');

  // 2. Move a binding from its row, choosing the button by pressing it. A press on another
  //    controller is said to be elsewhere and changes nothing.
  const all = await controllers(page);
  const stick = all.find((c) => c.name === 'Joystick - HOTAS Warthog')!;
  const throttle = all.find((c) => c.name === 'Throttle - HOTAS Warthog')!;
  await row('Next Weapon').getByTestId('nuclear-option-bindings-change').click();
  await expect(confirm).toContainText('Bind Next Weapon to a button?');
  await expect(confirm).toContainText('Press the button on the controller, or type its number.');
  await run.sendInput([stateOf(stick), stateOf(throttle)]);
  await run.sendInput([stateOf(throttle, [4])]);
  await expect(page.getByTestId('nuclear-option-bindings-edit-elsewhere')).toHaveText(
    'That was Button 4 on Throttle - HOTAS Warthog. This change is for Joystick - HOTAS Warthog.'
  );
  await expect(go).toBeDisabled();
  await run.sendInput([stateOf(throttle)]);
  await run.sendInput([stateOf(stick, [9])]);
  await expect(
    page.getByTestId('nuclear-option-bindings-edit-button').locator('input')
  ).toHaveValue('9');
  await expect(page.getByTestId('nuclear-option-bindings-edit-elsewhere')).toHaveCount(0);
  await expect(review).toContainText('Button 3');
  await expect(review).toContainText('Button 9');
  await shot('pressed');
  await run.sendInput([stateOf(stick)]);
  await go.click();
  await expect(row('Next Weapon')).toContainText('Button 9');

  // 3. Clear one, and Cancel leaves another as it is.
  await row('Open Radial Menu').getByTestId('nuclear-option-bindings-clear').click();
  await expect(confirm).toContainText('Clear Open Radial Menu?');
  await expect(review).toContainText('Not bound');
  await go.click();
  await expect(row('Open Radial Menu')).toHaveCount(0);
  await row('Fire').getByTestId('nuclear-option-bindings-clear').click();
  await page.getByTestId('nuclear-option-bindings-edit-cancel').click();
  await expect(confirm).toBeHidden();
  await expect(row('Fire')).toHaveCount(1);
  await expect(rows).toHaveCount(7);

  // 4. Each change is one entry on the Safety page, and Undo puts the saved bindings back.
  await page.getByTestId('nav-safety').click();
  await expect(page.getByTestId('safety-page')).toBeVisible();
  const group = (reason: string): Locator =>
    page.locator(`[data-testid="change-group"][data-reason="${reason}"]`);
  await expect(
    group(
      'Nuclear Option bindings: Toggle Navigation Lights bound to Button 12 on Joystick - HOTAS Warthog'
    )
  ).toHaveCount(1);
  await expect(
    group('Nuclear Option bindings: Next Weapon bound to Button 9 on Joystick - HOTAS Warthog')
  ).toHaveCount(1);
  const cleared = group(
    'Nuclear Option bindings: Open Radial Menu cleared on Joystick - HOTAS Warthog'
  );
  await cleared.getByTestId('change-toggle').click();
  await expect(cleared.getByTestId('change-file')).toContainText('.regvalue');
  await shot('safety-page');
  await cleared.getByTestId('change-undo').click();
  await expect(page.getByTestId('safety-message')).toContainText(
    'Undid "Nuclear Option bindings: Open Radial Menu cleared on Joystick - HOTAS Warthog"'
  );
  await page.getByTestId('nav-bindings').click();
  await page
    .locator(
      '[data-testid="nuclear-option-bindings-device"][data-device="Joystick - HOTAS Warthog"]'
    )
    .click();
  await expect(row('Open Radial Menu')).toContainText('Button 4');
  await expect(rows).toHaveCount(8);

  // 5. While the game runs the review says why, and Save is off.
  await run.mutate([
    { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
  ]);
  await row('Fire').getByTestId('nuclear-option-bindings-change').click();
  await page.getByTestId('nuclear-option-bindings-edit-button').locator('input').fill('15');
  await expect(page.getByTestId('nuclear-option-bindings-edit-blocked')).toContainText(
    'Close Nuclear Option first'
  );
  await expect(go).toBeDisabled();
  await shot('blocked');
  await page.getByTestId('nuclear-option-bindings-edit-cancel').click();
  await expect(row('Fire')).toContainText('Button 1');
});
