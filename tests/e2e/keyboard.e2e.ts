import type { ElectronApplication, Page } from '@playwright/test';
import type { Dom } from './a11y';
import { expect, test } from './harness';

/**
 * NFR-011, keyboard: the Play screen is operated from start to launch with Tab, Shift+Tab,
 * Enter, Space, the arrow keys and Escape only. No mouse call anywhere in this file.
 */

interface Focus {
  /** data-testid of the focused element or of the nearest ancestor that has one. */
  id: string;
  /** Its accessible text, for the report. */
  text: string;
  /** The focus ring as drawn: outline width in px (0 when there is none). */
  ring: number;
  ringColour: string;
  inDialog: boolean;
}

const focused = (page: Page): Promise<Focus> =>
  page.evaluate(() => {
    const { document, getComputedStyle } = globalThis as unknown as Dom;
    const el = document.activeElement ?? document.body;
    const style = getComputedStyle(el);
    // A text field shows focus on its outline, drawn by the field around the input.
    const field = el.closest('.v-field');
    const fieldFocused = field?.classList.contains('v-field--focused') ?? false;
    return {
      id: el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName.toLowerCase(),
      text: (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ring: style.outlineStyle === 'none' ? (fieldFocused ? 2 : 0) : parseFloat(style.outlineWidth),
      ringColour: style.outlineColor,
      inDialog: el.closest('.v-overlay--active') !== null,
    };
  });

/** Presses a key until the element with this test id has focus; returns everything focus passed. */
async function walkTo(
  page: Page,
  testId: string,
  key: 'Tab' | 'Shift+Tab' = 'Tab',
  limit = 60
): Promise<Focus[]> {
  const passed: Focus[] = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press(key);
    const now = await focused(page);
    passed.push(now);
    if (now.id === testId) return passed;
  }
  throw new Error(
    `${key} never reached ${testId}; focus went through: ${passed.map((f) => f.id).join(' > ')}`
  );
}

const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);

test('keyboard: the Play screen from Not ready through Make ready to Launch, without a mouse', async ({
  rig,
}) => {
  const { page, shot, app } = await rig.launch('fly-make-ready-all', 'a11y-keyboard');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  // The status is a live region: a screen reader hears it change.
  const status = page.getByTestId('fly-status');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');

  // ---- Focus order: one pass with Tab over the whole screen.
  const pass = await walkTo(page, 'check-recheck');
  const order = pass.map((f) => f.id);
  const firstOf = (id: string): number => order.indexOf(id);
  const expected = [
    'mode-fly',
    'mode-configure',
    'profile-switcher',
    'fly-more',
    'make-ready',
    'launch',
    'recheck',
    'stand-down',
    'group-toggle-devices',
    'group-toggle-apps',
    'check-fix',
    'check-recheck',
  ];
  expect(expected.map(firstOf).every((index) => index >= 0)).toBe(true);
  expect(expected.map(firstOf)).toEqual([...expected.map(firstOf)].sort((a, b) => a - b));
  // Every stop shows where it is: a ring at least 2 px wide, never transparent.
  for (const stop of pass) {
    expect(stop.ring, `focus ring on ${stop.id} (${stop.text})`).toBeGreaterThanOrEqual(2);
    expect(stop.ringColour, stop.id).not.toBe('rgba(0, 0, 0, 0)');
  }

  // ---- Groups open and close with Enter and with Space.
  await walkTo(page, 'group-toggle-devices', 'Shift+Tab');
  const devices = page.getByTestId('group-toggle-devices');
  await expect(devices).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(devices).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('group-devices').getByTestId('check-row')).toHaveCount(3);
  await shot('group-opened-with-enter');
  await page.keyboard.press('Space');
  await expect(devices).toHaveAttribute('aria-expanded', 'false');

  // ---- The menu: arrow keys and Enter; here it switches "Hide RigReady after Launch" off.
  await walkTo(page, 'fly-more', 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fly-minimize-pref')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  expect((await focused(page)).id).toBe('fly-minimize-pref');
  await page.keyboard.press('Enter');
  await expect(
    page.getByTestId('fly-minimize-pref').locator('.mdi-checkbox-blank-outline')
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fly-minimize-pref')).toBeHidden();

  // ---- Make ready with Enter.
  await walkTo(page, 'make-ready');
  await shot('focus-on-make-ready');
  await page.keyboard.press('Enter');

  // "Keep this layout?" opens with focus inside it, on the safe answer, and Tab stays inside.
  const keep = page.getByTestId('keep-layout');
  await expect(keep).toBeVisible();
  await expect(keep.locator('xpath=ancestor::*[@role="dialog"]')).toHaveAttribute(
    'aria-labelledby',
    /.+/
  );
  await expect.poll(async () => (await focused(page)).id).toBe('keep-layout-revert');
  const around: Focus[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    around.push(await focused(page));
  }
  expect(around.every((f) => f.inDialog)).toBe(true);
  expect(new Set(around.map((f) => f.id))).toEqual(
    new Set(['keep-layout-revert', 'keep-layout-keep'])
  );
  await walkTo(page, 'keep-layout-keep');
  expect((await focused(page)).ring).toBeGreaterThanOrEqual(2);
  await shot('keep-layout-focus');
  await page.keyboard.press('Enter');
  await expect(keep).toBeHidden();

  // The progress is a live log, and the result is announced by the status region.
  const activity = page.getByTestId('fly-activity');
  await expect(activity).toHaveAttribute('role', 'log');
  await expect(activity).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByTestId('fly-activity-headline')).toHaveText('4 of 4 fixes worked');
  await expect(status).toContainText('Ready');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // ---- Launch with Space.
  await walkTo(page, 'launch');
  await shot('focus-on-launch');
  await page.keyboard.press('Space');
  await expect(activity).toContainText('Launched DCS.exe');
  expect(await windowVisible(app)).toBe(true);
  await shot('launched');

  // ---- And Stand down, which asks about the running game: the question is answerable too.
  await walkTo(page, 'stand-down');
  await page.keyboard.press('Enter');
  const question = page.getByTestId('game-running');
  await expect(question).toBeVisible();
  await walkTo(page, 'game-leave');
  expect((await focused(page)).inDialog).toBe(true);
  await page.keyboard.press('Enter');
  await expect(question).toBeHidden();
  await expect(page.getByTestId('fly-activity-headline')).toBeVisible();
});
