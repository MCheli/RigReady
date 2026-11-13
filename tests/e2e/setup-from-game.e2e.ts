import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import * as yaml from 'js-yaml';
import { expect, openOption, test } from './harness';

/**
 * CFG-PROFILE-017 and 018: a new setup starts from the game. What the chosen game is played
 * with comes ticked, the rest of the rig is listed and not ticked, and a game that reads a
 * gamepad is offered the step that starts a virtual controller.
 */

const candidate = (page: Page, title: string) =>
  page.locator(`[data-testid="capture-candidate"][data-title="${title}"]`);
const tick = (page: Page, title: string) => candidate(page, title).getByRole('checkbox');
const section = (page: Page, group: string) => page.getByTestId(`capture-group-${group}`);
/** The titles of what is ticked in a section. */
const keptIn = (page: Page, group: string): Promise<string[]> =>
  section(page, group)
    .locator('[data-testid="capture-candidate"][data-kept="yes"]')
    .evaluateAll((all) => all.map((el) => el.getAttribute('data-title') ?? ''));
/** Scrolls a section to the top of the window, for a screenshot of it. */
const bringUp = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => el.scrollIntoView({ block: 'start' }));

interface SavedSetup {
  game: string;
  checks: { type: string; title: string }[];
  actions?: {
    preLaunch?: {
      title: string;
      type: string;
      params: Record<string, unknown>;
      continueOnError?: boolean;
    }[];
  };
}
const savedSetup = async (dataRoot: string, id: string): Promise<SavedSetup> =>
  yaml.load(await fs.readFile(path.join(dataRoot, 'profiles', `${id}.yaml`), 'utf8')) as SavedSetup;

test('new setup: a racing game keeps the wheel; flight gear and a head tracker program that happens to run are listed, not ticked', async ({
  rig,
}) => {
  // The flying rig: sticks, throttle, pedals, the head tracker and its program running, and
  // the wheel base plugged in as well.
  const { page, shot, dataRoot } = await rig.launch('flying-fresh', 'setup-from-game-racing');
  await page.getByTestId('fly-create').click();

  // The rig proposes the flight sim: its gear and its head tracker are kept, the wheel is not.
  await expect(page.getByTestId('capture-game-dcs')).toHaveAttribute('aria-checked', 'true');
  await expect(tick(page, 'T-Pendular-Rudder')).toBeChecked();
  await expect(tick(page, 'TrackIR software')).toBeChecked();
  await expect(tick(page, 'FANATEC Podium Wheel Base DD2')).not.toBeChecked();
  await expect(section(page, 'devices')).toContainText(
    'What DCS World is played with is kept. The rest is listed, not ticked.'
  );
  await bringUp(page, 'capture-group-devices');
  await shot('flight-sim');

  // The same rig, a racing game: the ticks follow the game, not what is plugged in or running.
  await page.getByTestId('capture-game-iracing').click();
  await expect(page.getByTestId('capture-name').locator('input')).toHaveValue('iRacing');
  await expect(section(page, 'devices')).toContainText(
    'What iRacing is played with is kept. The rest is listed, not ticked.'
  );
  await expect(tick(page, 'FANATEC Podium Wheel Base DD2')).toBeChecked();
  // The flight gear is still on the page, one click away, and not ticked.
  await expect(candidate(page, 'T-Pendular-Rudder')).toBeVisible();
  await expect(tick(page, 'T-Pendular-Rudder')).not.toBeChecked();
  const devices = await keptIn(page, 'devices');
  expect(devices).toContain('FANATEC Podium Wheel Base DD2');
  expect(devices.filter((title) => /WINWING|T-Pendular|VPC|TrackIR/.test(title))).toEqual([]);
  await bringUp(page, 'capture-group-devices');
  await shot('racing-game-devices');

  // TrackIR's program is running, and that alone no longer ticks it for a racing game.
  await expect(section(page, 'apps')).toContainText(
    'Helpers for iRacing that are running now are kept.'
  );
  await expect(candidate(page, 'TrackIR software')).toBeVisible();
  await expect(tick(page, 'TrackIR software')).not.toBeChecked();
  await expect(tick(page, 'SimAppPro')).not.toBeChecked();
  expect((await keptIn(page, 'apps')).filter((t) => /TrackIR|SimAppPro/.test(t))).toEqual([]);
  await expect(page.getByTestId('capture-summary')).not.toContainText('TrackIR');
  await bringUp(page, 'capture-group-apps');
  await shot('racing-game-helpers');

  // The rotation the wheel's driver last recorded is offered, and it is the user's to tick.
  const rotation = page.locator('[data-testid="capture-candidate"][data-title^="Wheel rotation"]');
  await expect(rotation).toBeVisible();
  await expect(rotation.getByRole('checkbox')).not.toBeChecked();
  await rotation.scrollIntoViewIfNeeded();
  await shot('wheel-rotation-offered');

  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('profile-switcher')).toContainText('iRacing');
  const titles = (await savedSetup(dataRoot, 'iracing')).checks.map((c) => c.title);
  expect(titles).toContain('FANATEC Podium Wheel Base DD2');
  expect(
    titles.filter((t) => /WINWING|T-Pendular|TrackIR|SimAppPro|Wheel rotation/.test(t))
  ).toEqual([]);
});

test('new setup: a game that reads a gamepad is offered "Start a virtual controller" by name, and Play says so before the launch', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch(
    'virtual-controller-ready',
    'setup-from-game-gamepad'
  );
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('new-profile').click();

  // A game that reads the gear itself is not offered the step.
  await page.getByTestId('capture-game-dcs').click();
  await expect(tick(page, 'TrackIR software')).toBeChecked();
  await expect(page.getByTestId('capture-steps')).toHaveCount(0);

  // The game is named the way people write it, not in the store's capitals.
  const tile = page.getByTestId('capture-game-ace-combat-8');
  await expect(tile).toContainText('Ace Combat 8: Wings of Theve');
  await tile.click();
  await expect(page.getByTestId('capture-steps-lead')).toHaveText(
    'Ace Combat 8: Wings of Theve reads a gamepad. A virtual controller lets it read your own gear as one. Make ready starts it before the game.'
  );
  const step = page.locator('[data-testid="capture-step"][data-type="virtual-controller.start"]');
  await expect(step).toContainText('Start a virtual controller');
  // The only virtual controller there is comes chosen, by its name, with what it is.
  await expect(step).toHaveAttribute('data-kept', 'yes');
  const choice = step.getByTestId('capture-step-choice');
  await expect(choice).toContainText('My Ace Combat stick');
  await expect(step.getByTestId('capture-step-note')).toContainText('Xbox 360 controller');
  await expect(step.getByTestId('capture-step-note')).toContainText(
    'WINWING Orion Joystick Base 2 + JGRIP-F16'
  );
  await expect(page.getByTestId('capture-summary-step')).toContainText(
    'Start a virtual controller: My Ace Combat stick'
  );

  // The gear the game is fed from is kept; the head tracker, the MFDs and the helpers are not.
  await expect(tick(page, 'T-Pendular-Rudder')).toBeChecked();
  expect((await keptIn(page, 'devices')).filter((t) => /TrackIR|MFD/.test(t))).toEqual([]);
  await expect(tick(page, 'TrackIR software')).not.toBeChecked();
  await expect(tick(page, 'SimAppPro')).not.toBeChecked();
  await page.getByTestId('capture-name').locator('input').fill('Ace nights');
  // The heading of the step's section stays in the picture, under the app's own top bar.
  await page.getByTestId('capture-steps').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot('gamepad-game');

  // Without a choice the step is not kept, and the page says what to do.
  await choice.hover();
  await choice.locator('.v-field__clearable .v-icon').click();
  await expect(step).toHaveAttribute('data-kept', 'no');
  await expect(step).toContainText('Choose one to keep this step.');
  await expect(page.getByTestId('capture-summary-step')).toHaveCount(0);
  await shot('step-without-a-choice');
  await choice.click();
  await openOption(page, 'My Ace Combat stick').click();
  await expect(step).toHaveAttribute('data-kept', 'yes');

  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('profile-switcher')).toContainText('Ace nights');
  // FLY-029: what Launch will do first is on the Play page before the click.
  await expect(page.getByTestId('fly-plan-preLaunch')).toHaveText(
    'Before launch: Start a virtual controller'
  );
  await shot('play-says-what-launch-does');

  const saved = await savedSetup(dataRoot, 'ace-nights');
  expect(saved.game).toBe('ace-combat-8');
  expect(saved.actions?.preLaunch).toHaveLength(1);
  expect(saved.actions?.preLaunch?.[0]).toMatchObject({
    title: 'Start a virtual controller',
    type: 'virtual-controller.start',
    params: { profile: 'my-ace-combat-stick', profileName: 'My Ace Combat stick' },
    continueOnError: false,
  });
  expect(saved.checks.map((c) => c.title).filter((t) => /TrackIR|SimAppPro/.test(t))).toEqual([]);
});

/** A virtual Xbox 360 controller as Windows lists it. */
const VIRTUAL_PAD = {
  op: 'plugDevice',
  device: {
    instanceId: 'USB\\VID_045E&PID_028E\\01',
    vendorId: '045E',
    productId: '028E',
    name: 'Virtual Xbox 360 Controller',
    isHid: true,
    isGameController: true,
    isHub: false,
    hubChain: [],
  },
  controller: {
    name: 'Controller (XBOX 360 For Windows)',
    guid: '9A0D2F10-B756-11F0-8001-444553540000',
    vendorId: '045E',
    productId: '028E',
  },
};

test("new setup: RigReady's own virtual controller is not listed among the rig's devices", async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch(
    'virtual-controller-ready',
    'setup-own-virtual-controller'
  );
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // Windows lists a virtual Xbox 360 controller. RigReady has started none, so it is another
  // program's: listed, and not ticked.
  await mutate([VIRTUAL_PAD]);
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('new-profile').click();
  const pad = candidate(page, 'Virtual Xbox 360 Controller');
  await expect(pad).toBeVisible();
  await expect(pad.getByRole('checkbox')).not.toBeChecked();
  await pad.scrollIntoViewIfNeeded();
  await shot('another-programs-controller');

  // The setup that is there starts RigReady's own before its game.
  await page.getByTestId('mode-fly').click();
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-minimize-pref').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('launch').click();
  await expect(page.getByTestId('vc-badge')).toContainText(
    'Virtual controller on: My Ace Combat stick'
  );

  // Now that controller is RigReady's own, not part of the rig: it is not on the page.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('new-profile').click();
  await expect(section(page, 'devices')).toContainText('T-Pendular-Rudder');
  await expect(pad).toHaveCount(0);
  await expect(page.getByTestId('capture-page')).not.toContainText('XBOX 360');
  await bringUp(page, 'capture-group-devices');
  await shot('own-controller-not-listed');
});
