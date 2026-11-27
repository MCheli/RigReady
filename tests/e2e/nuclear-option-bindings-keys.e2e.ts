import type { Locator } from '@playwright/test';
import { expect, test } from './harness';

/**
 * A key of the keyboard on fixtures/scenarios/nuclear-option-bindings.yaml: bound by pressing
 * it, changed with modifier keys, and cleared, each after a review and with Undo on the
 * Safety page. An axis action as a whole is not offered on the keyboard; its sides are.
 */
test('nuclear option bindings: a key is bound by pressing it, changed with modifier keys and cleared', async ({
  rig,
}) => {
  const run = await rig.launch('nuclear-option-bindings', 'nuclear-option-bindings-keys');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();
  await page
    .locator('[data-testid="nuclear-option-bindings-device"][data-device="Keyboard"]')
    .click();
  const rows = page.getByTestId('nuclear-option-bindings-row');
  const row = (action: string): Locator => rows.filter({ hasText: action });
  await expect(rows).toHaveCount(6);
  // The keyboard has no "Clear all"; its rows have Change and Clear.
  await expect(page.getByTestId('nuclear-option-bindings-clear-all')).toHaveCount(0);
  await expect(row('Toggle Gear').getByTestId('nuclear-option-bindings-change')).toHaveCount(1);
  const confirm = page.getByTestId('nuclear-option-bindings-edit-confirm');
  const go = page.getByTestId('nuclear-option-bindings-edit-go');
  const review = page.getByTestId('nuclear-option-bindings-edit-review');
  const key = page.getByTestId('nuclear-option-bindings-edit-key');
  const saved = page.getByTestId('nuclear-option-bindings-saved');
  const action = page.getByTestId('nuclear-option-bindings-edit-action').locator('input');

  // 1. An axis as a whole is not offered on the keyboard; its two sides are.
  await page.getByTestId('nuclear-option-bindings-bind').click();
  await expect(confirm).toBeVisible();
  await action.click();
  await page.keyboard.type('Zoom');
  await expect(page.getByRole('option', { name: 'Zoom In', exact: true })).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'Zoom Out', exact: true })).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'Zoom View', exact: true })).toHaveCount(0);

  // 2. An action with no key, bound by pressing the key once "Press the key" is on.
  await action.fill('Toggle Engine');
  await page.getByRole('option', { name: 'Toggle Engine', exact: true }).click();
  await expect(confirm).toContainText('Bind Toggle Engine to a key?');
  await expect(go).toBeDisabled();
  await page.getByTestId('nuclear-option-bindings-edit-press-key').click();
  await expect(page.getByTestId('nuclear-option-bindings-edit-press-key')).toContainText(
    'Press the key now'
  );
  await page.keyboard.press('F7');
  await expect(key).toContainText('F7');
  await expect(review).toContainText('Toggle Engine');
  await expect(review).toContainText('Not bound');
  await expect(review).toContainText('F7');
  await expect(confirm).toContainText('Nuclear Option’s saved bindings for the keyboard');
  await expect(go).toBeEnabled();
  await shot('pressed');
  await go.click();
  await expect(saved).toHaveText(
    /Saved: Toggle Engine is now on F7 of the keyboard\. Undo is on the Safety page\./
  );
  await expect(rows).toHaveCount(7);
  await expect(row('Toggle Engine')).toContainText('F7');

  // 3. Changed from its row to a key with modifier keys that Eject already has: said first.
  await row('Toggle Engine').getByTestId('nuclear-option-bindings-change').click();
  await expect(confirm).toContainText('Bind Toggle Engine to a key?');
  await key.locator('input').click();
  await page.keyboard.type('E');
  await page.getByRole('option', { name: 'E', exact: true }).click();
  await page.getByTestId('nuclear-option-bindings-edit-ctrl').locator('input').check();
  await page.getByTestId('nuclear-option-bindings-edit-shift').locator('input').check();
  await expect(review).toContainText('Ctrl + Shift + E');
  await expect(review).toContainText('That key already does Eject. One press will do both.');
  await shot('modifiers');
  // Without Shift it is another binding, and nothing else has it.
  await page.getByTestId('nuclear-option-bindings-edit-shift').locator('input').uncheck();
  await expect(review).toContainText('Ctrl + E');
  await expect(review).not.toContainText('already does');
  await go.click();
  await expect(saved).toHaveText(/Saved: Toggle Engine is now on Ctrl \+ E of the keyboard\./);
  await expect(row('Toggle Engine')).toContainText('Ctrl + E');

  // 4. Cleared from its row.
  await row('Toggle Engine').getByTestId('nuclear-option-bindings-clear').click();
  await expect(confirm).toContainText('Clear Toggle Engine?');
  await go.click();
  await expect(saved).toHaveText(/Saved: Toggle Engine is no longer bound on the keyboard\./);
  await expect(rows).toHaveCount(6);

  // 5. Each is one entry on the Safety page.
  await page.getByTestId('nav-safety').click();
  await expect(page.getByTestId('safety-page')).toBeVisible();
  for (const reason of [
    'Nuclear Option bindings: Toggle Engine bound to F7 on the keyboard',
    'Nuclear Option bindings: Toggle Engine bound to Ctrl + E on the keyboard',
    'Nuclear Option bindings: Toggle Engine cleared on the keyboard',
  ]) {
    await expect(
      page.locator(`[data-testid="change-group"][data-reason="${reason}"]`),
      reason
    ).toHaveCount(1);
  }
  await shot('safety-page');
});
