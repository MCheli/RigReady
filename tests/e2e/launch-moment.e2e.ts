import type { ElectronApplication } from '@playwright/test';
import { clickAndLeave, expect, test } from './harness';

/**
 * FLY-029 and FLY-030: what Launch will do is on the Play page before the click, and from
 * the click until the game is there the user is told, by the game's own name, that it is
 * starting: on the page while the window is up, and from Windows as the window goes away.
 */

const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
const notifications = (app: ElectronApplication): Promise<{ title: string; body: string }[]> =>
  app.evaluate(
    () =>
      (
        globalThis as unknown as {
          __rigreadyTray(): { notifications: { title: string; body: string }[] };
        }
      ).__rigreadyTray().notifications
  );

test('play: the steps Launch runs before and after the game are on the page before the click', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('fly-actions', 'launch-plan');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-plan-preLaunch')).toHaveText(
    'Before launch: Start VoiceAttack, Warm up the hub, Check TrackIR answers'
  );
  await expect(page.getByTestId('fly-plan-postLaunch')).toHaveText('After launch: Start SRS');
  // What runs at Stand down is not part of a launch, so it is not in these lines.
  await expect(page.getByTestId('fly-plan')).not.toContainText('Put the hub back');
  await shot('before-the-click');
});

test('play: from the click on Launch the page says "Starting" with the game\'s name, and Windows says it as the window goes away', async ({
  rig,
}) => {
  const { page, shot, app, mutate } = await rig.launch('flying-all-good', 'launch-starting');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  // This setup runs nothing around the game, so there is nothing to say before the click.
  await expect(page.getByTestId('fly-plan')).toHaveCount(0);

  // Windows accepts the start, and the game takes its time to show up.
  await mutate([{ op: 'failProcessStart', name: 'DCS.exe', mode: 'neverRuns' }]);
  await clickAndLeave(page.getByTestId('launch'));
  const starting = page.getByTestId('fly-starting');
  // The setup is named "DCS F/A-18C"; the line names the game.
  await expect(starting).toHaveText('Starting DCS World');
  await expect(starting).toHaveAttribute('role', 'status');
  expect(await windowVisible(app)).toBe(true);
  expect(await notifications(app)).toEqual([]);
  await shot('starting');

  // The game is there. RigReady gets out of the way and leaves the same line with Windows.
  await mutate([
    { op: 'failProcessStart', name: 'DCS.exe', mode: 'off' },
    {
      op: 'startProcess',
      name: 'DCS.exe',
      path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe',
    },
  ]);
  await expect.poll(() => windowVisible(app)).toBe(false);
  await expect
    .poll(() => notifications(app))
    .toEqual([
      {
        title: 'Starting DCS World',
        body: 'It can take a minute to show. RigReady is out of the way while you play.',
      },
    ]);
});

test('play: with "hide after launch" off the window stays and Windows is not asked to say anything', async ({
  rig,
}) => {
  const { page, app } = await rig.launch('flying-all-good', 'launch-window-stays');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-minimize-pref').click();
  await page.keyboard.press('Escape');

  await page.getByTestId('launch').click();
  await expect(page.getByTestId('fly-activity')).toContainText('Launched DCS.exe');
  // The game is up: the line is gone again, and nothing was sent to Windows.
  await expect(page.getByTestId('fly-starting')).toHaveCount(0);
  expect(await windowVisible(app)).toBe(true);
  expect(await notifications(app)).toEqual([]);
});

test('play: while the game runs the page no longer says what Launch will do, and says it again once the game has closed', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('fly-actions', 'launch-plan-while-playing');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-minimize-pref').click();
  await page.keyboard.press('Escape');
  const before = 'Before launch: Start VoiceAttack, Warm up the hub, Check TrackIR answers';
  await expect(page.getByTestId('fly-plan-preLaunch')).toHaveText(before);

  // One step fails and asks; the lines are still what Launch will do.
  await page.getByTestId('launch').click();
  await expect(page.getByTestId('launch-paused')).toContainText('"Check TrackIR answers" failed');
  await page.getByTestId('paused-launch').click();
  const activity = page.getByTestId('fly-activity');
  await expect(activity).toContainText('Launched DCS.exe');
  await expect(activity).toContainText('Started SR-ClientRadio.exe');
  await expect(page.getByTestId('fly-session')).toHaveAttribute('data-phase', 'running');

  // The game is up. Launch is not what comes next, and what ran is in the Launch panel.
  await expect(page.getByTestId('fly-plan')).toHaveCount(0);
  await expect(page.getByTestId('fly-starting')).toHaveCount(0);
  await expect(page.locator('[data-testid="fly-activity"] .fly-entry .rr-row-sub')).toHaveText([
    'Before launch · Start VoiceAttack',
    'Before launch · Warm up the hub',
    'Before launch · Check TrackIR answers',
    'Game · DCS with launch steps',
    'After launch · Start SRS',
  ]);
  await shot('while-the-game-runs');

  // The game is closed: Launch would run its steps again, and the page says so again.
  await mutate([{ op: 'stopProcess', name: 'DCS.exe' }]);
  await expect(page.getByTestId('fly-plan-preLaunch')).toHaveText(before);
  await expect(page.getByTestId('fly-plan-postLaunch')).toHaveText('After launch: Start SRS');
  await shot('after-the-game');
});
