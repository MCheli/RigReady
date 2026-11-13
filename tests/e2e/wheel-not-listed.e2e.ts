import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test } from './harness';

/**
 * A wheel base of a model RigReady does not know (fixtures/scenarios/wheel-not-listed.yaml):
 * a generic PC with one joystick and a base whose USB id is not in the table of wheel bases.
 * RigReady says it sees the base and does not know the model, never that there is no base.
 * "My wheel is not listed" then makes it the wheel base of this PC, with what works and
 * what is not available spelled out.
 */

const BASE = 'VRS DirectForce Pro Wheel Base';
const ID = '0483:A355';
/** The sentence the Wheel page used to show for this PC. It was not true. */
const UNTRUE = /No wheel base on this PC/i;

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

/** The page as it is now: readable, every control named, no state said by colour alone. */
async function scan(page: Page, where: string, problems: Record<string, unknown[]>): Promise<void> {
  const found = [...(await axeViolations(page)), ...(await colourOnlyStatus(page))];
  if (found.length > 0) problems[where] = found;
}

test('racing: a wheel base RigReady does not know is seen, named as unknown, then added as my wheel', async ({
  rig,
}) => {
  const { page, shot, mutate, dataRoot } = await rig.launch(
    'wheel-not-listed',
    'racing-wheel-not-listed'
  );
  const stored = path.join(dataRoot, 'racing', 'wheels.json');
  const status = page.getByTestId('wheel-status');
  const problems: Record<string, unknown[]> = {};

  // The Racing page: the base is seen and said to be of a model RigReady does not know. This
  // PC has no racing game, so Games offers no Racing card; the page is opened by its address.
  await page.getByTestId('mode-configure').click();
  await go(page, '/configure/racing');
  const card = page.getByTestId('racing-wheel-card');
  await expect(card).toContainText(`RigReady sees ${BASE}, but does not know this model`);
  await expect(page.getByTestId('racing-wheel-summary')).toContainText(
    'It is connected, but it is not in the list of wheel bases RigReady knows.'
  );
  await expect(page.getByTestId('racing-page')).not.toContainText(UNTRUE);
  await shot('racing-card-seen');
  await scan(page, 'racing page, base seen', problems);

  // The Wheel page says the same, and why it takes the controller for a wheel base.
  await card.click();
  await expect(status).toHaveAttribute('data-state', 'seen');
  await expect(page.getByTestId('wheel-name')).toHaveText(
    `RigReady sees ${BASE}, but does not know this model`
  );
  await expect(page.getByTestId('wheel-mode')).toContainText('Its name says it is a wheel.');
  await expect(page.getByTestId('wheel-mode')).toContainText(
    'It is connected, but it is not in the list of wheel bases RigReady knows.'
  );
  await expect(page.getByTestId('wheel-page')).not.toContainText(UNTRUE);
  // Nothing was added by RigReady itself.
  await expect(page.getByTestId('wheel-mine')).toHaveCount(0);
  await expect(page.getByTestId('wheel-scope')).toHaveCount(0);
  await shot('seen');
  await scan(page, 'wheel page, base seen', problems);

  // "This is my wheel base" opens the picker with that controller chosen. The joystick is
  // there to pick too, and both lists are shown before anything is saved.
  await page.getByTestId('wheel-is-mine').click();
  const add = page.getByTestId('wheel-add');
  await expect(add).toContainText('My wheel is not listed');
  await expect(add).toContainText('It changes no file of a game or of the maker and starts no');
  await expect(page.getByTestId(`wheel-add-pick-${ID}`).locator('input')).toBeChecked();
  await expect(page.getByTestId('wheel-add-list')).toContainText('Logitech Extreme 3D');
  await expect(page.getByTestId('wheel-add-list')).toContainText('3 axes, 12 buttons');
  await expect(page.getByTestId('wheel-add-works').locator('li')).toHaveCount(4);
  await expect(page.getByTestId('wheel-add-not-available').locator('li')).toHaveCount(6);
  await expect(page.getByTestId('wheel-add-not-available')).toContainText(
    'RigReady does not know which program sets this model up'
  );
  await page.getByTestId('wheel-add-maker').locator('input').fill('VRS');
  await add.scrollIntoViewIfNeeded();
  await shot('add');
  await scan(page, 'wheel page, picking the controller', problems);

  // Added: the base is the wheel base of this PC, as a model RigReady does not know.
  await page.getByTestId('wheel-add-confirm').click();
  await expect(page.getByTestId('wheel-changed')).toHaveText(
    `RigReady now treats ${BASE} as your wheel base.`
  );
  await expect(status).toHaveAttribute('data-state', 'connected');
  await expect(status).toHaveAttribute('data-brand', 'none');
  await expect(page.getByTestId('wheel-name')).toHaveText(BASE);
  await expect(page.getByTestId('wheel-mode')).toContainText(
    `VRS · A model RigReady does not know · ${ID}`
  );
  await expect(page.getByTestId('wheel-unlisted')).toContainText(
    'You told RigReady this is your wheel base. RigReady does not know this model'
  );
  await expect(page.getByTestId('wheel-controllers')).toBeVisible();
  await expect(page.getByTestId('wheel-mine-row')).toContainText(
    `Added by you · VRS · ${ID} · Connected`
  );
  await status.scrollIntoViewIfNeeded();
  await shot('my-wheel');

  // What it gets and what it does not, in the same words as before the choice. Nothing that
  // needs a maker's files or settings is shown as if it were there.
  await expect(page.getByTestId('wheel-works')).toHaveCount(4);
  await expect(page.getByTestId('wheel-not-available')).toHaveCount(6);
  await expect(page.getByTestId('wheel-scope')).toContainText('Not available for this model');
  await expect(page.getByTestId('wheel-axis')).toHaveCount(3);
  await expect(page.getByTestId('wheel-software')).toHaveCount(0);
  await expect(page.getByTestId('wheel-no-software')).toHaveCount(0);
  await expect(page.getByTestId('wheel-presets')).toHaveCount(0);
  await expect(page.getByTestId('wheel-recommended')).toHaveCount(0);
  await expect(page.getByTestId('wheel-profiles')).toHaveCount(0);
  await page.getByTestId('wheel-scope').scrollIntoViewIfNeeded();
  await shot('scope');
  await scan(page, 'wheel page, base added', problems);

  // The choice is in RigReady's own data folder, and nowhere else was there to write it.
  const saved = JSON.parse(await fs.readFile(stored, 'utf8')) as {
    wheels: { vendorId: string; productId: string; name: string; maker?: string }[];
  };
  expect(saved.wheels).toHaveLength(1);
  expect(saved.wheels[0]).toMatchObject({
    vendorId: '0483',
    productId: 'A355',
    name: BASE,
    maker: 'VRS',
  });

  // The Racing page and a new setup follow: the base is there, checked as connected.
  await go(page, '/configure/racing');
  await expect(card).toContainText(BASE);
  await expect(page.getByTestId('racing-wheel-summary')).toContainText(
    'VRS · A model RigReady does not know · 1 game controller'
  );
  await shot('racing-card-mine');
  await go(page, '/configure/profiles/capture');
  const offered = page.locator(
    '[data-testid="capture-candidate"][data-title="Wheel base connected"]'
  );
  await expect(offered.getByRole('checkbox')).toBeChecked();
  await expect(
    page.locator('[data-testid="capture-candidate"][data-title="Wheel base in PC mode"]')
  ).toHaveCount(0);
  await offered.scrollIntoViewIfNeeded();
  await shot('capture');

  // Unplugged: the page says which base it waits for. Plugged in again: it is back.
  await go(page, '/configure/racing/wheel');
  await expect(status).toHaveAttribute('data-state', 'connected');
  await mutate([{ op: 'unplugDevice', match: { vendorId: '0483', productId: 'A355' } }]);
  await expect(status).toHaveAttribute('data-state', 'awaited');
  await expect(page.getByTestId('wheel-name')).toHaveText(`${BASE} is not connected`);
  await expect(page.getByTestId('wheel-mine-row')).toContainText('Not connected');
  await expect(page.getByTestId('wheel-page')).not.toContainText(UNTRUE);
  await shot('unplugged');
  await scan(page, 'wheel page, added base unplugged', problems);
  await mutate([{ op: 'plugDevice', match: { vendorId: '0483', productId: 'A355' } }]);
  await expect(status).toHaveAttribute('data-state', 'connected');
  await expect(page.getByTestId('wheel-mine-row')).toContainText('· Connected');

  // Forgotten: back to a controller RigReady sees and does not know.
  await page.getByTestId('wheel-forget').click();
  await expect(page.getByTestId('wheel-changed')).toHaveText(
    `RigReady no longer treats ${BASE} as your wheel base.`
  );
  await expect(status).toHaveAttribute('data-state', 'seen');
  await expect(page.getByTestId('wheel-mine')).toHaveCount(0);
  await expect(page.getByTestId('wheel-scope')).toHaveCount(0);
  expect(
    (JSON.parse(await fs.readFile(stored, 'utf8')) as { wheels: unknown[] }).wheels
  ).toHaveLength(0);
  await shot('forgotten');
  expect(problems).toEqual({});
});

test('racing: with no base plugged in, the Wheel page claims only what RigReady knows', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('generic-fresh', 'racing-wheel-none');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-wheel').click();
  await expect(page.getByTestId('wheel-status')).toHaveAttribute('data-state', 'none');
  await expect(page.getByTestId('wheel-name')).toHaveText(
    'No wheel base RigReady knows is connected'
  );
  await expect(page.getByTestId('wheel-mode')).toContainText(
    'If yours is plugged in and not shown, choose My wheel is not listed.'
  );
  await expect(page.getByTestId('wheel-page')).not.toContainText(UNTRUE);
  await shot('none');

  // The picker without a wheel: the joystick is the only controller. It can be picked, but
  // it is not chosen for the user as if it were a wheel base, and nothing is added unpicked.
  await page.getByTestId('wheel-not-listed').click();
  await expect(page.getByTestId('wheel-add-list')).toContainText('Logitech Extreme 3D');
  await expect(page.getByTestId('wheel-add-list').locator('input:checked')).toHaveCount(0);
  await page.getByTestId('wheel-add-confirm').click();
  await expect(page.getByTestId('wheel-add-error')).toHaveText(
    'Pick the controller that is your wheel base first.'
  );
  await page.getByTestId('wheel-add').scrollIntoViewIfNeeded();
  await shot('picker');
  await page.getByTestId('wheel-add-cancel').click();
  await expect(page.getByTestId('wheel-add')).toHaveCount(0);
  await expect(page.getByTestId('wheel-status')).toHaveAttribute('data-state', 'none');
});
