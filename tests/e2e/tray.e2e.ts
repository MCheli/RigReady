import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { expect, repoRoot, scenarioFile, test } from './harness';

/**
 * The tray, used the way a user would. A scenario run exposes the tray's model and its
 * menu actions to the test (an OS tray cannot be clicked from Playwright).
 */

interface TrayView {
  tooltip: string;
  tone: 'ok' | 'warn' | 'bad' | null;
  menu: {
    id: string;
    label: string;
    enabled: boolean;
    submenu?: { id: string; label: string; checked?: boolean }[];
  }[];
  notifications: { title: string; body: string }[];
  /** How often a click on the icon put the window away, and whether one is about to. */
  hides: number;
  hidePending: boolean;
}

const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
const tray = (app: ElectronApplication): Promise<TrayView> =>
  app.evaluate(() => (globalThis as unknown as { __rigreadyTray(): TrayView }).__rigreadyTray());
/** A click or a double-click on the tray icon itself; `inFront`: the window was the one in front. */
const icon = (
  app: ElectronApplication,
  kind: 'click' | 'double-click',
  inFront?: boolean
): Promise<void> =>
  app.evaluate(
    (_electron, [how, front]) =>
      (
        globalThis as unknown as {
          __rigreadyTrayIcon(kind: string, inFront?: boolean): void;
        }
      ).__rigreadyTrayIcon(how as string, front as boolean | undefined),
    [kind, inFront] as const
  );
const click = (app: ElectronApplication, id: string): Promise<void> =>
  app.evaluate(
    (_electron, item) =>
      (
        globalThis as unknown as { __rigreadyTrayClick(id: string): Promise<void> }
      ).__rigreadyTrayClick(item),
    id
  );

test('tray: shows readiness as a colour, switches setup, and runs Make ready, Launch and Stand down', async ({
  rig,
}) => {
  const { page, shot, app, mutate } = await rig.launch('fly-two-setups', 'tray');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect.poll(async () => (await tray(app)).tone).toBe('ok');
  const view = await tray(app);
  expect(view.tooltip).toBe('RigReady - DCS UH-1H: Ready');
  expect(view.menu.map((i) => i.label)).toEqual([
    'Open RigReady',
    '',
    'DCS UH-1H: Ready',
    'Setup',
    'Make ready',
    'Launch',
    'Stand down',
    '',
    'Quit',
  ]);
  expect(
    view.menu.find((i) => i.id === 'setups')?.submenu?.map((s) => [s.label, s.checked])
  ).toEqual([
    ['DCS F/A-18C', false],
    ['DCS UH-1H', true],
  ]);

  // Switching in the tray switches the Play screen too.
  await click(app, 'profile:dcs-f-a-18c');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect.poll(async () => (await tray(app)).tooltip).toBe('RigReady - DCS F/A-18C: Ready');

  // Something breaks: the icon turns red.
  await mutate([{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect.poll(async () => (await tray(app)).tone).toBe('bad');
  // The tooltip says what is wrong by name: no need to open the window to know.
  await expect
    .poll(async () => (await tray(app)).tooltip)
    .toBe('RigReady - DCS F/A-18C: Not ready (1 problem): TrackIR5');
  await shot('not-ready');

  await click(app, 'makeReady');
  await expect.poll(async () => (await tray(app)).tone).toBe('ok');
  expect((await tray(app)).notifications.at(-1)).toEqual({
    title: 'DCS F/A-18C is ready',
    body: 'Make ready finished.',
  });
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  await click(app, 'launch');
  expect((await tray(app)).notifications.at(-1)).toEqual({
    title: 'DCS F/A-18C launched',
    body: 'Launched DCS.exe',
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());

  await click(app, 'standDown');
  expect((await tray(app)).notifications.at(-1)).toEqual({
    title: 'Stood down',
    body: 'Closed 1 app',
  });
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('stood-down-from-tray');
});

test('tray: closing the window keeps RigReady in the tray, and starting it again brings the window back', async ({
  rig,
}) => {
  const { page, app, dataRoot, shot } = await rig.launch('flying-all-good', 'tray-single-instance');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect.poll(() => windowVisible(app)).toBe(false);
  // Still running, in the tray.
  expect((await tray(app)).tooltip).toBe('RigReady - DCS F/A-18C: Ready');

  // A second start (the Start menu, a shortcut) finds the first one and shows its window.
  const root = path.dirname(dataRoot);
  const user = path.join(root, 'user');
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env['ELECTRON_RUN_AS_NODE'];
  Object.assign(env, {
    USERPROFILE: user,
    APPDATA: path.join(user, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(user, 'AppData', 'Local'),
    RIGREADY_HOME: dataRoot,
    RIGREADY_SCENARIO: scenarioFile('flying-all-good'),
  });
  const electron = createRequire(__filename)('electron') as string;
  const second = spawn(electron, [repoRoot], { env, stdio: 'ignore' });
  const code = await new Promise<number | null>((resolve) => second.on('exit', resolve));
  expect(code).toBe(0);
  await expect.poll(() => windowVisible(app)).toBe(true);
  await shot('shown-again');
});

test('tray: a double-click on the icon opens the window; one click brings it out, or puts it away when it is in front', async ({
  rig,
}) => {
  const { page, app, shot, mutate } = await rig.launch('flying-optional-missing', 'tray-icon');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
  // The tooltip names the setup, its state, and the optional item that is not met.
  await expect
    .poll(async () => (await tray(app)).tooltip)
    .toBe('RigReady - DCS F/A-18C: Ready (1 warning): Stream Deck XL');

  // Closed to the tray: one click brings the window out.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect.poll(() => windowVisible(app)).toBe(false);
  await icon(app, 'click');
  await expect.poll(() => windowVisible(app)).toBe(true);

  // Visible but behind something else: one click brings it forward, it is not hidden.
  await icon(app, 'click', false);
  expect(await tray(app)).toMatchObject({ hides: 0, hidePending: false });
  expect(await windowVisible(app)).toBe(true);

  // The window in front: one click puts it away.
  await icon(app, 'click', true);
  await expect.poll(() => windowVisible(app)).toBe(false);
  expect((await tray(app)).hides).toBe(1);

  // A double-click always opens it, from the tray...
  await icon(app, 'double-click');
  await expect.poll(() => windowVisible(app)).toBe(true);
  // ...and when it is in front: the first click of the double-click does not put it away.
  // Both arrive in one go, as Windows delivers them, so nothing can come between.
  const betweenTheClicks = await app.evaluate(() => {
    const hooks = globalThis as unknown as {
      __rigreadyTrayIcon(kind: string, inFront?: boolean): void;
      __rigreadyTray(): TrayView;
    };
    hooks.__rigreadyTrayIcon('click', true);
    const pending = hooks.__rigreadyTray().hidePending;
    hooks.__rigreadyTrayIcon('double-click', true);
    return pending;
  });
  expect(betweenTheClicks).toBe(true);
  expect(await tray(app)).toMatchObject({ hides: 1, hidePending: false });
  expect(await windowVisible(app)).toBe(true);

  // Minimized to the taskbar: one click restores it.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize());
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())
    )
    .toBe(true);
  await icon(app, 'click', false);
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())
    )
    .toBe(false);

  // While something runs, the tooltip says so; afterwards it says the state again.
  await mutate([{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
  await expect.poll(async () => (await tray(app)).tone).toBe('bad');
  await expect
    .poll(async () => (await tray(app)).tooltip)
    .toBe('RigReady - DCS F/A-18C: Not ready (1 problem): TrackIR5');
  await click(app, 'makeReady');
  await expect
    .poll(async () => (await tray(app)).tooltip)
    .toBe('RigReady - DCS F/A-18C: Ready (1 warning): Stream Deck XL');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
  await shot('ready-with-a-warning');
});
