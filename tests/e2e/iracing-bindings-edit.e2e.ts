import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test, type RunningApp } from './harness';

/**
 * Changing one iRacing binding from the bindings page: bind by pressing a button or a key,
 * clear, for all cars and for one car, with what would change shown first.
 *
 * This is switched off in the product (iracing-bindings.e2e.ts holds the page to that).
 * Every test here turns the switch on for its own run of the app, on a copy of the files
 * in a temp folder. Nothing here proves that iRacing takes the file: that is the rig step
 * in docs/research/iracing-bindings.md.
 */

const ROUTE = '/configure/iracing-bindings';
const SWITCH_ON = { env: { RIGREADY_IRACING_EDIT: '1' } };
const WHEEL = 'FANATEC Podium Wheel Base DD2';
const WHEEL_GUID = '20B0BED0-03A4-11F1-8001-444553540000';
const BOX_GUID = '5EED0001-7A11-11EF-8004-444553540000';
const CAR = 'mx5 mx52016';
const CAR_ROUTE = `${ROUTE}?set=${encodeURIComponent(`car:${CAR}`)}`;

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

const row = (page: Page, action: string): Locator =>
  page.locator(`[data-testid="iracing-bindings-row"][data-action="${action}"]`);
const change = (page: Page, action: string): Locator =>
  row(page, action).getByTestId('iracing-bindings-change');
const counts = (page: Page): Locator => page.getByTestId('iracing-bindings-counts');
const headers = (page: Page): Locator =>
  page.getByTestId('iracing-bindings-table').locator('thead th');

interface Answer<T> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string };
}

/** Asks the app as the page does, to get the answer itself. */
const ask = async <T>(page: Page, channel: string, input?: unknown): Promise<Answer<T>> =>
  (await page.evaluate(
    ([name, payload]) =>
      (
        globalThis as unknown as {
          rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
        }
      ).rigready.invoke(name as string, payload),
    [channel, input] as const
  )) as Answer<T>;

interface Controller {
  index: number;
  name: string;
  guid: string;
  numAxes: number;
  numButtons: number;
  numHats: number;
}

async function controller(page: Page, guid: string): Promise<Controller> {
  const all = await ask<Controller[]>(page, 'devices:inputDevices');
  const found = (all.value ?? []).find((c) => c.guid.replace(/[{}]/g, '').toUpperCase() === guid);
  if (!found) throw new Error(`no controller ${guid} in the scenario`);
  return found;
}

let clock = 20_000;
/** A controller with the given buttons held (the first is 1) or one axis moved, the rest at rest. */
function stateOf(c: Controller, held: { buttons?: number[]; axis?: number } = {}) {
  return {
    index: c.index,
    name: c.name,
    axes: Array.from({ length: c.numAxes }, (_, i) => (i === held.axis ? 0.9 : 0)),
    buttons: Array.from({ length: c.numButtons }, (_, i) => (held.buttons ?? []).includes(i + 1)),
    hats: Array.from({ length: c.numHats }, (): [number, number] => [0, 0]),
    timestamp: clock++,
  };
}

const generalFile = (run: RunningApp): string =>
  path.join(run.home, 'Documents', 'iRacing', 'controls.cfg');
const carFile = (run: RunningApp): string =>
  path.join(run.home, 'Documents', 'iRacing', 'setups', CAR, 'controls.cfg');

/**
 * Holds a written file to the one change: the same length, and every byte that differs is
 * inside the binding part of that action's record (bytes 8 to 67 of the 68 after its name).
 */
function expectOnlyRecordChanged(before: Buffer, after: Buffer, action: string): void {
  expect(after.length).toBe(before.length);
  const name = Buffer.from(`${action}\0`, 'latin1');
  const at = before.indexOf(name);
  expect(at, action).toBeGreaterThan(0);
  expect(before.lastIndexOf(name), `${action} is in the file once`).toBe(at);
  const data = at + name.length;
  const differs: number[] = [];
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) differs.push(i);
  expect(differs.length, `${action} changed`).toBeGreaterThan(0);
  expect(differs[0]!, 'first changed byte').toBeGreaterThanOrEqual(data + 8);
  expect(differs[differs.length - 1]!, 'last changed byte').toBeLessThan(data + 68);
}

/** Opens the dialog for an action and starts listening for a press. */
async function listenFor(page: Page, action: string): Promise<void> {
  await change(page, action).click();
  await expect(page.getByTestId('iracing-edit')).toBeVisible();
  await page.getByTestId('iracing-edit-listen').click();
  await expect(page.getByTestId('iracing-edit-listening')).toBeVisible();
}

test('iRacing bindings, switched on: bind by pressing a button or a key, clear, and undo', async ({
  rig,
}) => {
  const run = await rig.launch('iracing-bindings-car', 'iracing-bindings-edit', SWITCH_ON);
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await go(page, ROUTE);
  await expect(counts(page)).toHaveText('367 actions · 183 bound · 184 not bound');

  // The notice says what the page can now do, and that iRacing has not been tried with it.
  const trial = page.getByTestId('iracing-bindings-trial');
  await expect(trial).toContainText(
    'You can change bindings here. This is new, and not yet tried in iRacing.'
  );
  await expect(trial).toContainText('RigReady shows what will change first');
  await expect(trial).toContainText('makes a backup of the file');
  await expect(page.getByTestId('iracing-bindings-readonly')).toHaveCount(0);
  await expect(headers(page)).toHaveText(['Action', 'Bound to', 'On', 'Change']);
  // An axis stays with iRacing, which calibrates it as it binds it.
  await expect(row(page, 'Throttle').getByTestId('iracing-bindings-in-iracing')).toHaveText(
    'In iRacing'
  );
  await expect(change(page, 'Throttle')).toHaveCount(0);
  await shot('switched-on');

  const file = generalFile(run);
  const original = await fs.readFile(file);
  const wheel = await controller(page, WHEEL_GUID);
  const box = await controller(page, BOX_GUID);
  const dialog = page.getByTestId('iracing-edit');
  const note = page.getByTestId('iracing-edit-note');
  const listening = page.getByTestId('iracing-edit-listening');
  const confirm = page.getByTestId('iracing-save-confirm');
  const save = page.getByTestId('iracing-save-go');
  const saved = page.getByTestId('iracing-bindings-saved');

  // 1. An action with nothing on it, bound by pressing a button.
  await change(page, 'HeadlightFlash').click();
  await expect(page.getByTestId('iracing-edit-action')).toHaveText('Flash headlights');
  await expect(page.getByTestId('iracing-edit-set')).toHaveText('In the bindings for all cars');
  await expect(page.getByTestId('iracing-edit-now')).toHaveText('Now: Not bound');
  await expect(page.getByTestId('iracing-edit-clear')).toHaveCount(0);
  await shot('change-a-binding');
  await page.getByTestId('iracing-edit-listen').click();
  await expect(listening).toHaveText('Press the button or the key now… Esc stops.');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);

  // What cannot be bound here is not taken, and the dialog says where to bind it.
  await run.sendInput([stateOf(wheel), stateOf(box)]);
  await run.sendInput([stateOf(wheel, { axis: 0 })]);
  await expect(note).toContainText('That was an axis on');
  await expect(note).toContainText(
    'Bind an axis in iRacing: it calibrates the axis as it binds it.'
  );
  await page.keyboard.press('Numpad5');
  await expect(note).toContainText(
    'RigReady does not bind number pad keys yet. Bind this one in iRacing.'
  );
  await expect(listening).toBeVisible();
  await shot('press-now');

  await run.sendInput([stateOf(box, { buttons: [7] })]);
  await expect(confirm).toContainText('Bind Flash headlights to Button 7 on Button Box?');
  await expect(page.getByTestId('iracing-save-before')).toHaveText('Not bound');
  await expect(page.getByTestId('iracing-save-after')).toHaveText('Button 7 on Button Box');
  await expect(page.getByTestId('iracing-save-set')).toHaveText('All cars');
  await expect(page.getByTestId('iracing-save-conflict')).toHaveCount(0);
  await expect(page.getByTestId('iracing-save-camera')).toHaveCount(0);
  await expect(confirm.getByTestId('change-preview-file')).toContainText('controls.cfg');
  await expect(confirm).toContainText('Each file is backed up first; Undo is on the Safety page.');
  await expect(page.getByTestId('iracing-save-trial')).toContainText(
    'Not yet tried in iRacing. RigReady changes this one binding and leaves the rest of the file as it was.'
  );
  // Looking is not writing.
  expect((await fs.readFile(file)).equals(original)).toBe(true);
  await shot('review');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);

  await save.click();
  await expect(saved).toHaveText(
    'Saved in iRacing’s file for all cars: Flash headlights is now bound to Button 7 on Button Box. Undo is on the Safety page.'
  );
  await expect(confirm).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  await expect(row(page, 'HeadlightFlash')).toHaveAttribute('data-bound', 'yes');
  await expect(row(page, 'HeadlightFlash')).toContainText('Button 7');
  await expect(row(page, 'HeadlightFlash')).toContainText('Button Box');
  await expect(row(page, 'HeadlightFlash').getByTestId('iracing-bindings-row-saved')).toHaveText(
    'Saved'
  );
  await expect(counts(page)).toHaveText('367 actions · 184 bound · 183 not bound');
  await expect(page.getByTestId('iracing-bindings-device')).toHaveCount(3);
  const afterButton = await fs.readFile(file);
  expectOnlyRecordChanged(original, afterButton, 'HeadlightFlash');
  await row(page, 'HeadlightFlash').scrollIntoViewIfNeeded();
  await shot('saved');

  // The same button again: there is nothing to save, and the page says so.
  await run.sendInput([stateOf(box)]);
  await listenFor(page, 'HeadlightFlash');
  await expect(page.getByTestId('iracing-edit-now')).toHaveText('Now: Button 7 on Button Box');
  await run.sendInput([stateOf(box)]);
  await run.sendInput([stateOf(box, { buttons: [7] })]);
  await expect(page.getByTestId('iracing-save-same')).toHaveText(
    'Flash headlights already has this. There is nothing to save.'
  );
  await expect(save).toBeDisabled();
  await page.getByTestId('iracing-save-cancel').click();
  await expect(confirm).toHaveCount(0);
  await run.sendInput([stateOf(box)]);

  // 2. A key that already does something: the page says what, before anything is saved.
  await listenFor(page, 'BlackBoxShowNext');
  await expect(page.getByTestId('iracing-edit-action')).toHaveText('Black box show next');
  await page.keyboard.press('s');
  await expect(confirm).toContainText('Bind Black box show next to S on the keyboard?');
  await expect(page.getByTestId('iracing-save-conflict')).toContainText(
    'S on the keyboard already does Starter. After saving, one press does both. RigReady leaves the other binding as it is.'
  );
  await expect(page.getByTestId('iracing-save-camera')).toContainText(
    'In iRacing’s camera editor the same key is Camera longitude down.'
  );
  await shot('conflict');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await page.getByTestId('iracing-save-cancel').click();
  await expect(confirm).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  await expect(row(page, 'BlackBoxShowNext')).toHaveAttribute('data-bound', 'no');
  expect((await fs.readFile(file)).equals(afterButton)).toBe(true);

  // A key with Shift that nothing uses.
  await listenFor(page, 'BlackBoxShowNext');
  await page.keyboard.press('Shift+J');
  await expect(confirm).toContainText('Bind Black box show next to Shift+J on the keyboard?');
  await expect(page.getByTestId('iracing-save-conflict')).toHaveCount(0);
  await expect(page.getByTestId('iracing-save-camera')).toHaveCount(0);
  await save.click();
  await expect(saved).toHaveText(
    'Saved in iRacing’s file for all cars: Black box show next is now bound to Shift+J on the keyboard. Undo is on the Safety page.'
  );
  await expect(row(page, 'BlackBoxShowNext')).toContainText('Shift+J');
  await expect(row(page, 'BlackBoxShowNext')).toContainText('Keyboard');
  const afterKey = await fs.readFile(file);
  expectOnlyRecordChanged(afterButton, afterKey, 'BlackBoxShowNext');

  // 3. Clearing a binding. Esc ends the listening first, not the dialog.
  await listenFor(page, 'Gear1');
  await expect(page.getByTestId('iracing-edit-now')).toHaveText(`Now: Button 14 on ${WHEEL}`);
  await page.keyboard.press('Escape');
  await expect(listening).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.getByTestId('iracing-edit-clear').click();
  await expect(confirm).toContainText('Clear the binding of Gear 1?');
  await expect(page.getByTestId('iracing-save-before')).toHaveText(`Button 14 on ${WHEEL}`);
  await expect(page.getByTestId('iracing-save-after')).toHaveText('Not bound');
  await shot('clear');
  await save.click();
  await expect(saved).toHaveText(
    'Saved in iRacing’s file for all cars: Gear 1 is no longer bound. Undo is on the Safety page.'
  );
  await expect(row(page, 'Gear1')).toHaveAttribute('data-bound', 'no');
  await expect(counts(page)).toHaveText('367 actions · 184 bound · 183 not bound');
  const afterClear = await fs.readFile(file);
  expectOnlyRecordChanged(afterKey, afterClear, 'Gear1');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);

  // 4. Each change is one entry on the Safety page, and Undo puts the file back.
  await page.getByTestId('iracing-bindings-safety-link').click();
  await expect(page.getByTestId('safety-page')).toBeVisible();
  const group = (reason: string): Locator =>
    page.locator(`[data-testid="change-group"][data-reason="${reason}"]`);
  await expect(
    group('iRacing bindings for all cars: Flash headlights bound to Button 7 on Button Box')
  ).toHaveCount(1);
  await expect(
    group('iRacing bindings for all cars: Black box show next bound to Shift+J on the keyboard')
  ).toHaveCount(1);
  const cleared = group('iRacing bindings for all cars: Gear 1 cleared');
  await cleared.getByTestId('change-toggle').click();
  await expect(cleared.getByTestId('change-file')).toContainText('controls.cfg');
  await shot('safety-page');
  await cleared.getByTestId('change-undo').click();
  await expect(page.getByTestId('safety-message')).toContainText(
    'Undid "iRacing bindings for all cars: Gear 1 cleared"'
  );
  expect((await fs.readFile(file)).equals(afterKey)).toBe(true);
  await go(page, ROUTE);
  await expect(row(page, 'Gear1')).toContainText('Button 14');
  await expect(row(page, 'Gear1')).toHaveAttribute('data-bound', 'yes');
  await expect(counts(page)).toHaveText('367 actions · 185 bound · 182 not bound');
});

test('iRacing bindings, switched on: one car’s own bindings, and no saving while iRacing runs', async ({
  rig,
}) => {
  const run = await rig.launch('iracing-bindings-car', 'iracing-bindings-edit-car', SWITCH_ON);
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await go(page, CAR_ROUTE);
  await expect(counts(page)).toHaveText(
    '367 actions · 186 bound · 181 not bound · 8 differ from All cars'
  );
  await expect(headers(page)).toHaveText(['Action', 'Bound to', 'On', 'All cars has', 'Change']);

  const general = await fs.readFile(generalFile(run));
  const car = await fs.readFile(carFile(run));
  const box = await controller(page, BOX_GUID);
  const confirm = page.getByTestId('iracing-save-confirm');
  const save = page.getByTestId('iracing-save-go');

  // On this car Look left has nothing, and button 1 of the box is already Brake bias up.
  await change(page, 'LookLeft').click();
  await expect(page.getByTestId('iracing-edit-set')).toHaveText(`In the custom controls of ${CAR}`);
  await expect(page.getByTestId('iracing-edit-now')).toHaveText('Now: Not bound');
  await page.getByTestId('iracing-edit-listen').click();
  await expect(page.getByTestId('iracing-edit-listening')).toBeVisible();
  await run.sendInput([stateOf(box)]);
  await run.sendInput([stateOf(box, { buttons: [1] })]);
  await expect(confirm).toContainText('Bind Look left to Button 1 on Button Box?');
  await expect(page.getByTestId('iracing-save-set')).toHaveText(`${CAR} only`);
  await expect(page.getByTestId('iracing-save-conflict')).toContainText(
    'Button 1 on Button Box already does Brake bias up. After saving, one press does both. RigReady leaves the other binding as it is.'
  );
  await expect(confirm.getByTestId('change-preview-file')).toContainText(
    `setups\\${CAR}\\controls.cfg`
  );
  await shot('car-conflict');
  await save.click();
  await expect(page.getByTestId('iracing-bindings-saved')).toHaveText(
    `Saved in iRacing’s file for ${CAR}: Look left is now bound to Button 1 on Button Box. Undo is on the Safety page.`
  );
  await expect(row(page, 'LookLeft')).toContainText('Button 1');
  await expect(row(page, 'LookLeft')).toContainText('Button Box');
  await expect(counts(page)).toHaveText(
    '367 actions · 187 bound · 180 not bound · 8 differ from All cars'
  );
  // The button now does two things on this car, and the page lists it as such.
  const twice = page.getByTestId('iracing-bindings-shared-row').filter({ hasText: 'Button Box' });
  await expect(twice).toHaveCount(1);
  await expect(twice).toContainText('Look left');
  await expect(twice).toContainText('Brake bias up');
  await row(page, 'LookLeft').scrollIntoViewIfNeeded();
  await shot('car-saved');

  // The car's file changed in that one record. The file for all cars was not touched.
  const carAfter = await fs.readFile(carFile(run));
  expectOnlyRecordChanged(car, carAfter, 'LookLeft');
  expect((await fs.readFile(generalFile(run))).equals(general)).toBe(true);

  // iRacing writes its files when it closes. While it runs nothing is saved, and the page
  // says why before the user gets as far as Save.
  await run.mutate([
    {
      op: 'startProcess',
      name: 'iRacingSim64DX11.exe',
      path: 'C:\\iRacing\\iRacingSim64DX11.exe',
    },
  ]);
  await go(page, '/configure/games/iracing');
  await expect(page.getByTestId('iracing-bindings-page')).toHaveCount(0);
  await go(page, CAR_ROUTE);
  await expect(page.getByTestId('iracing-bindings-running')).toContainText(
    'Close iRacing before you change a binding here: when it closes it would write its own bindings over the change.'
  );
  await change(page, 'LookLeft').click();
  await page.getByTestId('iracing-edit-clear').click();
  await expect(confirm).toContainText('Clear the binding of Look left?');
  await expect(page.getByTestId('iracing-save-blocked')).toContainText(
    'Close iRacing first. iRacing writes its bindings when it closes and would undo the change.'
  );
  await expect(save).toBeDisabled();
  await page.getByTestId('iracing-save-blocked').scrollIntoViewIfNeeded();
  await shot('iracing-running');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  // Asked directly, the app refuses too: the check is in the main process, not on the page.
  const refused = await ask(page, 'iracing-bindings:change', {
    set: `car:${CAR}`,
    action: 'LookLeft',
    binding: null,
  });
  expect(refused.ok).toBe(false);
  expect(refused.error?.code).toBe('iracing-bindings.edit.blocked');
  await page.getByTestId('iracing-save-cancel').click();
  await expect(confirm).toHaveCount(0);
  expect((await fs.readFile(carFile(run))).equals(carAfter)).toBe(true);
  expect((await fs.readFile(generalFile(run))).equals(general)).toBe(true);
});
