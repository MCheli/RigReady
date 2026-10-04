import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import * as yaml from 'js-yaml';
import { checkRow, expect, test } from './harness';

/** Configure mode: create a setup by capturing the rig as it is, then find it in Fly. */

const candidate = (page: Page, title: string) =>
  page.locator(`[data-testid="capture-candidate"][data-title="${title}"]`);
const section = (page: Page, group: string) => page.getByTestId(`capture-group-${group}`);
/** Scrolls a section to the top of the window, for a screenshot of it. */
const bringUp = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => el.scrollIntoView({ block: 'start' }));

test('first run: welcome, what was found on this PC, and two clicks to a Ready DCS F/A-18C setup', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch('flying-fresh', 'first-run');

  // An empty data root: one screen says what RigReady does and what it found here.
  const welcome = page.getByTestId('fly-empty');
  await expect(welcome).toContainText('Welcome to RigReady');
  await expect(welcome).toContainText('No setups yet');
  await expect(page.getByTestId('welcome-what').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('welcome-games')).toContainText('8 games');
  await expect(page.getByTestId('welcome-games')).toContainText('DCS World');
  await expect(page.getByTestId('welcome-controllers')).toContainText('12 game controllers');
  await expect(page.getByTestId('welcome-monitors')).toContainText('5 monitors');
  await expect(page.getByTestId('welcome-monitors')).toContainText('4 on, 1 off');
  await expect(page.getByTestId('welcome-restore')).toBeVisible();
  await expect(page.getByTestId('welcome-import')).toBeVisible();
  await shot('welcome');

  // User action 1: capture this rig.
  await page.getByTestId('fly-create').click();
  // The rig says what it is for, and the setup is already named and complete.
  await expect(page.getByTestId('capture-game-dcs')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('capture-suggested')).toContainText(
    'The flight gear is connected and DCS World has your bindings'
  );
  // The chosen aircraft is marked the way the page marks it: aria-current on the chip.
  await expect(page.getByTestId('capture-variant-FA-18C_hornet')).toHaveAttribute(
    'aria-current',
    'true'
  );
  await expect(page.getByTestId('capture-name').locator('input')).toHaveValue('DCS F/A-18C');
  const summary = page.getByTestId('capture-summary');
  await expect(summary).toContainText('Launches DCS World, through Steam');
  await expect(page.getByTestId('capture-summary-devices')).toContainText('11 devices');
  await expect(page.getByTestId('capture-summary-apps')).toContainText('3 apps');
  await expect(page.getByTestId('capture-summary-displays')).toContainText('1 monitor layout');
  await expect(page.getByTestId('capture-summary-audio')).toContainText('2 audio devices');
  await expect(page.getByTestId('capture-summary-standdown')).toContainText(
    'Closes SimAppPro, TrackIR software'
  );
  await expect(page.getByTestId('capture-summary-tracked')).toContainText(
    'DCS settings and bindings'
  );
  await shot('capture');

  // User action 2: create it. Back on Fly, Ready.
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect(page.getByTestId('launch')).toBeEnabled();
  await shot('ready');

  // What was written: the flight gear by VID/PID, not the wheel; the Hornet's own checks.
  const saved = yaml.load(
    await fs.readFile(path.join(dataRoot, 'profiles', 'dcs-f-a-18c.yaml'), 'utf8')
  ) as {
    game: string;
    launch: { args: string[] };
    checks: { type: string; title: string; params: Record<string, unknown> }[];
    extensions: { backup: { items: { path: string }[] } };
  };
  expect(saved.game).toBe('dcs');
  expect(saved.launch.args).toEqual(['-applaunch', '223750']);
  const devices = saved.checks.filter((c) => c.type === 'device.connected');
  expect(devices).toHaveLength(11);
  expect(devices.every((c) => /^[0-9A-F]{4}$/.test(String(c.params['vendorId'])))).toBe(true);
  expect(saved.checks.map((c) => c.title)).not.toContain('FANATEC Podium Wheel Base DD2');
  expect(saved.checks.map((c) => c.title)).toContain('DCS bindings match devices (F/A-18C)');
  expect(saved.extensions.backup.items.map((i) => i.path)).toEqual(['{DCS_USER}']);
});

test('a new rig: capture the current state into a setup, which is then Ready', async ({ rig }) => {
  const { page, shot, dataRoot } = await rig.launch('flying-fresh', 'profile-capture');

  await expect(page.getByTestId('fly-empty')).toContainText('No setups yet');
  await shot('empty');
  await page.getByTestId('fly-create').click();

  const capture = page.getByTestId('capture-page');
  await expect(section(page, 'devices')).toContainText('WINWING MFD1-L');
  await expect(section(page, 'displays')).toContainText(
    'USB_Monitor (2 of 3): 768x1024 at 5888,0, rotated 90°'
  );
  // The arrangement is drawn to scale: four monitors on, the Dell listed as off.
  await expect(capture.getByTestId('capture-monitor-box')).toHaveCount(4);
  await expect(capture.getByTestId('capture-monitor-off')).toContainText('DELL G3223D');
  const boxes = await capture
    .getByTestId('capture-monitor-box')
    .evaluateAll((all) =>
      all.map((b) => b.getBoundingClientRect()).map((r) => [r.width, r.height])
    );
  // 5120x1440 beside 768x1024: the ultrawide is 6.67 times as wide, the MFD screens are tall.
  expect(boxes[0]![0]! / boxes[1]![0]!).toBeCloseTo(5120 / 768, 0);
  expect(boxes[1]![1]!).toBeGreaterThan(boxes[1]![0]!);

  // Nothing is saved without a name.
  await page.getByTestId('capture-game-none').click();
  await expect(page.getByTestId('capture-save')).toBeDisabled();
  await page.getByTestId('capture-name').locator('input').fill('DCS F/A-18C');
  await page
    .getByTestId('capture-launch-exe')
    .locator('input')
    .fill('C:\\Program Files (x86)\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe');

  // Known sim helpers come first and are kept already; other apps are the user's choice.
  await expect(candidate(page, 'TrackIR software').getByRole('checkbox')).toBeChecked();
  await expect(candidate(page, 'SimAppPro').getByRole('checkbox')).toBeChecked();
  await expect(section(page, 'apps')).toContainText('3 of');
  await expect(candidate(page, 'Discord').getByRole('checkbox')).not.toBeChecked();
  // Windows and background programs are behind "show all", and a search finds them.
  await expect(candidate(page, 'msedgewebview2')).toHaveCount(0);
  await bringUp(page, 'capture-group-apps');
  await shot('capture-apps');
  await page.getByTestId('capture-more-apps').click();
  await expect(candidate(page, 'msedgewebview2')).toBeVisible();
  await page.getByTestId('capture-more-apps').click();
  await page.getByTestId('capture-app-filter').locator('input').fill('onedrive');
  await expect(candidate(page, 'OneDrive')).toBeVisible();
  // What is kept stays in view whatever the search says.
  await expect(candidate(page, 'SimAppPro')).toBeVisible();
  await expect(candidate(page, 'Discord')).toHaveCount(0);
  await shot('capture-app-search');
  await page.getByTestId('capture-app-filter').locator('input').fill('');

  // Other USB devices are one click away; the Stream Deck is nice to have, not required.
  await expect(candidate(page, 'Stream Deck XL')).toHaveCount(0);
  await page.getByTestId('capture-more-devices').click();
  await candidate(page, 'Stream Deck XL').getByRole('checkbox').check();
  await candidate(page, 'Stream Deck XL').getByTestId('candidate-optional').click();
  await expect(page.getByTestId('capture-summary-devices')).toContainText('12 devices');
  await bringUp(page, 'capture-group-devices');
  await shot('capture');
  await bringUp(page, 'capture-group-displays');
  await shot('capture-monitors');

  await page.getByTestId('capture-save').click();

  // Back on Fly with the new setup active and everything green.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  await expect(page.getByTestId('group-displays')).toContainText('1 of 1 OK');
  await page.getByTestId('group-toggle-devices').click();
  await expect(checkRow(page, 'Stream Deck XL')).toContainText('optional');
  await shot('ready');

  // The setup is a YAML file in the isolated data root, nowhere else.
  const saved = await fs.readFile(path.join(dataRoot, 'profiles', 'dcs-f-a-18c.yaml'), 'utf8');
  expect(saved).toContain('name: DCS F/A-18C');
  expect(saved).toContain('type: process.running');

  // Configure mode: navigation comes from the feature manifests.
  await page.getByTestId('mode-configure').click();
  await expect(page.getByTestId('configure-nav')).toContainText('Setups');
  await expect(page.getByTestId('profile-row')).toContainText('DCS F/A-18C');
  await shot('setups');

  await page.getByTestId('nav-devices').click();
  await expect(page.getByTestId('devices-page')).toContainText('T-Pendular-Rudder');
  await shot('devices');

  await page.getByTestId('nav-displays').click();
  await expect(page.getByTestId('displays-map')).toContainText('USB_Monitor (3 of 3)');
  await expect(page.getByTestId('displays-page')).toContainText('Connected, turned off');
  await shot('monitors');

  await page.getByTestId('nav-games').click();
  await expect(page.getByTestId('games-page')).toContainText('DCS World');

  // Edit: rename, save, and Fly shows the new name.
  await page.getByTestId('nav-profiles').click();
  await page.getByTestId('profile-edit').click();
  await page.getByTestId('edit-name').locator('input').fill('Hornet');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profile-row')).toContainText('Hornet');
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('profile-switcher')).toContainText('Hornet');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // Delete: asked first, then back to the empty state.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('profile-more').click();
  await page.getByTestId('profile-delete').click();
  await expect(page.getByTestId('profile-delete-dialog')).toContainText('Delete "Hornet"?');
  await page.getByTestId('profile-delete-confirm').click();
  await expect(page.getByTestId('profiles-empty')).toBeVisible();
  await expect(page.getByTestId('profiles-message')).toContainText('Safety page can bring it back');
});

test('capture: identical devices are told apart, found by pressing a button, and named for the setup', async ({
  rig,
}) => {
  const { page, shot, sendInput, dataRoot } = await rig.launch('flying-fresh', 'capture-devices');
  await page.getByTestId('fly-create').click();
  const devices = section(page, 'devices');

  // Every game controller with its VID:PID; kept. The wheel is racing gear: listed, not kept.
  await expect(candidate(page, 'WINWING MFD1-L')).toContainText('4098:BEE1');
  await expect(candidate(page, 'WINWING MFD1-L').getByRole('checkbox')).toBeChecked();
  await expect(
    candidate(page, 'FANATEC Podium Wheel Base DD2').getByRole('checkbox')
  ).not.toBeChecked();
  await expect(devices).toContainText('11 of');

  // "Which one is it?": press a button on a device and its row lights up.
  await page.getByTestId('capture-identify').click();
  await expect(page.getByTestId('capture-identified')).toContainText('Press any button');
  const buttons = (down: boolean): boolean[] => [down, ...new Array<boolean>(31).fill(false)];
  const press = async (down: boolean): Promise<void> =>
    sendInput([
      {
        index: 7,
        name: 'WINWING MFD1-L',
        axes: [],
        buttons: buttons(down),
        hats: [],
        timestamp: Date.now(),
      },
    ]);
  await press(false);
  await press(true);
  await expect(page.getByTestId('capture-identified')).toContainText('That was WINWING MFD1-L.');
  await expect(candidate(page, 'WINWING MFD1-L')).toHaveClass(/flash/);

  // A name for this setup: the check is called what the owner calls the device.
  await candidate(page, 'WINWING MFD1-L').getByTestId('candidate-rename').click();
  await page.getByTestId('candidate-title-input').locator('input').fill('Left MFD');
  await page.getByTestId('candidate-title-input').locator('input').press('Enter');
  await expect(candidate(page, 'WINWING MFD1-L')).toContainText('Left MFD');
  await bringUp(page, 'capture-group-devices');
  await shot('identified-and-named');

  // The three identical USB screens and the two identical trackballs are separate rows.
  await page.getByTestId('capture-more-devices').click();
  for (const n of [1, 2, 3]) {
    const row = candidate(page, `WINWING USB 3.0 Display1 (${n} of 3)`);
    await expect(row).toContainText(`(${n} of 3)`);
    await expect(row).toContainText('serial WWIN');
    await row.getByRole('checkbox').check();
  }
  await expect(candidate(page, 'ORBIT WIRELESS TB (1 of 2)')).toContainText(
    'identified by USB port'
  );
  await candidate(page, 'ORBIT WIRELESS TB (1 of 2)').getByRole('checkbox').check();
  await candidate(page, 'WINWING USB 3.0 Display1 (1 of 3)').scrollIntoViewIfNeeded();
  await shot('identical');

  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('group-toggle-devices').click();
  await expect(checkRow(page, 'Left MFD')).toHaveAttribute('data-status', 'pass');
  await shot('ready');

  // Rule 4, read from the file: VID/PID always, serial or port for the identical ones.
  const saved = yaml.load(
    await fs.readFile(path.join(dataRoot, 'profiles', 'dcs-f-a-18c.yaml'), 'utf8')
  ) as { checks: { type: string; title: string; params: Record<string, string> }[] };
  const byTitle = (title: string) => saved.checks.find((c) => c.title === title)!.params;
  expect(byTitle('Left MFD')).toEqual({ vendorId: '4098', productId: 'BEE1' });
  const serials = [1, 2, 3].map((n) => byTitle(`WINWING USB 3.0 Display1 (${n} of 3)`)['serial']);
  expect(new Set(serials).size).toBe(3);
  expect(serials.every((s) => s?.startsWith('WWIN'))).toBe(true);
  expect(byTitle('ORBIT WIRELESS TB (1 of 2)')['instanceId']).toMatch(/^USB\\/);
});

test('capture: the game brings its files to check and to back up; another game brings its own', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch('flying-fresh', 'capture-game-files');
  await page.getByTestId('fly-create').click();
  const page_ = page.getByTestId('capture-page');

  // DCS F/A-18C: its files, its checks, and what to back up.
  await expect(section(page, 'files')).toContainText('DCS bindings match devices (F/A-18C)');
  await expect(section(page, 'files')).toContainText('{DCS_USER}/Config/options.lua');
  await expect(section(page, 'other')).toContainText('DCS World installed');
  const tracked = page.getByTestId('capture-tracked');
  const item = (stored: string) =>
    tracked.locator(`[data-testid="capture-tracked-item"][data-path="${stored}"]`);
  for (const stored of [
    '{DCS_USER}',
    '{DCS_USER}/Config/options.lua',
    '{DCS_USER}/Config/Input/FA-18C_hornet',
    '{DCS_USER}/Scripts/Export.lua',
  ]) {
    await expect(item(stored), stored).toBeVisible();
  }
  await expect(item('{DCS_USER}')).toHaveAttribute('data-kept', 'yes');
  await expect(item('{DCS_USER}/Config/Input/FA-18C_hornet')).toHaveAttribute('data-kept', 'no');
  // Nothing of another game anywhere on the screen, ticked or not.
  for (const other of ['iRacing knows', 'Le Mans Ultimate wheel', 'BeamNG', 'controls.cfg']) {
    await expect(section(page, 'files')).not.toContainText(other);
    await expect(section(page, 'other')).not.toContainText(other);
    await expect(tracked).not.toContainText(other);
  }
  // What helper tools keep is one click away.
  await expect(tracked).not.toContainText('Stream Deck profiles');
  await page.getByTestId('capture-more-tracked').click();
  await expect(tracked).toContainText('Stream Deck profiles');
  await page.getByTestId('capture-more-tracked').click();
  await item('{DCS_USER}/Config/Input/FA-18C_hornet').getByRole('checkbox').check();
  await bringUp(page, 'capture-group-files');
  await shot('dcs-files');
  await bringUp(page, 'capture-tracked');
  await shot('dcs-backup');

  // Without the aircraft, its checks and files go; the game's stay.
  await page.getByTestId('capture-variant-FA-18C_hornet').click();
  await expect(section(page, 'files')).not.toContainText('DCS bindings match devices');
  await expect(item('{DCS_USER}/Config/Input/FA-18C_hornet')).toHaveCount(0);
  await expect(page.getByTestId('capture-name').locator('input')).toHaveValue('DCS World');
  await page.getByTestId('capture-variant-FA-18C_hornet').click();
  await expect(page.getByTestId('capture-name').locator('input')).toHaveValue('DCS F/A-18C');

  // Another game: its launch target, its files; DCS's are gone, and so are the flight helpers' ticks.
  await page.getByTestId('capture-game-iracing').click();
  await expect(page.getByTestId('capture-name').locator('input')).toHaveValue('iRacing');
  await expect(section(page, 'files')).toContainText('Bindings (controls.cfg)');
  await expect(page_).not.toContainText('DCS World installed');
  await expect(page_).not.toContainText('{DCS_USER}');
  await expect(candidate(page, 'SimAppPro').getByRole('checkbox')).not.toBeChecked();
  await expect(
    candidate(page, 'FANATEC Podium Wheel Base DD2').getByRole('checkbox')
  ).toBeChecked();
  await bringUp(page, 'capture-section-game');
  await shot('iracing-chosen');

  // Back to DCS and create: the tracked folders are stored with the setup.
  await page.getByTestId('capture-game-dcs').click();
  await item('{DCS_USER}/Config/Input/FA-18C_hornet').getByRole('checkbox').check();
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  const saved = yaml.load(
    await fs.readFile(path.join(dataRoot, 'profiles', 'dcs-f-a-18c.yaml'), 'utf8')
  ) as { extensions: { backup: { items: { path: string; label: string }[] } } };
  expect(saved.extensions.backup.items.map((i) => i.path)).toEqual([
    '{DCS_USER}',
    '{DCS_USER}/Config/Input/FA-18C_hornet',
  ]);

  // The Backups page lists them as this setup's tracked items.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-backups').click();
  await expect(page.getByTestId('backups-page')).toContainText('1 setup and 2 tracked items');
  await shot('backups-tracked');
});

test('capture: a game installed twice asks which install the setup uses', async ({ rig }) => {
  const { page, shot, dataRoot, home } = await rig.launch('dcs-two-installs', 'capture-install');
  // Not the first setup on this PC: a new one starts from the Setups page.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('new-profile').click();
  await page.getByTestId('capture-game-dcs').click();
  await expect(page.getByTestId('capture-game-dcs')).toContainText('2 installs');
  const install = page.getByTestId('capture-install');
  await expect(install).toBeVisible();
  await install.click();
  await page
    .locator('.v-overlay--active .v-list-item')
    .filter({ hasText: 'DCS World OpenBeta' })
    .click();
  // The launch target follows the install.
  await expect(page.getByTestId('capture-launch-exe').locator('input')).toHaveValue(
    path.join(home, 'Games', 'DCS World OpenBeta', 'bin', 'DCS.exe')
  );
  await page.getByTestId('capture-name').locator('input').fill('Hornet on open beta');
  await bringUp(page, 'capture-section-game');
  await shot('install-chosen');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('profile-switcher')).toContainText('Hornet on open beta');
  const saved = await fs.readFile(
    path.join(dataRoot, 'profiles', 'hornet-on-open-beta.yaml'),
    'utf8'
  );
  expect(saved).toContain('gameInstall:');
  expect(saved).toContain('DCS World OpenBeta');
});
