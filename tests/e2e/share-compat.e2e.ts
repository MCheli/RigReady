import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * SHARE-006: a setup made on the owner's flight rig is opened on other PCs, and the report
 * says what each one is missing before anything is imported.
 */

async function openImport(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-share').click();
  await page.getByTestId('share-mode-import').click();
  await page.getByTestId('import-open').click();
  await expect(page.getByTestId('import-compat')).toBeVisible();
}

const devices = (page: Page, present: boolean) =>
  page.locator(`[data-testid="import-device"][data-present="${present}"]`);
const software = (page: Page, name: string) =>
  page.locator('[data-testid="import-software"]').filter({ hasText: name });

test('share: the F/A-18C setup of the flight rig, opened on a generic PC and on the racing rig, reports what is missing', async ({
  rig,
}) => {
  test.setTimeout(180_000);
  // On the flight rig: share the F/A-18C setup with the default choices.
  const owner = await rig.launch('flying-all-good', 'share-compat-export', {
    dialogs: { save: ['Documents/F-A-18C.rigready'] },
  });
  await owner.page.getByTestId('mode-configure').click();
  await owner.page.getByTestId('nav-share').click();
  await expect(owner.page.getByTestId('share-setup')).toContainText('DCS F/A-18C');
  await owner.page.getByTestId('share-reviewed').locator('input').check();
  await owner.page.getByTestId('share-save').click();
  await expect(owner.page.getByTestId('share-saved')).toContainText('F-A-18C.rigready');
  await owner.shot('saved');
  const file = path.join(owner.home, 'Documents', 'F-A-18C.rigready');

  // A PC that is not the owner's, with the standalone DCS installed and no flight gear.
  const generic = await rig.launch('generic-dcs', 'share-compat-generic', {
    dialogs: { open: [[file]] },
  });
  await openImport(generic.page);
  await expect(devices(generic.page, true)).toHaveCount(0);
  const missing = devices(generic.page, false);
  await expect(missing.filter({ hasText: 'WINWING' }).first()).toContainText(
    'Not connected (needed)'
  );
  expect(await missing.filter({ hasText: 'WINWING' }).count()).toBeGreaterThan(5);
  await expect(missing.filter({ hasText: 'T-Pendular-Rudder' })).toContainText('044F:B68F');
  await expect(software(generic.page, 'DCS World')).toHaveAttribute('data-found', 'true');
  await expect(software(generic.page, 'DCS World')).toContainText(
    'Installed (standalone; the setup was made with the steam version)'
  );
  await expect(software(generic.page, 'TrackIR')).toContainText('Not found on this PC');
  await expect(generic.page.getByTestId('import-displays')).toContainText('this PC has 1');
  await generic.page.getByTestId('import-compat').scrollIntoViewIfNeeded();
  await generic.shot('report');
  await generic.page.getByTestId('import-displays').scrollIntoViewIfNeeded();
  await generic.shot('report-software');

  // The owner's rig set up for racing: the flight gear is unplugged, the software is there.
  const racing = await rig.launch('mark-racing-tv', 'share-compat-racing', {
    dialogs: { open: [[file]] },
  });
  await openImport(racing.page);
  await expect(devices(racing.page, true)).toHaveCount(1);
  await expect(devices(racing.page, true)).toContainText('Stream Deck');
  expect(await devices(racing.page, false).filter({ hasText: 'WINWING' }).count()).toBeGreaterThan(
    5
  );
  await expect(devices(racing.page, false).filter({ hasText: 'TrackIR 5' })).toHaveCount(1);
  await expect(software(racing.page, 'DCS World')).toContainText('Installed (steam)');
  await expect(software(racing.page, 'TrackIR')).toHaveAttribute('data-found', 'true');
  await expect(racing.page.getByTestId('import-displays')).toContainText('this PC has 3');
  await racing.page.getByTestId('import-displays').scrollIntoViewIfNeeded();
  await racing.shot('report');
});
