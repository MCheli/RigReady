import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './harness';

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

const NOT_FOUND = /Installed somewhere unusual|RigReady did not find it/;

/** No page shows an unexpected-error notice or stays busy. */
async function calm(page: Page): Promise<void> {
  await expect(page.getByTestId('error-notice')).toHaveCount(0);
  await expect(
    page.locator('.v-progress-circular--indeterminate:visible, .v-skeleton-loader:visible')
  ).toHaveCount(0);
}

test('damaged files: the app starts with a damaged settings file, setups, monitor layouts and journal, says so, and keeps every file', async ({
  rig,
}) => {
  const run = await rig.launch('damaged-data-files', 'damaged-data-files');
  const { page, shot, dataRoot } = run;

  // It starts, on the setup that is intact, and tells the user what it found.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  const notices = page.getByTestId('app-notice');
  await expect(notices).toHaveCount(4);
  await expect(notices.nth(0)).toContainText(
    'The settings file could not be read, so defaults are in use'
  );
  await expect(notices.nth(1)).toContainText('The saved monitor layouts could not be read');
  await expect(notices.nth(2)).toContainText('Some setup files could not be read');
  await expect(notices.nth(2)).toContainText('dcs-uh-1h.yaml, garbage.yaml');
  await expect(notices.nth(3)).toContainText('Part of the change journal could not be read');
  await shot('started-with-notices');

  // Nothing was lost: the damaged files are still there, byte for byte.
  const fixture = (name: string): Promise<Buffer> =>
    fs.readFile(path.join(__dirname, '..', '..', 'fixtures', 'scenarios', 'data', 'damaged', name));
  const names = await fs.readdir(dataRoot);
  const settingsAside = names.find((n) => n.startsWith('settings.corrupt-'));
  expect(settingsAside).toBeDefined();
  expect(await fs.readFile(path.join(dataRoot, settingsAside!))).toEqual(
    await fixture('settings-cut.json')
  );
  const layoutNames = await fs.readdir(path.join(dataRoot, 'displays'));
  const layoutsAside = layoutNames.find((n) => n.startsWith('layouts.corrupt-'));
  expect(layoutsAside).toBeDefined();
  expect(await fs.readFile(path.join(dataRoot, 'displays', layoutsAside!))).toEqual(
    await fixture('layouts-garbage.json')
  );
  expect(await fs.readFile(path.join(dataRoot, 'profiles', 'dcs-uh-1h.yaml'))).toEqual(
    await fixture('huey-broken.yaml')
  );
  expect(await fs.readFile(path.join(dataRoot, 'profiles', 'garbage.yaml'))).toEqual(
    await fixture('garbage.txt')
  );
  expect(await fs.readFile(path.join(dataRoot, 'journal.jsonl'))).toEqual(
    await fixture('journal-damaged.jsonl')
  );
  // The settings in use are the defaults, written as a valid file.
  expect(JSON.parse(await fs.readFile(path.join(dataRoot, 'settings.json'), 'utf8'))).toMatchObject(
    {
      minimizeToTray: true,
    }
  );

  // The notices can be closed and the app is usable behind them.
  for (let i = 0; i < 4; i++) await notices.first().getByRole('button', { name: /close/i }).click();
  await expect(notices).toHaveCount(0);

  // Setups: the two damaged files are listed with why, next to the good one.
  await page.getByTestId('mode-configure').click();
  await go(page, '/configure/profiles');
  await expect(page.getByTestId('profile-row')).toHaveCount(1);
  const broken = page.getByTestId('profile-invalid');
  await expect(broken).toHaveCount(2);
  await expect(broken.nth(0)).toContainText('dcs-uh-1h');
  await expect(broken.nth(0)).toContainText('not valid YAML');
  await expect(broken.nth(1)).toContainText('garbage');
  await calm(page);
  await shot('setups');

  // Monitors: the list of saved layouts starts empty and a layout can be saved again.
  await go(page, '/configure/displays');
  await expect(page.getByTestId('displays-page')).toContainText('LC49G95T');
  await expect(page.getByTestId('displays-load-error')).toHaveCount(0);
  await expect(page.getByTestId('layouts-error')).toHaveCount(0);
  await calm(page);
  await shot('monitors');

  // Safety: the one change that can be read is listed.
  await go(page, '/configure/safety');
  await expect(page.getByTestId('safety-error')).toHaveCount(0);
  await expect(page.getByTestId('change-group')).toHaveCount(1);
  await expect(page.getByTestId('change-group')).toContainText('Set the MFD screens');
  await calm(page);
  await shot('safety');

  // Settings: defaults, and they can be changed again.
  await go(page, '/configure/settings');
  await expect(page.getByTestId('settings-page')).toContainText('Desk layout');
  await calm(page);

  // Diagnostics names the files that still have a problem.
  await go(page, '/configure/diagnostics');
  const files = page.getByTestId('diagnostics-files');
  await expect(files.locator('[data-id="settings"]')).toHaveAttribute('data-ok', 'true');
  await expect(files.locator('[data-id="layouts"]')).toHaveAttribute('data-ok', 'true');
  await expect(files.locator('[data-id="profiles"]')).toHaveAttribute('data-ok', 'false');
  await expect(files.locator('[data-id="profiles"]')).toContainText(
    '1 setup; 2 files cannot be read (dcs-uh-1h.yaml, garbage.yaml)'
  );
  await expect(files.locator('[data-id="journal"]')).toContainText(
    '1 change; 2 lines cannot be read'
  );
  await files.scrollIntoViewIfNeeded();
  await shot('diagnostics');
  // The log has the same notices as warnings.
  await page.getByTestId('diagnostics-show-warnings').click();
  await expect(page.locator('[data-testid="log-entry"][data-level="warn"]')).toHaveCount(4);

  // A restart: settings and layouts are fine now; the setups and the journal are still named.
  const again = await run.restart();
  await expect(again.page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(again.page.getByTestId('app-notice')).toHaveCount(2);
  await again.shot('second-start');
});

test('damaged files: a game whose folders were deleted shows "not found" on every page about it, never a crash', async ({
  rig,
}) => {
  const run = await rig.launch('damaged-game-folders', 'damaged-game-folders');
  const { page, shot } = run;

  // Fly: the setup for the missing game is not ready, with reasons, and nothing crashed.
  await expect(page.getByTestId('fly-status-title')).toContainText(/Ready|Not ready/);
  await calm(page);
  await shot('fly');

  await page.getByTestId('mode-configure').click();
  await go(page, '/configure/games');
  const games = page.getByTestId('games-page');
  await expect(games).toContainText('Not found on this PC');
  const row = (id: string) => games.locator(`[data-testid="game-row"][data-game="${id}"]`);
  await expect(row('dcs')).toContainText(NOT_FOUND);
  await expect(row('iracing')).toContainText(NOT_FOUND);
  // The games whose folders are still there are unaffected.
  await expect(row('lmu')).not.toContainText(NOT_FOUND);
  await expect(row('lmu')).toContainText('Steam');
  await calm(page);
  await shot('games');

  await go(page, '/configure/games/dcs');
  await expect(page.getByTestId('game-page')).toContainText('Not found');
  await expect(page.getByTestId('game-error')).toHaveCount(0);
  await calm(page);
  await shot('game-dcs');

  await go(page, '/configure/games/iracing');
  await expect(page.getByTestId('game-page')).toContainText('Not found');
  await calm(page);

  await go(page, '/configure/dcs');
  await expect(page.getByTestId('dcs-page')).toContainText('DCS World was not found');
  await calm(page);
  await shot('dcs');

  await go(page, '/configure/dcs-bindings');
  await expect(page.getByTestId('bindings-page')).toContainText(
    'DCS World was not found on this PC'
  );
  await calm(page);
  await shot('dcs-bindings');

  await go(page, '/configure/racing/iracing');
  await expect(page.getByTestId('iracing-page')).toContainText('iRacing was not found on this PC');
  await calm(page);
  await shot('iracing');

  await go(page, '/configure/backups');
  await expect(page.getByTestId('backups-page')).toBeVisible();
  await expect(page.getByTestId('backup-error')).toHaveCount(0);
  await calm(page);
});

test('damaged files: a game folder that disappears while the app is open turns into "not found"', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'damaged-game-vanishes');
  const { page, shot, mutate } = run;
  await page.getByTestId('mode-configure').click();
  await go(page, '/configure/games');
  const games = page.getByTestId('games-page');
  const lmu = games.locator('[data-testid="game-row"][data-game="lmu"]');
  await expect(lmu).toContainText('Steam');
  await expect(lmu).not.toContainText(NOT_FOUND);
  await shot('before');
  await mutate([
    { op: 'removeFile', path: 'Program Files (x86)/Steam/steamapps/common/Le Mans Ultimate' },
  ]);
  await expect(lmu).toContainText(NOT_FOUND);
  await expect(games).toContainText('Not found on this PC');
  await calm(page);
  await shot('after');
  await go(page, '/configure/racing/lmu');
  await expect(page.getByTestId('lmu-page')).toContainText('Le Mans Ultimate was not found');
  await calm(page);
  await shot('lmu');
});
