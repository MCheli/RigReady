import type { Locator, Page } from '@playwright/test';
import type { InputState } from '../../src/shared/models';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test } from './harness';

/**
 * Configure > Virtual controller: the driver missing, a profile made from a starting point
 * by moving the controls (with the live picture, the notes for one game and the Save bar
 * that never scrolls away), a setup that starts the virtual controller before launch
 * (hiding the real controllers) and stops it at Stand down, and two profiles of one name
 * told apart, with the warning before a profile a setup uses is deleted. The fake machine
 * has a fake driver; the real one is tried by hand (tests/rig/virtualController.rig.test.ts).
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

const THROTTLE = {
  index: 10,
  name: 'WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R',
};
/** The throttle with its first lever at `lever` (-1 is the back stop, 1 fully forward). */
const throttle = (lever: number, buttons: boolean[] = []): InputState => ({
  ...THROTTLE,
  axes: [lever, 0, 0, 0, 0, 0, 0],
  buttons,
  hats: [],
  timestamp: Date.now(),
});

async function openPage(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-virtual-controller').click();
  await expect(page.getByTestId('vc-page')).toBeVisible();
}

const part = (page: Page, name: string): Locator =>
  page.locator(`[data-testid="vc-part"][data-part="${name}"]`);
const profileRow = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="vc-profile"][data-id="${id}"]`);
const startingPoint = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="vc-builtin"][data-id="${id}"]`);

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
  // Only the starting point named for a game speaks of that game.
  await expect(startingPoint(page, 'starting-flight-stick-ace-combat')).toContainText(
    'Flight stick to gamepad (Ace Combat 8)'
  );
  await expect(startingPoint(page, 'starting-hotas')).not.toContainText(/ace combat/i);
  await expect(startingPoint(page, 'starting-wheel-pedals')).not.toContainText(/ace combat/i);
  await shot('no-driver');
  await page.getByTestId('vc-download').click();
  await expect(page.getByTestId('external-confirm')).toContainText(
    'https://github.com/nefarius/ViGEmBus/releases/latest'
  );
  await page.getByTestId('external-cancel').click();
});

test('virtual controller: a copy of the Ace Combat 8 starting point, mapped by moving the controls, with the live picture and Save always in view', async ({
  rig,
}) => {
  const { page, shot, sendInput } = await rig.launch(
    'virtual-controller-ready',
    'virtual-controller-editor'
  );
  await openPage(page);
  await expect(page.getByTestId('vc-driver-state')).toHaveText('Installed');
  await expect(page.getByTestId('vc-profile')).toHaveCount(1);
  // The row says which setup starts the profile, and the id that setup knows it by.
  const first = profileRow(page, 'my-ace-combat-stick');
  await expect(first.getByTestId('vc-profile-used')).toHaveText('Used by the setup "ACE COMBAT 8"');
  await expect(first.getByTestId('vc-profile-id')).toHaveText('my-ace-combat-stick');
  await shot('page');

  await startingPoint(page, 'starting-flight-stick-ace-combat').getByTestId('vc-copy').click();
  await expect(page.getByTestId('vc-editor')).toBeVisible();
  const name = page.getByTestId('vc-editor-name').locator('input');
  await expect(name).toHaveValue('My Ace Combat 8 stick');
  await expect(page.getByTestId('vc-editor-id')).toContainText('my-ace-combat-8-stick');

  // Save is in view from the start, on a page much longer than the window, and the bar
  // says there is nothing to save yet.
  const save = page.getByTestId('save-bar-save');
  await expect(save).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('save-bar-back')).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('save-bar-clean')).toHaveText('No unsaved changes');

  // What a part does in one game is a note for that game, apart from the plain hint.
  const roll = part(page, 'lx');
  await expect(roll.getByTestId('vc-part-hint')).toHaveText('Roll: the stick left and right');
  await expect(roll.getByTestId('vc-part-game-note')).toContainText(
    'In Ace Combat 8: Rolls with the Expert flight controls'
  );
  await expect(page.getByTestId('vc-game')).toContainText('Notes for Ace Combat 8');
  // This starting point keeps the throttle on RT alone and a button on LT, so both can be
  // held at once (the game's high-G turn); one axis split over both never can.
  await expect(page.getByTestId('vc-split').locator('input')).not.toBeChecked();
  await expect(page.getByTestId('vc-split-note')).toContainText('it can never press both at once');
  const rt = part(page, 'rt');
  const lt = part(page, 'lt');
  await expect(rt.getByTestId('vc-part-game-note')).toContainText(
    'Held together with LT: a high-G turn'
  );
  await expect(lt.getByTestId('vc-part-hint')).toHaveText(
    'A button, such as the speed brake switch'
  );
  // The face buttons make no claim about the game: its own controls screen says those.
  await expect(part(page, 'x').getByTestId('vc-part-game-note')).toHaveCount(0);

  // Roll: press "Press or move". The row says to move the control now and counts down.
  await sendInput([stick(REST)]);
  await roll.getByTestId('vc-pick').click();
  await expect(roll.getByTestId('vc-pick')).toHaveAttribute('aria-busy', 'true');
  await expect(roll.getByTestId('vc-listening')).toContainText('Press or move the control now.');
  await expect(roll.getByTestId('vc-listening')).toContainText(/\d+ seconds? left\./);
  await shot('listening');
  await sendInput([stick(REST)]);
  await sendInput([stick([0.9, 0, 0, 0, 0, 0])]);
  await expect(roll.getByTestId('vc-part-source')).toHaveText(`${STICK.name}: X axis`);
  await expect(page.getByTestId('vc-listening')).toHaveCount(0);
  // The bar says so at once.
  await expect(page.getByTestId('save-bar-unsaved')).toHaveText('Unsaved changes');

  // Fire: press the trigger.
  const fire = part(page, 'a');
  await fire.getByTestId('vc-pick').click();
  await expect(fire.getByTestId('vc-listening')).toBeVisible();
  await sendInput([stick(REST, [false])]);
  await sendInput([stick(REST, [true])]);
  await expect(fire.getByTestId('vc-part-source')).toHaveText(`${STICK.name}: Button 1`);

  // RT from the throttle lever, LT from a button on the throttle.
  await sendInput([throttle(-1)]);
  await rt.getByTestId('vc-pick').click();
  await expect(rt.getByTestId('vc-listening')).toBeVisible();
  await sendInput([throttle(1)]);
  await expect(rt.getByTestId('vc-part-source')).toHaveText(`${THROTTLE.name}: X axis`);
  await lt.getByTestId('vc-pick').click();
  await expect(lt.getByTestId('vc-listening')).toBeVisible();
  await sendInput([throttle(1, [true])]);
  await expect(lt.getByTestId('vc-part-source')).toHaveText(`${THROTTLE.name}: Button 1`);

  // What a game would get, live, in the picture and in words: half right on the stick, past
  // its 3% deadzone, is 48% on the left stick; the trigger is A; the lever fully forward
  // with the button held is both triggers at once.
  await sendInput([stick([0.5, 0, 0, 0, 0, 0], [true]), throttle(1, [true])]);
  await expect(roll.getByTestId('vc-part-value')).toHaveText('48%');
  const picture = page.getByTestId('vc-editor-live');
  await expect(picture.getByTestId('vc-pad-values')).toHaveText(
    'LT 100% · RT 100% · Left stick: 48% right · Right stick: centred'
  );
  await expect(picture.getByTestId('vc-pad-pressed')).toHaveText('Pressed: A');
  await expect(picture.locator('svg')).toHaveAttribute(
    'aria-label',
    'The virtual controller now. LT 100% · RT 100% · Left stick: 48% right · Right stick: centred. Pressed: A.'
  );
  await roll.getByTestId('vc-invert').locator('input').check();
  await expect(roll.getByTestId('vc-part-value')).toHaveText('-48%');
  await expect(picture.getByTestId('vc-pad-values')).toContainText('Left stick: 48% left');
  // The page with the picture, the notes and the bar passes the accessibility scan.
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('editor');

  // A name another profile has is refused before it can be saved.
  await name.fill('my ace combat stick');
  await expect(page.getByTestId('vc-editor-name')).toContainText(
    'Another profile is already called "My Ace Combat stick"'
  );
  await expect(save).toBeDisabled();
  await expect(page.getByTestId('save-bar-why')).toHaveText(
    'Give the profile a name no other profile has to save it.'
  );
  await page.evaluate('window.scrollTo(0, 0)');
  await shot('name-taken');
  await name.fill('My Ace Combat 8 stick');
  await expect(save).toBeEnabled();

  // Leaving with unsaved changes asks first.
  await page.getByTestId('save-bar-back').click();
  await expect(page.getByTestId('save-bar-leave')).toContainText('Leave without saving?');
  await shot('leave-question');
  await page.getByTestId('save-bar-leave-stay').click();
  await expect(page.getByTestId('save-bar-leave')).toHaveCount(0);
  await expect(page.getByTestId('vc-editor')).toBeVisible();
  // The same by any other way out of the page: an entry of the menu.
  await page.getByTestId('nav-diagnostics').click();
  await expect(page.getByTestId('save-bar-leave')).toContainText('Leave without saving?');
  await page.getByTestId('save-bar-leave-stay').click();
  await expect(page.getByTestId('save-bar-leave')).toHaveCount(0);
  await expect(page.getByTestId('vc-editor')).toBeVisible();

  // Scrolled to the last part, Save has not moved out of view.
  await part(page, 'right').scrollIntoViewIfNeeded();
  await expect(part(page, 'right')).toBeInViewport();
  await expect(name).not.toBeInViewport();
  await expect(save).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('save-bar-unsaved')).toBeInViewport({ ratio: 1 });
  // The bar keeps to the page's side of the window: the last entry of the menu beside it
  // is not covered and can be pressed (a trial press: nothing is clicked).
  await page.getByTestId('nav-diagnostics').click({ trial: true });
  await shot('scrolled-save-in-view');
  await save.click();
  await expect(page.getByTestId('save-bar-saved')).toHaveText('Saved My Ace Combat 8 stick');
  await shot('saved');

  // For another game the notes come off in one press; the hints and the controls stay.
  await page.getByTestId('vc-game').scrollIntoViewIfNeeded();
  await page.getByTestId('vc-drop-notes').click();
  await expect(page.getByTestId('vc-game')).toHaveCount(0);
  await expect(page.getByTestId('vc-part-game-note')).toHaveCount(0);
  await expect(roll.getByTestId('vc-part-hint')).toHaveText('Roll: the stick left and right');
  await expect(roll.getByTestId('vc-part-source')).toHaveText(`${STICK.name}: X axis`);
  await expect(page.getByTestId('save-bar-unsaved')).toBeVisible();
  await shot('notes-removed');
  await save.click();
  await expect(page.getByTestId('save-bar-saved')).toHaveText('Saved My Ace Combat 8 stick');

  // Nothing unsaved: Back goes straight back.
  await page.getByTestId('save-bar-back').click();
  await expect(page.getByTestId('vc-profile')).toHaveCount(2);
  const copy = profileRow(page, 'my-ace-combat-8-stick');
  await expect(copy).toContainText('4 parts mapped');
  await expect(copy).not.toContainText('notes for');
  await expect(copy.getByTestId('vc-profile-used')).toHaveText('No setup uses it');

  // A second copy, with the button pressed twice before the first press has answered: one
  // more profile, not two, and under another name.
  await startingPoint(page, 'starting-flight-stick-ace-combat')
    .getByTestId('vc-copy')
    .evaluate((el) => {
      const button = el as unknown as { click(): void };
      button.click();
      button.click();
    });
  await expect(page.getByTestId('vc-editor')).toBeVisible();
  await expect(name).toHaveValue('My Ace Combat 8 stick 2');
  await page.getByTestId('save-bar-back').click();
  await expect(page.getByTestId('vc-profile')).toHaveCount(3);
  await expect(profileRow(page, 'my-ace-combat-8-stick-2')).toContainText(
    'My Ace Combat 8 stick 2'
  );
  await expect(page.getByTestId('vc-profile-same-name')).toHaveCount(0);
  await shot('copies');

  // In a window wider than the page, the bar still runs along the whole bottom edge.
  await profileRow(page, 'my-ace-combat-8-stick').getByTestId('vc-edit').click();
  await expect(page.getByTestId('vc-editor')).toBeVisible();
  await page.setViewportSize({ width: 1800, height: 900 });
  await expect(save).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('save-bar-clean')).toBeInViewport({ ratio: 1 });
  await shot('wide-window');
});

test('virtual controller: a setup starts it before launch with the controllers hidden, the running panel shows it live, and Stand down stops it', async ({
  rig,
}) => {
  const { page, shot, app, sendInput } = await rig.launch(
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

  // The running panel shows what the game is being sent, live: at rest first, then the
  // stick half right with its trigger held.
  const live = page.getByTestId('vc-running-live');
  await expect(live.getByTestId('vc-pad-pressed')).toHaveText('Nothing pressed');
  await sendInput([stick([0.5, 0, 0, 0, 0, 0], [true])]);
  await expect(live.getByTestId('vc-pad-pressed')).toHaveText('Pressed: A');
  await expect(live.getByTestId('vc-pad-values')).toContainText('Left stick: 48% right');
  // The running profile cannot be started a second time, and its row says why.
  const running = profileRow(page, 'my-ace-combat-stick');
  await expect(running.getByTestId('vc-profile-why')).toHaveText('It is running now.');
  await expect(running.getByTestId('vc-start')).toBeDisabled();
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
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

test('virtual controller: two profiles of one name are told apart, and deleting the one a setup uses warns first', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch(
    'virtual-controller-same-names',
    'virtual-controller-same-names'
  );
  await openPage(page);
  await expect(page.getByTestId('vc-profile')).toHaveCount(3);
  const unused = profileRow(page, 'my-flight-stick-to-gamepad');
  const used = profileRow(page, 'my-flight-stick-to-gamepad-2');
  const other = profileRow(page, 'my-space-stick');

  // Each row has its id, says which setup uses it, and the twins say they are twins.
  await expect(unused.getByTestId('vc-profile-id')).toHaveText('my-flight-stick-to-gamepad');
  await expect(used.getByTestId('vc-profile-id')).toHaveText('my-flight-stick-to-gamepad-2');
  await expect(unused.getByTestId('vc-profile-used')).toHaveText('No setup uses it');
  await expect(used.getByTestId('vc-profile-used')).toHaveText('Used by the setup "Ace Combat 8"');
  await expect(other.getByTestId('vc-profile-used')).toHaveText('No setup uses it');
  await expect(unused.getByTestId('vc-profile-same-name')).toContainText(
    'Another profile has this name'
  );
  await expect(used.getByTestId('vc-profile-same-name')).toBeVisible();
  await expect(other.getByTestId('vc-profile-same-name')).toHaveCount(0);
  // Copies of the starting point as it was: their hints for one game now say which game.
  await expect(used).toContainText('notes for Ace Combat 8');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('rows');

  // In the editor too: the twin is named, and the old hints stand as notes for the game.
  await unused.getByTestId('vc-edit').click();
  await expect(page.getByTestId('vc-editor-same-name')).toContainText(
    'Another profile (my-flight-stick-to-gamepad-2) has this name too'
  );
  await expect(part(page, 'rs').getByTestId('vc-part-game-note')).toHaveText(
    'In Ace Combat 8: Lock on (R3 in the Standard layout)'
  );
  // It still saves under the name it has; only a new name must be free.
  await expect(page.getByTestId('save-bar-save')).toBeEnabled();
  await shot('editor-same-name');
  await page.getByTestId('save-bar-back').click();
  await expect(page.getByTestId('vc-page')).toBeVisible();

  // Deleting the one the setup starts: the prompt names the profile by its id, names the
  // setup, says what breaks, and Delete stays off until the box is ticked.
  const prompt = page.getByTestId('vc-delete-confirm');
  await used.getByTestId('vc-delete').click();
  await expect(prompt).toContainText('Delete "My flight stick to gamepad"?');
  await expect(prompt.getByTestId('vc-delete-which')).toContainText('my-flight-stick-to-gamepad-2');
  await expect(prompt.getByTestId('vc-delete-same')).toContainText(
    'Another profile has the same name'
  );
  await expect(prompt.getByTestId('vc-delete-used')).toContainText('A setup uses this profile');
  await expect(prompt.getByTestId('vc-delete-setup')).toHaveText('Ace Combat 8');
  await expect(prompt.getByTestId('vc-delete-used')).toContainText(
    'the game gets no virtual controller'
  );
  await expect(prompt.getByTestId('vc-delete-go')).toBeDisabled();
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('delete-used');
  await prompt.getByTestId('vc-delete-cancel').click();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByTestId('vc-profile')).toHaveCount(3);

  // The twin no setup uses: the prompt says so, and needs no tick.
  await unused.getByTestId('vc-delete').click();
  await expect(prompt.getByTestId('vc-delete-which')).toContainText(
    'Id my-flight-stick-to-gamepad ·'
  );
  await expect(prompt.getByTestId('vc-delete-unused')).toContainText('No setup uses it');
  await expect(prompt.getByTestId('vc-delete-agree')).toHaveCount(0);
  await shot('delete-unused');
  await prompt.getByTestId('vc-delete-go').click();
  await expect(page.getByTestId('vc-message')).toHaveText(
    'Deleted My flight stick to gamepad (my-flight-stick-to-gamepad)'
  );
  await expect(page.getByTestId('vc-profile')).toHaveCount(2);
  // The one the setup uses is still there, and is no longer one of two.
  await expect(used.getByTestId('vc-profile-used')).toHaveText('Used by the setup "Ace Combat 8"');
  await expect(used.getByTestId('vc-profile-same-name')).toHaveCount(0);

  // With the box ticked it can be deleted all the same.
  await used.getByTestId('vc-delete').click();
  await expect(prompt.getByTestId('vc-delete-go')).toBeDisabled();
  await prompt.getByTestId('vc-delete-agree').locator('input').check();
  await expect(prompt.getByTestId('vc-delete-go')).toBeEnabled();
  await shot('delete-ticked');
  await prompt.getByTestId('vc-delete-go').click();
  await expect(page.getByTestId('vc-message')).toHaveText(
    'Deleted My flight stick to gamepad (my-flight-stick-to-gamepad-2)'
  );
  await expect(page.getByTestId('vc-profile')).toHaveCount(1);
});
