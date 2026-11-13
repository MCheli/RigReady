import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test, type RunningApp } from './harness';

/**
 * A page that moves the user on once main has answered (a setup created, a copy made) must
 * not do so after the user has already gone to another page: on a slow or busy PC the answer
 * can take seconds (GitHub's runners showed it). Each flow below slows the files on purpose,
 * presses the button, goes on to Monitors before the answer, and then waits until main has
 * answered: the user is still on Monitors, and what they asked for was done.
 */

/** What the tray offers, as words: the setup in use, the setups, the virtual controller profiles. */
const trayWords = async (app: ElectronApplication): Promise<string> =>
  JSON.stringify(
    await app.evaluate(() =>
      (globalThis as unknown as { __rigreadyTray(): { menu: unknown } }).__rigreadyTray()
    )
  );

/** The answer is slow: every file read and write waits this long while the button is pressed. */
const SLOW_MS = 1500;

/** Presses `press`, goes on to Monitors while the answer is still on its way, and lets the files be quick again. */
async function pressAndMoveOn(
  { page, mutate }: Pick<RunningApp, 'page' | 'mutate'>,
  press: () => Promise<void>
): Promise<void> {
  await mutate([{ op: 'slowFiles', ms: SLOW_MS }]);
  await press();
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-displays').click();
  await expect(page.getByTestId('displays-page')).toBeVisible();
  await mutate([{ op: 'slowFiles', ms: 0 }]);
}

/**
 * The user is still on Monitors once main has answered. The tray changes only after the
 * answer has gone to the window, and Refresh asks main again, so its answer comes after
 * the first one: by then a page that was going to move the user has done so.
 */
async function stillOnMonitors(page: Page): Promise<void> {
  await page.getByTestId('displays-refresh').click();
  await expect(page.locator('[data-testid="display-row"]').first()).toBeVisible();
  await expect(page).toHaveURL(/#\/configure\/displays$/);
}

test('a new setup saved slowly: going on to Monitors before it answers keeps you there', async ({
  rig,
}) => {
  const { app, page, shot, mutate } = await rig.launch('flying-fresh', 'save-then-move-on-capture');
  await page.getByTestId('fly-create').click();
  await page.getByTestId('capture-name').locator('input').fill('Slow save');
  await pressAndMoveOn({ page, mutate }, () => page.getByTestId('capture-save').click());

  await expect.poll(() => trayWords(app)).toContain('Slow save:');
  await stillOnMonitors(page);
  await shot('still-on-monitors');
  // It was saved, and Play opens on it.
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toBeVisible();
  await expect(page.getByTestId('profile-switcher')).toContainText('Slow save');
});

test('Play on a setup in the list answered slowly: going on to Monitors before it answers keeps you there', async ({
  rig,
}) => {
  const { app, page, shot, mutate } = await rig.launch('fly-two-setups', 'save-then-move-on-play');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  const hornet = page.locator('[data-testid="profile-row"][data-name="DCS F/A-18C"]');
  await expect(hornet).toBeVisible();
  await expect.poll(() => trayWords(app)).toContain('DCS UH-1H:');
  await pressAndMoveOn({ page, mutate }, () => hornet.getByTestId('profile-fly').click());

  // The Hornet is the setup in use now, and the user is where they went.
  await expect.poll(() => trayWords(app)).toContain('DCS F/A-18C:');
  await stillOnMonitors(page);
  await shot('still-on-monitors');
});

test('a setup cloned slowly: going on to Monitors before the copy is made keeps you there', async ({
  rig,
}) => {
  const { app, page, shot, mutate } = await rig.launch('fly-two-setups', 'save-then-move-on-clone');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  const hornet = page.locator('[data-testid="profile-row"][data-name="DCS F/A-18C"]');
  await pressAndMoveOn({ page, mutate }, () => hornet.getByTestId('profile-clone').click());

  await expect.poll(() => trayWords(app)).toContain('DCS F/A-18C (copy)');
  await stillOnMonitors(page);
  await shot('still-on-monitors');
  // The copy is there, in the list of setups.
  await page.getByTestId('nav-profiles').click();
  await expect(
    page.locator('[data-testid="profile-row"][data-name="DCS F/A-18C (copy)"]')
  ).toBeVisible();
});

test('a virtual controller profile copied slowly: going on to Monitors before the copy is made keeps you there', async ({
  rig,
}) => {
  const { app, page, shot, mutate } = await rig.launch(
    'virtual-controller-ready',
    'save-then-move-on-vc-copy'
  );
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-virtual-controller').click();
  const startingPoint = page.locator(
    '[data-testid="vc-builtin"][data-id="starting-flight-stick-ace-combat"]'
  );
  await pressAndMoveOn({ page, mutate }, () => startingPoint.getByTestId('vc-copy').click());

  await expect.poll(() => trayWords(app)).toContain('My Ace Combat 8 stick');
  await stillOnMonitors(page);
  await shot('still-on-monitors');
  // The copy is there, on the Virtual controller page.
  await page.getByTestId('nav-virtual-controller').click();
  await expect(
    page.locator('[data-testid="vc-profile"][data-id="my-ace-combat-8-stick"]')
  ).toBeVisible();
});
