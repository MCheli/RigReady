import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus, featureRoutes } from './a11y';
import { expect, test } from './harness';

/**
 * NFR-011: status is never conveyed by colour alone, text is readable on the dark theme
 * (WCAG AA contrast), and every control has a name. Scanned with axe-core and with a look at
 * the rendered page (tests/e2e/a11y.ts) on the Fly screen in each of its states and on every
 * Configure route the features declare.
 */

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

const BUSY =
  '.v-progress-circular--indeterminate:visible, .v-progress-linear--active:visible, .v-skeleton-loader:visible';

type Problems = Record<string, unknown[]>;

/** The whole page, nothing excluded. */
async function scan(page: Page, where: string, problems: Problems): Promise<void> {
  const found = [...(await axeViolations(page)), ...(await colourOnlyStatus(page))];
  if (found.length > 0) problems[where] = found;
}

test('a11y: the Fly screen passes axe when ready, when not ready and while Make ready runs', async ({
  rig,
}) => {
  const problems: Problems = {};
  const ready = await rig.launch('flying-all-good', 'a11y-fly');
  await expect(ready.page.getByTestId('fly-status-title')).toHaveText('Ready');
  await scan(ready.page, 'Fly, ready', problems);
  for (const group of ['devices', 'apps']) {
    await ready.page.getByTestId(`group-toggle-${group}`).click();
  }
  await scan(ready.page, 'Fly, ready, groups open', problems);
  await ready.shot('ready');
  await ready.app.close();

  const notReady = await rig.launch('fly-make-ready-all', 'a11y-fly-not-ready');
  const { page, shot } = notReady;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(page.locator(BUSY)).toHaveCount(0);
  await scan(page, 'Fly, not ready', problems);
  await shot('not-ready');

  // The launch warning, with required checks failing.
  await page.getByTestId('launch').click();
  await expect(page.getByTestId('launch-warning')).toBeVisible();
  await scan(page, 'Fly, launch warning', problems);
  await page.getByTestId('launch-cancel').click();
  await expect(page.getByTestId('launch-warning')).toBeHidden();

  // While Make ready runs: the monitor fix waits for "Keep this layout?", so the run holds still.
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await scan(page, 'Fly, Make ready running, keep-layout prompt', problems);
  await shot('make-ready-running');
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('keep-layout')).toBeHidden();
  await expect(page.getByTestId('fly-activity-headline')).toBeVisible();
  await expect(page.locator(BUSY)).toHaveCount(0);
  await scan(page, 'Fly, after Make ready', problems);
  await shot('after-make-ready');

  expect(problems).toEqual({});
});

test('a11y: every Configure route passes axe on the full rig', async ({ rig }) => {
  test.setTimeout(300_000);
  const { page, shot } = await rig.launch('flying-all-good', 'a11y-configure');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('mode-configure').click();

  // A backup to open on the restore route.
  const backup = (await page.evaluate(() =>
    (
      globalThis as unknown as {
        rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
      }
    ).rigready.invoke('backup:backUp', { scope: { kind: 'full' } })
  )) as { ok: boolean; value?: { backup: { id: string } } };
  expect(backup.ok).toBe(true);

  // Routes with a parameter, and what to open them with on this rig.
  const { routes, unresolved } = featureRoutes({
    '/configure/games/:id': 'dcs',
    '/configure/profiles/:id': 'dcs-f-a-18c',
    '/configure/backups/restore/:id': encodeURIComponent(backup.value!.backup.id),
  });
  // A new route with a parameter needs a value above, so that it is scanned too.
  expect(unresolved).toEqual([]);
  expect(routes.length).toBeGreaterThan(25);
  // Everything the navigation offers is a declared route.
  const offered = await page
    .getByTestId('configure-nav')
    .locator('a')
    .evaluateAll((all) => all.map((a) => (a.getAttribute('href') ?? '').replace(/^#/, '')));
  expect(offered.filter((route) => !routes.includes(route))).toEqual([]);

  const problems: Problems = {};
  for (const route of routes) {
    await go(page, route);
    await expect(page.locator('.rr-page').first(), route).toBeVisible();
    await expect(page.locator(BUSY), route).toHaveCount(0);
    await scan(page, route, problems);
    // The tabs of a page are part of it.
    const tabs = page.locator('.rr-page .v-tab:not(a)');
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      await expect(page.locator(BUSY), `${route} tab ${i}`).toHaveCount(0);
      await scan(page, `${route} (tab ${i + 1})`, problems);
    }
  }
  expect(problems).toEqual({});
  await go(page, '/configure/devices');
  await expect(page.locator(BUSY)).toHaveCount(0);
  await shot('devices');
});

/**
 * The states where status matters most: things missing, changed, duplicated, not running.
 * Each scenario is opened on the Fly screen and on the pages that show its problem, tabs
 * included.
 */
const TROUBLED: { scenario: string; routes: string[] }[] = [
  { scenario: 'flying-optional-missing', routes: ['/configure/devices', '/configure/stream-deck'] },
  { scenario: 'dcs-bindings-conflict', routes: ['/configure/dcs-bindings'] },
  { scenario: 'dcs-bindings-old-ids', routes: ['/configure/dcs-bindings'] },
  { scenario: 'devices-identical', routes: ['/configure/devices', '/configure/devices/usb'] },
  { scenario: 'devices-tpr-hidden', routes: ['/configure/devices', '/configure/devices/usb'] },
  {
    scenario: 'racing-iracing-moved-wheel',
    routes: ['/configure/racing', '/configure/racing/iracing', '/configure/racing/wheel'],
  },
  { scenario: 'racing-not-ready', routes: ['/configure/racing', '/configure/games'] },
  {
    scenario: 'stream-deck-new-pc',
    routes: ['/configure/stream-deck', '/configure/stream-deck/setup'],
  },
  { scenario: 'trackir-not-running', routes: ['/configure/trackir'] },
  {
    scenario: 'dcs-setup-export-overwritten',
    routes: ['/configure/dcs', '/configure/dcs/export', '/configure/dcs/simapppro'],
  },
  { scenario: 'displays-mfd-swapped', routes: ['/configure/displays'] },
  { scenario: 'audio-mic-wrong', routes: ['/configure/audio'] },
];

test('a11y: scenarios with something wrong pass axe and never say it by colour alone', async ({
  rig,
}) => {
  test.setTimeout(300_000);
  const problems: Problems = {};
  for (const { scenario, routes } of TROUBLED) {
    const { page, app, shot } = await rig.launch(scenario, `a11y-troubled-${scenario}`);
    await expect(page.getByTestId('fly-page')).toBeVisible();
    await expect(page.locator(BUSY)).toHaveCount(0);
    // Open every group, so the rows are judged too.
    const closed = page.locator('[data-testid^="group-toggle-"][aria-expanded="false"]');
    for (let n = await closed.count(); n > 0; n = await closed.count()) {
      await closed.first().click();
    }
    await scan(page, `${scenario}: Fly`, problems);
    for (const [index, route] of routes.entries()) {
      await go(page, route);
      await expect(page.locator('.rr-page').first(), route).toBeVisible();
      await expect(page.locator(BUSY), route).toHaveCount(0);
      await scan(page, `${scenario}: ${route}`, problems);
      if (index === 0) await shot('page');
      const tabs = page.locator('.rr-page .v-tab:not(a)');
      for (let i = 0; i < (await tabs.count()); i++) {
        await tabs.nth(i).click();
        await expect(page.locator(BUSY), `${route} tab ${i}`).toHaveCount(0);
        await scan(page, `${scenario}: ${route} (tab ${i + 1})`, problems);
      }
    }
    await app.close();
  }
  expect(problems).toEqual({});
});
