import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test } from './harness';

/**
 * The input tester and a wheel base on the recorded rig.
 *
 * First the swap the owner made at his rig: the flight gear is unplugged and the wheel base
 * plugged in while RigReady runs, so the base gets the controller number the button box had.
 * The tester must name the base, and never a device that is gone.
 *
 * Then the wheel view: the base is drawn as a wheel and pedals, and its axes go by the names
 * the Wheel page uses.
 */

interface Controller {
  index: number;
  name: string;
  axes: number;
  buttons: number;
  hats: number;
}

/** As DirectInput lists them with the wheel base unplugged (devices-flying-then-wheel.yaml). */
const BOX: Controller = { index: 0, name: 'R-VPC Panel #1', axes: 2, buttons: 41, hats: 0 };
const RUDDER: Controller = { index: 1, name: 'T-Pendular-Rudder', axes: 3, buttons: 0, hats: 0 };
/** The wheel base: the first controller when it is plugged in. */
const BASE: Controller = {
  index: 0,
  name: 'FANATEC Podium Wheel Base DD2',
  axes: 8,
  buttons: 108,
  hats: 1,
};
/** Its axes by position: X, Y, Z, RX, RY, RZ, SLIDER1, SLIDER2. */
const WHEEL = 0;
/** "Combined Pedals" to the driver; the clutch while the pedals are separate. */
const Y = 1;
const ACCELERATOR = 2;
const BRAKE = 5;
const CLUTCH = 6;
/** The pedals at rest, as the first reading has them. */
const AT_REST = { [ACCELERATOR]: -1, [BRAKE]: -1, [CLUTCH]: -1 };

let clock = 1_000;
function state(c: Controller, input: { pressed?: number[]; axes?: Record<number, number> } = {}) {
  return {
    index: c.index,
    name: c.name,
    axes: Array.from({ length: c.axes }, (_, i) => input.axes?.[i] ?? 0),
    // Buttons as games number them: Button 1 is index 0.
    buttons: Array.from({ length: c.buttons }, (_, i) => input.pressed?.includes(i + 1) ?? false),
    hats: Array.from({ length: c.hats }, (): [number, number] => [0, 0]),
    timestamp: clock++,
  };
}

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

const card = (page: Page, index: number) =>
  page.locator(`[data-testid="compact-controller"][data-index="${index}"]`);

/** The page as it is now: readable, every control named, no state said by colour alone. */
async function problemsOn(page: Page): Promise<unknown[]> {
  return [...(await axeViolations(page)), ...(await colourOnlyStatus(page))];
}

test('devices: after the flight gear is swapped for the wheel, the tester names the wheel base and never a device that is gone', async ({
  rig,
}) => {
  const { page, shot, mutate, sendInput } = await rig.launch(
    'devices-flying-then-wheel',
    'devices-swap-to-wheel'
  );
  const log = page.getByTestId('log-entry');
  const linesOf = (name: string) => log.filter({ hasText: name });

  // Flying: the Devices list and the tester are opened, so the app has read the flight gear.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-devices').click();
  await expect(page.locator(`[data-testid="device-row"][data-name="${BOX.name}"]`)).toBeVisible();
  await page.getByTestId('devices-tab-test').click();
  await expect(page.getByTestId('tester-page')).toHaveAttribute('data-live', 'true');
  await expect(page.getByTestId('compact-controller')).toHaveCount(11);
  await expect(card(page, 0)).toHaveAttribute('data-name', BOX.name);
  await expect(card(page, 1)).toHaveAttribute('data-name', RUDDER.name);
  await sendInput([state(BOX), state(RUDDER)]);
  await expect(card(page, 1)).toContainText('Nothing pressed');
  await sendInput([state(BOX, { pressed: [3] })]);
  await expect(card(page, 0)).toContainText('Button 3');
  await sendInput([state(RUDDER, { axes: { 1: 0.6 } })]);
  await expect(linesOf(BOX.name)).toHaveCount(1);
  await expect(linesOf(BOX.name)).toContainText('Button 3 pressed');
  await expect(linesOf(RUDDER.name)).toHaveCount(1);
  await expect(linesOf(RUDDER.name)).toContainText('Y axis moved');
  await shot('flying');

  // Over to the Wheel page. The swap is made while that page is open, as at the rig: the
  // flight gear goes, the wheel base comes and gets the number the button box had.
  await go(page, '/configure/racing/wheel');
  const status = page.getByTestId('wheel-status');
  await expect(status).not.toHaveAttribute('data-state', 'connected');
  await mutate([
    { op: 'unplugDevice', match: { vendorId: '3344', productId: 'C259' } },
    { op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } },
    { op: 'unplugDevice', match: { vendorId: '4098' } },
    { op: 'plugDevice', match: { vendorId: '0EB7', productId: '0007' } },
  ]);
  await expect(status).toHaveAttribute('data-state', 'connected');

  // The tester, opened from the Wheel page's link: one controller, under its own name and
  // with its own counts. No card and no chip carries the name of a device that is gone.
  await page.getByTestId('wheel-axes-note').getByRole('link', { name: 'input tester' }).click();
  await expect(page.getByTestId('tester-page')).toHaveAttribute('data-live', 'true');
  await expect(page.getByTestId('compact-controller')).toHaveCount(1);
  await expect(card(page, 0)).toHaveAttribute('data-name', BASE.name);
  await expect(card(page, 0)).toContainText('8 axes · 108 buttons · 1 hat');
  await expect(page.getByTestId('tester-pick')).toHaveCount(1);
  await expect(page.getByTestId('tester-pick')).toHaveText(BASE.name);
  await expect(page.getByTestId('tester-all-list')).not.toContainText(BOX.name);
  await expect(page.getByTestId('tester-all-list')).not.toContainText(RUDDER.name);
  // Nothing the button box did shows on the base's card: the base has sent nothing yet.
  await expect(card(page, 0)).toContainText('No input yet');
  await expect(card(page, 0)).not.toContainText('Button 3');
  await expect(page.getByTestId('tester-last-input')).toContainText('nothing yet');
  await shot('wheel-named');

  // The wheel is turned and a button pressed: the lines are the base's, with the wheel's own
  // axis name. What the flight gear did before stays under its own names, and nothing new
  // is written under them.
  await sendInput([state(BASE, { axes: AT_REST })]);
  await expect(card(page, 0)).toContainText('Nothing pressed');
  await sendInput([state(BASE, { axes: { ...AT_REST, [WHEEL]: 0.4 } })]);
  await expect(page.getByTestId('tester-last-input')).toContainText(`${BASE.name}: Wheel moved`);
  await sendInput([state(BASE, { axes: { ...AT_REST, [WHEEL]: 0.4 }, pressed: [2] })]);
  await expect(page.getByTestId('tester-last-input')).toContainText(
    `${BASE.name}: Button 2 pressed`
  );
  await expect(linesOf(BASE.name)).toHaveCount(2);
  await expect(card(page, 0)).toContainText('Button 2');
  await expect(linesOf(BOX.name)).toHaveCount(1);
  await expect(linesOf(RUDDER.name)).toHaveCount(1);
  await shot('wheel-input');

  // A plug while the tester is open: the button box comes back and is listed by itself, with
  // the next number. The base keeps its name and what it holds.
  await mutate([{ op: 'plugDevice', match: { vendorId: '3344', productId: 'C259' } }]);
  await expect(page.getByTestId('compact-controller')).toHaveCount(2);
  await expect(card(page, 0)).toHaveAttribute('data-name', BASE.name);
  await expect(card(page, 1)).toHaveAttribute('data-name', BOX.name);
  await expect(card(page, 1)).toContainText('2 axes · 41 buttons');

  // An unplug while the base's own view is open: the base goes and the button box gets its
  // number. The view says the base is gone. It does not pass to the button box.
  const title = page.locator('.tester-title');
  await card(page, 0).click();
  await expect(title).toHaveText(BASE.name);
  await expect(page.getByTestId('tester-wheel')).toBeVisible();
  await mutate([{ op: 'unplugDevice', match: { vendorId: '0EB7', productId: '0007' } }]);
  await expect(page.getByTestId('tester-pick')).toHaveCount(1);
  await expect(page.getByTestId('tester-pick')).toHaveText(BOX.name);
  await expect(page.getByTestId('tester-page')).toContainText(
    'That controller is not connected any more.'
  );
  await expect(title).toHaveCount(0);
  await expect(page.getByTestId('controller-view')).toHaveCount(0);
  await shot('wheel-gone');
  expect(await problemsOn(page)).toEqual([]);

  // All controllers: the one card is the button box's, and the button the base held is not
  // shown on it. What the base wrote stays in the list under the base's name.
  await page.getByRole('button', { name: 'Show all controllers' }).click();
  await expect(page.getByTestId('compact-controller')).toHaveCount(1);
  await expect(card(page, 0)).toHaveAttribute('data-name', BOX.name);
  await expect(card(page, 0)).toContainText('2 axes · 41 buttons');
  await expect(card(page, 0)).toContainText('No input yet');
  await expect(card(page, 0)).not.toContainText('Button 2');
  await sendInput([state(BOX)]);
  await expect(card(page, 0)).toContainText('Nothing pressed');
  await sendInput([state(BOX, { pressed: [7] })]);
  await expect(page.getByTestId('tester-last-input')).toContainText(
    `${BOX.name}: Button 7 pressed`
  );
  await expect(linesOf(BASE.name)).toHaveCount(2);
  await shot('box-after-wheel');

  // The other way round: the base is back with the next number and its view is open when
  // the button box is unplugged. The base gets the first number, and the view stays with it.
  await mutate([{ op: 'plugDevice', match: { vendorId: '0EB7', productId: '0007' } }]);
  await expect(card(page, 1)).toHaveAttribute('data-name', BASE.name);
  await card(page, 1).click();
  await expect(title).toHaveText(BASE.name);
  await expect(page.getByTestId('controller-view')).toHaveAttribute('data-index', '1');
  await mutate([{ op: 'unplugDevice', match: { vendorId: '3344', productId: 'C259' } }]);
  await expect(page.getByTestId('controller-view')).toHaveAttribute('data-index', '0');
  await expect(title).toHaveText(BASE.name);
  await expect(page).toHaveURL(/controller=0/);
  // Button 7 was the button box's: it is not shown as held on the base.
  await expect(page.locator('[data-testid="button"][data-pressed="true"]')).toHaveCount(0);
});

test('devices: the input tester draws a wheel base as a wheel and pedals, with the names the Wheel page uses', async ({
  rig,
}) => {
  const { page, shot, sendInput } = await rig.launch('devices-rig', 'devices-tester-wheel');
  const pedal = (name: string) =>
    page.locator(`[data-testid="tester-pedal"][data-pedal="${name}"]`);
  const axis = (name: string) => page.locator(`[data-testid="axis"][data-axis="${name}"]`);

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-devices').click();
  await page.getByTestId('devices-tab-test').click();
  await expect(page.getByTestId('compact-controller')).toHaveCount(12);
  await card(page, BASE.index).click();

  // The wheel base has its own picture in place of the stick plot.
  await expect(page.getByTestId('tester-wheel')).toBeVisible();
  await expect(page.getByTestId('plot-section')).toHaveCount(0);

  // At rest: the wheel straight, the three pedals by name from left to right, none pressed.
  await sendInput([state(BASE, { axes: AT_REST })]);
  await expect(page.getByTestId('tester-wheel-steering')).toHaveText('Centre');
  await expect(page.getByTestId('tester-wheel-rim')).toHaveAttribute('data-side', 'centre');
  await expect(page.getByTestId('tester-pedal')).toHaveCount(3);
  expect(
    await page
      .getByTestId('tester-pedal')
      .evaluateAll((all) => all.map((p) => p.getAttribute('data-pedal')))
  ).toEqual(['Clutch', 'Brake', 'Accelerator']);
  for (const name of ['Clutch', 'Brake', 'Accelerator'])
    await expect(pedal(name)).toHaveAttribute('data-percent', '0');

  // Turned to the left with the accelerator and the brake pressed part of the way.
  await sendInput([
    state(BASE, { axes: { [WHEEL]: -0.37, [ACCELERATOR]: 0.5, [BRAKE]: -0.2, [CLUTCH]: -1 } }),
  ]);
  await expect(page.getByTestId('tester-wheel-steering')).toHaveText('Left 37%');
  await expect(page.getByTestId('tester-wheel-rim')).toHaveAttribute('data-side', 'left');
  await expect(pedal('Accelerator')).toHaveAttribute('data-percent', '75');
  await expect(pedal('Accelerator')).toContainText('75%');
  await expect(pedal('Brake')).toHaveAttribute('data-percent', '40');
  await expect(pedal('Clutch')).toHaveAttribute('data-percent', '0');

  // The axes below go by the names the Wheel page uses, each with what Windows calls it.
  // The two axes no source names keep the Windows name.
  for (const name of [
    'Wheel',
    'Clutch or combined pedals',
    'Accelerator',
    'Brake',
    'Clutch',
    'Dial',
  ])
    await expect(axis(name)).toHaveCount(1);
  await expect(axis('Wheel').getByTestId('axis-windows')).toHaveText('X axis');
  await expect(axis('Brake').getByTestId('axis-windows')).toHaveText('Z rotation');
  await expect(axis('X rotation')).toHaveCount(1);
  await expect(axis('X rotation').getByTestId('axis-windows')).toHaveCount(0);
  // The activity list uses the same names.
  await expect(page.getByTestId('tester-log')).toContainText('Wheel moved');
  await expect(page.getByTestId('tester-log')).toContainText('Accelerator moved');
  await expect(page.getByTestId('tester-log')).toContainText('Brake moved');
  await expect(page.getByTestId('tester-wheel-note')).toContainText('not degrees');
  await shot('wheel-view');
  expect(await problemsOn(page)).toEqual([]);

  // The end of the travel reads 100%.
  await sendInput([
    state(BASE, { axes: { [WHEEL]: 1, [ACCELERATOR]: 1, [BRAKE]: -1, [CLUTCH]: -1 } }),
  ]);
  await expect(page.getByTestId('tester-wheel-steering')).toHaveText('Right 100%');
  await expect(page.getByTestId('tester-wheel-rim')).toHaveAttribute('data-side', 'right');
  await expect(pedal('Accelerator')).toHaveAttribute('data-percent', '100');
  await expect(pedal('Brake')).toHaveAttribute('data-percent', '0');

  // Raw values: the number Windows reports, next to the words.
  await page.getByTestId('tester-raw').locator('input').check();
  await expect(page.getByTestId('tester-wheel-steering')).toContainText('· Right 100%');
  await expect(page.getByTestId('tester-wheel-steering')).toContainText('65535');
  await shot('wheel-view-raw');
  await page.getByTestId('tester-raw').locator('input').uncheck();

  // A stick keeps the plot of two axes: the wheel view is for a wheel base only.
  await page.getByTestId('tester-pick').filter({ hasText: 'Orion Joystick Base 2' }).click();
  await expect(page.getByTestId('plot-section')).toBeVisible();
  await expect(page.getByTestId('tester-wheel')).toHaveCount(0);
});

test('devices: with the pedals separate, the clutch on Y fills the Clutch bar and is never called combined pedals alone', async ({
  rig,
}) => {
  const { page, shot, sendInput } = await rig.launch('devices-rig', 'devices-tester-clutch');
  const pedal = (name: string) =>
    page.locator(`[data-testid="tester-pedal"][data-pedal="${name}"]`);
  const axis = (name: string) => page.locator(`[data-testid="axis"][data-axis="${name}"]`);

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-devices').click();
  await page.getByTestId('devices-tab-test').click();
  await expect(page.getByTestId('compact-controller')).toHaveCount(12);
  await card(page, BASE.index).click();
  await expect(page.getByTestId('tester-wheel')).toBeVisible();

  // As the base read at the second look: every pedal rests high, Slider 1 at 100% and still,
  // the dial at 50%. Nothing pressed, so every bar reads 0%.
  const REST = { [WHEEL]: 0, [Y]: 1, [ACCELERATOR]: 1, [BRAKE]: 1, [CLUTCH]: 1, 7: 0 };
  await sendInput([state(BASE, { axes: REST })]);
  for (const name of ['Clutch', 'Brake', 'Accelerator'])
    await expect(pedal(name)).toHaveAttribute('data-percent', '0');
  await expect(page.getByTestId('tester-wheel-note')).toContainText(
    "The clutch is on the Y axis or on Slider 1, depending on the base's pedal mode, which Windows does not report. The Clutch bar reads the one that moves."
  );

  // The clutch pressed all the way: Y falls from its rest, Slider 1 does not move.
  await sendInput([state(BASE, { axes: { ...REST, [Y]: -1 } })]);
  await expect(pedal('Clutch')).toHaveAttribute('data-percent', '100');
  await expect(pedal('Clutch')).toHaveAttribute('data-axis', 'Y');
  await expect(pedal('Clutch')).toContainText('100%');
  await expect(pedal('Clutch').getByTestId('tester-pedal-from')).toHaveText('Y axis');
  await expect(pedal('Brake')).toHaveAttribute('data-percent', '0');
  await expect(pedal('Accelerator')).toHaveAttribute('data-percent', '0');
  // The axis keeps a name that is true in either pedal mode, and so does the activity list.
  await expect(axis('Clutch or combined pedals')).toHaveCount(1);
  await expect(axis('Clutch or combined pedals').getByTestId('axis-windows')).toHaveText('Y axis');
  await expect(page.getByTestId('tester-last-input')).toContainText(
    'Clutch or combined pedals moved 100% → 0%'
  );
  // Case matters: "Clutch or combined pedals" is the only way the log names Y.
  await expect(page.getByTestId('tester-log')).not.toContainText('Combined pedals');
  await shot('clutch-pressed');
  expect(await problemsOn(page)).toEqual([]);

  // Half way back, and let go.
  await sendInput([state(BASE, { axes: { ...REST, [Y]: 0 } })]);
  await expect(pedal('Clutch')).toHaveAttribute('data-percent', '50');
  await sendInput([state(BASE, { axes: REST })]);
  await expect(pedal('Clutch')).toHaveAttribute('data-percent', '0');
  await expect(pedal('Clutch')).toHaveAttribute('data-axis', 'Y');
});
