import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { ElectronApplication } from '@playwright/test';
import { expect, screensDir, test } from './harness';

/** What the app put on the (fake) clipboard, oldest first. */
const clipboard = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() =>
    (globalThis as unknown as { __rigreadyClipboard: () => string[] }).__rigreadyClipboard()
  );

test('diagnostics: versions, games, devices and the recent log; copy, open the log folder, export', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'diagnostics', {
    dialogs: { save: ['Documents/rigready-diagnostics.zip'] },
  });
  const { page, shot, app, home, dataRoot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-diagnostics').click();
  const root = page.getByTestId('diagnostics-page');

  // This PC.
  await expect(root.getByTestId('diagnostics-version')).toHaveText(/^\d+\.\d+\.\d+/);
  await expect(root.getByTestId('diagnostics-app')).toContainText(/Electron \d+\./);
  await expect(root.getByTestId('diagnostics-app')).toContainText(/Chromium \d+\./);
  await expect(root.getByTestId('diagnostics-os')).toContainText('Windows');
  await expect(root.getByTestId('diagnostics-data-root')).toHaveText(dataRoot);
  await expect(root.getByTestId('diagnostics-games')).toContainText('DCS World');
  await expect(root.getByTestId('diagnostics-games')).toContainText('steam');
  await expect(root.getByTestId('diagnostics-devices')).toContainText('T-Pendular-Rudder');
  await expect(root.getByTestId('diagnostics-devices')).toContainText('044F:B68F');
  await expect(root.getByTestId('diagnostics-devices')).toContainText('LC49G95T: 5120x1440 at 0,0');
  await expect(root.locator('[data-testid="diagnostics-file"][data-ok="true"]')).toHaveCount(4);
  await shot('this-pc');

  // The recent log, newest first, with a level filter.
  const entries = root.getByTestId('log-entry');
  await expect(entries.filter({ hasText: /RigReady \d+\.\d+\.\d+\S* starting/ })).toHaveCount(1);
  await expect(entries.filter({ hasText: 'features:' })).toHaveCount(1);
  await root.getByTestId('diagnostics-log').scrollIntoViewIfNeeded();
  await shot('log');
  await root.getByTestId('diagnostics-show-warnings').click();
  await expect(root.getByTestId('diagnostics-log-empty')).toHaveText(
    'No warnings or errors in the recent log.'
  );
  await shot('log-no-warnings');
  await root.getByTestId('diagnostics-show-everything').click();
  await expect(entries.first()).toBeVisible();

  // Detailed log: a setting, written to the log itself.
  await root.getByTestId('diagnostics-detailed').locator('input').check();
  await expect
    .poll(
      // The file does not exist until the first setting is saved: not there yet is not an error.
      async () =>
        fs
          .readFile(path.join(dataRoot, 'settings.json'), 'utf8')
          .then((text) => JSON.parse(text).logLevel as unknown)
          .catch(() => undefined)
    )
    .toBe('debug');
  await root.getByTestId('diagnostics-refresh').click();
  await expect(entries.filter({ hasText: 'log level is now debug' })).toHaveCount(1);

  // Copy diagnostics.
  await page.mouse.wheel(0, -5000);
  await root.getByTestId('diagnostics-copy').click();
  await expect(root.getByTestId('diagnostics-message')).toContainText(/Copied [\d,]+ characters/);
  const copied = (await clipboard(app)).at(-1)!;
  expect(copied).toContain('RigReady diagnostics');
  expect(copied).toContain('DCS World: steam, {DCS_INSTALL}');
  expect(copied).toContain('Data folder: {RIGREADY_HOME}');
  expect(copied).toMatch(/INFO {2}\[app\] RigReady \S+ starting/);
  expect(copied.toLowerCase()).not.toContain(home.toLowerCase());
  expect(copied).not.toContain('RIG-PC');
  await expect(root.getByTestId('diagnostics-copy')).toBeInViewport();
  await shot('copied');

  // Open log folder: Explorer, with the folder as one argument.
  await root.getByTestId('diagnostics-open-logs').click();
  await expect(root.getByTestId('diagnostics-message')).toHaveText('Opened the log folder.');

  // Export diagnostics: a zip where the save dialog said.
  await root.getByTestId('diagnostics-export').click();
  const target = path.join(home, 'Documents', 'rigready-diagnostics.zip');
  await expect(root.getByTestId('diagnostics-message')).toContainText(`Saved ${target}`);
  await shot('exported');
  const zip = unzipSync(new Uint8Array(await fs.readFile(target)));
  expect(Object.keys(zip).sort()).toEqual([
    'diagnostics.txt',
    'logs/rigready.log',
    'settings.json',
  ]);
  for (const [name, data] of Object.entries(zip)) {
    const content = new TextDecoder().decode(data).toLowerCase();
    for (const secret of [home, home.replace(/\\/g, '\\\\'), path.basename(home), 'RIG-PC']) {
      expect(content, `${name} contains ${secret}`).not.toContain(secret.toLowerCase());
    }
  }
  expect(new TextDecoder().decode(zip['logs/rigready.log'])).toContain('log level is now debug');

  // A second export is cancelled in the dialog: nothing is claimed.
  await root.getByTestId('diagnostics-export').click();
  await expect(root.getByTestId('diagnostics-message')).toHaveCount(0);
  await expect(root.getByTestId('diagnostics-error')).toHaveCount(0);
});

test('diagnostics: an unexpected error in main or in the window is logged and shown with Copy details; the app keeps running', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'errors-unexpected');
  const { page, shot, app, dataRoot } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('error-notice')).toHaveCount(0);

  // An exception nobody caught, in the main process.
  await app.evaluate(() => {
    setTimeout(() => {
      throw new Error('tray icon handler exploded');
    }, 0);
  });
  const notice = page.getByTestId('error-notice');
  await expect(notice).toBeVisible();
  await expect(notice.getByTestId('error-notice-title')).toHaveText('Something went wrong');
  await expect(notice.getByTestId('error-notice-message')).toHaveText('tray icon handler exploded');
  await shot('main-error');
  // Not blocking: the screen behind it still works.
  await page.getByTestId('group-toggle-devices').click();
  await expect(page.locator('[data-testid="check-row"]').first()).toBeVisible();

  await notice.getByTestId('error-notice-copy').click();
  await expect(notice.getByTestId('error-notice-copy')).toHaveText('Copied');
  const details = (await clipboard(app)).at(-1)!;
  expect(details).toMatch(/^RigReady \S+ on Windows/);
  expect(details).toContain('unexpected error in main');
  expect(details).toContain('Error: tray icon handler exploded\n    at ');
  await shot('copied-details');

  // A rejected promise nobody handled, also in main: the notice counts up.
  await app.evaluate(() => {
    setTimeout(() => void Promise.reject(new Error('update check rejected')), 0);
  });
  await expect(notice.getByTestId('error-notice-title')).toHaveText('2 unexpected errors');
  await expect(notice.getByTestId('error-notice-message')).toHaveText('update check rejected');
  await notice.getByTestId('error-notice-dismiss').click();
  await expect(notice).toHaveCount(0);

  // The same in the window: an exception in a handler, and a rejected promise.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('click handler failed in the window');
    }, 0);
  });
  await expect(notice.getByTestId('error-notice-message')).toHaveText(
    /click handler failed in the window/
  );
  await page.evaluate(() => {
    setTimeout(() => void Promise.reject(new Error('fetch of the layout rejected')), 0);
  });
  await expect(notice.getByTestId('error-notice-message')).toHaveText(
    'fetch of the layout rejected'
  );
  await expect(notice.getByTestId('error-notice-title')).toHaveText('2 unexpected errors');
  await shot('window-errors');

  // The notice leads to Diagnostics, where the log has all four.
  await notice.getByTestId('error-notice-open').click();
  const root = page.getByTestId('diagnostics-page');
  await root.getByTestId('diagnostics-show-errors').click();
  const errors = root.locator('[data-testid="log-entry"][data-level="error"]');
  await expect(errors).toHaveCount(4);
  await expect(
    errors.filter({ hasText: 'unexpected error in main: tray icon handler exploded' })
  ).toHaveCount(1);
  await expect(
    errors.filter({ hasText: 'unexpected error in window: fetch of the layout rejected' })
  ).toHaveCount(1);
  await notice.getByTestId('error-notice-dismiss').click();
  await root.getByTestId('diagnostics-log').scrollIntoViewIfNeeded();
  await shot('errors-in-log');
  const logText = await fs.readFile(path.join(dataRoot, 'logs', 'rigready.log'), 'utf8');
  expect(logText).toContain('unexpected error in main: update check rejected');

  // The app is still running and usable.
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
});

test('diagnostics: a window whose page crashed is loaded again and says what happened', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'errors-window-crash');
  const { page, app } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.webContents.forcefullyCrashRenderer();
  });
  // Playwright cannot drive a page whose process died, so the reloaded page is read
  // (and photographed) through the main process.
  const text = (testId: string): Promise<string> =>
    app.evaluate(async ({ BrowserWindow }, id) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      if (contents.isCrashed() || contents.isLoading()) return '';
      // A question put to a page that is just being replaced is never answered.
      const answer = contents
        .executeJavaScript(`document.querySelector('[data-testid="${id}"]')?.textContent ?? ''`)
        .catch(() => '') as Promise<string>;
      const silent = new Promise<string>((resolve) => setTimeout(() => resolve(''), 1000));
      return Promise.race([answer, silent]);
    }, testId);
  await expect
    .poll(() => text('error-notice-message'), { timeout: 30_000 })
    .toContain('The RigReady window stopped working (crashed) and was loaded again.');
  // The app is back: the same screen, with the same setup, checked again.
  await expect.poll(() => text('fly-status-title'), { timeout: 30_000 }).toBe('Ready');
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
    return image.toPNG().toString('base64');
  });
  const file = path.join(screensDir, 'errors-window-crash', '01-reloaded.png');
  await fs.writeFile(file, Buffer.from(png, 'base64'));
  expect((await fs.stat(file)).size).toBeGreaterThan(10_000);
});
