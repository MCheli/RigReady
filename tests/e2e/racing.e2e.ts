import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseControlsCfg } from '../../src/features/racing/core/iracing/controlsCfg';
import { checkRow, expect, test } from './harness';

/** The same iRacing bindings file with one action moved to the next button: another rim's bindings. */
function withOneButtonMoved(controls: Buffer): Buffer {
  const parsed = parseControlsCfg(new Uint8Array(controls));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const record = parsed.value.records.find((r) => r.binding.kind === 'button');
  if (!record || record.binding.kind !== 'button') throw new Error('no button binding');
  const out = Buffer.from(controls);
  const from = record.binding.buttons[0]!;
  const to = (from + 1) % 32;
  const mask = record.offset + 12;
  out[mask + (from >> 3)] = out[mask + (from >> 3)]! & ~(1 << (from & 7));
  out[mask + (to >> 3)] = out[mask + (to >> 3)]! | (1 << (to & 7));
  return out;
}

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
  // Game-specific items come with the game, and only with it.
  await expect(candidate('iRacing knows the wheel')).toHaveCount(0);
  await page.getByTestId('capture-game-iracing').click();
  await expect(candidate('iRacing knows the wheel').getByRole('checkbox')).toBeChecked();
  await expect(candidate('iRacing helper service').getByRole('checkbox')).toBeChecked();
  await expect(page.getByTestId('capture-name').locator('input')).toHaveValue('iRacing');
  await expect(page.getByTestId('capture-summary-standdown')).toContainText(
    'Closes trophi.ai coach'
  );
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

test('racing: a setup cloned into a rim variant has its own binding backup; switching setups puts the right bindings back', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch('racing-rim-variant', 'racing-rim-variant');
  const controls = path.join(home, 'Documents', 'iRacing', 'controls.cfg');
  const gt3Bindings = await fs.readFile(controls);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  const openIracing = async (): Promise<void> => {
    await page.getByTestId('mode-configure').click();
    await page.getByTestId('nav-racing').click();
    await page.locator('[data-testid="racing-game-card"][data-game="iracing"]').click();
    await expect(page.getByTestId('backups-iracing')).toBeVisible();
  };
  const backupRow = (name: string) =>
    page.locator(`[data-testid="backup-row"][data-name="${name}"]`);
  const useIn = async (backup: string, setup: string): Promise<void> => {
    await backupRow(backup).getByTestId('backup-use').click();
    await page.locator(`[data-testid="backup-use-setup"][data-setup="${setup}"]`).click();
    await expect(page.getByTestId('backup-message')).toContainText(
      `"${setup}" now expects the bindings saved as "${backup}"`
    );
  };

  // The bindings as they are now are the ones for the GT3 rim: saved under that name and
  // made what the setup expects.
  await openIracing();
  await page.getByTestId('backup-name').locator('input').fill('GT3 rim');
  await page.getByTestId('backup-now').click();
  await expect(page.getByTestId('backup-message')).toHaveText('Backed up 3 files as "GT3 rim".');
  await useIn('GT3 rim', 'iRacing');
  await expect(backupRow('GT3 rim').getByTestId('backup-used-by')).toHaveText(
    'The bindings of the setup iRacing'
  );
  await backupRow('GT3 rim').scrollIntoViewIfNeeded();
  await shot('gt3-bindings-used-by-the-setup');

  // The variant: a copy of the setup, made on the Setups page.
  await page.getByTestId('nav-profiles').click();
  await page
    .locator('[data-testid="profile-row"][data-name="iRacing"]')
    .getByTestId('profile-clone')
    .click();
  await expect(page.getByTestId('edit-name').locator('input')).toHaveValue('iRacing (copy)');
  await page.getByTestId('edit-name').locator('input').fill('iRacing - Formula rim');
  await page.getByTestId('edit-save').click();
  await expect(
    page.locator('[data-testid="profile-row"][data-name="iRacing - Formula rim"]')
  ).toBeVisible();
  await shot('variant-cloned');

  // The Formula rim goes on the base and is bound in iRacing (the simulator writes the file).
  const formulaBindings = withOneButtonMoved(gt3Bindings);
  expect(Buffer.compare(formulaBindings, gt3Bindings)).not.toBe(0);
  await fs.writeFile(controls, formulaBindings);
  await openIracing();
  await expect(page.getByTestId('iracing-error')).toHaveCount(0);
  await page.getByTestId('backup-name').locator('input').fill('Formula rim');
  await page.getByTestId('backup-now').click();
  await expect(page.getByTestId('backup-message')).toHaveText(
    'Backed up 3 files as "Formula rim".'
  );
  await backupRow('Formula rim').getByTestId('backup-use').click();
  const menu = page.getByTestId('backup-use-menu');
  await expect(menu).toBeVisible();
  // The copy still expects what the original did, until it is given its own.
  await expect(
    menu.locator('[data-testid="backup-use-setup"][data-setup="iRacing - Formula rim"]')
  ).toContainText('Uses other bindings now');
  await shot('choose-the-setup');
  await menu
    .locator('[data-testid="backup-use-setup"][data-setup="iRacing - Formula rim"]')
    .click();
  await expect(page.getByTestId('backup-message')).toContainText(
    '"iRacing - Formula rim" now expects the bindings saved as "Formula rim", and Make ready restores them.'
  );
  await expect(backupRow('Formula rim').getByTestId('backup-used-by')).toHaveText(
    'The bindings of the setup iRacing - Formula rim'
  );
  await expect(backupRow('GT3 rim').getByTestId('backup-used-by')).toHaveText(
    'The bindings of the setup iRacing'
  );
  await backupRow('GT3 rim').scrollIntoViewIfNeeded();
  await shot('each-setup-its-bindings');

  const choose = async (name: string): Promise<void> => {
    await page.getByTestId('profile-switcher').click();
    // An option reads "<setup> <game> · <last used>".
    await page.getByRole('option', { name: new RegExp(`^${name} iRacing ·`) }).click();
    await expect(page.getByTestId('profile-switcher')).toContainText(name);
  };

  // Back to the GT3 rim: its setup notices the formula bindings and puts its own back.
  await page.getByTestId('mode-fly').click();
  await choose('iRacing');
  const gt3 = checkRow(page, 'iRacing bindings: GT3 rim');
  await expect(gt3).toHaveAttribute('data-status', 'fail');
  await expect(gt3.getByTestId('check-summary')).toHaveText(
    'iRacing has other bindings than "GT3 rim": 1 of 2 files differ'
  );
  await expect(gt3.getByTestId('check-fix')).toHaveText('Restore the bindings saved as "GT3 rim"');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await gt3.scrollIntoViewIfNeeded();
  await shot('gt3-setup-sees-other-bindings');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-activity')).toContainText(
    'Restored the iRacing bindings saved as "GT3 rim" (2 files)'
  );
  expect(Buffer.compare(await fs.readFile(controls), gt3Bindings)).toBe(0);
  await shot('gt3-bindings-restored');

  // And the other rim: the variant restores the formula bindings from its own item.
  await choose('iRacing - Formula rim');
  const formula = checkRow(page, 'iRacing bindings: Formula rim');
  await expect(formula).toHaveAttribute('data-status', 'fail');
  await formula.getByTestId('check-fix').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  // A group that passes is collapsed: open it to see the item.
  await page.getByTestId('group-toggle-files').click();
  await expect(formula).toHaveAttribute('data-status', 'pass');
  await expect(formula.getByTestId('check-summary')).toHaveText(
    'iRacing has the bindings saved as "Formula rim"'
  );
  expect(Buffer.compare(await fs.readFile(controls), formulaBindings)).toBe(0);
  await shot('formula-variant-ready');

  // Both restores are actions that can be undone.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-safety').click();
  await expect(
    page.locator(
      `[data-testid="change-group"][data-reason='Restore iRacing bindings "Formula rim"']`
    )
  ).toHaveCount(1);
  await expect(
    page.locator(`[data-testid="change-group"][data-reason='Restore iRacing bindings "GT3 rim"']`)
  ).toHaveCount(1);
  await shot('safety');
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

test('racing: Le Mans Ultimate bindings are pointed at a wheel base Windows renamed', async ({
  rig,
}) => {
  const { page, shot, home, mutate } = await rig.launch(
    'racing-lmu-renamed-wheel',
    'racing-lmu-renamed'
  );
  const file = path.join(
    home,
    'Program Files (x86)/Steam/steamapps/common/Le Mans Ultimate/UserData/player/direct input.json'
  );
  const before = await fs.readFile(file, 'utf8');
  expect(before).toContain('"product name": "Fanatec Podium DD2 Wheel Base"');

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-racing').click();
  const card = page.locator('[data-testid="racing-game-card"][data-game="lmu"]');
  await expect(card).toContainText('1 controller has a new name');
  await shot('overview');

  await card.click();
  const device = page.getByTestId('lmu-device');
  await expect(device).toHaveAttribute('data-state', 'renamed');
  await expect(device.getByTestId('state-chip')).toHaveText('New name');
  await expect(page.getByTestId('lmu-repair-panel')).toContainText(
    'Windows now calls this controller FANATEC Podium Wheel Base DD2'
  );
  await expect(page.getByTestId('lmu-repair-panel')).toContainText('the 37 bindings');
  await shot('renamed');

  // While the game runs the repair is not available; closed again, it is.
  await mutate([
    { op: 'startProcess', name: 'Le Mans Ultimate.exe', path: 'C:\\Games\\Le Mans Ultimate.exe' },
  ]);
  await expect(page.getByTestId('lmu-running')).toBeVisible();
  await expect(page.getByTestId('lmu-repair')).toBeDisabled();
  await mutate([{ op: 'stopProcess', name: 'Le Mans Ultimate.exe' }]);
  await expect(page.getByTestId('lmu-repair')).toBeEnabled();

  await page.getByTestId('lmu-repair').click();
  const confirm = page.getByTestId('lmu-repair-confirm');
  await expect(confirm).toBeVisible();
  await expect(page.getByTestId('lmu-repair-what')).toContainText(
    'RigReady replaces Fanatec Podium DD2 Wheel Base with FANATEC Podium Wheel Base DD2'
  );
  await expect(confirm).toContainText('direct input.json');
  await expect(confirm).toContainText('1 file modified');
  await expect(page.getByTestId('lmu-unverified')).toContainText('Not yet verified in the game');
  // Nothing is written by asking.
  expect(await fs.readFile(file, 'utf8')).toBe(before);
  await shot('confirm');

  await page.getByTestId('lmu-repair-go').click();
  await expect(page.getByTestId('lmu-message')).toContainText(
    'Pointed 37 bindings at FANATEC Podium Wheel Base DD2'
  );
  await expect(device).toHaveAttribute('data-state', 'connected');
  // Nothing left to repair: the offer is gone.
  await expect(page.getByTestId('lmu-repair-panel')).toHaveCount(0);
  await expect(page.getByTestId('lmu-repair')).toHaveCount(0);
  await shot('repaired');
  const after = await fs.readFile(file, 'utf8');
  expect(after).toContain('"product name": "FANATEC Podium Wheel Base DD2"');
  expect(after).not.toContain('Fanatec Podium DD2 Wheel Base');

  // One action on the Safety page; Undo puts the file back as it was.
  await page.getByTestId('nav-safety').click();
  const group = page.locator('[data-testid="change-group"]').first();
  await expect(group).toHaveAttribute(
    'data-reason',
    'Point Le Mans Ultimate at the new name of FANATEC Podium Wheel Base DD2'
  );
  await shot('safety');
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
  await expect(page.locator('[data-testid="game-tracked"]')).toHaveCount(7);
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
