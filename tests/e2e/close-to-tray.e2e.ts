import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { expect, test } from './harness';

/**
 * Closing the window (PLAT-002), as somebody who came from RigReady 1 meets it. That version
 * left "minimizeToTray": false in the settings file for a switch nobody could use, and this
 * version read it as a choice: the window closed and RigReady was gone, with no icon in the
 * tray. Here the same data folder keeps RigReady in the tray, the setting is found by the
 * word "tray", it says what closing the window does, and switched off it quits.
 */

interface TrayView {
  tooltip: string;
  menu: { id: string; label: string }[];
}

const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
const tray = (app: ElectronApplication): Promise<TrayView> =>
  app.evaluate(() => (globalThis as unknown as { __rigreadyTray(): TrayView }).__rigreadyTray());
/** The X of the window: the same close event a click on it sends. */
const closeWindow = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
const doubleClickTrayIcon = (app: ElectronApplication): Promise<void> =>
  app.evaluate(() =>
    (globalThis as unknown as { __rigreadyTrayIcon(kind: string): void }).__rigreadyTrayIcon(
      'double-click'
    )
  );

test('closing the window: on the settings RigReady 1 left behind RigReady stays in the tray, the setting is found by "tray" and says what closing does, and switched off it quits', async ({
  rig,
}) => {
  const { page, app, dataRoot, shot } = await rig.launch(
    'first-run-after-version-one',
    'close-to-tray'
  );
  await expect(page.getByTestId('fly-empty')).toBeVisible();
  const file = path.join(dataRoot, 'settings.json');
  const onDisk = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  // What version 1 wrote is what is in the file.
  expect(await onDisk()).toMatchObject({ version: 1, minimizeToTray: false });

  // The setting is found from anywhere by the word people have for it.
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.type('tray');
  // The Settings page is what the word finds: its entry is the one marked, and Enter opens it.
  const marked = page.locator('[data-testid="palette-row"][aria-selected="true"]');
  await expect(marked.locator('.rr-palette-title')).toHaveText('Settings');
  await shot('found-by-tray');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toBeHidden();
  await expect(page.getByTestId('settings-page')).toBeVisible();

  // On, although version 1 wrote "off": nobody chose that. The row says what closing does.
  const row = page.locator('.rr-row', { has: page.getByTestId('setting-minimize-to-tray') });
  await expect(row.locator('.rr-row-title')).toHaveText(
    'Keep RigReady in the tray when you close the window'
  );
  const onOff = page.getByTestId('setting-minimize-to-tray').locator('input');
  const effect = page.getByTestId('setting-minimize-to-tray-effect');
  await expect(onOff).toBeChecked();
  await expect(effect).toContainText(
    'Closing the window hides it. RigReady keeps running, with its icon in the tray next to the clock.'
  );
  await expect(effect).toContainText('To quit, right-click the icon and choose Quit.');
  await shot('on-says-what-closing-does');

  // And that is what closing does: the window is gone, RigReady is in the tray, Quit in its menu.
  await closeWindow(app);
  await expect.poll(() => windowVisible(app)).toBe(false);
  const inTray = await tray(app);
  expect(inTray.tooltip).toContain('RigReady');
  expect(inTray.menu.map((item) => item.label)).toContain('Quit');
  // Looking and closing wrote nothing: the file version 1 left is as it was.
  expect(await onDisk()).toMatchObject({ version: 1, minimizeToTray: false });

  // A double-click on the tray icon brings the window back, on the page it was on.
  await doubleClickTrayIcon(app);
  await expect.poll(() => windowVisible(app)).toBe(true);
  await expect(onOff).toBeChecked();

  // Switched off, the row says the other thing, and from now on the file holds a choice.
  await onOff.uncheck();
  await expect(page.getByTestId('settings-saved')).toHaveText('Saved');
  await expect(effect).toHaveText(
    'Closing the window quits RigReady. Its tray icon goes away too.'
  );
  await shot('off-says-closing-quits');
  expect(await onDisk()).toMatchObject({ schemaVersion: 1, minimizeToTray: false });
  expect(await onDisk()).not.toHaveProperty('version');

  // And closing the window now ends RigReady.
  const ended = app.waitForEvent('close');
  await closeWindow(app).catch(() => undefined);
  await ended;
});
