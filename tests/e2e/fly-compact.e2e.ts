import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, screensDir, test } from './harness';

/**
 * The compact view: the dial, the setup switcher and the one action in a small window
 * that stays on top, opened from the Fly menu.
 */

/** Opens the compact view from the Fly menu and hands back its window. */
async function openCompact(app: ElectronApplication, page: Page): Promise<Page> {
  await page.getByTestId('fly-more').click();
  // The entry says what it is.
  await expect(page.getByTestId('fly-compact')).toContainText('Compact view');
  await expect(page.getByTestId('fly-compact')).toContainText('A small window that stays on top');
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    page.getByTestId('fly-compact').click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.getByTestId('fly-compact-page')).toHaveAttribute('data-panel', 'true');
  return popup;
}

interface WindowFacts {
  onTop: boolean;
  visible: boolean;
  width: number;
  height: number;
}
const windows = (app: ElectronApplication): Promise<WindowFacts[]> =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      onTop: w.isAlwaysOnTop(),
      visible: w.isVisible(),
      width: w.getBounds().width,
      height: w.getBounds().height,
    }))
  );

/** A picture of the small window, once whatever is fading or sliding in it has arrived. */
async function snap(popup: Page, flow: string, name: string): Promise<void> {
  // The pointer is not part of the picture: wherever the last click left it, it is put aside.
  await popup.mouse.move(2, 2);
  await popup.evaluate('document.fonts.ready');
  await popup.evaluate(`(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const running = () =>
      document
        .getAnimations()
        .filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity)
        .filter((a) => a.playState !== 'finished' && a.playState !== 'idle');
    for (let round = 0; round < 40; round++) {
      const now = running();
      if (now.length > 0) {
        await Promise.all(now.map((a) => a.finished.catch(() => undefined)));
        continue;
      }
      await frame();
      await frame();
      await frame();
      if (running().length === 0) return;
    }
  })()`);
  await popup.screenshot({ path: path.join(screensDir, flow, name) });
}

const accessible = async (page: Page): Promise<unknown[]> => [
  ...(await axeViolations(page)),
  ...(await colourOnlyStatus(page)),
];

/** Whether everything in the small window is on screen without scrolling. */
const fits = (popup: Page): Promise<boolean> =>
  popup.getByTestId('fly-compact-page').evaluate((el) => {
    const box = el as unknown as { scrollHeight: number; clientHeight: number };
    return box.scrollHeight <= box.clientHeight;
  });

test('compact: the dial, the setup and the one action in a small window on top; the whole routine is done from there', async ({
  rig,
}) => {
  const run = await rig.launch('fly-make-ready-all', 'fly-compact');
  const { page, app } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  const popup = await openCompact(app, page);

  // A small window, above the others, beside the main one.
  const small = (await windows(app)).filter((w) => w.onTop);
  expect(small).toHaveLength(1);
  expect(small[0]!.width).toBeLessThanOrEqual(420);
  expect(small[0]!.height).toBeLessThanOrEqual(340);
  expect(small[0]!.visible).toBe(true);

  // The dial, the setup, the state and the one action: nothing else, and nothing to scroll.
  const dial = popup.getByTestId('compact-dial');
  await expect(dial).toHaveAttribute('data-met', '4');
  await expect(dial).toHaveAttribute('data-total', '8');
  await expect(dial).toHaveAttribute('aria-label', '4 of 8 checks met');
  await expect(popup.getByTestId('compact-switcher')).toContainText('DCS F/A-18C full');
  await expect(popup.getByTestId('compact-status')).toHaveText('Not ready(4)');
  await expect(popup.getByTestId('compact-status-sub')).toHaveText('4 required items are not met');
  const primary = popup.getByTestId('compact-primary');
  await expect(primary).toContainText('Make ready and launch');
  await expect(primary.locator('kbd')).toHaveText('Enter');
  await expect(popup.getByTestId('configure-nav')).toHaveCount(0);
  expect(await fits(popup)).toBe(true);
  expect(await accessible(popup)).toEqual([]);
  await snap(popup, 'fly-compact', '01-not-ready.png');

  // Enter, in the small window: the fixes run, and the layout question is asked here too.
  await popup.keyboard.press('Enter');
  await expect(popup.getByTestId('keep-layout')).toBeVisible();
  await snap(popup, 'fly-compact', '02-keep-this-layout.png');
  await popup.getByTestId('keep-layout-keep').click();
  await expect(popup.getByTestId('compact-status')).toHaveText('Ready');
  await expect(popup.getByTestId('compact-line')).toHaveText(
    '4 of 4 fixes worked · Launched DCS.exe'
  );
  // The game is running: the session and its clock, and no button for Enter to press.
  const session = popup.getByTestId('fly-session');
  await expect(session).toHaveAttribute('data-phase', 'running');
  await expect(session).toContainText('DCS World is running');
  await expect(popup.getByTestId('fly-session-elapsed')).toHaveText(/^0:00:\d\d$/);
  await expect(primary).toHaveCount(0);
  // The main window got out of the way; the small one stays.
  await expect
    .poll(async () => (await windows(app)).map((w) => `${w.onTop ? 'small' : 'main'}:${w.visible}`))
    .toEqual(expect.arrayContaining(['small:true', 'main:false']));
  expect(await fits(popup)).toBe(true);
  expect(await accessible(popup)).toEqual([]);
  await snap(popup, 'fly-compact', '03-in-session.png');

  // The game closes: Welcome back, and Stand down is the one action.
  await run.mutate([{ op: 'stopProcess', name: 'DCS.exe' }]);
  await expect(session).toHaveAttribute('data-phase', 'ended');
  await expect(session).toContainText('Welcome back');
  await expect(session).toContainText(/less than a minute · closed\s+at \d\d:\d\d/);
  await expect(primary).toContainText('Stand down');
  // Still everything on screen, with the session in it.
  expect(await fits(popup)).toBe(true);
  expect(await accessible(popup)).toEqual([]);
  await snap(popup, 'fly-compact', '04-welcome-back.png');
  await primary.click();
  await expect(popup.getByTestId('compact-line')).toHaveText(/^(Closed \d apps?|No apps to close)/);
  await expect(session).toHaveCount(0);
  await expect(primary).toBeVisible();
});

test('compact: a setup chosen in one window is the setup in the other, and the menu brings the same small window back', async ({
  rig,
}) => {
  const { page, app } = await rig.launch('fly-two-setups', 'fly-compact-switch');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS UH-1H');
  const popup = await openCompact(app, page);
  await expect(popup.getByTestId('compact-switcher')).toContainText('DCS UH-1H');
  await expect(popup.getByTestId('compact-status')).toHaveText('Ready');
  await expect(popup.getByTestId('compact-primary')).toContainText('Launch');

  // Chosen in the small window: the main one follows.
  await popup.getByTestId('compact-switcher').click();
  await popup.getByRole('option', { name: 'DCS F/A-18C' }).click();
  await expect(popup.getByTestId('compact-switcher')).toContainText('DCS F/A-18C');
  await expect(popup.getByTestId('compact-dial')).toHaveAttribute('data-total', '16');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect(page.getByTestId('fly-dial')).toHaveAttribute('data-total', '16');

  // Chosen in the main window: the small one follows.
  await page.getByTestId('profile-switcher').click();
  await page.getByRole('option', { name: 'DCS UH-1H' }).click();
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS UH-1H');
  await expect(popup.getByTestId('compact-switcher')).toContainText('DCS UH-1H');
  await expect(popup.getByTestId('compact-dial')).toHaveAttribute('data-total', '5');

  // Asked for again, it is the same window brought forward, not a second one.
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-compact').click();
  await expect(page.getByTestId('fly-compact')).toBeHidden();
  expect((await windows(app)).filter((w) => w.onTop)).toHaveLength(1);
  expect(app.windows()).toHaveLength(2);
  await expect(popup.getByTestId('compact-switcher')).toContainText('DCS UH-1H');
  await expect(popup.getByTestId('compact-status')).toHaveText('Ready');
  await popup.evaluate('document.activeElement && document.activeElement.blur()');
  await snap(popup, 'fly-compact-switch', '01-ready.png');
});

test('compact: Launch on a rig that is not ready asks once more before it launches', async ({
  rig,
}) => {
  const { page, app } = await rig.launch('flying-pedals-unplugged', 'fly-compact-not-ready');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  const popup = await openCompact(app, page);
  const primary = popup.getByTestId('compact-primary');
  await expect(primary).toContainText('Launch');
  await expect(popup.getByTestId('compact-line')).toHaveCount(0);

  await expect(primary.locator('kbd')).toHaveText('Enter');
  await popup.keyboard.press('Enter');
  // Nothing was launched: the button says what pressing it means, with what is missing.
  await expect(primary).toContainText('Launch anyway');
  await expect(popup.getByTestId('compact-line')).toHaveText(
    'Not ready: T-Pendular-Rudder — Not connected'
  );
  await expect(popup.getByTestId('fly-session')).toHaveCount(0);
  // Launching past something required is never one Enter after another: the hint is gone,
  // and a second Enter does nothing.
  await expect(primary.locator('kbd')).toHaveCount(0);
  await expect(primary).not.toHaveAttribute('aria-keyshortcuts', 'Enter');
  await popup.keyboard.press('Enter');
  await popup.getByTestId('compact-recheck').click();
  await expect(popup.getByTestId('compact-status')).toHaveText('Not ready(1)');
  await expect(primary).toContainText('Launch anyway');
  await expect(popup.getByTestId('fly-session')).toHaveCount(0);
  expect(await accessible(popup)).toEqual([]);
  await snap(popup, 'fly-compact-not-ready', '01-launch-anyway.png');
  await popup.getByTestId('compact-cancel').click();
  await expect(primary).not.toContainText('anyway');
  await expect(primary.locator('kbd')).toHaveText('Enter');
  await expect(popup.getByTestId('compact-line')).toHaveCount(0);

  // Asked again and answered with a click: now it launches.
  await primary.click();
  await expect(primary).toContainText('Launch anyway');
  await expect(popup.getByTestId('fly-session')).toHaveCount(0);
  await primary.click();
  await expect(popup.getByTestId('compact-line')).toHaveText('Launched DCS.exe');
  await expect(popup.getByTestId('fly-session')).toHaveAttribute('data-phase', 'running');
});

test('compact: Make ready and launch that stops on something required says what, launches nothing, and offers Launch once it is met', async ({
  rig,
}) => {
  const run = await rig.launch('flying-pedals-unplugged', 'fly-compact-held');
  const { page, app } = run;
  await run.mutate([{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
  await expect(page.getByTestId('fly-status-count')).toHaveText('(2)');
  const popup = await openCompact(app, page);
  const primary = popup.getByTestId('compact-primary');
  await expect(popup.getByTestId('compact-status')).toHaveText('Not ready(2)');
  await expect(primary).toContainText('Make ready and launch');

  await primary.click();
  // TrackIR could be started; the pedals have to be plugged in by hand. Nothing was launched.
  await expect(primary).toContainText('Launch anyway');
  await expect(popup.getByTestId('compact-status')).toHaveText('Not ready(1)');
  await expect(popup.getByTestId('compact-line')).toHaveText(
    'Not ready: T-Pendular-Rudder — Not connected'
  );
  await expect(popup.getByTestId('fly-session')).toHaveCount(0);
  expect(await fits(popup)).toBe(true);
  expect(await accessible(popup)).toEqual([]);
  await snap(popup, 'fly-compact-held', '01-stopped.png');

  // The pedals are plugged in: the warning goes, and Launch is the one action.
  await run.mutate([{ op: 'plugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await expect(popup.getByTestId('compact-status')).toHaveText('Ready');
  await expect(primary).not.toContainText('anyway');
  await expect(primary).toContainText('Launch');
  await expect(popup.getByTestId('fly-session')).toHaveCount(0);
});

test('compact: a program that has to be shown first is left to the full window, and the page is reachable in the main window too', async ({
  rig,
}) => {
  const { page, app } = await rig.launch('fly-generic-checks', 'fly-compact-needs-ok');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  const popup = await openCompact(app, page);
  // One of this setup's fixes runs a script. The full window shows exactly what would run
  // and asks; there is no room for that here, so the action is not offered here.
  const primary = popup.getByTestId('compact-primary');
  await expect(primary).toContainText('Make ready and launch');
  await expect(primary).toBeDisabled();
  await expect(popup.getByTestId('compact-line')).toHaveText(
    'This setup runs a program that is shown to you first. That is done in the full window.'
  );
  await expect(primary).toHaveAttribute('title', /full window/);
  // The way there is one click.
  await popup.getByTestId('compact-open-main').click();
  await expect(popup.getByTestId('compact-line')).toHaveText(
    'This setup runs a program that is shown to you first. That is done in the full window.'
  );
  // Enter does not get round it, and the button does not say it would: nothing runs.
  await expect(primary.locator('kbd')).toHaveCount(0);
  await expect(primary).not.toHaveAttribute('aria-keyshortcuts', 'Enter');
  await popup.evaluate('document.activeElement && document.activeElement.blur()');
  await popup.keyboard.press('Enter');
  await expect(primary).toBeDisabled();
  await expect(popup.getByTestId('fly-session')).toHaveCount(0);
  await expect(page.getByTestId('fly-activity')).toHaveCount(0);
  // The rest still works from here.
  await popup.getByTestId('compact-recheck').click();
  await expect(popup.getByTestId('compact-status')).toContainText('Not ready');
  expect(await accessible(popup)).toEqual([]);
  await snap(popup, 'fly-compact-needs-ok', '01-left-to-the-full-window.png');

  // In the main window the same view is a page, with the way back to the Fly screen.
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#/fly/compact';
  });
  const inMain = page.getByTestId('fly-compact-page');
  await expect(inMain).toHaveAttribute('data-panel', 'false');
  await expect(inMain.locator('.rr-page-title')).toHaveText('Compact view');
  await expect(page.getByTestId('compact-status')).toContainText('Not ready');
  await page.getByTestId('compact-back').click();
  await expect(page.getByTestId('fly-page')).toBeVisible();
});
