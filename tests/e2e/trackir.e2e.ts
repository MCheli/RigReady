import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/** Configure > TrackIR: detection, the start fix, the profile map, and an empty PC. */

async function openTrackIr(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-trackir').click();
  await expect(page.getByTestId('trackir-page')).toBeVisible();
}

test('trackir: running, visible to games, with its profiles and the game map shown read-only', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('trackir-ready', 'trackir-ready');
  await openTrackIr(page);
  await expect(page.getByTestId('tir-running')).toHaveText('Running');
  await expect(page.getByTestId('tir-tile-software')).toContainText('TrackIR 5.5.3');
  await expect(page.getByTestId('tir-camera')).toHaveText('Connected');
  await expect(page.getByTestId('tir-tile-camera')).toContainText('TrackIR 5');
  await expect(page.getByTestId('tir-npclient')).toHaveText('Yes');
  await expect(page.getByTestId('tir-profile')).toHaveCount(4);
  await expect(
    page.locator('[data-testid="tir-profile"][data-file="default.xml"]').getByTestId('tir-last')
  ).toHaveText('Last used');
  await expect(page.getByTestId('tir-settings-note')).toContainText('As last saved by TrackIR');
  const group = page.locator('[data-testid="tir-map-group"][data-file="default.xml"]');
  await expect(group).toContainText('Default');
  await expect(page.getByTestId('tir-switch-note')).toContainText(
    'no way for another program to switch'
  );
  await shot('ready');
  await group.getByTestId('tir-map-toggle').click();
  await expect(group.getByTestId('tir-map-ids')).toContainText('1000, 1001');
  await page.getByTestId('tir-switch-note').scrollIntoViewIfNeeded();
  await shot('map');
});

test('trackir: not running and not registered for games; Start TrackIR fixes it', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('trackir-not-running', 'trackir-not-running');
  await openTrackIr(page);
  await expect(page.getByTestId('tir-running')).toHaveText('Not running');
  await expect(page.getByTestId('tir-npclient')).toHaveText('No');
  await expect(page.getByTestId('tir-tile-games')).toContainText('start it once');
  await shot('not-running');
  await page.getByTestId('tir-start').click();
  await expect(page.getByTestId('tir-running')).toHaveText('Running');
  await expect(page.getByTestId('tir-message')).toContainText('Started TrackIR');
  await shot('started');
});

test('trackir: a PC without TrackIR gets install guidance and empty states', async ({ rig }) => {
  const { page, shot } = await rig.launch('trackir-not-installed', 'trackir-not-installed');
  await openTrackIr(page);
  await expect(page.getByTestId('tir-install-guide')).toContainText('Install TrackIR');
  await expect(page.getByTestId('tir-running')).toHaveText('Not installed');
  await expect(page.getByTestId('tir-camera')).toHaveText('Not connected');
  await expect(page.getByTestId('tir-profiles-empty')).toBeVisible();
  await expect(page.getByTestId('tir-map-empty')).toBeVisible();
  await expect(page.getByTestId('tir-start')).toHaveCount(0);
  await shot('not-installed');
});

test('trackir: the software and camera checks are captured and Make ready starts TrackIR', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('trackir-ready', 'trackir-checks');
  await page.getByTestId('fly-create').click();
  await expect(page.getByTestId('capture-page')).toBeVisible();
  await page.getByTestId('capture-name').locator('input').fill('Head tracking');
  for (const title of ['TrackIR software', 'TrackIR camera']) {
    await page
      .locator(`[data-testid="capture-candidate"][data-title="${title}"]`)
      .getByRole('checkbox')
      .check();
  }
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  await mutate([{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
  const row = checkRow(page, 'TrackIR software');
  await expect(row).toHaveAttribute('data-status', 'fail');
  await expect(row.getByTestId('check-fix')).toContainText('Start TrackIR');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('not-running');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('group-toggle-devices').click();
  await expect(checkRow(page, 'TrackIR camera')).toContainText('TrackIR 5 connected');
  await shot('fixed');
});
