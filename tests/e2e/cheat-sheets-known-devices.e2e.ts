import type { Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * A controller RigReady has no drawing of but knows the controls of: a Thrustmaster HOTAS
 * Warthog stick plugged into the recorded rig. Its sheet is the controls list with a block
 * per physical control, named the way Thrustmaster names them, and DCS's own Hornet
 * defaults for the Warthog on them.
 */

async function openSheets(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-cheat-sheets').click();
  await expect(page.getByTestId('cheat-sheets-page')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('sheet-view')).toBeVisible();
}

test('cheat sheets: a Warthog stick shows its controls by name', async ({ rig }) => {
  const run = await rig.launch('cheat-sheets-known-devices', 'cheat-sheets-known-devices');
  const { page, shot } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await openSheets(page);
  const warthog = page.locator(
    '[data-testid="sheet-device"][data-title="Joystick - HOTAS Warthog"]'
  );
  await warthog.click();
  await expect(page.getByTestId('sheet-title')).toHaveText('Joystick - HOTAS Warthog');
  const source = page.getByTestId('sheet-layout-source');
  await expect(source).toHaveAttribute('data-picture', 'list');
  await expect(source).toHaveText(
    'Controls named for the Thrustmaster HOTAS Warthog joystick (no drawing of it yet)'
  );
  const picture = page.locator('[data-testid="sheet-view"] svg');
  const heads = picture.locator('.cs-bhead');
  for (const head of [
    'TG trigger · 1, 6',
    'S2 weapon release · 2',
    'H1 trim hat · H1',
    'H2 TMS hat · 7–10',
    'H4 CMS hat · 15–19',
    'Stick · X, Y',
  ]) {
    await expect(heads.filter({ hasText: head })).toHaveCount(1);
  }
  // No made-up runs of eight: every button of the Warthog has its own name.
  await expect(heads.filter({ hasText: /^Buttons? \d/ })).toHaveCount(0);
  // DCS's default for the Warthog in the Hornet, on the button it belongs to.
  const release = page.locator('[data-testid="sheet-view"] [data-control="button:2"]');
  await expect(release.first()).toContainText(/Weapon Release|release/i);
  await release.first().click();
  await expect(page.getByTestId('sheet-detail')).toContainText('S2 weapon release');
  await shot('warthog-stick');
});
