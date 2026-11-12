import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import type { OverlayState, PressRow } from '../../src/features/overlay/contract';
import { recentPresses } from '../../src/features/overlay/core/widgets';
import type { InputState } from '../../src/shared/models';
import { axeViolations, colourOnlyStatus, type Dom, type El } from './a11y';
import { expect, openOption, screensDir, test } from './harness';

/**
 * The overlay: a small see-through window over the game that lists each press with what the
 * game does on it. On the rig with named controllers and a Hornet setup.
 *
 * What a scenario run can show and what it cannot. The window is a real one, on a real
 * display of the machine the test runs on, while the monitors RigReady reads are the
 * recorded ones. So the place of the window is checked against the display it is really on,
 * and the page is asked which screen it names only where that is settled by the recording.
 *
 * Not tried from here, because a test has no game and no hand, and Electron has no question
 * for the first: that clicks go through the window to what is under it, that it shows over
 * a game, and dragging it with a real mouse (the window is moved by a call instead, and
 * "Lock here" is clicked through the debugger, which does not go by the drag region). Those
 * are checked at the rig.
 */

const TRIGGER = 'Gun Trigger - SECOND DETENT (Press to shoot)';

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

interface Controller {
  index: number;
  name: string;
  numAxes: number;
  numButtons: number;
  numHats: number;
}

let clock = 9_000;
/** A controller with these buttons down, counted from 1, and nothing else touched. */
function stateOf(c: Controller, down: number[] = []): InputState {
  return {
    index: c.index,
    name: c.name,
    axes: Array.from({ length: c.numAxes }, () => 0),
    buttons: Array.from({ length: c.numButtons }, (_, i) => down.includes(i + 1)),
    hats: Array.from({ length: c.numHats }, (): [number, number] => [0, 0]),
    timestamp: clock++,
  };
}

/** The three controllers the test presses, by the start of the name each reports. */
async function controllers(page: Page): Promise<{
  stick: Controller;
  throttle: Controller;
  icp: Controller;
}> {
  const all = await invoke<Controller[]>(page, 'devices:inputDevices');
  const named = (start: string): Controller => {
    const found = all.find((c) => c.name.startsWith(start));
    if (!found) throw new Error(`No controller "${start}" on this rig`);
    return found;
  };
  return {
    stick: named('WINWING Orion'),
    throttle: named('WINWING THROTTLE'),
    icp: named('WINWING ICP'),
  };
}

const recent = async (page: Page): Promise<PressRow[]> =>
  (await invoke<{ rows: PressRow[] }>(page, 'overlay:recent')).rows;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface PanelFacts {
  onTop: boolean;
  visible: boolean;
  focusable: boolean;
  focused: boolean;
  box: Box;
  /** The display the window is really on. */
  area: Box;
}

/** The windows of the overlay, as Windows has them. */
const panels = (app: ElectronApplication): Promise<PanelFacts[]> =>
  app.evaluate(({ BrowserWindow, screen }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.webContents.getURL().includes('#/overlay/'))
      .map((w) => ({
        onTop: w.isAlwaysOnTop(),
        visible: w.isVisible(),
        focusable: w.isFocusable(),
        focused: w.isFocused(),
        box: w.getBounds(),
        area: screen.getDisplayMatching(w.getBounds()).bounds,
      }))
  );

async function panel(app: ElectronApplication): Promise<PanelFacts> {
  const all = await panels(app);
  if (all.length !== 1) throw new Error(`Expected one overlay window, found ${all.length}`);
  return all[0]!;
}

/** Where a window is on its display: the share of the free room to its left and above it. */
const shareOf = ({ box, area }: PanelFacts): { x: number; y: number } => ({
  x: (box.x - area.x) / (area.width - box.width),
  y: (box.y - area.y) / (area.height - box.height),
});

/** Moves the overlay's window as a drag would, to a point in screen units. */
const moveTo = (app: ElectronApplication, to: { x: number; y: number }): Promise<void> =>
  app.evaluate(({ BrowserWindow }, at) => {
    const found = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('#/overlay/')
    );
    if (!found) throw new Error('No overlay window to move');
    found.setPosition(at.x, at.y);
  }, to);

/** The page of the overlay's window, once RigReady has opened it by itself. */
async function overlayWindow(app: ElectronApplication): Promise<Page> {
  const pages = (): Page[] => app.windows().filter((w) => w.url().includes('#/overlay/'));
  await expect.poll(() => pages().length, { timeout: 30_000 }).toBe(1);
  const found = pages()[0]!;
  await found.waitForLoadState('domcontentloaded');
  return found;
}

/** What a page's script sees of an animation: the tests are compiled without the DOM library. */
interface Anim {
  animationName?: string;
  effect: {
    getComputedTiming(): { duration?: unknown };
    getKeyframes(): { computedOffset: number; opacity?: string }[];
  } | null;
}
interface Fade {
  name: string;
  duration: unknown;
  frames: { offset: number; opacity: string | undefined }[];
}

/** The fading of a line, as the browser runs it; null when the line does not fade. */
const fadeOf = (pill: Locator): Promise<Fade | null> =>
  pill.evaluate((el) => {
    const fade = (el as unknown as { getAnimations(): Anim[] })
      .getAnimations()
      .find((a) => (a.animationName ?? '').startsWith('rp-fade'));
    if (!fade?.effect) return null;
    return {
      name: fade.animationName ?? '',
      duration: fade.effect.getComputedTiming().duration,
      frames: fade.effect
        .getKeyframes()
        .map((k) => ({ offset: k.computedOffset, opacity: k.opacity })),
    };
  });

const opacityOf = (el: Locator): Promise<string> =>
  el.evaluate((node) => {
    const { getComputedStyle } = globalThis as unknown as Dom;
    return getComputedStyle(node as unknown as El).opacity;
  });

/**
 * Waits until nothing is sliding in any more. The fading of a line is left alone: it runs
 * for as long as the line lives, and a picture is of the line, not of what is left after it.
 */
const SLID_IN = `(async () => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  const running = () =>
    document
      .getAnimations()
      .filter((a) => !String(a.animationName || '').startsWith('rp-fade'))
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
})()`;

/**
 * Pictures of this flow, numbered in the order taken: of a window, or of one part of it.
 * The harness's own `shot` waits for every animation to end, which here would be the end
 * of the lines the picture is of.
 */
function pictures(flow: string): (page: Page, name: string, part?: Locator) => Promise<void> {
  let count = 0;
  return async (page, name, part) => {
    count++;
    const file = path.join(screensDir, flow, `${String(count).padStart(2, '0')}-${name}.png`);
    await page.evaluate('document.fonts.ready');
    await page.evaluate(SLID_IN);
    if (part) await part.screenshot({ path: file });
    else await page.screenshot({ path: file });
  };
}

const accessible = async (page: Page): Promise<unknown[]> => [
  ...(await axeViolations(page)),
  ...(await colourOnlyStatus(page)),
];

/** Opens the Overlay page. */
async function openPage(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-overlay').click();
  await expect(page.getByTestId('overlay-main')).toBeVisible();
}

/** Turns the overlay on with the switch and hands back the window that comes up. */
async function turnOn(app: ElectronApplication, page: Page): Promise<Page> {
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    page.getByTestId('overlay-on').locator('input').check(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.getByTestId('overlay-window')).toHaveAttribute(
    'data-widget',
    'recent-presses'
  );
  await expect(page.getByTestId('overlay-main')).toHaveAttribute('data-on', 'true');
  return popup;
}

test('the overlay lists each press with what the game does on it, and lets it go again', async ({
  rig,
}) => {
  test.setTimeout(240_000);
  const run = await rig.launch('cheat-sheets-hornet', 'overlay');
  const { app, page } = run;
  const shot = pictures('overlay');
  await openPage(page);

  const main = page.getByTestId('overlay-main');
  const status = page.getByTestId('overlay-status');
  const widget = page.getByTestId('overlay-widget');
  const preview = page.getByTestId('overlay-preview');

  // ---- Off, as it starts: nothing is over the game, and the page says where it cannot show ----
  await expect(page.getByTestId('overlay-page')).toContainText('Overlay');
  await expect(main).toHaveAttribute('data-on', 'false');
  await expect(status).toContainText('Off. Nothing is put over the game');
  const where = page.getByTestId('overlay-where');
  await expect(where).toContainText('Over a game in exclusive full screen it may not show');
  await expect(where).toContainText('It does not show inside a VR headset');
  await expect(page.getByTestId('overlay-source-game')).toContainText('DCS');
  await expect(page.getByTestId('overlay-aircraft-how')).toHaveText(
    'From the setup “DCS F/A-18C”.'
  );
  await expect(widget).toHaveAttribute('data-widget', 'recent-presses');
  await expect(widget).toHaveAttribute('data-showing', 'false');
  await expect(page.getByTestId('overlay-move')).toBeDisabled();
  await expect(page.getByTestId('overlay-lifetime-value')).toHaveText('5 seconds');
  await expect(page.getByTestId('overlay-preview-words')).toContainText('Turn the overlay on');
  expect(await panels(app)).toEqual([]);
  expect(await accessible(page)).toEqual([]);
  await shot(page, 'off');

  // The fading is tried as it is where Windows shows animations, whatever this PC is set to.
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // ---- On: one window, over everything, that cannot be given the keyboard ----
  const popup = await turnOn(app, page);
  await popup.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(popup.getByTestId('overlay-window')).toHaveAttribute('data-moving', 'false');
  await expect(status).toContainText('On, over whatever is on LC49G95T');
  await expect(widget).toHaveAttribute('data-showing', 'true');
  await expect(page.getByTestId('overlay-input-problem')).toHaveCount(0);
  await expect(page.getByTestId('overlay-preview-words')).toContainText(
    'Press a button on a controller'
  );

  const size = recentPresses.size({});
  const up = await panel(app);
  expect(up).toMatchObject({ onTop: true, visible: true, focusable: false, focused: false });
  expect({ width: up.box.width, height: up.box.height }).toEqual(size);
  // Low in the middle of the display it is on, until it is put somewhere else.
  expect(Math.abs(up.box.x - (up.area.x + (up.area.width - size.width) / 2))).toBeLessThanOrEqual(
    1
  );
  expect(Math.abs(up.box.y - (up.area.y + up.area.height - size.height))).toBeLessThanOrEqual(1);

  // Nothing is painted behind the list: the page of that window is see-through, and there
  // is nothing in it while nothing is pressed.
  const behind = await popup.evaluate(() => {
    const { document, getComputedStyle } = globalThis as unknown as Dom;
    return {
      bare: document.documentElement.classList.contains('rr-bare'),
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(behind).toEqual({ bare: true, html: 'rgba(0, 0, 0, 0)', body: 'rgba(0, 0, 0, 0)' });
  const lines = popup.getByTestId('overlay-press');
  const shown = preview.getByTestId('overlay-press');
  await expect(lines).toHaveCount(0);
  expect(await accessible(page)).toEqual([]);

  // ---- What is held when it starts is rest, not a press ----
  const { stick, throttle, icp } = await controllers(page);
  // A lever of the throttle rests on a button.
  await run.sendInput([stateOf(stick), stateOf(throttle, [7]), stateOf(icp)]);
  expect(await recent(page)).toEqual([]);
  await expect(lines).toHaveCount(0);

  // ---- A press shows at once, fades, and is gone after the five seconds it starts with ----
  const pressedAt = Date.now();
  await run.sendInput([stateOf(stick, [5])]);
  await expect(lines).toHaveCount(1);
  const fade = await fadeOf(lines.first().locator('.rp-pill'));
  await expect(lines.first().getByTestId('overlay-press-action')).toHaveText(TRIGGER);
  await expect(shown).toHaveCount(1);
  // Clear for the first part of its time, then fading out to nothing over the rest.
  expect(fade?.name).toMatch(/^rp-fade/);
  expect(fade?.duration).toBe(5000);
  expect(fade?.frames).toEqual([
    { offset: 0, opacity: '1' },
    { offset: 0.6, opacity: '1' },
    { offset: 1, opacity: '0' },
  ]);
  await expect(lines).toHaveCount(0, { timeout: 15_000 });
  const lived = Date.now() - pressedAt;
  expect(lived).toBeGreaterThanOrEqual(4_800);
  expect(lived).toBeLessThan(10_000);
  await expect(shown).toHaveCount(0);
  await expect.poll(() => recent(page)).toEqual([]);

  // ---- Where Windows is asked for less motion a line does not fade: it stays, then goes ----
  await popup.emulateMedia({ reducedMotion: 'reduce' });
  await run.sendInput([stateOf(stick)]);
  const pressedAgainAt = Date.now();
  await run.sendInput([stateOf(stick, [5])]);
  await expect(lines).toHaveCount(1);
  expect(await fadeOf(lines.first().locator('.rp-pill'))).toBeNull();
  expect(await opacityOf(lines.first().locator('.rp-pill'))).toBe('1');
  await expect(lines).toHaveCount(0, { timeout: 15_000 });
  expect(Date.now() - pressedAgainAt).toBeGreaterThanOrEqual(4_800);
  await popup.emulateMedia({ reducedMotion: 'no-preference' });

  // ---- A longer time: thirty seconds, so the rest of this is not a race ----
  const options = async (): Promise<Record<string, unknown>> =>
    (await invoke<OverlayState>(page, 'overlay:current')).widgets[0]!.options;
  await page.getByTestId('overlay-lifetime').getByRole('slider').press('End');
  await expect(page.getByTestId('overlay-lifetime-value')).toHaveText('30 seconds');
  await expect.poll(async () => (await options())['lifetimeSeconds']).toBe(30);
  // What was gone stays gone: a longer time is for the presses to come.
  expect(await recent(page)).toEqual([]);
  await expect(lines).toHaveCount(0);

  // ---- A press, by the name the game gives it, on the controller as the user named it ----
  await run.sendInput([stateOf(stick)]);
  await run.sendInput([stateOf(stick, [5])]);
  await expect(lines).toHaveCount(1);
  const newest = lines.first();
  await expect(newest.getByTestId('overlay-press-action')).toHaveText(TRIGGER);
  await expect(newest.getByTestId('overlay-press-control')).toHaveText('Button 5 · Stick');
  await expect(newest).toHaveAttribute('data-bound', 'true');
  await expect(newest).toHaveAttribute('data-count', '1');
  expect((await fadeOf(newest.locator('.rp-pill')))?.duration).toBe(30_000);
  // The preview on the page is the same list.
  await expect(shown).toHaveCount(1);
  await expect(shown.first().getByTestId('overlay-press-action')).toHaveText(TRIGGER);

  // Pressed again, the line counts up; it is not a second line.
  await run.sendInput([stateOf(stick)]);
  await run.sendInput([stateOf(stick, [5])]);
  await expect(newest).toHaveAttribute('data-count', '2');
  await expect(newest.getByTestId('overlay-press-count')).toHaveText('×2');
  await expect(lines).toHaveCount(1);

  // ---- Another controller: a second line, and the newest is in the spot the list hangs from ----
  await run.sendInput([stateOf(throttle, [7, 3])]);
  await expect(lines).toHaveCount(2);
  await expect(newest.getByTestId('overlay-press-action')).toHaveText(
    'Speed Brake Switch - EXTEND'
  );
  await expect(newest.getByTestId('overlay-press-control')).toHaveText('Button 3 · Throttle');
  await expect(lines.nth(1).getByTestId('overlay-press-action')).toHaveText(TRIGGER);
  // Low on the screen the list stands on its bottom edge: the newest is the lowest.
  await expect(popup.getByTestId('overlay-presses')).toHaveAttribute('data-edge', 'bottom');
  await expect
    .poll(async () => {
      const [first, second] = [await newest.boundingBox(), await lines.nth(1).boundingBox()];
      return (first?.y ?? 0) - (second?.y ?? 0);
    })
    .toBeGreaterThan(50);

  // ---- A switch moved to its other position is the same line, not one more ----
  await run.sendInput([stateOf(throttle, [7, 5])]);
  await expect(newest.getByTestId('overlay-press-action')).toHaveText(
    'Speed Brake Switch - RETRACT'
  );
  await expect(newest).toHaveAttribute('data-control', 'Button 5');
  await expect(lines).toHaveCount(2);

  // ---- A press the game has nothing on: listed, quietly, as not bound ----
  await run.sendInput([stateOf(icp, [1])]);
  await expect(lines).toHaveCount(3);
  await expect(newest.getByTestId('overlay-press-action')).toHaveText('Not bound');
  await expect(newest.getByTestId('overlay-press-control')).toHaveText('Button 1 · WINWING ICP');
  await expect(newest).toHaveAttribute('data-bound', 'false');
  await expect(shown).toHaveCount(3);
  await expect(shown.first().getByTestId('overlay-press-action')).toHaveText('Not bound');
  // The words of the window are measured over white, about the brightest a game gets.
  expect(await accessible(popup)).toEqual([]);
  await shot(popup, 'presses-over-the-game');
  await shot(page, 'preview', preview);
  await shot(page, 'on');

  // ---- Fewer lines: the oldest makes room at once, and the window is as small as the list ----
  await page.getByTestId('overlay-lines').click();
  await page.locator('.v-overlay--active').getByRole('option', { name: '2', exact: true }).click();
  await expect(lines).toHaveCount(2);
  await expect(newest.getByTestId('overlay-press-action')).toHaveText('Not bound');
  await expect(lines.nth(1).getByTestId('overlay-press-action')).toHaveText(
    'Speed Brake Switch - RETRACT'
  );
  const two = recentPresses.size({ rows: 2 });
  await expect
    .poll(async () => {
      const { box } = await panel(app);
      return { width: box.width, height: box.height };
    })
    .toEqual(two);

  // ---- Presses the game has nothing on, left out ----
  await page.getByTestId('overlay-show-unbound').locator('input').uncheck();
  await expect.poll(async () => (await options())['showUnbound']).toBe(false);
  await run.sendInput([stateOf(icp)]);
  // Longer than a switch takes from one position to the next: this is a press of its own.
  await page.waitForTimeout(150);
  await run.sendInput([stateOf(icp, [2])]);
  await run.sendInput([stateOf(stick)]);
  await run.sendInput([stateOf(stick, [5])]);
  await expect(newest.getByTestId('overlay-press-action')).toHaveText(TRIGGER);
  await expect(newest).toHaveAttribute('data-count', '1');
  await expect(lines).toHaveCount(2);
  await expect(popup.locator('[data-testid="overlay-press"][data-control="Button 2"]')).toHaveCount(
    0
  );
  expect((await recent(page)).map((row) => row.control)).not.toContain('Button 2');

  // ---- Larger: the text and the room the list takes go together ----
  await page.getByTestId('overlay-size-large').click();
  const large = recentPresses.size({ rows: 2, size: 'large' });
  await expect
    .poll(async () => {
      const { box } = await panel(app);
      return { width: box.width, height: box.height };
    })
    .toEqual(large);
  await expect(lines).toHaveCount(2);
  await shot(popup, 'large');
  await shot(page, 'options');
  expect(await accessible(page)).toEqual([]);
});

test('the overlay goes where it is put, stays there, and comes up again with RigReady', async ({
  rig,
}) => {
  test.setTimeout(240_000);
  const first = await rig.launch('cheat-sheets-hornet', 'overlay-placing');
  const shot = pictures('overlay-placing');
  await openPage(first.page);
  let popup = await turnOn(first.app, first.page);
  let widget = first.page.getByTestId('overlay-widget');

  // ---- One of the nine places with a name ----
  const topLeft = first.page.locator('[data-testid="overlay-place"][data-place="Top left"]');
  await expect(topLeft).toHaveAttribute('aria-pressed', 'false');
  await topLeft.click();
  await expect(widget).toHaveAttribute('data-x', '0');
  await expect(widget).toHaveAttribute('data-y', '0');
  await expect(topLeft).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => {
      const { box, area } = await panel(first.app);
      return { x: box.x - area.x, y: box.y - area.y };
    })
    .toEqual({ x: 0, y: 0 });
  // High on the screen the list hangs from the top, and from the side it is nearest to.
  const list = popup.getByTestId('overlay-presses');
  await expect(list).toHaveAttribute('data-edge', 'top');
  await expect(list).toHaveAttribute('data-side', 'left');

  // ---- By hand: framed, it is an ordinary window that can be dragged ----
  const move = first.page.getByTestId('overlay-move');
  await expect(move).toContainText('Move it on screen');
  await move.click();
  await expect(widget).toHaveAttribute('data-moving', 'true');
  await expect(move).toContainText('Lock it here');
  await expect(popup.getByTestId('overlay-window')).toHaveAttribute('data-moving', 'true');
  await expect(popup.getByTestId('overlay-move-frame')).toContainText('Recent presses');
  await expect(popup.getByTestId('overlay-move-frame')).toContainText(
    'Drag this to where it should be'
  );
  expect(await panel(first.app)).toMatchObject({ visible: true, onTop: true, focusable: true });
  await shot(popup, 'framed');
  await shot(first.page, 'placing');

  const before = await panel(first.app);
  await moveTo(first.app, { x: before.area.x + 120, y: before.area.y + 90 });
  const dragged = await panel(first.app);
  expect({ x: dragged.box.x - dragged.area.x, y: dragged.box.y - dragged.area.y }).toEqual({
    x: 120,
    y: 90,
  });

  // ---- Locked from the frame itself: it stays where it was let go, and clicks pass again ----
  await popup.getByTestId('overlay-lock-here').click();
  await expect(popup.getByTestId('overlay-window')).toHaveAttribute('data-moving', 'false');
  await expect(popup.getByTestId('overlay-move-frame')).toHaveCount(0);
  await expect(widget).toHaveAttribute('data-moving', 'false');
  await expect(move).toContainText('Move it on screen');
  const locked = await panel(first.app);
  expect(locked).toMatchObject({ visible: true, onTop: true, focusable: false, focused: false });
  const kept = shareOf(dragged);
  // The page has the place as a share of the free room, which is what is remembered.
  const placed = async (): Promise<{ x: number; y: number }> => ({
    x: Number(await widget.getAttribute('data-x')),
    y: Number(await widget.getAttribute('data-y')),
  });
  expect((await placed()).x).toBeCloseTo(kept.x, 4);
  expect((await placed()).y).toBeCloseTo(kept.y, 4);
  expect(shareOf(locked).x).toBeCloseTo(kept.x, 2);
  expect(shareOf(locked).y).toBeCloseTo(kept.y, 2);
  // On the display it was let go on it has not moved by a pixel. (With more monitors than
  // the recording has, the recorded screen it is kept for may be another display here.)
  if (locked.area.x === dragged.area.x && locked.area.y === dragged.area.y) {
    expect(locked.box).toEqual(dragged.box);
  }
  // No longer one of the nine.
  await expect(
    first.page.locator('[data-testid="overlay-place"][aria-pressed="true"]')
  ).toHaveCount(0);

  // ---- RigReady closed and started again: the overlay is up by itself, where it was ----
  const again = await first.restart();
  const { app, page } = again;
  popup = await overlayWindow(app);
  await expect(popup.getByTestId('overlay-window')).toHaveAttribute(
    'data-widget',
    'recent-presses'
  );
  const back = await panel(app);
  expect(back).toMatchObject({ visible: true, onTop: true, focusable: false });
  expect(shareOf(back).x).toBeCloseTo(kept.x, 2);
  expect(shareOf(back).y).toBeCloseTo(kept.y, 2);
  await openPage(page);
  widget = page.getByTestId('overlay-widget');
  await expect(page.getByTestId('overlay-main')).toHaveAttribute('data-on', 'true');
  await expect(widget).toHaveAttribute('data-showing', 'true');
  expect(Number(await widget.getAttribute('data-x'))).toBeCloseTo(kept.x, 4);
  expect(Number(await widget.getAttribute('data-y'))).toBeCloseTo(kept.y, 4);
  // And it lists presses, without the page having been opened first for that.
  const { stick } = await controllers(page);
  await again.sendInput([stateOf(stick)]);
  await again.sendInput([stateOf(stick, [5])]);
  await expect(popup.getByTestId('overlay-press')).toHaveCount(1);
  await expect(popup.getByTestId('overlay-press-action')).toHaveText(TRIGGER);

  // ---- Another screen ----
  const state = await invoke<OverlayState>(page, 'overlay:state');
  const mainScreen = state.screens.find((s) => s.primary)!;
  const other = state.screens.find((s) => !s.primary)!;
  await page.getByTestId('overlay-screen').click();
  await openOption(page, other.name).click();
  await expect(widget).toHaveAttribute('data-screen', other.id);
  await expect(page.getByTestId('overlay-status')).toContainText(
    `On, over whatever is on ${other.name}`
  );
  await expect(page.getByTestId('overlay-away')).toHaveCount(0);
  expect(await panel(app)).toMatchObject({ visible: true, onTop: true });

  // ---- That screen goes off (another monitor layout): the main one stands in, and it is said ----
  await again.mutate([{ op: 'setDisplay', match: { id: other.id }, set: { enabled: false } }]);
  await page.getByTestId('nav-devices').click();
  await expect(page.getByTestId('overlay-page')).toHaveCount(0);
  await page.getByTestId('nav-overlay').click();
  await expect(page.getByTestId('overlay-away')).toContainText(
    `It belongs on “${other.name}”, which is off now`
  );
  await expect(widget).toHaveAttribute('data-screen', mainScreen.id);
  await expect(page.getByTestId('overlay-status')).toContainText(
    `On, over whatever is on ${mainScreen.name}`
  );
  expect(await panel(app)).toMatchObject({ visible: true, onTop: true });
  expect(await accessible(page)).toEqual([]);
  await shot(page, 'screen-off');

  // ---- Off: the window is gone, and the controllers are no longer read for it ----
  await page.getByTestId('overlay-on').locator('input').uncheck();
  await expect(page.getByTestId('overlay-main')).toHaveAttribute('data-on', 'false');
  await expect(page.getByTestId('overlay-status')).toContainText('Off.');
  await expect.poll(() => panels(app)).toEqual([]);
  await again.sendInput([stateOf(stick)]);
  await again.sendInput([stateOf(stick, [5])]);
  expect(await recent(page)).toEqual([]);
});
