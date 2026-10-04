import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test } from './harness';

/**
 * The quiet suggestion: the racing rig is on the desk and the setup on screen is the
 * F/A-18C. RigReady offers the setup the connected gear is for, and never switches by itself.
 */

const accessible = async (page: Page): Promise<unknown[]> => [
  ...(await axeViolations(page)),
  ...(await colourOnlyStatus(page)),
];

const WHEEL = { vendorId: '0EB7' };

/** The test id of whatever has the keyboard focus. */
const focusedId = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const scope = globalThis as unknown as {
      document: { activeElement: { getAttribute(name: string): string | null } | null };
    };
    return scope.document.activeElement?.getAttribute('data-testid') ?? null;
  });

test('suggestion: with the wheel connected and the flight gear not, the Play screen offers the racing setup, and Switch goes there', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('fly-suggest', 'fly-suggest');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');

  const offer = page.getByTestId('fly-suggestion');
  await expect(offer).toBeVisible();
  await expect(page.getByTestId('fly-suggestion-title')).toHaveText(
    'Wheel connected: switch to iRacing?'
  );
  await expect(page.getByTestId('fly-suggestion-sub')).toHaveText(
    'FANATEC Podium Wheel Base DD2 is here, and 11 devices this setup needs are not.'
  );
  // It only offers: the setup on screen is the one that was there, and nothing ran.
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect(page.getByTestId('fly-activity')).toHaveCount(0);
  // The one action of the screen is still the screen's, on Enter; the offer is not in its way.
  await expect(page.getByTestId('fly-actions')).not.toHaveAttribute('data-primary', 'none');
  expect(await accessible(page)).toEqual([]);
  await shot('the-offer');

  // By keyboard: its two buttons follow one another, and Enter on one is that button's,
  // not the screen's one action.
  await page.getByTestId('fly-suggestion-switch').focus();
  await page.keyboard.press('Tab');
  expect(await focusedId(page)).toBe('fly-suggestion-dismiss');
  await page.keyboard.press('Shift+Tab');
  expect(await focusedId(page)).toBe('fly-suggestion-switch');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('profile-switcher')).toContainText('iRacing');
  await expect(offer).toHaveCount(0);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  // The gear of this setup is here: there is nothing to offer in the other direction.
  await expect(page.getByTestId('fly-dial')).toHaveAttribute('data-total', '7');
  await expect(offer).toHaveCount(0);
  await expect(page.getByTestId('fly-activity')).toHaveCount(0);
  await expect(page.getByTestId('fly-session')).toHaveCount(0);
  // The pointer of the machine the test runs on is not part of the picture.
  await page.mouse.move(2, 2);
  await shot('switched');
});

test('suggestion: Not now is the end of it for that setup, and an offer follows the gear when it is unplugged', async ({
  rig,
}) => {
  const { page, mutate } = await rig.launch('fly-suggest', 'fly-suggest-not-now');
  const offer = page.getByTestId('fly-suggestion');
  await expect(offer).toBeVisible();

  // The wheel is unplugged: no setup's gear is here, so nothing is offered.
  await mutate([{ op: 'unplugDevice', match: WHEEL }]);
  await expect(offer).toHaveCount(0);
  await mutate([{ op: 'plugDevice', match: WHEEL }]);
  await expect(offer).toBeVisible();

  await page.getByTestId('fly-suggestion-dismiss').click();
  await expect(offer).toHaveCount(0);
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  // Checked again, and with the wheel plugged in again: it stays said.
  await page.getByTestId('recheck').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await mutate([{ op: 'unplugDevice', match: WHEEL }]);
  await mutate([{ op: 'plugDevice', match: WHEEL }]);
  await page.getByTestId('recheck').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(offer).toHaveCount(0);

  // Going there by hand and coming back does not bring it up again either.
  await page.getByTestId('profile-switcher').click();
  await page.getByRole('option', { name: 'iRacing' }).click();
  await expect(page.getByTestId('profile-switcher')).toContainText('iRacing');
  await page.getByTestId('profile-switcher').click();
  await page.getByRole('option', { name: 'DCS F/A-18C' }).click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(offer).toHaveCount(0);
});

test('suggestion: a rig whose gear is the setup on screen is offered nothing', async ({ rig }) => {
  // Two flight setups on the flight rig, one device short: the other setup needs it too.
  const { page, mutate } = await rig.launch('fly-two-setups', 'fly-suggest-none');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-suggestion')).toHaveCount(0);
  await mutate([{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(page.getByTestId('fly-suggestion')).toHaveCount(0);
});
