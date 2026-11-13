import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test, type RunningApp } from './harness';

/**
 * The binding guide for iRacing (AI-IRACING-001 to AI-IRACING-006): the game picker, the class picker with
 * the cars that have controls of their own, the priorities, an axis item that is bound in
 * iRacing itself, and a walkthrough step that binds a wheel button and a key through the
 * iRacing bindings feature, shown first and saved into the control profile iRacing uses.
 *
 * Changing iRacing bindings is turned on for these runs as a build that has it runs; the
 * files are copies in a temp folder (fixtures/scenarios/ai-assist-iracing.yaml).
 */

const SWITCH_ON = { env: { RIGREADY_IRACING_EDIT: '1' } };
const WHEEL_GUID = '45D4BEA1-60A1-17D8-8001-444553540000';

interface Answer<T> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string };
}

/** Asks the app as a page does. */
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

async function wheel(page: Page): Promise<Controller> {
  const all = await ask<Controller[]>(page, 'devices:inputDevices');
  const found = (all.value ?? []).find(
    (c) => c.guid.replace(/[{}]/g, '').toUpperCase() === WHEEL_GUID
  );
  if (!found) throw new Error('no wheel in the scenario');
  return found;
}

let clock = 30_000;
/** The wheel with the given buttons held (the first is 1), or one hat pushed, the rest at rest. */
function stateOf(c: Controller, held: { buttons?: number[]; hat?: boolean } = {}) {
  return {
    index: c.index,
    name: c.name,
    axes: Array.from({ length: c.numAxes }, () => 0),
    buttons: Array.from({ length: c.numButtons }, (_, i) => (held.buttons ?? []).includes(i + 1)),
    hats: Array.from({ length: c.numHats }, (): [number, number] => (held.hat ? [0, 1] : [0, 0])),
    timestamp: clock++,
  };
}

const profile = (run: RunningApp): string =>
  path.join(run.home, 'Documents', 'iRacing', 'profiles', 'controls', 'Baseline', 'controls.cfg');
const item = (page: Page, id: string): Locator => page.getByTestId(`ai-item-${id}`);
const current = (page: Page): Locator => page.getByTestId('ai-current-item');

async function openIracingGuide(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-ai-assist').click();
  await expect(page.getByTestId('ai-guide-page')).toBeVisible();
  // The racing rig has DCS too: the guide opens on it, and the game picker leads to iRacing.
  await expect(page.getByTestId('ai-game')).toContainText('DCS World');
}

test('ai-assist-iracing: pick iRacing and a class, see the priorities, and an axis to bind in iRacing', async ({
  rig,
}) => {
  const run = await rig.launch('ai-assist-iracing', 'ai-assist-iracing', SWITCH_ON);
  const { page, shot } = run;
  await openIracingGuide(page);

  await page.getByTestId('ai-game').click();
  await expect(page.getByRole('option', { name: 'iRacing' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'DCS World' })).toBeVisible();
  await shot('game-picker');
  await page.getByRole('option', { name: 'iRacing' }).click();
  await expect(page.getByTestId('ai-game')).toContainText('iRacing');
  await expect(page.getByTestId('ai-guide-page').locator('.rr-page-sub')).toContainText(
    'For iRacing: what matters in each class of car'
  );

  // The classes, then the cars with controls of their own.
  await expect(page.getByTestId('ai-aircraft')).toContainText('GT3');
  await page.getByTestId('ai-aircraft').click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(8);
  await expect(options.nth(0)).toContainText('GT3');
  await expect(options.nth(0)).toContainText('Guide included');
  await expect(options.nth(3)).toContainText('Formula and open-wheel');
  await expect(options.nth(6)).toContainText('cadillacctsvr (own controls)');
  await expect(options.nth(6)).toContainText('No guide yet');
  await expect(options.nth(7)).toContainText('porsche992rgt3 (own controls)');
  await expect(options.nth(7)).toContainText('Uses the GT3 guide');
  await shot('class-picker');
  await options.nth(0).click();

  await expect(page.getByTestId('ai-iracing-where')).toContainText(
    'This guide works on the bindings for all cars, in iRacing’s control profile “Baseline”.'
  );

  // Priorities: bound, not bound, or bind in iRacing (the clutch axis is not bound here).
  await page.getByTestId('ai-tab-priorities').click();
  const row = (id: string): Locator =>
    page.locator(`[data-testid="ai-priority-item"][data-item="${id}"]`);
  await expect(page.getByTestId('ai-tier-must')).toContainText('Must have to drive and race');
  await expect(row('steering')).toHaveAttribute('data-status', 'bound');
  await expect(row('steering').getByTestId('ai-priority-state')).toHaveText('Bound');
  await expect(row('headlights').getByTestId('ai-priority-state')).toHaveText(
    'Not bound on a controller'
  );
  await expect(row('clutch')).toHaveAttribute('data-status', 'inGame');
  await expect(row('clutch').getByTestId('ai-priority-state')).toHaveText('Bind in iRacing');
  // iRacing's own id beside the plain name.
  await expect(row('pit-limiter')).toContainText('Pit speed limiter');
  await expect(row('pit-limiter')).toContainText('PitSpeedLimiter');
  await expect(page.getByTestId('ai-sources')).toContainText('Not reviewed by a racing driver');
  await shot('priorities');

  // An axis item: bound in iRacing itself, never marked done by RigReady.
  await page.getByTestId('ai-tab-walkthrough').click();
  await expect(current(page)).toHaveAttribute('data-item', 'steering');
  await expect(page.getByTestId('ai-in-game')).toContainText(
    'Bind this in iRacing: Options, then Controls'
  );
  await expect(current(page).getByTestId('ai-bind')).toHaveCount(0);
  await expect(current(page).getByTestId('ai-done')).toHaveCount(0);
  await expect(current(page).getByTestId('ai-not-writable').first()).toContainText(
    'An axis: bind it in iRacing'
  );
  await expect(page.getByTestId('ai-progress-in-game')).toContainText('set up in iRacing itself');
  await item(page, 'clutch').click();
  await expect(page.getByTestId('ai-item-status')).toHaveText('Bind in iRacing');
  await expect(page.getByTestId('ai-in-game')).toBeVisible();
  await shot('axis-item');
  await page.getByTestId('ai-next').click();
  await expect(current(page)).not.toHaveAttribute('data-item', 'clutch');
});

test('ai-assist-iracing: the walkthrough binds a wheel button and a key into iRacing’s profile, shown first', async ({
  rig,
}) => {
  const run = await rig.launch('ai-assist-iracing', 'ai-assist-iracing-bind', SWITCH_ON);
  const { page, shot } = run;
  await openIracingGuide(page);
  await page.getByTestId('ai-game').click();
  await page.getByRole('option', { name: 'iRacing' }).click();
  await expect(page.getByTestId('ai-aircraft')).toContainText('GT3');
  const file = profile(run);
  const before = await fs.readFile(file);

  // A wheel button for the headlight flash.
  await item(page, 'headlights').click();
  await expect(current(page)).toHaveAttribute('data-item', 'headlights');
  await expect(page.getByTestId('ai-item-status')).toHaveText('Not bound on a controller');
  const dd2 = await wheel(page);
  await run.sendInput([stateOf(dd2)]);
  await current(page).getByTestId('ai-bind').click();
  await expect(page.getByTestId('ai-listening')).toContainText('Press a button or a key');
  // A hat switch is refused, with the reason, and the walkthrough keeps listening.
  await run.sendInput([stateOf(dd2)]);
  await run.sendInput([stateOf(dd2, { hat: true })]);
  await expect(page.getByTestId('ai-press-note')).toContainText(
    'RigReady binds buttons and keys in iRacing. Bind a hat switch in iRacing'
  );
  await expect(page.getByTestId('ai-listening')).toBeVisible();
  await run.sendInput([stateOf(dd2)]);
  await run.sendInput([stateOf(dd2, { buttons: [40] })]);
  const confirm = page.getByTestId('ai-iracing-save-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Bind Flash headlights to Button 40 on');
  await expect(page.getByTestId('ai-iracing-before')).toHaveText('Not bound');
  await expect(page.getByTestId('ai-iracing-set')).toHaveText('All cars');
  await expect(confirm).toContainText('controls.cfg');
  // Nothing written yet.
  expect((await fs.readFile(file)).equals(before)).toBe(true);
  await shot('walkthrough-step');
  await page.getByTestId('ai-iracing-save-go').click();
  await expect(page.getByTestId('ai-iracing-saved')).toContainText(
    'Saved in iRacing’s file for all cars: Flash headlights is now bound to Button 40'
  );
  await expect(page.getByTestId('ai-item-status')).toHaveText('Bound');
  expect((await fs.readFile(file)).equals(before)).toBe(false);
  await shot('saved');

  // A key for the next black box, as iRacing stores it.
  await item(page, 'black-box').click();
  await run.sendInput([stateOf(dd2)]);
  await current(page)
    .locator('[data-testid="ai-action"][data-action="BlackBoxShowNext"]')
    .getByTestId('ai-bind')
    .click();
  await expect(page.getByTestId('ai-listening')).toBeVisible();
  await page.keyboard.press('Shift+J');
  await expect(confirm).toContainText('Bind Next black box to Shift+J');
  await page.getByTestId('ai-iracing-save-go').click();
  await expect(page.getByTestId('ai-iracing-saved')).toContainText('Next black box');

  // The iRacing bindings page shows both, with the guide's plain names and iRacing's ids.
  await page.getByTestId('ai-iracing-page').click();
  const bound = (action: string): Locator =>
    page.locator(`[data-testid="iracing-bindings-row"][data-action="${action}"]`);
  await expect(bound('HeadlightFlash')).toContainText('Button 40');
  await expect(bound('BlackBoxShowNext')).toContainText('Shift+J');
  await expect(bound('DashPageInc')).toContainText('Next dash page');
  await bound('HeadlightFlash').scrollIntoViewIfNeeded();
  await shot('bindings-page');
});

test('ai-assist-iracing: a car whose folder name says GT3 uses that guide, and says why', async ({
  rig,
}) => {
  const run = await rig.launch('ai-assist-iracing', 'ai-assist-iracing-car', SWITCH_ON);
  const { page, shot } = run;
  await openIracingGuide(page);
  await page.getByTestId('ai-game').click();
  await page.getByRole('option', { name: 'iRacing' }).click();
  await page.getByTestId('ai-aircraft').click();
  await page.getByRole('option', { name: /porsche992rgt3/ }).click();
  await expect(page.getByTestId('ai-iracing-suggested')).toContainText(
    "RigReady uses the GT3 guide here, because the car's folder name has “gt3” in it."
  );
  await expect(page.getByTestId('ai-iracing-where')).toContainText(
    'the bindings of porsche992rgt3'
  );
  await expect(page.getByTestId('ai-guide-file')).toBeVisible();
  await shot('suggested-class');

  // A car whose name says no class has no guide: it can have one of its own.
  await page.getByTestId('ai-aircraft').click();
  await page.getByRole('option', { name: /cadillacctsvr/ }).click();
  await expect(page.getByTestId('ai-no-guide')).toContainText(
    'There is no guide for cadillacctsvr (own controls) yet'
  );
  await page.getByTestId('ai-guide-start').click();
  await expect(page.getByTestId('ai-guide-own')).toBeVisible();
  await expect(current(page)).toBeVisible();
  await shot('own-guide');
});
