import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import * as yaml from 'js-yaml';
import { expect, openOption, test } from './harness';

/**
 * CFG-PROFILE-019 to 021: in the setup editor a saved monitor layout and a virtual controller
 * are chosen by name from a list (never typed as an id), the fix that applies a layout goes
 * with the check, and a setup Steam starts shows as "Through Steam".
 */

const editRow = (page: Page, title: string) =>
  page.locator(`[data-testid="edit-check"][data-title="${title}"]`);
const step = (page: Page, title: string) =>
  page.locator(`[data-testid="edit-action"][data-phase="preLaunch"][data-title="${title}"]`);
const options = (page: Page) => page.locator('.v-overlay--active').getByRole('option');

async function openEditor(page: Page, name: string): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  await page
    .locator(`[data-testid="profile-row"][data-name="${name}"]`)
    .getByTestId('profile-edit')
    .click();
  await expect(page.getByTestId('profile-edit-page')).toBeVisible();
}

type Params = Record<string, unknown>;
interface SavedSetup {
  launch?: { exe: string; args: string[] };
  steamAppId?: string;
  checks: {
    type: string;
    title: string;
    params: Params;
    remediation?: { type: string; params: Params };
  }[];
  actions?: { preLaunch?: { title: string; type: string; params: Params }[] };
}
const savedSetup = async (dataRoot: string, id: string): Promise<SavedSetup> =>
  yaml.load(await fs.readFile(path.join(dataRoot, 'profiles', `${id}.yaml`), 'utf8')) as SavedSetup;

test('setup editor: a monitor layout is chosen by name, and the fix that applies it goes with the check', async ({
  rig,
}) => {
  // A rig with three saved layouts (Desk, Flying, Racing) and no setup yet: make one first.
  const { page, shot, dataRoot } = await rig.launch('displays-layouts', 'editor-lists-layout');
  await page.getByTestId('fly-create').click();
  await page.getByTestId('capture-game-dcs').click();
  await page.getByTestId('capture-name').locator('input').fill('Layout by name');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('profile-switcher')).toContainText('Layout by name');
  await openEditor(page, 'Layout by name');

  await page.getByTestId('edit-add-check').click();
  await page.getByTestId('add-display.layout').click();
  const fresh = editRow(page, 'New check');
  // The fix that applies a saved layout comes with the check and waits for the same choice.
  await expect(fresh.getByTestId('edit-fix-type')).toContainText('Apply the monitor layout');
  await expect(fresh.getByTestId('edit-fix-params-follows')).toHaveText(
    'Uses the layout chosen above.'
  );
  // Nothing asks for an id, a name to type, or the monitors as data.
  await expect(fresh.getByTestId('edit-params-layoutName')).toHaveCount(0);
  await expect(fresh.getByTestId('edit-params-displays')).toHaveCount(0);
  await expect(fresh.getByTestId('edit-fix-params-layoutId')).toHaveCount(0);
  await expect(fresh.getByTestId('edit-fix-params-displays')).toHaveCount(0);

  await fresh.getByTestId('edit-params-layoutId').click();
  await expect(options(page)).toHaveCount(3);
  await expect(options(page).filter({ hasText: 'Flying' })).toContainText(/\d+ monitors?, \d+ on/);
  await shot('layouts-by-name');
  await openOption(page, 'Flying').click();

  // The check takes the name of what was chosen, and says what the layout is.
  const flying = editRow(page, 'Monitor layout: Flying');
  await expect(flying.getByTestId('edit-params-layoutId')).toContainText('Flying');
  await expect(flying.getByTestId('edit-params-layoutId-note')).toHaveText(
    /^\d+ monitors?, \d+ on$/
  );
  await flying.scrollIntoViewIfNeeded();
  await shot('layout-chosen');

  // A second choice: the name and the fix go with it.
  await flying.getByTestId('edit-params-layoutId').click();
  await openOption(page, 'Racing').click();
  const racing = editRow(page, 'Monitor layout: Racing');
  await expect(racing.getByTestId('edit-fix-params-follows')).toHaveText(
    'Uses the layout chosen above.'
  );
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();

  const saved = await savedSetup(dataRoot, 'layout-by-name');
  const item = saved.checks.find((c) => c.title === 'Monitor layout: Racing');
  expect(item?.type).toBe('display.layout');
  expect(item?.params['layoutName']).toBe('Racing');
  expect(typeof item?.params['layoutId']).toBe('string');
  expect((item?.params['displays'] as unknown[]).length).toBeGreaterThan(0);
  // The fix names the same layout, with the same monitors, without having been asked.
  expect(item?.remediation?.type).toBe('display.applyLayout');
  expect(item?.remediation?.params).toMatchObject({
    layoutId: item?.params['layoutId'],
    layoutName: 'Racing',
    displays: item?.params['displays'],
  });
  expect(saved.checks.some((c) => c.title === 'Monitor layout: Flying')).toBe(false);
});

test('setup editor: a virtual controller is chosen by name, two of one name are told apart, and a step without a choice is not saved', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch(
    'virtual-controller-ready-two-of-one-name',
    'editor-lists-virtual-controller'
  );
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // Two virtual controllers of one name. The page gives a new one a name of its own, so
  // these two come from a file written before names had to differ.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-virtual-controller').click();
  await expect(
    page.getByTestId('vc-profile').filter({ hasText: 'My Ace Combat stick' })
  ).toHaveCount(2);

  await openEditor(page, 'ACE COMBAT 8');
  const first = step(page, 'Virtual gamepad for the stick');
  const list = first.getByTestId('edit-action-params-profile');
  // The setup stores an id; the editor shows the name, and never a field for the id.
  await expect(list).toContainText('My Ace Combat stick');
  await expect(first.getByTestId('edit-action-params-profileName')).toHaveCount(0);
  // With the list closed, the line under it says which of the two this one is.
  const note = first.getByTestId('edit-action-params-profile-note');
  await expect(note).toContainText('Xbox 360 controller · id my-ace-combat-stick · 8 inputs from');

  await list.click();
  await expect(options(page)).toHaveCount(2);
  const lines = await options(page).allInnerTexts();
  expect(lines.every((line) => line.includes('My Ace Combat stick'))).toBe(true);
  // Same name, and still two different lines: what each is made of, and its id.
  expect(new Set(lines).size).toBe(2);
  expect(lines.every((line) => /Xbox 360 controller · id \S+ · /.test(line))).toBe(true);
  await shot('two-of-one-name');
  const other = options(page).filter({ hasText: 'nothing mapped yet' });
  await expect(other).toHaveCount(1);
  await other.click();
  await expect(note).toContainText('nothing mapped yet');
  await expect(note).not.toContainText('id my-ace-combat-stick ·');

  // A new step: without a choice it is not saved, and the row says what is missing.
  await page.getByTestId('edit-add-preLaunch').click();
  const added = page.locator('[data-testid="edit-action"][data-phase="preLaunch"]').last();
  await added.getByTestId('edit-action-type').click();
  await openOption(page, 'Start a virtual controller').click();
  const start = step(page, 'Start a virtual controller');
  await expect(start.getByTestId('edit-action-params-profile')).toBeVisible();
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('edit-error')).toBeVisible();
  await expect(start).toContainText('Virtual controller: choose one from the list.');
  await start.scrollIntoViewIfNeeded();
  await shot('step-needs-a-choice');
  await start.getByTestId('edit-action-params-profile').click();
  await options(page).filter({ hasText: '8 inputs from' }).click();
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();

  const steps = (await savedSetup(dataRoot, 'virtual-controller-ace-combat')).actions?.preLaunch;
  expect(steps).toHaveLength(2);
  // The first step now names the second controller, and kept what it had besides.
  expect(steps?.[0]?.params['profileName']).toBe('My Ace Combat stick');
  expect(steps?.[0]?.params['profile']).not.toBe('my-ace-combat-stick');
  expect(steps?.[0]?.params['hideControllers']).toBe(true);
  expect(steps?.[1]).toMatchObject({
    title: 'Start a virtual controller',
    type: 'virtual-controller.start',
    params: { profile: 'my-ace-combat-stick', profileName: 'My Ace Combat stick' },
  });
});

test('setup editor: with no saved layout the list says where to make one', async ({ rig }) => {
  const { page, shot } = await rig.launch('virtual-controller-ready', 'editor-lists-empty');
  await openEditor(page, 'ACE COMBAT 8');
  await page.getByTestId('edit-add-check').click();
  await page.getByTestId('add-display.layout').click();
  const fresh = editRow(page, 'New check');
  await expect(fresh.getByTestId('edit-params-layoutId-note')).toHaveText(
    'You have no saved layout yet. Save one on Configure > Monitors, then choose it here.'
  );
  await fresh.scrollIntoViewIfNeeded();
  await shot('no-saved-layout');
  // Saved like this it would check nothing: the editor refuses, and names the list.
  await page.getByTestId('edit-save').click();
  await expect(fresh.getByTestId('edit-check-problems')).toContainText(
    'Layout: choose one from the list.'
  );
});

test('setup editor: a setup Steam starts shows as "Through Steam" with the game\'s number, not as a program and arguments', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch('flying-fresh', 'editor-through-steam');
  await page.getByTestId('fly-create').click();
  await expect(page.getByTestId('capture-game-dcs')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  // The new setup hands the game to Steam: steam.exe with "-applaunch" and the number.
  const before = await savedSetup(dataRoot, 'dcs-f-a-18c');
  expect(before.launch?.exe.toLowerCase()).toContain('steam.exe');
  expect(before.launch?.args).toEqual(['-applaunch', '223750']);

  await openEditor(page, 'DCS F/A-18C');
  await expect(page.getByTestId('edit-launch-steam')).toHaveClass(/v-btn--active/);
  await expect(page.getByTestId('edit-steam-app').locator('input')).toHaveValue('223750');
  await expect(page.getByTestId('edit-launch-exe')).toHaveCount(0);
  await expect(page.getByTestId('edit-launch-args')).toHaveCount(0);
  await page.getByTestId('edit-steam-app').scrollIntoViewIfNeeded();
  await shot('through-steam');

  // Another number is saved the way the setup already launches: through its own Steam.
  await page.getByTestId('edit-steam-app').locator('input').fill('223751');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();
  const after = await savedSetup(dataRoot, 'dcs-f-a-18c');
  expect(after.launch).toEqual({ ...before.launch, args: ['-applaunch', '223751'] });
  expect(after.steamAppId).toBeUndefined();
});
