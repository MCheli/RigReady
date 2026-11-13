import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test } from './harness';

/**
 * "What is this device?" (DEV-017), on a PC with a controller no list of RigReady knows
 * (fixtures/scenarios/devices-unknown-controller.yaml): a home-built wheel that reports
 * itself as "Arduino Leonardo", beside a Logitech stick. The user says on the Devices page
 * that it is a wheel, used for racing. From then on a new racing setup ticks it and a new
 * flight setup does not, and the Play page draws it as a wheel. The answer is kept in
 * RigReady's own data folder, is still there after a restart, and can be taken back.
 */

const BOARD = 'Arduino Leonardo';
const STICK = 'Logitech Extreme 3D';

const deviceRow = (page: Page, name: string): Locator =>
  page.locator(`[data-testid="device-row"][data-name="${name}"]`);
const candidate = (page: Page, title: string): Locator =>
  page.locator(`[data-testid="capture-candidate"][data-title="${title}"]`);
const chip = (page: Page, name: string): Locator =>
  page.locator('[data-testid="rig-device"]').filter({ hasText: name });

async function openDevices(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-devices').click();
  await expect(page.getByTestId('devices-controllers')).toBeVisible();
}

/** Scrolls the Devices page back to its top, so a picture shows a row's head above its form. */
const toTop = (page: Page): Promise<void> =>
  page.getByTestId('devices-page').evaluate((el) => el.scrollIntoView({ block: 'start' }));

/** Picks one choice of a list on the device's row, the way a user does: open it, click the line. */
async function choose(page: Page, row: Locator, list: string, choice: string): Promise<void> {
  await row.getByTestId(list).click();
  await page.getByRole('option', { name: choice, exact: true }).click();
}

/** The page as it is now: readable, every control named, no state said by colour alone. */
async function scan(page: Page, where: string, problems: Record<string, unknown[]>): Promise<void> {
  const found = [...(await axeViolations(page)), ...(await colourOnlyStatus(page))];
  if (found.length > 0) problems[where] = found;
}

test('devices: the user says what an unknown controller is, and new setups and the Play page go by it', async ({
  rig,
}) => {
  const run = await rig.launch('devices-unknown-controller', 'devices-what-is');
  const { page, shot, dataRoot } = run;
  const file = path.join(dataRoot, 'devices.json');
  const stored = async (): Promise<unknown[]> =>
    (JSON.parse(await fs.readFile(file, 'utf8')) as { whatItIs?: unknown[] }).whatItIs ?? [];
  const problems: Record<string, unknown[]> = {};

  // The Devices page: RigReady does not know what the controller is, and says so.
  await openDevices(page);
  const board = deviceRow(page, BOARD);
  await board.locator('button').first().click();
  const kind = board.getByTestId('device-what-kind');
  const use = board.getByTestId('device-what-use');
  await expect(kind).toContainText('Not known');
  await expect(use).toContainText('Not known');
  await expect(kind).toHaveAttribute('data-said', '');
  await expect(use).toHaveAttribute('data-said', '');
  await expect(board.getByTestId('device-what-hint')).toContainText(
    'What you choose stays on this PC.'
  );
  await board.scrollIntoViewIfNeeded();
  await shot('not-known');
  await scan(page, 'devices page, nothing said', problems);

  // What RigReady can read by itself is shown with where it comes from. The stick's name
  // does not say what it is, but its maker's list says flight gear; a keyboard's name says
  // what it is. One row is open at a time.
  const stick = deviceRow(page, STICK);
  await stick.locator('button').first().click();
  await expect(stick.getByTestId('device-what-kind')).toContainText('Not known');
  await expect(stick.getByTestId('device-what-use')).toContainText('Flight, from its maker');
  await stick.scrollIntoViewIfNeeded();
  await shot('read-by-rigready');
  await page.getByTestId('devices-toggle-others').click();
  const keyboard = deviceRow(page, 'USB Keyboard');
  await keyboard.locator('button').first().click();
  await expect(keyboard.getByTestId('device-what-kind')).toContainText('Keyboard, from its name');
  await expect(keyboard.getByTestId('device-what-use')).toContainText('Not known');
  await board.locator('button').first().click();
  await toTop(page);

  // The choices, with RigReady's own reading first.
  await kind.click();
  await expect(page.getByRole('option').first()).toHaveText('Not known');
  await expect(page.getByRole('option', { name: 'Something else', exact: true })).toBeVisible();
  await shot('choices');
  await page.getByRole('option', { name: 'Wheel', exact: true }).click();
  await expect(kind).toHaveAttribute('data-said', 'wheel');
  await choose(page, board, 'device-what-use', 'Racing');
  await expect(use).toHaveAttribute('data-said', 'racing');
  await expect(kind).toContainText('Wheel');
  await expect(use).toContainText('Racing');
  await expect(board.locator('.device-icon')).toHaveClass(/mdi-steering/);
  await expect(board.getByTestId('device-what-error')).toHaveCount(0);

  // Kept in RigReady's own data folder, and nowhere else.
  expect(await stored()).toEqual([
    expect.objectContaining({
      vendorId: '2341',
      productId: '8036',
      kind: 'wheel',
      usedFor: 'racing',
    }),
  ]);
  await toTop(page);
  await shot('said-wheel-for-racing');
  await scan(page, 'devices page, a wheel for racing', problems);

  // A new setup for a racing sim ticks the wheel and leaves the stick; a flight sim, the other way round.
  await page.getByTestId('mode-fly').click();
  await page.getByTestId('fly-create').click();
  await page.getByTestId('capture-game-acc').click();
  await expect(candidate(page, BOARD)).toHaveAttribute('data-kept', 'yes');
  await expect(candidate(page, STICK)).toHaveAttribute('data-kept', 'no');
  await candidate(page, BOARD).scrollIntoViewIfNeeded();
  await shot('new-racing-setup');
  await page.getByTestId('capture-game-msfs2020').click();
  await expect(candidate(page, STICK)).toHaveAttribute('data-kept', 'yes');
  await expect(candidate(page, BOARD)).toHaveAttribute('data-kept', 'no');
  await candidate(page, BOARD).scrollIntoViewIfNeeded();
  await shot('new-flight-setup');

  // The racing setup is saved; the Play page draws the controller as a wheel.
  await page.getByTestId('capture-game-acc').click();
  await expect(candidate(page, BOARD)).toHaveAttribute('data-kept', 'yes');
  await page.getByTestId('capture-name').locator('input').fill('ACC with my wheel');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('profile-switcher')).toContainText('ACC with my wheel');
  await expect(chip(page, BOARD)).toHaveAttribute('data-kind', 'wheel');
  await expect(chip(page, BOARD).locator('.rig-chip-kind')).toHaveClass(/mdi-steering/);
  // The check that follows a new setup has ended, so the picture is the same on every run.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('recheck')).not.toHaveClass(/v-btn--loading/);
  await shot('play-page');

  // The answer is still there after a restart.
  const again = await run.restart();
  await expect(chip(again.page, BOARD)).toHaveAttribute('data-kind', 'wheel');
  await openDevices(again.page);
  const later = deviceRow(again.page, BOARD);
  await later.locator('button').first().click();
  await expect(later.getByTestId('device-what-kind')).toHaveAttribute('data-said', 'wheel');
  await expect(later.getByTestId('device-what-use')).toHaveAttribute('data-said', 'racing');
  await expect(later.locator('.device-icon')).toHaveClass(/mdi-steering/);

  // Taken back: the first choice of each list is RigReady's own reading again.
  await choose(again.page, later, 'device-what-kind', 'Not known');
  await expect(later.getByTestId('device-what-kind')).toHaveAttribute('data-said', '');
  await choose(again.page, later, 'device-what-use', 'Not known');
  await expect(later.getByTestId('device-what-use')).toHaveAttribute('data-said', '');
  expect(await stored()).toEqual([]);
  await toTop(again.page);
  await again.shot('taken-back');
  await again.page.getByTestId('mode-fly').click();
  await expect(chip(again.page, BOARD)).toHaveAttribute('data-kind', 'other');

  expect(problems).toEqual({});
});
