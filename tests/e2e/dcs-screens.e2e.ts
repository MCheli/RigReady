import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './harness';
import { expectSaveBarPinned } from './saveBar';

/**
 * The DCS Screens tab after the sitting of 12 November: the screens carry the names the
 * user gave them, SimAppPro's plan is matched to them and shown before anything is written,
 * a crop goes with its display to a screen of the same size, Identify works from this tab,
 * and the map shows where DCS will draw the kneeboard.
 */

const SMALL_SCREENS = [
  ['USB_Monitor (1 of 3)', 'MFD left'],
  ['USB_Monitor (2 of 3)', 'MFD centre'],
  ['USB_Monitor (3 of 3)', 'MFD right'],
] as const;

/** The user names the three identical small screens on the Monitors page, as at the sitting. */
async function nameScreens(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-displays').click();
  await expect(page.getByTestId('displays-page')).toBeVisible();
  const row = (label: string) => page.locator(`[data-testid="display-row"][data-label="${label}"]`);
  for (const [windows, name] of SMALL_SCREENS) {
    await row(windows).getByTestId('display-name').click();
    await page.getByTestId('display-name-input').locator('input').fill(name);
    await page.getByTestId('display-name-save').click();
    await expect(row(name)).toBeVisible();
  }
}

async function openScreens(page: Page): Promise<void> {
  await page.getByTestId('nav-games').click();
  await page.getByTestId('game-card-dcs').click();
  await page.getByTestId('dcs-tab-screens').click();
  // SimAppPro's plan is taken over when the tab opens on a PC that has one.
  await expect(page.getByTestId('screen-map-box')).toHaveCount(3);
}

/** Chooses in one of the tab's monitor lists, and waits until the list has closed again. */
async function choose(page: Page, testId: string, option: string): Promise<void> {
  const open = page.locator('.v-overlay--active [role="listbox"]');
  await page.getByTestId(testId).click();
  await open.getByRole('option', { name: option, exact: true }).click();
  await expect(open).toHaveCount(0);
}

const pair = (page: Page, planId: string) =>
  page.locator(`[data-testid="screens-pair"][data-plan="${planId}"]`);
const mapDisplay = (page: Page, name: string) =>
  page.locator(`[data-testid="screen-map-display"][data-name="${name}"]`);
const viewportAt = (name: string, x: number, y?: number): RegExp =>
  new RegExp(`${name} =\\s*\\{\\s*x = ${x};${y === undefined ? '' : `\\s*y = ${y};`}`);
/** One side of the crop of a display, and all four as the tab shows them: left, top, right, bottom. */
const crop = (page: Page, name: string, side: string) =>
  page.locator(`[data-testid="screens-crop-${name}-${side}"] input`);
const crops = (page: Page, name: string): Promise<string[]> =>
  Promise.all(
    ['left', 'top', 'right', 'bottom'].map((side) => crop(page, name, side).inputValue())
  );

test("dcs-screens: the screens carry the user's names, and SimAppPro's plan follows the names, is shown, corrected and only then written", async ({
  rig,
}) => {
  const run = await rig.launch('dcs-setup-flying', 'dcs-screens-named');
  const { page, shot, home } = run;
  const written = path.join(home, 'Saved Games', 'DCS', 'Config', 'MonitorSetup', 'RigReady.lua');
  await nameScreens(page);
  await openScreens(page);

  // The names from the Monitors page, wherever a monitor is shown: the map, the list of
  // main screens, the pairing and every display's own list. Windows' name is nowhere.
  for (const [, name] of SMALL_SCREENS) await expect(mapDisplay(page, name)).toBeVisible();
  await expect(page.getByTestId('screens-main-chip')).toHaveText([
    'LC49G95T',
    'MFD left',
    'MFD centre',
    'MFD right',
  ]);
  await expect(page.getByTestId('dcs-screens')).not.toContainText('USB_Monitor');

  // SimAppPro saved its plan when the screens were in another order: by position its
  // left display is on the middle screen. The names say which is which.
  await expect(page.getByTestId('screens-pairing')).toHaveAttribute('data-certain', 'false');
  await expect(page.getByTestId('screens-pairing')).toContainText('Which screen is which?');
  await expect(pair(page, '002')).toContainText('Left DDI');
  await expect(pair(page, '002')).toHaveAttribute('data-how', 'name');
  await expect(pair(page, '002')).toContainText(
    "Matched by the name you gave the screen. SimAppPro's plan has it where MFD centre is now, so the plan is from before the screens were put in this order."
  );
  await expect(page.getByTestId('screens-pair-monitor-002')).toContainText('MFD left');
  await expect(pair(page, '003')).toContainText('AMPCD');
  await expect(page.getByTestId('screens-pair-monitor-003')).toContainText('MFD centre');
  await expect(pair(page, '004')).toContainText('Right DDI');
  await expect(page.getByTestId('screens-pair-monitor-004')).toContainText('MFD right');
  await expect(pair(page, '005')).toHaveAttribute('data-certain', 'true');
  await expect(page.getByTestId('screens-display-row').first()).toBeVisible();
  await expect(page.getByTestId('screens-monitor-LEFT_MFCD')).toContainText('MFD left');
  await shot('paired-by-name');

  // The file that would be written puts each display on the screen of its name.
  await page.getByTestId('screens-show-lua').click();
  const lua = page.getByTestId('screens-lua');
  await expect(lua).toContainText(viewportAt('LEFT_MFCD', 5128));
  await expect(lua).toContainText(viewportAt('CENTER_MFCD', 5896));
  await expect(lua).toContainText(viewportAt('RIGHT_MFCD', 6664));
  // Not certain, so nothing can be written before the user has looked.
  await expect(page.getByTestId('save-bar-why')).toHaveText('Check which screen is which first.');
  await expect(page.getByTestId('screens-apply')).toBeDisabled();

  // Before looking at the pairing the user works on the setup: the top of the left
  // display's picture is set by hand, and the centre display is taken off its screen.
  await expect(crop(page, 'LEFT_MFCD', 'top')).toHaveValue('256');
  await crop(page, 'LEFT_MFCD', 'top').fill('240');
  await choose(page, 'screens-monitor-CENTER_MFCD', 'Not shown');
  await expect(lua).toContainText(viewportAt('LEFT_MFCD', 5128, 240));
  await expect(lua).not.toContainText('CENTER_MFCD =');

  // The user puts one right by hand: the two screens change places, and it is their word now.
  await choose(page, 'screens-pair-monitor-002', 'MFD right');
  await expect(pair(page, '002')).toHaveAttribute('data-how', 'chosen');
  await expect(pair(page, '002')).toContainText('You chose this screen.');
  await expect(page.getByTestId('screens-pair-monitor-004')).toContainText('MFD left');
  await expect(pair(page, '004')).toHaveAttribute('data-how', 'chosen');
  await expect(lua).toContainText(viewportAt('LEFT_MFCD', 6664, 240));
  await expect(lua).toContainText(viewportAt('RIGHT_MFCD', 5128, 256));
  // Only the pairing changed. The crop went with its display to the screen of the same
  // size, and the display the user took off is still off.
  expect(await crops(page, 'LEFT_MFCD')).toEqual(['8', '240', '8', '6']);
  await expect(page.getByTestId('screens-monitor-LEFT_MFCD')).toContainText('MFD right');
  await expect(page.getByTestId('screens-monitor-CENTER_MFCD')).toContainText('Not shown');
  await expect(lua).not.toContainText('CENTER_MFCD =');
  await expect(page.getByTestId('screens-pairing-note')).toHaveCount(0);
  await shot('corrected-by-hand');
  // And back, as the names had it: the user's crop comes back with the display.
  await choose(page, 'screens-pair-monitor-002', 'MFD left');
  await expect(page.getByTestId('screens-pair-monitor-004')).toContainText('MFD right');
  await expect(lua).toContainText(viewportAt('LEFT_MFCD', 5128, 240));
  expect(await crops(page, 'LEFT_MFCD')).toEqual(['8', '240', '8', '6']);
  await choose(page, 'screens-monitor-CENTER_MFCD', 'MFD centre');
  // None of this wrote anything.
  await expect(fs.access(written)).rejects.toThrow();

  // The centre screen is still RigReady's own match: the user says the screens are right.
  await expect(pair(page, '003')).toHaveAttribute('data-certain', 'false');
  await expect(page.getByTestId('screens-apply')).toBeDisabled();
  await page.getByTestId('screens-pairing-confirm').click();
  await expect(page.getByTestId('screens-pairing-checked')).toHaveText('You checked these.');
  await expect(page.getByTestId('save-bar-why')).toHaveCount(0);
  await page.getByTestId('screens-apply').click();
  await expect(page.getByTestId('screens-done')).toContainText('Created RigReady.lua');
  await expect(page.getByTestId('screens-status')).toContainText(
    "DCS uses RigReady's screen setup"
  );
  const file = await fs.readFile(written, 'utf8');
  // What the user set before correcting the pairing is what was written.
  expect(file).toMatch(viewportAt('LEFT_MFCD', 5128, 240));
  expect(file).toMatch(viewportAt('CENTER_MFCD', 5896));
  expect(file).toMatch(viewportAt('RIGHT_MFCD', 6664));
  // The aircraft is named once above its displays, not before every one.
  expect(file.match(/-- F\/A-18C Hornet/g)).toHaveLength(1);
  await shot('written');
});

test('dcs-screens: the question about the pairing is asked again when another monitor layout is chosen', async ({
  rig,
}) => {
  // One small screen is back in landscape, so the tab has two layouts to offer: the monitors
  // as they are now, and the layout saved with the F/A-18C setup.
  const run = await rig.launch('dcs-setup-mfd-rotated', 'dcs-screens-layout');
  const { page, shot, home } = run;
  const written = path.join(home, 'Saved Games', 'DCS', 'Config', 'MonitorSetup', 'RigReady.lua');
  await page.getByTestId('mode-configure').click();
  await openScreens(page);
  const panel = page.getByTestId('screens-pairing');
  await expect(panel).toHaveAttribute('data-certain', 'false');
  await expect(panel).toHaveAttribute('data-from-service', 'false');
  const layouts = ['Layout of the setup "DCS F/A-18C"', 'Monitors as they are now'];
  const shown = (await page.getByTestId('screens-layout').textContent()) ?? '';
  const first = layouts.find((l) => shown.includes(l))!;
  const other = layouts.find((l) => l !== first)!;

  // The pairing was made for the layout the plan was read into. With another layout the
  // page no longer has it, and RigReady still will not write a pairing nobody looked at:
  // it asks again, with what it was not sure of.
  await choose(page, 'screens-layout', other);
  await expect(panel).toHaveAttribute('data-from-service', 'true');
  await expect(panel).toContainText(
    "RigReady could not be sure of every screen when it read the plan. Look at each one, then say they are right. To change which screen is which, import SimAppPro's plan again."
  );
  await expect(page.getByTestId('screens-pair-monitor-002')).toHaveClass(/v-input--disabled/);
  await expect(page.getByTestId('save-bar-why')).toHaveText('Check which screen is which first.');
  await expect(page.getByTestId('screens-apply')).toBeDisabled();
  await panel.scrollIntoViewIfNeeded();
  await shot('asked-again');

  // Back on the first layout the question still stands, until the user answers it.
  await choose(page, 'screens-layout', first);
  await expect(panel).toHaveAttribute('data-from-service', 'true');
  await expect(page.getByTestId('screens-apply')).toBeDisabled();
  await expect(fs.access(written)).rejects.toThrow();
  await page.getByTestId('screens-pairing-confirm').click();
  await expect(page.getByTestId('screens-pairing-checked')).toHaveText('You checked these.');
  await expect(page.getByTestId('save-bar-why')).toHaveCount(0);
  await page.getByTestId('screens-apply').click();
  await expect(page.getByTestId('screens-done')).toContainText('Created RigReady.lua');
  await fs.access(written);
  await shot('written-after-answer');
});

test('dcs-screens: a crop goes with its display to a screen of the same size, and the tab says so when it cannot', async ({
  rig,
}) => {
  const run = await rig.launch('dcs-setup-flying', 'dcs-screens-crop');
  const { page, shot } = run;
  await nameScreens(page);
  await openScreens(page);

  // SimAppPro's plan crops each display to the glass behind the bezel. The user sets the
  // top of the left one by hand.
  await expect(crop(page, 'LEFT_MFCD', 'top')).toHaveValue('256');
  await crop(page, 'LEFT_MFCD', 'top').fill('240');
  expect(await crops(page, 'LEFT_MFCD')).toEqual(['8', '240', '8', '6']);

  // The centre screen is freed and the left display moves there: same size, same crop.
  await choose(page, 'screens-monitor-CENTER_MFCD', 'Not shown');
  await choose(page, 'screens-monitor-LEFT_MFCD', 'MFD centre');
  expect(await crops(page, 'LEFT_MFCD')).toEqual(['8', '240', '8', '6']);
  await expect(page.getByTestId('screens-crop-note')).toHaveCount(0);
  await page.getByTestId('screens-show-lua').click();
  await expect(page.getByTestId('screens-lua')).toContainText(
    /LEFT_MFCD =\s*\{\s*x = 5896;\s*y = 240;/
  );
  await shot('crop-kept');

  // A display taken off its screen and put back has its crop again.
  await choose(page, 'screens-monitor-RIGHT_MFCD', 'Not shown');
  await expect(crop(page, 'RIGHT_MFCD', 'top')).toHaveCount(0);
  await choose(page, 'screens-monitor-RIGHT_MFCD', 'MFD right');
  expect(await crops(page, 'RIGHT_MFCD')).toEqual(['8', '256', '8', '6']);
  await expect(page.getByTestId('screens-crop-note')).toHaveCount(0);

  // The wide screen is another size: the crop cannot mean the same there, and the tab says so.
  await choose(page, 'screens-monitor-LEFT_MFCD', 'LC49G95T');
  expect(await crops(page, 'LEFT_MFCD')).toEqual(['0', '0', '0', '0']);
  await expect(page.getByTestId('screens-crop-note')).toHaveText(
    'The crop was not kept: LC49G95T is 5120 × 1440 and the screen it was set for is 768 × 1024. Set it again here.'
  );
  await page.getByTestId('screens-crop-note').scrollIntoViewIfNeeded();
  await shot('crop-not-kept');
});

test('dcs-screens: Identify screens works from this tab, and the map shows where DCS will draw the kneeboard', async ({
  rig,
}) => {
  const run = await rig.launch('dcs-setup-flying', 'dcs-screens-kneeboard');
  const { page, shot } = run;
  await nameScreens(page);
  await openScreens(page);

  // The F/A-18C shows the kneeboard at the bottom right of DCS's whole window. With the three
  // small screens to the right of the wide one that is the right small screen, which is not
  // as tall as the wide one: the lower part of the kneeboard is on no screen.
  const outline = page.locator('[data-testid="screen-map-outline"][data-name="kneeboard"]');
  await expect(outline).toBeVisible();
  await expect(outline).toHaveAttribute('data-bad', 'true');
  await expect(outline).toContainText('Kneeboard');
  const note = page.getByTestId('screens-kneeboard');
  await expect(note).toHaveAttribute('data-side', 'right');
  await expect(note).toHaveAttribute('data-whole', 'false');
  await expect(note).toContainText(
    'In the F/A-18C Hornet, DCS shows the kneeboard at the bottom right of its window. With this setup that is on MFD right, and only 62% of it is on a screen.'
  );
  await expect(note).toContainText(
    'DCS chooses this place itself; its monitor setup file cannot move the kneeboard.'
  );
  await expect(note.getByTestId('manual-link-page')).toContainText('What you can do');
  await expect(note.getByTestId('manual-link-page')).toHaveAttribute(
    'href',
    'https://rigready.io/docs/dcs/kneeboard/#where-dcs-shows-the-kneeboard'
  );
  // On the map it starts on the right small screen and runs out below it.
  const on = (await mapDisplay(page, 'MFD right').boundingBox())!;
  const drawn = (await outline.boundingBox())!;
  expect(drawn.x).toBeGreaterThanOrEqual(on.x - 1);
  expect(drawn.x + drawn.width).toBeLessThanOrEqual(on.x + on.width + 1);
  expect(drawn.y).toBeLessThan(on.y + on.height);
  expect(drawn.y + drawn.height).toBeGreaterThan(on.y + on.height + 1);
  await note.scrollIntoViewIfNeeded();
  await shot('kneeboard-runs-off-the-right-screen');

  // Identify from here: each screen shows its number, its name and what the setup puts on it.
  await page.getByTestId('screens-identify').click();
  await expect(page.getByTestId('screens-identified')).toContainText(
    'Each monitor that is on shows its number, its name and what this setup puts on it for 5 seconds (4 monitors).'
  );
  await shot('identified');

  // With the wide screen alone in the DCS window, all of the kneeboard is on it.
  for (const name of ['LEFT_MFCD', 'CENTER_MFCD', 'RIGHT_MFCD']) {
    await choose(page, `screens-monitor-${name}`, 'Not shown');
  }
  await expect(page.getByTestId('screen-map-box')).toHaveCount(0);
  await expect(note).toHaveAttribute('data-whole', 'true');
  await expect(note).toContainText(
    'In the F/A-18C Hornet, DCS shows the kneeboard at the bottom right of LC49G95T. All of it is on that screen.'
  );
  await expect(note.getByTestId('manual-link-page')).toContainText('About this place');
  await expect(outline).toHaveAttribute('data-bad', 'false');
  const wide = (await mapDisplay(page, 'LC49G95T').boundingBox())!;
  const whole = (await outline.boundingBox())!;
  expect(whole.x).toBeGreaterThanOrEqual(wide.x - 1);
  expect(whole.y).toBeGreaterThanOrEqual(wide.y - 1);
  expect(whole.x + whole.width).toBeLessThanOrEqual(wide.x + wide.width + 1);
  expect(whole.y + whole.height).toBeLessThanOrEqual(wide.y + wide.height + 1);
  // The right end of the wide screen.
  expect(whole.x).toBeGreaterThan(wide.x + wide.width / 2);
  await note.scrollIntoViewIfNeeded();
  await shot('kneeboard-all-on-the-wide-screen');

  // The corner is the aircraft's own. An aircraft that shows the kneeboard on the left has no
  // display RigReady found in its files; "+ Aircraft" offers it all the same, apart from
  // the ones with displays. The main view is still on the wide screen alone.
  await page.getByTestId('screens-add-aircraft').click();
  await page.getByTestId('screens-add-without-Su-25T').click();
  await expect(page.getByTestId('screens-aircraft-Su-25T')).toBeVisible();

  // The Su-25T: the bottom left of the DCS window, all of it on the wide screen.
  await expect(note).toHaveAttribute('data-side', 'left');
  await expect(note).toHaveAttribute('data-whole', 'true');
  await expect(note).toContainText(
    'In the Su-25T Frogfoot, DCS shows the kneeboard at the bottom left of LC49G95T. All of it is on that screen.'
  );
  await expect(outline).toHaveAttribute('data-bad', 'false');
  const screen = (await mapDisplay(page, 'LC49G95T').boundingBox())!;
  const left = (await outline.boundingBox())!;
  expect(left.x).toBeGreaterThanOrEqual(screen.x - 1);
  expect(left.x + left.width).toBeLessThan(screen.x + screen.width / 2);
  expect(left.y + left.height).toBeLessThanOrEqual(screen.y + screen.height + 1);
  await note.scrollIntoViewIfNeeded();
  await shot('kneeboard-on-the-left');

  // An aircraft RigReady has not read, added by the name DCS has for it: no place is drawn,
  // and the line says why.
  await page.getByTestId('screens-add-aircraft').click();
  await page.getByTestId('screens-add-aircraft-by-name').click();
  await page.getByTestId('screens-naming-field').locator('input').fill('AH-64D_BLK_II');
  await page.getByTestId('screens-naming-add').click();
  await expect(page.getByTestId('screens-aircraft-AH-64D_BLK_II')).toBeVisible();
  await expect(note).toHaveAttribute('data-side', 'unknown');
  await expect(note).not.toHaveAttribute('data-whole');
  await expect(note).toContainText(
    'RigReady does not know where DCS shows the kneeboard in the AH-64D_BLK_II, so it is not drawn on the map.'
  );
  await expect(note).not.toContainText('bottom');
  await expect(note.getByTestId('manual-link-page')).toContainText('What RigReady knows');
  await expect(outline).toHaveCount(0);
  await note.scrollIntoViewIfNeeded();
  await shot('kneeboard-place-not-known');
});

test('dcs-screens: an aircraft or a display RigReady did not find is added by name, a name that cannot be one is refused with the reason, and the tab says what it knows', async ({
  rig,
}) => {
  const run = await rig.launch('dcs-setup-flying', 'dcs-screens-by-name');
  const { page, shot, home } = run;
  const written = path.join(home, 'Saved Games', 'DCS', 'Config', 'MonitorSetup', 'RigReady.lua');
  await nameScreens(page);
  await openScreens(page);
  const menu = page.getByTestId('screens-aircraft-menu');
  const rows = page.getByTestId('screens-display-row');
  const row = (name: string) =>
    page.locator(`[data-testid="screens-display-row"][data-name="${name}"]`);
  const naming = page.getByTestId('screens-naming');
  const field = page.getByTestId('screens-naming-field').locator('input');
  const add = page.getByTestId('screens-naming-add');
  const problem = page.getByTestId('screens-naming-problem');

  // "+ Aircraft" has three parts: the aircraft with the displays found for them, the
  // installed aircraft in whose files none was found, and any other aircraft by name.
  await page.getByTestId('screens-add-aircraft').click();
  await expect(menu).toContainText('F-16C bl.50');
  await expect(menu).toContainText('No display found in their files');
  const frogfoot = page.getByTestId('screens-add-without-Su-25T');
  await expect(frogfoot).toContainText('Su-25T Frogfoot');
  await expect(page.getByTestId('screens-add-aircraft-by-name')).toContainText(
    'Another aircraft, by name'
  );
  // The aircraft scroll; the way to add any other one stays in view under them.
  await page.getByTestId('screens-add-without').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('screens-add-aircraft-by-name')).toBeInViewport();
  await shot('aircraft-menu');

  // An installed aircraft with no display found. The tab does not say it has none.
  await frogfoot.click();
  await expect(page.getByTestId('screens-aircraft-Su-25T')).toBeVisible();
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId('screens-no-displays')).toHaveText(
    "RigReady found no display to put on another screen in this aircraft's files. It may still have one: add it by name if you know it."
  );
  await expect(page.getByTestId('screens-aircraft')).toContainText(
    'A name you add is written as you typed it: RigReady cannot check it against the game.'
  );

  // A display by name. Text that is more than a name is refused, with the reason, and
  // cannot be added.
  await page.getByTestId('screens-add-display').click();
  await expect(naming).toContainText('Add a display of the Su-25T Frogfoot by name');
  await expect(naming).toContainText(
    'RigReady writes the name as you type it and cannot check that the aircraft has such a display.'
  );
  await expect(add).toBeDisabled();
  await field.fill("TV = 1; os.exit('now')");
  await expect(problem).toHaveText(
    'A display name has only letters, digits and _, starts with a letter or _, and is at most 64 characters long.'
  );
  await expect(add).toBeDisabled();
  await field.press('Enter');
  await expect(naming).toBeVisible();
  await shot('name-refused');
  await field.fill('Viewports');
  await expect(problem).toHaveText(
    "DCS's monitor setup file already uses that name for something else."
  );
  await field.fill('end');
  await expect(problem).toHaveText(
    "That is a word of the Lua language, which DCS's monitor setup file is written in."
  );
  await expect(add).toBeDisabled();
  await field.fill('TV_DISPLAY');
  await expect(add).toBeEnabled();
  await add.click();
  await expect(naming).toHaveCount(0);

  // The name has a row, on no screen yet, and the row says what RigReady knows of it.
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId('screens-no-displays')).toHaveCount(0);
  await expect(page.getByTestId('screens-monitor-TV_DISPLAY')).toContainText('Not shown');
  // A name RigReady has not seen is shown as typed, not made to read like a known display.
  await expect(row('TV_DISPLAY').locator('.rr-row-title')).toHaveText('TV_DISPLAY');
  await expect(row('TV_DISPLAY').getByTestId('screens-name-unseen')).toHaveText(
    "RigReady has not seen this name in this aircraft's files. If the aircraft does not ask DCS for it, nothing is drawn there."
  );
  // The same name a second time is refused too.
  await page.getByTestId('screens-add-display').click();
  await field.fill('TV_DISPLAY');
  await expect(problem).toHaveText('That display is already in the list.');
  await expect(add).toBeDisabled();
  await page.getByTestId('screens-naming-cancel').click();
  await expect(naming).toHaveCount(0);

  // It goes on a screen as any other display, and into the file under the name as typed.
  await choose(page, 'screens-monitor-TV_DISPLAY', 'MFD left');
  await expect(page.getByTestId('screens-errors')).toHaveCount(0);
  await page.getByTestId('screens-show-lua').click();
  const lua = page.getByTestId('screens-lua');
  await expect(lua).toContainText(viewportAt('TV_DISPLAY', 5120, 0));
  await row('TV_DISPLAY').scrollIntoViewIfNeeded();
  await shot('display-added-by-name');

  // A name added by mistake comes off the list again, and out of the file.
  await page.getByTestId('screens-add-display').click();
  await field.fill('WRONG_NAME');
  await field.press('Enter');
  await expect(rows).toHaveCount(2);
  await choose(page, 'screens-monitor-WRONG_NAME', 'MFD centre');
  await expect(lua).toContainText('WRONG_NAME =');
  await page.getByTestId('screens-forget-WRONG_NAME').click();
  await expect(rows).toHaveCount(1);
  await expect(lua).not.toContainText('WRONG_NAME');

  // An aircraft by name. One that is installed is found whatever capitals were typed, and
  // one already in the setup is not added twice.
  await page.getByTestId('screens-add-aircraft').click();
  await page.getByTestId('screens-add-aircraft-by-name').click();
  await expect(naming).toContainText('Add an aircraft by name');
  await expect(naming).toContainText(
    'RigReady writes the name as you type it and cannot check that DCS has such an aircraft.'
  );
  await field.fill("OH-6A'] = 1 --");
  await expect(problem).toHaveText(
    'An aircraft name has only letters, digits, spaces and the signs _ . + -, starts with a letter or a digit, and is at most 64 characters long.'
  );
  await expect(add).toBeDisabled();
  await field.fill('su-25t');
  await expect(problem).toHaveText('That aircraft is already in this setup.');
  await expect(add).toBeDisabled();
  await field.fill('f-16c_50');
  await expect(page.getByTestId('screens-naming-known')).toHaveText(
    'That is the F-16C bl.50, which is installed. RigReady adds it with what it knows of it.'
  );
  await expect(add).toBeEnabled();
  // An aircraft DCS on this PC does not have: a community aircraft, say.
  await field.fill('OH-6A');
  await expect(page.getByTestId('screens-naming-known')).toHaveCount(0);
  await add.click();
  await expect(page.getByTestId('screens-aircraft-OH-6A')).toBeVisible();
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId('screens-no-displays')).toHaveCount(0);
  await expect(page.getByTestId('screens-aircraft-unknown')).toHaveText(
    'RigReady has not found an aircraft called OH-6A in DCS on this PC. It cannot check this name, or any display you add for it. DCS matches names letter for letter, capitals included.'
  );
  await page.getByTestId('screens-add-display').click();
  await expect(naming).toContainText('Add a display of the OH-6A by name');
  await field.fill('OH6_MAP');
  await add.click();
  await choose(page, 'screens-monitor-OH6_MAP', 'MFD right');
  await expect(lua).toContainText(viewportAt('OH6_MAP', 6656, 0));
  await page
    .getByTestId('screens-aircraft-unknown')
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot('aircraft-added-by-name');

  // Written as typed, each under its aircraft, with the Hornet's own displays as before.
  await page.getByTestId('screens-pairing-confirm').click();
  await page.getByTestId('screens-apply').click();
  await expect(page.getByTestId('screens-done')).toContainText('Created RigReady.lua');
  const file = await fs.readFile(written, 'utf8');
  expect(file).toMatch(viewportAt('LEFT_MFCD', 5128));
  expect(file).toContain('-- Su-25T Frogfoot\nTV_DISPLAY =');
  expect(file).toContain('-- OH-6A\nOH6_MAP =');
  expect(file).toMatch(viewportAt('TV_DISPLAY', 5120, 0));
  expect(file).toMatch(viewportAt('OH6_MAP', 6656, 0));
  for (const never of ['WRONG_NAME', 'os.exit', 'function']) expect(file).not.toContain(never);

  // The setup is kept: opened again, the added names are there and say the same.
  await page.getByTestId('nav-displays').click();
  await expect(page.getByTestId('displays-page')).toBeVisible();
  await page.getByTestId('nav-games').click();
  await page.getByTestId('game-card-dcs').click();
  await page.getByTestId('dcs-tab-screens').click();
  await page.getByTestId('screens-aircraft-OH-6A').click();
  await expect(page.getByTestId('screens-aircraft-unknown')).toContainText(
    'RigReady has not found an aircraft called OH-6A in DCS on this PC.'
  );
  await expect(page.getByTestId('screens-monitor-OH6_MAP')).toContainText('MFD right');
  await page.getByTestId('screens-aircraft-Su-25T').click();
  await expect(row('TV_DISPLAY').getByTestId('screens-name-unseen')).toBeVisible();
  await expect(page.getByTestId('screens-monitor-TV_DISPLAY')).toContainText('MFD left');
});

test('dcs-screens: "Use in DCS" stays in the window from the top of the tab to its end, with what stops it and what it did beside it', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('dcs-setup-flying', 'dcs-screens-save-bar');
  await page.getByTestId('mode-configure').click();
  await openScreens(page);
  const use = page.getByTestId('screens-apply');

  // The tab is much longer than the window. The button it is for is in the window at the
  // top and at the end, and beside it stands why it cannot be pressed yet.
  await expect(use).toHaveText('Use in DCS');
  await expect(use).toBeDisabled();
  await expect(page.getByTestId('save-bar-unsaved')).toHaveText('Not in DCS yet');
  await expect(page.getByTestId('save-bar-why')).toHaveText('Check which screen is which first.');
  await expectSaveBarPinned(page, use, shot);
  // A tab has no way back of its own, so the bar has no Back.
  await expect(page.getByTestId('save-bar-back')).toHaveCount(0);

  // Pressed at the end of the tab, far from the top where the status is: what it did
  // stands beside the button, and the button says the setup is in use.
  await page.getByTestId('screens-pairing-confirm').click();
  await expect(page.getByTestId('save-bar-why')).toHaveCount(0);
  await page.getByTestId('screens-files').scrollIntoViewIfNeeded();
  await expect(use).toBeInViewport({ ratio: 1 });
  await use.click();
  await expect(page.getByTestId('save-bar-saved')).toContainText(
    'DCS will use the RigReady screen setup the next time it starts'
  );
  await expect(page.getByTestId('save-bar-saved')).toBeInViewport({ ratio: 1 });
  await expect(use).toHaveText('In use');
  await expect(use).toBeDisabled();
  await shot('used-in-dcs');

  // The bar asks nothing on the way out of this tab: "not in DCS yet" is also what a tab
  // nobody touched says, when RigReady's own proposal has not been written yet.
  const top = crop(page, 'LEFT_MFCD', 'top');
  await top.fill('240');
  await expect(page.getByTestId('save-bar-unsaved')).toHaveText('Not in DCS yet');
  await expect(use).toHaveText('Use in DCS');
  await page.getByTestId('nav-displays').click();
  await expect(page.getByTestId('displays-page')).toBeVisible();
  await expect(page.getByTestId('save-bar-leave')).toHaveCount(0);
});
