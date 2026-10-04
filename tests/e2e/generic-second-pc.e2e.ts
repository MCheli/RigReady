import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * NFR-009: the core flows on a second PC that is not the owner's
 * (fixtures/scenarios/generic-second-pc.yaml): two monitors, two sticks of other makes, DCS
 * World in a second Steam library, Saved Games moved out of its default place.
 *
 * The capture page is driven only through its stable test ids (capture-page, capture-name,
 * capture-save, capture-candidate with data-title, capture-group-<group>).
 */

/** Something still loading. */
const BUSY =
  '.v-progress-circular--indeterminate:visible, .v-progress-linear--active:visible, .v-skeleton-loader:visible';

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

const candidate = (page: Page, title: string) =>
  page.locator(`[data-testid="capture-candidate"][data-title="${title}"]`);
const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
const showWindow = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());

/** Calls an IPC channel from the page, as the renderer does. */
const invokeIn = <T>(page: Page, channel: string, input?: unknown): Promise<T> =>
  page
    .evaluate(
      ([name, payload]) =>
        (
          globalThis as unknown as {
            rigready: { invoke(c: string, i: unknown): Promise<unknown> };
          }
        ).rigready.invoke(name as string, payload),
      [channel, input] as const
    )
    .then((envelope) => {
      const result = envelope as { ok: boolean; value?: T; error?: { message: string } };
      if (!result.ok) throw new Error(`${channel}: ${result.error?.message}`);
      return result.value as T;
    });

/** Every route the feature manifests registered, read from the running app's router. */
const routesOf = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const scope = globalThis as unknown as {
      document: {
        querySelector(selector: string): {
          __vue_app__: {
            config: { globalProperties: { $router: { getRoutes(): { path: string }[] } } };
          };
        };
      };
    };
    return scope.document
      .querySelector('#app')
      .__vue_app__.config.globalProperties.$router.getRoutes()
      .map((route) => route.path);
  });

test('second generic PC: capture, Ready, Make ready, Launch from the second Steam library, Stand down', async ({
  rig,
}) => {
  const run = await rig.launch('generic-second-pc', 'generic-second-pc');
  const { page, shot, app, home, dataRoot, mutate } = run;
  await page.getByTestId('mode-configure').click();
  await go(page, '/configure/profiles/capture');
  const capture = page.getByTestId('capture-page');
  await expect(capture).toBeVisible();
  // What is here is offered: both sticks, both monitors. Nothing of the owner's rig.
  await expect(candidate(page, 'Logitech Extreme 3D')).toBeVisible();
  await expect(candidate(page, 'T.16000M')).toBeVisible();
  await expect(capture.getByTestId('capture-group-displays')).toContainText('BenQ GW2480');
  await expect(capture.getByTestId('capture-group-displays')).toContainText('AOC Q27G2');
  await expect(capture).not.toContainText(/WINWING|USB_Monitor|LC49G95T|TrackIR/);
  const discord = page.locator('[data-testid="capture-candidate"][data-title*="Discord"]');
  await discord.getByRole('checkbox').check();
  await page.getByTestId('capture-name').locator('input').fill('DCS second PC');
  await shot('capture');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('ready');

  // The setup file, edited by hand as a user may: DCS as the game to launch, from wherever
  // it is installed on this PC, and Discord closed again at Stand down.
  const file = path.join(dataRoot, 'profiles', 'dcs-second-pc.yaml');
  const saved = await fs.readFile(file, 'utf8');
  expect(saved).not.toMatch(/4098|WINWING|USB_Monitor/);
  expect(saved).toContain('vendorId: 044F');
  expect(saved).toContain('name: Discord.exe');
  const edited = saved
    .replace(/^launch:\r?\n(?:[ \t]+.*\r?\n)*/m, '')
    .replace(/^game: .*\r?\n/m, '')
    .replace(/^steamAppId: .*\r?\n/m, '')
    .replace(/^(\s*)name: Discord\.exe$/m, '$1name: Discord.exe\n$1stopOnStandDown: true');
  await fs.writeFile(
    file,
    `${edited.trimEnd()}\ngame: dcs\nlaunch:\n  exe: '{DCS_INSTALL}/bin/DCS.exe'\n  args: []\n`
  );
  await expect(page.getByTestId('launch')).toBeEnabled();

  // Discord is closed and the second monitor moved: two things for Make ready.
  await mutate([
    { op: 'stopProcess', name: 'Discord.exe' },
    { op: 'setDisplay', match: { name: 'AOC Q27G2' }, set: { x: 0, y: 1080 } },
  ]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('not-ready');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('made-ready');

  await page.getByTestId('launch').click();
  await expect.poll(() => windowVisible(app)).toBe(false);
  await showWindow(app);
  await expect(page.getByTestId('fly-activity')).toContainText('Launched DCS.exe');
  // From the second library, not from a default path.
  const view = await invokeIn<{ installs: { installDir: string; source: string }[] }>(
    page,
    'games:get',
    { gameId: 'dcs' }
  );
  expect(view.installs.map((i) => [i.installDir, i.source])).toEqual([
    [path.join(home, 'Games', 'SteamLibrary', 'steamapps', 'common', 'DCSWorld'), 'steam'],
  ]);
  await shot('launched');

  // The game is still running: Stand down asks before touching it, and leaves it alone.
  await page.getByTestId('stand-down').click();
  await expect(page.getByTestId('game-running')).toContainText('DCS.exe is still running');
  await page.getByTestId('game-leave').click();
  await expect(page.getByTestId('fly-activity')).toContainText('Closed Discord.exe');
  await expect(page.getByTestId('fly-activity')).not.toContainText('Closed DCS.exe');
  await shot('stood-down');
});

test('second generic PC: every Configure page renders; DCS, monitors and devices are this PC’s own', async ({
  rig,
}) => {
  test.setTimeout(240_000);
  const { page, shot, home } = await rig.launch('generic-second-pc', 'generic-second-pc-pages');
  await page.getByTestId('mode-configure').click();
  await expect(page.getByTestId('configure-nav').locator('a').first()).toBeVisible();
  // Every page of every feature that a link can open directly.
  const routes = [
    ...new Set((await routesOf(page)).map((r) => r.replace(/\/:[^/]+\?/g, ''))),
  ].filter((r) => r.startsWith('/configure/') && !r.includes(':') && !r.includes('*'));
  expect(routes.length).toBeGreaterThan(25);
  for (const route of routes) {
    await go(page, route);
    await expect
      .poll(() =>
        page.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash)
      )
      .toBe(`#${route}`);
    await expect(page.locator('.rr-page').first(), route).toBeVisible();
    await expect(page.locator(BUSY), route).toHaveCount(0);
    await expect(page.getByText('There is nothing at this address.'), route).toHaveCount(0);
    await expect(page.locator('[data-testid$="-error"]'), route).toHaveCount(0);
    await expect(page.locator('.v-alert.text-error, .v-alert.bg-error'), route).toHaveCount(0);
    // Nothing of the owner's rig on any page.
    await expect(page.locator('.rr-page').first(), route).not.toContainText(
      /WINWING|USB_Monitor|LC49G95T|DELL G3223D|T-Pendular/
    );
  }
  const library = path.join(home, 'Games', 'SteamLibrary', 'steamapps', 'common', 'DCSWorld');
  await go(page, '/configure/games/dcs');
  await expect(page.getByTestId('game-page')).toContainText(library);
  await shot('dcs-found');
  await go(page, '/configure/displays');
  await expect(page.getByTestId('displays-page')).toContainText('BenQ GW2480');
  await expect(page.getByTestId('displays-page')).toContainText('AOC Q27G2');
  await shot('monitors');
  await go(page, '/configure/devices');
  await expect(page.getByTestId('devices-page')).toContainText('T.16000M');
  await shot('devices');
  // Bindings: DCS is found, and its folder holds no aircraft module: an empty state, no error.
  await go(page, '/configure/dcs-bindings');
  await expect(page.getByTestId('bindings-page')).toBeVisible();
  await expect(page.getByTestId('bindings-page')).not.toContainText('was not found on this PC');
  await shot('bindings');
});

test('second generic PC: backup and restore in the moved Saved Games folder; a setup shared and imported', async ({
  rig,
}) => {
  const run = await rig.launch('generic-second-pc', 'generic-second-pc-backup', {
    dialogs: {
      save: ['Documents/second-pc.rigready'],
      open: [['Documents/second-pc.rigready']],
    },
  });
  const { page, shot, home, dataRoot } = run;
  const profile = await invokeIn<{ id: string }>(page, 'profiles:create', {
    name: 'DCS second PC',
    game: 'dcs',
    checks: [],
  });
  await page.getByTestId('mode-configure').click();

  // Track DCS's settings (they are in the moved folder) and back them up, in the app.
  await go(page, '/configure/backups');
  await page.getByTestId('backups-tab-tracked').click();
  await page.getByTestId(`tracked-scope-${profile.id}`).click();
  await page.getByTestId('tracked-add').click();
  const editor = page.getByTestId('item-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('item-label').locator('input').fill('DCS settings and bindings');
  await editor.getByTestId('item-path').locator('input').fill('{DCS_USER}/Config');
  await expect(editor.getByTestId('item-preview-count')).toContainText('2 files');
  await shot('track');
  await editor.getByTestId('item-save').click();
  await page.getByTestId('backups-tab-backups').click();
  await page.getByTestId('backup-all').click();
  await expect(page.getByTestId('backup-outcome-title')).toContainText('Backed up');
  await expect(page.getByTestId('backup-row')).toHaveCount(1);
  await shot('backed-up');
  const [archive] = (await fs.readdir(path.join(dataRoot, 'backups'))).filter((f) =>
    f.endsWith('.zip')
  );
  const names = Object.keys(
    unzipSync(new Uint8Array(await fs.readFile(path.join(dataRoot, 'backups', archive!))))
  );
  expect(names.some((n) => n.endsWith('/options.lua'))).toBe(true);
  expect(names.some((n) => n.includes('T.16000M'))).toBe(true);

  // A changed file is put back where it lives on this PC: the moved Saved Games folder.
  const options = path.join(home, 'Data', 'Saved Games', 'DCS', 'Config', 'options.lua');
  const before = await fs.readFile(options, 'utf8');
  await fs.writeFile(options, 'options = {}\n');
  const preview = await invokeIn<{
    items: { files: { ref: string; relativePath: string; status: string }[] }[];
  }>(page, 'backup:previewRestore', { id: archive });
  const changed = preview.items.flatMap((i) => i.files).filter((f) => f.status === 'different');
  expect(changed.map((f) => f.relativePath)).toEqual(['options.lua']);
  await invokeIn(page, 'backup:restore', {
    id: archive,
    choices: Object.fromEntries(changed.map((f) => [f.ref, 'overwrite'])),
  });
  expect(await fs.readFile(options, 'utf8')).toBe(before);
  await go(page, '/configure/safety');
  // The restore is on the Safety page as one action that can be undone.
  await expect(page.getByTestId('safety-page')).toContainText('Restore backup');
  await expect(page.getByTestId('safety-page')).toContainText('1 file');
  await shot('restored');

  // Share the setup with its bindings, then import the file (as a second setup).
  const review = await invokeIn<{ items: unknown[] }>(page, 'sharing:prepare', {
    profileId: profile.id,
    includeItems: ['dcs-settings-and-bindings'],
  });
  expect(review.items.length).toBeGreaterThan(0);
  const exported = await invokeIn<{ path: string } | null>(page, 'sharing:export', {
    profileId: profile.id,
    includeItems: ['dcs-settings-and-bindings'],
    notes: 'From the second PC',
    reviewed: true,
  });
  expect(exported?.path).toBe(path.join(home, 'Documents', 'second-pc.rigready'));
  const shared = await fs.readFile(exported!.path);
  // Not this PC's folders.
  expect(shared.includes(Buffer.from(home))).toBe(false);
  const report = await invokeIn<{
    importId: string;
    parts: { id: string; importable: boolean }[];
  }>(page, 'sharing:openImport');
  await invokeIn(page, 'sharing:import', {
    importId: report.importId,
    parts: report.parts.filter((p) => p.importable).map((p) => p.id),
    conflict: 'keepBoth',
  });
  await go(page, '/configure/profiles');
  await expect(page.getByTestId('profile-row')).toHaveCount(2);
  await shot('imported');
});
