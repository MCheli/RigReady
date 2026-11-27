import type { Page } from '@playwright/test';
import { expect, test } from './harness';

interface Controller {
  index: number;
  name: string;
  guid: string;
  numAxes: number;
  numButtons: number;
  numHats: number;
}

/** The plugged-in controllers, asked of the app as a page asks. */
const controllers = async (page: Page): Promise<Controller[]> =>
  (
    (await page.evaluate(() =>
      (
        globalThis as unknown as {
          rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
        }
      ).rigready.invoke('devices:inputDevices', undefined)
    )) as { value?: Controller[] }
  ).value ?? [];

let clock = 20_000;
/** A controller with the given buttons held (the first is 1), the rest at rest. */
const stateOf = (c: Controller, buttons: number[] = [], axes: number[] = []) => ({
  index: c.index,
  name: c.name,
  axes: Array.from({ length: c.numAxes }, (_, i) => axes[i] ?? 0),
  buttons: Array.from({ length: c.numButtons }, (_, i) => buttons.includes(i + 1)),
  hats: Array.from({ length: c.numHats }, (): [number, number] => [0, 0]),
  timestamp: clock++,
});

/**
 * The binding guide for Nuclear Option on fixtures/scenarios/nuclear-option-bindings.yaml:
 * one guide for every aircraft, with what the game has bound and what it has not. The
 * walkthrough binds with you: press a button or a key, or move an axis, look at the change,
 * save it; Undo is on the Safety page.
 */
test('binding guide for nuclear option: the walkthrough binds a moved axis, a pressed button and a pressed key after a review; the priorities; Undo', async ({
  rig,
}) => {
  const run = await rig.launch('nuclear-option-bindings', 'ai-assist-nuclear-option');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-ai-assist').click();
  await expect(page.getByTestId('ai-guide-page')).toBeVisible();

  // The one game here, and its one entry.
  await expect(page.getByTestId('ai-game')).toContainText('Nuclear Option');
  await expect(page.getByTestId('ai-aircraft')).toContainText('All aircraft');
  await expect(page.getByTestId('ai-guide-page')).toContainText(
    'For Nuclear Option: what matters when you fly it'
  );
  const where = page.getByTestId('ai-nuclear-option-where');
  await expect(where).toContainText(
    'This guide works on the one set of bindings Nuclear Option has for every aircraft.'
  );
  await expect(where).toContainText('press a button or a key, or move an axis');
  // No AI help for this game, with or without a key.
  await expect(page.getByTestId('ai-tab-ai')).toHaveCount(0);
  await expect(page.locator('.v-alert.text-error, .v-alert.bg-error')).toHaveCount(0);

  // 1. The first item is two axes, bound on the stick; each can be bound again by moving one.
  const item = page.getByTestId('ai-current-item');
  await expect(item).toHaveAttribute('data-item', 'pitch-roll');
  await expect(page.getByTestId('ai-item-status')).toHaveText('Bound');
  await expect(item).toContainText('Joystick - HOTAS Warthog');
  await expect(item.getByTestId('ai-bind')).toHaveCount(2);
  await expect(page.getByTestId('ai-in-game')).toHaveCount(0);
  await shot('walkthrough');

  // An axis nothing has yet: move the stick's X axis for Yaw, and have the game reverse it.
  const all = await controllers(page);
  const stick = all.find((c) => c.name === 'Joystick - HOTAS Warthog')!;
  const dialog = page.getByTestId('ai-nuclear-option-save-confirm');
  await page.getByTestId('ai-item-yaw').click();
  await expect(item).toHaveAttribute('data-item', 'yaw');
  // The unplugged pedals have it; the stick gets it too.
  await expect(item).not.toContainText('Joystick - HOTAS Warthog');
  await item.getByTestId('ai-bind').click();
  await expect(page.getByTestId('ai-listening')).toContainText('Move the axis on a controller');
  await run.sendInput([stateOf(stick)]);
  // A button is not an axis: said, and nothing is offered.
  await run.sendInput([stateOf(stick, [3])]);
  await expect(page.getByTestId('ai-press-note')).toContainText('This action needs an axis');
  await run.sendInput([stateOf(stick)]);
  await run.sendInput([stateOf(stick, [], [1])]);
  await expect(dialog).toContainText('Bind Yaw to X axis?');
  await expect(page.getByTestId('ai-nuclear-option-conflict')).toContainText(
    'X axis already does Roll Axis'
  );
  await page.getByTestId('ai-nuclear-option-invert').locator('input').check();
  await expect(page.getByTestId('ai-nuclear-option-after')).toHaveText('X axis, reversed');
  await shot('axis');
  await run.sendInput([stateOf(stick)]);
  await page.getByTestId('ai-nuclear-option-save-go').click();
  await expect(page.getByTestId('ai-nuclear-option-saved')).toContainText(
    'Saved: Yaw Axis is now on X axis, reversed of Joystick - HOTAS Warthog.'
  );
  await expect(item).toContainText('Joystick - HOTAS Warthog · X axis');

  // 2. An item nothing has yet: press a button on the stick to bind it.
  await page.getByTestId('ai-item-nav-lights').click();
  await expect(item).toHaveAttribute('data-item', 'nav-lights');
  await expect(page.getByTestId('ai-item-status')).toHaveText('Not bound on a controller');
  await item.getByTestId('ai-bind').click();
  await expect(page.getByTestId('ai-listening')).toContainText('Press a button or a key');
  await run.sendInput([stateOf(stick)]);
  // An axis moved is not a button: said, and nothing is offered.
  await run.sendInput([stateOf(stick, [], [1])]);
  await expect(page.getByTestId('ai-press-note')).toContainText(
    'This action needs a button or a key.'
  );
  await run.sendInput([stateOf(stick)]);
  // Button 1 is Fire: the review says one press would do both. Cancel writes nothing.
  await run.sendInput([stateOf(stick, [1])]);
  await expect(dialog).toContainText('Bind Navigation lights on or off to Button 1?');
  await expect(page.getByTestId('ai-nuclear-option-conflict')).toContainText(
    'Button 1 already does Fire. After saving, one press does both.'
  );
  await page.getByTestId('ai-nuclear-option-save-cancel').click();
  await expect(dialog).toBeHidden();
  await run.sendInput([stateOf(stick)]);

  await item.getByTestId('ai-bind').click();
  await expect(page.getByTestId('ai-listening')).toBeVisible();
  await run.sendInput([stateOf(stick, [12])]);
  await expect(dialog).toContainText('Bind Navigation lights on or off to Button 12?');
  await expect(page.getByTestId('ai-nuclear-option-device')).toHaveText('Joystick - HOTAS Warthog');
  await expect(page.getByTestId('ai-nuclear-option-before')).toHaveText('Not bound');
  await expect(page.getByTestId('ai-nuclear-option-after')).toHaveText('Button 12');
  await expect(page.getByTestId('ai-nuclear-option-conflict')).toHaveCount(0);
  await expect(dialog).toContainText(
    'Nuclear Option’s saved bindings for Joystick - HOTAS Warthog'
  );
  await expect(dialog).toContainText('Each file is backed up first; Undo is on the Safety page.');
  await shot('review');
  await run.sendInput([stateOf(stick)]);
  await page.getByTestId('ai-nuclear-option-save-go').click();
  await expect(page.getByTestId('ai-nuclear-option-saved')).toContainText(
    'Saved: Toggle Navigation Lights is now on Button 12 of Joystick - HOTAS Warthog. Undo is on the Safety page.'
  );
  await expect(page.getByTestId('ai-item-status')).toHaveText('Bound');
  await expect(item).toContainText('Joystick - HOTAS Warthog · Button 12');
  await shot('bound');

  // A key, pressed while the walkthrough listens: it goes into the keyboard's bindings.
  await page.getByTestId('ai-item-engine').click();
  await expect(item).toHaveAttribute('data-item', 'engine');
  await item.getByTestId('ai-bind').click();
  await expect(page.getByTestId('ai-listening')).toBeVisible();
  await page.keyboard.press('Control+F7');
  await expect(dialog).toContainText('Bind Engine on or off to Ctrl + F7?');
  await expect(page.getByTestId('ai-nuclear-option-device')).toHaveText('the keyboard');
  await shot('key');
  await page.getByTestId('ai-nuclear-option-save-go').click();
  await expect(page.getByTestId('ai-nuclear-option-saved')).toContainText(
    'Saved: Toggle Engine is now on Ctrl + F7 of the keyboard.'
  );
  await expect(item).toContainText('Keyboard · Ctrl + F7');

  // 3. The priorities: every tier, each item with its state from what the game saved.
  await page.getByTestId('ai-tab-priorities').click();
  await expect(page.getByTestId('ai-priorities')).toBeVisible();
  await expect(page.getByTestId('ai-tier-must')).toContainText('Must have to fly and fight');
  const row = (id: string) => page.locator(`[data-testid="ai-priority-item"][data-item="${id}"]`);
  await expect(row('fire')).toHaveAttribute('data-status', 'bound');
  await expect(row('nav-lights')).toHaveAttribute('data-status', 'bound');
  await expect(row('yaw')).toHaveAttribute('data-status', 'bound');
  // A key does not make a panel item "bound on a controller".
  await expect(row('engine')).toHaveAttribute('data-status', 'unbound');
  await expect(page.locator('[data-testid="ai-priority-item"][data-status="missing"]')).toHaveCount(
    0
  );
  await shot('priorities');

  // 4. The change is one entry on the Safety page; Undo puts the saved bindings back.
  await page.getByTestId('ai-nuclear-option-safety').click();
  await expect(page.getByTestId('safety-page')).toBeVisible();
  const group = page.locator(
    '[data-testid="change-group"][data-reason="Nuclear Option bindings: Toggle Navigation Lights bound to Button 12 on Joystick - HOTAS Warthog"]'
  );
  await expect(group).toHaveCount(1);
  await group.getByTestId('change-undo').click();
  await expect(page.getByTestId('safety-message')).toContainText('Undid "Nuclear Option bindings');
  await page.getByTestId('nav-ai-assist').click();
  await page.getByTestId('ai-tab-priorities').click();
  await expect(row('nav-lights')).toHaveAttribute('data-status', 'unbound');

  // 5. While the game runs the review says why, and Save is off.
  await run.mutate([
    { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
  ]);
  await page.getByTestId('ai-tab-walkthrough').click();
  await page.getByTestId('ai-item-nav-lights').click();
  await item.getByTestId('ai-bind').click();
  await expect(page.getByTestId('ai-listening')).toBeVisible();
  await run.sendInput([stateOf(stick, [12])]);
  await expect(page.getByTestId('ai-nuclear-option-blocked')).toContainText(
    'Close Nuclear Option first'
  );
  await expect(page.getByTestId('ai-nuclear-option-save-go')).toBeDisabled();
  await shot('blocked');
  await page.getByTestId('ai-nuclear-option-save-cancel').click();

  // The link goes to the bindings page.
  await page.getByTestId('ai-nuclear-option-page').click();
  await expect(page.getByTestId('nuclear-option-bindings-page')).toBeVisible();
});
