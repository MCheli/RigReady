import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { ElectronApplication, Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/**
 * A PC that is not the owner's (fixtures/rigs/generic-rig): one joystick, one monitor, no
 * sim, no wheel, no Stream Deck, no TrackIR, no HidHide. Nothing may assume the owner's rig.
 */

interface ConfigurePage {
  name: string;
  route: string;
  testId: string;
  /** What the page must say on this PC. */
  says: string[];
  /** What it must not say. */
  never?: string[];
  /**
   * The game the page is about, which this PC does not have: the page says so with the
   * shared empty state (what is missing, where RigReady looked, what to do).
   */
  notFound?: string;
}

/** Every Configure page and sub-page. */
const PAGES: ConfigurePage[] = [
  {
    name: 'setups',
    route: '/configure/profiles',
    testId: 'profiles-page',
    says: ['No setups yet'],
  },
  {
    name: 'capture',
    route: '/configure/profiles/capture',
    testId: 'capture-page',
    says: [
      'Logitech Extreme 3D',
      'BenQ GW2480: 1920x1080 at 0,0, main',
      'Speakers (Realtek(R) Audio)',
    ],
    never: ['WINWING', 'TrackIR', 'Fanatec', 'DCS'],
  },
  {
    name: 'games',
    route: '/configure/games',
    testId: 'games-page',
    says: ['Not found on this PC'],
  },
  {
    name: 'game-dcs',
    route: '/configure/games/dcs',
    testId: 'game-page',
    says: ['DCS World was not found on this PC'],
    notFound: 'DCS World',
  },
  {
    name: 'game-iracing',
    route: '/configure/games/iracing',
    testId: 'game-page',
    says: ['iRacing was not found on this PC', 'Choose folder'],
    notFound: 'iRacing',
  },
  {
    name: 'backups',
    route: '/configure/backups',
    testId: 'backups-page',
    says: ['No backups yet'],
  },
  {
    name: 'dcs',
    route: '/configure/dcs',
    testId: 'dcs-page',
    says: [
      'DCS World was not found on this PC',
      'RigReady looked in every Steam library, the standalone install folders and Saved Games\\DCS.',
      'Install DCS World and start it once',
    ],
    notFound: 'DCS World',
  },
  {
    name: 'dcs-screens',
    route: '/configure/dcs/screens',
    testId: 'dcs-page',
    says: [
      'DCS World was not found on this PC',
      'RigReady looked in every Steam library, the standalone install folders and Saved Games\\DCS.',
      'Install DCS World and start it once',
    ],
    notFound: 'DCS World',
  },
  {
    name: 'dcs-export',
    route: '/configure/dcs/export',
    testId: 'dcs-page',
    says: [
      'DCS World was not found on this PC',
      'RigReady looked in every Steam library, the standalone install folders and Saved Games\\DCS.',
      'Install DCS World and start it once',
    ],
    notFound: 'DCS World',
  },
  {
    name: 'dcs-simapppro',
    route: '/configure/dcs/simapppro',
    testId: 'dcs-page',
    says: [
      'DCS World was not found on this PC',
      'RigReady looked in every Steam library, the standalone install folders and Saved Games\\DCS.',
      'Install DCS World and start it once',
    ],
    notFound: 'DCS World',
    // Nothing of the page that needs DCS: no comparison table, no setups, no managed files.
    never: ['What RigReady does instead', 'What still needs SimAppPro running', 'wwtMonitor.lua'],
  },
  {
    name: 'share',
    route: '/configure/share',
    testId: 'share-page',
    says: ['There are no setups to share yet'],
  },
  {
    name: 'dcs-bindings',
    route: '/configure/dcs-bindings',
    testId: 'bindings-page',
    says: [
      'DCS World was not found on this PC',
      'RigReady looked in every Steam library, the standalone install folders and Saved Games\\DCS.',
      'Install DCS World and start it once',
    ],
    notFound: 'DCS World',
  },
  {
    name: 'racing',
    route: '/configure/racing',
    testId: 'racing-page',
    says: ['No Fanatec wheel base on this PC', 'Not found on this PC'],
    never: ['presets you recorded'],
  },
  {
    name: 'racing-iracing',
    route: '/configure/racing/iracing',
    testId: 'iracing-page',
    says: ['iRacing was not found on this PC', 'iRacing game page'],
    notFound: 'iRacing',
  },
  {
    name: 'racing-lmu',
    route: '/configure/racing/lmu',
    testId: 'lmu-page',
    says: ['Le Mans Ultimate was not found on this PC', 'Le Mans Ultimate game page'],
    notFound: 'Le Mans Ultimate',
  },
  {
    name: 'racing-beamng',
    route: '/configure/racing/beamng',
    testId: 'beamng-page',
    says: ['BeamNG.drive was not found on this PC', 'BeamNG.drive game page'],
    never: ['uses its defaults'],
    notFound: 'BeamNG.drive',
  },
  {
    name: 'racing-ac',
    route: '/configure/racing/assetto-corsa',
    testId: 'ac-page',
    says: ['Assetto Corsa was not found on this PC', 'Assetto Corsa game page'],
    notFound: 'Assetto Corsa',
  },
  {
    name: 'wheel',
    route: '/configure/racing/wheel',
    testId: 'wheel-page',
    says: ['No Fanatec wheel base on this PC', 'Not installed'],
  },
  {
    name: 'devices',
    route: '/configure/devices',
    testId: 'devices-page',
    says: ['Logitech Extreme 3D', 'HidHide is not installed'],
  },
  {
    name: 'devices-test',
    route: '/configure/devices/test',
    testId: 'tester-page',
    says: ['Logitech Extreme 3D', '4 axes · 12 buttons · 1 hat'],
  },
  {
    name: 'devices-health',
    route: '/configure/devices/health',
    testId: 'health-page',
    says: ['Start the 10-second check'],
  },
  {
    name: 'devices-usb',
    route: '/configure/devices/usb',
    testId: 'usb-page',
    says: ['3 devices and 1 hub ·', 'USB Optical Mouse'],
  },
  {
    name: 'monitors',
    route: '/configure/displays',
    testId: 'displays-page',
    says: ['BenQ GW2480', '1920x1080 at 0,0'],
  },
  {
    name: 'audio',
    route: '/configure/audio',
    testId: 'audio-page',
    says: ['Speakers (Realtek(R) Audio)', 'Microphone (Realtek(R) Audio)'],
  },
  {
    name: 'stream-deck',
    route: '/configure/stream-deck',
    testId: 'stream-deck-page',
    says: ['Not installed', 'Install the Stream Deck app'],
  },
  {
    name: 'stream-deck-setup',
    route: '/configure/stream-deck/setup',
    testId: 'sd-setup-page',
    says: ['0 of 6 done'],
  },
  {
    name: 'trackir',
    route: '/configure/trackir',
    testId: 'trackir-page',
    says: ['Install TrackIR', 'No TrackIR profiles found'],
  },
  {
    name: 'settings',
    route: '/configure/settings',
    testId: 'settings-page',
    says: ['Desk layout'],
  },
  {
    name: 'safety',
    route: '/configure/safety',
    testId: 'safety-page',
    says: ['RigReady has not changed any of your files'],
  },
  // Added after the others so the numbered screenshots of the pages above keep their names.
  {
    name: 'ai-assist',
    route: '/configure/ai-assist',
    testId: 'ai-guide-page',
    says: ['DCS World was not found on this PC'],
  },
  {
    name: 'diagnostics',
    route: '/configure/diagnostics',
    testId: 'diagnostics-page',
    says: [
      'None of the games RigReady knows were found on this PC',
      'Logitech Extreme 3D',
      'BenQ GW2480: 1920x1080 at 0,0, main',
    ],
  },
  // Last, so the screenshots of the pages above keep their numbers.
  {
    name: 'cheat-sheets',
    route: '/configure/cheat-sheets',
    testId: 'cheat-sheets-page',
    says: ['No game whose bindings RigReady can read was found on this PC'],
    never: ['WINWING', 'F/A-18C'],
  },
  {
    name: 'cheat-sheets-learn',
    route: '/configure/cheat-sheets/learn',
    testId: 'trainer-page',
    says: [
      'No game whose bindings RigReady can read was found on this PC',
      'there is nothing to ask yet',
    ],
    never: ['WINWING', 'F/A-18C', 'Start a round'],
  },
];

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

test('generic rig: every Configure page renders an honest empty state, never an error', async ({
  rig,
}) => {
  test.setTimeout(240_000);
  const { page, shot } = await rig.launch('generic-fresh', 'generic-configure');
  await expect(page.getByTestId('fly-empty')).toContainText('No setups yet');
  await shot('fly-no-setups');

  await page.getByTestId('mode-configure').click();
  // Every page the navigation offers is in the list above.
  const links = page.getByTestId('configure-nav').locator('a');
  await expect(links).toHaveCount(18);
  const offered = await links.evaluateAll((all) =>
    all.map((a) => (a.getAttribute('href') ?? '').replace(/^#/, ''))
  );
  expect(offered.filter((route) => !PAGES.some((p) => p.route === route))).toEqual([]);

  for (const entry of PAGES) {
    await go(page, entry.route);
    const root = page.getByTestId(entry.testId);
    await expect(root, entry.name).toBeVisible();
    for (const text of entry.says) await expect(root, entry.name).toContainText(text);
    for (const text of entry.never ?? []) await expect(root, entry.name).not.toContainText(text);
    if (entry.notFound) {
      // One wording on every page: what is missing, where RigReady looked, what to do.
      await expect(root.getByTestId('not-here-title'), entry.name).toHaveText(
        `${entry.notFound} was not found on this PC`
      );
      await expect(root.getByTestId('not-here-looked'), entry.name).toContainText(
        /RigReady looked in .+\./
      );
      await expect(root.getByTestId('not-here-next'), entry.name).toContainText(
        `Install ${entry.notFound} and start it once; this page then fills in by itself.`
      );
    }
    await expect(page.locator(BUSY), entry.name).toHaveCount(0);
    // No error alert, on any page.
    await expect(page.locator('[data-testid$="-error"]'), entry.name).toHaveCount(0);
    await expect(page.locator('.v-alert.text-error, .v-alert.bg-error'), entry.name).toHaveCount(0);
    await shot(entry.name);
  }
});

test('generic rig: capture proposes the stick, the monitor and the audio devices; the setup is Ready', async ({
  rig,
}) => {
  const { page, shot, mutate, dataRoot } = await rig.launch('generic-fresh', 'generic-capture');
  await page.getByTestId('fly-create').click();
  const capture = page.getByTestId('capture-page');
  await expect(candidate(page, 'Logitech Extreme 3D').getByRole('checkbox')).toBeChecked();
  // Keyboards and mice are one click away, and not kept.
  await expect(candidate(page, 'USB Keyboard')).toHaveCount(0);
  await page.getByTestId('capture-more-devices').click();
  await expect(candidate(page, 'USB Keyboard').getByRole('checkbox')).not.toBeChecked();
  await expect(candidate(page, 'Monitor layout').getByRole('checkbox')).toBeChecked();
  await expect(capture.getByTestId('capture-group-displays')).toContainText(
    'BenQ GW2480: 1920x1080 at 0,0, main'
  );
  await expect(
    candidate(page, 'Sound output: Speakers (Realtek(R) Audio)').getByRole('checkbox')
  ).toBeChecked();
  await expect(
    candidate(page, 'Microphone: Microphone (Realtek(R) Audio)').getByRole('checkbox')
  ).toBeChecked();
  // Only games found on this PC are offered, and none is.
  await expect(page.getByTestId('capture-game').getByRole('radio')).toHaveText([
    /Another game/,
    /No game/,
  ]);
  await expect(page.getByTestId('capture-no-games')).toContainText('No game RigReady knows');
  await expect(page.getByTestId('capture-save')).toBeDisabled();
  await page.getByTestId('capture-name').locator('input').fill('Space sim');
  await expect(page.getByTestId('capture-summary')).toContainText('4 checks');
  await shot('capture');
  await capture.getByTestId('capture-group-audio').scrollIntoViewIfNeeded();
  await shot('capture-audio');

  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('profile-switcher')).toContainText('Space sim');
  await expect(page.getByTestId('group-devices')).toContainText('1 of 1 OK');
  await expect(page.getByTestId('group-displays')).toContainText('1 of 1 OK');
  await expect(page.getByTestId('group-audio')).toContainText('2 of 2 OK');
  await shot('ready');
  const saved = await fs.readFile(path.join(dataRoot, 'profiles', 'space-sim.yaml'), 'utf8');
  expect(saved).toContain('vendorId: 046D');
  expect(saved).not.toMatch(/4098|WINWING|DCS/);

  // The stick is unplugged while the screen is open, then plugged back in.
  await mutate([{ op: 'unplugDevice', match: { vendorId: '046D', productId: 'C215' } }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(checkRow(page, 'Logitech Extreme 3D')).toHaveAttribute('data-status', 'fail');
  await shot('stick-unplugged');
  await mutate([{ op: 'plugDevice', match: { vendorId: '046D', productId: 'C215' } }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
});

test('generic rig: an "Other" game is set up, checked, launched and its tracked folder backed up', async ({
  rig,
}) => {
  const run = await rig.launch('generic-custom-game', 'generic-custom-game');
  const { page, shot, app, home, dataRoot } = run;
  const exe = path.join(home, 'Games', 'Star Hauler', 'StarHauler.exe');

  // An "Other" setup: the user names the game and the program Launch starts.
  await page.getByTestId('fly-create').click();
  await page.getByTestId('capture-game-other').click();
  await page.getByTestId('capture-game-name').locator('input').fill('Star Hauler');
  // The setup is named after the game until the user names it.
  await expect(page.getByTestId('capture-name').locator('input')).toHaveValue('Star Hauler');
  await page.getByTestId('capture-launch-exe').locator('input').fill(exe);
  await page.getByTestId('capture-launch-args').locator('input').fill('-fullscreen');
  await expect(page.getByTestId('capture-game-name').locator('input')).toHaveValue('Star Hauler');
  // Back to the top of the page, where the game and its program are.
  await page.getByTestId('capture-page').locator('.rr-page-title').scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -2000);
  await expect(page.getByTestId('capture-page').locator('.rr-page-title')).toBeInViewport();
  await shot('other-game');
  await page.getByTestId('capture-save').click();

  // Checks.
  await expect(page.getByTestId('profile-switcher')).toContainText('Star Hauler');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('group-toggle-devices').click();
  await expect(checkRow(page, 'Logitech Extreme 3D')).toHaveAttribute('data-status', 'pass');
  await shot('ready');
  const saved = await fs.readFile(path.join(dataRoot, 'profiles', 'star-hauler.yaml'), 'utf8');
  expect(saved).toContain('game: other');
  expect(saved).toContain('gameName: Star Hauler');

  // Launch starts the program and RigReady gets out of the way.
  await expect(page.getByTestId('launch')).toBeEnabled();
  await page.getByTestId('launch').click();
  await expect.poll(() => windowVisible(app)).toBe(false);
  await showWindow(app);
  await expect(page.getByTestId('fly-activity')).toContainText('Launched StarHauler.exe');
  await shot('launched');

  // The setup list names the game the user typed.
  await page.getByTestId('mode-configure').click();
  await expect(page.getByTestId('profile-row')).toContainText('Star Hauler');
  await shot('setups');

  // Track the game's folder for this setup, with a preview, and back it up.
  await page.getByTestId('nav-backups').click();
  await page.getByTestId('backups-tab-tracked').click();
  await page.getByTestId('tracked-scope-star-hauler').click();
  await page.getByTestId('tracked-add').click();
  const editor = page.getByTestId('item-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('item-label').locator('input').fill('Star Hauler settings and saves');
  await editor.getByTestId('item-path').locator('input').fill('{DOCUMENTS}/Star Hauler');
  await expect(editor.getByTestId('item-preview-count')).toContainText('3 files');
  await shot('track-folder');
  await editor.getByTestId('item-save').click();
  const tracked = page.locator(
    '[data-testid="tracked-item"][data-label="Star Hauler settings and saves"]'
  );
  await expect(tracked).toContainText('3 files');
  await shot('tracked');

  await page.getByTestId('backups-tab-backups').click();
  await expect(page.getByTestId('backup-summary')).toContainText('1 setup and 1 tracked item');
  await page.getByTestId('backup-all').click();
  await expect(page.getByTestId('backup-outcome-title')).toContainText('Backed up');
  await expect(page.getByTestId('backup-row')).toHaveCount(1);
  await page.getByTestId('backup-toggle').click();
  await expect(page.getByTestId('backup-contents')).toContainText('Star Hauler settings and saves');
  await shot('backed-up');

  const dir = path.join(dataRoot, 'backups');
  const [name] = (await fs.readdir(dir)).filter((f) => f.endsWith('.zip'));
  const entries = Object.keys(unzipSync(new Uint8Array(await fs.readFile(path.join(dir, name!)))));
  expect(entries).toContain('rigready/profiles/star-hauler.yaml');
  for (const file of ['settings.ini', 'controls.cfg', 'saves/slot1.sav']) {
    expect(
      entries.some((e) => e.endsWith(`/${file}`)),
      file
    ).toBe(true);
  }
});
