import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { expect, screensDir, test } from './harness';

/**
 * RigReady's taskbar button (WOW-WIN-004, WOW-WIN-005): the Jump List, the status badge,
 * the tooltip, the progress bar and the buttons under the window's thumbnail. A scenario
 * run has a fake taskbar that remembers what it was told; the test reads it and presses
 * its buttons (the real taskbar cannot be driven from Playwright).
 */

interface TaskbarView {
  jumpTasks: { title: string; description: string; args: string[] }[];
  jumpListWrites: number;
  overlay: string | null;
  tone: 'ok' | 'warn' | 'bad' | null;
  tooltip: string;
  progress: { mode: string; value?: number };
  progressSeen: { mode: string; value?: number }[];
  buttons: { id: string; tooltip: string; enabled: boolean }[];
}
interface TrayView {
  notifications: { title: string; body: string }[];
}

const taskbar = (app: ElectronApplication): Promise<TaskbarView> =>
  app.evaluate(() =>
    (globalThis as unknown as { __rigreadyTaskbar(): TaskbarView }).__rigreadyTaskbar()
  );
const press = (app: ElectronApplication, id: string): Promise<boolean> =>
  app.evaluate(
    (_electron, button) =>
      (
        globalThis as unknown as { __rigreadyTaskbarPress(id: string): boolean }
      ).__rigreadyTaskbarPress(button),
    id
  );
const trayClick = (app: ElectronApplication, id: string): Promise<void> =>
  app.evaluate(
    (_electron, item) =>
      (
        globalThis as unknown as { __rigreadyTrayClick(id: string): Promise<void> }
      ).__rigreadyTrayClick(item),
    id
  );
const notifications = async (app: ElectronApplication): Promise<TrayView['notifications']> =>
  (
    await app.evaluate(() =>
      (globalThis as unknown as { __rigreadyTray(): TrayView }).__rigreadyTray()
    )
  ).notifications;
const started = async (app: ElectronApplication): Promise<string[]> =>
  (
    await app.evaluate(() =>
      (globalThis as unknown as { __rigreadyCommand(): { started: string[] } }).__rigreadyCommand()
    )
  ).started.map((exe) => path.win32.basename(exe));
const titles = async (app: ElectronApplication): Promise<string[]> =>
  (await taskbar(app)).jumpTasks.map((task) => task.title);

interface Pictures {
  overlay: string | null;
  buttons: Record<string, string>;
}
const pictures = (app: ElectronApplication): Promise<Pictures> =>
  app.evaluate(() =>
    (globalThis as unknown as { __rigreadyTaskbarPictures(): Pictures }).__rigreadyTaskbarPictures()
  );

/**
 * One picture of the pictures the taskbar was handed, so a person can look at them: each
 * at the size the taskbar shows it, at the size it was handed, and enlarged, on a dark and
 * on a light taskbar.
 */
async function contactSheet(
  app: ElectronApplication,
  file: string,
  items: { label: string; png: string }[]
): Promise<void> {
  const sizes = (png: string): string =>
    [16, 32, 128]
      .map((px) => `<img style="width:${px}px;height:${px}px" src="data:image/png;base64,${png}">`)
      .join('');
  const html =
    '<body style="margin:0;padding:18px;background:#101418;color:#e6e9ed;font:13px Segoe UI,sans-serif">' +
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">' +
    items
      .map(
        (item) =>
          '<div>' +
          `<div style="margin-bottom:6px">${item.label}</div>` +
          `<div style="background:#1c1c1c;padding:10px;display:flex;gap:14px;align-items:flex-end;image-rendering:pixelated">${sizes(item.png)}</div>` +
          `<div style="background:#eeeeee;padding:10px;display:flex;gap:14px;align-items:flex-end;image-rendering:pixelated">${sizes(item.png)}</div>` +
          '</div>'
      )
      .join('') +
    '</div></body>';
  const png = await app.evaluate(async ({ BrowserWindow }, page) => {
    const window = new BrowserWindow({
      show: false,
      width: 760,
      height: 740,
      useContentSize: true,
      webPreferences: { offscreen: true, javascript: false, sandbox: true },
    });
    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
      return (await window.webContents.capturePage()).toPNG().toString('base64');
    } finally {
      window.destroy();
    }
  }, html);
  await fs.writeFile(file, Buffer.from(png, 'base64'));
}

test('taskbar: the Jump List offers "Launch <setup>" for the setups used most recently and follows setups used, renamed, cloned and deleted', async ({
  rig,
}) => {
  const run = await rig.launch('fly-two-setups', 'taskbar-jump-list');
  const { page, app, shot } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  // The setup used last comes first; each task starts RigReady with --launch for its setup.
  await expect.poll(() => titles(app)).toEqual(['Launch DCS UH-1H', 'Launch DCS F/A-18C']);
  expect((await taskbar(app)).jumpTasks).toEqual([
    {
      title: 'Launch DCS UH-1H',
      description: 'Make the rig ready for DCS UH-1H and launch it',
      args: ['--launch=fly-dcs-uh-1h'],
    },
    {
      title: 'Launch DCS F/A-18C',
      description: 'Make the rig ready for DCS F/A-18C and launch it',
      args: ['--launch=dcs-f-a-18c'],
    },
  ]);

  // Used: switching to the other setup moves it to the top.
  await trayClick(app, 'profile:dcs-f-a-18c');
  await expect.poll(() => titles(app)).toEqual(['Launch DCS F/A-18C', 'Launch DCS UH-1H']);

  // Renamed in the editor.
  await page.getByTestId('mode-configure').click();
  await page
    .locator('[data-testid="profile-row"]', { hasText: 'DCS UH-1H' })
    .getByTestId('profile-edit')
    .click();
  await page.getByTestId('edit-name').locator('input').fill('Huey at dusk');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();
  await expect.poll(() => titles(app)).toEqual(['Launch DCS F/A-18C', 'Launch Huey at dusk']);
  // The task still names the setup by its id, which a rename keeps.
  expect((await taskbar(app)).jumpTasks[1]!.args).toEqual(['--launch=fly-dcs-uh-1h']);

  // Cloned: a new setup, never used, comes after the used ones.
  await page
    .locator('[data-testid="profile-row"]', { hasText: 'DCS F/A-18C' })
    .getByTestId('profile-clone')
    .click();
  await expect
    .poll(() => titles(app))
    .toEqual(['Launch DCS F/A-18C', 'Launch Huey at dusk', 'Launch DCS F/A-18C (copy)']);

  // The copy opens in the editor. A setup that launches nothing is offered for what it can do.
  await expect(page.getByTestId('edit-name').locator('input')).toHaveValue('DCS F/A-18C (copy)');
  await page.getByTestId('edit-launch-none').click();
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();
  await expect
    .poll(() => titles(app))
    .toEqual(['Launch DCS F/A-18C', 'Launch Huey at dusk', 'Make ready: DCS F/A-18C (copy)']);
  expect((await taskbar(app)).jumpTasks[2]!.args[0]).toMatch(/^--make-ready=dcs-f-a-18c-copy/);
  await shot('three-setups');

  // Deleted.
  const copy = page.locator('[data-testid="profile-row"]', { hasText: 'DCS F/A-18C (copy)' });
  await copy.getByTestId('profile-more').click();
  await page.getByTestId('profile-delete').click();
  await page.getByTestId('profile-delete-confirm').click();
  await expect.poll(() => titles(app)).toEqual(['Launch DCS F/A-18C', 'Launch Huey at dusk']);

  // A task is a second start with its arguments: it flies its setup.
  const task = (await taskbar(app)).jumpTasks[1]!;
  expect(await run.secondStart(task.args)).toBe(0);
  await expect.poll(() => started(app)).toEqual(['DCS.exe']);
  // Used just now, so it is the first task.
  await expect.poll(() => titles(app)).toEqual(['Launch Huey at dusk', 'Launch DCS F/A-18C']);
});

test('taskbar: the button carries the status as a badge with words, fills while Make ready runs, and its three buttons do what they say', async ({
  rig,
}) => {
  const { page, app, shot, mutate } = await rig.launch('flying-all-good', 'taskbar-button');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect.poll(async () => (await taskbar(app)).tone).toBe('ok');
  let view = await taskbar(app);
  expect(view.overlay).toBe('DCS F/A-18C: Ready');
  expect(view.tooltip).toBe('RigReady - DCS F/A-18C: Ready');
  expect(view.buttons).toEqual([
    { id: 'makeReady', tooltip: 'Make ready: DCS F/A-18C', enabled: true },
    { id: 'launch', tooltip: 'Launch: DCS F/A-18C', enabled: true },
    { id: 'standDown', tooltip: 'Stand down: DCS F/A-18C', enabled: true },
  ]);
  // Idle: no progress bar.
  await expect.poll(async () => (await taskbar(app)).progress).toEqual({ mode: 'none' });

  // The pictures the taskbar was handed are kept, to be looked at.
  const seen: { label: string; png: string }[] = [];
  const keepBadge = async (label: string): Promise<void> => {
    const now = await pictures(app);
    expect(now.overlay).not.toBeNull();
    seen.push({ label, png: now.overlay! });
  };
  await keepBadge('Badge: Ready (a dot)');

  // An optional item is not met: ready, with a warning.
  await mutate([{ op: 'stopProcess', name: 'StreamDeck.exe' }]);
  await expect.poll(async () => (await taskbar(app)).tone).toBe('warn');
  expect((await taskbar(app)).overlay).toBe('DCS F/A-18C: Ready (1 warning)');
  await keepBadge('Badge: Ready with warnings (a triangle)');
  await mutate([
    {
      op: 'startProcess',
      name: 'StreamDeck.exe',
      path: 'C:\\Program Files\\Elgato\\StreamDeck\\StreamDeck.exe',
    },
  ]);
  await expect.poll(async () => (await taskbar(app)).tone).toBe('ok');

  // Something required breaks: the badge and its words change with the Play screen.
  await mutate([{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect.poll(async () => (await taskbar(app)).tone).toBe('bad');
  view = await taskbar(app);
  expect(view.overlay).toBe('DCS F/A-18C: Not ready (1 problem)');
  expect(view.tooltip).toContain('DCS F/A-18C: Not ready');
  await keepBadge('Badge: Not ready (a square)');
  await shot('not-ready');
  const handed = await pictures(app);
  await contactSheet(app, path.join(screensDir, 'taskbar-button', '02-pictures.png'), [
    ...seen,
    { label: 'Button: Make ready', png: handed.buttons['makeReady']! },
    { label: 'Button: Launch', png: handed.buttons['launch']! },
    { label: 'Button: Stand down', png: handed.buttons['standDown']! },
  ]);

  // Make ready from the thumbnail: the bar fills as the fix ends, then goes away.
  const before = view.progressSeen.length;
  expect(await press(app, 'makeReady')).toBe(true);
  await expect.poll(async () => (await taskbar(app)).tone).toBe('ok');
  await expect.poll(async () => (await taskbar(app)).progress).toEqual({ mode: 'none' });
  view = await taskbar(app);
  const during = view.progressSeen.slice(before);
  expect(during.some((p) => p.mode === 'normal' && p.value === 1)).toBe(true);
  expect(during.some((p) => p.mode !== 'none')).toBe(true);
  expect(await started(app)).toEqual(['TrackIR5.exe']);
  expect((await notifications(app)).at(-1)).toEqual({
    title: 'DCS F/A-18C is ready',
    body: 'Make ready finished.',
  });
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // Launch and Stand down, as from the tray.
  expect(await press(app, 'launch')).toBe(true);
  await expect.poll(() => started(app)).toEqual(['TrackIR5.exe', 'DCS.exe']);
  await expect
    .poll(async () => (await notifications(app)).at(-1))
    .toEqual({ title: 'DCS F/A-18C launched', body: 'Launched DCS.exe' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
  expect(await press(app, 'standDown')).toBe(true);
  await expect.poll(async () => (await notifications(app)).at(-1)?.title).toBe('Stood down');
  await expect.poll(async () => (await taskbar(app)).progress).toEqual({ mode: 'none' });
});

test('taskbar: on a PC without setups the Jump List is empty, there is no badge, and the buttons are off', async ({
  rig,
}) => {
  const { page, app } = await rig.launch('generic-fresh', 'taskbar-no-setups');
  await expect(page.getByTestId('mode-configure')).toBeVisible();
  await expect.poll(async () => (await taskbar(app)).buttons.length).toBe(3);
  const view = await taskbar(app);
  expect(view.jumpTasks).toEqual([]);
  expect(view.overlay).toBeNull();
  expect(view.tooltip).toBe('RigReady - No setup yet');
  expect(view.buttons.map((b) => [b.tooltip, b.enabled])).toEqual([
    ['Make ready', false],
    ['Launch', false],
    ['Stand down', false],
  ]);
  // A button that is off does nothing.
  expect(await press(app, 'makeReady')).toBe(false);
  expect(await started(app)).toEqual([]);
});
