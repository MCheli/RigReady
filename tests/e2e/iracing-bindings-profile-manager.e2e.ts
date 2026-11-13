import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { checkRow, expect, openOption, test, type RunningApp } from './harness';

/**
 * iRacing's control profiles on the bindings page: every profile and which cars use which,
 * copying bindings from one into another, and a setup that switches the profile iRacing
 * loads for all cars at Make ready and puts the old one back at Stand down. On the profiles
 * of the owner's rig at 12:27 on 13 Nov 2026 ("Baseline" for all cars, "Test Profile CTSV"
 * for the Cadillac CTS-V). Every test works on copies of the files in a temp folder.
 */

const ROUTE = '/configure/iracing-bindings';
const BASELINE = 'Baseline';
const TEST = 'Test Profile CTSV';
const WHEEL = 'FANATEC Podium Wheel Base DD2';
const SIMULATOR = {
  op: 'startProcess',
  name: 'iRacingSim64DX11.exe',
  path: 'C:\\iRacing\\iRacingSim64DX11.exe',
};

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

const profile = (page: Page, name: string): Locator =>
  page.locator(`[data-testid="iracing-profile"][data-profile="${name}"]`);
const copyRow = (page: Page, action: string): Locator =>
  page.locator(`[data-testid="iracing-copy-row"][data-action="${action}"]`);
const row = (page: Page, action: string): Locator =>
  page.locator(`[data-testid="iracing-bindings-row"][data-action="${action}"]`);

const iracing = (run: RunningApp, ...parts: string[]): string =>
  path.join(run.home, 'Documents', 'iRacing', ...parts);
const profileFile = (run: RunningApp, name: string): string =>
  iracing(run, 'profiles', 'controls', name, 'controls.cfg');

/** The actions whose record holds a byte that differs, and that no byte outside 8 to 67 of one does. */
function changedActions(before: Buffer, after: Buffer, actions: string[]): string[] {
  expect(after.length).toBe(before.length);
  const spans = actions.map((action) => {
    const name = Buffer.from(`${action}\0`, 'latin1');
    const at = before.indexOf(name) + name.length;
    return { action, from: at + 8, to: at + 68 };
  });
  const hit = new Set<string>();
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const span = spans.find((s) => i >= s.from && i < s.to);
    expect(span, `byte ${i} changed outside the chosen records`).toBeDefined();
    hit.add(span!.action);
  }
  return [...hit];
}

test('iRacing bindings: the control profiles, and copying bindings from one into another', async ({
  rig,
}) => {
  const run = await rig.launch('iracing-bindings-profile-car', 'iracing-profiles-copy');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await go(page, ROUTE);

  // Every profile, the one for all cars, and the car that has its own.
  await expect(page.getByTestId('iracing-profile')).toHaveCount(2);
  await expect(profile(page, BASELINE).getByTestId('iracing-profile-all-cars')).toHaveText(
    'All cars'
  );
  await expect(profile(page, BASELINE).getByTestId('iracing-profile-used')).toHaveText(
    'Used for all cars.'
  );
  await expect(profile(page, TEST).getByTestId('iracing-profile-all-cars')).toHaveCount(0);
  await expect(profile(page, TEST).getByTestId('iracing-profile-used')).toHaveText(
    'Car with this profile: cadillacctsvr.'
  );
  await page.getByTestId('iracing-profiles').scrollIntoViewIfNeeded();
  await shot('profiles');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);

  // Copy from the car's profile into Baseline: the two bindings Baseline does not have.
  const baseline = await fs.readFile(profileFile(run, BASELINE));
  const test = await fs.readFile(profileFile(run, TEST));
  await page.getByTestId('iracing-profiles-copy').click();
  const dialog = page.getByTestId('iracing-copy');
  await expect(dialog).toBeVisible();
  // From the profile for all cars by default, where copying would clear both.
  await expect(page.getByTestId('iracing-copy-row')).toHaveCount(2);
  await expect(copyRow(page, 'LookUp')).toHaveAttribute('data-kind', 'clear');
  await expect(copyRow(page, 'LookUp').getByRole('checkbox')).not.toBeChecked();
  await page.getByTestId('iracing-copy-from').click();
  await openOption(page, TEST).click();
  await expect(page.getByTestId('iracing-copy-summary')).toHaveText(
    '2 actions differ; 367 actions are the same in both.'
  );
  await expect(copyRow(page, 'LookUp')).toHaveAttribute('data-kind', 'copy');
  await expect(copyRow(page, 'LookUp')).toContainText(
    `“${TEST}”: Button 10 on ${WHEEL} · “${BASELINE}” now: Not bound`
  );
  await expect(copyRow(page, 'ToggleUIVisibleDrive')).toContainText('Shift+J on the keyboard');
  await expect(copyRow(page, 'LookUp').getByRole('checkbox')).toBeChecked();
  await expect(dialog).toContainText(
    'Buttons and keys are copied. An axis and its calibration stay as they are'
  );
  await shot('copy-choose');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);

  // Only Look up this time.
  await copyRow(page, 'ToggleUIVisibleDrive').getByRole('checkbox').uncheck();
  await expect(page.getByTestId('iracing-copy-review')).toHaveText('Review copying 1 binding');
  await page.getByTestId('iracing-copy-review').click();
  const confirm = page.getByTestId('iracing-copy-save-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(`Copy 1 binding into “${BASELINE}”?`);
  await expect(confirm.getByTestId('change-preview-file')).toContainText(
    'profiles\\controls\\Baseline\\controls.cfg'
  );
  await expect(page.getByTestId('iracing-copy-what')).toContainText(
    'It changes those actions and nothing else in the file.'
  );
  await expect(page.getByTestId('iracing-copy-used-by')).toHaveText(
    `iRacing uses “${BASELINE}” for all cars.`
  );
  // Looking is not writing.
  expect((await fs.readFile(profileFile(run, BASELINE))).equals(baseline)).toBe(true);
  await shot('copy-review');
  await page.getByTestId('iracing-copy-save-go').click();
  await expect(page.getByTestId('iracing-profiles-copied')).toHaveText(
    `Copied 1 binding from “${TEST}” into “${BASELINE}”. Undo is on the Safety page.`
  );
  await expect(confirm).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  const after = await fs.readFile(profileFile(run, BASELINE));
  expect(changedActions(baseline, after, ['LookUp'])).toEqual(['LookUp']);
  // The profile copied from is not touched.
  expect((await fs.readFile(profileFile(run, TEST))).equals(test)).toBe(true);
  // Baseline is the set for all cars, so the list shows the copied binding.
  await expect(row(page, 'LookUp')).toContainText('Button 10');
  await page.getByTestId('iracing-profiles').scrollIntoViewIfNeeded();
  await shot('copied');

  // One entry on the Safety page.
  await page.getByTestId('iracing-bindings-safety-link').click();
  await expect(
    page.locator(
      `[data-testid="change-group"][data-reason="iRacing control profile “${BASELINE}”: 1 binding copied from “${TEST}”"]`
    )
  ).toHaveCount(1);

  // While iRacing runs, nothing is copied, and the dialog says why first.
  await run.mutate([SIMULATOR]);
  await go(page, ROUTE);
  await page.getByTestId('iracing-profiles-copy').click();
  await expect(page.getByTestId('iracing-copy-blocked')).toContainText('Close iRacing first.');
  await page.getByTestId('iracing-copy-from').click();
  await openOption(page, TEST).click();
  await expect(copyRow(page, 'ToggleUIVisibleDrive')).toBeVisible();
  await page.getByTestId('iracing-copy-review').click();
  await expect(page.getByTestId('iracing-copy-save-blocked')).toContainText('Close iRacing first.');
  await expect(page.getByTestId('iracing-copy-save-go')).toBeDisabled();
  await shot('iracing-running');
  await page.getByTestId('iracing-copy-save-cancel').click();
  expect((await fs.readFile(profileFile(run, BASELINE))).equals(after)).toBe(true);
  await page.getByTestId('iracing-copy-cancel').click();

  // app.ini names a profile for all cars that is not there: no list of bindings, but the
  // profiles that are there, beside the name that is not.
  const ini = iracing(run, 'app.ini');
  await fs.writeFile(
    ini,
    (await fs.readFile(ini, 'latin1')).replace('Global=Baseline', 'Global=Gone'),
    'latin1'
  );
  await go(page, '/configure/games/iracing');
  await expect(page.getByTestId('iracing-bindings-page')).toHaveCount(0);
  await go(page, ROUTE);
  await expect(page.getByTestId('iracing-bindings-source-problem')).toBeVisible();
  await expect(page.getByTestId('iracing-profile')).toHaveCount(2);
  await expect(page.getByTestId('iracing-profile-missing')).toContainText('Not on this PC: “Gone”');
  await shot('profile-not-there');
});

test('iRacing bindings: a row just saved stays in sight under “Not bound”', async ({ rig }) => {
  const run = await rig.launch('iracing-bindings-profiles', 'iracing-profiles-kept-row');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await go(page, ROUTE);
  await page.getByTestId('iracing-bindings-only-unbound').click();
  const driving = row(page, 'ToggleUIVisibleDrive');
  await expect(driving).toHaveAttribute('data-bound', 'no');

  await driving.getByTestId('iracing-bindings-change').click();
  await expect(page.getByTestId('iracing-edit')).toBeVisible();
  await page.getByTestId('iracing-edit-listen').click();
  await expect(page.getByTestId('iracing-edit-listening')).toBeVisible();
  await page.keyboard.press('Shift+J');
  await expect(page.getByTestId('iracing-save-confirm')).toContainText(
    'Bind Hide or show the driving UI to Shift+J on the keyboard?'
  );
  await page.getByTestId('iracing-save-go').click();
  await expect(page.getByTestId('iracing-bindings-saved')).toContainText(
    'Hide or show the driving UI is now bound to Shift+J on the keyboard.'
  );
  // Bound now, and still listed under "Not bound", with what it was bound to.
  await expect(driving).toHaveAttribute('data-bound', 'yes');
  await expect(driving).toContainText('Shift+J');
  await expect(driving.getByTestId('iracing-bindings-row-saved')).toHaveText('Saved');
  await driving.scrollIntoViewIfNeeded();
  await shot('kept-under-not-bound');
  // Once the filter changes, the list is the filter's again.
  await page.getByTestId('iracing-bindings-only-unbound').click();
  await page.getByTestId('iracing-bindings-only-unbound').click();
  await expect(driving).toHaveCount(0);
  await expect(row(page, 'HeadlightFlash')).toBeVisible();
});

test('setups: a setup switches iRacing’s control profile at Make ready and back at Stand down', async ({
  rig,
}) => {
  const run = await rig.launch('iracing-bindings-profile-switch', 'iracing-profiles-switch');
  const { page, shot } = run;
  const ini = iracing(run, 'app.ini');
  const original = await fs.readFile(ini);
  const item = checkRow(page, `iRacing control profile: ${TEST}`);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(item).toHaveAttribute('data-status', 'fail');
  await expect(item).toContainText('iRacing uses “Baseline” for all cars');
  await expect(item.getByTestId('check-fix')).toContainText(
    `Make “${TEST}” iRacing’s control profile for all cars in app.ini`
  );
  await shot('not-ready');

  // While the simulator runs the step fails with the reason, and app.ini is not written.
  await run.mutate([SIMULATOR]);
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-activity')).toContainText(
    'iRacing is running. Close iRacing first: it writes app.ini when it closes and would put its own profile back.'
  );
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  expect((await fs.readFile(ini)).equals(original)).toBe(true);
  await shot('iracing-running');
  await run.mutate([{ op: 'stopProcess', name: 'iRacingSim64DX11.exe' }]);

  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-activity')).toContainText(
    `Made “${TEST}” iRacing’s control profile for all cars in app.ini (it was “Baseline”). Stand down puts “Baseline” back.`
  );
  // One line changed.
  expect(await fs.readFile(ini, 'latin1')).toBe(
    original.toString('latin1').replace('\r\nGlobal=Baseline\r\n', `\r\nGlobal=${TEST}\r\n`)
  );
  await shot('made-ready');

  // The bindings page now reads that profile for all cars.
  await page.getByTestId('mode-configure').click();
  await go(page, ROUTE);
  await expect(profile(page, TEST).getByTestId('iracing-profile-all-cars')).toHaveText('All cars');
  await expect(page.getByTestId('iracing-bindings-source')).toContainText(
    `It uses the profile “${TEST}” for all cars.`
  );
  await page.getByTestId('iracing-profiles').scrollIntoViewIfNeeded();
  await shot('page-after-switch');

  await page.getByTestId('mode-fly').click();
  await page.getByTestId('stand-down').click();
  await expect(page.getByTestId('fly-activity')).toContainText(
    'Put back “Baseline” as iRacing’s control profile for all cars in app.ini.'
  );
  expect((await fs.readFile(ini)).equals(original)).toBe(true);
  await expect(item).toHaveAttribute('data-status', 'fail');
  await shot('stood-down');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);

  // In the setup editor the profile is chosen by name from the ones on this PC.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-profiles').click();
  await page
    .locator('[data-testid="profile-row"][data-name="iRacing Cadillac CTS-V"]')
    .getByTestId('profile-edit')
    .click();
  await expect(page.getByTestId('profile-edit-page')).toBeVisible();
  const edit = page.locator(
    `[data-testid="edit-check"][data-title="iRacing control profile: ${TEST}"]`
  );
  await edit.getByTestId('edit-check-open').click();
  await expect(edit).toContainText('Control profile');
  await expect(edit).toContainText(TEST);
  await edit.scrollIntoViewIfNeeded();
  await shot('setup-editor');
});
