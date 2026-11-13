import type { Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * Decision 1A of the 12 Nov 2026 sitting: the menu names no game. One Games entry, from
 * which the DCS World and Racing pages open; one Bindings entry with a game picker that
 * lists every game with a bindings page (DCS and iRacing), remembers the last one, and on
 * first use opens the game of the setup in use.
 */

const hash = (page: Page): Promise<string> =>
  page.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash);

const entries = (page: Page, section: string) =>
  page.getByTestId('configure-nav').getByRole('group', { name: section }).locator('a');

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await expect(page.getByTestId('palette-input')).toBeFocused();
}

/** Picks a game in the picker of Bindings. */
async function pickGame(page: Page, name: string): Promise<void> {
  await page.getByTestId('bindings-game').click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('games menu: one Games entry, and DCS World and Racing open from their cards on Games', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('flying-all-good', 'games-menu');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('mode-configure').click();

  // The menu names no game: Games is one entry, Bindings stands first under Controls.
  await expect(entries(page, 'Games')).toHaveText(['Games']);
  await expect(entries(page, 'Controls')).toHaveText([
    'Bindings',
    'Binding guide',
    'Cheat sheets',
    'Overlay',
  ]);
  const nav = page.getByTestId('configure-nav');
  await expect(nav).not.toContainText('DCS');
  await expect(nav).not.toContainText('Racing');

  // Games: a card for each page about a game found on this PC, then the games.
  await page.getByTestId('nav-games').click();
  const dcsCard = page.getByTestId('game-card-dcs');
  const racingCard = page.getByTestId('game-card-racing');
  await expect(dcsCard).toContainText('DCS World');
  await expect(dcsCard).toContainText(
    'Screens for the cockpit displays, Export.lua and SimAppPro.'
  );
  await expect(racingCard).toContainText('Racing');
  await expect(racingCard).toContainText(
    'Your wheel and the racing games: controllers, bindings and backups.'
  );
  await expect(page.locator('[data-testid="game-row"][data-game="dcs"]')).toBeVisible();
  await shot('games');

  // DCS World opens from its card, keeps its address, and the menu says it is under Games.
  await dcsCard.click();
  await expect(page.getByTestId('dcs-page')).toBeVisible();
  expect(await hash(page)).toBe('#/configure/dcs');
  await expect(page.getByTestId('nav-games')).toHaveAttribute('aria-current', 'location');
  await expect(page.getByTestId('nav-games')).toHaveClass(/active/);
  await shot('dcs-world');
  await page.getByTestId('dcs-tab-screens').click();
  await expect.poll(() => hash(page)).toBe('#/configure/dcs/screens');
  await expect(page.getByTestId('nav-games')).toHaveAttribute('aria-current', 'location');

  // Racing opens from its card the same way.
  await page.getByTestId('nav-games').click();
  await expect(page.getByTestId('nav-games')).toHaveAttribute('aria-current', 'page');
  await racingCard.click();
  await expect(page.getByTestId('racing-page')).toBeVisible();
  expect(await hash(page)).toBe('#/configure/racing');
  await expect(page.getByTestId('nav-games')).toHaveAttribute('aria-current', 'location');
  await shot('racing');
  // The wheel lies inside the Racing page's address and keeps its own entry under Hardware.
  await page.getByTestId('racing-wheel-card').click();
  await expect.poll(() => hash(page)).toBe('#/configure/racing/wheel');
  await expect(page.getByTestId('nav-wheel')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('nav-games')).not.toHaveAttribute('aria-current', /.+/);

  // The game's own page leads to DCS World too, and says what is set up there.
  await page.getByTestId('nav-games').click();
  await page.locator('[data-testid="game-row"][data-game="dcs"]').click();
  await expect(page.getByTestId('game-title')).toHaveText('DCS World');
  await expect(page.getByTestId('game-bindings')).toHaveText('Set up DCS World');
  await page.getByTestId('game-bindings').click();
  await expect(page.getByTestId('dcs-page')).toBeVisible();
  // A racing game's page still offers its own page by what is on it.
  await page.getByTestId('nav-games').click();
  await page.locator('[data-testid="game-row"][data-game="iracing"]').click();
  await expect(page.getByTestId('game-bindings')).toHaveText('Bindings and controllers');
});

test('bindings: one entry with a game picker; the setup’s game on first use, then the game chosen last', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'games-menu-bindings');
  let { page } = run;
  const { shot } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('mode-configure').click();

  // First use: the setup in use is for DCS, so Bindings opens DCS's bindings.
  await page.getByTestId('nav-bindings').click();
  await expect.poll(() => hash(page)).toBe('#/configure/dcs-bindings');
  await expect(page.getByTestId('bind-overview')).toBeVisible();
  const picker = page.getByTestId('bindings-game');
  await expect(picker).toContainText('DCS');
  await expect(page.getByTestId('nav-bindings')).toHaveAttribute('aria-current', 'location');
  await expect(page.getByTestId('nav-bindings')).toHaveClass(/active/);
  await shot('dcs');

  // The picker lists every game with a bindings page.
  await picker.click();
  await expect(page.getByRole('option')).toHaveText(['DCS', 'iRacing']);
  await shot('picker-open');
  await page.getByRole('option', { name: 'iRacing', exact: true }).click();
  await expect.poll(() => hash(page)).toBe('#/configure/iracing-bindings');
  await expect(page.getByTestId('iracing-bindings-page')).toBeVisible();
  await expect(page.getByTestId('bindings-game')).toContainText('iRacing');
  await expect(page.getByTestId('nav-bindings')).toHaveAttribute('aria-current', 'location');
  await shot('iracing');

  // Somewhere else and back: Bindings opens the game chosen last, not the setup's.
  await page.getByTestId('nav-devices').click();
  await expect(page.getByTestId('bindings-game-picker')).toHaveCount(0);
  await page.getByTestId('nav-bindings').click();
  await expect.poll(() => hash(page)).toBe('#/configure/iracing-bindings');

  // And after the app is closed and started again.
  page = (await run.restart()).page;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();
  await expect.poll(() => hash(page)).toBe('#/configure/iracing-bindings');
  await expect(page.getByTestId('bindings-game')).toContainText('iRacing');

  // A link to one game's bindings (here a tab of DCS's) is a choice too.
  await pickGame(page, 'DCS');
  await expect.poll(() => hash(page)).toBe('#/configure/dcs-bindings');
  await page.getByTestId('bind-tab-devices').click();
  await expect.poll(() => hash(page)).toMatch(/^#\/configure\/dcs-bindings\/devices/);
  await expect(page.getByTestId('bindings-game')).toContainText('DCS');
  await expect(page.getByTestId('nav-bindings')).toHaveAttribute('aria-current', 'location');
  await page.getByTestId('nav-devices').click();
  await page.getByTestId('nav-bindings').click();
  await expect.poll(() => hash(page)).toBe('#/configure/dcs-bindings');
});

test('bindings: on the racing rig the first use opens iRacing, the game of its setup', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('tour-racing', 'games-menu-racing');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();
  await expect.poll(() => hash(page)).toBe('#/configure/iracing-bindings');
  await expect(page.getByTestId('iracing-bindings-page')).toBeVisible();
  await expect(page.getByTestId('bindings-game')).toContainText('iRacing');
  await shot('first-use');
});

test('palette and links: the pages that left the menu keep their names and their addresses', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('stream-deck-owner', 'games-menu-links');
  await page.getByTestId('mode-configure').click();
  const row = (to: string) => page.locator(`[data-testid="palette-row"][data-to="${to}"]`);

  // The palette lists each page under the name its entry had, and Bindings.
  await openPalette(page);
  await page.keyboard.type('dcs world');
  await expect(row('/configure/dcs').locator('.rr-palette-title')).toHaveText('DCS World');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('racing');
  await expect(row('/configure/racing').locator('.rr-palette-title')).toHaveText('Racing');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('bindings');
  await expect(row('/configure/dcs-bindings').locator('.rr-palette-title')).toHaveText(
    'DCS bindings'
  );
  await expect(row('/configure/iracing-bindings').locator('.rr-palette-title')).toHaveText(
    'iRacing bindings'
  );
  await expect(row('/configure/bindings').locator('.rr-palette-title')).toHaveText('Bindings');
  await shot('palette');
  await row('/configure/bindings').click();
  await expect(page.getByTestId('palette')).toBeHidden();
  await expect.poll(() => hash(page)).toMatch(/^#\/configure\/(dcs|iracing)-bindings$/);
  await expect(page.getByTestId('bindings-game-picker')).toBeVisible();

  // A finding that offers to open a page opens it: the Export.lua tab of DCS World.
  await page.getByTestId('nav-stream-deck').click();
  const finding = page.locator('[data-testid="sd-finding"][data-id="dcs-interface-export"]');
  const open = finding.getByTestId('sd-finding-route');
  await expect(open).toHaveText('Open DCS World: Export.lua');
  await finding.scrollIntoViewIfNeeded();
  await shot('finding');
  await open.click();
  await expect.poll(() => hash(page)).toBe('#/configure/dcs/export');
  await expect(page.getByTestId('dcs-page')).toBeVisible();
  await expect(page.getByTestId('nav-games')).toHaveAttribute('aria-current', 'location');
  await shot('export-lua');
});
