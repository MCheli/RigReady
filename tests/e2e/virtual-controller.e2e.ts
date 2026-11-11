import type { Page } from '@playwright/test';
import type { InputState } from '../../src/shared/models';
import { expect, test } from './harness';

/**
 * Configure > Virtual controller: the driver missing, a profile made from a starting point
 * by moving the controls, and a setup that starts the virtual controller before launch
 * (hiding the real controllers) and stops it at Stand down. The fake machine has a fake
 * driver; the real one is tried by hand (tests/rig/virtualController.rig.test.ts).
 */

const STICK = { index: 9, name: 'WINWING Orion Joystick Base 2 + JGRIP-F16' };
const stick = (
  axes: number[],
  buttons: boolean[] = [],
  hat: [number, number] = [0, 0]
): InputState => ({
  ...STICK,
  axes,
  buttons,
  hats: [hat],
  timestamp: Date.now(),
});
const REST = [0, 0, 0, 0, 0, 0];

async function openPage(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-virtual-controller').click();
  await expect(page.getByTestId('vc-page')).toBeVisible();
}

test('virtual controller: without the driver it says how to install it, and nothing can start', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch(
    'virtual-controller-no-driver',
    'virtual-controller-no-driver'
  );
  await openPage(page);
  await expect(page.getByTestId('vc-driver-state')).toHaveText('Not installed');
  await expect(page.getByTestId('vc-hidhide-state')).toHaveText('Not installed');
  await expect(page.getByTestId('vc-install-guide')).toContainText('Install the ViGEmBus driver');
  await expect(page.getByTestId('vc-install-guide')).toContainText(
    'that is the setup, not RigReady'
  );
  await expect(page.getByTestId('vc-mine-empty')).toBeVisible();
  await expect(page.getByTestId('vc-builtin')).toHaveCount(3);
  await shot('no-driver');
  await page.getByTestId('vc-download').click();
  await expect(page.getByTestId('external-confirm')).toContainText(
    'https://github.com/nefarius/ViGEmBus/releases/latest'
  );
  await page.getByTestId('external-cancel').click();
});

test('virtual controller: a copy of the Ace Combat starting point, mapped by moving the stick, with live bars', async ({
  rig,
}) => {
  const { page, shot, sendInput } = await rig.launch(
    'virtual-controller-ready',
    'virtual-controller-editor'
  );
  await openPage(page);
  await expect(page.getByTestId('vc-driver-state')).toHaveText('Installed');
  await expect(page.getByTestId('vc-profile')).toHaveCount(1);
  await shot('page');

  await page
    .locator('[data-testid="vc-builtin"][data-id="starting-flight-stick-ace-combat"]')
    .getByTestId('vc-copy')
    .click();
  await expect(page.getByTestId('vc-editor')).toBeVisible();
  await expect(page.getByTestId('vc-editor-name').locator('input')).toHaveValue(
    'My flight stick to gamepad'
  );

  // Roll: press "Press or move", then move the stick right.
  const roll = page.locator('[data-testid="vc-part"][data-part="lx"]');
  await expect(roll).toContainText('Roll: the stick left and right');
  await sendInput([stick(REST)]);
  await roll.getByTestId('vc-pick').click();
  await expect(roll.getByTestId('vc-pick')).toHaveAttribute('aria-busy', 'true');
  await sendInput([stick(REST)]);
  await sendInput([stick([0.9, 0, 0, 0, 0, 0])]);
  await expect(roll.getByTestId('vc-part-source')).toHaveText(`${STICK.name}: X axis`);

  // Fire: press the trigger.
  const fire = page.locator('[data-testid="vc-part"][data-part="a"]');
  await fire.getByTestId('vc-pick').click();
  await sendInput([stick(REST, [false])]);
  await sendInput([stick(REST, [true])]);
  await expect(fire.getByTestId('vc-part-source')).toHaveText(`${STICK.name}: Button 1`);

  // What a game would get, live: half right on the stick, past its 3% deadzone, is 48% on the left stick.
  await sendInput([stick([0.5, 0, 0, 0, 0, 0], [false])]);
  await expect(roll.getByTestId('vc-part-value')).toHaveText('48%');
  await roll.getByTestId('vc-invert').locator('input').check();
  await expect(roll.getByTestId('vc-part-value')).toHaveText('-48%');
  await shot('editor');

  await page.getByTestId('vc-editor-save').click();
  await expect(page.getByTestId('vc-editor-message')).toHaveText(
    'Saved My flight stick to gamepad'
  );
  await page.getByTestId('vc-editor-back').click();
  await expect(page.getByTestId('vc-profile')).toHaveCount(2);
  await expect(
    page.locator('[data-testid="vc-profile"][data-id="my-flight-stick-to-gamepad"]')
  ).toContainText('2 parts mapped');
});

test('virtual controller: a setup starts it before launch with the controllers hidden, and Stand down stops it', async ({
  rig,
}) => {
  const { page, shot, app } = await rig.launch(
    'virtual-controller-ready',
    'virtual-controller-launch'
  );
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-minimize-pref').click();
  await page.keyboard.press('Escape');

  await page.getByTestId('launch').click();
  const activity = page.getByTestId('fly-activity');
  await expect(activity).toContainText(
    'Virtual controller on: My Ace Combat stick (Xbox 360 controller)'
  );
  await expect(activity).toContainText('Launched AceCombat8.exe');
  await expect(page.getByTestId('vc-badge')).toContainText(
    'Virtual controller on: My Ace Combat stick'
  );
  const tray = (): Promise<{ tooltip: string; menu: { id: string; label: string }[] }> =>
    app.evaluate(() =>
      (
        globalThis as unknown as {
          __rigreadyTray(): { tooltip: string; menu: { id: string; label: string }[] };
        }
      ).__rigreadyTray()
    );
  await expect.poll(async () => (await tray()).tooltip).toContain('(virtual controller on)');
  expect((await tray()).menu.find((i) => i.id === 'virtualController')?.label).toBe(
    'Virtual controller on: My Ace Combat stick'
  );
  await shot('launched');

  await page.getByTestId('vc-badge-open').click();
  await expect(page.getByTestId('vc-running-title')).toHaveText(
    'On: My Ace Combat stick (Xbox 360 controller)'
  );
  await expect(page.getByTestId('vc-running-hidden')).toContainText('T-Pendular-Rudder');
  await expect(page.getByTestId('vc-running-from')).toContainText('Stand down stops it');
  await shot('running');

  await page.getByTestId('mode-fly').click();
  await page.getByTestId('stand-down').click();
  await expect(page.getByTestId('game-running')).toContainText('AceCombat8.exe is still running');
  await page.getByTestId('game-leave').click();
  await expect(activity).toContainText('Virtual controller off (My Ace Combat stick)');
  await expect(page.getByTestId('vc-badge')).toHaveCount(0);
  await expect.poll(async () => (await tray()).tooltip).not.toContain('virtual controller');
  await shot('stood-down');
});
