/**
 * The window of the packaged app (npm run smoke:packaged): Electron's own menu is gone, and
 * with it the keys that were never RigReady's.
 *
 * Two kinds of proof, both on a scenario (the fake machine):
 *
 *  - What the app set: its menu, and the state of each window's menu bar, read from Electron.
 *  - Keys pressed for real. A key reaches a menu only in the active window, and the key
 *    presses of the test driver never reach a menu at all (measured: under Electron's own
 *    menu they do not reload the window, a key sent by Electron does). So the keys are sent
 *    by Electron itself while RigReady's window is the active one, and zooming with Ctrl+=
 *    in the same go shows that they arrived. On a PC where another program holds the
 *    foreground this cannot be done; the test then says so by being skipped.
 */
import path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { expect, repoRoot, test } from '../e2e/harness';

const exe = path.join(repoRoot, 'release', 'win-unpacked', 'RigReady.exe');

test.use({ executablePath: exe });

interface Key {
  code: string;
  modifiers: ('control' | 'shift' | 'alt')[];
}
/** Keys sent one after the other, and what to wait for before looking at the window. */
interface Step {
  keys: Key[];
  until: { zoom?: number; fullScreen?: boolean };
}
/** What the window is like after a step. */
interface After {
  focused: boolean;
  zoom: number;
  reloaded: boolean;
  devTools: boolean;
  barVisible: boolean;
  fullScreen: boolean;
}
interface Pressed {
  /** The window stopped being the active one at some moment: nothing can be read from this go. */
  blurred: boolean;
  after: After[];
}

const key = (code: string): Key => ({ code, modifiers: [] });
const ctrl = (code: string): Key => ({ code, modifiers: ['control'] });
const ctrlShift = (code: string): Key => ({ code, modifiers: ['control', 'shift'] });

/** Makes RigReady's window the active one, and says whether Windows allowed it. */
const activate = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.show();
    window.focus();
    return window.isFocused();
  });

/** Back to how the window started: no zoom, no developer tools, not full screen. */
const reset = (app: ElectronApplication): Promise<void> =>
  app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    const contents = window.webContents;
    contents.setZoomLevel(0);
    if (contents.isDevToolsOpened()) contents.closeDevTools();
    if (window.isFullScreen()) {
      window.setFullScreen(false);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  });

/**
 * Sends the keys of each step, waits for what the step expects (at most a few seconds: this
 * is a wait for the window, not a measure of the PC's speed), and says what the window was
 * like then.
 */
const press = (app: ElectronApplication, steps: Step[]): Promise<Pressed> =>
  app.evaluate(async ({ BrowserWindow }, given) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    const contents = window.webContents;
    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    let blurred = false;
    let reloaded = false;
    const onBlur = (): void => {
      blurred = true;
    };
    const onLoad = (): void => {
      reloaded = true;
    };
    window.on('blur', onBlur);
    contents.on('did-start-loading', onLoad);
    const after: After[] = [];
    try {
      for (const step of given) {
        for (const one of step.keys) {
          contents.sendInputEvent({ type: 'keyDown', keyCode: one.code, modifiers: one.modifiers });
          contents.sendInputEvent({ type: 'keyUp', keyCode: one.code, modifiers: one.modifiers });
        }
        const reached = (): boolean =>
          (step.until.zoom === undefined || contents.getZoomLevel() === step.until.zoom) &&
          (step.until.fullScreen === undefined || window.isFullScreen() === step.until.fullScreen);
        for (let waited = 0; waited < 5000 && !reached() && !blurred; waited += 50) await wait(50);
        // Time for anything else the keys set off (a page starting to load) to show.
        await wait(300);
        after.push({
          focused: window.isFocused(),
          zoom: contents.getZoomLevel(),
          reloaded,
          devTools: contents.isDevToolsOpened(),
          barVisible: window.isMenuBarVisible(),
          fullScreen: window.isFullScreen(),
        });
        if (blurred) break;
      }
    } finally {
      window.removeListener('blur', onBlur);
      contents.removeListener('did-start-loading', onLoad);
    }
    return { blurred, after };
  }, steps);

test('packaged window: the menu is RigReady’s own (zoom and full screen, nothing that reloads or opens the developer tools) and no window has a menu bar, nor one made later', async ({
  rig,
}) => {
  const { page, app } = await rig.launch('fly-two-setups', 'packaged-window');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  const menu = await app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((item) => ({
      label: item.label,
      entries: (item.submenu?.items ?? []).map((entry) => String(entry.role).toLowerCase()),
    }))
  );
  expect(menu).toEqual([
    { label: 'View', entries: ['zoomin', 'zoomin', 'zoomout', 'resetzoom', 'togglefullscreen'] },
  ]);
  // Zoom in also answers to the plus key without Shift.
  const zoomInKeys = await app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items[0]?.submenu?.items ?? [])
      .filter((entry) => String(entry.role).toLowerCase() === 'zoomin')
      .map((entry) => String(entry.accelerator))
  );
  expect(zoomInKeys).toContain('CommandOrControl+=');

  // Not shown, and not one that Alt brings up.
  const bars = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isMenuBarVisible(),
      autoHide: window.isMenuBarAutoHide(),
    }))
  );
  expect(bars.length).toBeGreaterThan(0);
  for (const bar of bars) expect(bar).toEqual({ visible: false, autoHide: false });
  // A window made later, the way a feature's extra window is made, has none either.
  const later = await app.evaluate(({ BrowserWindow }) => {
    const window = new BrowserWindow({ show: false, autoHideMenuBar: true });
    const bar = { visible: window.isMenuBarVisible(), autoHide: window.isMenuBarAutoHide() };
    window.destroy();
    return bar;
  });
  expect(later).toEqual({ visible: false, autoHide: false });
});

test('packaged window, keys pressed for real: Ctrl+R does not reload it, Ctrl+Shift+I does not open the developer tools, Alt brings up no menu bar, and the zoom and full screen keys work', async ({
  rig,
}) => {
  const { page, app } = await rig.launch('fly-two-setups', 'packaged-window-keys');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  const steps: Step[] = [
    // The keys that must do nothing, and then one that must: it shows that they arrived.
    {
      keys: [ctrl('R'), ctrlShift('R'), ctrlShift('I'), key('Alt'), ctrl('=')],
      until: { zoom: 0.5 },
    },
    { keys: [ctrlShift('Plus')], until: { zoom: 1 } },
    { keys: [ctrl('-')], until: { zoom: 0.5 } },
    { keys: [ctrl('0')], until: { zoom: 0 } },
    { keys: [key('F11')], until: { fullScreen: true } },
    { keys: [key('F11')], until: { fullScreen: false } },
  ];
  // Another program may take the foreground at any moment (a second test run on this PC does
  // it every few seconds): a go in which that happened says nothing, and is made again.
  let pressed: Pressed | undefined;
  let goes = 0;
  for (; goes < 8 && !pressed; goes++) {
    await reset(app);
    if (!(await activate(app))) {
      await page.waitForTimeout(700);
      continue;
    }
    const result = await press(app, steps);
    // Under Electron's own menu Ctrl+R reloads the window: what it was like then is still told.
    const reloaded = result.after.some((after) => after.reloaded);
    if (reloaded || (!result.blurred && result.after.every((after) => after.focused)))
      pressed = result;
  }
  await reset(app);
  console.log(
    pressed
      ? `  keys, go ${goes}: ${JSON.stringify(pressed.after)}`
      : `  keys: in ${goes} goes the window never stayed the active one`
  );
  test.skip(
    pressed === undefined,
    'RigReady’s window could not be kept the active one on this PC, so no key could be pressed in it'
  );
  const [first, plus, minus, zero, full, back] = pressed!.after;
  expect(first).toEqual({
    focused: true,
    // Ctrl+= arrived, so the keys before it arrived too: they did nothing.
    zoom: 0.5,
    reloaded: false,
    devTools: false,
    barVisible: false,
    fullScreen: false,
  });
  expect(plus!.zoom).toBe(1);
  expect(minus!.zoom).toBe(0.5);
  expect(zero!.zoom).toBe(0);
  expect(full!.fullScreen).toBe(true);
  expect(back!.fullScreen).toBe(false);
  expect(pressed!.after.every((after) => !after.reloaded && !after.devTools)).toBe(true);
  // The page is the one that was there: it was never loaded again.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
});
