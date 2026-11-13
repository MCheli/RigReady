import { expect, test } from './harness';

/**
 * The first run on a PC with DCS says that the bindings DCS already has are read as they are:
 * nothing to import. A PC without DCS is not told about DCS at all.
 */

const STICK = 'WINWING Orion Joystick Base 2 + JGRIP-F16';
const SENTENCE =
  "RigReady reads the DCS bindings you already have from DCS's own files, so there is nothing to import.";

test('welcome: a PC with DCS is told its DCS bindings are read as they are, and a racing PC is not told about DCS', async ({
  rig,
}) => {
  const flying = await rig.launch('flying-fresh', 'welcome-dcs-bindings');
  await expect(flying.page.getByTestId('welcome-games')).toContainText('DCS');
  await expect(flying.page.getByTestId('welcome-dcs-bindings')).toHaveText(SENTENCE);
  await flying.shot('welcome-with-dcs');

  // And it is so, before any setup exists: the bindings page shows the stick's bindings as
  // the files under Saved Games have them, the user's own among them.
  await flying.page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash =
      '#/configure/dcs-bindings';
  });
  await expect(flying.page.getByTestId('bindings-aircraft')).toContainText('F/A-18C');
  const stick = flying.page.locator('[data-testid="ov-device"][data-device="' + STICK + '"]');
  await expect(stick.getByTestId('ov-device-summary')).toContainText('24 of yours');
  await flying.shot('bindings-already-there');
  await flying.app.close();

  const racing = await rig.launch('shell-racing-pc', 'welcome-no-dcs');
  await expect(racing.page.getByTestId('welcome-games')).toContainText('iRacing');
  await expect(racing.page.getByTestId('fly-empty')).toBeVisible();
  await expect(racing.page.getByTestId('welcome-dcs-bindings')).toHaveCount(0);
  await expect(racing.page.getByTestId('fly-empty')).not.toContainText('DCS');
  await racing.shot('welcome-racing-pc');
});
