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
}

const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
const tray = (app: ElectronApplication): Promise<TrayView> =>
  app.evaluate(() => (globalThis as unknown as { __rigreadyTray(): TrayView }).__rigreadyTray());
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

  // Switching in the tray switches the Fly screen too.
  await click(app, 'profile:dcs-f-a-18c');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect.poll(async () => (await tray(app)).tooltip).toBe('RigReady - DCS F/A-18C: Ready');

  // Something breaks: the icon turns red.
  await mutate([{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect.poll(async () => (await tray(app)).tone).toBe('bad');
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
