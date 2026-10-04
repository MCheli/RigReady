import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from './harness';

/**
 * SAP-002: on a rig where SimAppPro is not installed, the WinWing lines of Export.lua are
 * managed and the WinWing bindings are snapshotted and restored.
 */

const WWT =
  "local wwtlfs=require('lfs')\r\ndofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')\r\n";
const BIOS = 'dofile(lfs.writedir() .. [[Scripts\\DCS-BIOS\\BIOS.lua]])\n';

test('without SimAppPro: the WinWing Export.lua lines are managed and the WinWing bindings are snapshotted and restored', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch('dcs-setup-no-simapppro', 'dcs-setup-no-simapppro');
  const exportLua = path.join(home, 'Saved Games', 'DCS', 'Scripts', 'Export.lua');
  await expect(fs.access(path.join(home, 'AppData', 'Roaming', 'SimAppPro'))).rejects.toThrow();

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-dcs').click();
  await page.getByTestId('dcs-tab-simapppro').click();
  await expect(page.getByTestId('sap-status')).toContainText('SimAppPro is not installed');
  await expect(page.getByTestId('sap-status')).toContainText('RigReady configures DCS without it');
  await shot('simapppro-not-installed');

  // Export.lua: the WinWing line is recognised, taken out and put back, each shown first.
  await page.getByTestId('dcs-tab-export').click();
  const wwt = page.locator('[data-testid="export-tool"][data-tool="wwt"]');
  await expect(wwt).toHaveAttribute('data-active', 'true');
  await page.getByTestId('export-remove-wwt').click();
  await expect(page.getByTestId('export-confirm')).toBeVisible();
  await expect(page.getByTestId('export-confirm')).toContainText(
    "dofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')"
  );
  await shot('confirm-remove-winwing');
  await page.getByTestId('export-confirm-apply').click();
  await expect(page.getByTestId('export-message')).toContainText(
    'Export.lua: Remove WinWing (SimAppPro)'
  );
  await expect(wwt).toHaveAttribute('data-active', 'false');
  expect(await fs.readFile(exportLua, 'utf8')).toBe(`\r\n${BIOS}`);

  await page.getByTestId('export-add-wwt').click();
  await expect(page.getByTestId('export-confirm')).toBeVisible();
  await page.getByTestId('export-confirm-apply').click();
  await expect(page.getByTestId('export-message')).toContainText(
    'Export.lua: Add WinWing (SimAppPro)'
  );
  await expect(wwt).toHaveAttribute('data-active', 'true');
  expect(await fs.readFile(exportLua, 'utf8')).toBe(`\r\n${BIOS}${WWT}`);
  await shot('winwing-line-back');

  // Bindings: a snapshot, a WinWing binding file lost, and the restore that brings it back.
  await page.getByTestId('nav-dcs-bindings').click();
  await expect(page.getByTestId('bind-overview')).toBeVisible();
  await page.getByTestId('bind-tab-snapshots').click();
  await page.getByTestId('snap-name').locator('input').fill('WinWing as flown');
  await page.getByTestId('snap-create').click();
  await expect(page.getByTestId('snap-message')).toContainText('Snapshot "WinWing as flown" taken');
  const joystick = path.join(
    home,
    'Saved Games',
    'DCS',
    'Config',
    'Input',
    'FA-18C_hornet',
    'joystick'
  );
  const ufc = (await fs.readdir(joystick)).find((f) => f.startsWith('WINWING UFC1'))!;
  const before = await fs.readFile(path.join(joystick, ufc), 'utf8');
  await fs.rm(path.join(joystick, ufc));

  await page.getByTestId('snap-restore').click();
  await expect(page.getByTestId('snap-restore-dialog')).toBeVisible();
  await page.getByTestId('snap-restore-preview').click();
  const plan = page.getByTestId('plan-dialog');
  await expect(plan).toContainText('Restore binding snapshot "WinWing as flown"');
  await expect(plan.getByTestId('plan-file')).toHaveCount(1);
  await expect(plan.getByTestId('plan-file')).toHaveAttribute('data-action', 'create');
  await expect(plan.getByTestId('plan-file')).toContainText('WINWING UFC1');
  await shot('restore-winwing-bindings');
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toContainText('Restore binding snapshot');
  expect(await fs.readFile(path.join(joystick, ufc), 'utf8')).toBe(before);
});
