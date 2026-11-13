import { checkRow, expect, test } from './harness';

/**
 * "Wheel and pedals calibrated in iRacing" on the Play screen: passing with the owner's
 * control profile, and warning when new pedals are plugged in that iRacing has not
 * calibrated. The check reads joyCalib.yaml of the profile iRacing uses.
 */

const TITLE = 'Wheel and pedals calibrated in iRacing';

test('racing: the wheel is calibrated in iRacing, and the check passes', async ({ rig }) => {
  const { page, shot } = await rig.launch('racing-iracing-calibrated', 'racing-iracing-calibrated');
  await expect(page.getByTestId('profile-switcher')).toContainText('iRacing');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('group-toggle-files').click();
  const row = checkRow(page, TITLE);
  await expect(row).toHaveAttribute('data-status', 'pass');
  await expect(row.getByTestId('check-summary')).toHaveText(
    'FANATEC Podium Wheel Base DD2 is calibrated in iRacing (control profile “Baseline”)'
  );
  await shot('passing');
});

test('racing: new pedals iRacing has not calibrated, and the check says iRacing will ask', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch(
    'racing-iracing-uncalibrated',
    'racing-iracing-uncalibrated'
  );
  await expect(page.getByTestId('profile-switcher')).toContainText('iRacing');
  const row = checkRow(page, TITLE);
  // A warning: iRacing still starts, and asks to calibrate.
  await expect(row).toHaveAttribute('data-status', 'warn');
  await expect(row.getByTestId('check-summary')).toHaveText(
    'Not calibrated in iRacing (control profile “Baseline”): Load Cell Pedals'
  );
  await expect(row).toContainText(
    'iRacing has no calibration for Load Cell Pedals, so it will ask you to calibrate it. Calibrate in iRacing: Options, then Controls.'
  );
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
  await shot('failing');
});
