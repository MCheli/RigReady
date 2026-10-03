import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from './harness';

/** DCS bindings: one input that does several things, found and fixed. */

test('bindings: an MFD knob that is also bound to pitch is reported and fixed', async ({ rig }) => {
  const run = await rig.launch('dcs-bindings-conflict', 'bindings-conflict');
  const { page, shot } = run;
  const file = path.join(
    run.home,
    'Saved Games',
    'DCS',
    'Config',
    'Input',
    'FA-18C_hornet',
    'joystick',
    'WINWING MFD1-L {7F3956A0-B756-11f0-801A-444553540000}.diff.lua'
  );
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-dcs-bindings').click();
  await expect(page.getByTestId('ov-tile-conflicts')).toHaveAttribute('data-count', '1');
  const mfd = page.locator('[data-testid="ov-device"][data-device="WINWING MFD1-L"]');
  await expect(mfd.getByTestId('ov-device-problems')).toContainText('1 problem');
  await shot('overview');

  await page.getByTestId('ov-tile-conflicts').click();
  const conflict = page.getByTestId('prob-conflict');
  await expect(conflict).toHaveCount(1);
  await expect(conflict).toContainText('Slider 1 on WINWING MFD1-L');
  await expect(conflict).toContainText('Pitch');
  await expect(conflict).toContainText('HUD Symbology Brightness Control Knob');
  // Pitch is on the stick too: one action on two devices.
  const pitch = page.locator('[data-testid="prob-duplicate"][data-action="Pitch"]');
  await expect(pitch).toContainText('WINWING MFD1-L: Slider 1');
  await conflict.scrollIntoViewIfNeeded();
  await shot('conflict');

  // Keep the knob for the brightness only.
  await conflict.getByTestId('prob-conflict-keep').nth(1).click();
  const plan = page.getByTestId('plan-dialog');
  await expect(plan).toContainText(
    'Keep Slider 1 on WINWING MFD1-L only for HUD Symbology Brightness Control Knob (F/A-18C)'
  );
  await expect(plan).toContainText('Pitch: remove Slider 1');
  await shot('fix-preview');
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('prob-conflicts')).toHaveCount(0);
  const text = await fs.readFile(file, 'utf8');
  expect(text).not.toContain('a2001cdnil');
  expect(text).toContain('["a3012cd34"] = {');
});

test('bindings: a PC without DCS says so instead of showing empty lists', async ({ rig }) => {
  const { page, shot } = await rig.launch('dcs-bindings-no-dcs', 'bindings-no-dcs');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-dcs-bindings').click();
  await expect(page.getByTestId('bind-not-found')).toContainText(
    'DCS World was not found on this PC'
  );
  await expect(page.getByTestId('bind-not-found')).toContainText('Start DCS once');
  await expect(page.getByTestId('bind-tabs')).toHaveCount(0);
  await expect(page.getByTestId('bindings-aircraft')).toHaveCount(0);
  await shot('not-found');
});
