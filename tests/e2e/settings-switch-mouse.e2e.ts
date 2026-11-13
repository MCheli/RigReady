import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * A switch changes wherever a person clicks it with the mouse: its track, its thumb, and the
 * words of its title. At the second look on the rig (13 Nov 2026) the rig driver could not
 * turn on "Keep RigReady in the tray when you close the window" with a click and used Space.
 * Measured here with the mouse at the visible place of each part, as a hand would click: the
 * track and the thumb always switched it (Playwright's own click on the track refuses to
 * click, because the switch's invisible input lies over the track; that was the driver's
 * trouble), but a click on the title did nothing. The title is now the switch's label, on
 * every switch that is built as a row with its title beside it: the two on Settings, the
 * automatic update checks, and the two on the Overlay page.
 */

/** A mouse click in the middle of what is visible of `part`, at its place on the screen. */
async function clickWithMouse(page: Page, part: Locator): Promise<void> {
  await part.scrollIntoViewIfNeeded();
  const box = await part.boundingBox();
  if (!box) throw new Error('the part to click is not on the screen');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** The parts of a switch a person can click: its track, its thumb and its title's words. */
function partsOf(page: Page, testid: string): Record<'track' | 'thumb' | 'title', Locator> {
  const root = page.getByTestId(testid);
  return {
    track: root.locator('.v-switch__track'),
    thumb: root.locator('.v-switch__thumb'),
    title: page.locator('.rr-row', { has: root }).locator('label.rr-row-title'),
  };
}

test('settings: a mouse click on a switch, its track, its thumb or its title, switches it, and the choice is saved', async ({
  rig,
}) => {
  const run = await rig.launch('desk-mfds-wrong', 'settings-switch-mouse');
  const { page } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  const stored = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await fs.readFile(path.join(run.dataRoot, 'settings.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  const savedLine = page.getByTestId('settings-saved');

  // Each switch, from where it starts: off, on, off by its track, its thumb and its title.
  const switches = [
    {
      testid: 'setting-minimize-to-tray',
      title: 'Keep RigReady in the tray when you close the window',
      onDisk: async () => (await stored())['minimizeToTray'],
    },
    {
      testid: 'setting-start-with-windows',
      title: 'Start with Windows',
      onDisk: async () => (await stored())['startWithWindows'],
    },
    {
      testid: 'update-automatic',
      title: 'Check for updates automatically',
      onDisk: async () => ((await stored())['updates'] as { check?: boolean })?.check,
    },
  ];
  for (const one of switches) {
    const input = page.getByTestId(one.testid).locator('input');
    const parts = partsOf(page, one.testid);
    await expect(parts.title).toHaveText(one.title);
    for (const part of ['track', 'thumb', 'title'] as const) {
      const before = await input.isChecked();
      await clickWithMouse(page, parts[part]);
      // Switched, on the screen and in the settings file, and the page says it is saved.
      await expect(input, `${one.title}: a click on its ${part}`).toBeChecked({
        checked: !before,
      });
      await expect.poll(one.onDisk, { message: `${one.title}: saved` }).toBe(!before);
      if (one.testid.startsWith('setting-')) await expect(savedLine).toHaveText('Saved');
    }
  }

  // The tray switch, which the driver could not click, off by a click on its title: the line
  // under it says what closing the window does now.
  const tray = partsOf(page, 'setting-minimize-to-tray');
  const trayInput = page.getByTestId('setting-minimize-to-tray').locator('input');
  const effect = page.getByTestId('setting-minimize-to-tray-effect');
  await expect(trayInput).not.toBeChecked();
  await expect(effect).toHaveText(
    'Closing the window quits RigReady. Its tray icon goes away too.'
  );
  await page.getByTestId('settings-page').locator('.rr-page-title').scrollIntoViewIfNeeded();
  await run.shot('tray-off-after-clicks');
  await clickWithMouse(page, tray.title);
  await expect(trayInput).toBeChecked();
  await expect(effect).toContainText('Closing the window hides it.');
  await expect.poll(async () => (await stored())['minimizeToTray']).toBe(true);
  await expect(savedLine).toHaveText('Saved');
  await run.shot('tray-on-by-its-title');
});

test('overlay: a mouse click on the title of either switch switches it', async ({ rig }) => {
  const run = await rig.launch('generic-fresh', 'overlay-switch-mouse');
  const { page } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-overlay').click();
  await expect(page.getByTestId('overlay-main')).toBeVisible();
  const main = page.getByTestId('overlay-main');

  // "Show the overlay": on and off again by its title.
  const show = partsOf(page, 'overlay-on');
  const showInput = page.getByTestId('overlay-on').locator('input');
  await expect(show.title).toHaveText('Show the overlay');
  await expect(showInput).not.toBeChecked();
  await clickWithMouse(page, show.title);
  await expect(main).toHaveAttribute('data-on', 'true');
  await expect(showInput).toBeChecked();
  await run.shot('on-by-its-title');
  await clickWithMouse(page, show.title);
  await expect(main).toHaveAttribute('data-on', 'false');
  await expect(showInput).not.toBeChecked();

  // "Presses the game has nothing on": off and on again by its title.
  const unbound = partsOf(page, 'overlay-show-unbound');
  const unboundInput = page.getByTestId('overlay-show-unbound').locator('input');
  await expect(unbound.title).toHaveText('Presses the game has nothing on');
  const before = await unboundInput.isChecked();
  await clickWithMouse(page, unbound.title);
  await expect(unboundInput).toBeChecked({ checked: !before });
  await clickWithMouse(page, unbound.title);
  await expect(unboundInput).toBeChecked({ checked: before });
});
