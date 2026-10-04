import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/**
 * RACE-001: the owner's rig set up for racing (mark-full with every piece of flight gear
 * taken away by scenario mutations), with and without the TV above the ultrawide.
 */

const candidate = (page: Page, title: string) =>
  page.locator(`[data-testid="capture-candidate"][data-title="${title}"]`);
const menuItem = (page: Page, text: string | RegExp) =>
  page.locator('.v-overlay--active .v-list-item').filter({ hasText: text });

/** Capture an iRacing setup from the rig as it is: iRacing chosen, its two own checks ticked. */
async function captureIracing(page: Page): Promise<void> {
  await page.getByTestId('fly-create').click();
  await expect(candidate(page, 'Wheel base in PC mode').getByRole('checkbox')).toBeChecked();
  await expect(
    candidate(page, 'FANATEC Podium Wheel Base DD2').getByRole('checkbox')
  ).toBeChecked();
  await expect(candidate(page, 'Fanatec Service').getByRole('checkbox')).toBeChecked();
  // No flight gear is offered: it is not on the rig.
  await expect(page.getByTestId('capture-group-devices')).not.toContainText('WINWING');
  await expect(page.getByTestId('capture-group-devices')).not.toContainText('T-Pendular-Rudder');
  await page.getByTestId('capture-name').locator('input').fill('iRacing');
  await page.getByTestId('capture-game').click();
  await menuItem(page, 'iRacing').click();
  await expect(page.getByTestId('capture-launch-exe').locator('input')).toHaveValue(
    /iRacingUI\.exe$/
  );
  await candidate(page, 'iRacing knows the wheel').getByRole('checkbox').check();
  await candidate(page, 'iRacing helper service').getByRole('checkbox').check();
  await expect(candidate(page, 'Bindings (controls.cfg)').getByRole('checkbox')).toBeChecked();
}

test('mark-racing with the TV: an iRacing setup is captured and Ready; Make ready applies the racing layout and starts the apps; Stand down returns to Desk', async ({
  rig,
}) => {
  test.setTimeout(120_000);
  const { page, shot, mutate } = await rig.launch('mark-racing-tv', 'mark-racing-tv');

  await captureIracing(page);
  await expect(candidate(page, 'SimHub').getByRole('checkbox')).toBeChecked();
  await expect(page.getByTestId('capture-group-displays')).toContainText(
    'DELL G3223D: off · LC49G95T: 5120x1440 at 0,0, main · TV: 3840x2160 at 640,-2160'
  );
  await page.getByTestId('capture-group-displays').scrollIntoViewIfNeeded();
  await shot('capture');
  await page.getByTestId('capture-save').click();

  // Every check passes on the unchanged rig.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('profile-switcher')).toContainText('iRacing');
  await page.getByTestId('group-toggle-apps').click();
  await expect(checkRow(page, 'SimHub')).toHaveAttribute('data-status', 'pass');
  await expect(checkRow(page, 'Fanatec Service')).toHaveAttribute('data-status', 'pass');
  await page.getByTestId('group-toggle-displays').click();
  await expect(checkRow(page, 'Monitor layout')).toHaveAttribute('data-status', 'pass');
  await shot('ready');

  // The Monitors page draws the TV above the ultrawide.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-displays').click();
  await expect(page.getByTestId('displays-map').getByTestId('map-monitor')).toHaveCount(2);
  await expect(page.getByTestId('displays-map')).toContainText('TV');
  await expect(page.getByTestId('displays-page')).toContainText('3840x2160 at 640,-2160');
  await shot('monitors-racing');

  // Back at the desk: Dell on and main, the ultrawide beside it, TV off, racing apps closed.
  await mutate([
    {
      op: 'setDisplay',
      match: { name: 'DELL G3223D' },
      set: { enabled: true, primary: true, x: 0, y: 0, width: 2560, height: 1440 },
    },
    { op: 'setDisplay', match: { name: 'LC49G95T' }, set: { primary: false, x: 2560, y: 0 } },
    { op: 'setDisplay', match: { name: 'TV' }, set: { enabled: false } },
    { op: 'stopProcess', name: 'FanatecService.exe' },
    { op: 'stopProcess', name: 'SimHubWPF.exe' },
  ]);
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('layout-new-name').locator('input').fill('Desk');
  await page.getByTestId('layout-save-current').click();
  await page.getByTestId('setting-desk-layout').click();
  await page.getByRole('option', { name: 'Desk' }).click();
  await expect(page.getByTestId('layout-row')).toContainText('desk layout');

  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(checkRow(page, 'Monitor layout')).toHaveAttribute('data-status', 'fail');
  await expect(checkRow(page, 'Monitor layout')).toContainText('DELL G3223D is on, expected off');
  await expect(checkRow(page, 'Monitor layout')).toContainText('TV is off, expected on');
  await expect(checkRow(page, 'Fanatec Service')).toHaveAttribute('data-status', 'fail');
  await expect(checkRow(page, 'SimHub')).toHaveAttribute('data-status', 'fail');
  await shot('at-the-desk');

  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  const activity = page.getByTestId('fly-activity');
  await expect(activity).toContainText('Started FanatecService.exe');
  await expect(activity).toContainText('Started SimHubWPF.exe');
  await shot('made-ready');

  await page.getByTestId('stand-down').click();
  // Stand down waits for the answer: the desk layout counts as applied once it is kept.
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await page.getByTestId('keep-layout-keep').click();
  await expect(activity).toContainText('Applied desk layout "Desk"');
  await expect(checkRow(page, 'Monitor layout')).toContainText('DELL G3223D is on, expected off');
  await expect(checkRow(page, 'Monitor layout')).toContainText('TV is off, expected on');
  await shot('stood-down');
});

test('mark-racing without the TV: the captured iRacing setup is Ready on the ultrawide alone', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('mark-racing', 'mark-racing');
  await captureIracing(page);
  await expect(candidate(page, 'SimHub')).toHaveCount(0);
  await expect(page.getByTestId('capture-group-displays')).toContainText(
    'DELL G3223D: off · LC49G95T: 5120x1440 at 0,0, main'
  );
  await expect(page.getByTestId('capture-group-displays')).not.toContainText('TV');
  await page.getByTestId('capture-group-displays').scrollIntoViewIfNeeded();
  await shot('capture');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('group-toggle-devices').click();
  await expect(checkRow(page, 'Wheel base in PC mode')).toHaveAttribute('data-status', 'pass');
  await page.getByTestId('group-toggle-displays').click();
  await expect(checkRow(page, 'Monitor layout')).toHaveAttribute('data-status', 'pass');
  await shot('ready');
});
