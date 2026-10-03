import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/** The Monitors page, saved layouts, the display check and its fix. */

const card = (page: Page, name: string) =>
  page.locator(`[data-testid="layout-card"][data-layout="${name}"]`);
const row = (page: Page, label: string) =>
  page.locator(`[data-testid="display-row"][data-label="${label}"]`);

async function openMonitors(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-displays').click();
  await expect(page.getByTestId('displays-page')).toBeVisible();
}

async function menu(page: Page, layout: string, item: string): Promise<void> {
  await card(page, layout).getByTestId('layout-menu').click();
  await page.getByTestId(item).click();
  // The menu is gone again before the next one opens.
  await expect(page.getByTestId(item)).toHaveCount(0);
}

test('monitors: map, Identify and names, then apply Flying, Racing without the TV, and manage layouts', async ({
  rig,
}) => {
  const run = await rig.launch('displays-layouts', 'display-layouts');
  const { page, shot } = run;
  await openMonitors(page);

  // The desk state as Windows has it: five monitors on, the Dell is the main display.
  const map = page.getByTestId('displays-map');
  await expect(map.getByTestId('map-monitor')).toHaveCount(5);
  await expect(row(page, 'DELL G3223D')).toContainText('main display');
  await expect(row(page, 'USB_Monitor (2 of 3)')).toContainText('1024x768 at 8704,0');
  await expect(page.getByTestId('display-identical-hint')).toHaveCount(3);
  await shot('desk-now');

  // Identify puts the numbers on the screens; the same numbers are on the map and the rows.
  await page.getByTestId('identify').click();
  await expect(page.getByTestId('displays-notice')).toContainText(
    'shows its number for 5 seconds (5 monitors)'
  );

  // The user reads the numbers off the physical screens and names the identical ones.
  await row(page, 'USB_Monitor (1 of 3)').getByTestId('display-name').click();
  await page.getByTestId('display-name-suggestion').filter({ hasText: 'MFD left' }).click();
  await expect(row(page, 'MFD left')).toBeVisible();
  await row(page, 'USB_Monitor (2 of 3)').getByTestId('display-name').click();
  await page.getByTestId('display-name-input').locator('input').fill('MFD centre');
  await page.getByTestId('display-name-save').click();
  await row(page, 'USB_Monitor (3 of 3)').getByTestId('display-name').click();
  await page.getByTestId('display-name-suggestion').filter({ hasText: 'MFD right' }).click();
  await expect(row(page, 'MFD right')).toContainText('USB_Monitor');
  await expect(page.getByTestId('display-identical-hint')).toHaveCount(0);
  await expect(map.locator('[data-label="MFD centre"]')).toBeVisible();
  await shot('named');

  // Saved layouts: each drawn to scale, with whether the monitors match it.
  await expect(page.getByTestId('layout-card')).toHaveCount(3);
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'different');
  await expect(card(page, 'Racing')).toHaveAttribute('data-status', 'incomplete');
  await expect(card(page, 'Racing').getByTestId('layout-status')).toContainText('TV not connected');
  await card(page, 'Flying').getByTestId('layout-status').click();
  const differences = card(page, 'Flying').getByTestId('layout-differences');
  await expect(differences).toContainText('DELL G3223D is on, expected off');
  await expect(differences).toContainText('MFD left is rotated 0°, expected 90°');
  await shot('layouts');

  // Apply Flying: first what would change, then the keep-or-revert prompt.
  await card(page, 'Flying').getByTestId('layout-apply').click();
  const dialog = page.getByTestId('apply-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('apply-changes')).toContainText(
    'DELL G3223D is on, expected off'
  );
  await expect(dialog.getByTestId('apply-changes')).toContainText(
    'MFD centre is 1024x768, expected 768x1024'
  );
  await shot('apply-flying-preview');
  await dialog.getByTestId('apply-confirm').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await shot('keep-prompt');
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('keep-layout')).toHaveCount(0);
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'current');
  await expect(map.locator('[data-label="MFD left"]')).toHaveAttribute('data-rotation', '90');
  await expect(map.getByTestId('map-monitor-off')).toContainText('DELL G3223D · off');
  await expect(row(page, 'LC49G95T')).toContainText('main display');
  await page.getByTestId('displays-page').locator('h1').scrollIntoViewIfNeeded();
  await shot('flying-applied');

  // Racing wants the TV, which is not connected: it is only applied without it when asked.
  await card(page, 'Racing').getByTestId('layout-apply').click();
  await expect(dialog.getByTestId('apply-missing')).toContainText('TV is not connected');
  await expect(dialog.getByTestId('apply-confirm')).toHaveText('Apply without TV');
  await shot('racing-without-tv');
  await dialog.getByTestId('apply-confirm').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('displays-notice')).toContainText('Applied "Racing" without TV');
  await expect(map.getByTestId('map-monitor')).toHaveCount(1);
  await expect(card(page, 'Racing')).toHaveAttribute('data-status', 'incomplete');

  // Kept, but changed my mind: the page puts back exactly what was there before.
  await page.getByTestId('displays-undo').click();
  await expect(page.getByTestId('displays-notice')).toContainText(
    'Put back the layout from before the last change'
  );
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'current');
  await expect(map.getByTestId('map-monitor')).toHaveCount(4);

  // Desk layout for Stand down, rename, delete, and save the monitors as they are now.
  await menu(page, 'Desk', 'layout-desk');
  await expect(card(page, 'Desk').getByTestId('layout-desk-badge')).toBeVisible();
  await menu(page, 'Racing', 'layout-rename');
  await page.getByTestId('layout-rename-input').locator('input').fill('Racing with TV');
  await page.getByTestId('layout-rename-save').click();
  await expect(card(page, 'Racing with TV')).toBeVisible();
  await menu(page, 'Racing with TV', 'layout-delete');
  await expect(page.getByTestId('layout-delete-dialog')).toBeVisible();
  await page.getByTestId('layout-delete-confirm').click();
  await expect(page.getByTestId('layout-card')).toHaveCount(2);
  await page.getByTestId('layout-save-open').click();
  await page.getByTestId('layout-save-name').locator('input').fill('Ultrawide only');
  await page.getByTestId('layout-save').click();
  await expect(card(page, 'Ultrawide only')).toHaveAttribute('data-status', 'current');
  await shot('managed');

  // Names and layouts live in the data folder: a restart finds them, with the same screens.
  const second = await run.restart();
  await openMonitors(second.page);
  await expect(row(second.page, 'MFD centre')).toBeVisible();
  await expect(card(second.page, 'Desk').getByTestId('layout-desk-badge')).toBeVisible();
  await expect(second.page.getByTestId('layout-card')).toHaveCount(3);
});

test('monitors: edit a layout by hand; overlapping monitors are refused with a reason', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-layouts', 'display-edit');
  await openMonitors(page);
  await menu(page, 'Desk', 'layout-edit');
  const dialog = page.getByTestId('edit-dialog');
  await expect(dialog).toBeVisible();
  const mfd = dialog.locator('[data-testid="edit-row"][data-label="USB_Monitor (1 of 3)"]');
  // Turn the first MFD screen on in portrait: it lands at 0,0, on top of the Dell.
  await mfd.getByTestId('edit-enabled').locator('input').check();
  await mfd.getByTestId('edit-rotation').click();
  await page.getByRole('option', { name: 'Portrait (90°)' }).click();
  await expect(mfd).toContainText('768x1024');
  await dialog.getByTestId('edit-save').click();
  await expect(dialog.getByTestId('edit-error')).toContainText(
    'DELL G3223D and USB_Monitor (1 of 3) overlap.'
  );
  await shot('overlap-refused');
  const x = mfd.getByTestId('edit-x').locator('input');
  await x.fill('7680');
  await x.blur();
  await dialog.getByTestId('edit-save').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('displays-notice')).toContainText('Saved "Desk"');
  await card(page, 'Desk').getByTestId('layout-status').click();
  await expect(card(page, 'Desk').getByTestId('layout-differences')).toContainText(
    'USB_Monitor (1 of 3) is rotated 0°, expected 90°'
  );
  await shot('edited');
});

test('fix-display: an MFD screen back in landscape fails by name, Fix then Keep makes it pass', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('flying-mfd-rotated', 'fix-display');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  const layout = checkRow(page, 'Monitor layout');
  await expect(layout).toHaveAttribute('data-status', 'fail');
  await expect(layout).toContainText('USB_Monitor (2 of 3) is rotated 0°, expected 90°');
  await expect(layout.getByTestId('check-fix')).toContainText('Apply the monitor layout');
  await shot('rotated');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await expect(page.getByTestId('keep-layout-seconds')).toBeVisible();
  await shot('keep-prompt');
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('group-displays')).toContainText('1 of 1 OK');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('fixed');
});

test('identical MFD screens swapped: both are named in the check, Make ready swaps them back', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-mfd-swapped', 'display-mfd-swapped');
  const layout = checkRow(page, 'Monitor layout');
  await expect(layout).toHaveAttribute('data-status', 'fail');
  await expect(layout).toContainText('MFD left is at 5888,0, expected 5120,0');
  await expect(layout).toContainText('MFD centre is at 5120,0, expected 5888,0');
  await shot('swapped');
  await page.getByTestId('make-ready').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await openMonitors(page);
  await expect(row(page, 'MFD left')).toContainText('at 5120,0');
  await expect(row(page, 'MFD centre')).toContainText('at 5888,0');
  await shot('monitors-after');
});

test('closed during the countdown: the next start offers the earlier layout back', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-recovery', 'display-recovery');
  const offer = page.getByTestId('layout-recovery');
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('DELL G3223D: 2560x1440 at 0,0, main');
  await shot('offer');
  await offer.getByTestId('layout-recovery-restore').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await page.getByTestId('keep-layout-keep').click();
  await expect(offer).toHaveCount(0);
  await openMonitors(page);
  await expect(row(page, 'DELL G3223D')).toContainText('main display');
  await expect(row(page, 'USB_Monitor (1 of 3)')).toContainText('Landscape');
  await shot('restored');
});
