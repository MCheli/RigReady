import type { ElectronApplication } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/** Fly mode on scenarios: the recorded rig plus one thing wrong at a time. */

const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
const showWindow = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());

test('all good: opens on the setup, every group is green, Ready', async ({ rig }) => {
  const { page, shot } = await rig.launch('flying-all-good', 'fly-all-good');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  // Groups with nothing wrong are collapsed to one line each.
  await expect(page.getByTestId('group-devices')).toContainText('12 of 12 OK');
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  await expect(page.getByTestId('group-displays')).toContainText('1 of 1 OK');
  await expect(page.getByTestId('check-row')).toHaveCount(0);
  await shot('ready');
  await page.getByTestId('group-toggle-devices').click();
  await page.getByTestId('group-toggle-displays').click();
  await expect(checkRow(page, 'T-Pendular-Rudder')).toHaveAttribute('data-status', 'pass');
  await expect(checkRow(page, 'Monitor layout')).toContainText('4 monitors arranged as expected');
  // Every item says when it was checked.
  await expect(checkRow(page, 'Monitor layout').getByTestId('checked-at')).toHaveText(
    /\d\d:\d\d:\d\d/
  );
  await expect(page.locator('[data-testid="check-row"][data-status="fail"]')).toHaveCount(0);
  // Nothing to fix, so Make ready is not offered as an action.
  await expect(page.getByTestId('make-ready')).toBeDisabled();
  await expect(page.getByTestId('launch')).toBeEnabled();
  await shot('ready-expanded');
});

test('pedals unplugged: red, no fix available, Launch warns but is not blocked', async ({
  rig,
}) => {
  const { page, shot, app } = await rig.launch('flying-pedals-unplugged', 'fly-pedals-unplugged');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(page.getByTestId('fly-status-count')).toHaveText('(1)');
  await expect(page.getByTestId('fly-status-sub')).toHaveText('1 required item is not met');
  const pedals = checkRow(page, 'T-Pendular-Rudder');
  await expect(pedals).toHaveAttribute('data-status', 'fail');
  await expect(pedals).toContainText('Not connected');
  await expect(pedals.getByTestId('check-fix')).toHaveCount(0);
  // A device has no fix, but can be looked at.
  await expect(pedals.getByTestId('check-diagnose')).toBeVisible();
  await expect(page.getByTestId('make-ready')).toBeDisabled();
  await shot('not-ready');

  await page.getByTestId('launch').click();
  await expect(page.getByTestId('launch-warning')).toContainText('1 required check is not met');
  await expect(page.getByTestId('launch-warning-item')).toHaveText(
    'T-Pendular-Rudder — Not connected'
  );
  await shot('launch-warning');
  await page.getByTestId('launch-anyway').click();
  // The game really started (the fake process list has it), and RigReady got out of the way.
  await expect.poll(() => windowVisible(app)).toBe(false);
  await showWindow(app);
  await expect(page.getByTestId('fly-activity')).toContainText('Launched DCS.exe');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('launched-anyway');
});

test('optional device missing: yellow, never red, Ready with warnings; Launch goes straight through', async ({
  rig,
}) => {
  const { page, shot, app } = await rig.launch('flying-optional-missing', 'fly-optional-missing');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
  await expect(page.getByTestId('fly-status-count')).toHaveText('(1)');
  await expect(page.getByTestId('fly-status-sub')).toHaveText('1 optional item needs attention');
  await expect(checkRow(page, 'Stream Deck XL')).toHaveAttribute('data-status', 'warn');
  await expect(page.locator('[data-testid="check-row"][data-status="fail"]')).toHaveCount(0);
  await shot('ready-with-warning');

  // Stay on screen after Launch, to see what it did.
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-minimize-pref').click();
  await page.keyboard.press('Escape');
  // Ready with warnings: no question, the warnings are shown on the way.
  await page.getByTestId('launch').click();
  await expect(page.getByTestId('fly-toast')).toContainText(
    'Launching with 1 optional item not met: Stream Deck XL'
  );
  await expect(page.getByTestId('fly-activity')).toContainText('Launched DCS.exe');
  await expect(page.getByTestId('launch-warning')).toHaveCount(0);
  expect(await windowVisible(app)).toBe(true);
  await shot('launched-with-warning');
});

test('TrackIR not running: Make ready starts it', async ({ rig }) => {
  const { page, shot } = await rig.launch('flying-trackir-not-running', 'fly-trackir-not-running');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  const trackir = checkRow(page, 'TrackIR5');
  await expect(trackir).toHaveAttribute('data-status', 'fail');
  await expect(trackir).toContainText('Not running');
  await expect(trackir.getByTestId('check-fix')).toContainText('Start TrackIR5.exe');
  await shot('not-running');

  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-activity')).toContainText('Started TrackIR5.exe');
  await expect(page.getByTestId('fly-activity-headline')).toHaveText('1 of 1 fix worked');
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('made-ready');
});

test('MFD rotated: Make ready applies the layout and asks to keep it', async ({ rig }) => {
  const { page, shot } = await rig.launch('flying-mfd-rotated', 'fly-mfd-rotated');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  const layout = checkRow(page, 'Monitor layout');
  await expect(layout).toHaveAttribute('data-status', 'fail');
  await expect(layout).toContainText('USB_Monitor (2 of 3) is rotated 0°, expected 90°');
  await expect(layout.getByTestId('check-fix')).toContainText('Apply the monitor layout');
  await shot('rotated');

  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await expect(page.getByTestId('keep-layout')).toContainText('the previous layout comes back');
  await shot('keep-prompt');
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('keep-layout')).toHaveCount(0);
  await expect(page.getByTestId('group-displays')).toContainText('1 of 1 OK');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-activity')).toContainText('Applied the layout to 4 monitors');
  await shot('made-ready');
});

test('desk state: apply, go back, apply and keep, then Stand down restores the desk', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('desk-mfds-wrong', 'fly-desk-to-flying');
  const layout = checkRow(page, 'Monitor layout');
  await expect(layout).toHaveAttribute('data-status', 'fail');
  await expect(layout).toContainText('DELL G3223D is on, expected off');
  await shot('desk');

  // Apply, then change your mind: the layout comes back and the check fails again.
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await page.getByTestId('keep-layout-revert').click();
  await expect(page.getByTestId('keep-layout')).toHaveCount(0);
  await expect(layout).toHaveAttribute('data-status', 'fail');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');

  await page.getByTestId('make-ready').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('flying');

  await page.getByTestId('stand-down').click();
  const activity = page.getByTestId('fly-activity');
  await expect(activity).toContainText('Closed TrackIR5.exe');
  await expect(activity).toContainText('Restored the earlier monitor layout');
  await expect(page.getByTestId('fly-activity-headline')).toHaveText('Closed 1 app');
  await expect(layout).toHaveAttribute('data-status', 'fail');
  await expect(checkRow(page, 'TrackIR5')).toHaveAttribute('data-status', 'fail');
  await shot('stood-down');
});
