import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { decodePng, showsMark } from '../../src/features/cheat-sheets/core/pageCheck';
import { expect, test } from './harness';

/**
 * What the sitting of 12 November found on the kneeboard, on the real renderer: a list that
 * said "24 actions" and showed 7, pages that changed their numbers between exports, and
 * page keys nobody had told the owner about.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
/** Rendered pages kept as evidence (the real Render port made them). */
const outputs = path.join(repoRoot, 'artifacts', 'screens', 'kneeboard-outputs');

/** The bar that ends every list page (core/pages.ts END_MARK): a page without it was cut off. */
const END_BAR = '#9a8a70';

const STICK = {
  index: 9,
  name: 'WINWING Orion Joystick Base 2 + JGRIP-F16',
  buttons: 42,
};
const stickState = (pressed: number[] = []) => ({
  index: STICK.index,
  name: STICK.name,
  axes: [0, 0, 0, 0, 0, 0],
  buttons: Array.from({ length: STICK.buttons }, (_, i) => pressed.includes(i + 1)),
  hats: [[0, 0]] as [number, number][],
  timestamp: Date.now(),
});

const kneeboardFolder = (home: string): string =>
  path.join(home, 'Saved Games', 'DCS', 'Kneeboard', 'FA-18C_hornet');

async function openKneeboard(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-cheat-sheets').click();
  await expect(page.getByTestId('cheat-sheets-page')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('sheet-view')).toBeVisible();
  await page.getByTestId('sheet-kneeboard').click();
  await expect(page.getByTestId('kneeboard-dialog')).toBeVisible();
  await expect(page.getByTestId('kneeboard-preview')).toHaveAttribute('data-busy', 'false');
}

async function exportPages(page: Page): Promise<void> {
  await page.getByTestId('kneeboard-export').click();
  await expect(page.getByTestId('kneeboard-export-confirm')).toBeVisible();
  await page.getByTestId('kneeboard-export-go').click();
  await expect(page.getByTestId('kneeboard-done')).toBeVisible();
}

function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('kneeboard: with long device names every key action still gets a place, over as many pages as that takes', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-long-names', 'kneeboard-long-names');
  const { page, shot } = run;
  const folder = kneeboardFolder(run.home);
  await openKneeboard(page);
  await expect(page.getByTestId('kneeboard-status')).toHaveAttribute('data-state', 'none');

  // The first page of the list as it will be written.
  await page.getByTestId('kneeboard-preview-device').click();
  await page.getByRole('option', { name: 'Key actions (first page)' }).click();
  await expect(page.getByTestId('kneeboard-preview')).toHaveAttribute('data-busy', 'false');
  await shot('preview-key-actions');

  // The picture pages, the summary and the large-print lists.
  await page.getByTestId('kneeboard-lists').locator('input').check();
  await exportPages(page);
  await expect(page.getByTestId('kneeboard-status')).toHaveAttribute('data-state', 'current');
  await shot('exported');

  const names = (await fs.readdir(folder)).sort();
  expect(Number(await page.getByTestId('kneeboard-done').getAttribute('data-written'))).toBe(
    names.length
  );
  // The summary goes on under the same number, with a letter: DCS shows it right after.
  const summary = names.filter((name) => name.includes('Key actions'));
  expect(summary.length).toBeGreaterThanOrEqual(2);
  expect(summary.slice(0, 2)).toEqual([
    'RigReady - 01 - Key actions.png',
    'RigReady - 01b - Key actions 2.png',
  ]);
  // Every page is RigReady's, numbered, and the numbers have no gap.
  const numbers = new Set<number>();
  for (const name of names) {
    const match = /^RigReady - (\d\d)[a-z]* - .+\.png$/.exec(name);
    expect(match, name).not.toBeNull();
    numbers.add(Number(match![1]));
  }
  expect([...numbers].sort((a, b) => a - b)).toEqual(
    Array.from({ length: numbers.size }, (_, i) => i + 1)
  );
  // A device's list follows its picture under the same number.
  const stick = names.filter((name) => name.includes('Orion Joystick'));
  expect(stick.length).toBeGreaterThanOrEqual(2);
  const stickNumber = /^RigReady - (\d\d)/.exec(stick[0]!)![1];
  expect(stick[0]).toMatch(new RegExp(`^RigReady - ${stickNumber} - `));
  expect(stick[1]).toMatch(new RegExp(`^RigReady - ${stickNumber}b - .+ list\\.png$`));

  // Every page is a kneeboard-sized picture, and every list page ends with its bar: the
  // real renderer showed the whole list, on every page.
  const lists = names.filter(
    (name) => name.includes('Key actions') || / list( \d+)?\.png$/.test(name)
  );
  expect(lists.length).toBeGreaterThan(summary.length);
  for (const name of names) {
    const bytes = await fs.readFile(path.join(folder, name));
    expect(pngSize(bytes), name).toEqual({ width: 768, height: 1024 });
    if (!lists.includes(name)) continue;
    const pixels = decodePng(bytes);
    expect(pixels.ok, name).toBe(true);
    if (pixels.ok) expect(showsMark(pixels.value, END_BAR), name).toBe(true);
  }

  await fs.mkdir(outputs, { recursive: true });
  const keep: [string, string][] = [
    ...summary.map((name, at): [string, string] => [name, `long-names-key-actions-${at + 1}.png`]),
    [stick[0]!, 'long-names-stick.png'],
    [stick[1]!, 'long-names-stick-list.png'],
  ];
  for (const [from, to] of keep) await fs.copyFile(path.join(folder, from), path.join(outputs, to));
});

test('kneeboard: every device keeps its page number when the bindings change which device comes first', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'kneeboard-page-numbers');
  const { page, shot } = run;
  const folder = kneeboardFolder(run.home);
  await openKneeboard(page);
  await exportPages(page);
  const first = (await fs.readdir(folder)).sort();
  expect(first.slice(0, 4)).toEqual([
    'RigReady - 01 - Key actions.png',
    'RigReady - 02 - Stick.png',
    'RigReady - 03 - Throttle.png',
    'RigReady - 04 - Pedals.png',
  ]);
  await shot('first-export');
  await page.getByTestId('kneeboard-close').click();

  // The pedals lose their own bindings: the sheet now lists them after every device that has
  // some. At the sitting a new export would have moved them from page 4 to page 11.
  const joystick = path.join(
    run.home,
    'Saved Games',
    'DCS',
    'Config',
    'Input',
    'FA-18C_hornet',
    'joystick'
  );
  const pedals = (await fs.readdir(joystick)).find((name) => name.startsWith('T-Pendular-Rudder'))!;
  await fs.rm(path.join(joystick, pedals));

  await page.getByTestId('sheet-kneeboard').click();
  await expect(page.getByTestId('kneeboard-status')).toHaveAttribute('data-state', 'stale');
  await shot('bindings-changed');
  await exportPages(page);
  await expect(page.getByTestId('kneeboard-status')).toHaveAttribute('data-state', 'current');
  // Nothing was renamed and nothing removed: the same files, written again.
  await expect(page.getByTestId('kneeboard-done')).toHaveAttribute(
    'data-written',
    String(first.length)
  );
  await expect(page.getByTestId('kneeboard-done')).not.toContainText('removed');
  expect((await fs.readdir(folder)).sort()).toEqual(first);
  await shot('same-numbers');
});

test('kneeboard: the dialog says which keys turn the pages, and offers the page to bind them on', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'kneeboard-keys');
  const { page, shot } = run;
  await openKneeboard(page);
  const key = (name: string) => page.locator(`[data-testid="kneeboard-key"][data-key="${name}"]`);

  // DCS's own defaults: all three on the keyboard, none on a stick or throttle.
  await expect(page.getByTestId('kneeboard-keys')).toHaveAttribute('data-pages', 'keyboard');
  await expect(key('show')).toContainText('Show or hide the kneeboard');
  await expect(key('show')).toContainText('RShift + K on the keyboard');
  await expect(key('next')).toContainText('Next page');
  await expect(key('next')).toContainText('] on the keyboard');
  await expect(key('previous')).toContainText('Previous page');
  await expect(key('previous')).toContainText('[ on the keyboard');
  await expect(key('next')).toHaveAttribute('data-on-controller', 'false');
  await expect(page.getByTestId('kneeboard-keys-note')).toContainText(
    'The pages turn only from the keyboard. To turn them from your stick or throttle, bind "Kneeboard Next Page" and "Kneeboard Previous Page" to a button each.'
  );
  await page.getByTestId('kneeboard-keys').scrollIntoViewIfNeeded();
  await shot('pages-turn-only-from-the-keyboard');

  // The offer: the bindings page of this aircraft, with the kneeboard's actions found.
  await page.getByTestId('kneeboard-keys-bind').click();
  await expect(page.getByTestId('kneeboard-dialog')).toHaveCount(0);
  await expect(page.getByTestId('act-search').locator('input')).toHaveValue('kneeboard');
  await expect(page.getByTestId('bindings-aircraft')).toContainText('F/A-18C');
  const action = (name: string) => page.locator(`[data-testid="act-row"][data-action="${name}"]`);
  await expect(action('Kneeboard Next Page')).toBeVisible();
  await expect(action('Kneeboard Previous Page')).toBeVisible();
  await shot('bindings-page-on-the-kneeboard-actions');

  // Bound there, each to a button of the stick, by pressing it.
  for (const [name, button] of [
    ['Kneeboard Next Page', 33],
    ['Kneeboard Previous Page', 35],
  ] as const) {
    await action(name).getByTestId('act-bind').click();
    await expect(page.getByTestId('bind-dialog')).toBeVisible();
    await page.getByTestId('bind-listen').click();
    await expect(page.getByTestId('bind-listening')).toBeVisible();
    await run.sendInput([stickState()]);
    await run.sendInput([stickState([button])]);
    await expect(page.getByTestId('bind-input')).toContainText(`Button ${button}`);
    await page.getByTestId('bind-save').click();
    await expect(page.getByTestId('bind-dialog')).toHaveCount(0);
    await run.sendInput([stickState()]);
  }
  await page.getByTestId('bind-review').click();
  await page.getByTestId('plan-dialog').getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toBeVisible();

  // Back on the kneeboard dialog there is nothing left to say.
  await page.getByTestId('nav-cheat-sheets').click();
  await expect(page.getByTestId('sheet-view')).toBeVisible();
  await page.getByTestId('sheet-kneeboard').click();
  await expect(page.getByTestId('kneeboard-keys')).toHaveAttribute('data-pages', 'ok');
  await expect(key('next')).toHaveAttribute('data-on-controller', 'true');
  await expect(key('next')).toContainText('Button 33 on Stick');
  await expect(key('previous')).toContainText('Button 35 on Stick');
  await expect(page.getByTestId('kneeboard-keys-note')).toHaveCount(0);
  await page.getByTestId('kneeboard-keys').scrollIntoViewIfNeeded();
  await shot('page-keys-on-the-stick');
});
