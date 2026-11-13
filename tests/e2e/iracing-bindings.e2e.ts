import type { Locator, Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, openOption, test } from './harness';

/**
 * iRacing bindings: every action of a binding set and what it is bound to, for all cars and
 * for a car with custom controls. The page reads; it has nothing that changes a binding.
 */

const ROUTE = '/configure/iracing-bindings';
const WHEEL = 'FANATEC Podium Wheel Base DD2';
const CAR = 'mx5 mx52016';

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);
const hash = (page: Page): Promise<string> =>
  page.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash);

const rows = (page: Page): Locator => page.getByTestId('iracing-bindings-row');
const row = (page: Page, action: string): Locator =>
  page.locator(`[data-testid="iracing-bindings-row"][data-action="${action}"]`);
const device = (page: Page, name: string): Locator =>
  page.getByTestId('iracing-bindings-device').filter({ hasText: name });
const deviceFilter = (page: Page, name: string): Locator =>
  page.getByTestId('iracing-bindings-device-filter').filter({ hasText: name });
const shown = (page: Page): Locator => page.getByTestId('iracing-bindings-shown');

test('iRacing bindings: every action for all cars, with search, filters and shared inputs', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('iracing-bindings-car', 'iracing-bindings-all-cars');
  await page.getByTestId('mode-configure').click();

  // The page is reached from the command palette; the game picker will give it a place later.
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.type('iRacing bindings');
  await expect(
    page.locator('[data-testid="palette-row"][aria-selected="true"] .rr-palette-title')
  ).toHaveText('iRacing bindings');
  await page.keyboard.press('Enter');

  const root = page.getByTestId('iracing-bindings-page');
  await expect(root.locator('.rr-page-title')).toHaveText('iRacing bindings');
  await expect(page.getByTestId('iracing-bindings-set')).toContainText('All cars');
  await expect(page.getByTestId('iracing-bindings-cars-line')).toHaveText(
    '2 cars have a folder in iRacing. 1 has custom controls; the others use the bindings for all cars.'
  );
  await expect(page.getByTestId('iracing-bindings-counts')).toHaveText(
    '367 actions · 183 bound · 184 not bound'
  );
  await expect(shown(page)).toHaveText('Showing 367 of 367');
  await expect(rows(page)).toHaveCount(367);
  await expect(page.getByTestId('iracing-bindings-file')).toContainText(
    'Documents\\iRacing\\controls.cfg'
  );

  // The controllers the set names, matched to what is plugged in.
  await expect(page.getByTestId('iracing-bindings-device')).toHaveCount(2);
  await expect(device(page, WHEEL)).toHaveAttribute('data-state', 'connected');
  await expect(device(page, WHEEL)).toContainText('17 actions bound · USB 0EB7:0007');
  await expect(device(page, WHEEL).getByTestId('iracing-bindings-device-state')).toHaveText(
    'Connected'
  );
  await expect(device(page, 'Keyboard')).toContainText('166 actions bound');

  // An axis, a button and a key, in plain words; an action with nothing on it says so.
  await expect(row(page, 'Throttle')).toContainText('Throttle');
  await expect(row(page, 'Throttle')).toContainText(WHEEL);
  await expect(row(page, 'Throttle')).toHaveAttribute('data-bound', 'yes');
  await expect(row(page, 'Handbrake')).toContainText('Not bound');
  await expect(row(page, 'Handbrake')).toHaveAttribute('data-bound', 'no');
  await shot('all-cars');
  await row(page, 'ShiftDown').scrollIntoViewIfNeeded();
  await shot('actions');

  // Reading only, and the page says why.
  const readonly = page.getByTestId('iracing-bindings-readonly');
  await expect(readonly).toContainText('This page shows bindings. It does not change them.');
  await expect(readonly).toContainText('use iRacing itself: Options, then Controls');
  await page.getByTestId('iracing-bindings-why').click();
  const reasons = page.getByTestId('iracing-bindings-reasons');
  await expect(reasons.locator('li')).toHaveCount(5);
  await expect(reasons).toContainText('iRacing does not publish how controls.cfg is built');
  await expect(reasons).toContainText('No file changed by RigReady has been tried in iRacing');
  await shot('why-read-only');
  // Nothing in the list can be pressed or typed into, and no button offers a change.
  await expect(
    page.getByTestId('iracing-bindings-table').locator('button, input, select, a')
  ).toHaveCount(0);
  const buttons = await root.getByRole('button').allInnerTexts();
  expect(
    buttons.filter((name) =>
      /^(edit|bind|rebind|assign|save|apply|clear|remove|delete|copy)/i.test(name)
    )
  ).toEqual([]);
  await page.getByTestId('iracing-bindings-why').click();
  await expect(reasons).toHaveCount(0);

  // Search by the name of an action, by iRacing's own id, and by the name of a controller.
  const filter = page.getByTestId('iracing-bindings-filter').locator('input');
  await filter.fill('pit speed');
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'PitSpeedLimiter')).toContainText('Pit speed limiter');
  await expect(shown(page)).toHaveText('Showing 1 of 367');
  await row(page, 'PitSpeedLimiter').scrollIntoViewIfNeeded();
  await shot('search');
  await filter.fill('telltalereset');
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'TellTaleReset')).toContainText('Reset tell-tale');
  await filter.fill('podium');
  await expect(shown(page)).toHaveText('Showing 17 of 367');
  await filter.fill('no such action');
  await expect(page.getByTestId('iracing-bindings-nothing')).toHaveText('Nothing matches.');
  await expect(shown(page)).toHaveText('Showing 0 of 367');
  await filter.fill('');

  // The actions with nothing bound, and the ones on one controller.
  await page.getByTestId('iracing-bindings-only-unbound').click();
  await expect(shown(page)).toHaveText('Showing 184 of 367');
  await expect(page.locator('[data-testid="iracing-bindings-row"][data-bound="yes"]')).toHaveCount(
    0
  );
  await row(page, 'Handbrake').scrollIntoViewIfNeeded();
  await shot('not-bound');
  await deviceFilter(page, WHEEL).click();
  await expect(shown(page)).toHaveText('Showing 17 of 367');
  await expect(page.getByTestId('iracing-bindings-only-unbound')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expect(page.locator('[data-testid="iracing-bindings-row"][data-bound="no"]')).toHaveCount(
    0
  );
  await row(page, 'ShiftDown').scrollIntoViewIfNeeded();
  await shot('on-the-wheel');
  await deviceFilter(page, WHEEL).click();
  await expect(shown(page)).toHaveText('Showing 367 of 367');

  // Inputs that do more than one thing. iRacing's own keys share with its camera editor;
  // those are listed apart, and only on request.
  const shared = page.getByTestId('iracing-bindings-shared');
  await expect(shared.getByTestId('iracing-bindings-shared-row')).toHaveCount(1);
  await expect(shared.getByTestId('iracing-bindings-shared-row')).toContainText('Space');
  await expect(page.getByTestId('iracing-bindings-camera-line')).toContainText(
    '9 more inputs are shared with iRacing’s camera editor'
  );
  await expect(page.getByTestId('iracing-bindings-camera-row')).toHaveCount(0);
  await page.getByTestId('iracing-bindings-camera-toggle').click();
  await expect(page.getByTestId('iracing-bindings-camera-row')).toHaveCount(9);
  await shared.scrollIntoViewIfNeeded();
  await shot('shared-inputs');

  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
});

test('iRacing bindings: a car with custom controls, and what it changes', async ({ rig }) => {
  const { page, shot } = await rig.launch('iracing-bindings-car', 'iracing-bindings-car');
  await page.getByTestId('mode-configure').click();
  await go(page, ROUTE);
  await expect(page.getByTestId('iracing-bindings-counts')).toContainText('367 actions');
  // Nothing about a car differs from itself: the filter is for car sets only.
  await expect(page.getByTestId('iracing-bindings-only-differs')).toHaveCount(0);

  await page.getByTestId('iracing-bindings-set').click();
  await expect(page.locator('.v-overlay--active').getByRole('option')).toHaveText([
    'All cars',
    `${CAR} (custom controls)`,
  ]);
  await openOption(page, `${CAR} (custom controls)`).click();
  await expect(page.getByTestId('iracing-bindings-counts')).toHaveText(
    '367 actions · 186 bound · 181 not bound · 8 differ from All cars'
  );
  await expect(page.getByTestId('iracing-bindings-file')).toContainText(
    `Documents\\iRacing\\setups\\${CAR}\\controls.cfg`
  );
  expect(decodeURIComponent((await hash(page)).replace(/[+]/g, ' '))).toBe(
    `#${ROUTE}?set=car:${CAR}`
  );

  // The car's controllers: the button box is plugged in, the handbrake is not.
  await expect(page.getByTestId('iracing-bindings-device')).toHaveCount(4);
  await expect(device(page, 'Button Box')).toHaveAttribute('data-state', 'connected');
  await expect(device(page, 'USB Handbrake')).toHaveAttribute('data-state', 'missing');
  await expect(
    device(page, 'USB Handbrake').getByTestId('iracing-bindings-device-state')
  ).toHaveText('Not connected');
  await expect(device(page, 'USB Handbrake')).toContainText(
    'Not plugged in. Its 1 binding does nothing until it is.'
  );
  // The click on the option can leave the page scrolled; the picture is of the top.
  await page.getByTestId('iracing-bindings-readonly').scrollIntoViewIfNeeded();
  await shot('car');

  // What this car changes, next to what all cars have.
  await page.getByTestId('iracing-bindings-only-differs').click();
  await expect(shown(page)).toHaveText('Showing 8 of 367');
  await expect(page.locator('[data-testid="iracing-bindings-row"][data-differs="no"]')).toHaveCount(
    0
  );
  await expect(row(page, 'Handbrake')).toContainText('USB Handbrake');
  await expect(row(page, 'Handbrake')).toContainText('Not bound');
  await expect(row(page, 'BrakeBiasInc')).toContainText('Button Box');
  await row(page, 'TractionControlInc').scrollIntoViewIfNeeded();
  await shot('car-differs');
  await page.getByTestId('iracing-bindings-only-differs').click();

  // On this car one wheel button does two things while driving; that comes first.
  const shared = page.getByTestId('iracing-bindings-shared-row');
  await expect(shared).toHaveCount(2);
  await expect(shared.first()).toContainText('Button 7');
  await expect(shared.first()).toContainText(WHEEL);
  await expect(shared.first()).toContainText('Pit speed limiter and Flash headlights');
  await page.getByTestId('iracing-bindings-shared').scrollIntoViewIfNeeded();
  await shot('car-shared');

  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);

  // The link keeps the car: opened again from its address, the page shows the same set.
  await go(page, '/configure/games/iracing');
  await expect(page.getByTestId('iracing-bindings-page')).toHaveCount(0);
  await go(page, `${ROUTE}?set=${encodeURIComponent(`car:${CAR}`)}`);
  await expect(page.getByTestId('iracing-bindings-counts')).toContainText('8 differ from All cars');

  // The same bindings as a cheat sheet.
  await page.getByTestId('iracing-bindings-cheat-sheet').click();
  await expect(page.getByTestId('cheat-sheets-page')).toBeVisible();
  await expect(page.getByTestId('sheet-aircraft')).toContainText(CAR);
  await shot('car-cheat-sheet');
});

test('iRacing bindings: a wheel with a new Windows id, and the simulator running', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch(
    'racing-iracing-moved-wheel',
    'iracing-bindings-moved-wheel'
  );
  await page.getByTestId('mode-configure').click();
  await go(page, ROUTE);

  const wheel = device(page, WHEEL);
  await expect(wheel).toHaveAttribute('data-state', 'moved');
  await expect(wheel.getByTestId('iracing-bindings-device-state')).toHaveText('New Windows id');
  await expect(wheel).toContainText('Windows now gives this controller a different id');
  await expect(page.getByTestId('iracing-bindings-running')).toHaveCount(0);
  await shot('new-windows-id');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);

  // The repair is on the iRacing page, which the link opens.
  await page.getByTestId('iracing-bindings-repair-link').click();
  await expect(page.getByTestId('iracing-page')).toBeVisible();

  // iRacing writes its files when it closes: while it runs, the page says it may be behind.
  await mutate([
    {
      op: 'startProcess',
      name: 'iRacingSim64DX11.exe',
      path: 'C:\\iRacing\\iRacingSim64DX11.exe',
    },
  ]);
  await go(page, ROUTE);
  await expect(page.getByTestId('iracing-bindings-running')).toContainText(
    'The iRacing simulator is running. It writes its files when it closes'
  );
  await shot('simulator-running');
});

test('iRacing bindings: a PC without iRacing gets a plain "not found", and no list', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('generic-fresh', 'iracing-bindings-not-here');
  await page.getByTestId('mode-configure').click();
  await go(page, ROUTE);
  const root = page.getByTestId('iracing-bindings-page');
  await expect(root.locator('.rr-page-title')).toHaveText('iRacing bindings');
  await expect(root.locator('.rr-page-sub')).toContainText('Every action in iRacing');
  await expect(root).toContainText('iRacing was not found on this PC');
  await expect(root).toContainText('iRacing game page');
  // The same three lines as on every page about a game this PC does not have.
  await expect(root.getByTestId('not-here-title')).toHaveText('iRacing was not found on this PC');
  await expect(root.getByTestId('not-here-looked')).toContainText(/RigReady looked in .+\./);
  await expect(root.getByTestId('not-here-next')).toContainText(
    'Install iRacing and start it once; this page then fills in by itself.'
  );
  await expect(page.locator('.v-alert.text-error, .v-alert.bg-error')).toHaveCount(0);
  await expect(page.getByTestId('iracing-bindings-error')).toHaveCount(0);
  await expect(page.getByTestId('iracing-bindings-table')).toHaveCount(0);
  await expect(page.getByTestId('iracing-bindings-readonly')).toHaveCount(0);
  await expect(page.getByTestId('iracing-bindings-cheat-sheet')).toHaveCount(0);
  await shot('not-on-this-pc');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
});
