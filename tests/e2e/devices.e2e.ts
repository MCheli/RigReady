import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/**
 * Hardware troubleshooting on the recorded rig: the Devices list, Find a device, names,
 * the input tester, the hands-off health check, the USB map, HidHide and missing devices.
 */

/** Controllers as DirectInput lists them in fixtures/rigs/mark-full/input.json. */
const CONTROLLERS = {
  dd2: { index: 0, name: 'FANATEC Podium Wheel Base DD2', axes: 8, buttons: 108, hats: 1 },
  startup: { index: 3, name: 'WINWING F18 STARTUP PANEL', axes: 2, buttons: 57, hats: 0 },
  icp: { index: 5, name: 'WINWING ICP', axes: 4, buttons: 34, hats: 0 },
  mfdRight: { index: 8, name: 'WINWING MFD1-R', axes: 1, buttons: 50, hats: 0 },
  stick: {
    index: 9,
    name: 'WINWING Orion Joystick Base 2 + JGRIP-F16',
    axes: 6,
    buttons: 42,
    hats: 1,
  },
  throttle: {
    index: 10,
    name: 'WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R',
    axes: 7,
    buttons: 62,
    hats: 0,
  },
} as const;
type Controller = (typeof CONTROLLERS)[keyof typeof CONTROLLERS];

let clock = 1_000;
function state(
  c: Controller,
  input: { pressed?: number[]; axes?: Record<number, number>; hat?: [number, number] } = {}
) {
  return {
    index: c.index,
    name: c.name,
    axes: Array.from({ length: c.axes }, (_, i) => input.axes?.[i] ?? 0),
    // Buttons as games number them: Button 1 is index 0.
    buttons: Array.from({ length: c.buttons }, (_, i) => input.pressed?.includes(i + 1) ?? false),
    hats: Array.from({ length: c.hats }, (): [number, number] => input.hat ?? [0, 0]),
    timestamp: clock++,
  };
}

async function openDevices(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-devices').click();
  await expect(page.getByTestId('devices-controllers')).toBeVisible();
}

const deviceRow = (page: Page, name: string) =>
  page.locator(`[data-testid="device-row"][data-name="${name}"]`);

test('devices: controllers apart from the rest, find one by pressing a button, name it, names survive a restart', async ({
  rig,
}) => {
  const run = await rig.launch('devices-rig', 'devices-list');
  const { page, shot } = run;
  await openDevices(page);

  // Game controllers first; keyboards, mice and headsets are in their own section.
  const controllers = page.getByTestId('devices-controllers');
  for (const name of [
    'WINWING MFD1-L',
    'WINWING MFD1-C',
    'WINWING MFD1-R',
    'WINWING ICP',
    'T-Pendular-Rudder',
    'R-VPC Panel #1',
    'FANATEC Podium Wheel Base DD2',
  ]) {
    await expect(controllers).toContainText(name);
  }
  await expect(controllers).not.toContainText('Keychron');
  await expect(page.getByTestId('devices-others')).toHaveCount(0);
  await shot('list');

  // Find a device: press button 5 on the right MFD frame; its row lights up, open for a name.
  await page.getByTestId('devices-identify').click();
  await expect(page.getByTestId('identify-banner')).toHaveAttribute('data-listening', 'true');
  await run.sendInput([state(CONTROLLERS.mfdRight)]);
  // A wobbling axis on another controller does not count as "this one".
  await run.sendInput([state(CONTROLLERS.throttle)]);
  await run.sendInput([state(CONTROLLERS.throttle, { axes: { 2: 0.04 } })]);
  await expect(page.getByTestId('identify-banner')).toBeVisible();
  await run.sendInput([state(CONTROLLERS.mfdRight, { pressed: [5] })]);
  await expect(page.getByTestId('identify-found')).toContainText('That was WINWING MFD1-R');
  await expect(page.getByTestId('identify-found')).toContainText('Button 5');
  const mfd = deviceRow(page, 'WINWING MFD1-R');
  await expect(mfd).toHaveClass(/highlighted/);
  await expect(mfd.getByTestId('device-detail')).toContainText('80E62062A4E6D221B2465002');
  await expect(mfd.getByTestId('device-detail')).toContainText(
    '806E0610-B756-11F0-8024-444553540000'
  );
  await expect(page.getByTestId('device-name-input')).toBeVisible();
  await shot('found');

  await page.getByTestId('device-name-input').locator('input').fill('Right MFD');
  await page.getByTestId('device-name-save').click();
  await expect(deviceRow(page, 'Right MFD')).toBeVisible();
  await expect(deviceRow(page, 'Right MFD')).toContainText('WINWING MFD1-R');
  await run.sendInput([state(CONTROLLERS.mfdRight)]);

  // Three identical MFD screens (same VID/PID) are told apart by serial and named one by one.
  await page.getByTestId('devices-toggle-others').click();
  const others = page.getByTestId('devices-others');
  const screens = others.locator(
    '[data-testid="device-row"][data-name="WINWING USB 3.0 Display1"]'
  );
  await expect(screens).toHaveCount(3);
  await expect(screens.first()).toContainText('3 identical');
  for (const name of ['MFD screen A', 'MFD screen B', 'MFD screen C']) {
    await screens.first().locator('button').first().click();
    await screens.first().getByTestId('device-rename').click();
    await page.getByTestId('device-name-input').locator('input').fill(name);
    await page.getByTestId('device-name-save').click();
    await expect(deviceRow(page, name)).toBeVisible();
  }
  await deviceRow(page, 'MFD screen B').locator('button').first().click();
  await deviceRow(page, 'MFD screen B').scrollIntoViewIfNeeded();
  await shot('identical-named');

  // Names are kept by identity, so they are all still there after a restart.
  const again = await run.restart();
  await openDevices(again.page);
  await expect(deviceRow(again.page, 'Right MFD')).toBeVisible();
  await again.page.getByTestId('devices-toggle-others').click();
  for (const name of ['MFD screen A', 'MFD screen B', 'MFD screen C']) {
    await expect(deviceRow(again.page, name)).toHaveCount(1);
  }
  const serials: string[] = [];
  for (const name of ['MFD screen A', 'MFD screen B', 'MFD screen C']) {
    await deviceRow(again.page, name).locator('button').first().click();
    serials.push(
      (await deviceRow(again.page, name).getByTestId('device-detail').textContent()) ?? ''
    );
  }
  expect(new Set(serials.map((t) => /WWIN\d+/.exec(t)?.[0])).size).toBe(3);
  await deviceRow(again.page, 'Right MFD').scrollIntoViewIfNeeded();
  await again.shot('names-after-restart');
});

test('devices: the input tester shows buttons, axes and hats as a game sees them, raw values, a readable log, one or all controllers', async ({
  rig,
}) => {
  const run = await rig.launch('devices-rig', 'devices-tester');
  const { page, shot, sendInput } = run;
  await openDevices(page);
  await page.getByTestId('devices-tab-test').click();
  await expect(page.getByTestId('tester-all-list')).toBeVisible();
  await expect(page.getByTestId('compact-controller')).toHaveCount(12);
  await expect(page.getByTestId('tester-page')).toHaveAttribute('data-live', 'true');

  // All controllers at once: whichever is used lights up.
  await sendInput([
    state(CONTROLLERS.throttle),
    state(CONTROLLERS.stick),
    state(CONTROLLERS.mfdRight),
  ]);
  await sendInput([state(CONTROLLERS.throttle, { pressed: [12] })]);
  const throttleRow = page.locator(`[data-testid="compact-controller"][data-index="10"]`);
  await expect(throttleRow).toHaveAttribute('data-active', 'true');
  await expect(throttleRow).toContainText('Button 12');
  await expect(page.getByTestId('tester-last-input')).toContainText('Button 12 pressed');
  await sendInput([state(CONTROLLERS.stick, { hat: [0, 1], axes: { 0: -0.5 } })]);
  await expect(page.locator(`[data-testid="compact-controller"][data-index="9"]`)).toContainText(
    'Hat 1 up'
  );
  await shot('all');

  // One controller: every button, axis and hat.
  await throttleRow.click();
  const view = page.getByTestId('controller-view');
  await expect(view.locator('[data-testid="button"][data-button="12"]')).toHaveAttribute(
    'data-pressed',
    'true'
  );
  await expect(view.locator('[data-testid="button"][data-pressed="true"]')).toHaveCount(1);
  await expect(view.getByTestId('axis')).toHaveCount(7);
  await expect(page.getByTestId('tester-last-input')).toContainText(
    'Last input: Button 12 pressed'
  );

  // A throttle sweep from one end to the other is one log line that follows the movement,
  // not a line per update. Each position is on screen before the next, as with a hand on it.
  const zAxis = view.locator('[data-testid="axis"][data-axis="Z axis"]');
  for (let step = 0; step <= 10; step++) {
    await sendInput([state(CONTROLLERS.throttle, { pressed: [12], axes: { 2: -1 + step * 0.2 } })]);
    await expect(zAxis.getByTestId('axis-value')).toHaveText(`${step * 10}%`);
  }
  await expect(page.getByTestId('log-entry').filter({ hasText: 'Z axis moved' })).toHaveCount(1);
  await expect(page.getByTestId('log-entry').first()).toContainText('Z axis moved 50% → 100%');
  await expect(zAxis.getByTestId('axis-shortfall')).toHaveCount(0);
  await shot('one-controller');
  await sendInput([state(CONTROLLERS.throttle, { axes: { 2: 0 } })]);
  await expect(page.getByTestId('tester-last-input')).toContainText('Button 12 released');
  // Raw: the 16-bit value Windows shows, and button names as DCS writes them.
  await page.getByTestId('tester-raw').locator('input').check();
  await expect(zAxis.getByTestId('axis-value')).toContainText('32767');
  await expect(zAxis.getByTestId('axis-value')).toContainText('50.0%');
  await expect(view.locator('[data-testid="button"][data-button="12"]')).toHaveText('BTN12');
  await expect(zAxis).toContainText('JOY_Z');
  await shot('raw');

  // An axis that is swept but never gets to its ends is pointed out.
  await page.getByTestId('tester-raw').locator('input').uncheck();
  // Each position is shown before the next is sent, as a hand moving the axis would.
  const rx = view.locator('[data-testid="axis"][data-axis="X rotation"]');
  for (const [v, shown] of [
    [-0.9, '5%'],
    [0, '50%'],
    [0.9, '95%'],
  ] as const) {
    await sendInput([state(CONTROLLERS.throttle, { axes: { 3: v } })]);
    await expect(rx.getByTestId('axis-value')).toHaveText(shown);
  }
  await expect(view.locator('[data-testid="axis"][data-axis="X rotation"]')).toContainText(
    'never gets to either end'
  );
  await view.locator('[data-testid="axis"][data-axis="X rotation"]').scrollIntoViewIfNeeded();
  await shot('short-axis');
});

test('devices: all controllers stay responsive with 16 controllers at 60 Hz', async ({ rig }) => {
  const { page, shot } = await rig.launch('devices-rig', 'devices-tester-load');
  await openDevices(page);
  await page.getByTestId('devices-tab-test').click();
  await expect(page.getByTestId('compact-controller')).toHaveCount(12);

  // Input for 16 controllers (four more than the rig lists) 60 times a second for 3 s,
  // sent from inside the page; every frame gap is measured meanwhile.
  const result = await page.evaluate(async () => {
    const bridge = (
      globalThis as unknown as {
        rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
      }
    ).rigready;
    const raf = (
      globalThis as unknown as { requestAnimationFrame(cb: (t: number) => void): number }
    ).requestAnimationFrame.bind(globalThis);
    const gaps: number[] = [];
    let last = performance.now();
    let measuring = true;
    const frame = (now: number): void => {
      gaps.push(now - last);
      last = now;
      if (measuring) raf(frame);
    };
    raf(frame);
    const started = performance.now();
    let sent = 0;
    while (performance.now() - started < 3000) {
      const t = sent++;
      const states = Array.from({ length: 16 }, (_, index) => ({
        index,
        name: `Controller ${index}`,
        axes: Array.from({ length: 8 }, (_, a) => Math.sin((t + a * 7 + index) / 9)),
        buttons: Array.from({ length: 64 }, (_, b) => (t + b + index) % 11 === 0),
        hats: [[Math.sign(Math.sin(t / 5)), 0]],
        timestamp: t,
      }));
      void bridge.invoke('app:scenario', { input: states });
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    measuring = false;
    return { sent, frames: gaps.length, worst: Math.max(...gaps.slice(1)) };
  });
  await expect(page.getByTestId('compact-controller')).toHaveCount(16);
  expect(result.sent).toBeGreaterThan(120);
  expect(result.worst).toBeLessThan(50);
  await shot('sixteen-controllers');
});

test('devices: hands-off health check reports stuck buttons, switches, noisy axes and rogue inputs', async ({
  rig,
}) => {
  const run = await rig.launch('devices-rig', 'devices-health');
  const { page, shot, sendInput } = run;
  await openDevices(page);
  await page.getByTestId('devices-tab-health').click();
  await shot('start');

  // The rig as recorded: nothing moves, nothing is reported.
  await page.getByTestId('health-start').click();
  await expect(page.getByTestId('health-running')).toBeVisible();
  await shot('hands-off');
  await expect(page.getByTestId('health-title')).toHaveText('All quiet: nothing moved', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('health-summary')).toContainText('12 game controllers checked');
  await shot('all-quiet');

  // Startup panel button 3 is held, a throttle axis wanders, the ICP fires by itself.
  await sendInput([
    state(CONTROLLERS.startup, { pressed: [3] }),
    state(CONTROLLERS.stick, { pressed: [2] }),
    state(CONTROLLERS.throttle),
    state(CONTROLLERS.icp),
  ]);
  await page.getByTestId('health-again').click();
  await expect(page.getByTestId('health-running')).toBeVisible();
  for (const v of [0.02, -0.015, 0.03, -0.02]) {
    await sendInput([state(CONTROLLERS.throttle, { axes: { 2: v } })]);
  }
  await sendInput([state(CONTROLLERS.icp, { pressed: [7] })]);
  await sendInput([state(CONTROLLERS.icp)]);
  await expect(page.getByTestId('health-summary')).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId('health-stuck')).toContainText(
    'WINWING Orion Joystick Base 2 + JGRIP-F16 · Button 2'
  );
  await expect(page.getByTestId('health-switch')).toContainText(
    'WINWING F18 STARTUP PANEL · Button 3'
  );
  await expect(page.getByTestId('health-noisy')).toContainText('Z axis');
  await expect(page.getByTestId('health-noisy')).toContainText('2.5%');
  await expect(page.getByTestId('health-rogue')).toContainText('WINWING ICP · Button 7');
  await expect(page.getByTestId('health-rogue')).toContainText('Pressed once and released once');
  await shot('findings');

  // The startup panel switch is on on purpose: mark it, and the next check lists it apart.
  await page.getByTestId('health-switch').getByTestId('health-mark-switch').click();
  await expect(page.getByTestId('health-expected')).toContainText('Button 3');
  await expect(page.getByTestId('health-switch')).toHaveCount(0);
  await page.getByTestId('health-again').click();
  await expect(page.getByTestId('health-summary')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('health-expected')).toContainText(
    'WINWING F18 STARTUP PANEL · Button 3'
  );
  await expect(page.getByTestId('health-switch')).toHaveCount(0);
  await shot('switch-marked');
});

test('devices: USB map places every device on its hub, and selecting one shows it in Devices and back', async ({
  rig,
}) => {
  const run = await rig.launch('devices-rig', 'usb-map');
  const { page, shot } = run;
  await openDevices(page);
  await page.getByTestId('devices-tab-usb').click();
  const tree = page.getByTestId('usb-tree');
  await expect(page.getByTestId('usb-controller')).toHaveCount(1);
  await expect(page.getByTestId('usb-controller-counts')).toContainText('62 of 127 USB addresses');
  await expect(tree.locator('[data-kind="device"]')).toHaveCount(31);
  await shot('tree');

  // The pedals: three hubs deep, port 2.
  const pedals = tree.locator('[data-testid="usb-node"][data-name="T-Pendular-Rudder"]');
  await pedals.click();
  await expect(pedals).toHaveAttribute('data-selected', 'true');
  const side = page.getByTestId('usb-selected');
  await expect(side).toContainText('Port 2 on USB2.1 Hub');
  await expect(side).toContainText('3 hubs between it and the computer');
  await shot('pedals-selected');

  // ...which is the same device in the Devices list.
  await page.getByTestId('usb-show-device').click();
  const row = deviceRow(page, 'T-Pendular-Rudder');
  await expect(row).toHaveClass(/highlighted/);
  await expect(row.getByTestId('device-detail')).toContainText('USB path 6 › 4 › 2 › 2');
  await shot('in-devices');

  // And back: the DD2 from its Devices entry to its place on the map.
  await deviceRow(page, 'FANATEC Podium Wheel Base DD2').locator('button').first().click();
  await deviceRow(page, 'FANATEC Podium Wheel Base DD2').getByTestId('device-show-usb').click();
  await expect(
    tree.locator('[data-testid="usb-node"][data-name="FANATEC Podium Wheel Base DD2"]')
  ).toHaveAttribute('data-selected', 'true');

  // What can be unplugged: devices the active setup does not need.
  await page.getByTestId('usb-spare-toggle').click();
  const spare = page.getByTestId('usb-spare');
  await expect(spare).toContainText('Not needed by DCS F/A-18C');
  await expect(spare).toContainText('Keychron K2 Pro');
  await expect(spare).not.toContainText('T-Pendular-Rudder');
  await shot('what-to-unplug');
});

test('devices: HidHide hiding the pedals is shown on the device and fails its check', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('devices-tpr-hidden', 'devices-hidhide');
  const pedals = checkRow(page, 'T-Pendular-Rudder');
  await expect(pedals).toHaveAttribute('data-status', 'fail');
  await expect(pedals).toContainText('Hidden by HidHide');
  await expect(pedals).toContainText('DCS.exe is not on that list');
  await shot('fly');

  await openDevices(page);
  await expect(page.getByTestId('hidhide-warning')).toContainText('hiding a connected device');
  await expect(page.getByTestId('device-hidden-badge')).toHaveCount(1);
  await expect(
    deviceRow(page, 'T-Pendular-Rudder').getByTestId('device-hidden-badge')
  ).toBeVisible();
  const hid = page.getByTestId('devices-hidhide');
  await expect(hid).toContainText('Cloaking is on');
  await expect(hid.locator('[data-testid="hidhide-program"][data-label="RigReady"]')).toContainText(
    'not on the allow list'
  );
  await expect(
    hid.locator('[data-testid="hidhide-program"][data-label="DCS F/A-18C"]')
  ).toContainText('not on the allow list');
  await shot('devices');
  await hid.scrollIntoViewIfNeeded();
  await shot('hidhide-panel');
});

test('devices: an unplugged device says where it was last plugged in, on Fly and in Devices', async ({
  rig,
}) => {
  const run = await rig.launch('devices-rig', 'devices-missing');
  const { page, shot } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await run.mutate([{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  const pedals = checkRow(page, 'T-Pendular-Rudder');
  await expect(pedals).toHaveAttribute('data-status', 'fail');
  await expect(pedals).toContainText('Not connected · last seen just now, port 2 on USB2.1 Hub');
  await expect(pedals).toContainText('USB path 6 › 4 › 2 › 2');
  await shot('fly');

  await openDevices(page);
  const missing = page.getByTestId('devices-missing');
  await expect(missing).toContainText('T-Pendular-Rudder');
  await expect(missing).toContainText('Needed by DCS F/A-18C');
  await expect(missing).toContainText('last seen just now, port 2 on USB2.1 Hub');
  await expect(page.getByTestId('devices-controllers')).not.toContainText('T-Pendular-Rudder');
  await missing.scrollIntoViewIfNeeded();
  await shot('devices');
});

test('devices: identical devices are checked unit by unit, by serial or by USB port', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('devices-identical', 'devices-identical');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(checkRow(page, 'MFD screen right')).toHaveAttribute('data-status', 'fail');
  await expect(checkRow(page, 'MFD screen right')).toContainText(
    'A different WINWING USB 3.0 Display1 is connected'
  );
  await expect(checkRow(page, 'MFD screen left')).toHaveAttribute('data-status', 'pass');
  await expect(checkRow(page, 'MFD screen centre')).toHaveAttribute('data-status', 'pass');
  await expect(checkRow(page, 'Trackball A')).toHaveAttribute('data-status', 'pass');
  await expect(checkRow(page, 'Trackball A')).toContainText('identified by USB port');
  await expect(page.locator('[data-testid="check-row"][data-status="fail"]')).toHaveCount(1);
  await shot('fly');
});
