import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { durationText, whenText } from '../../src/features/fly/core/sessionText';
import { axeViolations, colourOnlyStatus } from './a11y';
import { checkRow, clickAndLeave, expect, test, type RunningApp } from './harness';

/**
 * The session: what the Play screen shows from Launch until the game has closed, what it
 * says then, and the record it keeps.
 */

const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
const showWindow = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
const notifications = (app: ElectronApplication): Promise<{ title: string; body: string }[]> =>
  app.evaluate(
    () =>
      (
        globalThis as unknown as {
          __rigreadyTray(): { notifications: { title: string; body: string }[] };
        }
      ).__rigreadyTray().notifications
  );

/** Focus on nothing, at the top of the page: where both are when the window has just been opened. */
const focusNothing = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const scope = globalThis as unknown as {
      document: { activeElement: { blur(): void } | null };
      scrollTo(x: number, y: number): void;
    };
    scope.document.activeElement?.blur();
    scope.scrollTo(0, 0);
  });

/** What axe finds on the screen as it is, and anything said by colour alone. */
const accessible = async (page: Page): Promise<unknown[]> => [
  ...(await axeViolations(page)),
  ...(await colourOnlyStatus(page)),
];

/** Ticks or unticks an entry of the Play menu. */
async function menu(page: Page, entry: string): Promise<void> {
  await page.getByTestId('fly-more').click();
  await page.getByTestId(entry).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(entry)).toBeHidden();
  await focusNothing(page);
}

const buttons = (page: Page): Promise<(string | null)[]> =>
  page
    .getByTestId('fly-actions')
    .locator('[data-testid]')
    .evaluateAll((all) => all.map((el) => el.getAttribute('data-testid')));

const closeGame = (run: RunningApp): Promise<void> =>
  run.mutate([{ op: 'stopProcess', name: 'DCS.exe' }]);

test('session: the game running with its clock, Welcome back when it closes, and Stand down as the one action', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'fly-session');
  const { page, shot } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  // Never launched from here: it says so, in words a racer reads as naturally as a pilot.
  await expect(page.getByTestId('fly-context')).toHaveText('DCS WorldNo session yet');
  await menu(page, 'fly-minimize-pref');

  // Nothing on the record yet.
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-history').click();
  await expect(page.getByTestId('history-empty')).toContainText('No sessions yet.');
  await expect(page.getByTestId('history-empty')).toContainText(
    'Launch a game from the Play screen and its session is listed here once the game has closed'
  );
  await shot('no-history-yet');
  await page.getByTestId('history-close').click();
  await expect(page.getByTestId('history-dialog')).toBeHidden();
  await focusNothing(page);

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fly-activity')).toContainText('Launched DCS.exe');

  // In session: what is running, since when, and a clock.
  const session = page.getByTestId('fly-session');
  await expect(session).toHaveAttribute('data-phase', 'running');
  await expect(page.getByTestId('fly-session-title')).toHaveText('DCS World is running');
  await expect(page.getByTestId('fly-session-sub')).toHaveText(
    /^\s*Session in progress since \d\d:\d\d · DCS F\/A-18C\s*$/
  );
  // With its first session under way, the setup no longer says there was none.
  await expect(page.getByTestId('fly-context')).toHaveText('DCS World');
  const clock = page.getByTestId('fly-session-elapsed');
  await expect(clock).toHaveText(/^0:00:\d\d$/);
  const first = await clock.textContent();
  await expect(clock).not.toHaveText(first!);
  // While the game runs there is nothing for Enter to start a second time.
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'none');
  await expect(page.getByTestId('fly-actions').locator('kbd')).toHaveCount(0);
  expect(await buttons(page)).toEqual(['make-ready', 'launch', 'recheck', 'stand-down']);
  expect(await accessible(page)).toEqual([]);
  await shot('in-session');

  // The game is closed.
  await closeGame(run);
  await expect(session).toHaveAttribute('data-phase', 'ended');
  await expect(page.getByTestId('fly-session-title')).toHaveText('Welcome back');
  await expect(page.getByTestId('fly-session-sub')).toHaveText(
    /^\s*DCS F\/A-18C · less than a minute · closed\s+at \d\d:\d\d\s*$/
  );
  // Stand down is what is left to do: first, large, on Enter.
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'standDown');
  expect(await buttons(page)).toEqual(['stand-down', 'launch', 'make-ready', 'recheck']);
  await expect(page.getByTestId('stand-down').locator('kbd')).toHaveText('Enter');
  // The setup knows when its last session was.
  await expect(page.getByTestId('fly-context')).toHaveText(
    'DCS WorldLast session today, less than a minute'
  );
  await focusNothing(page);
  expect(await accessible(page)).toEqual([]);
  await shot('welcome-back');

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fly-activity-headline')).toHaveText('Closed 1 app');
  await expect(page.getByTestId('fly-activity')).toContainText('Closed TrackIR5.exe');
  await expect(session).toHaveCount(0);
  // TrackIR is closed now: the screen is back to offering the way to fly again.
  await expect(checkRow(page, 'TrackIR5')).toHaveAttribute('data-status', 'fail');
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'readyAndLaunch');
  expect(await buttons(page)).toEqual([
    'ready-and-launch',
    'make-ready',
    'launch',
    'recheck',
    'stand-down',
  ]);
  await shot('stood-down');

  // It is on the record.
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-history').click();
  await expect(page.getByTestId('history-line')).toHaveText('1 session, 0 min');
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await expect(page.getByTestId('history-row')).toContainText('DCS F/A-18C');
  await expect(page.getByTestId('history-row')).toContainText('less than a minute');
  const record = JSON.parse(
    await fs.readFile(path.join(run.dataRoot, 'fly', 'sessions.json'), 'utf8')
  ) as { current?: unknown; sessions: Record<string, unknown>[] };
  expect(record.current).toBeUndefined();
  expect(record.sessions).toHaveLength(1);
  expect(record.sessions[0]).toMatchObject({
    profileId: 'dcs-f-a-18c',
    profileName: 'DCS F/A-18C',
    gameName: 'DCS World',
    fixed: [],
  });
  expect(record.sessions[0]!['readySeconds']).toBeLessThan(5);
});

test('session: Dismiss puts the screen back without standing down', async ({ rig }) => {
  const run = await rig.launch('flying-all-good', 'fly-session-dismiss');
  const { page } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await menu(page, 'fly-minimize-pref');
  await page.getByTestId('launch').click();
  await expect(page.getByTestId('fly-session')).toHaveAttribute('data-phase', 'running');
  await closeGame(run);
  await expect(page.getByTestId('fly-session-title')).toHaveText('Welcome back');
  await page.getByTestId('fly-session-dismiss').click();
  await expect(page.getByTestId('fly-session')).toHaveCount(0);
  // Nothing was closed: the rig is as it was, ready to go again.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'launch');
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
});

test('session: with RigReady in the tray Windows says Welcome back, and Stand down runs by itself when asked to', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'fly-session-away');
  const { page, app, shot } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // Launch hides RigReady (the default). The game closes while nobody is at the window:
  // the click on Launch was the last thing done there, and the window went away with it.
  await clickAndLeave(page.getByTestId('launch'));
  await expect.poll(() => windowVisible(app)).toBe(false);
  await closeGame(run);
  await expect
    .poll(() => notifications(app))
    .toEqual([
      {
        title: 'Welcome back',
        body: 'DCS F/A-18C: less than a minute. Stand down when you are done.',
      },
    ]);
  await showWindow(app);
  await expect(page.getByTestId('fly-session-title')).toHaveText('Welcome back');
  // Nothing was done by itself: the helper apps still run.
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  await page.getByTestId('fly-session-dismiss').click();
  await expect(page.getByTestId('fly-session')).toHaveCount(0);

  // The setting, off until asked for.
  await page.getByTestId('fly-more').click();
  const setting = page.getByTestId('fly-auto-stand-down');
  await expect(setting).toContainText('Stand down when the game closes');
  await expect(setting.locator('.mdi-checkbox-blank-outline')).toBeVisible();
  await setting.click();
  await expect(setting.locator('.mdi-checkbox-marked-outline')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(setting).toBeHidden();

  await clickAndLeave(page.getByTestId('launch'));
  await expect.poll(() => windowVisible(app)).toBe(false);
  await closeGame(run);
  await expect
    .poll(async () => (await notifications(app)).at(-1))
    .toEqual({
      title: 'Welcome back',
      body: 'DCS F/A-18C: less than a minute. Stood down: Closed 1 app.',
    });
  expect(await notifications(app)).toHaveLength(2);
  await showWindow(app);
  // Back at the screen: it says what was done, and the checklist shows the rig stood down.
  await expect(page.getByTestId('fly-session-title')).toHaveText('Welcome back');
  await expect(page.getByTestId('fly-session-down')).toHaveText('Stood down: Closed 1 app');
  await expect(checkRow(page, 'TrackIR5')).toHaveAttribute('data-status', 'fail');
  expect(await accessible(page)).toEqual([]);
  // Stand down is done: it is not offered as the thing to do.
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'readyAndLaunch');
  await focusNothing(page);
  await shot('stood-down-by-itself');
  // The choice is kept.
  const preferences = JSON.parse(
    await fs.readFile(path.join(run.dataRoot, 'fly', 'preferences.json'), 'utf8')
  ) as Record<string, unknown>;
  expect(preferences).toMatchObject({ autoStandDown: true, minimizeOnLaunch: true });
});

/** Writes files below the data root, then starts RigReady again on them. */
async function restartWith(run: RunningApp, files: Record<string, unknown>): Promise<RunningApp> {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(run.dataRoot, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    );
  }
  return run.restart();
}

test('history: "last session" on the setup, the totals in one line, and every session with what it took to be ready', async ({
  rig,
}) => {
  const first = await rig.launch('flying-all-good', 'fly-history');
  await expect(first.page.getByTestId('fly-status-title')).toHaveText('Ready');

  // Twelve sessions over the last weeks: fourteen hours, TrackIR started six times.
  const now = new Date();
  const daysAgo = (days: number, hour: number, minute: number): Date =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour, minute);
  const trackir = { title: 'TrackIR', group: 'apps', message: 'Started TrackIR5.exe' };
  const layout = { title: 'Monitor layout', group: 'displays', message: 'Applied the layout' };
  const options = { title: 'DCS options', group: 'files', message: 'Restored options.lua' };
  const plan: {
    days: number;
    minutes: number;
    ready?: number;
    fixed?: object[];
    first?: [string, string];
    notReady?: boolean;
    huey?: boolean;
  }[] = [
    {
      days: 30,
      minutes: 68,
      ready: 21,
      fixed: [layout, trackir],
      first: ['Monitor layout', '2 differences'],
    },
    { days: 27, minutes: 68, ready: 2 },
    { days: 24, minutes: 68, ready: 14, fixed: [trackir], first: ['TrackIR', 'Not running'] },
    { days: 21, minutes: 58, ready: 3, huey: true },
    {
      days: 19,
      minutes: 68,
      ready: 18,
      fixed: [layout, options],
      first: ['Monitor layout', 'DELL G3223D is on, expected off'],
    },
    { days: 16, minutes: 68, notReady: true, first: ['T-Pendular-Rudder', 'Not connected'] },
    { days: 13, minutes: 68, ready: 9, fixed: [trackir], first: ['TrackIR', 'Not running'] },
    {
      days: 11,
      minutes: 68,
      ready: 11,
      fixed: [trackir, layout],
      first: ['TrackIR', 'Not running'],
    },
    { days: 9, minutes: 68, ready: 2 },
    {
      days: 6,
      minutes: 68,
      ready: 16,
      fixed: [layout, trackir, options],
      first: ['DCS options', 'Missing'],
    },
    { days: 4, minutes: 68, ready: 2, huey: true },
    { days: 2, minutes: 102, ready: 8, fixed: [trackir], first: ['TrackIR', 'Not running'] },
  ];
  const sessions = plan.map((entry, index) => {
    const startedAt = daysAgo(entry.days, 19, 10 + index).toISOString();
    return {
      id: `${startedAt}-seeded`,
      profileId: entry.huey ? 'dcs-uh-1h' : 'dcs-f-a-18c',
      profileName: entry.huey ? 'DCS UH-1H' : 'DCS F/A-18C',
      gameName: 'DCS World',
      startedAt,
      durationSeconds: entry.minutes * 60,
      ...(entry.ready !== undefined ? { readySeconds: entry.ready } : {}),
      fixed: entry.fixed ?? [],
      ...(entry.first ? { failedFirst: { title: entry.first[0], summary: entry.first[1] } } : {}),
      ...(entry.notReady ? { notReady: true } : {}),
    };
  });
  const { page, shot } = await restartWith(first, { 'fly/sessions.json': { sessions } });
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // The one line of context under the setup's name.
  const last = sessions.at(-1)!;
  const lastSession = `Last session ${whenText(new Date(last.startedAt), new Date())}, ${durationText(last.durationSeconds)}`;
  expect(lastSession).toMatch(
    /^Last session (Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, 1 h 42 min$/
  );
  await expect(page.getByTestId('fly-context')).toHaveText(`DCS World${lastSession}`);
  await shot('last-session');

  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-history').click();
  const dialog = page.getByTestId('history-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('history-line')).toHaveText(
    '12 sessions, 14 h; TrackIR needed starting 6 times'
  );
  await expect(page.getByTestId('history-fact-sessions')).toHaveText('Sessions12');
  await expect(page.getByTestId('history-fact-time')).toHaveText('In the game14 h');
  await expect(page.getByTestId('history-fact-ready')).toHaveText('Usually ready in9 s');
  await expect(page.getByTestId('history-fact-not-ready')).toHaveText('Launched not ready1');
  await expect(page.getByTestId('history-fixes').locator('li')).toHaveText([
    'TrackIR needed starting 6 times',
    'Monitor layout needed applying 4 times',
    'DCS options needed restoring twice',
  ]);
  // Newest first: setup, length, time to ready, what was fixed, what was wrong first.
  const rows = page.getByTestId('history-row');
  await expect(rows).toHaveCount(12);
  await expect(rows.first().locator('td')).toHaveText([
    /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day 19:21$/,
    /^DCS F\/A-18C\s*DCS World$/,
    '1 h 42 min',
    '8 s',
    'TrackIR',
    /^TrackIR\s*Not running$/,
  ]);
  await expect(rows.nth(1).locator('td')).toHaveText([
    /19:20$/,
    /^DCS UH-1H\s*DCS World$/,
    '1 h 8 min',
    '2 s',
    'nothing',
    '–',
  ]);
  // The one launched with the pedals missing says so, with an icon and words.
  await expect(rows.nth(6).locator('td').nth(3)).toHaveText('not ready');
  await expect(rows.nth(6).locator('td').nth(5)).toContainText('T-Pendular-Rudder');
  expect(await accessible(page)).toEqual([]);
  await shot('history');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('session: a game started through Steam is waited for, and the session begins when the game itself runs', async ({
  rig,
}) => {
  const first = await rig.launch('flying-all-good', 'fly-session-steam');
  await expect(first.page.getByTestId('fly-status-title')).toHaveText('Ready');
  const setup = [
    'schemaVersion: 1',
    'id: dcs-steam',
    'name: DCS through Steam',
    'game: dcs',
    "steamAppId: '223750'",
    "createdAt: '2026-10-03T12:00:00.000Z'",
    "updatedAt: '2026-10-03T12:00:00.000Z'",
    'checks: []',
    '',
  ].join('\n');
  const run = await restartWith(first, {
    'profiles/dcs-steam.yaml': setup,
    'state.json': { lastProfileId: 'dcs-steam', lastUsed: {} },
    'fly/preferences.json': { minimizeOnLaunch: false },
  });
  const { page, shot, mutate } = run;
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS through Steam');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('launch').click();
  await expect(page.getByTestId('fly-activity')).toContainText(
    'Asked Steam to start DCS through Steam'
  );
  const session = page.getByTestId('fly-session');
  await expect(session).toHaveAttribute('data-phase', 'starting');
  await expect(page.getByTestId('fly-session-title')).toHaveText('Waiting for DCS World to start');
  await expect(page.getByTestId('fly-session-sub')).toHaveText(
    /Steam was asked at \d\d:\d\d\.\s+The session begins when the game itself is running\./
  );
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'none');
  await shot('waiting-for-steam');

  await mutate([{ op: 'startProcess', name: 'DCS.exe', path: 'D:\\SteamLibrary\\DCS.exe' }]);
  await expect(session).toHaveAttribute('data-phase', 'running');
  await expect(page.getByTestId('fly-session-title')).toHaveText('DCS World is running');
  await closeGame(run);
  await expect(page.getByTestId('fly-session-title')).toHaveText('Welcome back');
  await expect(page.getByTestId('fly-session-sub')).toContainText('DCS through Steam');
});
