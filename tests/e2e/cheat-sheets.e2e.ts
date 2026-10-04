import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/**
 * Cheat sheets on the recorded rig: device pictures, labels, live highlight, notes, the
 * layout editor, print and PDF, kneeboard pages and the check that they are up to date.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
/** Rendered outputs kept as evidence (the real Render port made them). */
const outputs = path.join(repoRoot, 'artifacts', 'screens', 'cheat-sheets-outputs');

/** Controllers as DirectInput lists them in fixtures/rigs/mark-full/input.json. */
const CONTROLLERS = {
  mfdLeft: { index: 7, name: 'WINWING MFD1-L', axes: 1, buttons: 50, hats: 0 },
  stick: {
    index: 9,
    name: 'WINWING Orion Joystick Base 2 + JGRIP-F16',
    axes: 6,
    buttons: 42,
    hats: 1,
  },
  throttle: {
    index: 10,
    name: 'WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R',
    axes: 7,
    buttons: 62,
    hats: 0,
  },
} as const;
type Controller = (typeof CONTROLLERS)[keyof typeof CONTROLLERS];

let clock = 1_000;
function state(
  c: Controller,
  input: { pressed?: number[]; axes?: Record<number, number>; hat?: [number, number] } = {}
) {
  return {
    index: c.index,
    name: c.name,
    axes: Array.from({ length: c.axes }, (_, i) => input.axes?.[i] ?? 0),
    buttons: Array.from({ length: c.buttons }, (_, i) => input.pressed?.includes(i + 1) ?? false),
    hats: Array.from({ length: c.hats }, (): [number, number] => input.hat ?? [0, 0]),
    timestamp: clock++,
  };
}

async function openSheets(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-cheat-sheets').click();
  await expect(page.getByTestId('cheat-sheets-page')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('cheat-sheets-page')).toHaveAttribute('data-live', 'true');
  await expect(page.getByTestId('sheet-view')).toBeVisible();
}

const device = (page: Page, title: string) =>
  page.locator(`[data-testid="sheet-device"][data-title="${title}"]`);
const control = (page: Page, id: string) =>
  page.locator(`[data-testid="sheet-view"] [data-control="${id}"]`);

async function choose(page: Page, testId: string, option: string | RegExp): Promise<void> {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: option }).first().click();
}

function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const pdfPages = (bytes: Buffer): number =>
  (bytes.toString('latin1').match(/\/Type\s*\/Page(?![\w])/g) ?? []).length;

/** A small real PNG (a grey square), standing in for the user's photo of a device. */
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAFklEQVR4nGNsaGhgwAaYsIoOWgkAVXYBjYpOvYQAAAAASUVORK5CYII=',
  'base64'
);

test('cheat sheets: every device of the rig has a picture', async ({ rig }) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-gallery');
  const { page, shot } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await openSheets(page);
  const titles = await page
    .getByTestId('sheet-device')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-title') ?? ''));
  // The twelve controllers of the rig, the ones with the owner's bindings first, named as he named them.
  expect(titles).toHaveLength(12);
  expect(titles.slice(0, 4)).toEqual(['Stick', 'Throttle', 'Pedals', 'R-VPC Panel #1']);
  expect(titles).toEqual(expect.arrayContaining(['Left MFD', 'Centre MFD', 'Right MFD', 'Stick']));
  for (const title of titles) {
    await device(page, title).click();
    await expect(page.getByTestId('sheet-title')).toHaveText(title);
    // Ten devices have a hand-arranged layout; none is a bare grid.
    await expect(page.getByTestId('sheet-layout-source')).toHaveAttribute('data-source', 'builtin');
    await shot(title.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase());
  }
});

test('cheat sheets: labels, a pressed control lights up, notes, search and by action', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-sheet');
  const { page, shot, sendInput } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await openSheets(page);
  await expect(page.getByTestId('sheet-totals')).toContainText('F/A-18C · 12 devices');

  // The stick: what each control does, empty ones visibly empty, modifiers and defaults told apart.
  await device(page, 'Stick').click();
  await expect(control(page, 'button:20')).toContainText('Weapon Release');
  await expect(control(page, 'button:20')).toHaveAttribute('data-kind', 'weapons');
  await expect(control(page, 'button:5')).toContainText('Gun Trigger: SECOND DETENT');
  await expect(control(page, 'hat:1:U')).toContainText('Trimmer: PUSH(DESCEND)');
  await expect(control(page, 'axis:SLIDER1')).toContainText('Wheel Brake');
  await expect(control(page, 'button:1')).toHaveClass(/cs-empty/);
  await expect(control(page, 'button:20')).toHaveClass(/cs-bound/);
  await shot('stick');

  // Press the weapon release on the real stick: its label lights up and says what it does.
  await sendInput([state(CONTROLLERS.stick)]);
  await sendInput([state(CONTROLLERS.stick, { pressed: [20] })]);
  await expect(control(page, 'button:20')).toHaveClass(/cs-on/);
  await expect(page.getByTestId('sheet-last')).toContainText('Stick · Button 20');
  await expect(page.getByTestId('sheet-last')).toContainText('Weapon Release Button');
  await expect(page.getByTestId('detail-title')).toHaveText('Button 20');
  await expect(page.getByTestId('detail-binding')).toContainText('Weapon Release Button');
  await expect(page.getByTestId('detail-binding')).toContainText('your binding');
  await shot('pressed');
  await sendInput([state(CONTROLLERS.stick)]);
  await expect(control(page, 'button:20')).not.toHaveClass(/cs-on/);

  // A note of the user's own on that control.
  await page.getByTestId('note-input').locator('input').fill('hold until the bomb is off');
  await page.getByTestId('note-save').click();
  await expect(page.getByTestId('note-saved')).toBeVisible();
  await expect(control(page, 'button:20')).toContainText('hold until the bomb is off');
  const notes = JSON.parse(
    await fs.readFile(path.join(run.dataRoot, 'cheat-sheets', 'notes.json'), 'utf8')
  ) as { notes: Record<string, Record<string, Record<string, string>>> };
  expect(notes.notes['dcs/FA-18C_hornet']?.['4098:BEA8']?.['button:20']).toBe(
    'hold until the bomb is off'
  );
  await shot('note');

  // The same action elsewhere is pointed out.
  await control(page, 'button:36').click();
  await expect(page.getByTestId('detail-binding')).toContainText('View Center');
  await expect(page.getByTestId('detail-also')).toContainText('Button 19');

  // Pressing a control on another device brings that device forward.
  await sendInput([state(CONTROLLERS.mfdLeft)]);
  await sendInput([state(CONTROLLERS.mfdLeft, { pressed: [42] })]);
  await expect(page.getByTestId('sheet-title')).toHaveText('Left MFD');
  await expect(control(page, 'button:42')).toHaveClass(/cs-on/);
  await expect(control(page, 'button:42')).toContainText('Left MDI PB 6');
  await shot('followed-to-mfd');
  await sendInput([state(CONTROLLERS.mfdLeft)]);

  // Search: which devices have it, and the rest of the sheet steps back.
  await page.getByTestId('sheet-search').locator('input').fill('flare');
  await expect(device(page, 'Throttle')).toContainText('1 match');
  await expect(device(page, 'Left MFD')).toContainText('0 match');
  await device(page, 'Throttle').click();
  await expect(control(page, 'button:24')).toHaveClass(/cs-hit/);
  await expect(control(page, 'button:22')).toHaveClass(/cs-dim/);
  await shot('search');

  // "I want to do X: which control?"
  await page.getByTestId('sheet-view-actions').click();
  const row = page.locator('[data-testid="action-row"]').filter({ hasText: 'Aft(FLARE)' });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('action-place')).toContainText('Throttle');
  await page.getByTestId('sheet-search').locator('input').fill('weapon release');
  const release = page.locator('[data-testid="action-row"][data-action="Weapon Release Button"]');
  await expect(release.getByTestId('action-place')).toContainText('Stick');
  await expect(release.getByTestId('action-place')).toContainText('hold until the bomb is off');
  await shot('by-action');
  await release.getByTestId('action-place').click();
  await expect(page.getByTestId('sheet-title')).toHaveText('Stick');
  await expect(page.getByTestId('detail-title')).toHaveText('Button 20');
});

test('cheat sheets: a control that fires two actions is flagged', async ({ rig }) => {
  const run = await rig.launch('dcs-bindings-conflict', 'cheat-sheets-conflict');
  const { page, shot } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await openSheets(page);
  await expect(page.getByTestId('sheet-conflicts')).toContainText('1 control fires');
  await device(page, 'WinWing MFD1-L').click();
  const knob = control(page, 'axis:SLIDER1');
  await expect(knob).toHaveClass(/cs-conflict/);
  await knob.click();
  await expect(page.getByTestId('detail-binding')).toHaveCount(2);
  await expect(page.getByTestId('detail-conflict')).toBeVisible();
  await shot('conflict');
});

test('cheat sheets: the Huey gets sheets from the game defaults', async ({ rig }) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-huey');
  const { page, shot } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await openSheets(page);
  await choose(page, 'sheet-aircraft', 'DCS · UH-1H');
  await expect(page.getByTestId('sheet-totals')).toContainText('UH-1H');
  await expect(page.getByTestId('sheet-totals')).toContainText('default bindings');
  await device(page, 'Stick').click();
  await expect(control(page, 'axis:X')).toContainText(/Roll|Cyclic/);
  await shot('huey-stick');
});

test('cheat sheets: quick look follows the hands and pops out as a window that stays on top', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-quick');
  const { page, app, shot, sendInput } = run;
  await openSheets(page);
  await device(page, 'Stick').click();
  await page.getByTestId('sheet-quick').click();
  const quick = page.getByTestId('quick-look');
  await expect(quick).toHaveAttribute('data-live', 'true');
  await expect(quick.getByTestId('sheet-view')).toHaveAttribute('data-device', '4098:BEA8');
  // Only what does something is shown.
  await expect(quick.locator('[data-control="button:1"]')).toHaveCount(0);
  await sendInput([state(CONTROLLERS.throttle)]);
  await sendInput([state(CONTROLLERS.throttle, { pressed: [24] })]);
  await expect(quick.getByTestId('sheet-view')).toHaveAttribute('data-device', '4098:BD26');
  await expect(page.getByTestId('quick-last')).toContainText('Dispense Switch - Aft(FLARE)');
  await expect(quick.locator('.cs-ctl[data-control="button:24"]')).toHaveClass(/cs-on/);
  await shot('quick-look');
  await sendInput([state(CONTROLLERS.throttle)]);

  await page.getByTestId('quick-search').locator('input').fill('speed brake');
  await expect(page.getByTestId('quick-answer').first()).toContainText('Speed Brake');
  await expect(page.getByTestId('quick-answer').first()).toContainText('Throttle');
  await shot('quick-answer');

  // Pop out: a second, small window that stays above the others.
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    page.getByTestId('quick-popout').click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  const popped = popup.getByTestId('quick-look');
  await expect(popped).toHaveAttribute('data-popped', 'true');
  await expect(popped).toHaveAttribute('data-live', 'true');
  await expect(popped.getByTestId('sheet-view')).toBeVisible();
  const onTop = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.getTitle() !== '' && w.isAlwaysOnTop())
      .map((w) => w.getBounds().width)
  );
  expect(onTop).toHaveLength(1);
  expect(onTop[0]).toBeLessThan(700);
  // Input reaches the popped-out window as well.
  await sendInput([state(CONTROLLERS.stick)]);
  await sendInput([state(CONTROLLERS.stick, { pressed: [5] })]);
  await expect(popped.getByTestId('sheet-view')).toHaveAttribute('data-device', '4098:BEA8');
  await expect(popped.locator('[data-control="button:5"]')).toHaveClass(/cs-on/);
  await expect(popup.getByTestId('quick-last')).toContainText('Gun Trigger');
  await popup.screenshot({
    path: path.join(repoRoot, 'artifacts', 'screens', 'cheat-sheets-quick', '03-popped-out.png'),
  });
  await popup.close();
});

test('cheat sheets: layout editor - drag, label, group, photo, share, import, discard', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-editor', {
    dialogs: {
      open: [
        ['Documents/throttle-photo.png'],
        ['Documents/community.rrlayout.json'],
        ['Documents/wrong-device.rrlayout.json'],
        ['Documents/template.svg'],
      ],
      save: ['Documents/my-throttle.rrlayout.json'],
    },
  });
  const { page, shot, sendInput } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  const docs = path.join(run.home, 'Documents');
  await fs.mkdir(docs, { recursive: true });
  await fs.writeFile(path.join(docs, 'throttle-photo.png'), PHOTO);
  await openSheets(page);
  await device(page, 'Throttle').click();
  await page.getByTestId('sheet-edit-layout').click();
  const editor = page.getByTestId('layout-editor');
  await expect(editor).toHaveAttribute('data-dirty', 'false');
  await shot('editor');

  // Press a button on the device: its card is selected.
  await sendInput([state(CONTROLLERS.throttle)]);
  await sendInput([state(CONTROLLERS.throttle, { pressed: [16] })]);
  await expect(page.getByTestId('editor-selected')).toHaveText('Button 16');
  await sendInput([state(CONTROLLERS.throttle)]);
  // The sheet does not jump to another device while a layout is being edited.
  await sendInput([state(CONTROLLERS.stick, { pressed: [5] })]);
  await sendInput([state(CONTROLLERS.stick)]);
  await expect(editor).toBeVisible();

  // Give it the name printed on the handle, and drag it up beside the right handle.
  await page.getByTestId('editor-label').locator('input').fill('Cage');
  const card = editor.locator('[data-control="button:16"]');
  const from = (await card.boundingBox())!;
  const canvas = (await page.getByTestId('editor-canvas').boundingBox())!;
  const scale = canvas.width / 1000;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 560 * scale, canvas.y + 300 * scale, { steps: 6 });
  await page.mouse.move(canvas.x + 400 * scale, canvas.y + 420 * scale, { steps: 6 });
  await page.mouse.up();
  await expect(editor).toHaveAttribute('data-dirty', 'true');
  const to = (await card.boundingBox())!;
  expect(to.y).toBeLessThan(from.y - 200 * scale);
  await page.getByTestId('editor-pin').click();
  await expect(page.getByTestId('editor-pin')).toHaveText('Remove pointer');

  // A group frame and a photo behind.
  await page.getByTestId('editor-add-group').click();
  await page.getByTestId('editor-label').locator('input').fill('My group');
  await page.getByTestId('editor-background').click();
  await expect(page.getByTestId('editor-message')).toContainText('Picture added');
  await expect(editor.locator('svg image')).toHaveCount(1);
  await shot('editor-arranged');

  // Share it as a file, then save it for this device model.
  await page.getByTestId('editor-export').click();
  await expect(page.getByTestId('editor-message')).toContainText('my-throttle.rrlayout.json');
  const shared = JSON.parse(
    await fs.readFile(path.join(docs, 'my-throttle.rrlayout.json'), 'utf8')
  );
  expect(shared.format).toBe('rigready-device-layout');
  expect(shared.match).toEqual({ vendorId: '4098', productIds: ['BD26'] });
  expect(shared.groups.map((g: { label: string }) => g.label)).toContain('My group');
  expect(shared.background.image).toMatch(/^data:image\/png;base64,/);
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('sheet-layout-source')).toHaveAttribute('data-source', 'user');
  await expect(control(page, 'button:16')).toContainText('Cage');
  const saved = path.join(run.dataRoot, 'cheat-sheets', 'layouts', '4098-BD26.rrlayout.json');
  expect(JSON.parse(await fs.readFile(saved, 'utf8')).name).toContain('throttle');
  await shot('own-layout');

  // The layout survives a restart.
  const again = await run.restart();
  const page2 = again.page;
  await page2.setViewportSize({ width: 1500, height: 1250 });
  await openSheets(page2);
  await device(page2, 'Throttle').click();
  await expect(page2.getByTestId('sheet-layout-source')).toHaveAttribute('data-source', 'user');
  await expect(control(page2, 'button:16')).toContainText('Cage');

  // Import a community layout: the shared file with one more label, as someone else would send it.
  shared.name = 'Community throttle layout';
  shared.controls.find((c: { input?: string }) => c.input === 'button:16').label = 'CAGE/UNCAGE';
  await fs.writeFile(path.join(docs, 'community.rrlayout.json'), JSON.stringify(shared));
  await fs.writeFile(
    path.join(docs, 'wrong-device.rrlayout.json'),
    JSON.stringify({ ...shared, match: { vendorId: '044F', productIds: ['B68F'] } })
  );
  await fs.writeFile(
    path.join(docs, 'template.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#ddd"/>` +
      `<g transform="translate(20,20)"><text x="10" y="30" font-size="10">BUTTON_1</text>` +
      `<text x="200" y="30" font-size="10">BUTTON_2</text><text x="10" y="120" font-size="10">AXIS_X</text>` +
      `<text x="200" y="120" font-size="10">POV_1_U</text></g></svg>`
  );
  // (the first open() answer, the photo, was used before the restart; a restart starts the answers again)
  await page2.getByTestId('sheet-edit-layout').click();
  await page2.getByTestId('editor-background').click();
  await page2.getByTestId('editor-import').click();
  await expect(page2.getByTestId('editor-message')).toContainText(
    'Imported community.rrlayout.json'
  );
  await expect(
    page2.getByTestId('layout-editor').locator('[data-control="button:16"]')
  ).toContainText('CAGE/UNCAGE');
  // A layout for another device is refused, with the reason.
  await page2.getByTestId('editor-import').click();
  await expect(page2.getByTestId('editor-error')).toContainText('layout for another device');
  // A Joystick Diagrams template the user has: its placeholders become controls on its drawing.
  await page2.getByTestId('editor-import').click();
  await expect(page2.getByTestId('editor-message')).toContainText(
    'Converted template.svg: 4 controls placed'
  );
  await expect(
    page2.getByTestId('layout-editor').locator('[data-control="button:2"]')
  ).toBeVisible();
  await again.shot('converted-template');
  await page2.getByTestId('editor-cancel').click();

  // Discard: the shipped layout is back.
  await page2.getByTestId('sheet-edit-layout').click();
  await page2.getByTestId('editor-reset').click();
  await expect(page2.getByTestId('sheet-layout-source')).toHaveAttribute('data-source', 'builtin');
  await expect(fs.access(saved)).rejects.toThrow();
});

test('cheat sheets: print layout and PDF, one page per device plus a summary', async ({ rig }) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-print', {
    dialogs: { save: ['Documents/hornet.pdf', 'Documents/hornet-letter.pdf'] },
  });
  const { page, shot } = run;
  await openSheets(page);
  await page.getByTestId('sheet-print').click();
  const dialog = page.getByTestId('print-dialog');
  await expect(dialog).toBeVisible();
  // Every device with something bound is ticked; the bare ICP is not.
  await expect(dialog.getByTestId('print-device')).toHaveCount(12);
  await expect(dialog.locator('[data-testid="print-device"] input:checked')).toHaveCount(11);
  await shot('dialog');
  await page.getByTestId('print-save').click();
  await expect(page.getByTestId('print-saved')).toHaveAttribute('data-pages', '12');
  const pdf = await fs.readFile(path.join(run.home, 'Documents', 'hornet.pdf'));
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // One page per chosen device and the summary page.
  expect(pdfPages(pdf)).toBe(12);
  await fs.mkdir(outputs, { recursive: true });
  await fs.writeFile(path.join(outputs, 'fa-18c-cheat-sheet-a4.pdf'), pdf);

  // US Letter, three devices, no summary: three pages.
  for (const box of await dialog.locator('[data-testid="print-device"] input').all()) {
    await box.uncheck();
  }
  for (const key of ['4098:BEA8', '4098:BD26', '4098:BEE1']) {
    await dialog.locator(`[data-testid="print-device"][data-key="${key}"] input`).check();
  }
  await page.getByTestId('print-summary').locator('input').uncheck();
  await page.getByTestId('print-letter').locator('input').check();
  await page.getByTestId('print-save').click();
  await expect(page.getByTestId('print-saved')).toHaveAttribute('data-pages', '3');
  expect(pdfPages(await fs.readFile(path.join(run.home, 'Documents', 'hornet-letter.pdf')))).toBe(
    3
  );

  // Print: the same pages go to the system's print dialog. Here the dialog is replaced by
  // a flag, and the printout is looked at through the print style sheet.
  await page.evaluate(() => {
    (globalThis as unknown as { printed: number }).printed = 0;
    (globalThis as unknown as { print: () => void }).print = () => {
      (globalThis as unknown as { printed: number }).printed++;
    };
  });
  await page.getByTestId('print-print').click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as unknown as { printed: number }).printed))
    .toBe(1);
  await expect(page.locator('#cs-print-root')).toHaveAttribute('data-pages', '3');
  await expect(page.locator('#cs-print-root .page')).toHaveCount(3);
  await expect(page.locator('#cs-print-root .page').first().locator('.ac')).toHaveText('F/A-18C');
  await expect(page.locator('#cs-print-root .page').first().locator('.dev')).toContainText('Stick');
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 794, height: 1123 });
  await expect(page.locator('#cs-print-root')).toBeVisible();
  await expect(page.getByTestId('configure-nav')).toBeHidden();
  await shot('printout');
});

test('cheat sheets: kneeboard pages - preview, export, the user’s own pages untouched, update and remove', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-kneeboard');
  const { page, shot } = run;
  const folder = path.join(run.home, 'Saved Games', 'DCS', 'Kneeboard', 'FA-18C_hornet');
  // The user's own pages: one with a name of their own, one named exactly like a page RigReady writes.
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'my-own-notes.png'), 'mine');
  await fs.writeFile(path.join(folder, 'RigReady - 01 - Key actions (day).png'), 'also mine');

  await openSheets(page);
  await device(page, 'Stick').click();
  await page.getByTestId('sheet-kneeboard').click();
  const dialog = page.getByTestId('kneeboard-dialog');
  await expect(page.getByTestId('kneeboard-status')).toHaveAttribute('data-state', 'none');
  await expect(page.getByTestId('kneeboard-preview')).toHaveAttribute('data-busy', 'false');
  await shot('preview-day');
  await page.getByTestId('kneeboard-preview-night').click();
  await expect(page.getByTestId('kneeboard-preview')).toHaveAttribute('data-style', 'night');
  await expect(page.getByTestId('kneeboard-preview')).toHaveAttribute('data-busy', 'false');
  await shot('preview-night');

  // Export both styles.
  await page.getByTestId('kneeboard-style-both').click();
  await page.getByTestId('kneeboard-export').click();
  await expect(page.getByTestId('kneeboard-export-confirm')).toContainText('created');
  await page.getByTestId('kneeboard-export-go').click();
  await expect(page.getByTestId('kneeboard-done')).toHaveAttribute('data-written', '24');
  await expect(page.getByTestId('kneeboard-done')).toContainText('Left alone');
  await expect(page.getByTestId('kneeboard-status')).toHaveAttribute('data-state', 'current');
  await shot('exported');

  const names = (await fs.readdir(folder)).sort();
  // 11 devices + the summary, in two styles, plus the user's two files.
  expect(names).toHaveLength(26);
  // Lower-case extension (DCS ignores .PNG), zero-padded so DCS shows them in order.
  expect(names.every((n) => n.endsWith('.png'))).toBe(true);
  expect(names).toContain('RigReady - 01 - Key actions (day) (2).png');
  expect(names).toContain('RigReady - N01 - Key actions (night).png');
  expect(names.filter((n) => / - Stick \((day|night)\)\.png$/.test(n))).toHaveLength(2);
  // The user's own pages are as they were.
  expect(await fs.readFile(path.join(folder, 'my-own-notes.png'), 'utf8')).toBe('mine');
  expect(
    await fs.readFile(path.join(folder, 'RigReady - 01 - Key actions (day).png'), 'utf8')
  ).toBe('also mine');
  // Real PNGs at kneeboard size.
  const stickDay = names.find((n) => n.endsWith('- Stick (day).png'))!;
  const stickNight = names.find((n) => n.endsWith('- Stick (night).png'))!;
  for (const name of names) {
    if (name === 'my-own-notes.png' || name === 'RigReady - 01 - Key actions (day).png') continue;
    expect(pngSize(await fs.readFile(path.join(folder, name)))).toEqual({
      width: 768,
      height: 1024,
    });
  }
  await fs.mkdir(outputs, { recursive: true });
  const keep: [string, string][] = [
    [stickDay, 'kneeboard-stick-day.png'],
    [stickNight, 'kneeboard-stick-night.png'],
    ['RigReady - 01 - Key actions (day) (2).png', 'kneeboard-key-actions-day.png'],
    ['RigReady - N01 - Key actions (night).png', 'kneeboard-key-actions-night.png'],
    [names.find((n) => n.endsWith('- Left MFD (day).png'))!, 'kneeboard-left-mfd-day.png'],
    [names.find((n) => n.endsWith('- Left MFD (night).png'))!, 'kneeboard-left-mfd-night.png'],
    [
      names.find((n) => n.includes('STARTUP') && n.endsWith('(day).png'))!,
      'kneeboard-startup-panel-day.png',
    ],
    [
      names.find((n) => n.includes('UFC1') && n.endsWith('(night).png'))!,
      'kneeboard-ufc-night.png',
    ],
    [names.find((n) => n.endsWith('- Throttle (day).png'))!, 'kneeboard-throttle-day.png'],
  ];
  for (const [from, to] of keep) await fs.copyFile(path.join(folder, from), path.join(outputs, to));

  // The manifest lists what RigReady wrote.
  const manifest = JSON.parse(
    await fs.readFile(path.join(run.dataRoot, 'cheat-sheets', 'kneeboard.json'), 'utf8')
  );
  expect(manifest.exports['FA-18C_hornet'].pages).toHaveLength(24);

  // Night only, stick and throttle: the old pages go, the user's stay.
  await page.getByTestId('kneeboard-style-night').click();
  for (const box of await dialog.locator('[data-testid="kneeboard-device"] input').all()) {
    await box.uncheck();
  }
  for (const key of ['4098:BEA8', '4098:BD26']) {
    await dialog.locator(`[data-testid="kneeboard-device"][data-key="${key}"] input`).check();
  }
  await page.getByTestId('kneeboard-export').click();
  await expect(page.getByTestId('kneeboard-export-confirm')).toContainText('created');
  await page.getByTestId('kneeboard-export-go').click();
  await expect(page.getByTestId('kneeboard-done')).toHaveAttribute('data-written', '3');
  await expect(page.getByTestId('kneeboard-done')).toContainText('removed 24 old ones');
  const after = (await fs.readdir(folder)).sort();
  expect(after).toEqual([
    'RigReady - 01 - Key actions (day).png',
    'RigReady - 01 - Key actions (night).png',
    'RigReady - 02 - Stick (night).png',
    'RigReady - 03 - Throttle (night).png',
    'my-own-notes.png',
  ]);
  expect(
    pngSize(await fs.readFile(path.join(folder, 'RigReady - 02 - Stick (night).png')))
  ).toEqual({
    width: 768,
    height: 1024,
  });
  await page.getByTestId('kneeboard-close').click();

  // Every write is on the Safety page as one action that can be undone.
  await page.getByTestId('nav-safety').click();
  const change = page
    .locator('[data-testid="change-group"]')
    .filter({ hasText: 'Export 3 kneeboard pages for F/A-18C' });
  await expect(change).toHaveCount(1);
  await expect(change).toContainText('27 files');
  await shot('safety');

  // Remove RigReady's pages: only its own go.
  await page.getByTestId('nav-cheat-sheets').click();
  await expect(page.getByTestId('sheet-view')).toBeVisible();
  await page.getByTestId('sheet-kneeboard').click();
  await expect(page.getByTestId('kneeboard-status')).toHaveAttribute('data-state', 'current');
  await page.getByTestId('kneeboard-remove').click();
  await expect(page.getByTestId('kneeboard-remove-confirm')).toContainText('deleted');
  await page.getByTestId('kneeboard-remove-go').click();
  await expect(page.getByTestId('kneeboard-removed')).toContainText('Removed 3 pages');
  await expect(page.getByTestId('kneeboard-status')).toHaveAttribute('data-state', 'none');
  expect((await fs.readdir(folder)).sort()).toEqual([
    'RigReady - 01 - Key actions (day).png',
    'my-own-notes.png',
  ]);
});

test('cheat sheets: the Fly check notices stale kneeboard pages and its fix writes them again', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-kneeboard', 'cheat-sheets-check');
  const { page, shot } = run;
  const folder = path.join(run.home, 'Saved Games', 'DCS', 'Kneeboard', 'FA-18C_hornet');
  const row = checkRow(page, 'Kneeboard cheat sheet is up to date (F/A-18C)');
  // Optional: nothing exported yet is a warning, never Not ready.
  await expect(row).toHaveAttribute('data-status', 'warn');
  await expect(row).toContainText('No kneeboard pages exported for F/A-18C');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
  await expect(row.getByTestId('check-fix')).toContainText(
    'Write the cheat sheet kneeboard pages for F/A-18C again'
  );
  await shot('nothing-exported');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-activity')).toContainText('Wrote 12 kneeboard pages');
  expect(await fs.readdir(folder)).toHaveLength(12);
  await shot('written');

  // A note changes what the sheet says: the pages are out of date until they are written again.
  await openSheets(page);
  await device(page, 'Stick').click();
  await control(page, 'button:20').click();
  await page.getByTestId('note-input').locator('input').fill('hold');
  await page.getByTestId('note-save').click();
  await expect(page.getByTestId('note-saved')).toBeVisible();
  const stickPage = (await fs.readdir(folder)).find((n) => n.endsWith('- Stick.png'))!;
  const before = await fs.readFile(path.join(folder, stickPage));
  await page.getByTestId('mode-fly').click();
  await expect(row).toHaveAttribute('data-status', 'warn');
  await expect(row).toContainText('no longer match the bindings');
  await shot('stale');
  await row.getByTestId('check-fix').click();
  await expect(page.getByTestId('group-files')).toContainText('1 of 1 OK');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  const after = await fs.readFile(path.join(folder, stickPage));
  expect(after.equals(before)).toBe(false);
  await shot('fixed');
});
