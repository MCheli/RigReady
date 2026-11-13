import { promises as fs } from 'node:fs';
import path from 'node:path';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test } from './harness';

/**
 * The racing feature's iRacing page on iRacing 2026 Season 3 and later, which keeps its
 * bindings in a control profile that app.ini names. The page reads the profile, the id repair
 * writes the profile, and the older Documents\iRacing\controls.cfg is neither shown nor changed.
 */

const WHEEL = 'FANATEC Podium Wheel Base DD2';
/** The connected wheel's id in the scenario (made up). */
const NEW = 'A1B2C3D4-5E6F-11F1-8001-444553540000';
const OLD = '45D4BEA1-60A1-17D8-8001-444553540000';

test('racing: iRacing with a control profile, read and repaired in the profile', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch(
    'racing-iracing-profiles-moved-wheel',
    'racing-iracing-profiles'
  );
  const documents = path.join(home, 'Documents', 'iRacing');
  const profile = path.join(documents, 'profiles', 'controls', 'Baseline');
  const olderCfg = await fs.readFile(path.join(documents, 'controls.cfg'));
  const olderCalibration = await fs.readFile(path.join(documents, 'joyCalib.yaml'), 'utf8');

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-games').click();
  await page.getByTestId('game-card-racing').click();
  const card = page.locator('[data-testid="racing-game-card"][data-game="iracing"]');
  await expect(card).toContainText('1 controller has a new Windows id');
  await card.click();

  await expect(page.getByTestId('iracing-folder')).toHaveText(profile);
  await expect(page.getByTestId('iracing-source')).toHaveText(
    'iRacing keeps bindings in control profiles. It uses the profile “Baseline” for all cars. The older controls.cfg from before control profiles is not read by iRacing any more, so this page does not show it or change it.'
  );
  const device = page.getByTestId('iracing-device');
  await expect(device).toHaveAttribute('data-state', 'moved');
  await expect(device).toContainText(WHEEL);
  await shot('profile');

  // The black box actions by iRacing's own names.
  await page.getByTestId('iracing-filter').locator('input').fill('black box');
  const row = (label: string) =>
    page.locator('[data-testid="binding-row"]').filter({ hasText: label });
  await expect(row('Black box next control').locator('.rc-input')).toHaveText('Down');
  await expect(page.getByTestId('iracing-bindings')).not.toContainText('Black box show next');
  await shot('black-box-names');
  await page.getByTestId('iracing-filter').locator('input').fill('');

  // The repair names the profile and lists only its files.
  await page.getByTestId('iracing-repair').click();
  const confirm = page.getByTestId('iracing-repair-confirm');
  await expect(confirm).toContainText(
    `RigReady replaces the old id of ${WHEEL} with the new one in these files of the control profile “Baseline” (17 bindings and its calibration).`
  );
  await expect(confirm).toContainText('profiles/controls/Baseline/controls.cfg');
  await expect(confirm).toContainText('profiles/controls/Baseline/joyCalib.yaml');
  await shot('confirm');
  await page.getByTestId('iracing-repair-go').click();
  await expect(page.getByTestId('iracing-message')).toHaveText(
    `Updated 17 bindings in the control profile “Baseline” and the calibration of ${WHEEL}. Undo is on the Safety page.`
  );
  await expect(device).toHaveAttribute('data-state', 'connected');
  await shot('repaired');

  // The profile holds the new id; the older files are as they were.
  expect(await fs.readFile(path.join(profile, 'joyCalib.yaml'), 'utf8')).toContain(`{${NEW}}`);
  expect((await fs.readFile(path.join(documents, 'controls.cfg'))).equals(olderCfg)).toBe(true);
  expect(await fs.readFile(path.join(documents, 'joyCalib.yaml'), 'utf8')).toBe(olderCalibration);
  expect(olderCalibration).toContain(`{${OLD}}`);
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
});

test('racing: iRacing names a control profile that is not there, and the page says so', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch(
    'iracing-bindings-profiles',
    'racing-iracing-profile-missing'
  );
  await mutate([
    {
      op: 'writeFile',
      path: 'Documents/iRacing/app.ini',
      content: '[ControlProfiles]\r\nGlobal=Gone\r\n',
    },
  ]);
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-games').click();
  await page.getByTestId('game-card-racing').click();
  const card = page.locator('[data-testid="racing-game-card"][data-game="iracing"]');
  await expect(card).toContainText('Cannot tell which control profile iRacing uses');
  await card.click();
  await expect(page.getByTestId('iracing-source-problem')).toHaveText(
    'iRacing uses the control profile “Gone” for all cars, but RigReady found no controls.cfg in it. iRacing shows its bindings in Options, then Controls. RigReady does not read or change the older controls.cfg instead, because iRacing no longer uses it.'
  );
  // Nothing from the older file stands in for the profile.
  await expect(page.getByTestId('iracing-device')).toHaveCount(0);
  await expect(page.getByTestId('iracing-bindings')).toHaveCount(0);
  await expect(page.getByTestId('iracing-source')).toHaveCount(0);
  await expect(page.getByTestId('iracing-no-custom-cars')).toHaveCount(0);
  await shot('profile-missing');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
});
