import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test, type RunningApp } from './harness';

/**
 * The bindings of controllers that are gone, on the iRacing bindings page: which
 * controllers of the set are not plugged in and why, the ones that are gone ticked one by
 * one, the review of what changes, and the file afterwards. Clearing is behind the same
 * switch as changing a binding, so the tests that clear turn it on for their own run.
 */

const ROUTE = '/configure/iracing-bindings';
const SWITCH_ON = { env: { RIGREADY_IRACING_EDIT: '1' } };
const PEDALS = '5EED00A1-7A11-11EF-8001-444553540000';
const BOX = '5EED00A2-7A11-11EF-8002-444553540000';
const RUDDER = '0F1424B4-D566-14A0-801B-444553540000';
const WHEEL = '45D4BEA1-60A1-17D8-8001-444553540000';

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);
const gone = (page: Page, key: string): Locator =>
  page.locator(`[data-testid="iracing-gone-device"][data-device="${key}"]`);
const profile = (run: RunningApp): string =>
  path.join(run.home, 'Documents', 'iRacing', 'profiles', 'controls', 'Baseline', 'controls.cfg');

/** The records of a controls.cfg: each action's name and where its 68 bytes start. */
function records(file: Buffer): { action: string; offset: number }[] {
  const chunk = file.indexOf('LRTC', 0, 'latin1');
  const start = chunk + 12;
  const end = start + file.readUInt32LE(chunk + 8);
  const out: { action: string; offset: number }[] = [];
  for (let at = start; at < end;) {
    const nul = file.indexOf(0, at);
    out.push({ action: file.toString('latin1', at, nul), offset: nul + 1 });
    at = nul + 1 + 68;
  }
  return out;
}

/** The actions whose record changed between two copies of a controls.cfg, each only in its binding bytes. */
function changedActions(before: Buffer, after: Buffer): string[] {
  expect(after.length).toBe(before.length);
  const all = records(before);
  const actions = new Set<string>();
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const record = all.find((r) => i >= r.offset + 8 && i < r.offset + 68);
    expect(record, `byte ${i} is in the binding bytes of a record`).toBeDefined();
    actions.add(record!.action);
  }
  return [...actions].sort();
}

test('iRacing bindings: clear the bindings of a controller that is gone, after the review', async ({
  rig,
}) => {
  const run = await rig.launch('iracing-bindings-cleanup', 'iracing-bindings-cleanup', SWITCH_ON);
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await go(page, ROUTE);
  const panel = page.getByTestId('iracing-gone');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('iracing-gone-device')).toHaveCount(3);

  // Two never seen on this PC can be ticked; the rudder pedals the history saw cannot.
  await expect(gone(page, PEDALS)).toHaveAttribute('data-verdict', 'gone');
  await expect(gone(page, PEDALS).getByTestId('iracing-gone-name')).toHaveText('Load Cell Pedals');
  await expect(gone(page, PEDALS).getByTestId('iracing-gone-verdict')).toHaveText(
    'Not seen on this PC'
  );
  await expect(gone(page, PEDALS).getByTestId('iracing-gone-why')).toContainText(
    'Not plugged in, and RigReady has never seen it on this PC.'
  );
  await expect(gone(page, BOX)).toHaveAttribute('data-verdict', 'gone');
  await expect(gone(page, RUDDER)).toHaveAttribute('data-verdict', 'unplugged');
  await expect(gone(page, RUDDER).getByTestId('iracing-gone-verdict')).toHaveText('Unplugged');
  await expect(gone(page, RUDDER).getByTestId('iracing-gone-why')).toContainText(
    'Unplugged today. RigReady last saw it on this PC on'
  );
  await expect(gone(page, RUDDER).getByTestId('iracing-gone-choose')).toHaveCount(0);
  await expect(gone(page, WHEEL)).toHaveCount(0);
  // Nothing is ticked for the user, and the button says why it waits.
  await expect(page.getByTestId('iracing-gone-review')).toBeDisabled();
  await expect(page.getByTestId('iracing-gone-tick-hint')).toHaveText(
    'Tick each controller that is gone for good. Nothing is ticked for you.'
  );
  await panel.scrollIntoViewIfNeeded();
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('offer');

  // Choose the pedals only, and look at what would change.
  const before = await fs.readFile(profile(run));
  await gone(page, PEDALS).getByTestId('iracing-gone-choose').locator('input').check();
  await expect(page.getByTestId('iracing-gone-review')).toHaveText('Review clearing 3 bindings');
  await page.getByTestId('iracing-gone-review').click();
  const dialog = page.getByTestId('iracing-gone-confirm');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('iracing-gone-review-device')).toHaveCount(1);
  await expect(page.getByTestId('iracing-gone-review-device')).toContainText(
    'Load Cell Pedals: 3 bindings'
  );
  await expect(page.getByTestId('iracing-gone-review-binding')).toHaveCount(3);
  await expect(dialog).toContainText('control profile “Baseline”');
  await expect(dialog).toContainText('controls.cfg');
  await expect(page.getByTestId('iracing-gone-go')).toHaveText('Clear 3 bindings');
  await expect(page.getByTestId('iracing-gone-go')).toBeEnabled();
  // Nothing is written while the review is open.
  expect((await fs.readFile(profile(run))).equals(before)).toBe(true);
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('review');

  await page.getByTestId('iracing-gone-go').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('iracing-gone-cleared')).toContainText(
    'Cleared 3 bindings of Load Cell Pedals in iRacing’s file for all cars. Undo is on the Safety page.'
  );
  // The pedals are gone from the list; the box, not chosen, and the rudder pedals stay.
  await expect(gone(page, PEDALS)).toHaveCount(0);
  await expect(gone(page, BOX)).toHaveAttribute('data-verdict', 'gone');
  await expect(gone(page, RUDDER)).toHaveAttribute('data-verdict', 'unplugged');
  expect(changedActions(before, await fs.readFile(profile(run)))).toEqual([
    'Brake2',
    'Clutch2',
    'Throttle2',
  ]);
  await shot('cleared');

  // One change on the Safety page, with Undo there.
  await page.getByTestId('iracing-gone-safety-link').click();
  await expect(
    page.locator(
      '[data-testid="change-group"][data-reason="iRacing bindings for all cars: cleared 3 bindings of Load Cell Pedals"]'
    )
  ).toHaveCount(1);
});

test('iRacing bindings, switched off: the gone controllers are listed, and cleared in iRacing', async ({
  rig,
}) => {
  const run = await rig.launch('iracing-bindings-cleanup', 'iracing-bindings-cleanup-off');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await go(page, ROUTE);
  await expect(page.getByTestId('iracing-gone-device')).toHaveCount(3);
  await expect(page.getByTestId('iracing-gone-choose')).toHaveCount(0);
  await expect(page.getByTestId('iracing-gone-review')).toHaveCount(0);
  await expect(page.getByTestId('iracing-gone-in-iracing')).toHaveText(
    'To clear them, use iRacing: Options, then Controls.'
  );
  await page.getByTestId('iracing-gone').scrollIntoViewIfNeeded();
  await shot('switched-off');
});

test('iRacing bindings: a wheel with a new Windows id points to the repair, never a cleanup', async ({
  rig,
}) => {
  const run = await rig.launch(
    'racing-iracing-profiles-moved-wheel',
    'iracing-bindings-cleanup-moved',
    SWITCH_ON
  );
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await go(page, ROUTE);
  const wheel = gone(page, WHEEL);
  await expect(wheel).toHaveAttribute('data-verdict', 'moved');
  await expect(wheel.getByTestId('iracing-gone-verdict')).toHaveText('New Windows id');
  await expect(wheel.getByTestId('iracing-gone-why')).toContainText(
    'Point iRacing at the new id instead of clearing'
  );
  await expect(wheel.getByTestId('iracing-gone-choose')).toHaveCount(0);
  await expect(page.getByTestId('iracing-gone-actions')).toHaveCount(0);
  await page.getByTestId('iracing-gone').scrollIntoViewIfNeeded();
  await shot('moved');
  await wheel.getByTestId('iracing-gone-repair-link').click();
  await expect(page.getByTestId('iracing-repair-panel')).toBeVisible();
});
