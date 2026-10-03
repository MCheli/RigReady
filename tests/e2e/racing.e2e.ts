import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkRow, expect, test } from './harness';

/** Racing: the wheel, the racing games' bindings and controller ids, and a racing setup in Fly. */

test('racing: an iRacing setup goes from Not ready to Ready, then stands down to the desk', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('racing-not-ready', 'racing-make-ready');
  await expect(page.getByTestId('profile-switcher')).toContainText('iRacing');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(checkRow(page, 'Fanatec Service')).toHaveAttribute('data-status', 'fail');
  await expect(checkRow(page, 'Monitor layout')).toHaveAttribute('data-status', 'fail');
  await expect(checkRow(page, 'trophi.ai')).toHaveAttribute('data-status', 'warn');
  await page.getByTestId('group-toggle-devices').click();
  await expect(checkRow(page, 'Wheel base in PC mode')).toContainText('Connected in PC mode');
  await shot('not-ready');

  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-activity')).toContainText('Started FanatecService.exe');
  await page.getByTestId('group-toggle-files').click();
  await expect(checkRow(page, 'iRacing knows the wheel')).toContainText(
    'The controller iRacing uses is connected'
  );
  await shot('ready');

  await page.getByTestId('stand-down').click();
  const activity = page.getByTestId('fly-activity');
  await expect(activity).toContainText('Closed trophi.ai.exe');
  await expect(activity).toContainText('Restored the earlier monitor layout');
  await expect(checkRow(page, 'Monitor layout')).toHaveAttribute('data-status', 'fail');
  await shot('stood-down');
});

test('racing: capture the racing rig as a setup, which is Ready', async ({ rig }) => {
  const { page, shot } = await rig.launch('racing-fresh', 'racing-capture');
  await page.getByTestId('fly-create').click();
  const candidate = (title: string) =>
    page.locator(`[data-testid="capture-candidate"][data-title="${title}"]`);
  await expect(candidate('Wheel base in PC mode').getByRole('checkbox')).toBeChecked();
  await expect(candidate('FANATEC Podium Wheel Base DD2').getByRole('checkbox')).toBeChecked();
  await expect(candidate('Fanatec Service').getByRole('checkbox')).toBeChecked();
  await expect(candidate('trophi.ai coach').getByRole('checkbox')).toBeChecked();
  await expect(page.getByTestId('capture-group-displays')).toContainText('LC49G95T');
  // Game-specific items are offered, not chosen for the user.
  await expect(candidate('iRacing knows the wheel').getByRole('checkbox')).not.toBeChecked();
  await candidate('iRacing knows the wheel').getByRole('checkbox').check();
  await candidate('iRacing helper service').getByRole('checkbox').check();
  await page.getByTestId('capture-name').locator('input').fill('iRacing');
  await page.getByTestId('capture-app-filter').locator('input').fill('fanatec');
  await page.getByTestId('capture-group-apps').scrollIntoViewIfNeeded();
  await shot('capture-apps');
  await page.getByTestId('capture-group-files').scrollIntoViewIfNeeded();
  await shot('capture-racing');

  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('profile-switcher')).toContainText('iRacing');
  await page.getByTestId('group-toggle-devices').click();
  await expect(checkRow(page, 'Wheel base in PC mode')).toHaveAttribute('data-status', 'pass');
  await shot('ready');
});

test('racing: overview, iRacing bindings, and repairing a wheel with a new Windows id', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch(
    'racing-iracing-moved-wheel',
    'racing-iracing-repair'
  );
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-racing').click();
  await expect(page.getByTestId('racing-wheel-summary')).toContainText('PC mode');
  const iracingCard = page.locator('[data-testid="racing-game-card"][data-game="iracing"]');
  await expect(iracingCard).toContainText('1 controller has a new Windows id');
  await expect(page.locator('[data-testid="racing-game-card"][data-game="lmu"]')).toContainText(
    '37 bindings'
  );
  await shot('overview');

  await iracingCard.click();
  const device = page.getByTestId('iracing-device');
  await expect(device).toHaveAttribute('data-state', 'moved');
  await expect(device.getByTestId('state-chip')).toHaveText('New Windows id');
  await expect(page.getByTestId('iracing-repair-target')).toContainText(
    'FANATEC Podium Wheel Base DD2'
  );
  await expect(page.getByTestId('iracing-bindings')).toContainText('Wheel Axis, turning right');
  await shot('moved');

  await page.getByTestId('iracing-repair').click();
  await expect(page.getByTestId('iracing-repair-confirm')).toBeVisible();
  await expect(page.getByTestId('iracing-unverified')).toContainText(
    'Not yet verified on real hardware'
  );
  await shot('confirm');
  await page.getByTestId('iracing-repair-go').click();
  await expect(page.getByTestId('iracing-message')).toContainText(
    'Updated 17 bindings and the calibration of FANATEC Podium Wheel Base DD2'
  );
  await expect(device).toHaveAttribute('data-state', 'connected');
  await page.getByTestId('iracing-filter').locator('input').fill('gear');
  await expect(page.locator('[data-testid="binding-row"]')).toHaveCount(8);
  await shot('repaired');

  // The files now hold the connected wheel's id; the change is on the Safety page.
  const yaml = await fs.readFile(path.join(home, 'Documents', 'iRacing', 'joyCalib.yaml'), 'utf8');
  expect(yaml).toContain('{20B0BED0-03A4-11F1-8001-444553540000}');
  await page.getByTestId('nav-safety').click();
  await expect(page.locator('[data-testid="change-group"]').first()).toHaveAttribute(
    'data-reason',
    'Point iRacing at the new Windows id of FANATEC Podium Wheel Base DD2'
  );
});

test('racing: Le Mans Ultimate, BeamNG.drive and Assetto Corsa bindings, with a backup and restore', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('racing-fresh', 'racing-games');
  await mutate([{ op: 'setSteamBuild', appId: '2399420', stateFlags: 6 }]);
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-racing').click();
  await page.locator('[data-testid="racing-game-card"][data-game="lmu"]').click();
  await expect(page.getByTestId('lmu-update')).toBeVisible();
  await expect(page.getByTestId('lmu-device')).toHaveAttribute('data-state', 'connected');
  await expect(page.getByTestId('lmu-bindings')).toContainText('Accelerator (Z−)');
  await expect(page.getByTestId('lmu-ffb')).toContainText('Steering torque minimum');
  await shot('lmu');

  // Back up, then restore after confirming; the game is closed so it is allowed.
  await expect(page.getByTestId('backups-empty')).toBeVisible();
  await page.getByTestId('backup-now').click();
  await expect(page.getByTestId('backup-message')).toHaveText('Backed up 3 files.');
  await page.getByTestId('backup-restore').click();
  await expect(page.getByTestId('restore-confirm')).toBeVisible();
  await expect(page.getByTestId('restore-confirm')).toContainText('Bindings and force feedback');
  await shot('restore-confirm');
  await page.getByTestId('restore-go').click();
  await expect(page.getByTestId('backup-message')).toContainText('Restored 3 files');
  await shot('restored');

  await page.getByTestId('nav-racing').click();
  await page.locator('[data-testid="racing-game-card"][data-game="beamng"]').click();
  await expect(page.getByTestId('beamng-map').first()).toContainText('Connected');
  await expect(page.getByTestId('beamng-bindings').first()).toContainText('Parking Brake');
  await expect(page.getByTestId('beamng-ffb')).toContainText('Soft-lock force');
  await shot('beamng');

  await page.getByTestId('nav-racing').click();
  await page.locator('[data-testid="racing-game-card"][data-game="assetto-corsa"]').click();
  await expect(page.getByTestId('ac-bindings')).toContainText('Shift up');
  await expect(page.getByTestId('ac-offline')).toHaveCount(0);
  await shot('assetto-corsa');

  // Unplugged wheel: flagged, with restore from backup offered instead of an id repair.
  await page.getByTestId('nav-racing').click();
  await page.locator('[data-testid="racing-game-card"][data-game="lmu"]').click();
  await mutate([{ op: 'unplugDevice', match: { vendorId: '0EB7' } }]);
  await expect(page.getByTestId('lmu-device')).toHaveAttribute('data-state', 'missing');
  await expect(page.getByTestId('lmu-offline')).toContainText('does not rewrite it');
  await shot('lmu-unplugged');
});

test('racing: BeamNG.drive older user folders, per-vehicle maps and a replaced wheel base', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch('racing-fresh', 'racing-beamng');
  const local = path.join(home, 'AppData', 'Local');
  const inputmaps = path.join(local, 'BeamNG', 'BeamNG.drive', 'current', 'settings', 'inputmaps');
  const older = path.join(local, 'BeamNG.drive', '0.31', 'settings', 'inputmaps');
  await fs.mkdir(older, { recursive: true });
  await fs.writeFile(
    path.join(older, '00060eb7.diff'),
    JSON.stringify({
      bindings: [{ action: 'horn', control: 'button3' }],
      name: 'Podium DD1',
      vidpid: '00060EB7',
      devicetype: 'joystick',
    })
  );
  // The wheel base was replaced: the old ClubSport map is there, the DD2 has none yet.
  await fs.rm(path.join(inputmaps, '00070eb7.diff'));
  await fs.writeFile(
    path.join(inputmaps, '00010eb7.diff'),
    JSON.stringify({
      bindings: [
        {
          action: 'steering',
          control: 'xaxis',
          angle: 900,
          isForceEnabled: true,
          ffb: { forceCoef: 150 },
        },
        { action: 'shiftUp', control: 'button4' },
      ],
      name: 'ClubSport Wheel Base V2',
      vidpid: '00010EB7',
      devicetype: 'joystick',
    })
  );
  await fs.mkdir(path.join(inputmaps, 'pickup'), { recursive: true });
  await fs.writeFile(
    path.join(inputmaps, 'pickup', '00010eb7.diff'),
    JSON.stringify({
      bindings: [{ action: 'horn', control: 'button7' }],
      name: 'ClubSport Wheel Base V2',
      vidpid: '00010EB7',
      devicetype: 'joystick',
    })
  );

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-racing').click();
  await page.locator('[data-testid="racing-game-card"][data-game="beamng"]').click();
  await expect(page.getByTestId('beamng-older')).toContainText('BeamNG.drive 0.31');
  const csw = page.locator('[data-testid="beamng-map"][data-file="00010eb7.diff"]');
  await expect(csw.getByTestId('state-chip')).toHaveText('Not connected');
  await expect(
    page.locator('[data-testid="beamng-map"][data-file="pickup/00010eb7.diff"]')
  ).toContainText('only in pickup');
  await shot('replaced-wheel');

  await csw.getByTestId('beamng-copy-target').click();
  await page.getByRole('option', { name: 'FANATEC Podium Wheel Base DD2' }).click();
  await csw.getByTestId('beamng-copy').click();
  await expect(page.getByTestId('beamng-copy-controller-confirm')).toContainText(
    'Steering (axis) · Wheel'
  );
  await shot('copy-preview');
  await page.getByTestId('beamng-copy-controller-go').click();
  await expect(page.getByTestId('beamng-message')).toContainText(
    'FANATEC Podium Wheel Base DD2 now has the bindings'
  );
  await expect(
    page.locator('[data-testid="beamng-map"][data-file="00070eb7.diff"]').getByTestId('state-chip')
  ).toHaveText('Connected');

  await page.getByTestId('beamng-copy-older').click();
  await expect(page.getByTestId('beamng-copy-confirm')).toBeVisible();
  await page.getByTestId('beamng-copy-go').click();
  await expect(page.getByTestId('beamng-message')).toHaveText(
    'Copied 1 binding file from 0.31. Undo is on the Safety page.'
  );
  await expect(page.locator('[data-testid="beamng-map"][data-file="00060eb7.diff"]')).toBeVisible();
  await page.getByTestId('beamng-older').scrollIntoViewIfNeeded();
  await shot('copied');
});

test('racing: the wheel page, recorded presets and recommended settings', async ({ rig }) => {
  const run = await rig.launch('racing-fresh', 'racing-wheel');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-wheel').click();
  await expect(page.getByTestId('wheel-name')).toHaveText('FANATEC Podium Wheel Base DD2');
  await expect(page.getByTestId('wheel-mode')).toContainText('PC (red) mode');
  await expect(page.getByTestId('wheel-software').first()).toContainText('0.52.2');
  await shot('wheel');

  await page.getByTestId('preset-name').locator('input').fill('iRacing GT3');
  await page.getByTestId('preset-SEN').locator('input').fill('1080');
  await page.getByTestId('preset-FF').locator('input').fill('90');
  await page.getByTestId('preset-NDP').locator('input').fill('16');
  await page.getByTestId('presets-save').click();
  await expect(page.getByTestId('presets-saved')).toBeVisible();
  await expect(page.getByTestId('preset-tab-1')).toContainText('3');
  await page.getByTestId('wheel-presets').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot('presets');

  const table = page.getByTestId('recommended-table');
  await expect(table).toContainText('Set on the wheel · your preset 1: 1080');
  await expect(page.locator('[data-testid="recommended-row"][data-status="match"]')).toHaveCount(0);
  await page.getByTestId('recommended-lmu').click();
  await expect(page.locator('[data-testid="recommended-row"][data-status="match"]')).toHaveCount(3);
  await page.getByTestId('recommended-iracing').click();
  await page.getByTestId('wheel-recommended').scrollIntoViewIfNeeded();
  await shot('recommended');

  // Restart: the presets were kept in RigReady's own data.
  const again = await run.restart();
  await again.page.getByTestId('mode-configure').click();
  await again.page.getByTestId('nav-wheel').click();
  await expect(again.page.getByTestId('preset-name').locator('input')).toHaveValue('iRacing GT3');
  await expect(again.page.getByTestId('preset-SEN').locator('input')).toHaveValue('1080');
});

test('racing: game pages show status at a glance, launch, and a folder chosen by hand', async ({
  rig,
}) => {
  const { page, shot, home, mutate } = await rig.launch('racing-fresh', 'racing-game-pages', {
    dialogs: { open: [['Games/iRacing']] },
  });
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-games').click();
  await expect(page.locator('[data-testid="game-row"][data-game="iracing"]')).toContainText(
    '2026.04.21.01'
  );
  await shot('games');

  await page.locator('[data-testid="game-row"][data-game="iracing"]').click();
  await expect(page.getByTestId('game-title')).toHaveText('iRacing');
  await expect(page.getByTestId('game-glance')).toContainText('Standalone install');
  await expect(page.locator('[data-testid="game-tracked"]')).toHaveCount(6);
  await expect(page.getByTestId('game-bindings')).toBeVisible();
  await shot('iracing');
  await page.getByTestId('game-launch').click();
  await expect(page.getByTestId('game-message')).toHaveText('Started iRacing.');
  await expect(page.getByTestId('game-launch')).toHaveText('Running');

  // iRacing gone from the usual places: not found, and a folder can be chosen.
  await fs.mkdir(path.join(home, 'Games', 'iRacing', 'ui'), { recursive: true });
  await fs.writeFile(path.join(home, 'Games', 'iRacing', 'ui', 'iRacingUI.exe'), '');
  await mutate([
    {
      op: 'removeRegistryKey',
      hive: 'HKLM',
      key: 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{2CB193B9-1B9D-4A84-BC70-0948145BA4BA}_is1',
    },
    { op: 'removeFile', path: 'Program Files (x86)/iRacing' },
    { op: 'stopProcess', name: 'iRacingUI.exe' },
  ]);
  await expect(page.getByTestId('game-not-found')).toBeVisible();
  await shot('not-found');
  await page.getByTestId('game-choose-folder').click();
  await expect(page.getByTestId('game-message')).toContainText('RigReady will use this folder');
  await expect(page.getByTestId('game-glance')).toContainText(path.join(home, 'Games', 'iRacing'));
  await shot('folder-chosen');

  await page.getByTestId('nav-games').click();
  await page.locator('[data-testid="game-row"][data-game="msfs2024"]').click();
  await expect(page.getByTestId('game-title')).toHaveText('Microsoft Flight Simulator 2024');
  await expect(page.locator('[data-testid="game-note"]').first()).toContainText(
    'cannot list what is bound'
  );
  await shot('msfs2024');
});
