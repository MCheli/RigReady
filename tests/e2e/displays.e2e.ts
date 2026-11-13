import type { Page } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { axeViolations, colourOnlyStatus } from './a11y';
import { checkRow, expect, test } from './harness';

/** The Monitors page, saved layouts, the display check and its fix. */

const card = (page: Page, name: string) =>
  page.locator(`[data-testid="layout-card"][data-layout="${name}"]`);
const row = (page: Page, label: string) =>
  page.locator(`[data-testid="display-row"][data-label="${label}"]`);

async function openMonitors(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-displays').click();
  await expect(page.getByTestId('displays-page')).toBeVisible();
}

async function menu(page: Page, layout: string, item: string): Promise<void> {
  await card(page, layout).getByTestId('layout-menu').click();
  await page.getByTestId(item).click();
  // The menu is gone again before the next one opens.
  await expect(page.getByTestId(item)).toHaveCount(0);
}

interface Answer {
  ok: boolean;
  value?: unknown;
}
interface Preload {
  rigready: { invoke(channel: string, input?: unknown): Promise<Answer> };
}
/** Asks main the way the window does. */
const ask = (page: Page, channel: string, input?: unknown): Promise<Answer> =>
  page.evaluate(([c, i]) => (globalThis as unknown as Preload).rigready.invoke(c as string, i), [
    channel,
    input,
  ] as const);

/** Back to the top of the Monitors page, where the line about what just happened is. */
const toTop = (page: Page): Promise<void> =>
  page
    .getByTestId('displays-page')
    .locator('h1')
    .evaluate((el) =>
      (el as unknown as { scrollIntoView(to: { block: string }): void }).scrollIntoView({
        block: 'center',
      })
    );

/** Whether "Keep this monitor layout?" is waiting for an answer, as main knows it. */
const questionOpen = async (page: Page): Promise<boolean> =>
  ((await ask(page, 'displays:pending')).value as { pending: boolean }).pending;

/** The middle MFD screen back in landscape: the one thing Make ready then has to put right. */
const MIDDLE_MFD_FLAT = {
  op: 'setDisplay',
  match: { name: 'USB_Monitor', index: 1 },
  set: { width: 1024, height: 768, rotation: 0 },
} as const;

test('monitors: map, Identify and names, then apply Flying, Racing without the TV, and manage layouts', async ({
  rig,
}) => {
  const run = await rig.launch('displays-layouts', 'display-layouts');
  const { page, shot } = run;
  await openMonitors(page);

  // The desk state as Windows has it: five monitors on, the Dell is the main display.
  const map = page.getByTestId('displays-map');
  await expect(map.getByTestId('map-monitor')).toHaveCount(5);
  await expect(row(page, 'DELL G3223D')).toContainText('main display');
  await expect(row(page, 'USB_Monitor (2 of 3)')).toContainText('1024x768 at 8704,0');
  await expect(page.getByTestId('display-identical-hint')).toHaveCount(3);
  await shot('desk-now');

  // Identify puts the numbers on the screens; the same numbers are on the map and the rows.
  await page.getByTestId('identify').click();
  await expect(page.getByTestId('displays-notice')).toContainText(
    'shows its number for 5 seconds (5 monitors)'
  );

  // The user reads the numbers off the physical screens and names the identical ones.
  await row(page, 'USB_Monitor (1 of 3)').getByTestId('display-name').click();
  await page.getByTestId('display-name-suggestion').filter({ hasText: 'MFD left' }).click();
  await expect(row(page, 'MFD left')).toBeVisible();
  await row(page, 'USB_Monitor (2 of 3)').getByTestId('display-name').click();
  await page.getByTestId('display-name-input').locator('input').fill('MFD centre');
  await page.getByTestId('display-name-save').click();
  await row(page, 'USB_Monitor (3 of 3)').getByTestId('display-name').click();
  await page.getByTestId('display-name-suggestion').filter({ hasText: 'MFD right' }).click();
  await expect(row(page, 'MFD right')).toContainText('USB_Monitor');
  await expect(page.getByTestId('display-identical-hint')).toHaveCount(0);
  await expect(map.locator('[data-label="MFD centre"]')).toBeVisible();
  await shot('named');

  // Saved layouts: each drawn to scale, with whether the monitors match it.
  await expect(page.getByTestId('layout-card')).toHaveCount(3);
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'different');
  await expect(card(page, 'Racing')).toHaveAttribute('data-status', 'incomplete');
  await expect(card(page, 'Racing').getByTestId('layout-status')).toContainText('TV not connected');
  await card(page, 'Flying').getByTestId('layout-status').click();
  const differences = card(page, 'Flying').getByTestId('layout-differences');
  await expect(differences).toContainText('DELL G3223D is on, expected off');
  await expect(differences).toContainText('MFD left is rotated 0°, expected 90°');
  await shot('layouts');

  // Apply Flying: first what would change, then the keep-or-revert prompt.
  await card(page, 'Flying').getByTestId('layout-apply').click();
  const dialog = page.getByTestId('apply-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('apply-changes')).toContainText(
    'DELL G3223D is on, expected off'
  );
  await expect(dialog.getByTestId('apply-changes')).toContainText(
    'MFD centre is 1024x768, expected 768x1024'
  );
  // The picture opens on the monitors as they are and then shows the change by itself.
  await expect(dialog.getByTestId('layout-morph')).toHaveAttribute('data-showing', 'after');
  await shot('apply-flying-preview');
  await dialog.getByTestId('apply-confirm').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await shot('keep-prompt');
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('keep-layout')).toHaveCount(0);
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'current');
  await expect(map.locator('[data-label="MFD left"]')).toHaveAttribute('data-rotation', '90');
  await expect(map.getByTestId('map-monitor-off')).toContainText('DELL G3223D · off');
  await expect(row(page, 'LC49G95T')).toContainText('main display');
  await page.getByTestId('displays-page').locator('h1').scrollIntoViewIfNeeded();
  await shot('flying-applied');

  // Racing wants the TV, which is not connected: it is only applied without it when asked.
  await card(page, 'Racing').getByTestId('layout-apply').click();
  await expect(dialog.getByTestId('apply-missing')).toContainText('TV is not connected');
  await expect(dialog.getByTestId('apply-confirm')).toHaveText('Apply without TV');
  await expect(dialog.getByTestId('layout-morph')).toHaveAttribute('data-showing', 'after');
  await shot('racing-without-tv');
  await dialog.getByTestId('apply-confirm').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('displays-notice')).toContainText('Applied "Racing" without TV');
  await expect(map.getByTestId('map-monitor')).toHaveCount(1);
  await expect(card(page, 'Racing')).toHaveAttribute('data-status', 'incomplete');

  // Kept, but changed my mind: the page puts back exactly what was there before.
  await page.getByTestId('displays-undo').click();
  await expect(page.getByTestId('displays-notice')).toContainText(
    'Put back the layout from before the last change'
  );
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'current');
  await expect(map.getByTestId('map-monitor')).toHaveCount(4);

  // Desk layout for Stand down, rename, delete, and save the monitors as they are now.
  await menu(page, 'Desk', 'layout-desk');
  await expect(card(page, 'Desk').getByTestId('layout-desk-badge')).toBeVisible();
  await menu(page, 'Racing', 'layout-rename');
  await page.getByTestId('layout-rename-input').locator('input').fill('Racing with TV');
  await page.getByTestId('layout-rename-save').click();
  await expect(card(page, 'Racing with TV')).toBeVisible();
  await menu(page, 'Racing with TV', 'layout-delete');
  await expect(page.getByTestId('layout-delete-dialog')).toBeVisible();
  await page.getByTestId('layout-delete-confirm').click();
  await expect(page.getByTestId('layout-card')).toHaveCount(2);
  await page.getByTestId('layout-save-open').click();
  await page.getByTestId('layout-save-name').locator('input').fill('Ultrawide only');
  await page.getByTestId('layout-save').click();
  await expect(card(page, 'Ultrawide only')).toHaveAttribute('data-status', 'current');
  await shot('managed');

  // Names and layouts live in the data folder: a restart finds them, with the same screens.
  const second = await run.restart();
  await openMonitors(second.page);
  await expect(row(second.page, 'MFD centre')).toBeVisible();
  await expect(card(second.page, 'Desk').getByTestId('layout-desk-badge')).toBeVisible();
  await expect(second.page.getByTestId('layout-card')).toHaveCount(3);
});

test('monitors: the apply preview is one map that moves from how the monitors are to how they would be, and two maps side by side when Windows asks for less motion', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-layouts', 'display-apply-preview');
  await openMonitors(page);
  await card(page, 'Flying').getByTestId('layout-apply').click();
  const dialog = page.getByTestId('apply-dialog');
  await expect(dialog).toBeVisible();
  const morph = dialog.getByTestId('layout-morph');
  const box = (label: string) =>
    morph.locator(`[data-testid="morph-monitor"][data-label="${label}"]`);
  /** Where a monitor is drawn, once it has stopped moving. */
  const settled = async (label: string) => {
    let last = '';
    await expect
      .poll(async () => {
        const now = JSON.stringify(await box(label).boundingBox());
        const same = now === last;
        last = now;
        return same;
      })
      .toBe(true);
    return (await box(label).boundingBox())!;
  };

  // It opens on the monitors as they are and then shows the change by itself: the Dell
  // goes dark, the ultrawide slides to the left edge and becomes the main display, and the
  // three MFD screens turn upright and close up beside it.
  await expect(morph).toHaveAttribute('data-showing', 'after');
  await expect(morph).toHaveAttribute('data-motion', 'full');
  await expect(morph.getByTestId('morph-caption')).toHaveText('With "Flying" applied');
  await expect(box('DELL G3223D')).toHaveAttribute('data-on', 'false');
  await expect(box('DELL G3223D')).toHaveAttribute('data-changes', 'turns off');
  await expect(box('LC49G95T')).toHaveClass(/primary/);
  await expect(box('LC49G95T')).toHaveAttribute('data-changes', 'moves, becomes the main display');
  await expect(box('USB_Monitor (1 of 3)')).toHaveAttribute('data-rotation', '90');
  await expect(box('USB_Monitor (1 of 3)')).toHaveAttribute('data-changes', 'turns, moves');
  // Upright, the three small screens are too narrow for a name. Each carries a letter, and
  // the key under the picture names all three, in the order they stand on the desk. (The
  // names used to be drawn on their side, and the middle one was lost.)
  for (const [label, letter] of [
    ['USB_Monitor (1 of 3)', 'A'],
    ['USB_Monitor (2 of 3)', 'B'],
    ['USB_Monitor (3 of 3)', 'C'],
  ] as const) {
    await expect(box(label)).toHaveAttribute('data-mark', letter);
    await expect(box(label).getByTestId('morph-letter')).toHaveText(letter);
  }
  await expect(morph.getByTestId('morph-key-item')).toHaveText([
    'A USB_Monitor (1 of 3)',
    'B USB_Monitor (2 of 3)',
    'C USB_Monitor (3 of 3)',
  ]);
  // The wide screen has room for its own name and size.
  await expect(box('LC49G95T')).toContainText('LC49G95T');
  await expect(box('LC49G95T')).toContainText('5120x1440');
  await expect(morph.getByTestId('morph-off-after')).toContainText('DELL G3223D · off');
  const frame = (await morph.getByTestId('morph-frame-after').boundingBox())!;
  const wideAfter = await settled('LC49G95T');
  const mfdAfter = await settled('USB_Monitor (1 of 3)');
  expect(Math.abs(wideAfter.x - frame.x)).toBeLessThan(2);
  expect(mfdAfter.height).toBeGreaterThan(mfdAfter.width);
  // The list of differences is still there, word for word.
  await expect(dialog.getByTestId('apply-changes')).toContainText(
    'DELL G3223D is on, expected off'
  );
  // The dialog with its picture passes the accessibility scan.
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('after');

  // Before: the same map, as the monitors are now.
  await morph.getByTestId('morph-before').click();
  await expect(morph).toHaveAttribute('data-showing', 'before');
  await expect(morph.getByTestId('morph-caption')).toHaveText('As the monitors are now');
  await expect(box('DELL G3223D')).toHaveAttribute('data-on', 'true');
  await expect(box('DELL G3223D')).toHaveClass(/primary/);
  await expect(box('USB_Monitor (1 of 3)')).toHaveAttribute('data-rotation', '0');
  const wideBefore = await settled('LC49G95T');
  const mfdBefore = await settled('USB_Monitor (1 of 3)');
  // The ultrawide was to the right of the Dell, and the MFD screen lay flat further right.
  expect(wideBefore.x).toBeGreaterThan(wideAfter.x + 40);
  expect(mfdBefore.width).toBeGreaterThan(mfdBefore.height);
  expect(mfdBefore.x).toBeGreaterThan(mfdAfter.x + 40);
  await expect(morph.getByTestId('morph-off-before')).toContainText(
    'Every connected monitor is on'
  );
  await shot('before');

  // Windows set to show less animation: nothing moves, both are there side by side.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(morph).toHaveAttribute('data-motion', 'reduced');
  await expect(morph).toHaveAttribute('data-showing', 'both');
  await expect(morph.getByTestId('morph-before')).toHaveCount(0);
  await expect(morph.getByTestId('morph-caption-before')).toHaveText('As the monitors are now');
  await expect(morph.getByTestId('morph-caption-after')).toHaveText('With "Flying" applied');
  const left = (await morph.getByTestId('morph-frame-before').boundingBox())!;
  const right = (await morph.getByTestId('morph-frame-after').boundingBox())!;
  expect(right.x).toBeGreaterThan(left.x + left.width);
  expect(Math.abs(right.y - left.y)).toBeLessThan(2);
  await expect(
    morph
      .getByTestId('morph-frame-before')
      .locator('[data-testid="morph-monitor"][data-label="DELL G3223D"]')
  ).toHaveAttribute('data-on', 'true');
  await expect(
    morph
      .getByTestId('morph-frame-after')
      .locator('[data-testid="morph-monitor"][data-label="DELL G3223D"]')
  ).toHaveAttribute('data-on', 'false');
  await shot('side-by-side');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await dialog.getByTestId('apply-cancel').click();
  await expect(dialog).toHaveCount(0);

  // A layout with a monitor that is not connected: it is drawn where it would be, as absent.
  await card(page, 'Racing').getByTestId('layout-apply').click();
  await expect(morph).toHaveAttribute('data-showing', 'after');
  await expect(box('TV')).toHaveClass(/absent/);
  await expect(box('TV')).toContainText('not connected');
  await expect(box('TV')).toHaveAttribute('data-changes', 'not connected');
  await expect(box('LC49G95T')).toHaveClass(/primary/);
  await expect(morph.getByTestId('morph-off-after')).toContainText('DELL G3223D · off');
  await shot('racing-without-the-tv');
});

test('monitors: edit a layout by hand; overlapping monitors are refused with a reason', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-layouts', 'display-edit');
  await openMonitors(page);
  await menu(page, 'Desk', 'layout-edit');
  const dialog = page.getByTestId('edit-dialog');
  await expect(dialog).toBeVisible();
  const mfd = dialog.locator('[data-testid="edit-row"][data-label="USB_Monitor (1 of 3)"]');
  // Turn the first MFD screen on in portrait: it lands at 0,0, on top of the Dell.
  await mfd.getByTestId('edit-enabled').locator('input').check();
  await mfd.getByTestId('edit-rotation').click();
  await page.getByRole('option', { name: 'Portrait (90°)' }).click();
  await expect(mfd).toContainText('768x1024');
  await dialog.getByTestId('edit-save').click();
  await expect(dialog.getByTestId('edit-error')).toContainText(
    'DELL G3223D and USB_Monitor (1 of 3) overlap.'
  );
  // Why it was refused and the button to try again are both in view: only the rows scroll.
  await expect(dialog.getByTestId('edit-error')).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByTestId('edit-save')).toBeInViewport({ ratio: 1 });
  await shot('overlap-refused');
  const x = mfd.getByTestId('edit-x').locator('input');
  await x.fill('7680');
  await x.blur();
  await dialog.getByTestId('edit-save').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('displays-notice')).toContainText('Saved "Desk"');
  await card(page, 'Desk').getByTestId('layout-status').click();
  await expect(card(page, 'Desk').getByTestId('layout-differences')).toContainText(
    'USB_Monitor (1 of 3) is rotated 0°, expected 90°'
  );
  await shot('edited');
});

test('monitors: a saved layout keeps each refresh rate, says when Windows runs another, and puts it back', async ({
  rig,
}) => {
  const run = await rig.launch('displays-layouts', 'display-refresh-rate');
  const { page, shot } = run;
  await openMonitors(page);
  await page.getByTestId('layout-save-open').click();
  await page.getByTestId('layout-save-name').locator('input').fill('Desk at 120 Hz');
  await page.getByTestId('layout-save').click();
  await expect(card(page, 'Desk at 120 Hz')).toHaveAttribute('data-status', 'current');

  // The layout's monitor rows show the rate it was saved with.
  await menu(page, 'Desk at 120 Hz', 'layout-edit');
  const edit = page.getByTestId('edit-dialog');
  await expect(
    edit.locator('[data-testid="edit-row"][data-label="LC49G95T"]').getByTestId('edit-mode')
  ).toHaveText('5120x1440 · 120 Hz');
  await shot('rate-in-layout');
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await expect(edit).toHaveCount(0);

  // Windows drops the ultrawide to 60 Hz (a driver update, a cable): the layout says so.
  await run.mutate([{ op: 'setDisplay', match: { name: 'LC49G95T' }, set: { refreshHz: 60 } }]);
  await expect(row(page, 'LC49G95T')).toContainText('60 Hz');
  await expect(card(page, 'Desk at 120 Hz')).toHaveAttribute('data-status', 'different');
  await card(page, 'Desk at 120 Hz').getByTestId('layout-status').click();
  await expect(card(page, 'Desk at 120 Hz').getByTestId('layout-differences')).toHaveText(
    'LC49G95T runs at 60 Hz, expected 120 Hz'
  );

  // The apply preview names it, in words and on the picture, and Apply puts it back.
  await card(page, 'Desk at 120 Hz').getByTestId('layout-apply').click();
  const dialog = page.getByTestId('apply-dialog');
  await expect(dialog.getByTestId('apply-changes')).toHaveText(
    'LC49G95T runs at 60 Hz, expected 120 Hz'
  );
  await expect(
    dialog.locator('[data-testid="morph-monitor"][data-label="LC49G95T"]')
  ).toHaveAttribute('data-changes', 'changes to 120 Hz');
  await expect(dialog.getByTestId('layout-morph')).toHaveAttribute('data-showing', 'after');
  await shot('apply-rate-preview');
  await dialog.getByTestId('apply-confirm').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(card(page, 'Desk at 120 Hz')).toHaveAttribute('data-status', 'current');
  await expect(row(page, 'LC49G95T')).toContainText('120 Hz');
  await shot('rate-applied');
});

test('monitors: a layout saved again takes a refresh rate that was raised in Windows, and applying it brings that rate back', async ({
  rig,
}) => {
  const run = await rig.launch('displays-layouts', 'display-rate-raised');
  const { page, shot } = run;
  await openMonitors(page);
  const dellRuns = (refreshHz: number): unknown => ({
    op: 'setDisplay',
    match: { name: 'DELL G3223D' },
    set: { refreshHz },
  });
  // Saved while the Dell runs at what Windows gave it: just under 60 Hz, though it offers 165.
  await page.getByTestId('layout-save-open').click();
  await page.getByTestId('layout-save-name').locator('input').fill('Office');
  await page.getByTestId('layout-save').click();
  const office = card(page, 'Office');
  await expect(office).toHaveAttribute('data-status', 'current');

  // The rate is raised in Windows. The layout says the monitors differ from it.
  await run.mutate([dellRuns(165)]);
  await expect(row(page, 'DELL G3223D')).toContainText('165 Hz');
  await expect(office).toHaveAttribute('data-status', 'different');

  // Saving under the same name is refused where the person is looking, and the refusal says
  // how a layout is saved again.
  await page.getByTestId('layout-save-open').click();
  await page.getByTestId('layout-save-name').locator('input').fill('Office');
  await page.getByTestId('layout-save').click();
  const saving = page.getByTestId('layout-save-dialog');
  await expect(saving.getByTestId('layout-save-error')).toHaveText(
    'There is already a layout named "Office". To save it again as the monitors are now, open its menu and choose "Replace with the monitors as they are now".'
  );
  await shot('same-name-says-how');
  await saving.getByRole('button', { name: 'Cancel' }).click();
  await expect(saving).toHaveCount(0);

  // Replace shows the one difference and takes the new rate.
  await menu(page, 'Office', 'layout-replace');
  const replace = page.getByTestId('layout-replace-dialog');
  await expect(replace.getByTestId('layout-replace-differences').locator('li')).toHaveText([
    'DELL G3223D runs at 165 Hz, expected 59.95 Hz',
  ]);
  await shot('replace-shows-the-new-rate');
  await replace.getByTestId('layout-replace-confirm').click();
  await expect(replace).toHaveCount(0);
  await expect(office).toHaveAttribute('data-status', 'current');
  await menu(page, 'Office', 'layout-edit');
  const edit = page.getByTestId('edit-dialog');
  await expect(
    edit.locator('[data-testid="edit-row"][data-label="DELL G3223D"]').getByTestId('edit-mode')
  ).toHaveText('2560x1440 · 165 Hz');
  await shot('new-rate-in-the-layout');
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await expect(edit).toHaveCount(0);

  // Flying switches the Dell off. Windows brings a monitor back at the rate it lists first,
  // which for the Dell is just under 60 Hz. Applying Office asks for 165 Hz again.
  await card(page, 'Flying').getByTestId('layout-apply').click();
  await page.getByTestId('apply-confirm').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'current');
  await run.mutate([dellRuns(59.95)]);
  await office.getByTestId('layout-apply').click();
  await page.getByTestId('apply-confirm').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(office).toHaveAttribute('data-status', 'current');
  await expect(row(page, 'DELL G3223D')).toContainText('165 Hz');

  // The same when only the rate dropped while the monitor stayed on.
  await run.mutate([dellRuns(59.95)]);
  await expect(row(page, 'DELL G3223D')).toContainText('59.95 Hz');
  await expect(office).toHaveAttribute('data-status', 'different');
  await office.getByTestId('layout-apply').click();
  await expect(page.getByTestId('apply-dialog').getByTestId('apply-changes')).toHaveText(
    'DELL G3223D runs at 59.95 Hz, expected 165 Hz'
  );
  await page.getByTestId('apply-confirm').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(office).toHaveAttribute('data-status', 'current');
  await expect(row(page, 'DELL G3223D')).toContainText('165 Hz');
  await toTop(page);
  await shot('rate-brought-back');
});

test('fix-display: an MFD screen back in landscape fails by name, Fix then Keep makes it pass', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('flying-mfd-rotated', 'fix-display');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  const layout = checkRow(page, 'Monitor layout');
  await expect(layout).toHaveAttribute('data-status', 'fail');
  await expect(layout).toContainText('USB_Monitor (2 of 3) is rotated 0°, expected 90°');
  await expect(layout.getByTestId('check-fix')).toContainText('Apply the monitor layout');
  await shot('rotated');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await expect(page.getByTestId('keep-layout-seconds')).toBeVisible();
  await shot('keep-prompt');
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('group-displays')).toContainText('1 of 1 OK');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('fixed');
});

test('identical MFD screens swapped: both are named in the check, Make ready swaps them back', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-mfd-swapped', 'display-mfd-swapped');
  const layout = checkRow(page, 'Monitor layout');
  await expect(layout).toHaveAttribute('data-status', 'fail');
  await expect(layout).toContainText('MFD left is at 5888,0, expected 5120,0');
  await expect(layout).toContainText('MFD centre is at 5120,0, expected 5888,0');
  await shot('swapped');
  await page.getByTestId('make-ready').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await openMonitors(page);
  await expect(row(page, 'MFD left')).toContainText('at 5120,0');
  await expect(row(page, 'MFD centre')).toContainText('at 5888,0');
  await shot('monitors-after');
});

test('closed during the countdown: the next start offers the earlier layout back', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-recovery', 'display-recovery');
  const offer = page.getByTestId('layout-recovery');
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('DELL G3223D: 2560x1440 at 0,0, main');
  await shot('offer');
  await offer.getByTestId('layout-recovery-restore').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await page.getByTestId('keep-layout-keep').click();
  await expect(offer).toHaveCount(0);
  await openMonitors(page);
  await expect(row(page, 'DELL G3223D')).toContainText('main display');
  await expect(row(page, 'USB_Monitor (1 of 3)')).toContainText('Landscape');
  await shot('restored');
});

test('closed during the countdown: a change made while the earlier layout is offered takes its place, and the offer does not come back', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-recovery', 'display-recovery-overtaken');
  const offer = page.getByTestId('layout-recovery');
  await expect(offer).toBeVisible();
  // Something other than this question changes the layout: a start with --launch does, and
  // so does Make ready from the tray. Here one monitor is turned.
  interface Api {
    invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown }>;
  }
  const turning = page.evaluate(async () => {
    const api = (globalThis as unknown as { rigready: Api }).rigready;
    const read = await api.invoke('displays:read');
    const monitors = (read.value as { displays: { id: string; enabled: boolean }[] }).displays;
    return api.invoke('displays:flip', { id: monitors.find((d) => d.enabled)!.id });
  });
  // That change has its own question. The old one is gone for good: what would be put back
  // now is no longer what it listed.
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await expect(offer).toHaveCount(0);
  await shot('its-own-question');
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('keep-layout')).toHaveCount(0);
  expect(await turning).toMatchObject({ ok: true, value: { kept: true } });
  // Main has nothing left to offer, and the window does not ask again.
  const left = await page.evaluate(() =>
    (globalThis as unknown as { rigready: Api }).rigready.invoke('displays:recovery')
  );
  expect(left).toEqual({ ok: true, value: null });
  await expect(offer).toHaveCount(0);
});

test('monitors: a layout that nobody kept is not called applied', async ({ rig }) => {
  const { page, shot } = await rig.launch('displays-layouts', 'display-not-kept');
  // The shortest countdown the setting allows, so that it can run out here.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  const seconds = page.getByTestId('setting-revert-seconds').locator('input');
  await seconds.fill('5');
  await seconds.blur();
  await expect(page.getByTestId('settings-saved')).toHaveText('Saved');
  await page.getByTestId('nav-displays').click();
  await expect(page.getByTestId('displays-page')).toBeVisible();
  const notice = page.getByTestId('displays-notice');
  const prompt = page.getByTestId('keep-layout');

  // Apply Flying and answer nothing: the countdown runs out and the desk layout is back.
  await card(page, 'Flying').getByTestId('layout-apply').click();
  await page.getByTestId('apply-confirm').click();
  await expect(prompt).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(prompt).toHaveCount(0, { timeout: 20_000 });
  await expect(notice).toContainText(
    '"Flying" was not kept. The monitors are back the way they were.'
  );
  await expect(notice).toHaveAttribute('data-tone', 'warn');
  await expect(notice).not.toContainText('Applied');
  // The page shows the monitors as they are: all five on, and Flying still not in use.
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'different');
  await expect(page.getByTestId('displays-map').getByTestId('map-monitor')).toHaveCount(5);
  await expect(row(page, 'DELL G3223D')).toContainText('main display');
  await toTop(page);
  await shot('countdown-ran-out');

  // "Go back" says the same.
  await notice.getByRole('button', { name: 'Close' }).click();
  await expect(notice).toHaveCount(0);
  await card(page, 'Flying').getByTestId('layout-apply').click();
  await page.getByTestId('apply-confirm').click();
  await page.getByTestId('keep-layout-revert').click();
  await expect(notice).toContainText(
    '"Flying" was not kept. The monitors are back the way they were.'
  );
  await expect(notice).toHaveAttribute('data-tone', 'warn');
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'different');

  // Only a layout that was kept is "Applied".
  await card(page, 'Flying').getByTestId('layout-apply').click();
  await page.getByTestId('apply-confirm').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(notice).toContainText('Applied "Flying"');
  await expect(notice).toHaveAttribute('data-tone', 'info');
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'current');
  await toTop(page);
  await shot('kept');
});

test('monitors: "Which way is up?" takes an arrow that points sideways, a quarter turn either way', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-layouts', 'display-quarter-turn');
  await openMonitors(page);
  await page.getByTestId('identify').click();
  const panel = page.getByTestId('upright-panel');
  await expect(panel).toBeVisible();
  const up = (label: string) => panel.locator(`[data-testid="upright-row"][data-label="${label}"]`);
  const notice = page.getByTestId('displays-notice');
  // Every screen has an answer for each way a wrong arrow can point.
  await expect(panel.getByTestId('upright-row')).toHaveCount(5);
  await expect(up('USB_Monitor (1 of 3)').getByRole('button')).toHaveText([
    'Left',
    'Down',
    'Right',
  ]);
  await shot('which-way-is-up');

  // The arrow on the first small screen points right. Its picture is turned a quarter, and
  // the two screens beside it move up to it: it is 256 pixels narrower now.
  await up('USB_Monitor (1 of 3)').getByTestId('upright-turn-right').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await page.getByTestId('keep-layout-keep').click();
  await expect(notice).toContainText('Turned USB_Monitor (1 of 3) a quarter turn.');
  await expect(notice).toHaveAttribute('data-tone', 'info');
  await expect(up('USB_Monitor (1 of 3)')).toContainText('Portrait (90°)');
  await expect(row(page, 'USB_Monitor (1 of 3)')).toContainText('768x1024 at 7680,0');
  await expect(row(page, 'USB_Monitor (2 of 3)')).toContainText('1024x768 at 8448,0');
  await expect(row(page, 'USB_Monitor (3 of 3)')).toContainText('1024x768 at 9472,0');
  await expect(up('USB_Monitor (1 of 3)').getByTestId('upright-confirmed')).toBeVisible();

  // The arrow on the next one points left: a quarter the other way.
  await up('USB_Monitor (2 of 3)').getByTestId('upright-turn-left').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(notice).toContainText('Turned USB_Monitor (2 of 3) a quarter turn.');
  await expect(up('USB_Monitor (2 of 3)')).toContainText('Portrait (flipped) (270°)');
  await expect(row(page, 'USB_Monitor (2 of 3)')).toContainText('768x1024 at 8448,0');
  await expect(row(page, 'USB_Monitor (3 of 3)')).toContainText('1024x768 at 9216,0');
  await expect(
    page
      .getByTestId('displays-map')
      .locator('[data-testid="map-monitor"][data-label="USB_Monitor (2 of 3)"]')
  ).toHaveAttribute('data-rotation', '270');
  await toTop(page);
  await shot('turned-a-quarter');

  // A turn that is not kept changes nothing, and the page says so.
  await up('USB_Monitor (3 of 3)').getByTestId('upright-turn-right').click();
  await page.getByTestId('keep-layout-revert').click();
  await expect(notice).toContainText(
    'USB_Monitor (3 of 3) is back the way it was. Nothing was changed.'
  );
  await expect(notice).toHaveAttribute('data-tone', 'warn');
  await expect(up('USB_Monitor (3 of 3)')).toContainText('Landscape');
  await expect(row(page, 'USB_Monitor (3 of 3)')).toContainText('1024x768 at 9216,0');
  await toTop(page);
  await shot('turn-not-kept');
});

test('monitors: turning a screen in the editor moves the screens beside it, and one press of Save layout saves', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-layouts', 'display-edit-turn');
  await openMonitors(page);
  await page.getByTestId('layout-save-open').click();
  await page.getByTestId('layout-save-name').locator('input').fill('All on');
  await page.getByTestId('layout-save').click();
  await expect(card(page, 'All on')).toHaveAttribute('data-status', 'current');
  await menu(page, 'All on', 'layout-edit');
  const dialog = page.getByTestId('edit-dialog');
  await expect(dialog).toBeVisible();
  const line = (label: string) => dialog.locator(`[data-testid="edit-row"][data-label="${label}"]`);
  const x = (label: string) => line(label).getByTestId('edit-x').locator('input');
  const upright = async (label: string) => {
    await line(label).getByTestId('edit-rotation').click();
    await page.getByRole('option', { name: 'Portrait (90°)' }).click();
    // Wait for this menu to close: while it fades out, the next screen's menu would show a
    // second "Portrait (90°)" and the pick would match both.
    await expect(page.getByRole('option', { name: 'Portrait (90°)' })).toHaveCount(0);
    await expect(line(label).getByTestId('edit-mode')).toContainText('768x1024');
  };
  const note = dialog.getByTestId('edit-note');

  // The three small screens lie flat, side by side, 1024 wide each.
  await expect(x('USB_Monitor (1 of 3)')).toHaveValue('7680');
  await expect(x('USB_Monitor (2 of 3)')).toHaveValue('8704');
  await expect(x('USB_Monitor (3 of 3)')).toHaveValue('9728');
  // Turned upright each is 768 wide. The screens to its right move up to it, so no gap of
  // 256 pixels is left that the person would have to work out and type.
  await upright('USB_Monitor (1 of 3)');
  await expect(x('USB_Monitor (2 of 3)')).toHaveValue('8448');
  await expect(x('USB_Monitor (3 of 3)')).toHaveValue('9472');
  await expect(note).toHaveText(
    'Moved USB_Monitor (2 of 3) and USB_Monitor (3 of 3) to stay next to USB_Monitor (1 of 3).'
  );
  await shot('first-one-turned');
  await upright('USB_Monitor (2 of 3)');
  await expect(x('USB_Monitor (3 of 3)')).toHaveValue('9216');
  await expect(note).toHaveText('Moved USB_Monitor (3 of 3) to stay next to USB_Monitor (2 of 3).');
  await upright('USB_Monitor (3 of 3)');
  await expect(x('USB_Monitor (1 of 3)')).toHaveValue('7680');
  await expect(x('USB_Monitor (2 of 3)')).toHaveValue('8448');
  await expect(x('USB_Monitor (3 of 3)')).toHaveValue('9216');
  await shot('all-three-upright');

  // Now a position typed by hand: the third screen goes under the second. The drawing
  // changes shape while the number is typed, and the buttons stay where they are, so the
  // press that follows lands on "Save layout". (The first press used to be lost: leaving
  // the field redrew the dialog under the pointer.)
  const save = dialog.getByTestId('edit-save');
  const drawn = dialog.locator('[data-testid="map-monitor"][data-label="USB_Monitor (3 of 3)"]');
  const saveBefore = await save.boundingBox();
  const drawnBefore = (await drawn.boundingBox())!;
  await x('USB_Monitor (3 of 3)').fill('8448');
  const y = line('USB_Monitor (3 of 3)').getByTestId('edit-y').locator('input');
  await y.fill('1024');
  await expect(y).toBeFocused();
  await expect.poll(async () => (await drawn.boundingBox())!.y).toBeGreaterThan(drawnBefore.y + 5);
  expect(await save.boundingBox()).toEqual(saveBefore);
  await shot('typed-position');
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('displays-notice')).toContainText('Saved "All on"');
  await card(page, 'All on').getByTestId('layout-status').click();
  await expect(card(page, 'All on').getByTestId('layout-differences')).toContainText(
    'USB_Monitor (3 of 3) is at 9728,0, expected 8448,1024'
  );
  await shot('saved-with-one-press');
});

test('monitors: a layout card names every screen in desk order, and says which connected monitors the layout leaves alone', async ({
  rig,
}) => {
  const run = await rig.launch('displays-layouts-named', 'display-layout-cards');
  const { page, shot } = run;
  await openMonitors(page);
  const flying = card(page, 'Flying');
  // Flying was saved with the small screens in the order Windows listed them: centre,
  // right, left. The card goes by the desk, left to right, and writes every name out: a
  // box too narrow for its name carries a letter, and the key names it.
  await expect(flying.getByTestId('map-key-item')).toHaveText([
    'A MFD left',
    'B MFD centre',
    'C MFD right',
  ]);
  for (const [label, letter] of [
    ['MFD left', 'A'],
    ['MFD centre', 'B'],
    ['MFD right', 'C'],
  ] as const) {
    await expect(
      flying.locator(`[data-testid="map-monitor"][data-label="${label}"]`)
    ).toHaveAttribute('data-mark', letter);
  }
  await expect(flying.locator('[data-testid="map-monitor"][data-label="LC49G95T"]')).toContainText(
    'LC49G95T'
  );
  await expect(flying.getByTestId('map-monitor-off')).toHaveText(['DELL G3223D · off']);
  // No name is cut short.
  interface Sized {
    scrollWidth: number;
    clientWidth: number;
  }
  expect(
    await flying
      .locator('[data-testid="map-key-item"], [data-testid="map-monitor-off"], .mm-label')
      .evaluateAll((all) =>
        all.every((el) => {
          const size = el as unknown as Sized;
          return size.scrollWidth <= size.clientWidth;
        })
      )
  ).toBe(true);

  // The rule, once, above the layouts.
  await expect(page.getByTestId('layouts-rule')).toContainText(
    'A layout changes only the monitors it lists.'
  );
  // Every connected monitor is in both layouts, so no card has anything to add.
  await expect(page.getByTestId('layout-untouched')).toHaveCount(0);
  await flying.scrollIntoViewIfNeeded();
  await shot('cards');

  // A TV is plugged in. Neither layout was saved with it, so neither switches it off.
  await run.mutate([
    {
      op: 'plugDisplay',
      display: {
        id: '\\\\?\\display#tv00001#5&1509d400&0&uid4361#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}',
        name: 'TV',
        edid: 'TV00001',
        serial: 'TV0000001',
        connector: 'HDMI',
        enabled: true,
        primary: false,
        x: 640,
        y: -2160,
        width: 3840,
        height: 2160,
        rotation: 0,
        rawRotation: 1,
        refreshHz: 60,
        gdiName: '\\\\.\\DISPLAY3',
        modes: [{ width: 3840, height: 2160, refreshHz: 60 }],
      },
    },
  ]);
  await page.getByTestId('displays-refresh').click();
  await expect(row(page, 'TV')).toBeVisible();
  await expect(flying.getByTestId('layout-untouched')).toHaveText(
    'This layout does not list TV, so applying it leaves that monitor as it is.'
  );
  await expect(card(page, 'Desk').getByTestId('layout-untouched')).toHaveText(
    'This layout does not list TV, so applying it leaves that monitor as it is.'
  );
  await flying.scrollIntoViewIfNeeded();
  await shot('a-monitor-no-layout-lists');

  // Apply says it before anything changes, and it is what happens: the TV stays on.
  await flying.getByTestId('layout-apply').click();
  const dialog = page.getByTestId('apply-dialog');
  await expect(dialog.getByTestId('apply-untouched')).toHaveText(
    'TV is not in this layout, so it stays on. A layout only switches off a monitor it lists.'
  );
  await shot('apply-says-what-stays-on');
  await dialog.getByTestId('apply-confirm').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('displays-notice')).toContainText('Applied "Flying"');
  await expect(flying).toHaveAttribute('data-status', 'current');
  const map = page.getByTestId('displays-map');
  await expect(map.locator('[data-testid="map-monitor"][data-label="TV"]')).toBeVisible();
  await expect(map.locator('[data-testid="map-monitor"][data-label="DELL G3223D"]')).toHaveCount(0);
  await toTop(page);
  await shot('tv-still-on');
});

test('monitors: New layout starts from which monitors stay on, and Replace asks before it overwrites a layout', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-layouts', 'display-new-and-replace');
  await openMonitors(page);
  const notice = page.getByTestId('displays-notice');
  const map = page.getByTestId('displays-map');

  // New layout: every monitor that is on starts ticked.
  await page.getByTestId('layout-new-open').click();
  const fresh = page.getByTestId('layout-new-dialog');
  await expect(fresh).toBeVisible();
  const tick = (label: string) =>
    fresh
      .locator(`[data-testid="layout-new-row"][data-label="${label}"]`)
      .getByTestId('layout-new-monitor')
      .locator('input');
  const count = fresh.getByTestId('layout-new-count');
  await expect(fresh.getByTestId('layout-new-row')).toHaveCount(5);
  await expect(count).toHaveText('5 on, 0 off: the same as saving the monitors as they are now.');
  // Racing on the ultrawide alone: untick the rest.
  for (const label of [
    'DELL G3223D',
    'USB_Monitor (1 of 3)',
    'USB_Monitor (2 of 3)',
    'USB_Monitor (3 of 3)',
  ]) {
    await tick(label).uncheck();
  }
  await expect(count).toHaveText('1 on, 4 off.');
  await expect(fresh.getByTestId('layout-new-preview').getByTestId('map-monitor')).toHaveCount(1);
  // With none left on there is nothing to save.
  await tick('LC49G95T').uncheck();
  await expect(count).toHaveText('Tick at least one monitor.');
  await fresh.getByTestId('layout-new-name').locator('input').fill('Ultrawide only');
  await expect(fresh.getByTestId('layout-new-save')).toBeDisabled();
  await tick('LC49G95T').check();
  await expect(fresh.getByTestId('layout-new-save')).toBeEnabled();
  await shot('new-layout');
  await fresh.getByTestId('layout-new-save').click();
  await expect(fresh).toHaveCount(0);
  // Saved, and nothing on the desk changed.
  await expect(notice).toContainText('Saved "Ultrawide only". The monitors were not changed.');
  await expect(map.getByTestId('map-monitor')).toHaveCount(5);
  const only = card(page, 'Ultrawide only');
  await expect(only).toHaveAttribute('data-status', 'different');
  await expect(only.getByTestId('map-monitor')).toHaveCount(1);
  await expect(only.getByTestId('map-monitor-off')).toHaveCount(4);
  await shot('new-layout-saved');
  // Applying it is what switches the others off.
  await only.getByTestId('layout-apply').click();
  await page.getByTestId('apply-confirm').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(only).toHaveAttribute('data-status', 'current');
  await expect(map.getByTestId('map-monitor')).toHaveCount(1);
  await expect(row(page, 'LC49G95T')).toContainText('main display');
  await toTop(page);
  await shot('new-layout-applied');

  // Replace with the monitors as they are now: it asks first, with what would change.
  await menu(page, 'Flying', 'layout-replace');
  const replace = page.getByTestId('layout-replace-dialog');
  await expect(replace).toBeVisible();
  await expect(replace).toContainText('Replace "Flying"?');
  await expect(replace).toContainText(
    'The arrangement it holds today is gone for good: Undo last change puts the monitors back, not a saved layout.'
  );
  await expect(replace.getByTestId('layout-replace-differences').locator('li')).toHaveText([
    'USB_Monitor (1 of 3) is off, expected on',
    'USB_Monitor (2 of 3) is off, expected on',
    'USB_Monitor (3 of 3) is off, expected on',
  ]);
  await expect(replace).toContainText('The monitors themselves are not changed.');
  await shot('replace-asks-first');
  // Cancel leaves the layout as it was.
  await replace.getByTestId('layout-replace-cancel').click();
  await expect(replace).toHaveCount(0);
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'different');
  await card(page, 'Flying').getByTestId('layout-status').click();
  await expect(card(page, 'Flying').getByTestId('layout-differences').locator('li')).toHaveCount(3);
  // Replace does it.
  await menu(page, 'Flying', 'layout-replace');
  await replace.getByTestId('layout-replace-confirm').click();
  await expect(replace).toHaveCount(0);
  await expect(notice).toContainText('"Flying" now holds the monitors as they are');
  await expect(card(page, 'Flying')).toHaveAttribute('data-status', 'current');
  // A layout the monitors already match: replacing it changes nothing, and it says so.
  await menu(page, 'Flying', 'layout-replace');
  await expect(replace.getByTestId('layout-replace-same')).toHaveText(
    'The monitors already match this layout, so replacing it changes nothing you would notice.'
  );
  await replace.getByTestId('layout-replace-cancel').click();
  await expect(replace).toHaveCount(0);
  await toTop(page);
  await shot('replaced');
});

test('make ready and stand down: the first time a layout is used it asks, and once kept on this PC it is applied without the question', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('desk-mfds-wrong', 'display-known-layout');
  // At the desk: this arrangement is the desk layout.
  await openMonitors(page);
  await page.getByTestId('layout-save-open').click();
  await page.getByTestId('layout-save-name').locator('input').fill('Desk');
  await page.getByTestId('layout-save').click();
  await expect(card(page, 'Desk')).toHaveAttribute('data-status', 'current');
  await menu(page, 'Desk', 'layout-desk');
  await expect(card(page, 'Desk').getByTestId('layout-desk-badge')).toBeVisible();
  await page.getByTestId('mode-fly').click();
  const status = page.getByTestId('fly-status-title');
  const prompt = page.getByTestId('keep-layout');
  const once = page.getByTestId('keep-layout-once');
  await expect(status).toHaveText('Not ready');

  // The first Make ready: the flying layout has never been kept on this PC, so it asks.
  await page.getByTestId('make-ready').click();
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('If you do nothing, the previous layout comes back in');
  await expect(once).toHaveText(
    'RigReady asks this the first time a layout is used on this PC. Once you keep it, Make ready and Stand down apply it without asking.'
  );
  await shot('first-make-ready-asks');
  await page.getByTestId('keep-layout-keep').click();
  await expect(status).toHaveText('Ready');

  // The first Stand down asks about the desk layout in the same way.
  await page.getByTestId('stand-down').click();
  await expect(prompt).toBeVisible();
  await expect(once).toBeVisible();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-activity')).toContainText('Applied desk layout "Desk"');
  await expect(status).toHaveText('Not ready');
  await expect(checkRow(page, 'Monitor layout')).toContainText('DELL G3223D is on, expected off');

  // Another day. Both layouts were kept with these monitors: Make ready applies the
  // flying layout and is ready, with no question and no countdown in between.
  await page.getByTestId('make-ready').click();
  await expect(status).toHaveText('Ready');
  await expect(prompt).toHaveCount(0);
  expect(await questionOpen(page)).toBe(false);
  await expect(page.getByTestId('group-displays')).toContainText('1 of 1 OK');
  await shot('second-make-ready-does-not-ask');

  // And Stand down puts the desk layout back the same way.
  await page.getByTestId('stand-down').click();
  await expect(status).toHaveText('Not ready');
  await expect(page.getByTestId('fly-activity')).toContainText('Applied desk layout "Desk"');
  await expect(prompt).toHaveCount(0);
  expect(await questionOpen(page)).toBe(false);
  await expect(checkRow(page, 'Monitor layout')).toContainText('DELL G3223D is on, expected off');
  await shot('second-stand-down-does-not-ask');
});

test('make ready and launch: the launch waits for the first answer and does not go ahead on a layout that was not kept; a layout kept before does not ask', async ({
  rig,
}) => {
  const run = await rig.launch('flying-mfd-rotated', 'display-known-launch');
  const { page, shot } = run;
  const running = async (): Promise<boolean> =>
    (
      (await ask(page, 'fly:gameStatus', { profileId: 'dcs-f-a-18c' })).value as {
        running: boolean;
      }
    ).running;
  const status = page.getByTestId('fly-status-title');
  const prompt = page.getByTestId('keep-layout');
  await expect(status).toHaveText('Not ready');
  // Stay on screen after the launch, to see what it did.
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-minimize-pref').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fly-minimize-pref')).toBeHidden();

  // Never kept on this PC: it asks, and the game is not started while the question is open.
  await page.getByTestId('ready-and-launch').click();
  await expect(prompt).toBeVisible();
  await expect(page.getByTestId('keep-layout-seconds')).toBeVisible();
  await expect(page.getByTestId('fly-step-displays')).toHaveAttribute('data-state', 'running');
  expect(await running()).toBe(false);
  await shot('launch-waits-for-the-answer');
  // "Go back": the layout is not there, so nothing is launched, and the run says why.
  await page.getByTestId('keep-layout-revert').click();
  await expect(page.getByTestId('fly-activity')).toContainText(
    'The new monitor layout was not kept, so the previous one is back.'
  );
  await expect(status).toHaveText('Not ready');
  expect(await running()).toBe(false);
  await shot('not-kept-not-launched');

  // Make ready, and this time keep it.
  await page.getByTestId('make-ready').click();
  await expect(prompt).toBeVisible();
  await page.getByTestId('keep-layout-keep').click();
  await expect(status).toHaveText('Ready');

  // Another day the screen is flat again. The layout is known to work here, so "Make
  // ready and launch" applies it and launches, with no question in between.
  await run.mutate([MIDDLE_MFD_FLAT]);
  await expect(status).toHaveText('Not ready');
  await page.getByTestId('ready-and-launch').click();
  await expect(page.getByTestId('fly-activity-headline')).toContainText('Launched DCS.exe');
  await expect(prompt).toHaveCount(0);
  expect(await questionOpen(page)).toBe(false);
  expect(await running()).toBe(true);
  await expect(page.getByTestId('fly-step-displays')).toHaveAttribute('data-state', 'done');
  await shot('known-layout-launched-without-asking');
});

test('an assistant asks for Make ready: the question names the assistant and gives a full minute', async ({
  rig,
}) => {
  const run = await rig.launch('mcp-settings', 'display-assistant-asks');
  const { page, shot } = run;
  // The middle MFD screen lies flat, so Make ready has a layout to apply.
  await run.mutate([MIDDLE_MFD_FLAT]);
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('mcp-settings').scrollIntoViewIfNeeded();
  await page.getByTestId('mcp-enable').locator('input').check();
  await expect(page.getByTestId('mcp-state')).toHaveAttribute('data-running', 'true');
  const state = await page.getByTestId('mcp-state').innerText();
  const url = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(state)?.[0];
  expect(url, state).toBeTruthy();
  await page.getByTestId('mcp-pair-name').locator('input').fill('Claude Code');
  await page.getByTestId('mcp-pair').click();
  await page.getByTestId('mcp-token-toggle').click();
  const token = /rr_[0-9a-f]{64}/.exec(
    await page.getByTestId('mcp-client-config').innerText()
  )?.[0];
  expect(token).toBeTruthy();
  // Back on the Play page, where the person at the screens would be looking.
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toContainText('Not ready');

  const client = new Client({ name: 'e2e-assistant', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url!), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  try {
    const call = client.callTool({ name: 'rig_make_ready', arguments: { setup: 'dcs-f-a-18c' } });
    await expect(page.getByTestId('mcp-question')).toBeVisible();
    await page.getByTestId('mcp-question-allow').click();
    // The person at the screens did not click anything: the question says who asked, and
    // counts down a minute where a change made by hand gets the 15 seconds of the setting.
    const prompt = page.getByTestId('keep-layout');
    await expect(prompt).toBeVisible();
    await expect(page.getByTestId('keep-layout-asked-by')).toHaveText(
      'Claude Code asked RigReady to rearrange the monitors.'
    );
    const left = Number(await page.getByTestId('keep-layout-seconds').innerText());
    expect(left).toBeGreaterThan(50);
    expect(left).toBeLessThanOrEqual(60);
    await shot('asked-by-an-assistant');
    await page.getByTestId('keep-layout-keep').click();
    expect((await call).isError).toBeFalsy();
    await expect(prompt).toHaveCount(0);
  } finally {
    await client.close();
  }
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
});

test('monitors: in a window too low for the layout editor, its rows scroll and Save layout stays in view', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-layouts', 'display-edit-low-window');
  await openMonitors(page);
  // The smallest window the app allows.
  await page.setViewportSize({ width: 960, height: 640 });
  await menu(page, 'Desk', 'layout-edit');
  const dialog = page.getByTestId('edit-dialog');
  await expect(dialog).toBeVisible();
  const title = dialog.getByText('Edit "Desk"');
  const save = dialog.getByTestId('edit-save');
  const rows = dialog.getByTestId('edit-row');

  // The editor is taller than the window: the last monitor's row is not in view yet.
  // The title and the buttons are, and they stay while the rows are scrolled.
  await expect(rows.first()).toBeVisible();
  await expect(rows.last()).not.toBeInViewport();
  await expect(title).toBeInViewport({ ratio: 1 });
  await expect(save).toBeInViewport({ ratio: 1 });
  await shot('top-of-the-rows');
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last()).toBeInViewport({ ratio: 1 });
  await expect(title).toBeInViewport({ ratio: 1 });
  await expect(save).toBeInViewport({ ratio: 1 });
  await shot('last-row');

  // And it saves from there.
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('displays-notice')).toContainText('Saved "Desk"');
});
