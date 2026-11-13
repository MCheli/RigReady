import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, openOption, test } from './harness';

/**
 * The overlay as a choice of each setup, and the screen it goes on: on the recorded rig at the
 * desk, where the Dell is the main screen, with a flight setup and a racing setup that both
 * apply a monitor layout with the Dell off, and a setup for X-Plane 12, whose bindings
 * RigReady cannot read.
 */

const XPLANE_WHY =
  'RigReady cannot read the bindings of X-Plane 12, so the overlay cannot say what a press does.';

async function invoke<T>(page: Page, channel: string, input?: unknown): Promise<T> {
  const answer = (await page.evaluate(
    ([name, payload]) =>
      (
        globalThis as unknown as {
          rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
        }
      ).rigready.invoke(name as string, payload),
    [channel, input] as const
  )) as { ok: boolean; value?: T; error?: { message: string } };
  if (!answer.ok) throw new Error(answer.error?.message ?? 'failed');
  return answer.value as T;
}

/** How many windows of the overlay are up, as Electron has them. */
const overlayWindows = (app: ElectronApplication): Promise<number> =>
  app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('#/overlay/'))
        .length
  );

const accessible = async (page: Page): Promise<unknown[]> => [
  ...(await axeViolations(page)),
  ...(await colourOnlyStatus(page)),
];

async function openOverlayPage(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-overlay').click();
  await expect(page.getByTestId('overlay-main')).toBeVisible();
}

test('the overlay is a choice of each setup, and can go with the main screen', async ({ rig }) => {
  test.setTimeout(240_000);
  const run = await rig.launch('overlay-setups', 'overlay-setups');
  const { app, page, shot } = run;
  await openOverlayPage(page);
  const main = page.getByTestId('overlay-main');
  const status = page.getByTestId('overlay-status');
  const row = (id: string) => page.locator(`[data-testid="overlay-setup"][data-setup="${id}"]`);
  const words = (id: string) => row(id).getByTestId('overlay-setup-words');

  // ---- Every setup and whether it shows there: on where RigReady reads the game's bindings ----
  await expect(row('dcs-f-a-18c')).toHaveAttribute('data-on', 'true');
  await expect(words('dcs-f-a-18c')).toHaveText('On to begin with.');
  await expect(row('dcs-f-a-18c').getByTestId('overlay-setup-in-use')).toHaveText('In use');
  await expect(row('racing-iracing')).toHaveAttribute('data-on', 'true');
  await expect(words('racing-iracing')).toHaveText('On to begin with.');
  await expect(row('overlay-x-plane')).toHaveAttribute('data-on', 'false');
  await expect(words('overlay-x-plane')).toHaveText(`Off to begin with. ${XPLANE_WHY}`);

  // Turned on: up over the main screen, for the setup in use.
  await page.getByTestId('overlay-on').locator('input').check();
  await expect(main).toHaveAttribute('data-on', 'true');
  await expect(status).toContainText('On, over whatever is on DELL G3223D');
  await expect.poll(() => overlayWindows(app)).toBe(1);
  expect(await accessible(page)).toEqual([]);
  await shot('setups-on-the-page');

  // ---- "The main screen": where it starts, and what the choice says it follows ----
  const select = page.getByTestId('overlay-screen');
  await expect(select).toContainText('The main screen');
  await expect(page.getByTestId('overlay-screen-words')).toHaveText(
    'It goes on whichever monitor is main in the monitor layout in use.'
  );
  await select.scrollIntoViewIfNeeded();
  await select.click();
  await expect(openOption(page, 'The main screen')).toContainText(
    'Whichever is main in the monitor layout in use: now DELL G3223D'
  );
  await expect(openOption(page, 'DELL G3223D (main)')).toBeVisible();
  await shot('main-screen-choice');

  // ---- Put on the Dell itself, which both setups' monitor layouts turn off: said ----
  await openOption(page, 'DELL G3223D (main)').click();
  const warning = page.getByTestId('overlay-off-in-layout');
  await expect(warning).toHaveText(
    'DELL G3223D is off in the monitor layouts of “DCS F/A-18C” and “iRacing”. While those layouts are in use, the overlay is on the main screen instead. Choose “The main screen” to have it go with the layout in use.'
  );
  await expect(page.getByTestId('overlay-screen-words')).toContainText(
    'Remembered for that monitor'
  );
  await warning.scrollIntoViewIfNeeded();
  expect(await accessible(page)).toEqual([]);
  await shot('off-in-a-setup-layout');

  // Back to "The main screen": nothing to warn of, and no monitor is kept for it.
  await select.click();
  await openOption(page, 'The main screen').click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByTestId('overlay-screen-words')).toContainText(
    'It goes on whichever monitor is main'
  );
  const settings = JSON.parse(
    await fs.readFile(path.join(run.dataRoot, 'overlay', 'settings.json'), 'utf8')
  ) as { widgets: Record<string, { place: Record<string, unknown> }> };
  expect(settings.widgets['recent-presses']!.place).not.toHaveProperty('monitor');

  // ---- The switch in a setup: iRacing has it on to begin with; turned off and saved ----
  await row('racing-iracing').getByTestId('overlay-setup-change').click();
  const section = page.getByTestId('edit-overlay');
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute('data-on', 'true');
  await expect(section).toHaveAttribute('data-chosen', 'false');
  await expect(page.getByTestId('edit-overlay-sub')).toHaveText(
    'While this setup is the one in use, the overlay lists what you press over the game.'
  );
  await expect(page.getByTestId('edit-overlay-master')).toHaveCount(0);
  await section.scrollIntoViewIfNeeded();
  expect(await accessible(page)).toEqual([]);
  await shot('setup-switch-on');

  await page.getByTestId('edit-overlay-switch').locator('input').uncheck();
  await expect(section).toHaveAttribute('data-on', 'false');
  await expect(section).toHaveAttribute('data-chosen', 'true');
  await expect(page.getByTestId('edit-overlay-sub')).toHaveText(
    'Nothing is put over the game while this setup is the one in use.'
  );
  await shot('setup-switch-off');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();
  // Kept with the setup, in its own file.
  const yaml = await fs.readFile(
    path.join(run.dataRoot, 'profiles', 'racing-iracing.yaml'),
    'utf8'
  );
  // (YAML writes the key in quotes, as some readers take a bare on for true.)
  expect(yaml).toMatch(/\n {2}overlay:\n {4}'on': false\n/);

  // ---- A setup for a game whose bindings RigReady cannot read: off, and why ----
  await page.getByTestId('nav-overlay').click();
  await expect(words('racing-iracing')).toHaveText('Off: you turned it off in this setup.');
  await row('overlay-x-plane').getByTestId('overlay-setup-change').click();
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute('data-on', 'false');
  await expect(page.getByTestId('edit-overlay-sub')).toHaveText(`Off to begin with. ${XPLANE_WHY}`);
  await expect(page.getByTestId('edit-overlay-why')).toHaveText(XPLANE_WHY);
  await section.scrollIntoViewIfNeeded();
  expect(await accessible(page)).toEqual([]);
  await shot('no-bindings-reason');

  // ---- The setup in use is one with it off: down at once, and said ----
  await page.getByTestId('nav-overlay').click();
  await expect(main).toBeVisible();
  await invoke(page, 'profiles:use', { id: 'racing-iracing' });
  await expect(page.getByTestId('overlay-off-in-setup')).toHaveText(
    'On, but the setup in use, “iRacing”, has it off, so nothing is put over the game now. It comes up when you play a setup that has it on.'
  );
  await expect.poll(() => overlayWindows(app)).toBe(0);
  await expect(page.getByTestId('overlay-preview-words')).toContainText(
    'never shown over the game. Play a setup that has the overlay on and what you press shows here instead.'
  );
  await expect(row('racing-iracing').getByTestId('overlay-setup-in-use')).toBeVisible();
  expect(await accessible(page)).toEqual([]);
  await shot('off-in-the-setup-in-use');

  // And up again with the flight setup.
  await invoke(page, 'profiles:use', { id: 'dcs-f-a-18c' });
  await expect(status).toContainText('On, over whatever is on DELL G3223D');
  await expect.poll(() => overlayWindows(app)).toBe(1);
});
