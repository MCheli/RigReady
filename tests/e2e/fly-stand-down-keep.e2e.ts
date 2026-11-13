import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test, type RunningApp } from './harness';

/**
 * Stand down by itself and a desk layout that was never kept with the monitors that are
 * connected (the second look on the rig, 13 Nov 2026). The countdown says beforehand that
 * RigReady will ask, so that someone stays to press Keep it. With nobody there the
 * question runs out and the layout goes back, as it must; the result says what to do
 * next time.
 *
 * The session is written to fly/sessions.json as one that began 42 minutes ago, and
 * RigReady is started again while the game runs (the scenario), as in
 * fly-stand-down-on-close.e2e.ts.
 */

const SETUP = 'dcs-f-a-18c';

const closeGame = (run: RunningApp): Promise<void> =>
  run.mutate([{ op: 'stopProcess', name: 'DCS.exe' }]);

const setupPath = (run: RunningApp): string => path.join(run.dataRoot, 'profiles', `${SETUP}.yaml`);

/** Writes the countdown length into the setup's file by hand, as a user with an editor would. */
async function countdownByHand(run: RunningApp, seconds: number): Promise<void> {
  const text = (await fs.readFile(setupPath(run), 'utf8')).trimEnd();
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
  return next;
}

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

test('stand down on close: the countdown says the desk layout has not been kept with these monitors yet; with nobody there it goes back, and the result says what to do next time', async ({
  rig,
}) => {
  test.setTimeout(150_000);
  let run = await rig.launch('fly-desk-not-kept', 'fly-stand-down-keep-notice');
  await expect(run.page.getByTestId('fly-status-title')).toHaveText('Ready');
  // Long enough to look at the notice on a busy PC, short enough to wait for.
  await countdownByHand(run, 30);
  run = await inSession(run);
  const { page, shot } = run;
  await closeGame(run);

  // Before anything happens, the notice says that Stand down will ask, and why.
  const notice = page.getByTestId('stand-down-notice');
  await expect(notice).toHaveAttribute('data-state', 'counting');
  await expect(page.getByTestId('stand-down-notice-needs-you')).toHaveText(
    'The desk layout "Desk" has not been kept with these monitors yet. Stay and press Keep it when RigReady asks, or the monitors stay as they are.'
  );
  await expect(page.getByTestId('stand-down-notice-needs-you')).toHaveClass(/rr-warn/);
  await focusNothing(page);
  expect(await accessible(page)).toEqual([]);
  await shot('not-kept-yet');

  // Nobody stays. Stand down asks about Desk, nobody answers, and the monitors go back.
  const prompt = page.getByTestId('keep-layout');
  await expect(prompt).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('keep-layout-once')).toBeVisible();
  await expect(prompt).toBeHidden({ timeout: 30_000 });
  await expect(notice).toHaveAttribute('data-state', 'result', { timeout: 30_000 });
  await expect(page.getByTestId('stand-down-notice-title')).toHaveText(
    'Stand down ran, but 1 step needs attention'
  );
  await expect(page.getByTestId('stand-down-notice-lines').locator('li')).toHaveText([
    'Desk monitor layout: The new monitor layout was not kept, so the previous one is back. Next time, stay for the question and press Keep it.',
  ]);
  // The monitors are as they were before Stand down: the flying layout, which passes.
  await expect(page.getByTestId('group-displays')).toContainText('1 of 1 OK');
  await focusNothing(page);
  expect(await accessible(page)).toEqual([]);
  await shot('went-back');
});
