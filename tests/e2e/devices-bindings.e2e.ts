import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { checkRow, expect, test, type RunningApp } from './harness';

/**
 * Where devices and DCS bindings meet the rest of the app: the names the owner gives
 * devices shown everywhere, Diagnose from the Fly screen, what a pressed control is bound
 * to, identical devices whose IDs all changed, and the notification choice in Settings.
 */

const HORNET_DIR = ['Saved Games', 'DCS', 'Config', 'Input', 'FA-18C_hornet', 'joystick'];
const joystickDir = (run: RunningApp): string => path.join(run.home, ...HORNET_DIR);

async function openDevices(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-devices').click();
  await expect(page.getByTestId('devices-controllers')).toBeVisible();
}

async function openBindings(page: Page, tab?: string): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-dcs-bindings').click();
  await expect(page.getByTestId('bind-overview')).toBeVisible();
  if (tab) await page.getByTestId(`bind-tab-${tab}`).click();
}

const deviceRow = (page: Page, name: string) =>
  page.locator(`[data-testid="device-row"][data-name="${name}"]`);

async function nameDevice(page: Page, current: string, name: string): Promise<void> {
  const row = deviceRow(page, current);
  await row.locator('button').first().click();
  await row.getByTestId('device-rename').click();
  await page.getByTestId('device-name-input').locator('input').fill(name);
  await page.getByTestId('device-name-save').click();
  await expect(deviceRow(page, name)).toBeVisible();
}

let clock = 5_000;
/** A controller's state as DirectInput reports it. Buttons are numbered as games do: 1 is the first. */
function controller(
  c: { index: number; name: string; axes: number; buttons: number; hats?: number },
  input: { pressed?: number[]; axes?: Record<number, number> } = {}
) {
  return {
    index: c.index,
    name: c.name,
    axes: Array.from({ length: c.axes }, (_, i) => input.axes?.[i] ?? 0),
    buttons: Array.from({ length: c.buttons }, (_, i) => input.pressed?.includes(i + 1) ?? false),
    hats: Array.from({ length: c.hats ?? 0 }, (): [number, number] => [0, 0]),
    timestamp: clock++,
  };
}
const DD2 = { index: 0, name: 'FANATEC Podium Wheel Base DD2', axes: 8, buttons: 108, hats: 1 };
const MFD_LEFT = { index: 7, name: 'WINWING MFD1-L', axes: 1, buttons: 50 };
const STICK = {
  index: 9,
  name: 'WINWING Orion Joystick Base 2 + JGRIP-F16',
  axes: 6,
  buttons: 42,
  hats: 1,
};

test('names: a name given on the Devices page shows on the Fly checklist, in DCS bindings and on the USB map', async ({
  rig,
}) => {
  const run = await rig.launch('devices-rig', 'devices-names-everywhere');
  const { page, shot } = run;
  await openDevices(page);
  await nameDevice(page, 'T-Pendular-Rudder', 'Rudder pedals');
  await nameDevice(page, 'WINWING UFC1 + HUD1', 'Up-front controller');
  await expect(deviceRow(page, 'Up-front controller')).toContainText('WINWING UFC1 + HUD1');
  await shot('named');

  // Fly: the item keeps the title the setup gave it; the line below leads with the owner's name.
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('group-devices')).toContainText(/(\d+) of \1 OK/);
  await page.getByTestId('group-toggle-devices').click();
  const pedals = checkRow(page, 'T-Pendular-Rudder');
  await expect(pedals).toHaveAttribute('data-status', 'pass');
  await expect(pedals.getByTestId('check-summary')).toContainText('Rudder pedals · Connected');
  await expect(checkRow(page, 'WINWING UFC1 + HUD1').getByTestId('check-summary')).toContainText(
    'Up-front controller · Connected'
  );
  // A device without a name of its own reads as before.
  await expect(checkRow(page, 'WINWING MFD1-L').getByTestId('check-summary')).toHaveText(
    /^Connected · /
  );
  await pedals.scrollIntoViewIfNeeded();
  await shot('fly');

  // DCS bindings: the owner's name first, what DCS calls the device beside it.
  await openBindings(page);
  const ufc = page.locator('[data-testid="ov-device"][data-device="WINWING UFC1 + HUD1"]');
  await expect(ufc.locator('.rr-row-title')).toContainText('Up-front controller');
  await expect(ufc.locator('.rr-row-title')).toContainText('WINWING UFC1 + HUD1');
  await ufc.scrollIntoViewIfNeeded();
  await shot('bindings-overview');
  await page.getByTestId('bind-tab-devices').click();
  const select = page.getByTestId('dev-select').locator('input[type="text"]');
  await select.click();
  await select.fill('Up-front');
  await page
    .getByRole('option', { name: /Up-front controller/ })
    .first()
    .click();
  await expect(page.getByTestId('dev-given-name')).toHaveText('Up-front controller');
  await expect(page.getByTestId('dev-hardware-name')).toHaveText('WINWING UFC1 + HUD1');
  // Still the same device to DCS: matched by its ID, the file named after the hardware.
  await expect(page.getByTestId('dev-meta')).toContainText('806E0610-B756-11f0-8026-444553540000');
  await expect(page.getByTestId('dev-meta')).toContainText('WINWING UFC1 + HUD1 {806E0610');
  await shot('bindings-device');

  // USB map.
  await page.getByTestId('nav-devices').click();
  await page.getByTestId('devices-tab-usb').click();
  const node = page.locator('[data-testid="usb-node"][data-name="Rudder pedals"]');
  await expect(node).toBeVisible();
  await node.scrollIntoViewIfNeeded();
  await shot('usb-map');

  // Unplugged, the check fails on what the device is, and still says whose it is.
  await run.mutate([{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await page.getByTestId('mode-fly').click();
  await expect(pedals).toHaveAttribute('data-status', 'fail');
  await expect(pedals.getByTestId('check-summary')).toContainText('Rudder pedals · Not connected');
  await shot('fly-unplugged');
});

test('diagnose: a failing device on the Fly screen opens that device on the Devices page, connected or not', async ({
  rig,
}) => {
  const run = await rig.launch('flying-pedals-unplugged', 'devices-diagnose');
  const { page, shot } = run;
  const pedals = checkRow(page, 'T-Pendular-Rudder');
  await expect(pedals).toHaveAttribute('data-status', 'fail');
  await pedals.getByTestId('check-diagnose').click();

  // Not connected: what RigReady knows about it, and what to try.
  await expect(page.getByTestId('devices-page')).toBeVisible();
  await expect(page.getByTestId('devices-diagnosis')).toContainText(
    '"T-Pendular-Rudder" on the checklist of DCS F/A-18C is not connected'
  );
  const missing = page.locator('[data-testid="missing-row"][data-name="T-Pendular-Rudder"]');
  await expect(missing).toHaveAttribute('data-open', 'true');
  const detail = missing.getByTestId('missing-detail');
  await expect(detail).toContainText('044F:B68F');
  await expect(detail).toContainText('Needed by');
  await expect(detail).toContainText('DCS F/A-18C');
  await expect(detail).toContainText('Vendor and product ID');
  await expect(detail).toContainText('Check the cable at both ends');
  await missing.scrollIntoViewIfNeeded();
  await shot('missing-device');

  // Plugged back in, the same link opens the device itself.
  await run.mutate([{ op: 'plugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await expect(page.getByTestId('devices-missing')).toHaveCount(0);
  await run.mutate([{ op: 'hideDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await page.getByTestId('mode-fly').click();
  await expect(pedals).toHaveAttribute('data-status', 'fail');
  await expect(pedals).toContainText('Hidden by HidHide');
  await pedals.getByTestId('check-diagnose').click();
  await expect(page.getByTestId('devices-diagnosis')).toContainText('It is connected');
  const row = deviceRow(page, 'T-Pendular-Rudder');
  await expect(row).toHaveClass(/highlighted/);
  await expect(row.getByTestId('device-detail')).toContainText('044F:B68F');
  await expect(row.getByTestId('device-detail')).toContainText('On the hidden list');
  await expect(row.getByTestId('device-hidden-badge')).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  await shot('connected-device');
});

test('tester: pressing a control shows what it is bound to in the chosen aircraft, and a device opens its DCS bindings', async ({
  rig,
}) => {
  const run = await rig.launch('dcs-bindings-conflict', 'devices-bound');
  const { page, shot, sendInput } = run;
  await openDevices(page);

  // The device detail links to the device's input tester and to its DCS bindings.
  const mfd = deviceRow(page, 'WINWING MFD1-L');
  await mfd.locator('button').first().click();
  await expect(mfd.getByTestId('device-test')).toBeVisible();
  await expect(mfd.getByTestId('device-bindings')).toHaveText('DCS bindings');
  await expect(mfd.getByTestId('device-detail')).toContainText('Needed by');
  await mfd.scrollIntoViewIfNeeded();
  await shot('device-detail');
  await mfd.getByTestId('device-bindings').click();
  await expect(page.getByTestId('bind-devices')).toBeVisible();
  await expect(page.getByTestId('dev-meta')).toContainText('7F3956A0-B756-11f0-801A-444553540000');
  await expect(page.getByTestId('dev-select')).toContainText('WINWING MFD1-L');
  await shot('its-bindings');

  // The input tester, with an aircraft chosen.
  await page.getByTestId('nav-devices').click();
  await page.getByTestId('devices-tab-test').click();
  await expect(page.getByTestId('tester-page')).toHaveAttribute('data-live', 'true');
  await page.getByTestId('tester-aircraft').click();
  await page.getByRole('option', { name: 'DCS · F/A-18C' }).click();
  await expect(page.getByTestId('bound-waiting')).toContainText('what it does in F/A-18C');

  // A stick button: one action.
  await sendInput([controller(STICK), controller(MFD_LEFT), controller(DD2)]);
  await sendInput([controller(MFD_LEFT, { pressed: [1] })]);
  await expect(page.getByTestId('bound-control')).toHaveText('Button 1 on WINWING MFD1-L');
  await expect(page.getByTestId('bound-action')).toHaveCount(1);
  await expect(page.getByTestId('bound-duplicate')).toHaveCount(0);
  await page.getByRole('heading', { name: 'Input tester' }).scrollIntoViewIfNeeded();
  await shot('one-action');
  await sendInput([controller(MFD_LEFT)]);

  // The knob that is bound twice: both actions, and a warning.
  await sendInput([controller(MFD_LEFT, { axes: { 0: 0.8 } })]);
  await expect(page.getByTestId('bound-control')).toHaveText('Slider 1 on WINWING MFD1-L');
  await expect(page.getByTestId('bound-control')).toHaveAttribute('data-input', 'JOY_SLIDER1');
  await expect(page.getByTestId('bound-action')).toHaveCount(2);
  await expect(page.getByTestId('tester-bound')).toContainText('Pitch');
  await expect(page.getByTestId('tester-bound')).toContainText(
    'HUD Symbology Brightness Control Knob'
  );
  await expect(page.getByTestId('bound-duplicate')).toContainText('several things at once');
  await page.getByRole('heading', { name: 'Input tester' }).scrollIntoViewIfNeeded();
  await shot('bound-twice');

  // A control nothing is bound to says so.
  await sendInput([controller(DD2, { pressed: [100] })]);
  await expect(page.getByTestId('bound-control')).toHaveText(
    'Button 100 on FANATEC Podium Wheel Base DD2'
  );
  await expect(page.getByTestId('bound-none')).toContainText('Nothing is bound to it in F/A-18C');
  await shot('nothing-bound');

  // From the knob straight to where it is fixed.
  await sendInput([controller(DD2)]);
  await sendInput([controller(MFD_LEFT, { axes: { 0: -0.6 } })]);
  await expect(page.getByTestId('bound-duplicate')).toBeVisible();
  await page.getByTestId('bound-open').click();
  await expect(page.getByTestId('bind-devices')).toBeVisible();
  await expect(page.getByTestId('dev-meta')).toContainText('7F3956A0-B756-11f0-801A-444553540000');
});

test('bindings: three identical panels got new device IDs; each old file goes to the panel whose button is pressed', async ({
  rig,
}) => {
  const run = await rig.launch('dcs-bindings-identical', 'bindings-identical');
  const { page, shot, sendInput } = run;
  const OLD = {
    left: '4B3710E0-9AA7-11EE-801E-444553540000',
    centre: '4F916A50-9AA7-11ee-8027-444553540000',
    right: '5206D720-9AA7-11EE-8028-444553540000',
  };
  const NEW = {
    left: 'A1A1A1A1-C0DE-11f1-8001-444553540000',
    centre: 'A2A2A2A2-C0DE-11f1-8002-444553540000',
    right: 'A3A3A3A3-C0DE-11f1-8003-444553540000',
  };
  const before = Object.fromEntries(
    await Promise.all(
      Object.entries(OLD).map(async ([panel, id]) => [
        panel,
        await fs.readFile(path.join(joystickDir(run), `WINWING MFD1 {${id}}.diff.lua`), 'utf8'),
      ])
    )
  ) as Record<keyof typeof OLD, string>;
  expect(new Set(Object.values(before)).size).toBe(3);
  const panel = (index: number, pressed: number[] = []) =>
    controller({ index, name: 'WINWING MFD1', axes: 1, buttons: 50 }, { pressed });

  const check = checkRow(page, 'DCS bindings match devices (F/A-18C)');
  await expect(check).toHaveAttribute('data-status', 'warn');
  await expect(check).toContainText('Bindings for 3 devices belong to old device IDs');
  await check.getByTestId('check-fix').click();
  await expect(page.getByTestId('bind-device-ids')).toBeVisible();

  // Nothing is proposed: three old files, three panels with the same name.
  const orphans = page.locator('[data-testid="ids-orphan"][data-device="WINWING MFD1"]');
  await expect(orphans).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(orphans.nth(i)).toHaveAttribute('data-status', 'choose');
    await expect(orphans.nth(i).getByTestId('ids-new')).toHaveText('not chosen yet');
    await expect(orphans.nth(i).getByTestId('ids-reason')).toHaveText(
      '3 attached devices are called "WINWING MFD1". Press a button on the one these bindings belong to.'
    );
  }
  await expect(page.getByTestId('ids-preview')).toBeDisabled();
  await shot('nothing-guessed');

  const orphan = (old: string) => orphans.filter({ hasText: old.slice(0, 8) });
  const left = orphan(OLD.left);
  const centre = orphan(OLD.centre);
  const right = orphan(OLD.right);

  // The left panel's file: a press on another device is not taken, a press on the left panel is.
  await left.getByTestId('ids-identify').click();
  await expect(left.getByTestId('ids-identifying')).toBeVisible();
  await sendInput([controller(STICK), panel(6), panel(7), panel(8)]);
  await sendInput([controller(STICK, { pressed: [3] })]);
  await expect(left.getByTestId('ids-identifying')).toContainText('is not a "WINWING MFD1"');
  await left.scrollIntoViewIfNeeded();
  await shot('press-a-button-on-it');
  await sendInput([controller(STICK)]);
  await sendInput([panel(7, [5])]);
  await expect(left.getByTestId('ids-new')).toHaveText(NEW.left);
  await sendInput([panel(7)]);

  // The centre panel's file: pressing the left panel again is refused, it has its file.
  await centre.getByTestId('ids-identify').click();
  await expect(centre.getByTestId('ids-identifying')).toBeVisible();
  await sendInput([panel(7, [5])]);
  await expect(centre.getByTestId('ids-identifying')).toContainText('already chosen');
  await expect(centre.getByTestId('ids-new')).toHaveText('not chosen yet');
  await sendInput([panel(7)]);
  await sendInput([panel(6, [12])]);
  await expect(centre.getByTestId('ids-new')).toHaveText(NEW.centre);
  await sendInput([panel(6)]);

  await right.getByTestId('ids-identify').click();
  await expect(right.getByTestId('ids-identifying')).toBeVisible();
  await sendInput([panel(8, [1])]);
  await expect(right.getByTestId('ids-new')).toHaveText(NEW.right);
  await sendInput([panel(8)]);
  await shot('each-panel-chosen');

  await page.getByTestId('ids-preview').click();
  const plan = page.getByTestId('plan-dialog');
  await expect(plan).toBeVisible();
  await expect(plan).toContainText(
    'Move bindings of 3 devices to their current device IDs (6 files)'
  );
  await expect(plan.locator('[data-testid="plan-file"][data-action="rename"]')).toHaveCount(6);
  await expect(plan).toContainText(
    `WINWING MFD1 {${OLD.left}}.diff.lua → WINWING MFD1 {${NEW.left}}.diff.lua`
  );
  await shot('preview');
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toContainText('6 files, backed up first');
  await expect(orphans).toHaveCount(0);
  await shot('moved');

  // Each old file is now under the ID of the panel that was pressed for it, unchanged.
  const names = await fs.readdir(joystickDir(run));
  for (const key of ['left', 'centre', 'right'] as const) {
    expect(names).toContain(`WINWING MFD1 {${NEW[key]}}.diff.lua`);
    expect(
      await fs.readFile(path.join(joystickDir(run), `WINWING MFD1 {${NEW[key]}}.diff.lua`), 'utf8')
    ).toBe(before[key]);
  }
  expect(names.some((n) => n.includes('9AA7'))).toBe(false);

  await page.getByTestId('mode-fly').click();
  // A group that passes is collapsed: wait for the re-check before opening it.
  await expect(page.getByTestId('group-files')).toContainText('1 of 1 OK');
  await page.getByTestId('group-toggle-files').click();
  await expect(check).toHaveAttribute('data-status', 'pass');
});

test('names: identical controllers each show the name the owner gave them in DCS bindings, and Device IDs offers panels by those names', async ({
  rig,
}) => {
  // Two button boxes of one model: same name, same USB ids, told apart by serial and by
  // the DirectInput ID a game knows each one by.
  const twins = await rig.launch('devices-rig', 'devices-names-identical');
  const box = (serial: string, guid: string) => ({
    op: 'plugDevice' as const,
    device: {
      instanceId: `USB\\VID_1234&PID_ABCD\\${serial}`,
      vendorId: '1234',
      productId: 'ABCD',
      name: 'Button Box',
      serial,
      isHid: true,
      isGameController: true,
      isHub: false,
      hubChain: [],
    },
    controller: { name: 'Button Box', guid, vendorId: '1234', productId: 'ABCD' },
  });
  await twins.mutate([
    box('A1', 'AAAAAAAA-C0DE-11F1-8001-444553540000'),
    box('B2', 'BBBBBBBB-C0DE-11F1-8002-444553540000'),
  ]);
  await openDevices(twins.page);
  const boxes = deviceRow(twins.page, 'Button Box');
  await expect(boxes).toHaveCount(2);
  for (const name of ['Left box', 'Right box']) {
    const row = boxes.first();
    await row.locator('button').first().click();
    await row.getByTestId('device-rename').click();
    await twins.page.getByTestId('device-name-input').locator('input').fill(name);
    await twins.page.getByTestId('device-name-save').click();
    await expect(deviceRow(twins.page, name)).toBeVisible();
  }
  await expect(boxes).toHaveCount(0);
  await deviceRow(twins.page, 'Left box').scrollIntoViewIfNeeded();
  await twins.shot('devices-named');

  await openBindings(twins.page);
  const bound = twins.page.locator('[data-testid="ov-device"][data-device="Button Box"]');
  await expect(bound).toHaveCount(2);
  await expect(bound.locator('.rr-row-title')).toContainText([/Left box/, /Right box/]);
  await bound.first().scrollIntoViewIfNeeded();
  await twins.shot('bindings-overview');

  // Three panels with one name whose IDs all changed: the list to choose from leads with
  // the owner's names, so "which one is left" does not need a look at the IDs.
  const run = await rig.launch('dcs-bindings-identical', 'bindings-identical-names');
  const { page, shot, sendInput } = run;
  await openDevices(page);
  await nameDevice(page, 'WINWING MFD1-L', 'MFD left');
  await nameDevice(page, 'WINWING MFD1-R', 'MFD right');
  await page.getByTestId('nav-dcs-bindings').click();
  await page.getByTestId('bind-tab-device-ids').click();
  const orphan = page
    .locator('[data-testid="ids-orphan"][data-device="WINWING MFD1"]')
    .filter({ hasText: '4B3710E0' });
  await orphan.getByTestId('ids-target').click();
  const options = page.locator('.v-overlay--active .v-list-item');
  await expect(options.filter({ hasText: 'MFD left · WINWING MFD1 · A1A1A1A1' })).toHaveCount(1);
  await expect(options.filter({ hasText: 'MFD right · WINWING MFD1 · A3A3A3A3' })).toHaveCount(1);
  // The panel nobody named is listed as before.
  await expect(options.filter({ hasText: /^WINWING MFD1 · A2A2A2A2/ })).toHaveCount(1);
  await shot('choices-by-name');
  await page.keyboard.press('Escape');
  // Still chosen by pressing a button on the device; the name confirms which one it was.
  await orphan.getByTestId('ids-identify').click();
  await expect(orphan.getByTestId('ids-identifying')).toBeVisible();
  const panel = (index: number, pressed: number[] = []) =>
    controller({ index, name: 'WINWING MFD1', axes: 1, buttons: 50 }, { pressed });
  await sendInput([panel(6), panel(7), panel(8)]);
  await sendInput([panel(7, [5])]);
  await expect(orphan.getByTestId('ids-new')).toHaveText('A1A1A1A1-C0DE-11f1-8001-444553540000');
  await expect(orphan.getByTestId('ids-new-name')).toHaveText('MFD left');
  await shot('chosen-shows-the-name');
});

test('settings: the device notification choice is on the Settings page and is the same one as on Devices', async ({
  rig,
}) => {
  const run = await rig.launch('devices-rig', 'settings-device-notifications');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  const section = page.locator('[data-testid="settings-feature-section"][data-feature="devices"]');
  await expect(section.getByTestId('notify-mode')).toHaveAttribute('data-mode', 'controllers');
  await section.scrollIntoViewIfNeeded();
  await shot('settings');
  await section.getByText('Only what the current setup needs').click();
  await expect(section.getByTestId('notify-mode')).toHaveAttribute('data-mode', 'required');
  await expect
    .poll(async () => {
      const text = await fs.readFile(path.join(run.dataRoot, 'devices.json'), 'utf8');
      return (JSON.parse(text) as { notifications: string }).notifications;
    })
    .toBe('required');
  await shot('changed');

  await page.getByTestId('nav-devices').click();
  await expect(page.getByTestId('devices-controllers')).toBeVisible();
  const onDevices = page.getByTestId('devices-notifications');
  await expect(onDevices.getByTestId('notify-mode')).toHaveAttribute('data-mode', 'required');
  await onDevices.scrollIntoViewIfNeeded();
  await shot('devices-page');
});

test('capture: the program to launch can be picked from the games found on this PC, before a game is chosen', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch('flying-fresh', 'capture-launch-targets');
  await page.getByTestId('fly-create').click();
  const targets = page.getByTestId('capture-launch-targets');
  await expect(targets.getByTestId('capture-launch-target').first()).toBeVisible();
  const dcs = targets.locator('[data-testid="capture-launch-target"][data-game="DCS World"]');
  await expect(dcs).toBeVisible();
  await targets.scrollIntoViewIfNeeded();
  await shot('pick-list');
  await dcs.click();
  await expect(page.getByTestId('capture-launch-exe').locator('input')).toHaveValue(
    path.join(home, 'Program Files (x86)', 'Steam', 'steam.exe')
  );
  await expect(page.getByTestId('capture-launch-args').locator('input')).toHaveValue(
    '-applaunch 223750'
  );
  // Only what Launch starts was filled in: no game was chosen for the setup.
  await expect(page.getByTestId('capture-game')).toContainText('No particular game');
  await expect(targets).toHaveCount(0);
  await shot('picked');
});
