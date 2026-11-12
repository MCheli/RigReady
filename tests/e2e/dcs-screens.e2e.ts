import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './harness';

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
  await page.getByTestId('nav-dcs').click();
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
  await expect(page.getByTestId('screens-blocked')).toHaveText(
    'Check which screen is which first.'
  );
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
  await expect(page.getByTestId('screens-blocked')).toHaveCount(0);
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
  await expect(page.getByTestId('screens-blocked')).toHaveText(
    'Check which screen is which first.'
  );
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
  await expect(page.getByTestId('screens-blocked')).toHaveCount(0);
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

  // The corner is the aircraft's own. An aircraft that shows the kneeboard on the left, and
  // one whose scripts RigReady has not read, have no displays to send to a screen, so the
  // tab never offers them; a setup can still have them (one an assistant saved, say). Saved
  // here through the channel the page uses, with the main view on the wide screen alone.
  const saved = (await page.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
      }
    ).rigready;
    const state = (await api.invoke('dcs-setup:screens', undefined)) as {
      value: { desktops: { label: string; displays: { id: string; primary: boolean }[] }[] };
    };
    const current = state.value.desktops[0]!;
    return api.invoke('dcs-setup:applyScreens', {
      setup: {
        mainDisplayIds: [current.displays.find((d) => d.primary)!.id],
        aircraft: [
          { unit: 'Su-25T', label: 'Su-25T', placements: [] },
          { unit: 'AH-64D_BLK_II', label: 'AH-64D', placements: [] },
        ],
        desktop: current.displays,
        desktopLabel: current.label,
      },
    });
  })) as { ok: boolean };
  expect(saved.ok).toBe(true);
  // The tab opens on the saved setup.
  await page.getByTestId('nav-displays').click();
  await expect(page.getByTestId('displays-page')).toBeVisible();
  await page.getByTestId('nav-dcs').click();
  await page.getByTestId('dcs-tab-screens').click();
  await expect(page.getByTestId('screens-aircraft-Su-25T')).toBeVisible();

  // The Su-25T: the bottom left of the DCS window, all of it on the wide screen.
  await expect(note).toHaveAttribute('data-side', 'left');
  await expect(note).toHaveAttribute('data-whole', 'true');
  await expect(note).toContainText(
    'In the Su-25T, DCS shows the kneeboard at the bottom left of LC49G95T. All of it is on that screen.'
  );
  await expect(outline).toHaveAttribute('data-bad', 'false');
  const screen = (await mapDisplay(page, 'LC49G95T').boundingBox())!;
  const left = (await outline.boundingBox())!;
  expect(left.x).toBeGreaterThanOrEqual(screen.x - 1);
  expect(left.x + left.width).toBeLessThan(screen.x + screen.width / 2);
  expect(left.y + left.height).toBeLessThanOrEqual(screen.y + screen.height + 1);
  await note.scrollIntoViewIfNeeded();
  await shot('kneeboard-on-the-left');

  // An aircraft RigReady has not read: no place is drawn, and the line says why.
  await page.getByTestId('screens-aircraft-AH-64D_BLK_II').click();
  await expect(note).toHaveAttribute('data-side', 'unknown');
  await expect(note).not.toHaveAttribute('data-whole');
  await expect(note).toContainText(
    'RigReady does not know where DCS shows the kneeboard in the AH-64D, so it is not drawn on the map.'
  );
  await expect(note).not.toContainText('bottom');
  await expect(note.getByTestId('manual-link-page')).toContainText('What RigReady knows');
  await expect(outline).toHaveCount(0);
  await note.scrollIntoViewIfNeeded();
  await shot('kneeboard-place-not-known');
});
