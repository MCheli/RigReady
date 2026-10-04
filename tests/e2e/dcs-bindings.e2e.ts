import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { checkRow, expect, test, type RunningApp } from './harness';

/** DCS bindings: views, edits, problems and fixes, device ID migration, copy, snapshots. */

const STICK = 'WINWING Orion Joystick Base 2 + JGRIP-F16';
const THROTTLE = 'WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R';
const WHEEL = 'FANATEC Podium Wheel Base DD2';
const STICK_ID = '806DDF00-B756-11f0-8023-444553540000';
const OLD_STICK_ID = 'D3437B70-A035-11EE-8001-444553540000';

const joystickDir = (run: RunningApp, aircraft = 'FA-18C_hornet'): string =>
  path.join(run.home, 'Saved Games', 'DCS', 'Config', 'Input', aircraft, 'joystick');

async function openBindings(page: Page, tab?: string): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-dcs-bindings').click();
  await expect(page.getByTestId('bind-overview')).toBeVisible();
  if (tab) await page.getByTestId(`bind-tab-${tab}`).click();
}

async function choose(page: Page, testId: string, option: string | RegExp): Promise<void> {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: option }).first().click();
}

/** Picks from a searchable list: type, then take the first match. */
async function pick(page: Page, testId: string, text: string): Promise<void> {
  const input = page.getByTestId(testId).locator('input[type="text"]');
  await input.click();
  await input.fill(text);
  await page.getByRole('option', { name: text }).first().click();
}

/** The stick as DirectInput reports it: 6 axes, 42 buttons, one hat. */
function stickState(buttons: number[] = [], hat: [number, number] = [0, 0], axes?: number[]) {
  return {
    index: 9,
    name: STICK,
    axes: axes ?? [0, 0, 0, 0, 0, 0],
    buttons: Array.from({ length: 42 }, (_, i) => buttons.includes(i + 1)),
    hats: [hat] as [number, number][],
    timestamp: Date.now(),
  };
}

const row = (page: Page, input: string) =>
  page.locator(`[data-testid="dev-row"][data-input="${input}"]`);

test('bindings: overview of an aircraft, per device and per action', async ({ rig }) => {
  const run = await rig.launch('dcs-bindings-hornet', 'bindings-overview');
  const { page, shot } = run;
  await openBindings(page);

  // The aircraft with bindings is shown first; every attached controller has a row.
  await expect(page.getByTestId('bindings-aircraft')).toContainText('F/A-18C');
  await expect(page.getByTestId('ov-device')).toHaveCount(12);
  const stick = page.locator(`[data-testid="ov-device"][data-device="${STICK}"]`);
  await expect(stick.getByTestId('ov-device-summary')).toContainText(
    '24 of yours · 6 DCS defaults'
  );
  await expect(stick.getByTestId('ov-role')).toContainText('Stick');
  // The racing wheel is plugged in too, and DCS put flight controls on it.
  const wheel = page.locator(`[data-testid="ov-device"][data-device="${WHEEL}"]`);
  await expect(wheel.getByTestId('ov-device-summary')).toContainText('12 DCS defaults');
  await expect(wheel.getByTestId('ov-device-problems')).toContainText('12 problems');
  await expect(page.getByTestId('ov-tile-defaults')).toHaveAttribute('data-count', '12');
  await expect(page.getByTestId('ov-tile-conflicts')).toHaveAttribute('data-count', '0');
  await expect(page.getByTestId('ov-tile-important')).toHaveAttribute('data-count', '0');
  await expect(page.getByTestId('ov-uneditable')).toContainText('engine commands');
  await shot('overview');

  // Per action: search by name, filter to bound or unbound.
  await page.getByTestId('bind-tab-actions').click();
  await expect(page.getByTestId('act-summary')).toContainText('of 1072 actions shown');
  await page.getByTestId('act-search').locator('input').fill('trimmer switch');
  await expect(page.getByTestId('act-row')).toHaveCount(4);
  const trimUp = page.locator(
    '[data-testid="act-row"][data-action="Trimmer Switch - PUSH(DESCEND)"]'
  );
  await expect(trimUp.getByTestId('act-binding')).toHaveCount(2);
  await expect(trimUp).toContainText('Orion Joystick Base 2 + JGRIP-F16 Hat 1 up');
  await expect(trimUp).toContainText('Keyboard RCtrl + ;');
  await shot('actions-search');
  await page.getByTestId('act-search').locator('input').fill('sensor control');
  await page.getByTestId('act-filter-unbound').click();
  // Only the press of the switch is not on any device.
  await expect(page.getByTestId('act-row')).toHaveCount(1);
  await expect(page.getByTestId('act-row')).toContainText('Sensor Control Switch - Depress');
  await page.getByTestId('act-filter-bound').click();
  await expect(page.getByTestId('act-row')).toHaveCount(4);
  await page.getByTestId('act-search').locator('input').fill('no such action anywhere');
  await expect(page.getByTestId('act-empty')).toBeVisible();
  await page.getByTestId('act-search').locator('input').fill('');
  await page.getByTestId('act-filter-unbound').click();
  await pick(page, 'act-category', 'Left Console');
  await expect(page.getByTestId('act-row').first()).toContainText('Not bound');
  await shot('actions-unbound');

  // The other aircraft has never been bound: DCS's defaults sit on every device.
  await choose(page, 'bindings-aircraft', /^UH-1H DCS defaults only/);
  await page.getByTestId('bind-tab-overview').click();
  await expect(page.getByTestId('ov-tile-defaults')).not.toHaveAttribute('data-count', '0');
  const mfd = page.locator('[data-testid="ov-device"][data-device="WINWING MFD1-L"]');
  await expect(mfd.getByTestId('ov-device-summary')).toContainText('4 DCS defaults');
  await shot('overview-huey');
});

test('bindings: every control of a device and what it does (UFC1 + HUD1)', async ({ rig }) => {
  const run = await rig.launch('dcs-bindings-hornet', 'bindings-device');
  const { page, shot } = run;
  await openBindings(page);
  const ufc = page.locator('[data-testid="ov-device"][data-device="WINWING UFC1 + HUD1"]');
  await ufc.getByTestId('ov-open-device').click();

  await expect(page.getByTestId('dev-select')).toContainText('WINWING UFC1 + HUD1');
  await expect(page.getByTestId('dev-meta')).toContainText('Attached');
  await expect(page.getByTestId('dev-meta')).toContainText('806E0610-B756-11f0-8026-444553540000');
  // Every control is listed: 8 axes and 128 buttons, bound or not.
  await expect(page.getByTestId('dev-row')).toHaveCount(136);
  await expect(row(page, 'JOY_BTN2')).toContainText('UFC Keyboard Pushbutton - 1');
  await expect(row(page, 'JOY_BTN2')).toContainText('Yours');
  await expect(row(page, 'JOY_BTN13')).toContainText('UFC Keyboard Pushbutton - ENT');
  await expect(row(page, 'JOY_RZ')).toContainText('UFC Brightness Control Knob');
  await expect(row(page, 'JOY_BTN33')).toContainText('Not bound');
  await shot('ufc');

  await page.getByTestId('dev-bound-only').locator('input').check();
  await expect(page.getByTestId('dev-row')).toHaveCount(59);
  // Defaults DCS put on controls this panel does not have are counted, not hidden.
  await page.getByTestId('dev-toggle-inert').click();
  await expect(page.getByTestId('dev-inert')).toContainText('View Up slow');
  await expect(page.getByTestId('dev-inert')).toContainText('this device has no such control');
  await shot('ufc-bound-only');

  // The stick: defaults and the user's bindings side by side, modifiers and cancelled defaults.
  await pick(page, 'dev-select', STICK);
  await expect(row(page, 'JOY_X')).toContainText('Roll');
  await expect(row(page, 'JOY_X')).toContainText('DCS default');
  await expect(row(page, 'JOY_Y')).toContainText('DCS default with your curve');
  await expect(row(page, 'JOY_BTN_POV1_U')).toContainText('Trimmer Switch - PUSH(DESCEND)');
  await page.getByTestId('dev-toggle-removed').click();
  await expect(page.getByTestId('dev-removed')).toContainText('View Up slow');
  await shot('stick');

  // The keyboard is shown for reference.
  await pick(page, 'dev-select', 'Keyboard');
  await expect(page.getByTestId('dev-readonly')).toBeVisible();
  await expect(page.getByTestId('dev-bind')).toHaveCount(0);
});

test('bindings: edit by pressing the control, stage, review, save and undo', async ({ rig }) => {
  const run = await rig.launch('dcs-bindings-hornet', 'bindings-edit');
  const { page, shot } = run;
  const dir = joystickDir(run);
  const stickFile = path.join(dir, `${STICK} {${STICK_ID}}.diff.lua`);
  const original = await fs.readFile(stickFile, 'utf8');
  await openBindings(page, 'devices');
  await pick(page, 'dev-select', STICK);

  // 1. Clear a binding of the user's and a DCS default: both are only staged.
  await row(page, 'JOY_BTN19').getByTestId('dev-clear').click();
  await row(page, 'JOY_BTN_POV1_UR').getByTestId('dev-clear').click();
  await expect(page.getByTestId('bind-staged-item')).toHaveCount(2);
  await expect(row(page, 'JOY_BTN19').getByTestId('dev-row-staged')).toBeVisible();
  expect(await fs.readFile(stickFile, 'utf8')).toBe(original);

  // 2. Bind an action by pressing the button on the device.
  await page.getByTestId('bind-tab-actions').click();
  await page.getByTestId('act-search').locator('input').fill('master arm switch - arm/safe');
  await page.getByTestId('act-bind').first().click();
  await expect(page.getByTestId('bind-dialog')).toBeVisible();
  await page.getByTestId('bind-listen').click();
  await expect(page.getByTestId('bind-listening')).toBeVisible();
  await shot('press-the-control');
  await run.sendInput([stickState()]);
  // Moving an axis does not count when a button is wanted.
  await run.sendInput([stickState([], [0, 0], [0.9, 0, 0, 0, 0, 0])]);
  await expect(page.getByTestId('bind-listening')).toBeVisible();
  await run.sendInput([stickState([20])]);
  await expect(page.getByTestId('bind-device')).toContainText(STICK);
  await expect(page.getByTestId('bind-input')).toContainText('Button 20');
  // Button 20 is the weapon release: the dialog says it will be moved.
  await expect(page.getByTestId('bind-taken')).toContainText(
    'Button 20 now does "Weapon Release Button"'
  );
  await shot('bind-dialog');
  await page.getByTestId('bind-save').click();
  await expect(page.getByTestId('bind-staged-item')).toHaveCount(3);

  // 3. Bind from the list, with a modifier.
  await page.getByTestId('act-search').locator('input').fill('cage/uncage');
  await page.getByTestId('act-bind').first().click();
  await pick(page, 'bind-device', STICK);
  await pick(page, 'bind-input', 'Button 5');
  await choose(page, 'bind-modifiers', 'LCtrl');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('bind-taken')).toHaveCount(0);
  await page.getByTestId('bind-save').click();
  await expect(page.getByTestId('bind-staged-item')).toHaveCount(4);
  await shot('staged');

  // 4. Review: the exact change, then save.
  await page.getByTestId('bind-review').click();
  const dialog = page.getByTestId('plan-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Change 5 bindings for F/A-18C');
  await expect(dialog.getByTestId('plan-file')).toHaveCount(1);
  await expect(dialog).toContainText('View Center: remove Button 19');
  await expect(dialog).toContainText("View Up Right slow: cancel DCS's default Hat 1 up-right");
  await expect(dialog).toContainText('Weapon Release Button: remove Button 20');
  await expect(dialog).toContainText('Master Arm Switch - ARM/SAFE: bind Button 20');
  await expect(dialog).toContainText('Cage/Uncage Button: bind LCtrl + Button 5');
  await dialog.getByTestId('plan-toggle-diff').click();
  await expect(dialog.getByTestId('plan-diff')).toContainText('+ ');
  await expect(dialog.getByTestId('plan-diff')).toContainText('["key"] = "JOY_BTN20",');
  await shot('review');
  await dialog.getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toContainText(
    'Saved: Change 5 bindings for F/A-18C'
  );
  await expect(page.getByTestId('bind-staged')).toHaveCount(0);

  const written = await fs.readFile(stickFile, 'utf8');
  expect(written).not.toBe(original);
  expect(written).toContain('["name"] = "Master Arm Switch - ARM/SAFE",');
  expect(written).toContain('[1] = "LCtrl",');
  await page.getByTestId('bind-tab-devices').click();
  await expect(row(page, 'JOY_BTN20')).toContainText('Master Arm Switch - ARM/SAFE');
  await expect(row(page, 'JOY_BTN19')).toContainText('Not bound');
  // In plain language, with DCS's own name beside it.
  await expect(row(page, 'JOY_BTN5')).toContainText('LCtrl + Cage / uncage');
  await expect(row(page, 'JOY_BTN5')).toContainText('Cage/Uncage Button');
  await shot('saved');

  // 5. The change is on the Safety page, and Undo here puts the file back byte for byte.
  await page.getByTestId('bind-undo').click();
  await expect(page.getByTestId('bind-saved')).toContainText('Undone: Change 5 bindings');
  expect(await fs.readFile(stickFile, 'utf8')).toBe(original);
  await expect(row(page, 'JOY_BTN19')).toContainText('View Center');
  await page.getByTestId('nav-safety').click();
  await expect(
    page.locator('[data-testid="change-group"][data-reason="Change 5 bindings for F/A-18C"]')
  ).toHaveAttribute('data-undone', 'true');
});

test('bindings: an axis with curve, deadzone, saturation, invert and slider', async ({ rig }) => {
  const run = await rig.launch('dcs-bindings-hornet', 'bindings-axis');
  const { page, shot } = run;
  await openBindings(page, 'devices');
  await pick(page, 'dev-select', STICK);

  // The pitch axis has the user's curve of 15.
  await row(page, 'JOY_Y').getByTestId('dev-curve').click();
  const dialog = page.getByTestId('bind-dialog');
  await expect(dialog).toContainText('Pitch');
  await expect(dialog.getByTestId('bind-curvature').locator('input')).toHaveValue('15');
  const flat = await dialog.getByTestId('bind-curve').locator('polyline').getAttribute('points');
  await dialog.getByTestId('bind-curvature').locator('input').fill('40');
  await dialog.getByTestId('bind-deadzone').locator('input').fill('5');
  await dialog.getByTestId('bind-saturation-y').locator('input').fill('80');
  await dialog.getByTestId('bind-invert').locator('input').check();
  // The preview curve follows the values.
  await expect(dialog.getByTestId('bind-curve').locator('polyline')).not.toHaveAttribute(
    'points',
    flat ?? ''
  );
  await shot('curve');
  await dialog.getByTestId('bind-save').click();

  // Bind an axis by moving it: the slider on the stick base to the zoom axis.
  await page.getByTestId('bind-tab-actions').click();
  await page.getByTestId('act-search').locator('input').fill('zoom view');
  await page
    .locator('[data-testid="act-row"][data-action="Zoom View"]')
    .getByTestId('act-bind')
    .click();
  await page.getByTestId('bind-listen').click();
  await expect(page.getByTestId('bind-listening')).toContainText('axis');
  await run.sendInput([stickState()]);
  await run.sendInput([stickState([], [0, 0], [0, 0, 0, 0, 0, 0.9])]);
  await expect(page.getByTestId('bind-input')).toContainText('Slider 1');
  // The slider is the wheel brake now.
  await expect(page.getByTestId('bind-taken')).toContainText('Wheel Brake');
  await page.getByTestId('bind-slider').locator('input').check();
  await shot('axis-by-moving');
  await page.getByTestId('bind-save').click();

  await page.getByTestId('bind-review').click();
  const plan = page.getByTestId('plan-dialog');
  await expect(plan).toContainText(
    'Pitch: set Y axis to curve 0.4, deadzone 0.05, saturation Y 0.8, inverted'
  );
  await expect(plan).toContainText('Wheel Brake: remove Slider 1');
  await expect(plan).toContainText('Zoom View: bind Slider 1 (slider)');
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toBeVisible();
  const text = await fs.readFile(
    path.join(joystickDir(run), `${STICK} {${STICK_ID}}.diff.lua`),
    'utf8'
  );
  expect(text).toContain('[1] = 0.4,');
  expect(text).toContain('["invert"] = true,');
  expect(text).toContain('["saturationY"] = 0.8,');
  expect(text).toContain('["slider"] = true,');
});

test('bindings: problems found and fixed with a preview', async ({ rig }) => {
  const run = await rig.launch('dcs-bindings-hornet', 'bindings-problems');
  const { page, shot } = run;
  await openBindings(page, 'problems');
  await expect(page.getByTestId('bind-problem-count')).toHaveText('29');

  // Unwanted defaults: the racing wheel flies the Hornet.
  const group = page.locator(`[data-testid="prob-defaults-device"][data-device="${WHEEL}"]`);
  await expect(group.getByTestId('prob-default')).toHaveCount(12);
  await expect(group).toContainText('Y axis → Pitch');
  await expect(group).toContainText('Pitch on a device not used in DCS');
  await expect(group.getByTestId('prob-role')).toContainText('Not used in DCS');
  // One action bound more than once: the two View Center buttons, radar elevation on two devices.
  const center = page.locator('[data-testid="prob-duplicate"][data-action="View Center"]');
  await expect(center.getByTestId('prob-occurrence')).toHaveCount(2);
  await shot('problems');

  // The device's role decides what is unwanted: as "something else" nothing is.
  await choose(page, 'prob-role', 'Something else');
  await expect(page.getByTestId('prob-defaults')).toHaveCount(0);
  await page.getByTestId('bind-tab-overview').click();
  const wheel = page.locator(`[data-testid="ov-device"][data-device="${WHEEL}"]`);
  await wheel.getByTestId('ov-role').click();
  await page.getByRole('option', { name: 'Not used in DCS' }).click();
  await page.getByTestId('bind-tab-problems').click();
  await expect(group.getByTestId('prob-default')).toHaveCount(12);

  // Clean up: preview first, then one file is created for the wheel.
  await page.getByTestId('prob-cleanup').click();
  const plan = page.getByTestId('plan-dialog');
  await expect(plan).toContainText('Clean up 12 unwanted default bindings (F/A-18C)');
  await expect(plan.getByTestId('plan-file')).toHaveAttribute('data-action', 'create');
  await expect(plan).toContainText(`${WHEEL} {20B0BED0-03A4-11f1-8001-444553540000}.diff.lua`);
  await expect(plan).toContainText("Pitch: cancel DCS's default Y axis");
  await shot('cleanup-preview');
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toContainText(
    'Clean up 12 unwanted default bindings'
  );
  await expect(page.getByTestId('prob-defaults')).toHaveCount(0);
  const created = await fs.readFile(
    path.join(joystickDir(run), `${WHEEL} {20B0BED0-03A4-11f1-8001-444553540000}.diff.lua`),
    'utf8'
  );
  expect(created).toContain('["a2001cdnil"] = {\n\t\t\t["name"] = "Pitch",\n\t\t\t["removed"] = {');
  // Pitch is no longer bound on two devices.
  await expect(page.locator('[data-testid="prob-duplicate"][data-action="Pitch"]')).toHaveCount(0);
  await page.getByTestId('bind-saved-dismiss').click();

  // Intentional multiples are marked expected and stop counting.
  await center.getByTestId('prob-expected').click();
  await expect(center).toHaveCount(0);
  await expect(page.getByTestId('prob-show-expected')).toContainText('Show 1 expected');

  // "Keep only this one" clears the other occurrences as one change.
  const tdc = page.locator(
    '[data-testid="prob-duplicate"][data-action="Throttle Designator Controller - Depress"]'
  );
  await expect(tdc.getByTestId('prob-occurrence')).toHaveCount(2);
  await tdc.getByTestId('prob-occurrence').nth(1).getByTestId('prob-keep-only').click();
  await expect(plan).toContainText('Throttle Designator Controller - Depress: remove Button 26');
  await plan.getByTestId('plan-apply').click();
  await expect(tdc).toHaveCount(0);
  await shot('after-fixes');

  // Every aircraft at once: the Huey has DCS's four default buttons on every device.
  await choose(page, 'bindings-aircraft', /^UH-1H/);
  await expect(page.getByTestId('prob-defaults-device')).toHaveCount(10);
  const important = page.getByTestId('prob-important');
  await expect(important).toContainText('Armament Off/Safe/Armed');
  await expect(important).toContainText('Keyboard: RShift + [');
  await shot('huey-problems');
  await page.getByTestId('prob-cleanup-all').click();
  await expect(plan).toContainText('unwanted default bindings on 1 aircraft');
  await expect(plan.getByTestId('plan-file')).toHaveCount(10);
  await shot('cleanup-all-preview');
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('prob-defaults')).toHaveCount(0);
  expect((await fs.readdir(joystickDir(run, 'UH-1H'))).length).toBe(10);

  // An important action that is not bound: its Bind button opens the dialog on its actions.
  await page
    .locator('[data-testid="prob-unbound"][data-item="Engine start"]')
    .getByTestId('prob-bind')
    .click();
  await expect(page.getByTestId('bind-dialog')).toBeVisible();
  await expect(page.getByTestId('bind-action')).toContainText('Start-up engine');
  await page.getByTestId('bind-cancel').click();
});

test('bindings: clear a whole device, with the count stated first', async ({ rig }) => {
  const run = await rig.launch('dcs-bindings-hornet', 'bindings-clear-device');
  const { page, shot } = run;
  const file = path.join(
    joystickDir(run),
    'WINWING MFD1-R {806E0610-B756-11f0-8024-444553540000}.diff.lua'
  );
  const original = await fs.readFile(file, 'utf8');
  await openBindings(page, 'devices');
  await pick(page, 'dev-select', 'WINWING MFD1-R');
  await page.getByTestId('dev-clear-all').click();
  const confirm = page.getByTestId('dev-clear-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('This removes all 26 bindings on this device for F/A-18C');
  await shot('confirm');
  await confirm.getByTestId('dev-clear-confirm-yes').click();
  const plan = page.getByTestId('plan-dialog');
  await expect(plan).toContainText('Clear all 26 bindings on WINWING MFD1-R (F/A-18C)');
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toBeVisible();
  await page.getByTestId('dev-bound-only').locator('input').check();
  await expect(page.getByTestId('dev-empty')).toContainText('Nothing is bound on this device');
  await shot('cleared');

  // Undo from the Safety page.
  await page.getByTestId('nav-safety').click();
  const change = page.locator(
    '[data-testid="change-group"][data-reason="Clear all 26 bindings on WINWING MFD1-R (F/A-18C)"]'
  );
  await change.getByTestId('change-undo').click();
  await expect(page.getByTestId('safety-message')).toContainText('Undid "Clear all 26 bindings');
  expect(await fs.readFile(file, 'utf8')).toBe(original);
});

test('bindings: nothing is saved while DCS is running', async ({ rig }) => {
  const run = await rig.launch('dcs-bindings-dcs-running', 'bindings-dcs-running');
  const { page, shot } = run;
  await openBindings(page, 'devices');
  await expect(page.getByTestId('bind-dcs-running')).toContainText('DCS is running');
  await pick(page, 'dev-select', STICK);
  await row(page, 'JOY_BTN19').getByTestId('dev-clear').click();
  await page.getByTestId('bind-review').click();
  const plan = page.getByTestId('plan-dialog');
  await expect(plan.getByTestId('plan-blocked')).toContainText(
    'It keeps bindings in memory and writes them back'
  );
  await expect(plan.getByTestId('plan-apply')).toBeDisabled();
  await shot('blocked');
  await plan.getByTestId('plan-cancel').click();

  // Once DCS is closed the same staged change can be saved.
  await run.mutate([{ op: 'stopProcess', name: 'DCS.exe' }]);
  await expect(page.getByTestId('bind-dcs-running')).toHaveCount(0);
  await page.getByTestId('bind-review').click();
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toBeVisible();
});

test('bindings: Windows changed the device IDs; move the bindings back, and undo', async ({
  rig,
}) => {
  const run = await rig.launch('dcs-bindings-old-ids', 'bindings-migration');
  const { page, shot } = run;

  // Fly mode warns, without blocking, and its fix opens the Device IDs screen.
  const check = checkRow(page, 'DCS bindings match devices (F/A-18C)');
  await expect(check).toHaveAttribute('data-status', 'warn');
  await expect(check).toContainText('Bindings for 10 devices belong to old device IDs');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
  await shot('fly-warning');
  // The item's own button opens the screen where the move is previewed.
  await check.getByTestId('check-fix').click();
  await expect(page.getByTestId('bind-device-ids')).toBeVisible();

  await expect(page.getByTestId('ids-orphan')).toHaveCount(10);
  const stick = page.locator(`[data-testid="ids-orphan"][data-device="${STICK}"]`);
  await expect(stick).toHaveAttribute('data-status', 'ready');
  await expect(stick.getByTestId('ids-old')).toHaveText('D3437B70-A035-11ee-8001-444553540000');
  await expect(stick.getByTestId('ids-new')).toHaveText(STICK_ID);
  await expect(stick).toContainText('2 files in FA-18C_hornet, UH-1H');
  await expect(stick).toContainText('also named in 1 modifier or settings file');
  await shot('device-ids');

  // The attached devices show no bindings of the user's, and the old files are listed apart.
  await page.getByTestId('bind-tab-overview').click();
  await expect(page.getByTestId('bind-stale-ids')).toContainText(
    '10 devices belong to an old device ID'
  );
  await expect(page.getByTestId('ov-file-device')).toHaveCount(10);
  await expect(page.getByTestId('ov-modifier-stale')).toBeVisible();
  await shot('overview-before');
  await page.getByTestId('ov-modifiers').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('ov-modifiers')).toContainText(
    'Button 3 on WINWING Orion Joystick Base 2 + JGRIP-F16'
  );
  await shot('modifier-on-old-id');
  await page.getByTestId('bind-open-device-ids').click();

  // Leave one device out, then pick it by pressing a button on it.
  await stick.getByTestId('ids-move').locator('input').uncheck();
  await expect(stick.getByTestId('ids-new')).toHaveText('not chosen yet');
  await expect(page.getByTestId('ids-preview')).toContainText('Preview moving 9 devices');
  await stick.getByTestId('ids-identify').click();
  await expect(stick.getByTestId('ids-identifying')).toBeVisible();
  await stick.scrollIntoViewIfNeeded();
  await shot('press-a-button-on-it');
  // A button on another device is not accepted for this one.
  await run.sendInput([{ ...stickState(), index: 2, name: 'T-Pendular-Rudder' }]);
  await run.sendInput([stickState()]);
  await run.sendInput([stickState([3])]);
  await expect(stick.getByTestId('ids-new')).toHaveText(STICK_ID);
  await expect(page.getByTestId('ids-preview')).toContainText('Preview moving 10 devices');

  await page.getByTestId('ids-preview').click();
  const plan = page.getByTestId('plan-dialog');
  await expect(plan).toContainText(
    'Move bindings of 10 devices to their current device IDs (20 files)'
  );
  await expect(plan.locator('[data-testid="plan-file"][data-action="rename"]')).toHaveCount(20);
  await expect(plan.locator('[data-testid="plan-file"][data-action="change"]')).toHaveCount(1);
  await expect(plan).toContainText(
    `${STICK} {${OLD_STICK_ID}}.diff.lua → ${STICK} {${STICK_ID}}.diff.lua`
  );
  await expect(plan).toContainText('modifiers.lua · FA-18C_hornet');
  await shot('preview');
  await plan.getByTestId('plan-apply').click();

  await expect(page.getByTestId('bind-saved')).toContainText('21 files, backed up first');
  await expect(page.getByTestId('ids-none')).toContainText(
    'Every binding file belongs to an attached device'
  );
  await shot('moved');
  const names = await fs.readdir(joystickDir(run));
  expect(names).toContain(`${STICK} {${STICK_ID}}.diff.lua`);
  expect(names.some((n) => n.includes('9AA7') || n.includes('A035'))).toBe(false);
  expect(await fs.readdir(joystickDir(run, 'UH-1H'))).toContain(`${STICK} {${STICK_ID}}.diff.lua`);
  const modifiers = await fs.readFile(path.join(joystickDir(run), '..', 'modifiers.lua'), 'utf8');
  expect(modifiers).toContain(`${STICK} {${STICK_ID}}`);

  // The bindings are back on the attached devices, in both aircraft.
  await page.getByTestId('bind-tab-overview').click();
  await expect(page.getByTestId('ov-files-only')).toHaveCount(0);
  const stickRow = page.locator(`[data-testid="ov-device"][data-device="${STICK}"]`);
  await expect(stickRow.getByTestId('ov-device-summary')).toContainText('of yours');
  await shot('overview-after');
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('group-files')).toContainText('1 of 1 OK');
  await page.getByTestId('group-toggle-files').click();
  await expect(check).toHaveAttribute('data-status', 'pass');
  await expect(check).toContainText('10 connected devices have bindings for F/A-18C');
  await shot('fly-ok');

  // One action on the Safety page; undoing it puts all 21 files back.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-safety').click();
  const change = page.locator('[data-testid="change-group"]').first();
  await expect(change).toContainText('Move bindings of 10 devices');
  await change.getByTestId('change-undo').click();
  await expect(page.getByTestId('safety-message')).toContainText(
    'Undid "Move bindings of 10 devices'
  );
  expect(await fs.readdir(joystickDir(run))).toContain(`${STICK} {${OLD_STICK_ID}}.diff.lua`);
  await shot('undone');
});

test('bindings: copy common controls from the F/A-18C to the UH-1H', async ({ rig }) => {
  const run = await rig.launch('dcs-bindings-hornet', 'bindings-copy');
  const { page, shot } = run;
  await openBindings(page, 'copy');
  await expect(page.getByTestId('copy-target')).toContainText('UH-1H');
  // Stick, throttle and pedals are ticked; panels are not.
  await expect(
    page.locator(`[data-testid="copy-device"][data-device="${STICK}"] input`)
  ).toBeChecked();
  await expect(
    page.locator('[data-testid="copy-device"][data-device="WINWING UFC1 + HUD1"] input')
  ).not.toBeChecked();
  await page.getByTestId('copy-find').click();

  const proposal = (input: string, nth = 0) =>
    page.locator(`[data-testid="copy-proposal"][data-input="${input}"]`).nth(nth);
  await expect(proposal('Button 19')).toContainText('Center View');
  await expect(proposal('Button 19')).toContainText('Same DCS command');
  await expect(proposal('Button 19').locator('input')).toBeChecked();
  // The trigger: same kind of control; it would replace the Huey's default on that button.
  await expect(proposal('Button 5')).toContainText('Pilot weapon release/Machinegun fire');
  await expect(proposal('Button 5').getByTestId('copy-replaces')).toContainText('Center View');
  // The Huey has no trim hat; force trim is offered, not ticked.
  const trim = page.locator('[data-testid="copy-proposal"][data-match="closest"]');
  await expect(trim).toHaveCount(4);
  await expect(trim.first().locator('input')).not.toBeChecked();
  await page.getByTestId('copy-toggle-unmatched').click();
  await expect(page.getByTestId('copy-unmatched')).toContainText('Sensor Control Switch - Fwd');
  await shot('proposals');
  await page.getByTestId('copy-toggle-unmatched').click();
  await proposal('Hat 1 up').locator('input').check();

  await page.getByTestId('copy-review').click();
  const plan = page.getByTestId('plan-dialog');
  await expect(plan).toContainText('from F/A-18C to UH-1H');
  await expect(plan.getByTestId('plan-file')).toHaveCount(2);
  await expect(plan).toContainText('Pilot Trimmer: bind Hat 1 up');
  await shot('preview');
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toContainText('from F/A-18C to UH-1H');
  // What was copied is now marked as already there.
  await expect(proposal('Button 19')).toContainText('Already bound like this');

  await choose(page, 'bindings-aircraft', /^UH-1H/);
  await page.getByTestId('bind-tab-devices').click();
  await pick(page, 'dev-select', STICK);
  await expect(row(page, 'JOY_BTN19')).toContainText('Center View');
  await expect(row(page, 'JOY_BTN_POV1_U')).toContainText('Pilot Trimmer');
  await expect(row(page, 'JOY_BTN5')).toContainText('Pilot weapon release/Machinegun fire');
  await pick(page, 'dev-select', THROTTLE);
  await expect(row(page, 'JOY_BTN42')).toContainText('Zoom in slow');
  await shot('huey-throttle');
});

test('bindings: snapshots, compare with now, and restore', async ({ rig }) => {
  const run = await rig.launch('dcs-bindings-hornet', 'bindings-snapshots');
  const { page, shot, dataRoot } = run;
  await openBindings(page, 'snapshots');
  await expect(page.getByTestId('snap-empty')).toBeVisible();
  await expect(page.getByTestId('snap-create')).toBeDisabled();
  await page.getByTestId('snap-name').locator('input').fill('Before experimenting');
  await page.getByTestId('snap-create').click();
  await expect(page.getByTestId('snap-message')).toContainText(
    'Snapshot "Before experimenting" taken: 11 files'
  );
  await expect(page.getByTestId('snap-meta')).toContainText('FA-18C_hornet · 11 files');
  await expect(page.getByTestId('snap-meta')).toContainText('11 devices · DCS 2.9.28.26283');
  await fs.access(path.join(dataRoot, 'snapshots', 'dcs', 'before-experimenting', 'snapshot.json'));

  // Change something: clear the left MFD frame.
  await page.getByTestId('bind-tab-devices').click();
  await pick(page, 'dev-select', 'WINWING MFD1-L');
  await page.getByTestId('dev-clear-all').click();
  await page.getByTestId('dev-clear-confirm-yes').click();
  await page.getByTestId('plan-dialog').getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toBeVisible();
  await page.getByTestId('bind-saved-dismiss').click();

  // Compare the snapshot with now.
  await page.getByTestId('bind-tab-snapshots').click();
  await page.getByTestId('snap-compare').click();
  const diff = page.locator('[data-testid="snap-diff"][data-device="WINWING MFD1-L"]');
  await expect(diff.getByTestId('snap-removed')).toContainText('Left MDI PB 5: Button 1');
  await expect(page.getByTestId('snap-diff')).toHaveCount(1);
  await shot('compare');

  // A second snapshot can be compared with the first, renamed and deleted.
  await page.getByTestId('snap-name').locator('input').fill('Second');
  await page.getByTestId('snap-scope-all').click();
  await page.getByTestId('snap-create').click();
  await expect(page.getByTestId('snap-row')).toHaveCount(2);
  const second = page.locator('[data-testid="snap-row"][data-name="Second"]');
  await second.getByTestId('snap-rename').click();
  await page.getByTestId('snap-rename-input').locator('input').fill('MFD cleared');
  await page.getByTestId('snap-rename-save').click();
  const renamed = page.locator('[data-testid="snap-row"][data-name="MFD cleared"]');
  await expect(renamed).toContainText('All aircraft');
  await choose(page, 'snap-compare-with', 'snapshot "MFD cleared"');
  await expect(diff.getByTestId('snap-removed')).toContainText('Left MDI PB 5: Button 1');
  await renamed.getByTestId('snap-delete').click();
  await page.getByTestId('snap-delete-yes').click();
  await expect(page.getByTestId('snap-row')).toHaveCount(1);

  // Restore: preview, then the bindings are back.
  await page.getByTestId('snap-restore').click();
  await expect(page.getByTestId('snap-restore-dialog')).toBeVisible();
  await expect(page.getByTestId('snap-remap').locator('input')).toBeChecked();
  await shot('restore-dialog');
  await page.getByTestId('snap-restore-preview').click();
  const plan = page.getByTestId('plan-dialog');
  await expect(plan).toContainText('Restore binding snapshot "Before experimenting"');
  await expect(plan.getByTestId('plan-file')).toHaveCount(1);
  await expect(plan.getByTestId('plan-file')).toHaveAttribute('data-action', 'create');
  await shot('restore-preview');
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toContainText('Restore binding snapshot');
  await expect(page.getByTestId('snap-same')).toContainText('No differences');
  await page.getByTestId('bind-tab-devices').click();
  await expect(row(page, 'JOY_BTN1')).toContainText('Left MDI PB 5');
});

test('bindings: actions read in plain language, with the name DCS uses beside them, and are found by either', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('dcs-bindings-hornet', 'bindings-plain-labels');
  await openBindings(page, 'actions');
  // Found by the plain words...
  await page.getByTestId('act-search').locator('input').fill('trim nose');
  const down = page.locator(
    '[data-testid="act-row"][data-action="Trimmer Switch - PUSH(DESCEND)"]'
  );
  await expect(down.getByTestId('act-title')).toHaveText('Trim nose down');
  await expect(down.getByTestId('act-dcs-name')).toHaveText(
    'DCS calls it: Trimmer Switch - PUSH(DESCEND)'
  );
  await expect(page.getByTestId('act-row')).toHaveCount(2);
  await shot('plain-labels');
  // ...and by DCS's own.
  await page.getByTestId('act-search').locator('input').fill('trimmer switch');
  await expect(page.getByTestId('act-row')).toHaveCount(4);
  // An action without a label of its own shows DCS's name alone.
  await page.getByTestId('act-search').locator('input').fill('canopy');
  await expect(page.getByTestId('act-row').first().getByTestId('act-dcs-name')).toHaveCount(0);

  // The device view names what each control does the same way.
  await page.getByTestId('bind-tab-overview').click();
  await page
    .locator(`[data-testid="ov-device"][data-device="${STICK}"]`)
    .getByTestId('ov-open-device')
    .click();
  await expect(page.getByTestId('dev-dcs-name').first()).toBeVisible();
  await shot('device-plain-labels');
});
