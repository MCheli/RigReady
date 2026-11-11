import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * The app links to its manual: the help button in the header of every screen, the command
 * palette, About, Settings, and the notices that have a troubleshooting page. Web pages
 * open in the real browser; the browser is replaced by a recorder here, so what the app
 * handed it can be checked.
 */

const DOCS = 'https://rigready.io/docs/';

async function recordBrowser(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { opened: string[] }).opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  return () => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
}

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

test('manual links: the help button opens the manual page of the screen shown', async ({ rig }) => {
  const { page, app, shot } = await rig.launch('flying-all-good', 'manual-links');
  const opened = await recordBrowser(app);
  const help = page.getByRole('button', { name: 'Open the manual page for this screen' });
  const last = async (): Promise<string | undefined> => (await opened()).at(-1);

  // Play: the button is in the header, says what it does, and opens the Play screen's page.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await help.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Open the manual page for this screen');
  await shot('play-header');
  await help.click();
  await expect.poll(last).toBe(`${DOCS}play/`);

  // A Configure page, and the pages inside it.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-devices').click();
  await expect(page.getByTestId('devices-page')).toBeVisible();
  await help.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await shot('devices-header');
  await help.click();
  await expect.poll(last).toBe(`${DOCS}hardware/devices/`);

  await go(page, '/configure/devices/test');
  await expect(help).toHaveAttribute('data-page', 'hardware/input-tester');
  await help.click();
  await expect.poll(last).toBe(`${DOCS}hardware/input-tester/`);

  // A tab with a page of its own gets that page; one without, the page's.
  await page.getByTestId('nav-backups').click();
  await page.getByTestId('backups-tab-tracked').click();
  await help.click();
  await expect.poll(last).toBe(`${DOCS}protect/tracked-files/`);

  await page.getByTestId('nav-dcs-bindings').click();
  await page.getByTestId('bind-tab-device-ids').click();
  await help.click();
  await expect.poll(last).toBe(`${DOCS}dcs/device-ids/`);
  await page.getByTestId('bind-tab-actions').click();
  await help.click();
  await expect.poll(last).toBe(`${DOCS}dcs/bindings/`);

  // A game's page is the manual's page about that game.
  await go(page, '/configure/games/dcs');
  await expect(help).toHaveAttribute('data-page', 'dcs/index');
  await help.click();
  await expect.poll(last).toBe(`${DOCS}dcs/`);

  // The command palette: the page for this screen, and the manual itself.
  await page.getByTestId('nav-audio').click();
  await expect(page.getByTestId('audio-page')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.type('manual page for this');
  await expect(
    page.locator('[data-testid="palette-row"][aria-selected="true"] .rr-palette-title')
  ).toHaveText('Open the manual page for this screen');
  await shot('palette');
  await page.keyboard.press('Enter');
  await expect.poll(last).toBe(`${DOCS}monitors-and-audio/audio/`);

  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.type('open the manual');
  await expect(
    page.locator('[data-testid="palette-row"][aria-selected="true"] .rr-palette-title')
  ).toHaveText('Open the manual');
  await page.keyboard.press('Enter');
  await expect.poll(last).toBe(DOCS);

  // Settings and About link to it too.
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-page').getByRole('link', { name: 'Manual' }).click();
  await expect.poll(last).toBe(`${DOCS}app/settings/`);

  await page.getByTestId('about-open').click();
  await expect(page.getByTestId('about')).toBeVisible();
  await page.getByTestId('about-manual').getByRole('link').click();
  await expect.poll(last).toBe(DOCS);
  await shot('about');

  // Nothing opened inside the app window: it is still on Settings.
  await page.getByTestId('about-close').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  expect(await opened()).toHaveLength(11);
});

test('manual links: notices about damaged files lead to their troubleshooting pages', async ({
  rig,
}) => {
  const { page, app, shot } = await rig.launch('damaged-data-files', 'manual-links-notices');
  const opened = await recordBrowser(app);
  const last = async (): Promise<string | undefined> => (await opened()).at(-1);

  const notices = page.getByTestId('app-notice');
  await expect(notices).toHaveCount(4);
  await expect(notices.nth(2)).toContainText('Some setup files could not be read');
  await shot('notices');
  await notices.nth(2).getByRole('link', { name: 'What to do' }).click();
  await expect.poll(last).toBe(`${DOCS}troubleshooting/setup-file-cannot-be-read/`);
  await notices.nth(0).getByRole('link', { name: 'What to do' }).click();
  await expect.poll(last).toBe(`${DOCS}troubleshooting/app-will-not-start-or-data-folder/`);

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  const broken = page.getByTestId('profile-invalid').first();
  await expect(broken).toBeVisible();
  await broken.getByRole('link', { name: 'How to fix it' }).click();
  await expect.poll(last).toBe(`${DOCS}troubleshooting/setup-file-cannot-be-read/`);
});

test('manual links: DCS running links to why RigReady will not write its files', async ({
  rig,
}) => {
  const { page, app, shot } = await rig.launch('dcs-bindings-dcs-running', 'manual-links-dcs');
  const opened = await recordBrowser(app);
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-dcs-bindings').click();
  const running = page.getByTestId('bind-dcs-running');
  await expect(running).toContainText('DCS is running');
  await shot('dcs-running');
  await running.getByRole('link', { name: 'What to do' }).click();
  await expect
    .poll(async () => (await opened()).at(-1))
    .toBe(`${DOCS}troubleshooting/dcs-files-refused/`);
});
