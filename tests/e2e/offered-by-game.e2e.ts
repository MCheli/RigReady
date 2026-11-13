import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * NAV-GAMES-006: an entry or a page about a game is offered where the game is found. A user
 * without DCS does not meet the binding guide in the menu, nor the DCS World and DCS bindings
 * pages in the command palette; the guide's page still opens from a link and says DCS World
 * was not found. When DCS arrives while RigReady runs, they arrive with it.
 */

const entries = (page: Page, section: string) =>
  page.getByTestId('configure-nav').getByRole('group', { name: section }).locator('a');
const rows = (page: Page) => page.getByTestId('palette-row');
/** Rows of the palette that open a page about DCS. */
const dcsRows = (page: Page) =>
  page.locator(
    '[data-testid="palette-row"][data-to^="/configure/dcs"], [data-testid="palette-row"][data-to^="/configure/ai-assist"]'
  );

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await expect(page.getByTestId('palette-input')).toBeFocused();
}

/**
 * The mutations of fixtures/scenarios/generic-dcs.yaml: the standalone DCS World installed.
 * A scenario file's registry value is pointed at the fake user folder when it loads; a live
 * mutation names that folder itself.
 */
const installDcs = (home: string) => [
  {
    op: 'setRegistryValue',
    hive: 'HKCU',
    key: 'Software\\Eagle Dynamics\\DCS World',
    name: 'Path',
    value: {
      type: 'string',
      value: path.join(home, 'Program Files', 'Eagle Dynamics', 'DCS World'),
    },
  },
  { op: 'writeFile', path: 'Program Files/Eagle Dynamics/DCS World/bin/DCS.exe', content: '' },
  {
    op: 'writeFile',
    path: 'Saved Games/DCS/Config/options.lua',
    content:
      'options = {\n  ["graphics"] = { ["width"] = 1920, ["height"] = 1080, ["multiMonitorSetup"] = "1camera" },\n}\n',
  },
];

test('a PC whose only game is iRacing: no binding guide in the menu, no DCS page in the palette, and a link still opens the guide', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('shell-racing-pc', 'offered-racing-pc');
  await page.getByTestId('mode-configure').click();

  // The menu: the binding guide works on DCS's files, so it is not offered here.
  await expect(entries(page, 'Controls')).toHaveText(['Bindings', 'Cheat sheets', 'Overlay']);
  await expect(page.getByTestId('nav-ai-assist')).toHaveCount(0);
  await expect(page.getByTestId('configure-nav')).not.toContainText('Binding guide');
  await expect(page.getByTestId('configure-nav').locator('a')).toHaveCount(17);
  await shot('menu');

  // The palette with nothing typed: no DCS World, no DCS bindings and their tabs, no guide.
  await openPalette(page);
  await expect(rows(page).first()).toBeVisible();
  await expect(
    page.locator('[data-testid="palette-row"][data-to="/configure/bindings"]')
  ).toHaveCount(1);
  await expect(dcsRows(page)).toHaveCount(0);
  await expect(rows(page).filter({ hasText: /\bDCS\b|Binding guide/ })).toHaveCount(0);
  await expect(page.getByTestId('palette-problem')).toHaveCount(0);
  await shot('palette');

  // Typed: "bind" finds Bindings and iRacing's bindings, nothing of DCS.
  await page.keyboard.type('bind');
  await expect(
    page.locator('[data-testid="palette-row"][data-to="/configure/iracing-bindings"]')
  ).toHaveCount(1);
  await expect(dcsRows(page)).toHaveCount(0);
  await expect(rows(page).filter({ hasText: /\bDCS\b|Binding guide/ })).toHaveCount(0);
  await shot('palette-bind');
  // "dcs" finds no page about DCS: the tabs of DCS World and DCS bindings are not listed.
  await page.getByTestId('palette-input').fill('dcs');
  await expect(dcsRows(page)).toHaveCount(0);
  await shot('palette-dcs');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toBeHidden();

  // A link to the guide still opens it, and the page says plainly that DCS was not found.
  await go(page, '/configure/ai-assist');
  const guide = page.getByTestId('ai-guide-page');
  await expect(guide).toBeVisible();
  await expect(page.getByTestId('ai-no-dcs')).toContainText('DCS World was not found on this PC');
  await expect(page.locator('.v-alert.text-error, .v-alert.bg-error')).toHaveCount(0);
  await expect(page.getByTestId('nav-ai-assist')).toHaveCount(0);
  await shot('guide-by-link');
});

test('with DCS the binding guide and the DCS pages are offered, and they arrive when DCS is installed while RigReady runs', async ({
  rig,
}) => {
  const { page, shot, mutate, home } = await rig.launch('generic-fresh', 'offered-dcs-arrives');
  await page.getByTestId('mode-configure').click();
  await expect(entries(page, 'Controls')).toHaveText(['Bindings', 'Cheat sheets', 'Overlay']);
  await openPalette(page);
  await expect(rows(page).first()).toBeVisible();
  await expect(dcsRows(page)).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The standalone DCS World is installed: the machine changed, and the shell asks again.
  await mutate(installDcs(home));
  await expect(entries(page, 'Controls')).toHaveText([
    'Bindings',
    'Binding guide',
    'Cheat sheets',
    'Overlay',
  ]);
  await expect(page.getByTestId('configure-nav').locator('a')).toHaveCount(18);
  await shot('menu-with-dcs');

  await openPalette(page);
  await page.keyboard.type('dcs');
  for (const [to, title] of [
    ['/configure/dcs', 'DCS World'],
    ['/configure/dcs/screens', 'DCS World: Screens'],
    ['/configure/dcs-bindings', 'DCS bindings'],
    ['/configure/dcs-bindings/devices', 'DCS bindings: Devices'],
  ]) {
    await expect(
      page.locator(`[data-testid="palette-row"][data-to="${to}"] .rr-palette-title`)
    ).toHaveText(title!);
  }
  await shot('palette-with-dcs');
  await page.getByTestId('palette-input').fill('binding guide');
  await expect(
    page.locator('[data-testid="palette-row"][aria-selected="true"] .rr-palette-title')
  ).toHaveText('Binding guide');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ai-guide-page')).toBeVisible();
  await expect(page.getByTestId('nav-ai-assist')).toHaveAttribute('aria-current', 'page');
  await shot('guide-from-palette');

  // Bindings opens DCS's bindings now, and its picker offers no game that is not here.
  await page.getByTestId('nav-bindings').click();
  await expect(page).toHaveURL(/#\/configure\/dcs-bindings$/);
  await expect(page.getByTestId('bindings-game')).toContainText('DCS');
  await expect(page.getByTestId('bindings-game-picker').locator('.v-select')).toHaveCount(0);
  await shot('bindings-with-dcs');
});

test('Bindings on a PC without a game whose bindings it reads says so, and opens no game page', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('generic-fresh', 'offered-bindings-none');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();
  const none = page.getByTestId('bindings-none');
  await expect(none).toContainText(
    'No game whose bindings RigReady can read was found on this PC.'
  );
  await expect(none).toContainText('RigReady reads the bindings of DCS and iRacing.');
  await expect(page).toHaveURL(/#\/configure\/bindings$/);
  await expect(page.getByTestId('bindings-game-picker')).toHaveCount(0);
  await expect(page.getByTestId('nav-bindings')).toHaveAttribute('aria-current', 'page');
  await shot('none-found');
  await none.getByTestId('bindings-none-games').click();
  await expect(page.getByTestId('nav-games')).toHaveAttribute('aria-current', 'page');
});

test('Bindings on a PC whose only game is iRacing, with no setup yet, opens iRacing and offers nothing else', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('shell-racing-pc', 'offered-bindings-racing');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-bindings').click();
  await expect(page).toHaveURL(/#\/configure\/iracing-bindings$/);
  await expect(page.getByTestId('iracing-bindings-page')).toBeVisible();
  await expect(page.getByTestId('bindings-game')).toContainText('iRacing');
  await expect(page.getByTestId('bindings-game-picker').locator('.v-select')).toHaveCount(0);
  await expect(page.getByTestId('bindings-game-picker')).not.toContainText('DCS');
  await shot('racing-pc');
});
