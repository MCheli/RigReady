import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test } from './harness';

/**
 * A setup RigReady 1 left in the setups folder (CFG-PROFILE-024): the Setups page names it
 * with its file, and brings it over when every part it brings has an exact match here, the
 * rest named with why. When it cannot, it says so and opens the folder. The old file is
 * never changed.
 */

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);
const OLD = 'mld4nbutw9iuzu9.yaml';

test('profiles: a setup RigReady 1 left is brought over with what has an exact match, and the old file stays as it was', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch(
    'first-run-after-version-one',
    'profiles-version-one'
  );
  const oldFile = path.join(dataRoot, 'profiles', OLD);
  const before = await fs.readFile(oldFile);
  await go(page, '/configure/profiles');
  const old = page.getByTestId('profile-earlier');
  await expect(old).toContainText('LMU');
  await expect(old).toContainText(`${OLD} · made by RigReady 1`);
  await expect(old.getByTestId('profile-earlier-summary')).toHaveText(
    'RigReady can bring it over: 2 checks. 1 part has no match in this version.'
  );
  await expect(old.getByTestId('profile-earlier-folder')).toBeVisible();
  await shot('listed');

  await old.getByTestId('profile-earlier-bring').click();
  const dialog = page.getByTestId('profile-bring-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Bring "LMU" over?');
  await expect(dialog).toContainText(
    `RigReady makes a new setup, "LMU" for Le Mans Ultimate, from ${OLD}.`
  );
  await expect(dialog.getByTestId('profile-bring-checks').locator('li')).toHaveText([
    'FANATEC Podium Wheel Base DD2: connected: the FANATEC Podium Wheel Base DD2 plugged in now (0EB7:0007)',
    'TrackIR 5: TrackIR5.exe is running (optional)',
  ]);
  await expect(dialog.getByTestId('profile-bring-launch')).toHaveText(
    'Launch starts Le Mans Ultimate, through Steam.'
  );
  await expect(dialog.getByTestId('profile-bring-left')).toContainText('Display: Single Ultrawide');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('bring-over');

  await dialog.getByTestId('profile-bring-go').click();
  await expect(page.getByTestId('profiles-message')).toContainText(
    'Brought "LMU" over as the setup "LMU". The old file is still in the folder'
  );
  await expect(page.locator('[data-testid="profile-row"][data-name="LMU"]')).toBeVisible();
  await expect(old.getByTestId('profile-earlier-brought')).toContainText(
    'Brought over as the setup "LMU".'
  );
  await expect(old.getByTestId('profile-earlier-bring')).toHaveCount(0);
  await shot('brought-over');
  // The old file is byte for byte what RigReady 1 wrote.
  expect(await fs.readFile(oldFile)).toEqual(before);

  // On the Play screen the brought-over setup is the one in use, and it is checked for real.
  await go(page, '/');
  await expect(page.getByTestId('profile-switcher')).toContainText('LMU');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('play');
});

test('profiles: with the wheel of a RigReady 1 setup unplugged, RigReady says it cannot bring it over and opens the folder', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch(
    'profiles-version-one-unplugged',
    'profiles-version-one-unplugged'
  );
  await go(page, '/configure/profiles');
  const old = page.getByTestId('profile-earlier');
  const cannot = old.getByTestId('profile-earlier-cannot');
  await expect(cannot).toContainText('RigReady cannot bring this setup over.');
  await expect(cannot).toContainText(
    'no device of that name is connected now. Connect it, then look again.'
  );
  await expect(old.getByTestId('profile-earlier-bring')).toHaveCount(0);
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('cannot');
  await old.getByTestId('profile-earlier-folder').click();
  await expect(page.getByTestId('profiles-message')).toContainText('Opened the folder in Explorer');
  expect(await fs.readdir(path.join(dataRoot, 'profiles'))).toEqual([OLD]);
});
