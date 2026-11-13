import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { checkRow, expect, openOption, screensDir, test, type RunningApp } from './harness';

/**
 * Stand down by itself when the game closes: the setup's switch and its countdown length,
 * the countdown on every screen with its Cancel, and what it says it did.
 *
 * A game that closes within two minutes of starting starts no countdown, so the sessions
 * here are older than that. The session is written to fly/sessions.json as one that began
 * 42 minutes ago, RigReady is started again while the game runs (the scenario), and then
 * the game is closed.
 */

const SETUP = 'dcs-f-a-18c';
const GAME = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe';

const closeGame = (run: RunningApp): Promise<void> =>
  run.mutate([{ op: 'stopProcess', name: 'DCS.exe' }]);
const startGame = (run: RunningApp): Promise<void> =>
  run.mutate([{ op: 'startProcess', name: 'DCS.exe', path: GAME }]);

const setupPath = (run: RunningApp): string => path.join(run.dataRoot, 'profiles', `${SETUP}.yaml`);
const setupFile = (run: RunningApp): Promise<string> => fs.readFile(setupPath(run), 'utf8');

/** Writes the countdown length into the setup's file by hand, as a user with an editor would. */
async function countdownByHand(run: RunningApp, seconds: number): Promise<void> {
  const text = (await setupFile(run)).trimEnd();
  await fs.writeFile(
    setupPath(run),
    `${text}\nextensions:\n  fly:\n    standDownAfterSeconds: ${seconds}\n`
  );
}

/** Starts RigReady again in the middle of a session that began 42 minutes ago. */
async function inSession(run: RunningApp): Promise<RunningApp> {
  const startedAt = new Date(Date.now() - 42 * 60_000).toISOString();
  const current = {
    id: `${startedAt}-${SETUP}`,
    profileId: SETUP,
    profileName: 'DCS F/A-18C',
    gameName: 'DCS World',
    startedAt,
    fixed: [],
    processes: ['DCS.exe'],
  };
  const file = path.join(run.dataRoot, 'fly', 'sessions.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ current, sessions: [] }, null, 2));
  const next = await run.restart();
  await expect(next.page.getByTestId('fly-session')).toHaveAttribute('data-phase', 'running');
  await expect(next.page.getByTestId('fly-session-title')).toHaveText('DCS World is running');
  return next;
}

async function openEditor(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  await page
    .locator('[data-testid="profile-row"][data-name="DCS F/A-18C"]')
    .getByTestId('profile-edit')
    .click();
  await expect(page.getByTestId('profile-edit-page')).toBeVisible();
  await page.getByTestId('edit-on-close').scrollIntoViewIfNeeded();
}

/** The section "When the game closes" of the setup editor that is open on this page. */
const onClose = (page: Page) => ({
  panel: page.getByTestId('edit-on-close'),
  toggle: page.getByTestId('edit-on-close-switch').locator('input'),
  length: page.getByTestId('edit-on-close-seconds'),
});

/** Focus on nothing, so that a picture shows the screen and not where the last click was. */
const focusNothing = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const scope = globalThis as unknown as {
      document: { activeElement: { blur(): void } | null };
    };
    scope.document.activeElement?.blur();
  });

/** What axe finds on the screen as it is, and anything said by colour alone. */
const accessible = async (page: Page): Promise<unknown[]> => [
  ...(await axeViolations(page)),
  ...(await colourOnlyStatus(page)),
];

const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
const hideWindow = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide());
const showWindow = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
/**
 * Has the page hear what the browser says when its window goes to the tray or is minimized.
 * The test driver holds every page "visible" whatever its window does, so here the page
 * never hears it by itself. Presence.vue then tells main, as it does in the app.
 */
async function pageHidden(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
  })()`);
}
const notifications = (app: ElectronApplication): Promise<{ title: string; body: string }[]> =>
  app.evaluate(
    () =>
      (
        globalThis as unknown as {
          __rigreadyTray(): { notifications: { title: string; body: string }[] };
        }
      ).__rigreadyTray().notifications
  );

/**
 * What Windows was told, with the length of the session read as "42 min". The session
 * began 42 minutes before RigReady was started again, and on a busy PC a minute or two
 * may pass before the game is closed.
 */
const told = async (app: ElectronApplication): Promise<{ title: string; body: string }[]> =>
  (await notifications(app)).map((n) => ({
    ...n,
    body: n.body.replace(/^DCS F\/A-18C: 4[2-5] min\. /, 'DCS F/A-18C: 42 min. '),
  }));

/** Opens the compact view from the Play menu and hands back its window. */
async function openCompact(app: ElectronApplication, page: Page): Promise<Page> {
  await page.getByTestId('fly-more').click();
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    page.getByTestId('fly-compact').click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.getByTestId('fly-compact-page')).toHaveAttribute('data-panel', 'true');
  return popup;
}

/** A picture of the small window. */
async function snap(popup: Page, flow: string, name: string): Promise<void> {
  await popup.mouse.move(2, 2);
  await popup.evaluate('document.fonts.ready');
  await popup.screenshot({ path: path.join(screensDir, flow, name) });
}

/** Whether everything in the small window is on screen without scrolling. */
const fits = (popup: Page): Promise<boolean> =>
  popup.getByTestId('fly-compact-page').evaluate((el) => {
    const box = el as unknown as { scrollHeight: number; clientHeight: number };
    return box.scrollHeight <= box.clientHeight;
  });

const STAYED_OPEN =
  'TrackIR5.exe is still running: it was asked to close and stayed open. Some apps only go to the tray when asked. Close it yourself, or switch on "Force it closed if it does not close" for this check in the setup.';

test('stand down on close: every setup has its own switch and countdown length; the countdown then stands the rig down and says what it did', async ({
  rig,
}) => {
  test.setTimeout(180_000);
  let run = await rig.launch('fly-game-running', 'fly-stand-down-setting');
  let page = run.page;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // A setup saved before the switch existed says nothing about it: on, one minute.
  expect(await setupFile(run)).not.toContain('extensions');
  await openEditor(page);
  let { panel, toggle, length } = onClose(page);
  await expect(panel).toHaveAttribute('data-enabled', 'true');
  await expect(toggle).toBeChecked();
  await expect(page.getByTestId('edit-on-close-switch')).toContainText(
    'Stand down when the game closes'
  );
  await expect(length).toContainText('1 minute');
  await expect(page.getByTestId('edit-on-close-sub')).toHaveText(
    /RigReady counts down on the screen, with a Cancel button, and then does what the Stand\s+down button does\. A game that closes within two minutes of starting does not start the\s+countdown\./
  );
  expect(await accessible(page)).toEqual([]);
  await run.shot('on-by-default');

  // The lengths on offer; this setup gets ten seconds.
  await length.click();
  await expect(page.locator('.v-overlay--active').getByRole('option')).toHaveText([
    '10 seconds',
    '30 seconds',
    '1 minute',
    '2 minutes',
    '5 minutes',
    '10 minutes',
  ]);
  await run.shot('lengths');
  await openOption(page, '10 seconds').click();
  await expect(length).toContainText('10 seconds');
  await page.getByTestId('edit-save').click();
  await expect
    .poll(() => setupFile(run))
    .toMatch(/extensions:\s+fly:\s+standDownOnClose: true\s+standDownAfterSeconds: 10\b/);

  // 42 minutes into a session the game closes: ten seconds, then Stand down by itself.
  run = await inSession(run);
  page = run.page;
  await closeGame(run);
  const notice = page.getByTestId('stand-down-notice');
  await expect(notice).toHaveAttribute('data-state', 'counting');
  await expect(page.getByTestId('stand-down-notice-title')).toHaveText(
    /^Stand down in ([1-9]|10) seconds?$/
  );
  await expect(notice).toHaveAttribute('data-state', 'result', { timeout: 30_000 });
  await expect(page.getByTestId('stand-down-notice-title')).toHaveText('Stood down');
  await expect(notice).toContainText('DCS F/A-18C, after DCS World closed.');
  await expect(page.getByTestId('stand-down-notice-lines').locator('li')).toHaveText([
    'Closed 1 app',
  ]);
  // The Play screen says the same in its own line, and the checklist shows what was closed.
  await expect(page.getByTestId('fly-session-title')).toHaveText('Welcome back');
  await expect(page.getByTestId('fly-session-sub')).toHaveText(
    /^\s*DCS F\/A-18C · 4[2-5] min · closed\s+at \d\d:\d\d\s*$/
  );
  await expect(page.getByTestId('fly-session-down')).toHaveText('Stood down: Closed 1 app');
  await expect(page.getByTestId('fly-session-down')).toHaveAttribute('data-state', 'result');
  await expect(checkRow(page, 'TrackIR5')).toHaveAttribute('data-status', 'fail');
  await focusNothing(page);
  expect(await accessible(page)).toEqual([]);
  await run.shot('stood-down-by-itself');
  // What it did stays until it is read.
  await page.getByTestId('stand-down-notice-ok').click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('fly-session')).toHaveCount(0);

  // Switched off for this setup: the screen says what that means, and the file keeps it.
  await openEditor(page);
  ({ panel, toggle, length } = onClose(page));
  await expect(toggle).toBeChecked();
  await expect(length).toContainText('10 seconds');
  await toggle.uncheck();
  await expect(panel).toHaveAttribute('data-enabled', 'false');
  await expect(page.getByTestId('edit-on-close-sub')).toHaveText(
    /Nothing is closed by itself\. The Play screen says Welcome back, and the Stand down\s+button is there for when you are done\./
  );
  await focusNothing(page);
  expect(await accessible(page)).toEqual([]);
  await run.shot('switched-off');
  await page.getByTestId('edit-save').click();
  await expect
    .poll(() => setupFile(run))
    .toMatch(/standDownOnClose: false\s+standDownAfterSeconds: 10\b/);

  // The same session again: nothing counts down, nothing is closed, Stand down is offered.
  run = await inSession(run);
  page = run.page;
  await closeGame(run);
  await expect(page.getByTestId('fly-session-title')).toHaveText('Welcome back');
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'standDown');
  await expect(page.getByTestId('stand-down-notice')).toHaveCount(0);
  await expect(page.getByTestId('fly-session-down')).toHaveCount(0);
  await expect(page.getByTestId('fly-session-dismiss')).toBeVisible();
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  await focusNothing(page);
  await run.shot('off-nothing-by-itself');
});

test('stand down on close: the countdown says what will happen and when, and Cancel ends it with nothing closed', async ({
  rig,
}) => {
  test.setTimeout(120_000);
  let run = await rig.launch('fly-game-running', 'fly-stand-down-countdown');
  await expect(run.page.getByTestId('fly-status-title')).toHaveText('Ready');
  run = await inSession(run);
  const { page, shot } = run;
  await closeGame(run);

  // The setup says nothing about it: one minute, and the screen says so.
  const notice = page.getByTestId('stand-down-notice');
  await expect(notice).toHaveAttribute('data-state', 'counting');
  const title = page.getByTestId('stand-down-notice-title');
  await expect(title).toHaveText(/^Stand down in (1 minute|5\d seconds)$/);
  await expect(page.getByTestId('stand-down-notice-text')).toHaveText(
    /^\s*DCS World has closed\. When the time is up, RigReady stands down DCS F\/A-18C: it closes the\s+helper apps and puts the rig back, as the Stand down button does\.\s*$/
  );
  await expect(page.getByTestId('stand-down-notice-cancel')).toHaveText('Cancel');
  await expect(page.getByTestId('stand-down-notice-edit')).toHaveText('Change this for the setup');
  // It counts.
  const first = await title.textContent();
  await expect(title).not.toHaveText(first!);
  // The Play screen carries it too. While it counts the way out is Cancel, not Dismiss.
  await expect(page.getByTestId('fly-session-title')).toHaveText('Welcome back');
  const line = page.getByTestId('fly-session-down');
  await expect(line).toHaveAttribute('data-state', 'counting');
  await expect(line).toHaveText(/^\s*Stand down in (1 minute|5\d seconds)\s*$/);
  await expect(page.getByTestId('fly-session-dismiss')).toHaveCount(0);
  // Nothing has been closed yet.
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  await focusNothing(page);
  expect(await accessible(page)).toEqual([]);
  await shot('countdown');

  await page.getByTestId('stand-down-notice-cancel').click();
  await expect(notice).toHaveCount(0);
  await expect(line).toHaveAttribute('data-state', 'held');
  await expect(line).toHaveText('Stand down was cancelled. Nothing was closed.');
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  // Stand down is still there to press, and Dismiss is back.
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'standDown');
  await focusNothing(page);
  expect(await accessible(page)).toEqual([]);
  await shot('cancelled');
  await page.getByTestId('fly-session-dismiss').click();
  await expect(page.getByTestId('fly-session')).toHaveCount(0);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
});

test('stand down on close: the countdown is on every page and in the compact view, and the game starting again ends it', async ({
  rig,
}) => {
  test.setTimeout(120_000);
  const flow = 'fly-stand-down-everywhere';
  let run = await rig.launch('fly-game-running', flow);
  await expect(run.page.getByTestId('fly-status-title')).toHaveText('Ready');
  // Five minutes, written into the setup's file by hand.
  await countdownByHand(run, 300);
  run = await inSession(run);
  const { page, app, shot } = run;
  await closeGame(run);

  const notice = page.getByTestId('stand-down-notice');
  const title = page.getByTestId('stand-down-notice-title');
  const counting = /^\s*Stand down in (5 minutes|4 minutes( \d+ seconds?)?)\s*$/;
  await expect(notice).toHaveAttribute('data-state', 'counting');
  await expect(title).toHaveText(counting);

  // On another page it is still there, with its Cancel.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  await expect(page.locator('[data-testid="profile-row"]')).toHaveCount(1);
  await expect(notice).toHaveAttribute('data-state', 'counting');
  await expect(page.getByTestId('stand-down-notice-cancel')).toBeVisible();
  await focusNothing(page);
  await shot('on-another-page');
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-session-down')).toHaveAttribute('data-state', 'counting');

  // The compact view has no room for the notice: its session line counts and has Cancel.
  const popup = await openCompact(app, page);
  await expect(popup.getByTestId('fly-session-title')).toHaveText('Welcome back');
  await expect(popup.getByTestId('fly-session-down')).toHaveAttribute('data-state', 'counting');
  await expect(popup.getByTestId('fly-session-down')).toHaveText(counting);
  await expect(popup.getByTestId('fly-session-cancel')).toHaveText('Cancel');
  await expect(popup.getByTestId('stand-down-notice')).toHaveCount(0);
  expect(await accessible(popup)).toEqual([]);

  // The game is started again while it counts: the countdown is over, nothing was closed,
  // and this is a session again.
  await startGame(run);
  await expect(page.getByTestId('fly-session')).toHaveAttribute('data-phase', 'running');
  await expect(notice).toHaveCount(0);
  await expect(popup.getByTestId('fly-session')).toHaveAttribute('data-phase', 'running');
  await expect(popup.getByTestId('fly-session-cancel')).toHaveCount(0);
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  await focusNothing(page);
  await shot('game-is-back');

  // It closes again within seconds: too short to have been a session, so nothing counts
  // down, and the screen says why.
  await closeGame(run);
  await expect(page.getByTestId('fly-session-title')).toHaveText('Welcome back');
  await expect(page.getByTestId('fly-session-down')).toHaveAttribute('data-state', 'held');
  await expect(page.getByTestId('fly-session-down')).toHaveText(
    'It closed within two minutes of starting, so Stand down did not start by itself.'
  );
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'standDown');
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  await focusNothing(page);
  expect(await accessible(page)).toEqual([]);
  await shot('closed-again-at-once');
});

test('stand down on close: Cancel in the compact view ends the countdown everywhere', async ({
  rig,
}) => {
  test.setTimeout(120_000);
  const flow = 'fly-stand-down-compact';
  let run = await rig.launch('fly-game-running', flow);
  await expect(run.page.getByTestId('fly-status-title')).toHaveText('Ready');
  run = await inSession(run);
  const { page, app } = run;
  const popup = await openCompact(app, page);
  await expect(popup.getByTestId('fly-session')).toHaveAttribute('data-phase', 'running');
  await closeGame(run);

  await expect(popup.getByTestId('fly-session-down')).toHaveAttribute('data-state', 'counting');
  await expect(page.getByTestId('stand-down-notice')).toHaveAttribute('data-state', 'counting');
  // The line under "Welcome back" is a third one: the small window still shows everything.
  await expect(popup.getByTestId('fly-session-sub')).toHaveText(/closed\s+at \d\d:\d\d/);
  expect(await fits(popup)).toBe(true);
  await snap(popup, flow, '01-compact-countdown.png');
  await popup.getByTestId('fly-session-cancel').click();
  await expect(popup.getByTestId('fly-session-down')).toHaveAttribute('data-state', 'held');
  await expect(popup.getByTestId('fly-session-down')).toHaveText(
    'Stand down was cancelled. Nothing was closed.'
  );
  await expect(popup.getByTestId('fly-session-cancel')).toHaveCount(0);
  await expect(page.getByTestId('stand-down-notice')).toHaveCount(0);
  await expect(page.getByTestId('fly-session-down')).toHaveText(
    'Stand down was cancelled. Nothing was closed.'
  );
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  expect(await fits(popup)).toBe(true);
  expect(await accessible(popup)).toEqual([]);
  await snap(popup, flow, '02-compact-cancelled.png');
});

test('stand down on close: the notice can be moved to the top bar, where it covers no button of the page, and Cancel there ends the countdown with nothing closed', async ({
  rig,
}) => {
  test.setTimeout(120_000);
  let run = await rig.launch('fly-game-running', 'fly-stand-down-top-bar');
  await expect(run.page.getByTestId('fly-status-title')).toHaveText('Ready');
  await countdownByHand(run, 300);
  run = await inSession(run);
  const { page, shot } = run;
  await closeGame(run);
  const notice = page.getByTestId('stand-down-notice');
  const bar = page.getByTestId('stand-down-bar');
  const counting = /^\s*Stand down in (5 minutes|4 minutes( \d+ seconds?)?)\s*$/;
  await expect(notice).toHaveAttribute('data-state', 'counting');
  await expect(page.getByTestId('stand-down-notice-title')).toHaveText(counting);
  await expect(bar).toHaveCount(0);

  // The notice leads to where this is set for the setup. There it lies over the editor's
  // own Save and Cancel, in the bottom right corner.
  await page.getByTestId('stand-down-notice-edit').click();
  await expect(page.getByTestId('profile-edit-page')).toBeVisible();
  await page.getByTestId('edit-on-close').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('edit-on-close-seconds')).toContainText('5 minutes');
  await expect(notice).toHaveAttribute('data-state', 'counting');
  await expect(page.getByTestId('stand-down-notice-away')).toHaveAttribute(
    'aria-label',
    'Move the countdown to the top bar'
  );
  await focusNothing(page);
  await shot('over-the-setup-editor');

  // Moved to the top bar it covers nothing: the countdown and its Cancel are still on the
  // screen, and the editor's buttons can be pressed (a click on a covered button fails).
  await page.getByTestId('stand-down-notice-away').click();
  await expect(notice).toHaveCount(0);
  // The bar has little room: there the time is a clock.
  await expect(page.getByTestId('stand-down-bar-title')).toHaveText(
    /^\s*Stand down in (5:00|4:\d\d)\s*$/
  );
  await expect(page.getByTestId('stand-down-bar-cancel')).toHaveText('Cancel');
  await page.mouse.move(2, 2);
  await focusNothing(page);
  expect(await accessible(page)).toEqual([]);
  await shot('in-the-top-bar');
  await page.getByTestId('edit-cancel').click();
  await expect(page.locator('[data-testid="profile-row"]')).toHaveCount(1);

  // It stays in the bar from page to page, and comes back as the notice when it is pressed.
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-session-down')).toHaveAttribute('data-state', 'counting');
  await expect(bar).toBeVisible();
  await expect(notice).toHaveCount(0);
  await page.getByTestId('stand-down-bar-show').click();
  await expect(notice).toHaveAttribute('data-state', 'counting');
  await expect(bar).toHaveCount(0);

  // Cancel in the bar ends the countdown, as Cancel in the notice does.
  await page.getByTestId('stand-down-notice-away').click();
  await expect(bar).toBeVisible();
  await page.getByTestId('stand-down-bar-cancel').click();
  await expect(bar).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  const line = page.getByTestId('fly-session-down');
  await expect(line).toHaveAttribute('data-state', 'held');
  await expect(line).toHaveText('Stand down was cancelled. Nothing was closed.');
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'standDown');
  await page.mouse.move(2, 2);
  await focusNothing(page);
  expect(await accessible(page)).toEqual([]);
  await shot('cancelled-from-the-top-bar');
});

test('stand down on close: "Change this for the setup" from the editor of another setup opens the setup counting down, and asks first when the other has unsaved changes', async ({
  rig,
}) => {
  test.setTimeout(120_000);
  let run = await rig.launch('fly-game-running', 'fly-stand-down-other-setup');
  await expect(run.page.getByTestId('fly-status-title')).toHaveText('Ready');
  await countdownByHand(run, 300);
  // A second setup, the one open in the editor when the countdown starts.
  await fs.copyFile(
    path.join('fixtures', 'scenarios', 'profiles', 'fly-dcs-uh-1h.yaml'),
    path.join(run.dataRoot, 'profiles', 'fly-dcs-uh-1h.yaml')
  );
  run = await inSession(run);
  const { page, shot } = run;
  await closeGame(run);
  const notice = page.getByTestId('stand-down-notice');
  await expect(notice).toHaveAttribute('data-state', 'counting');
  const name = page.getByTestId('edit-name').locator('input');
  const openHuey = async (): Promise<void> => {
    await page.getByTestId('mode-configure').click();
    await page.getByTestId('nav-profiles').click();
    await page
      .locator('[data-testid="profile-row"][data-name="DCS UH-1H"]')
      .getByTestId('profile-edit')
      .click();
    await expect(page.getByTestId('profile-edit-page')).toBeVisible();
    await expect(name).toHaveValue('DCS UH-1H');
  };

  // From the Huey's editor with nothing changed: the Hornet's editor, which counts down.
  await openHuey();
  await page.getByTestId('stand-down-notice-edit').click();
  await expect(page).toHaveURL(new RegExp(`#/configure/profiles/${SETUP}$`));
  await expect(name).toHaveValue('DCS F/A-18C');
  await page.getByTestId('edit-on-close').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('edit-on-close-seconds')).toContainText('5 minutes');
  await expect(page.getByTestId('discard-warning')).toHaveCount(0);

  // The Huey renamed and not saved: the editor asks before it drops that, and names it.
  await openHuey();
  await name.fill('DCS UH-1H (night)');
  await page.getByTestId('stand-down-notice-edit').click();
  await expect(page.getByTestId('discard-warning')).toBeVisible();
  await expect(page.getByTestId('discard-other-setup')).toHaveText(
    'You asked to open another setup. Your changes to "DCS UH-1H" are not saved. Its file stays exactly as it was.'
  );
  await focusNothing(page);
  await shot('asks-before-another-setup');
  // "Keep editing": still the Huey, with the new name.
  await page.getByTestId('discard-stay').click();
  await expect(page.getByTestId('discard-warning')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/configure\/profiles\/fly-dcs-uh-1h$/);
  await expect(name).toHaveValue('DCS UH-1H (night)');

  // "Discard": the Hornet's editor, and the Huey's file as it was.
  await page.getByTestId('stand-down-notice-edit').click();
  await page.getByTestId('discard-confirm').click();
  await expect(page).toHaveURL(new RegExp(`#/configure/profiles/${SETUP}$`));
  await expect(name).toHaveValue('DCS F/A-18C');
  await expect(page.getByTestId('edit-on-close-seconds')).toContainText('5 minutes');
  await focusNothing(page);
  await shot('the-setup-counting-down');
  const huey = await fs.readFile(path.join(run.dataRoot, 'profiles', 'fly-dcs-uh-1h.yaml'), 'utf8');
  expect(huey).toMatch(/^name: DCS UH-1H\r?$/m);
  expect(huey).not.toContain('night');

  await page.getByTestId('stand-down-notice-cancel').click();
  await expect(notice).toHaveCount(0);
});

test('stand down on close: on a page with the Save bar along the bottom, the notice stands above the bar and Save and Back can be pressed', async ({
  rig,
}) => {
  test.setTimeout(120_000);
  let run = await rig.launch('fly-game-running', 'fly-stand-down-save-bar');
  await expect(run.page.getByTestId('fly-status-title')).toHaveText('Ready');
  await countdownByHand(run, 300);
  run = await inSession(run);
  const { page, shot } = run;
  await closeGame(run);
  const notice = page.getByTestId('stand-down-notice');
  await expect(notice).toHaveAttribute('data-state', 'counting');
  const bottomOfNotice = async (): Promise<number> => {
    const box = (await notice.boundingBox())!;
    return Math.round(box.y + box.height);
  };
  const height = await page.evaluate(
    () => (globalThis as unknown as { innerHeight: number }).innerHeight
  );
  // On a page without the bar it is 20 px above the bottom edge of the window.
  await expect.poll(bottomOfNotice).toBe(height - 20);

  // The editor of a virtual controller has the shared Save bar, with Back and Save at the
  // corner where the notice is. The notice is not put away here: it moves up by itself.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-virtual-controller').click();
  await page
    .locator('[data-testid="vc-builtin"][data-id="starting-hotas"]')
    .getByTestId('vc-copy')
    .click();
  await expect(page.getByTestId('vc-editor')).toBeVisible();
  const bar = page.getByTestId('save-bar');
  await expect(bar).toBeInViewport({ ratio: 1 });
  await expect(notice).toHaveAttribute('data-state', 'counting');
  const topOfBar = async (): Promise<number> => Math.round((await bar.boundingBox())!.y);
  await expect.poll(async () => (await topOfBar()) - (await bottomOfNotice())).toBe(20);
  // Both buttons of the bar can be pressed: a click on a covered button fails.
  await page.getByTestId('save-bar-save').click({ trial: true });
  await focusNothing(page);
  await shot('above-the-save-bar');
  await page.getByTestId('save-bar-back').click();
  await expect(page.getByTestId('vc-editor')).toHaveCount(0);

  // Without the bar it is back at the bottom of the window.
  await expect(notice).toHaveAttribute('data-state', 'counting');
  await expect.poll(bottomOfNotice).toBe(height - 20);
  await page.getByTestId('stand-down-notice-cancel').click();
  await expect(notice).toHaveCount(0);
});

test('stand down on close: with RigReady in the tray Windows says when it starts and what it did; a step that did not work is named and nothing says it was done', async ({
  rig,
}) => {
  test.setTimeout(150_000);
  let run = await rig.launch('fly-game-running', 'fly-stand-down-step-failed');
  await expect(run.page.getByTestId('fly-status-title')).toHaveText('Ready');
  await countdownByHand(run, 10);
  run = await inSession(run);
  const { page, app, shot } = run;
  // TrackIR goes to the tray when it is asked to close, as its X button makes it.
  await run.mutate([{ op: 'failProcessClose', name: 'TrackIR5.exe' }]);

  // Nobody is at RigReady when the game closes: the window is in the tray, and its page
  // has said so.
  await hideWindow(app);
  await expect.poll(() => windowVisible(app)).toBe(false);
  await pageHidden(page);
  await closeGame(run);
  await expect
    .poll(async () => (await told(app))[0])
    .toEqual({
      title: 'Welcome back',
      body: 'DCS F/A-18C: 42 min. Stand down starts in 10 seconds. Open RigReady to cancel.',
    });
  // In the app the window comes back by itself for the countdown (sessions.test.ts has
  // that). A scenario run only notes where the window was asked to go, because its
  // monitors are not this PC's, so here the window stays in the tray for now.

  const notice = page.getByTestId('stand-down-notice');
  await expect(notice).toHaveAttribute('data-state', 'result', { timeout: 30_000 });
  await expect(page.getByTestId('stand-down-notice-title')).toHaveText(
    'Stand down ran, but 1 step needs attention'
  );
  await expect(page.getByTestId('stand-down-notice-lines').locator('li')).toHaveText([STAYED_OPEN]);
  await expect(notice).not.toContainText('Stood down');
  const line = page.getByTestId('fly-session-down');
  await expect(line).toHaveAttribute('data-state', 'result');
  await expect(line).toHaveText(`Stand down ran, but 1 step needs attention: ${STAYED_OPEN}`);
  // It is still running, and the checklist says so.
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  // Windows was told the same, in the same words.
  await expect
    .poll(() => told(app))
    .toEqual([
      {
        title: 'Welcome back',
        body: 'DCS F/A-18C: 42 min. Stand down starts in 10 seconds. Open RigReady to cancel.',
      },
      {
        title: 'Welcome back',
        body: `DCS F/A-18C: 42 min. Stand down ran, but 1 step needs attention: ${STAYED_OPEN}`,
      },
    ]);
  // Opened from the tray, the screen still says it.
  await showWindow(app);
  await expect.poll(() => windowVisible(app)).toBe(true);
  await expect(notice).toHaveAttribute('data-state', 'result');
  await focusNothing(page);
  expect(await accessible(page)).toEqual([]);
  await shot('step-failed');
  await page.getByTestId('stand-down-notice-ok').click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('fly-session')).toHaveCount(0);
});
