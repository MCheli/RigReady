import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/** Flows that cross feature boundaries: a setup's install choice, live devices, hung checks, failed starts. */

const menuItem = (page: Page, text: string | RegExp) =>
  page.locator('.v-overlay--active .v-list-item').filter({ hasText: text });

async function openEditor(page: Page, name: string): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  await page
    .locator(`[data-testid="profile-row"][data-name="${name}"]`)
    .getByTestId('profile-edit')
    .click();
  await expect(page.getByTestId('profile-edit-page')).toBeVisible();
}

test('dcs: a setup chooses which DCS install it uses, and says so when that install is gone', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('dcs-two-installs', 'dcs-install-choice');
  // With the first install found (Steam) both files are there.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  await openEditor(page, 'DCS open beta');
  const install = page.getByTestId('edit-game-install');
  await expect(install).toContainText('The first one found');
  await install.click();
  await expect(menuItem(page, /DCSWorld \(Steam\)/)).toBeVisible();
  await menuItem(page, /DCS World OpenBeta \(standalone\)/).click();
  await expect(install).toContainText('DCS World OpenBeta (standalone)');
  await shot('install-chosen');
  await page.getByTestId('edit-save').click();

  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('group-toggle-files').click();
  await expect(checkRow(page, 'DCS options')).toHaveAttribute('data-status', 'pass');

  // The open beta is uninstalled: its checks are errors, not a silent switch to the Steam install.
  await mutate([{ op: 'removeFile', path: 'Games/DCS World OpenBeta' }]);
  const program = checkRow(page, 'DCS program');
  await expect(program).toHaveAttribute('data-status', 'error');
  await expect(program).toContainText('DCS install not found');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('install-gone');
  await page.getByTestId('launch').click();
  await page.getByTestId('launch-anyway').click();
  await expect(page.getByTestId('fly-activity')).toContainText(
    /DCS World install not found at .*DCS World OpenBeta/
  );
  await expect(page.getByTestId('fly-activity')).not.toContainText('Launched');
  await shot('not-launched');
});

test('fly: a device unplugged and plugged back turns red and green again without a re-check', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('flying-all-good', 'fly-live-plug');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  const pedals = { vendorId: '044F', productId: 'B68F' };
  await mutate([{ op: 'unplugDevice', match: pedals }]);
  await expect(checkRow(page, 'T-Pendular-Rudder')).toHaveAttribute('data-status', 'fail', {
    timeout: 2000,
  });
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('unplugged');
  await mutate([{ op: 'plugDevice', match: pedals }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready', { timeout: 2000 });
  await page.getByTestId('group-toggle-devices').click();
  await expect(checkRow(page, 'T-Pendular-Rudder')).toHaveAttribute('data-status', 'pass');
  await shot('plugged-back');
});

test('fly: checks of a provider that never answers time out on their own; the rest of the list does not wait', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('flying-all-good', 'fly-hung-check');
  // A short timeout, so the flow does not sit through the default five seconds.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  const timeout = page.getByTestId('setting-check-timeout').locator('input');
  await timeout.fill('1');
  await timeout.blur();
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  await mutate([{ op: 'hangProvider', port: 'devices' }]);
  const pedals = checkRow(page, 'T-Pendular-Rudder');
  await expect(pedals).toHaveAttribute('data-status', 'error');
  await expect(pedals).toContainText('Timed out after 1 s');
  // Apps and monitors answered meanwhile; a required item that timed out counts as not ready.
  await expect(page.getByTestId('group-apps')).toContainText(/(\d+) of \1 OK/);
  await expect(page.getByTestId('group-displays')).toContainText('1 of 1 OK');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(pedals.getByTestId('check-recheck')).toBeVisible();
  await shot('timed-out');

  // Still hung: Re-check on the item gives the same answer, again without holding up anything.
  await pedals.getByTestId('check-recheck').click();
  await expect(pedals).toContainText('Timed out after 1 s');
  // The provider answers again: the list recovers by itself.
  await mutate([{ op: 'hangProvider', port: 'devices', hang: false }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('answering-again');
});

test('fly: a game that Windows refuses to start is never reported as launched', async ({ rig }) => {
  const { page, shot, mutate } = await rig.launch('flying-all-good', 'fly-launch-refused');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await mutate([{ op: 'failProcessStart', name: 'DCS.exe' }]);
  await page.getByTestId('launch').click();
  const activity = page.getByTestId('fly-activity');
  await expect(activity).toContainText(/Could not start .*DCS\.exe\. Access is denied\./);
  await expect(activity).not.toContainText('Launched');
  // The window stays: there is something to read.
  await expect(page.getByTestId('fly-status-title')).toBeVisible();
  await shot('refused');
});

test('monitors: which way is up, identity of identical screens, and a captured arrangement saved by name', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('flying-fresh', 'displays-upright');
  // New setup: the arrangement is not a saved layout yet, so capture offers to save it.
  await page.getByTestId('fly-create').click();
  await page.getByTestId('capture-name').locator('input').fill('DCS F/A-18C');
  const monitors = page.locator('[data-testid="capture-candidate"][data-title="Monitor layout"]');
  await monitors.getByTestId('candidate-ask').locator('input').fill('Flying');
  // Bring the question clear of the footer for the screenshot.
  await page.getByTestId('capture-group-audio').scrollIntoViewIfNeeded();
  await shot('capture-save-as-layout');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText(/Ready/);
  await page.getByTestId('group-toggle-displays').click();
  await expect(checkRow(page, 'Monitor layout: Flying')).toContainText(
    'Arranged as "Flying" (4 monitors on)'
  );

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-displays').click();
  await expect(page.locator('[data-testid="layout-card"][data-layout="Flying"]')).toContainText(
    'In use now'
  );
  // Identity: connector, serials, and how the three identical screens are told apart.
  const first = page.locator('[data-testid="display-row"][data-label="USB_Monitor (1 of 3)"]');
  await expect(first).toContainText('USB · REG0319 · serial 1 · USB device WWIN29320221210163532');
  await expect(first.getByTestId('display-told-apart')).toHaveAttribute('data-by', 'serial');
  await expect(page.locator('[data-testid="display-row"][data-label="LC49G95T"]')).toContainText(
    'DisplayPort · SAM7053 · serial H4ZR900542'
  );

  // Which way is up?
  await page.getByTestId('identify').click();
  const panel = page.getByTestId('upright-panel');
  await expect(panel).toContainText('Which way is up?');
  await shot('which-way-is-up');
  const row = panel.locator('[data-testid="upright-row"][data-label="USB_Monitor (1 of 3)"]');
  await row.getByTestId('upright-flip').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('displays-notice')).toContainText(
    'Turned USB_Monitor (1 of 3) the other way up and corrected it in 1 saved layout.'
  );
  await expect(row).toContainText('Portrait (flipped) (270°)');
  await expect(row.getByTestId('upright-confirmed')).toBeVisible();
  await shot('turned');
  await panel.getByTestId('upright-confirm').click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('displays-notice')).toContainText(
    'every screen is the right way up'
  );

  // The setup follows the saved layout, and still passes when a screen changes USB port.
  await mutate([
    {
      op: 'setDisplay',
      match: { name: 'USB_Monitor', index: 1 },
      set: {
        id: '\\\\?\\display#reg0319#a&99999999&0&uid256#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}',
      },
    },
  ]);
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText(/Ready/);
  await expect(page.getByTestId('group-displays')).toContainText('1 of 1 OK');
  await shot('moved-port-still-ready');
});
