import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/**
 * One action to fly: the primary action of the Fly screen, what Enter does, and the run
 * "Make ready and launch" shown step by step.
 */

interface Invoke {
  rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
}

/** Whether the game the setup launches is running, asked the way the screen asks. */
const gameRunning = async (page: Page, profileId: string): Promise<boolean> => {
  const answer = (await page.evaluate(
    (id) => (globalThis as unknown as Invoke).rigready.invoke('fly:gameStatus', { profileId: id }),
    profileId
  )) as { ok: boolean; value?: { running: boolean } };
  return answer.ok && answer.value!.running;
};

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

/** Stay on screen after Launch, to see what it did. */
async function stayOnScreen(page: Page): Promise<void> {
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-minimize-pref').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fly-minimize-pref')).toBeHidden();
  // The driver scrolls a menu entry into view before it clicks it; a hand does not.
  await focusNothing(page);
}

const stepStates = (page: Page): Promise<string[]> =>
  page
    .getByTestId('fly-steps')
    .locator('li')
    .evaluateAll((steps) =>
      steps.map((li) => `${li.getAttribute('data-testid')}=${li.getAttribute('data-state')}`)
    );

test('one action: Enter makes the rig ready phase by phase, waits for the layout answer, and launches once everything required is met', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('fly-make-ready-all', 'fly-one-action');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(page.getByTestId('fly-status-count')).toHaveText('(4)');

  // Not ready, and RigReady can fix it: that is what the screen offers first.
  const actions = page.getByTestId('fly-actions');
  await expect(actions).toHaveAttribute('data-primary', 'readyAndLaunch');
  const primary = page.getByTestId('ready-and-launch');
  await expect(primary).toContainText('Make ready and launch');
  // The key that runs it is on the button.
  await expect(primary.locator('kbd')).toHaveText('Enter');
  await expect(primary).toHaveAttribute('aria-keyshortcuts', 'Enter');
  // The separate actions are still there, each doing its own part.
  for (const id of ['make-ready', 'launch', 'recheck', 'stand-down']) {
    await expect(page.getByTestId(id)).toBeEnabled();
  }
  // In reading order: the primary action first.
  expect(
    await actions
      .locator('[data-testid]')
      .evaluateAll((all) => all.map((el) => el.getAttribute('data-testid')))
  ).toEqual(['ready-and-launch', 'make-ready', 'launch', 'recheck', 'stand-down']);
  await stayOnScreen(page);
  await shot('not-ready');

  await focusNothing(page);
  await page.keyboard.press('Enter');

  // Monitors first. The run waits for "Keep this layout?": nothing after it has started.
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  const activity = page.getByTestId('fly-activity');
  await expect(activity).toHaveAttribute('aria-label', 'Make ready and launch');
  await expect(page.getByTestId('fly-step-displays')).toHaveAttribute('data-state', 'running');
  expect(await stepStates(page)).toEqual([
    'fly-step-displays=running',
    'fly-step-audio=none',
    'fly-step-files=pending',
    'fly-step-devices=none',
    'fly-step-apps=pending',
    'fly-step-other=none',
    'fly-step-check=pending',
    'fly-step-launch=pending',
  ]);
  await expect(page.getByTestId('fly-steps').locator('li')).toHaveText([
    'Monitors',
    'Audio',
    'Files',
    'Devices',
    'Apps0/2',
    'Scripts',
    'Re-check',
    'Launch',
  ]);
  await expect(page.getByTestId('fly-step-displays')).toHaveAttribute(
    'aria-label',
    'Monitors: working'
  );
  expect(await gameRunning(page, 'fly-hornet-full')).toBe(false);
  // Enter belongs to the question now, not to the screen behind it.
  await expect(primary).toBeDisabled();
  await shot('waiting-for-the-layout-answer');

  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-activity-headline')).toHaveText(
    '4 of 4 fixes worked · Launched DCS.exe'
  );
  expect(await stepStates(page)).toEqual([
    'fly-step-displays=done',
    'fly-step-audio=none',
    'fly-step-files=done',
    'fly-step-devices=none',
    'fly-step-apps=done',
    'fly-step-other=none',
    'fly-step-check=done',
    'fly-step-launch=done',
  ]);
  await expect(page.locator('[data-testid="fly-activity"] .fly-entry .rr-row-sub')).toHaveText([
    'Monitor layout',
    'DCS options',
    'SimAppPro',
    'TrackIR',
    'Game · DCS F/A-18C full',
  ]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  expect(await gameRunning(page, 'fly-hornet-full')).toBe(true);
  await expect(page.getByTestId('flight-held')).toHaveCount(0);
  // The game is running: the screen says so, and Enter has nothing left to start.
  await expect(page.getByTestId('fly-session')).toHaveAttribute('data-phase', 'running');
  await expect(actions).toHaveAttribute('data-primary', 'none');
  await focusNothing(page);
  await shot('launched');
});

test('one action: when something required still needs you it stops, says what, and Launch anyway is a deliberate click', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('flying-pedals-unplugged', 'fly-one-action-held');
  await mutate([{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
  await expect(page.getByTestId('fly-status-count')).toHaveText('(2)');
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'readyAndLaunch');
  await stayOnScreen(page);

  await page.getByTestId('ready-and-launch').click();
  const held = page.getByTestId('flight-held');
  await expect(held).toBeVisible();
  await expect(page.getByTestId('flight-held-title')).toHaveText(
    'Not launched: 1 required item still needs you'
  );
  await expect(page.getByTestId('flight-held-item')).toHaveText([
    'T-Pendular-Rudder — Not connected',
  ]);
  await expect(page.getByTestId('fly-activity-headline')).toHaveText(
    '1 of 1 fix worked · not launched'
  );
  // What it could fix, it fixed: the apps are all running, the pedals are still missing.
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  await expect(checkRow(page, 'T-Pendular-Rudder')).toHaveAttribute('data-status', 'fail');
  await expect(page.getByTestId('fly-step-apps')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('fly-step-check')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('fly-step-launch')).toHaveAttribute('data-state', 'held');
  await expect(page.getByTestId('fly-step-launch')).toHaveAttribute(
    'aria-label',
    'Launch: not started'
  );
  // What to do about it is on the screen too.
  await expect(page.getByTestId('needs-you')).toContainText('T-Pendular-Rudder');
  // Nothing was launched past the missing pedals.
  await expect(page.getByTestId('fly-activity')).not.toContainText('Launched');
  expect(await gameRunning(page, 'dcs-f-a-18c')).toBe(false);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('held');

  // Launch is never blocked: one click, with what is missing in view.
  await page.getByTestId('flight-launch-anyway').click();
  await expect(page.getByTestId('fly-activity')).toContainText('Launched DCS.exe');
  await expect(page.getByTestId('fly-step-launch')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('fly-activity-headline')).toHaveText(
    '1 of 1 fix worked · Launched DCS.exe'
  );
  expect(await gameRunning(page, 'dcs-f-a-18c')).toBe(true);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('launched-anyway');
});

test('one action: the pedals come back while it is held, and the screen offers Launch instead of the warning', async ({
  rig,
}) => {
  const { page, mutate } = await rig.launch('flying-pedals-unplugged', 'fly-one-action-recovered');
  await mutate([{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
  await expect(page.getByTestId('fly-status-count')).toHaveText('(2)');
  await page.getByTestId('ready-and-launch').click();
  await expect(page.getByTestId('flight-held')).toBeVisible();
  await mutate([{ op: 'plugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('flight-held')).toHaveCount(0);
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'launch');
});

test('one action: Enter launches a ready rig; a focused control and an open question keep Enter for themselves', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('flying-all-good', 'fly-one-action-enter');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  const actions = page.getByTestId('fly-actions');
  await expect(actions).toHaveAttribute('data-primary', 'launch');
  const launch = page.getByTestId('launch');
  await expect(launch.locator('kbd')).toHaveText('Enter');
  expect(
    await actions
      .locator('[data-testid]')
      .evaluateAll((all) => all.map((el) => el.getAttribute('data-testid')))
  ).toEqual(['launch', 'make-ready', 'recheck', 'stand-down']);
  await expect(page.getByTestId('ready-and-launch')).toHaveCount(0);
  await stayOnScreen(page);
  await shot('ready');

  // Enter on a focused button presses that button, and only that.
  const devices = page.getByTestId('group-toggle-devices');
  await devices.focus();
  await page.keyboard.press('Enter');
  await expect(devices).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('fly-activity')).toHaveCount(0);

  // Something required goes missing with nothing to fix: Enter asks before it launches.
  await mutate([{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(actions).toHaveAttribute('data-primary', 'launch');
  await focusNothing(page);
  await page.keyboard.press('Enter');
  const warning = page.getByTestId('launch-warning');
  await expect(warning).toBeVisible();
  await expect(page.getByTestId('launch-warning-item')).toHaveText(
    'T-Pendular-Rudder — Not connected'
  );
  // With the question open, Enter is not a second "launch".
  await focusNothing(page);
  await page.keyboard.press('Enter');
  await expect(warning).toBeVisible();
  await expect(page.getByTestId('fly-activity')).toHaveCount(0);
  expect(await gameRunning(page, 'dcs-f-a-18c')).toBe(false);
  await page.getByTestId('launch-cancel').click();
  await expect(warning).toBeHidden();

  // Ready again: Enter, and the game runs.
  await mutate([{ op: 'plugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await focusNothing(page);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fly-activity')).toContainText('Launched DCS.exe');
  expect(await gameRunning(page, 'dcs-f-a-18c')).toBe(true);
  await shot('launched-with-enter');
});

test('one action: a setup with nothing to launch offers Make ready as its one action', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('fly-trackir-refused', 'fly-one-action-no-launch');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(page.getByTestId('fly-actions')).toHaveAttribute('data-primary', 'makeReady');
  await expect(page.getByTestId('make-ready').locator('kbd')).toHaveText('Enter');
  await expect(page.getByTestId('ready-and-launch')).toHaveCount(0);
  await expect(page.getByTestId('launch')).toHaveCount(0);
  await expect(page.getByTestId('launch-setup')).toBeVisible();
  await shot('make-ready-is-primary');
});
