import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { panelBox } from '../../src/core/overlayPlace';
import type { OverlayState, PressRow } from '../../src/features/overlay/contract';
import { recentPresses } from '../../src/features/overlay/core/widgets';
import type { InputState } from '../../src/shared/models';
import { axeViolations, colourOnlyStatus, type Dom, type El } from './a11y';
import { expect, openOption, screensDir, test } from './harness';

/**
 * The overlay: a small see-through window over the game that lists each press with what the
 * game does on it. On the rig with named controllers and a Hornet setup, and on a PC that
 * has one joystick and no game.
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
const NO_GAME =
  'No game whose bindings RigReady can read was found on this PC, so presses are shown without what they do.';

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
/**
 * A controller with these buttons down, counted from 1, its hats pushed this way and all of
 * its axes at this value.
 */
function stateOf(
  c: Controller,
  down: number[] = [],
  hat: [number, number] = [0, 0],
  axis = 0
): InputState {
  return {
    index: c.index,
    name: c.name,
    axes: Array.from({ length: c.numAxes }, () => axis),
    buttons: Array.from({ length: c.numButtons }, (_, i) => down.includes(i + 1)),
    hats: Array.from({ length: c.numHats }, (): [number, number] => hat),
    timestamp: clock++,
  };
}

/** The controllers of the PC, each found by the start of the name it reports. */
async function controllersOf<K extends string>(
  page: Page,
  starts: Record<K, string>
): Promise<Record<K, Controller>> {
  const all = await invoke<Controller[]>(page, 'devices:inputDevices');
  const found = {} as Record<K, Controller>;
  for (const key of Object.keys(starts) as K[]) {
    const controller = all.find((c) => c.name.startsWith(starts[key]));
    if (!controller) throw new Error(`No controller "${starts[key]}" on this rig`);
    found[key] = controller;
  }
  return found;
}

/** The four controllers of the owner's rig the tests press. */
const controllers = (page: Page) =>
  controllersOf(page, {
    stick: 'WINWING Orion',
    throttle: 'WINWING THROTTLE',
    icp: 'WINWING ICP',
    switches: 'R-VPC Panel',
  });

const recent = async (page: Page): Promise<PressRow[]> =>
  (await invoke<{ rows: PressRow[] }>(page, 'overlay:recent')).rows;

/** Where the overlay keeps what the user set: in RigReady's own folder. */
const settingsFile = (dataRoot: string): string => path.join(dataRoot, 'overlay', 'settings.json');
const saved = async (dataRoot: string): Promise<unknown> =>
  JSON.parse(await fs.readFile(settingsFile(dataRoot), 'utf8')) as unknown;

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

/**
 * The one window of the overlay. A window that was just opened has no address until its page
 * starts to load, so this waits until there is exactly one, and fails when there never is.
 */
async function panel(app: ElectronApplication): Promise<PanelFacts> {
  let all: PanelFacts[] = [];
  await expect
    .poll(async () => (all = await panels(app)).length, { message: 'one overlay window' })
    .toBe(1);
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

/** Leaves the Overlay page and comes back, so that it reads the PC again. */
async function reopenPage(page: Page): Promise<void> {
  await page.getByTestId('nav-devices').click();
  await expect(page.getByTestId('overlay-page')).toHaveCount(0);
  await page.getByTestId('nav-overlay').click();
  await expect(page.getByTestId('overlay-main')).toBeVisible();
}

/** Opens the command palette, types, checks the row that is marked, and runs it. */
async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.type(title.toLowerCase());
  await expect(
    page.locator('[data-testid="palette-row"][aria-selected="true"] .rr-palette-title')
  ).toHaveText(title);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toBeHidden();
}

/** The toast that says this, whatever else is still being shown. */
const toastSaying = (page: Page, text: string): Locator =>
  page.getByTestId('toast').filter({ has: page.getByText(text, { exact: true }) });

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

  // ---- An entry of its own under Controls, and the navigation still fits without scrolling ----
  const nav = page.getByTestId('configure-nav');
  await expect(nav.getByRole('group', { name: 'Controls' }).getByTestId('nav-overlay')).toHaveText(
    'Overlay'
  );
  const overflow = await nav.evaluate((el) => {
    const box = el as unknown as { scrollHeight: number; clientHeight: number };
    return box.scrollHeight - box.clientHeight;
  });
  expect(overflow, 'the navigation fits the window without scrolling').toBeLessThanOrEqual(0);

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
  // Nothing is kept until the user sets something.
  await expect(fs.access(settingsFile(run.dataRoot))).rejects.toThrow();
  expect(await accessible(page)).toEqual([]);
  await shot(page, 'off');
  // The preview has the size of the list, and nothing in it while the overlay is off.
  await expect(preview.getByTestId('overlay-press')).toHaveCount(0);
  await shot(page, 'preview-off', page.getByTestId('overlay-preview-row'));

  // The fading is tried as it is where Windows shows animations, whatever this PC is set to.
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // ---- On: one window, over everything, that cannot be given the keyboard ----
  const popup = await turnOn(app, page);
  await popup.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(popup.getByTestId('overlay-window')).toHaveAttribute('data-moving', 'false');
  await expect(status).toContainText('On, over whatever is on LC49G95T');
  await expect(widget).toHaveAttribute('data-showing', 'true');
  expect(await saved(run.dataRoot)).toMatchObject({ on: true });
  await expect(page.getByTestId('overlay-not-read')).toHaveCount(0);
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
  const { stick, throttle, icp, switches } = await controllers(page);
  // A lever of the throttle rests on a button.
  await run.sendInput([stateOf(stick), stateOf(throttle, [7]), stateOf(icp), stateOf(switches)]);
  expect(await recent(page)).toEqual([]);
  await expect(lines).toHaveCount(0);
  // An axis is never a press, however far it travels.
  await run.sendInput([stateOf(stick, [], [0, 0], 1)]);
  expect(await recent(page)).toEqual([]);

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

  // ---- Another aircraft: the presses are named from that one, until RigReady picks again ----
  const how = page.getByTestId('overlay-aircraft-how');
  const { choices } = (await invoke<OverlayState>(page, 'overlay:state')).source;
  const huey = choices.find((choice) => choice.id === 'UH-1H')!;
  await page.getByTestId('overlay-aircraft').click();
  await page
    .locator('.v-overlay--active')
    .getByRole('option')
    .filter({ has: page.getByText(huey.name, { exact: true }) })
    .click();
  await expect(how).toHaveText('You chose it.');
  await run.sendInput([stateOf(stick)]);
  await run.sendInput([stateOf(stick, [5])]);
  await expect(lines).toHaveCount(1);
  await expect(lines.first().getByTestId('overlay-press-control')).toHaveText('Button 5 · Stick');
  await expect(lines.first().getByTestId('overlay-press-action')).not.toHaveText(TRIGGER);
  await shot(page, 'another-aircraft', page.getByTestId('overlay-source'));
  await page.getByTestId('overlay-aircraft-auto').click();
  await expect(how).toHaveText('From the setup “DCS F/A-18C”.');
  await expect(page.getByTestId('overlay-aircraft-auto')).toHaveCount(0);
  await expect(lines).toHaveCount(0, { timeout: 15_000 });

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

  // ---- A control the game has two actions on: the one that works alone, and how many more ----
  await run.sendInput([stateOf(switches, [34])]);
  await expect(lines).toHaveCount(3);
  await expect(newest.getByTestId('overlay-press-action')).toHaveText('RADAR Switch - CCW');
  await expect(newest.getByTestId('overlay-press-more')).toHaveText('+1');
  await expect(newest.getByTestId('overlay-press-control')).toHaveText(/^Button 34 · /);

  // ---- A press the game has nothing on: listed, quietly, as not bound ----
  await run.sendInput([stateOf(icp, [1])]);
  await expect(lines).toHaveCount(4);
  await expect(newest.getByTestId('overlay-press-action')).toHaveText('Not bound');
  await expect(newest.getByTestId('overlay-press-control')).toHaveText('Button 1 · WINWING ICP');
  await expect(newest).toHaveAttribute('data-bound', 'false');
  await expect(shown).toHaveCount(4);
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
  await expect(lines.nth(1).getByTestId('overlay-press-action')).toHaveText('RADAR Switch - CCW');
  const two = recentPresses.size({ rows: 2 });
  await expect
    .poll(async () => {
      const { box } = await panel(app);
      return { width: box.width, height: box.height };
    })
    .toEqual(two);

  // ---- Presses the game has nothing on, left out: the one that is listed goes at once ----
  await page.getByTestId('overlay-show-unbound').locator('input').uncheck();
  await expect.poll(async () => (await options())['showUnbound']).toBe(false);
  await expect(lines).toHaveCount(1);
  await expect(newest.getByTestId('overlay-press-action')).toHaveText('RADAR Switch - CCW');
  await expect(shown).toHaveCount(1);
  // A second button of the ICP with the first still held: a press of its own, and not listed.
  await run.sendInput([stateOf(icp, [1, 2])]);
  await run.sendInput([stateOf(stick)]);
  await run.sendInput([stateOf(stick, [5])]);
  await expect(newest.getByTestId('overlay-press-action')).toHaveText(TRIGGER);
  await expect(newest).toHaveAttribute('data-count', '1');
  await expect(lines).toHaveCount(2);
  await expect(popup.getByText('Not bound')).toHaveCount(0);
  expect((await recent(page)).map((row) => row.control)).toEqual(['Button 5', 'Button 34']);

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
  // Put back from what is remembered, it is on the very pixel that place means on the display
  // it is on: where it was let go, when that is the display it was dragged on. (With more
  // monitors than the recording has, the recorded screen it is kept for may be another here.)
  expect(locked.box).toEqual(
    panelBox(locked.area, { width: locked.box.width, height: locked.box.height }, await placed())
  );
  // No longer one of the nine.
  await expect(
    first.page.locator('[data-testid="overlay-place"][aria-pressed="true"]')
  ).toHaveCount(0);

  // ---- RigReady closed and started again: the overlay is up by itself, where it was ----
  // (Quitting with the overlay up is part of this: the window does not keep RigReady running.)
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
  await reopenPage(page);
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

  // ---- No screen is on at all: it is on, it is not showing, and the page says why ----
  await again.mutate(
    state.screens
      .filter((s) => s.id !== other.id)
      .map((s) => ({ op: 'setDisplay', match: { id: s.id }, set: { enabled: false } }))
  );
  await reopenPage(page);
  await expect(page.getByTestId('overlay-status')).toHaveText(
    'On, but it is not showing. The reason is below.'
  );
  await expect(page.getByTestId('overlay-widget-problem')).toHaveText(
    'No screen is on, so there is nothing to show the overlay on.'
  );
  await expect(widget).toHaveAttribute('data-showing', 'false');
  await expect(page.getByTestId('overlay-move')).toBeDisabled();
  // It is on, so the page does not ask for it to be turned on.
  await expect(page.getByTestId('overlay-place-words')).toHaveText(
    'Pick a corner, an edge or the middle. To move it by hand, it has to be showing first.'
  );
  await expect.poll(() => panels(app)).toEqual([]);
  expect(await accessible(page)).toEqual([]);
  await shot(page, 'not-showing');
  // The main screen is back: so is the overlay, without being asked. (A screen that is off
  // has no size and no place, so coming back it is given them again.)
  await again.mutate([
    {
      op: 'setDisplay',
      match: { id: mainScreen.id },
      set: {
        enabled: true,
        primary: true,
        x: 0,
        y: 0,
        width: mainScreen.width,
        height: mainScreen.height,
      },
    },
  ]);
  await reopenPage(page);
  await expect(page.getByTestId('overlay-status')).toContainText(
    `On, over whatever is on ${mainScreen.name}`
  );
  await expect(widget).toHaveAttribute('data-showing', 'true');
  expect(await panel(app)).toMatchObject({ visible: true, onTop: true, focusable: false });

  // ---- Off: the window is gone, and the controllers are no longer read for it ----
  await page.getByTestId('overlay-on').locator('input').uncheck();
  await expect(page.getByTestId('overlay-main')).toHaveAttribute('data-on', 'false');
  await expect(page.getByTestId('overlay-status')).toContainText('Off.');
  await expect.poll(() => panels(app)).toEqual([]);
  await again.sendInput([stateOf(stick)]);
  await again.sendInput([stateOf(stick, [5])]);
  expect(await recent(page)).toEqual([]);
  // What it keeps is in RigReady's own folder: that it is off, and the place it was given.
  expect(await saved(again.dataRoot)).toMatchObject({
    on: false,
    widgets: {
      'recent-presses': {
        place: {
          at: {
            x: Number(await widget.getAttribute('data-x')),
            y: Number(await widget.getAttribute('data-y')),
          },
        },
      },
    },
  });
});

test('on a PC with no game the overlay lists presses without what they do, and a damaged settings file is said to be damaged', async ({
  rig,
}) => {
  test.setTimeout(180_000);
  const run = await rig.launch('generic-fresh', 'overlay-no-game');
  const { app, page } = run;
  const shot = pictures('overlay-no-game');
  await openPage(page);

  // ---- One joystick, one monitor, no game: the page names nothing that is not on this PC ----
  const whole = page.getByTestId('overlay-page');
  const main = page.getByTestId('overlay-main');
  const status = page.getByTestId('overlay-status');
  await expect(status).toContainText('Off. Nothing is put over the game');
  await expect(page.getByTestId('overlay-where')).toContainText(
    'It does not show inside a VR headset'
  );
  await expect(page.getByTestId('overlay-source-game')).toHaveText('No game');
  await expect(page.getByTestId('overlay-source-problem')).toHaveText(NO_GAME);
  await expect(page.getByTestId('overlay-aircraft')).toHaveCount(0);
  await expect(whole).not.toContainText('WINWING');
  await expect(whole).not.toContainText('F/A-18C');
  expect(await panels(app)).toEqual([]);
  expect(await accessible(page)).toEqual([]);
  await shot(page, 'no-game');

  // ---- Turned on from the palette: it answers with what happened, and why there are no names ----
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    runCommand(page, 'Turn the overlay on'),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.getByTestId('overlay-window')).toHaveAttribute(
    'data-widget',
    'recent-presses'
  );
  const saidOn = toastSaying(page, 'The overlay is on');
  await expect(saidOn).toHaveAttribute('data-tone', 'ok');
  await expect(saidOn.getByTestId('toast-detail')).toHaveText(NO_GAME);
  await expect(main).toHaveAttribute('data-on', 'true');
  await expect(status).toContainText('On, over whatever is on BenQ GW2480');
  expect(await panel(app)).toMatchObject({
    onTop: true,
    visible: true,
    focusable: false,
    focused: false,
  });
  expect(await saved(run.dataRoot)).toMatchObject({ on: true });
  await expect(page.getByTestId('overlay-place-words')).toContainText('or move it by hand');
  await shot(page, 'on-from-the-palette');
  await saidOn.getByTestId('toast-close').click();
  await expect(saidOn).toHaveCount(0);

  // ---- A press: the control and the controller, and no claim that nothing is bound ----
  await page.getByTestId('overlay-lifetime').getByRole('slider').press('End');
  await expect(page.getByTestId('overlay-lifetime-value')).toHaveText('30 seconds');
  const { stick } = await controllersOf(page, { stick: 'Logitech' });
  const lines = popup.getByTestId('overlay-press');
  await run.sendInput([stateOf(stick)]);
  await run.sendInput([stateOf(stick, [1])]);
  await expect(lines).toHaveCount(1);
  await expect(lines.first().getByTestId('overlay-press-action')).toHaveText('Button 1');
  await expect(lines.first().getByTestId('overlay-press-control')).toHaveText(
    'Logitech Extreme 3D'
  );
  // A hat is a press of the direction it went to.
  await run.sendInput([stateOf(stick, [1], [0, 1])]);
  await expect(lines).toHaveCount(2);
  await expect(lines.first().getByTestId('overlay-press-action')).toHaveText('Hat 1 up');
  await expect(popup.getByText('Not bound')).toHaveCount(0);
  await expect(page.getByTestId('overlay-preview').getByTestId('overlay-press')).toHaveCount(2);
  await shot(popup, 'without-what-they-do');

  // ---- Turned off from the palette: the window is gone ----
  await runCommand(page, 'Turn the overlay off');
  const saidOff = toastSaying(page, 'The overlay is off');
  await expect(saidOff).toHaveAttribute('data-tone', 'ok');
  await saidOff.getByTestId('toast-close').click();
  await expect(saidOff).toHaveCount(0);
  await expect(main).toHaveAttribute('data-on', 'false');
  await expect(page.getByTestId('overlay-place-words')).toContainText('turn the overlay on first');
  await expect.poll(() => panels(app)).toEqual([]);
  expect(await saved(run.dataRoot)).toMatchObject({ on: false });

  // ---- The settings file damaged by something else: said, not replaced, and nothing comes on ----
  const damaged = '{ "on": tru';
  await fs.writeFile(settingsFile(run.dataRoot), damaged);
  await reopenPage(page);
  await expect(page.getByTestId('overlay-settings-said')).toContainText(
    'settings.json is not valid JSON'
  );
  // What to do about it, as the manual has it.
  await expect(page.getByTestId('overlay-settings-advice')).toHaveText(
    "Repair the overlay's settings file or delete it: once it is deleted, the overlay starts again from its first settings, turned off."
  );
  await page.getByTestId('overlay-on').locator('input').click();
  await expect(page.getByTestId('overlay-error')).toContainText('settings.json is not valid JSON');
  await expect(main).toHaveAttribute('data-on', 'false');
  // The switch does not stay where it was clicked to: it shows what is so.
  await expect(page.getByTestId('overlay-on').locator('input')).not.toBeChecked();
  await expect(status).toContainText('Off.');
  expect(await panels(app)).toEqual([]);
  // An option is refused the same way, and its box goes back to what is in effect.
  await page.getByTestId('overlay-error').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('overlay-error')).toHaveCount(0);
  await page.getByTestId('overlay-show-unbound').locator('input').click();
  await expect(page.getByTestId('overlay-error')).toContainText('settings.json is not valid JSON');
  await expect(page.getByTestId('overlay-show-unbound').locator('input')).toBeChecked();
  expect(await fs.readFile(settingsFile(run.dataRoot), 'utf8')).toBe(damaged);
  expect(await accessible(page)).toEqual([]);
  await page.getByRole('heading', { name: 'Overlay', exact: true }).scrollIntoViewIfNeeded();
  await shot(page, 'damaged-settings');

  // ---- The file taken away: the overlay starts from its first settings and can be turned on ----
  await fs.rm(settingsFile(run.dataRoot));
  await reopenPage(page);
  await expect(page.getByTestId('overlay-settings-problem')).toHaveCount(0);
  await expect(page.getByTestId('overlay-error')).toHaveCount(0);
  await expect(main).toHaveAttribute('data-on', 'false');
  await expect(page.getByTestId('overlay-lifetime-value')).toHaveText('5 seconds');
  await turnOn(app, page);
  await expect(status).toContainText('On, over whatever is on BenQ GW2480');
  expect(await saved(run.dataRoot)).toMatchObject({ on: true });
});

test('when the controllers cannot be read the overlay says so, on the page and from the palette', async ({
  rig,
}) => {
  const run = await rig.launch('generic-fresh', 'overlay-not-read');
  const { app, page } = run;
  const shot = pictures('overlay-not-read');
  await openPage(page);
  const status = page.getByTestId('overlay-status');
  const NOT_READ = 'The overlay is on, but the controllers are not being read';
  const notRead = page.getByTestId('overlay-not-read');
  const why = page.getByTestId('overlay-input-problem');
  // Off, nothing is said about a reader nobody asked for.
  await expect(status).toContainText('Off.');
  await expect(notRead).toHaveCount(0);
  await expect(why).toHaveCount(0);

  // ---- The input reader does not start: the window is up, and the page says what is not ----
  const READER = 'Could not start the input reader.';
  await run.mutate([{ op: 'failProvider', port: 'input', message: READER }]);
  const popup = await turnOn(app, page);
  // The page says first what the palette says, then why in the reader's own words.
  await expect(notRead).toHaveText(`${NOT_READ}.`);
  await expect(why).toHaveText(READER);
  await expect(status).toContainText('On, over whatever is on BenQ GW2480');
  expect(await panel(app)).toMatchObject({ visible: true, onTop: true, focusable: false });
  expect(await accessible(page)).toEqual([]);
  await shot(page, 'controllers-not-read');

  // ---- The palette does not answer "The overlay is on" either ----
  await runCommand(page, 'Turn the overlay on');
  const saidNotRead = toastSaying(page, NOT_READ);
  await expect(saidNotRead).toHaveAttribute('data-tone', 'warn');
  await expect(saidNotRead.getByTestId('toast-detail')).toHaveText(READER);
  await expect(notRead).toHaveText(`${NOT_READ}.`);
  await expect(why).toHaveText(READER);
  await shot(page, 'said-from-the-palette');
  await saidNotRead.getByTestId('toast-close').click();
  await expect(saidNotRead).toHaveCount(0);

  // ---- The reader starts after all: asked once more, the overlay reads the controllers ----
  await run.mutate([{ op: 'failProvider', port: 'input', fail: false }]);
  await runCommand(page, 'Turn the overlay on');
  await expect(toastSaying(page, 'The overlay is on')).toHaveAttribute('data-tone', 'ok');
  await expect(notRead).toHaveCount(0);
  await expect(why).toHaveCount(0);
  const { stick } = await controllersOf(page, { stick: 'Logitech' });
  await run.sendInput([stateOf(stick)]);
  await run.sendInput([stateOf(stick, [1])]);
  await expect(popup.getByTestId('overlay-press')).toHaveCount(1);
  await expect(popup.getByTestId('overlay-press-action')).toHaveText('Button 1');
});
