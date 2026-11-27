import type { Locator } from '@playwright/test';
import { expect, test } from './harness';

/**
 * Every binding of one controller cleared at once, on
 * fixtures/scenarios/nuclear-option-bindings.yaml: the game binds every controller it finds,
 * and this takes one out of it. Shown first, one entry on the Safety page, Undo puts every
 * binding back, and it is refused while the game runs.
 */
test('nuclear option bindings: clear every binding of one controller after a review, and undo it', async ({
  rig,
}) => {
  const run = await rig.launch('nuclear-option-bindings', 'nuclear-option-bindings-clear-all');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();
  const tab = (name: string): Locator =>
    page.locator(`[data-testid="nuclear-option-bindings-device"][data-device="${name}"]`);
  const rows = page.getByTestId('nuclear-option-bindings-row');
  const clearAll = page.getByTestId('nuclear-option-bindings-clear-all');
  const confirm = page.getByTestId('nuclear-option-bindings-clear-all-dialog-confirm');
  const go = page.getByTestId('nuclear-option-bindings-clear-all-dialog-go');
  const review = page.getByTestId('nuclear-option-bindings-clear-all-review');

  // The keyboard has no "Clear all": only a controller's bindings are cleared here.
  await tab('Keyboard').click();
  await expect(clearAll).toHaveCount(0);

  await tab('Joystick - HOTAS Warthog').click();
  await expect(rows).toHaveCount(7);
  await tab('Throttle - HOTAS Warthog').click();
  await expect(rows).toHaveCount(8);

  // 1. The review: how many go, and that nothing else is touched. Nothing is written yet.
  await clearAll.click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Clear every binding on Throttle - HOTAS Warthog?');
  await expect(review).toContainText('8 bindings');
  await expect(review).toContainText('Nothing bound');
  await expect(review).toContainText(
    'Your other controllers, the keyboard and the mouse are not changed.'
  );
  await expect(confirm).toContainText(
    'Nuclear Option’s saved bindings for Throttle - HOTAS Warthog'
  );
  await expect(confirm).toContainText('Each file is backed up first; Undo is on the Safety page.');
  await expect(go).toBeEnabled();
  await shot('review');
  // Cancel writes nothing.
  await page.getByTestId('nuclear-option-bindings-clear-all-dialog-cancel').click();
  await expect(rows).toHaveCount(8);

  // 2. Cleared: the throttle has nothing bound, the stick is as it was.
  await clearAll.click();
  await expect(go).toBeEnabled();
  await go.click();
  await expect(page.getByTestId('nuclear-option-bindings-saved')).toHaveText(
    /Saved: 8 bindings cleared on Throttle - HOTAS Warthog\. Undo is on the Safety page\./
  );
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId('nuclear-option-bindings-none')).toHaveText(
    'Nothing is bound on this device.'
  );
  await expect(clearAll).toBeDisabled();
  await shot('cleared');
  await tab('Joystick - HOTAS Warthog').click();
  await expect(rows).toHaveCount(7);

  // 3. One entry on the Safety page, and Undo puts all eight back.
  await page.getByTestId('nav-safety').click();
  await expect(page.getByTestId('safety-page')).toBeVisible();
  const reason = 'Nuclear Option bindings: all 8 bindings cleared on Throttle - HOTAS Warthog';
  const group = page.locator(`[data-testid="change-group"][data-reason="${reason}"]`);
  await expect(group).toHaveCount(1);
  await group.getByTestId('change-toggle').click();
  await expect(group.getByTestId('change-file')).toHaveCount(1);
  await shot('safety-page');
  await group.getByTestId('change-undo').click();
  await expect(page.getByTestId('safety-message')).toContainText(`Undid "${reason}"`);
  await page.getByTestId('nav-bindings').click();
  await tab('Throttle - HOTAS Warthog').click();
  await expect(rows).toHaveCount(8);

  // 4. While the game runs the review says why, and "Clear all" in the dialog is off.
  await run.mutate([
    { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
  ]);
  await clearAll.click();
  await expect(page.getByTestId('nuclear-option-bindings-clear-all-blocked')).toContainText(
    'Close Nuclear Option first'
  );
  await expect(go).toBeDisabled();
  await shot('blocked');
  await page.getByTestId('nuclear-option-bindings-clear-all-dialog-cancel').click();
  await expect(rows).toHaveCount(8);
});
