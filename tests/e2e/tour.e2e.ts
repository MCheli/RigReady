import type { Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * The whole app, page by page, on each kind of PC: the flying rig, the racing rig, a PC
 * that is not the owner's, and a first run. One screenshot per page lands in
 * artifacts/screens/tour-<rig>/ (the user guide takes its pictures from there), and every
 * page must look like part of one application: a title, a line that says what the page is
 * for, nothing still loading, and a navigation that fits the window without scrolling.
 */

const BUSY =
  '.v-progress-circular--indeterminate:visible, .v-progress-linear--active:visible, .v-skeleton-loader:visible';

const routesOf = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const scope = globalThis as unknown as {
      document: {
        querySelector(selector: string): {
          __vue_app__: {
            config: { globalProperties: { $router: { getRoutes(): { path: string }[] } } };
          };
        };
      };
    };
    const app = scope.document.querySelector('#app').__vue_app__;
    return app.config.globalProperties.$router.getRoutes().map((route) => route.path);
  });

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

/** The page has finished drawing: the same text three times in a row, and nothing loading. */
async function settled(page: Page, route: string): Promise<void> {
  let last = '';
  let same = 0;
  await expect
    .poll(
      async () => {
        const busy = await page.locator(BUSY).count();
        const text = await page.locator('.rr-page').first().innerText();
        // "Reading the files…": a page that is still looking says so with an ellipsis.
        const loading = /^(Reading|Looking|Loading|Checking)[^.\n]*(…|\.\.\.)\s*$/m.test(text);
        same = text === last && busy === 0 && !loading ? same + 1 : 0;
        last = text;
        return same;
      },
      { message: `${route} settles`, intervals: [150], timeout: 20_000 }
    )
    .toBeGreaterThanOrEqual(3);
}

/** Pages that are a tool panel rather than a page with a heading, each with the reason. */
const NO_HEADING: Record<string, string> = {
  '/configure/cheat-sheets/quick':
    'the quick-look sheet: a compact panel that also runs as a small always-on-top window; its selector bar is its header',
};

const RIGS: { scenario: string; flow: string; what: string }[] = [
  { scenario: 'flying-all-good', flow: 'tour-flying', what: 'the flying rig' },
  { scenario: 'tour-racing', flow: 'tour-racing', what: 'the racing rig' },
  { scenario: 'generic-fresh', flow: 'tour-generic', what: 'a PC with one joystick and no sim' },
  { scenario: 'flying-fresh', flow: 'tour-first-run', what: 'a first run on the flying rig' },
];

for (const rigged of RIGS) {
  test(`tour: every page on ${rigged.what} has a title, says what it is for, and settles`, async ({
    rig,
  }) => {
    test.setTimeout(300_000);
    const { page, shot } = await rig.launch(rigged.scenario, rigged.flow);
    await expect(page.locator('.rr-page').first()).toBeVisible();
    await settled(page, 'the Fly screen');
    await shot('fly');

    await page.getByTestId('mode-configure').click();
    const nav = page.getByTestId('configure-nav');
    await expect(nav.locator('a').first()).toBeVisible();
    // The navigation is one glance: every entry visible at the default window size.
    const overflow = await nav.evaluate((el) => {
      const box = el as unknown as { scrollHeight: number; clientHeight: number };
      return box.scrollHeight - box.clientHeight;
    });
    expect(overflow, 'the navigation fits the window without scrolling').toBeLessThanOrEqual(0);

    // The navigation first, in its own order, then the pages reached from inside others.
    const offered = await nav
      .locator('a')
      .evaluateAll((links) => links.map((a) => (a.getAttribute('href') ?? '').replace(/^#/, '')));
    const all = (await routesOf(page))
      .map((r) => r.replace(/\/:[^/]+\?/g, ''))
      .filter((r) => r.startsWith('/configure/') && !r.includes(':') && !r.includes('*'));
    const routes = [...new Set([...offered, ...all])];
    expect(routes.length).toBeGreaterThan(25);

    const findings: string[] = [];
    for (const route of routes) {
      await go(page, route);
      await expect
        .poll(() =>
          page.evaluate(
            () => (globalThis as unknown as { location: { hash: string } }).location.hash
          )
        )
        .toBe(`#${route}`);
      const root = page.locator('.rr-page').first();
      await expect(root, route).toBeVisible();
      await settled(page, route);
      await shot(route.replace('/configure/', '').replace(/\//g, '-'));
      if (route in NO_HEADING) continue;
      const title = root.locator('.rr-page-title').first();
      if ((await title.count()) === 0) findings.push(`${route}: no page title`);
      else if (((await title.textContent()) ?? '').trim().length < 3) {
        findings.push(`${route}: empty page title`);
      }
      const sub = root.locator('.rr-page-sub').first();
      if ((await sub.count()) === 0) findings.push(`${route}: no line under the title`);
      else if (((await sub.textContent()) ?? '').trim().length < 15) {
        findings.push(`${route}: the line under the title says nothing`);
      }
    }
    expect(findings).toEqual([]);
  });
}
