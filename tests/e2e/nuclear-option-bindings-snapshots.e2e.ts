import type { Locator } from '@playwright/test';
import { expect, test } from './harness';

/**
 * Snapshots of Nuclear Option's bindings on fixtures/scenarios/nuclear-option-bindings.yaml:
 * one is taken, a controller is cleared, and the snapshot is put back after a review that
 * says which devices change. One entry on the Safety page; refused while the game runs.
 */
test('nuclear option bindings: a snapshot is taken, renamed, put back after a review, and deleted', async ({
  rig,
}) => {
  const run = await rig.launch('nuclear-option-bindings', 'nuclear-option-bindings-snapshots');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();
  const tab = (name: string): Locator =>
    page.locator(`[data-testid="nuclear-option-bindings-device"][data-device="${name}"]`);
  const rows = page.getByTestId('nuclear-option-bindings-row');
  const panel = page.getByTestId('nuclear-option-snapshots');
  const snapshot = (name: string): Locator =>
    page.locator(`[data-testid="nuclear-option-snapshot"][data-name="${name}"]`);

  // 1. The panel opens from the page's head; a snapshot needs a name.
  await expect(panel).toHaveCount(0);
  await page.getByTestId('nuclear-option-bindings-snapshots').click();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('nuclear-option-snapshots-none')).toBeVisible();
  await expect(page.getByTestId('nuclear-option-snapshots-take')).toBeDisabled();
  await page.getByTestId('nuclear-option-snapshots-name').locator('input').fill('Before I tidy up');
  await page.getByTestId('nuclear-option-snapshots-take').click();
  await expect(snapshot('Before I tidy up')).toContainText('bindings on Joystick - HOTAS Warthog');
  await expect(snapshot('Before I tidy up')).toContainText('the keyboard');
  await shot('taken');

  // 2. The throttle is cleared; the snapshot's review says what would come back.
  await tab('Throttle - HOTAS Warthog').click();
  await expect(rows).toHaveCount(8);
  await page.getByTestId('nuclear-option-bindings-clear-all').click();
  await page.getByTestId('nuclear-option-bindings-clear-all-dialog-go').click();
  await expect(rows).toHaveCount(0);
  await snapshot('Before I tidy up').getByTestId('nuclear-option-snapshot-restore').click();
  const dialog = page.getByTestId('nuclear-option-snapshot-restore-dialog-confirm');
  const go = page.getByTestId('nuclear-option-snapshot-restore-dialog-go');
  await expect(dialog).toContainText('Put “Before I tidy up” back?');
  const device = page.getByTestId('nuclear-option-snapshot-device');
  await expect(device).toHaveCount(1);
  await expect(device).toContainText('Throttle - HOTAS Warthog');
  await expect(device.locator('td').nth(1)).toHaveText('0');
  await expect(device.locator('td').nth(2)).toHaveText('8');
  await expect(dialog).toContainText('Each file is backed up first; Undo is on the Safety page.');
  await expect(go).toBeEnabled();
  await shot('review');
  // Cancel writes nothing.
  await page.getByTestId('nuclear-option-snapshot-restore-dialog-cancel').click();
  await expect(rows).toHaveCount(0);

  // 3. Restored: the throttle has its bindings again.
  await snapshot('Before I tidy up').getByTestId('nuclear-option-snapshot-restore').click();
  await expect(go).toBeEnabled();
  await go.click();
  await expect(page.getByTestId('nuclear-option-bindings-saved')).toHaveText(
    /Restored: “Before I tidy up” is back on 1 device\. Undo is on the Safety page\./
  );
  await expect(rows).toHaveCount(8);
  await shot('restored');
  // Again: nothing differs any more, and Restore in the dialog is off.
  await snapshot('Before I tidy up').getByTestId('nuclear-option-snapshot-restore').click();
  await expect(page.getByTestId('nuclear-option-snapshot-review')).toContainText(
    'The bindings are already as they were in this snapshot: nothing to restore.'
  );
  await expect(go).toBeDisabled();
  await page.getByTestId('nuclear-option-snapshot-restore-dialog-cancel').click();

  // 4. While the game runs the review says why, and Restore is off.
  await tab('Joystick - HOTAS Warthog').click();
  await page.getByTestId('nuclear-option-bindings-clear-all').click();
  await page.getByTestId('nuclear-option-bindings-clear-all-dialog-go').click();
  await expect(rows).toHaveCount(0);
  await run.mutate([
    { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
  ]);
  await snapshot('Before I tidy up').getByTestId('nuclear-option-snapshot-restore').click();
  await expect(page.getByTestId('nuclear-option-snapshot-blocked')).toContainText(
    'Close Nuclear Option first'
  );
  await expect(go).toBeDisabled();
  await shot('blocked');
  await page.getByTestId('nuclear-option-snapshot-restore-dialog-cancel').click();
  await run.mutate([{ op: 'stopProcess', name: 'NuclearOption.exe' }]);

  // 5. Renamed, then deleted after a second click.
  await snapshot('Before I tidy up').getByTestId('nuclear-option-snapshot-rename').click();
  await page.getByTestId('nuclear-option-snapshot-new-name').locator('input').fill('Clean rig');
  await page.getByTestId('nuclear-option-snapshot-rename-save').click();
  await expect(snapshot('Clean rig')).toHaveCount(1);
  await snapshot('Clean rig').getByTestId('nuclear-option-snapshot-delete').click();
  await expect(snapshot('Clean rig')).toContainText('Delete this snapshot?');
  await snapshot('Clean rig').getByTestId('nuclear-option-snapshot-delete-yes').click();
  await expect(page.getByTestId('nuclear-option-snapshots-none')).toBeVisible();

  // 6. The restore is one entry on the Safety page.
  await page.getByTestId('nav-safety').click();
  await expect(
    page.locator(
      '[data-testid="change-group"][data-reason="Nuclear Option bindings: snapshot “Before I tidy up” restored"]'
    )
  ).toHaveCount(1);
});
