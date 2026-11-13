import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { checkRow, expect, test, type RunningApp } from './harness';
import { expectSaveBarPinned } from './saveBar';

/**
 * Cheat sheets on the recorded rig: device pictures, labels in plain language, text that
 * fits its card, live highlight, notes, the layout editor, print and PDF, kneeboard pages
 * and the check that they are up to date, a sheet that follows the bindings page, and the
 * racing games' sheets on the racing rig.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
/** Rendered outputs kept as evidence (the real Render port made them). */
const outputs = path.join(repoRoot, 'artifacts', 'screens', 'cheat-sheets-outputs');

/** Controllers as DirectInput lists them in fixtures/rigs/mark-full/input.json. */
const CONTROLLERS = {
  wheel: { index: 0, name: 'FANATEC Podium Wheel Base DD2', axes: 8, buttons: 108, hats: 1 },
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

/**
 * How the label text of the sheet on screen fits, asked of the browser itself, in the font
 * this PC draws it with. On a card: text taller than its box would be cut off by it, and
 * a card the page had to make smaller was measured wrongly before. On a drawing: a line
 * of text that reaches outside its label block; a label shortened ends with an ellipsis.
 */
async function labelFit(
  page: Page
): Promise<{ labels: number; clipped: string[]; refitted: string[]; shortened: string[] }> {
  return page
    .getByTestId('sheet-view')
    .first()
    .evaluate((root) => {
      // (The specs are compiled without the browser's own types.)
      interface Box {
        x: number;
        y: number;
        width: number;
        height: number;
      }
      interface Node {
        scrollHeight: number;
        clientHeight: number;
        textContent: string | null;
        dataset: Record<string, string | undefined>;
        classList: { contains(name: string): boolean };
        getBBox(): Box;
        querySelector(selector: string): Node | null;
        querySelectorAll(selector: string): Iterable<Node>;
      }
      const view = root as unknown as Node;
      const text = (el: Node): string => el.textContent ?? '';
      if (view.querySelector('svg')?.classList.contains('cs-v2')) {
        const labels: Node[] = [];
        const clipped: string[] = [];
        for (const block of view.querySelectorAll('.cs-callout')) {
          const frame = block.querySelector('.cs-block')!.getBBox();
          for (const line of block.querySelectorAll('text.cs-row-text, text.cs-bhead')) {
            if (line.classList.contains('cs-row-text')) labels.push(line);
            const b = line.getBBox();
            const inside =
              b.x >= frame.x - 1 &&
              b.y >= frame.y - 1 &&
              b.x + b.width <= frame.x + frame.width + 1 &&
              b.y + b.height <= frame.y + frame.height + 1;
            if (!inside) clipped.push(text(line));
          }
        }
        return {
          labels: labels.length,
          clipped,
          refitted: [],
          shortened: labels.map(text).filter((t) => t.endsWith('…')),
        };
      }
      const cards = [...view.querySelectorAll('.cs-t')];
      return {
        labels: cards.length,
        clipped: cards.filter((el) => el.scrollHeight > el.clientHeight + 0.5).map(text),
        refitted: cards.filter((el) => el.dataset['fitted'] === 'true').map(text),
        shortened: cards.filter((el) => el.dataset['shortened'] === 'true').map(text),
      };
    });
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
    // None is a bare grid. Every WinWing controller of the rig is drawn: the stick, the
    // throttle, the three MFDs and the four panels, each a picture of the device with a
    // label block per physical control. The others keep their hand-arranged cards.
    await expect(page.getByTestId('sheet-layout-source')).toHaveAttribute('data-source', 'builtin');
    const drawn =
      ['Stick', 'Throttle', 'Left MFD', 'Centre MFD', 'Right MFD'].includes(title) ||
      /UFC1|ICP|STARTUP PANEL|TAKEOFF PANEL/i.test(title);
    await expect(page.getByTestId('sheet-layout-source')).toHaveAttribute(
      'data-picture',
      drawn ? 'drawing' : 'cards'
    );
    // Every label of the owner's own bindings is whole, and fits its card or block.
    const fit = await labelFit(page);
    expect(fit.labels, title).toBeGreaterThan(0);
    expect(fit, title).toMatchObject({ clipped: [], refitted: [], shortened: [] });
    await shot(title.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase());
  }
  // The MFD frame: each key has one label block, above, below or beside it, with a leader
  // to the key, named as printed on the bezel with the number the frame reports.
  await device(page, 'Left MFD').click();
  await expect(page.getByTestId('sheet-title')).toHaveText('Left MFD');
  const picture = page.locator('[data-testid="sheet-view"] svg');
  // No bare number is printed on the drawing; the numbers that belong to no key are
  // listed under it.
  await expect(picture.locator('text:not(.cs-row-text)').filter({ hasText: /^\d+$/ })).toHaveCount(
    0
  );
  const osb1 = picture.locator('[data-anchor="osb-1"]');
  await expect(osb1).toHaveCount(1);
  await expect(osb1).toHaveAttribute('data-side', 'top');
  await expect(osb1.locator('.cs-bhead')).toHaveText('OSB 1 · 42');
  await expect(osb1.locator('polyline.cs-lead2')).toHaveCount(1);
  await expect(control(page, 'button:42')).toContainText('Left MDI PB 6');
  // The pedals have no drawing yet: their shipped layout of cards, as before.
  await device(page, 'Pedals').click();
  await expect(page.getByTestId('sheet-layout-source')).toHaveText('Shipped layout');
  await expect(picture.locator('.cs-t').first()).toBeVisible();
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
  // Labels say it the way the binding guide does.
  await expect(control(page, 'button:20')).toContainText('Pickle: release weapon');
  await expect(control(page, 'button:20')).toHaveAttribute('data-kind', 'weapons');
  await expect(control(page, 'button:5')).toContainText('Trigger: fire');
  await expect(control(page, 'hat:1:U')).toContainText('Trim nose down');
  await expect(control(page, 'axis:SLIDER1')).toContainText('Both brakes, one axis');
  // The trigger's first detent is on the drawing but does nothing in the Hornet.
  await expect(control(page, 'button:4')).toHaveClass(/cs-empty/);
  await expect(control(page, 'button:20')).toHaveClass(/cs-bound/);
  await expect(page.getByTestId('sheet-layout-source')).toHaveText('RigReady drawing');
  await expect(page.getByTestId('sheet-edit-layout')).toContainText('Edit drawing');
  await shot('stick');

  // Press the weapon release on the real stick: its label lights up and says what it does.
  await sendInput([state(CONTROLLERS.stick)]);
  await sendInput([state(CONTROLLERS.stick, { pressed: [20] })]);
  await expect(control(page, 'button:20')).toHaveClass(/cs-on/);
  await expect(page.getByTestId('sheet-last')).toContainText('Stick · Button 20');
  await expect(page.getByTestId('sheet-last')).toContainText('Pickle: release weapon');
  await expect(page.getByTestId('detail-title')).toHaveText('Button 20');
  // The plain name first, and what DCS itself calls it beside it.
  await expect(page.getByTestId('detail-binding')).toContainText('Pickle: release weapon');
  await expect(page.getByTestId('detail-game-name')).toHaveText(
    'DCS World calls it: Weapon Release Button'
  );
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
  await expect(page.getByTestId('detail-binding')).toContainText('Centre the view');
  await expect(page.getByTestId('detail-game-name')).toContainText('View Center');
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
  await expect(release.locator('.rr-row-title')).toHaveText('Pickle: release weapon');
  await expect(release.getByTestId('action-game-name')).toHaveText(
    'DCS World calls it: Weapon Release Button'
  );
  await expect(release.getByTestId('action-place')).toContainText('Stick');
  await expect(release.getByTestId('action-place')).toContainText('hold until the bomb is off');
  await shot('by-action');
  await release.getByTestId('action-place').click();
  await expect(page.getByTestId('sheet-title')).toHaveText('Stick');
  await expect(page.getByTestId('detail-title')).toHaveText('Button 20');
});

test('cheat sheets: a press never lights nothing - a button no control is known to press still shows, and lights up', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-free-buttons');
  const { page, shot, sendInput } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await openSheets(page);

  // The throttle reports buttons 45 to 49. No control of the drawing is known to press
  // them and nothing is bound to them: with "Unbound controls" on they still have a place.
  await device(page, 'Throttle').click();
  await expect(page.getByTestId('sheet-layout-source')).toHaveText('RigReady drawing');
  const picture = page.locator('[data-testid="sheet-view"] svg');
  await expect(picture).toContainText('MORE CONTROLS · not on the drawing');
  for (const n of [45, 46, 47, 48, 49]) {
    await expect(control(page, `button:${n}`)).toHaveCount(1);
    await expect(control(page, `button:${n}`)).toHaveClass(/cs-empty/);
  }
  // A button the drawing does place is not repeated down there.
  await expect(control(page, 'button:24')).toHaveCount(1);
  await control(page, 'button:45').scrollIntoViewIfNeeded();
  await shot('throttle-more-controls');

  // Press one on the real throttle: it lights up, and the page says which button it was.
  await sendInput([state(CONTROLLERS.throttle)]);
  await sendInput([state(CONTROLLERS.throttle, { pressed: [45] })]);
  await expect(control(page, 'button:45')).toHaveClass(/cs-on/);
  await expect(page.getByTestId('sheet-last')).toContainText('Throttle · Button 45');
  await expect(page.getByTestId('sheet-last')).toContainText('nothing bound');
  await shot('throttle-button-45-pressed');
  await sendInput([state(CONTROLLERS.throttle)]);
  await expect(control(page, 'button:45')).not.toHaveClass(/cs-on/);

  // Every button the device reports has a place on the sheet.
  const ids = await picture
    .locator('.cs-ctl[data-control^="button:"]')
    .evaluateAll((all) => all.map((el) => el.getAttribute('data-control') ?? ''));
  const numbers = [...new Set(ids)].map((id) => Number(id.slice('button:'.length)));
  expect(numbers.sort((a, b) => a - b)).toEqual(
    Array.from({ length: CONTROLLERS.throttle.buttons }, (_, i) => i + 1)
  );

  // With "Unbound controls" off the free buttons step back with the other empty ones.
  await page.getByTestId('sheet-show-empty').locator('input').click();
  await expect(control(page, 'button:45')).toHaveCount(0);
  await expect(picture).not.toContainText('MORE CONTROLS');
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
  await expect(page.getByTestId('quick-last')).toContainText('Dispense flares');
  await expect(quick.locator('.cs-ctl[data-control="button:24"]')).toHaveClass(/cs-on/);
  await shot('quick-look');
  await sendInput([state(CONTROLLERS.throttle)]);

  await page.getByTestId('quick-search').locator('input').fill('speed brake');
  await expect(page.getByTestId('quick-answer').first()).toContainText('Speed brake');
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
  await expect(popup.getByTestId('quick-last')).toContainText('Trigger: fire');
  await popup.screenshot({
    path: path.join(repoRoot, 'artifacts', 'screens', 'cheat-sheets-quick', '03-popped-out.png'),
  });
  await popup.close();
});

test('cheat sheets: the pop-out opens where it was left and as large as it was, also after a restart', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-popout-place');
  const placesFile = path.join(run.dataRoot, 'panels.json');
  // (Whole numbers at every display scaling Windows offers.)
  const place = { x: 160, y: 120, width: 720, height: 800 };

  const popOut = async (from: RunningApp): Promise<Page> => {
    const [popup] = await Promise.all([
      from.app.waitForEvent('window'),
      from.page.getByTestId('quick-popout').click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.getByTestId('quick-look')).toHaveAttribute('data-ready', 'true');
    await expect(popup.getByTestId('sheet-view')).toBeVisible();
    return popup;
  };
  const quickLook = async (from: RunningApp): Promise<void> => {
    await openSheets(from.page);
    await device(from.page, 'Stick').click();
    await from.page.getByTestId('sheet-quick').click();
    await expect(from.page.getByTestId('quick-look')).toHaveAttribute('data-live', 'true');
  };
  /** The pop-out is the one window that stays on top. */
  const bounds = (from: RunningApp) =>
    from.app.evaluate(({ BrowserWindow }) => {
      const panel = BrowserWindow.getAllWindows().find((w) => w.isAlwaysOnTop());
      return panel ? panel.getBounds() : null;
    });

  // The first time, it opens at the size the cheat sheets give it.
  await quickLook(run);
  const first = await popOut(run);
  expect(await bounds(run)).toMatchObject({ width: 560, height: 640 });
  // The user drags it to where it is wanted and makes it larger.
  await run.app.evaluate(({ BrowserWindow }, to) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.isAlwaysOnTop())
      ?.setBounds(to);
  }, place);
  await expect
    .poll(async () => {
      // No file yet: nothing was stored so far.
      const text = await fs.readFile(placesFile, 'utf8').catch(() => '{}');
      return (JSON.parse(text) as { panels?: Record<string, unknown> }).panels?.[
        'cheat-sheets-quick'
      ];
    })
    .toEqual(place);
  await first.close();
  await expect.poll(() => bounds(run)).toBeNull();

  // Popped out again: where it was left, as large as it was.
  const second = await popOut(run);
  expect(await bounds(run)).toEqual(place);
  await second.close();

  // And the next time RigReady is started.
  const again = await run.restart();
  await quickLook(again);
  const third = await popOut(again);
  expect(await bounds(again)).toEqual(place);
  await third.evaluate('document.fonts.ready');
  await third.screenshot({
    path: path.join(
      repoRoot,
      'artifacts',
      'screens',
      'cheat-sheets-popout-place',
      '01-where-it-was-left.png'
    ),
  });
  await third.close();
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
  // The throttle has a drawing; arranging cards by hand, as in 1.x, is one click away.
  await expect(page.getByTestId('editor-mode')).toHaveAttribute('data-mode', 'drawing');
  await page.getByTestId('editor-use-cards').click();
  await expect(page.getByTestId('editor-mode')).toHaveAttribute('data-mode', 'cards');
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
  await expect(page.getByTestId('sheet-layout-source')).toHaveAttribute('data-picture', 'cards');
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
  // What was imported is not saved: Cancel asks before it drops it.
  await page2.getByTestId('save-bar-leave-go').click();
  await expect(page2.getByTestId('layout-editor')).toHaveCount(0);

  // Discard: the shipped drawing is back.
  await page2.getByTestId('sheet-edit-layout').click();
  await page2.getByTestId('editor-reset').click();
  await expect(page2.getByTestId('sheet-layout-source')).toHaveAttribute('data-source', 'builtin');
  await expect(page2.getByTestId('sheet-layout-source')).toHaveAttribute('data-picture', 'drawing');
  await expect(fs.access(saved)).rejects.toThrow();
});

test('cheat sheets: drawing editor - move a control, its side and name, a photo, a drawing of my own', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-drawing-editor', {
    dialogs: { open: [['Documents/stick-photo.png'], ['Documents/pedals-photo.png']] },
  });
  const { page, shot, sendInput } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  const docs = path.join(run.home, 'Documents');
  await fs.mkdir(docs, { recursive: true });
  await fs.writeFile(path.join(docs, 'stick-photo.png'), PHOTO);
  await fs.writeFile(path.join(docs, 'pedals-photo.png'), PHOTO);
  await openSheets(page);
  await device(page, 'Stick').click();
  await page.getByTestId('sheet-edit-layout').click();
  const editor = page.getByTestId('layout-editor');
  await expect(page.getByTestId('editor-mode')).toHaveAttribute('data-mode', 'drawing');
  await expect(editor).toHaveAttribute('data-dirty', 'false');

  // Press the weapon release on the stick: its control is picked, and renamed.
  await sendInput([state(CONTROLLERS.stick)]);
  await sendInput([state(CONTROLLERS.stick, { pressed: [20] })]);
  const name = page.getByTestId('editor-control-name').locator('input');
  await expect(name).toHaveValue('Red button');
  await expect(page.getByTestId('editor-control-inputs')).toHaveText('Button 20');
  await sendInput([state(CONTROLLERS.stick)]);
  await name.fill('Weapon release');
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas.locator('[data-anchor="red-button"] .cs-bhead')).toHaveText(
    'Weapon release · 20'
  );

  // The trim hat: drag its dot down the grip, and put its label on the left.
  await canvas.locator('[data-anchor="trim"] .cs-bhead').click();
  await expect(name).toHaveValue('TRIM hat');
  const handle = canvas.locator('[data-anchor-handle="trim"]');
  const from = (await handle.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x - 40, from.y + 60, { steps: 4 });
  await page.mouse.move(from.x - 60, from.y + 120, { steps: 4 });
  await page.mouse.up();
  await expect(editor).toHaveAttribute('data-dirty', 'true');
  const to = (await handle.boundingBox())!;
  expect(to.y).toBeGreaterThan(from.y + 80);
  await page.getByTestId('editor-side-left').click();
  await expect(canvas.locator('[data-anchor="trim"]')).toHaveAttribute('data-side', 'left');
  await shot('drawing-editor');

  // A photo of the stick in place of the drawing.
  await page.getByTestId('editor-background').click();
  await expect(page.getByTestId('editor-message')).toContainText(
    'Picture added in place of the drawing'
  );
  await expect(canvas.locator('svg image')).toHaveCount(1);
  await expect(canvas.locator('.cs-drawing .cs-s-body')).toHaveCount(0);
  await page.getByTestId('editor-background-remove').click();

  // Saved for the stick: the sheet shows the drawing with the owner's changes.
  await page.getByTestId('editor-save').click();
  const source = page.getByTestId('sheet-layout-source');
  await expect(source).toHaveAttribute('data-source', 'user');
  await expect(source).toHaveAttribute('data-picture', 'drawing');
  await expect(source).toHaveText('RigReady drawing, your changes');
  const sheet = page.getByTestId('sheet-view');
  await expect(sheet.locator('[data-anchor="trim"]')).toHaveAttribute('data-side', 'left');
  await expect(sheet.locator('[data-anchor="red-button"] .cs-bhead')).toHaveText(
    'Weapon release · 20'
  );
  const saved = JSON.parse(
    await fs.readFile(
      path.join(run.dataRoot, 'cheat-sheets', 'layouts', '4098-BEA8.rrlayout.json'),
      'utf8'
    )
  ) as { drawing: { anchors: Record<string, unknown>; sides: Record<string, string> } };
  expect(Object.keys(saved.drawing.anchors)).toEqual(['trim']);
  expect(saved.drawing.sides).toEqual({ trim: 'left' });
  await shot('own-drawing');

  // The pedals have no drawing: make one from a photo. The rudder is picked from the list
  // of what is not placed yet, and its place is clicked on the photo.
  // (tests/e2e/cheat-sheets-photo.e2e.ts plays the whole photo route.)
  await device(page, 'Pedals').click();
  await page.getByTestId('sheet-edit-layout').click();
  await expect(page.getByTestId('editor-mode')).toHaveAttribute('data-mode', 'cards');
  await page.getByTestId('editor-photo-drawing').click();
  await expect(page.getByTestId('editor-mode')).toHaveAttribute('data-mode', 'photos');
  const photo = page.getByTestId('photo-canvas');
  await expect(photo.locator('image')).toHaveCount(1);
  await expect(page.getByTestId('editor-save')).toBeDisabled();
  await page.locator('[data-testid="photo-chip"][data-control="axis:Z"]').click();
  await expect(page.getByTestId('photo-ask')).toHaveText('Z axis: click where it is on the photo.');
  await photo.click({ position: { x: 120, y: 160 } });
  await expect(page.locator('[data-testid="photo-dot"][data-dot="axis-Z"]')).toBeVisible();
  await shot('photo-drawing');
  await page.getByTestId('editor-save').click();
  await expect(source).toHaveText('Your photos, 1 of 3 controls placed');
  await expect(sheet.locator('svg image')).toHaveCount(1);
  await expect(control(page, 'axis:Z').first()).toBeVisible();

  // Discard on the stick: RigReady's drawing as it ships.
  await device(page, 'Stick').click();
  await page.getByTestId('sheet-edit-layout').click();
  await page.getByTestId('editor-reset').click();
  await expect(source).toHaveText('RigReady drawing');
  await expect(sheet.locator('[data-anchor="trim"]')).toHaveAttribute('data-side', 'right');
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
  await expect(dialog).toContainText(
    'One page per device with the aircraft or car and the device name on top'
  );
  await shot('dialog');
  await page.getByTestId('print-save').click();
  // One page per chosen device (11) and the summary, which takes two pages here: see the
  // measuring at the end of this test.
  await expect(page.getByTestId('print-saved')).toHaveAttribute('data-pages', '13');
  const pdf = await fs.readFile(path.join(run.home, 'Documents', 'hornet.pdf'));
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdfPages(pdf)).toBe(13);
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
  const screen = await page.evaluate(() => {
    const view = globalThis as unknown as { innerWidth: number; innerHeight: number };
    return { width: view.innerWidth, height: view.innerHeight };
  });
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 794, height: 1123 });
  await expect(page.locator('#cs-print-root')).toBeVisible();
  await expect(page.getByTestId('configure-nav')).toBeHidden();
  await shot('printout');

  // The summary on A4 paper. This aircraft has more important actions than one page holds
  // in two columns (the panels' long names take two lines a row). The page used to cut the
  // list off at its bottom edge without saying so; now the list goes on to a second page.
  // Both are measured here in the real print layout, not planned.
  await page.emulateMedia({ media: null });
  await page.setViewportSize(screen);
  await page.getByTestId('print-summary').locator('input').check();
  await page.getByTestId('print-a4').locator('input').check();
  await page.getByTestId('print-print').click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as unknown as { printed: number }).printed))
    .toBe(2);
  const root = page.locator('#cs-print-root');
  await expect(root).toHaveAttribute('data-pages', '5');
  await expect(root.locator('.page[data-device]')).toHaveCount(3);
  const summary = root.locator('.page[data-summary="true"]');
  await expect(summary).toHaveCount(2);
  await expect(summary.nth(0).locator('.dev')).toContainText('Most important actions (1)');
  await expect(summary.nth(1).locator('.dev')).toContainText('Most important actions (2)');
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 794, height: 1123 });
  const measured = await summary.evaluateAll((pages) => {
    // (The specs are compiled without the browser's own types.)
    interface Part {
      lastElementChild: Part | null;
      getBoundingClientRect(): { top: number; bottom: number; height: number };
      querySelector(selector: string): Part | null;
      querySelectorAll(selector: string): ArrayLike<Part>;
    }
    return (pages as unknown as Part[]).map((section) => {
      const list = section.querySelector('.list')!;
      const box = list.getBoundingClientRect();
      const columns = Array.from(list.querySelectorAll('.col')).map((col) => {
        const last = col.lastElementChild;
        return last ? last.getBoundingClientRect().bottom - box.top : 0;
      });
      return { room: box.height, columns, rows: list.querySelectorAll('.row').length };
    });
  });
  // On this rig: 952 px of room a page; the columns end at 591 and 658 px on the first page
  // and at 647 and 326 px on the second (40 and 31 actions).
  // Nothing is cut off: every column ends inside the room its page has for the list, and
  // the two pages together have every one of the 71 actions the summary is made of.
  for (const one of measured) {
    for (const column of one.columns) expect(column).toBeLessThanOrEqual(one.room + 0.5);
  }
  expect(measured.reduce((sum, one) => sum + one.rows, 0)).toBe(71);
  // And one page could not have held them: the columns together are taller than the two
  // columns of a page.
  const tall = measured.flatMap((one) => one.columns).reduce((sum, column) => sum + column, 0);
  expect(tall).toBeGreaterThan(2 * measured[0]!.room);
  // For the pictures the pages before are taken away (the printout does not scroll), after
  // the measuring: turning the page.
  await root.locator('.page[data-device]').evaluateAll((pages) => {
    for (const one of pages) one.remove();
  });
  await shot('summary-first-page');
  await summary.nth(0).evaluate((one) => one.remove());
  await expect(summary).toHaveCount(1);
  await shot('summary-second-page');
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
  // 24 pages are rendered for the comparison and again for the export: about 7 seconds
  // each time on this rig when nothing else runs, so the usual 10 are too few on a busy one.
  await page.getByTestId('kneeboard-export').click();
  await expect(page.getByTestId('kneeboard-export-confirm')).toContainText('created', {
    timeout: 40_000,
  });
  await page.getByTestId('kneeboard-export-go').click();
  await expect(page.getByTestId('kneeboard-done')).toHaveAttribute('data-written', '24', {
    timeout: 40_000,
  });
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

test('cheat sheets: the kneeboard check is added to a setup from the kneeboard dialog, and taken out again', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-check-add');
  const { page, shot } = run;
  const setupFile = path.join(run.dataRoot, 'profiles', 'dcs-f-a-18c.yaml');
  const row = checkRow(page, 'Kneeboard cheat sheet for F/A-18C is up to date');
  // The setup is ready and does not look at kneeboard pages yet.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  expect(await fs.readFile(setupFile, 'utf8')).not.toContain('cheat-sheets.kneeboardCurrent');

  await openSheets(page);
  await page.getByTestId('sheet-kneeboard').click();
  const dialog = page.getByTestId('kneeboard-dialog');
  await expect(page.getByTestId('kneeboard-preview')).toHaveAttribute('data-busy', 'false');
  // The setups of this game are offered, each with a tick.
  const setup = dialog.getByTestId('kneeboard-setup');
  await expect(setup).toHaveCount(1);
  await expect(setup).toContainText('DCS F/A-18C');
  await expect(setup).toHaveAttribute('data-checked', 'false');
  await setup.locator('input').check();
  await expect(page.getByTestId('kneeboard-setup-note')).toContainText(
    '"DCS F/A-18C" now checks the F/A-18C kneeboard pages'
  );
  await expect(setup).toHaveAttribute('data-checked', 'true');
  await page.getByTestId('kneeboard-setup-note').scrollIntoViewIfNeeded();
  await shot('added-in-the-dialog');
  // The setup holds the check with the fix that writes the pages again.
  const saved = await fs.readFile(setupFile, 'utf8');
  expect(saved).toContain('cheat-sheets.kneeboardCurrent');
  expect(saved).toContain('cheat-sheets.regenerate');
  expect(saved).toContain('aircraft: FA-18C_hornet');
  await page.getByTestId('kneeboard-close').click();

  // On the Play screen it is a warning, never Not ready, and Make ready writes the pages.
  await page.getByTestId('mode-fly').click();
  await expect(row).toHaveAttribute('data-status', 'warn');
  await expect(row).toContainText('No kneeboard pages exported for F/A-18C');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
  await shot('on-the-fly-screen');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-activity')).toContainText('Wrote 12 kneeboard pages');
  expect(
    await fs.readdir(path.join(run.home, 'Saved Games', 'DCS', 'Kneeboard', 'FA-18C_hornet'))
  ).toHaveLength(12);
  await shot('made-ready');

  // Taken out again in the same place.
  await openSheets(page);
  await page.getByTestId('sheet-kneeboard').click();
  await expect(setup).toHaveAttribute('data-checked', 'true');
  await setup.locator('input').uncheck();
  await expect(page.getByTestId('kneeboard-setup-note')).toContainText(
    '"DCS F/A-18C" no longer checks these kneeboard pages'
  );
  await expect(setup).toHaveAttribute('data-checked', 'false');
  expect(await fs.readFile(setupFile, 'utf8')).not.toContain('cheat-sheets.kneeboardCurrent');
  await page.getByTestId('kneeboard-close').click();
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-status-sub')).not.toContainText('warning');
  await expect(row).toHaveCount(0);
});

test('cheat sheets: a label too long for its block wraps, and is shortened with an ellipsis, never clipped', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-long-label');
  const { page, shot } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await openSheets(page);
  await device(page, 'Stick').click();
  // The trigger's second stage: its block is in a column beside the grip, the narrowest a
  // block gets. (The red button's block, above the grip, is wide enough for any note.)
  const card = control(page, 'button:5');
  await card.click();

  // A short note sits under the action, at the size of every label.
  await page.getByTestId('note-input').locator('input').fill('hold for the whole burst');
  await page.getByTestId('note-save').click();
  await expect(page.getByTestId('note-saved')).toBeVisible();
  const action = card.locator('text.cs-row-text').first();
  const noteText = card.locator('text.cs-note');
  await expect(noteText).toHaveText('✎ hold for the whole burst');
  await expect(noteText).toHaveAttribute('font-size', '14');

  // A note longer than three lines of its block: it wraps, and the rest is shortened. The
  // action stays whole; the note gives way and ends in an ellipsis, at the same size.
  const note =
    'squeeze past the first click and hold for the whole burst, or the gun stops after a few rounds and the pass is wasted';
  await page.getByTestId('note-input').locator('input').fill(note);
  await page.getByTestId('note-save').click();
  await expect(page.getByTestId('note-saved')).toBeVisible();
  await expect(action).toContainText('Trigger: fire');
  await expect(noteText.locator('tspan')).toHaveCount(3);
  // (Its lines are the text's tspans, read here without the spaces between them.)
  await expect(noteText).toHaveText(/^✎ squeeze past the first click.+…$/);
  await expect(noteText).not.toContainText('wasted');
  await expect(noteText).toHaveAttribute('font-size', '14');
  // Nothing sticks out of any block, and the page did not have to make any text smaller.
  const fit = await labelFit(page);
  expect(fit.clipped).toEqual([]);
  expect(fit.refitted).toEqual([]);
  expect(fit.shortened).toHaveLength(1);
  // The whole note is a hover away, and in the detail panel beside the picture.
  expect(await card.locator('title').textContent()).toContain(note);
  await expect(page.getByTestId('note-input').locator('input')).toHaveValue(note);
  await shot('long-note');

  // "By action" has room for all of it.
  await page.getByTestId('sheet-view-actions').click();
  await page.getByTestId('sheet-search').locator('input').fill('trigger');
  await expect(
    page
      .locator(
        '[data-testid="action-row"][data-action="Gun Trigger - SECOND DETENT (Press to shoot)"]'
      )
      .getByTestId('action-place')
  ).toContainText(note);
  await page.getByTestId('sheet-search').locator('input').fill('');
  await page.getByTestId('sheet-view-devices').click();

  // The kneeboard page of the stick, in its larger type, shortens it the same way.
  await page.getByTestId('sheet-kneeboard').click();
  await expect(page.getByTestId('kneeboard-preview')).toHaveAttribute('data-busy', 'false');
  await shot('long-note-on-the-kneeboard-page');
});

test('cheat sheets: an open sheet follows the bindings page - the pop-out redraws when a binding is saved', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-follow');
  const { page, app } = run;
  // The owner named his devices: the bindings page lists the stick under that name.
  const stick = 'Stick';
  // Both windows are pictured here, so the pictures are numbered here too.
  let pictures = 0;
  const snap = async (target: Page, name: string): Promise<void> => {
    await target.evaluate('document.fonts.ready');
    const file = `${String(++pictures).padStart(2, '0')}-${name}.png`;
    await target.screenshot({
      path: path.join(repoRoot, 'artifacts', 'screens', 'cheat-sheets-follow', file),
    });
  };
  /** Picks from a searchable list: type, then take the first match. */
  const pick = async (testId: string, text: string): Promise<void> => {
    const input = page.getByTestId(testId).locator('input[type="text"]');
    await input.click();
    await input.fill(text);
    await page.getByRole('option', { name: text }).first().click();
  };

  await page.setViewportSize({ width: 1500, height: 1250 });
  await openSheets(page);
  await device(page, 'Stick').click();
  // Button 1 of the stick (the top front lever at rest) does nothing yet: its row is empty.
  await expect(control(page, 'button:1')).toHaveClass(/cs-empty/);

  // The quick look, popped out: the small window that stays open beside the game.
  await page.getByTestId('sheet-quick').click();
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    page.getByTestId('quick-popout').click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  const popped = popup.getByTestId('quick-look');
  await expect(popped).toHaveAttribute('data-popped', 'true');
  await expect(popped).toHaveAttribute('data-live', 'true');
  await expect(popped.getByTestId('sheet-view')).toHaveAttribute('data-device', '4098:BEA8');
  await expect(popped).toHaveAttribute('data-followed', '0');
  await expect(popped.locator('.cs-ctl[data-control="button:1"]')).toHaveCount(0);
  // The pop-out as it is before: only what does something is on it.
  await popped.locator('.cs-ctl[data-control="button:19"]').scrollIntoViewIfNeeded();
  await snap(popup, 'pop-out-before');

  // On the bindings page, in the main window: put the canopy on button 1 of the stick.
  await page.getByTestId('nav-bindings').click();
  await expect(page.getByTestId('bind-overview')).toBeVisible();
  await page.getByTestId('bind-tab-actions').click();
  await page.getByTestId('act-search').locator('input').fill('canopy control switch - open');
  await page.getByTestId('act-bind').first().click();
  await expect(page.getByTestId('bind-dialog')).toBeVisible();
  await pick('bind-device', stick);
  await pick('bind-input', 'Button 1');
  await page.getByTestId('bind-save').click();
  await page.getByTestId('bind-review').click();
  const plan = page.getByTestId('plan-dialog');
  await expect(plan).toContainText('Canopy Control Switch - OPEN: bind Button 1');
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toContainText('Saved: Change 1 binding');
  await snap(page, 'saved-on-the-bindings-page');

  // The pop-out drew its sheet again by itself: button 1 has its label now.
  await expect(popped).toHaveAttribute('data-followed', '1');
  const canopy = popped.locator('.cs-ctl[data-control="button:1"]');
  await expect(canopy).toContainText('Canopy: OPEN');
  await canopy.scrollIntoViewIfNeeded();
  await snap(popup, 'pop-out-followed');

  // Undo on the bindings page takes it off the sheet again, and saving it once more puts
  // it back: the pop-out follows every time.
  await page.getByTestId('bind-undo').click();
  await expect(page.getByTestId('bind-saved')).toContainText('Undone: Change 1 binding');
  await expect(popped).toHaveAttribute('data-followed', '2');
  await expect(canopy).toHaveCount(0);
  await page.getByTestId('act-bind').first().click();
  await expect(page.getByTestId('bind-dialog')).toBeVisible();
  await pick('bind-device', stick);
  await pick('bind-input', 'Button 1');
  await page.getByTestId('bind-save').click();
  await page.getByTestId('bind-review').click();
  await plan.getByTestId('plan-apply').click();
  await expect(page.getByTestId('bind-saved')).toContainText('Saved: Change 1 binding');
  await expect(popped).toHaveAttribute('data-followed', '3');
  await expect(canopy).toContainText('Canopy: OPEN');

  // The full page shows it too.
  await page.getByTestId('nav-cheat-sheets').click();
  await expect(page.getByTestId('cheat-sheets-page')).toHaveAttribute('data-ready', 'true');
  await device(page, 'Stick').click();
  // On the drawing, in the block of the lever it belongs to.
  await expect(control(page, 'button:1')).toContainText('Canopy: OPEN');
  await expect(control(page, 'button:1')).toHaveClass(/cs-bound/);
  await control(page, 'button:1').click();
  await expect(page.getByTestId('detail-binding')).toContainText('Canopy Control Switch - OPEN');
  await snap(page, 'full-sheet-after');
  await popup.close();
});

test('cheat sheets: the racing rig - iRacing and Le Mans Ultimate on the shipped Fanatec wheel', async ({
  rig,
}) => {
  const run = await rig.launch('mark-racing', 'cheat-sheets-racing');
  const { page, shot, sendInput } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await openSheets(page);

  // Every game with bindings on this PC is offered; a racing game keeps one set for all cars.
  await page.getByTestId('sheet-aircraft').click();
  for (const name of [
    'iRacing · All cars',
    'Le Mans Ultimate · All cars',
    'BeamNG.drive · All vehicles',
    'Assetto Corsa · All cars',
  ]) {
    await expect(page.getByRole('option', { name })).toHaveCount(1);
  }
  await page.getByRole('option', { name: 'iRacing · All cars' }).click();

  // iRacing: the sheet is named after the game, and the wheel is drawn on the shipped layout.
  await expect(page.getByTestId('sheet-name')).toHaveText('iRacing');
  await expect(page.getByTestId('sheet-totals')).toContainText('iRacing · 1 device ·');
  await expect(page.getByTestId('sheet-title')).toHaveText('FANATEC Podium Wheel Base DD2');
  await expect(page.getByTestId('sheet-layout-source')).toHaveAttribute('data-source', 'builtin');
  await expect(control(page, 'axis:X')).toContainText('Steering');
  await expect(control(page, 'axis:X')).toHaveAttribute('data-kind', 'driving');
  await expect(control(page, 'axis:Z')).toContainText('Throttle');
  await expect(control(page, 'axis:RZ')).toContainText('Brake');
  await expect(control(page, 'button:5')).toContainText('Paddle');
  await expect(control(page, 'button:5')).toContainText('Shift up');
  await expect(control(page, 'button:6')).toContainText('Shift down');
  // A bound button the layout does not place is added below it, never left out.
  await expect(control(page, 'button:26')).toContainText('Reset car');
  await expect(page.getByTestId('legend-chip')).toHaveText(['Driving', 'View']);
  // Kneeboard pages are a DCS thing; the bindings link leads to the game's own page.
  await expect(page.getByTestId('sheet-kneeboard')).toHaveCount(0);
  await expect(page.getByTestId('sheet-open-bindings')).toHaveAttribute(
    'href',
    /\/configure\/racing\/iracing$/
  );
  expect(await labelFit(page)).toMatchObject({ clipped: [], refitted: [], shortened: [] });

  // Pull the right paddle on the real wheel: its label lights up and says what it does.
  await sendInput([state(CONTROLLERS.wheel)]);
  await sendInput([state(CONTROLLERS.wheel, { pressed: [5] })]);
  await expect(control(page, 'button:5')).toHaveClass(/cs-on/);
  await expect(page.getByTestId('sheet-last')).toContainText('Button 5');
  await expect(page.getByTestId('sheet-last')).toContainText('Shift up');
  await shot('iracing-wheel');
  await sendInput([state(CONTROLLERS.wheel)]);

  // "Which control shifts up?"
  await page.getByTestId('sheet-view-actions').click();
  const shiftUp = page.locator('[data-testid="action-row"][data-action="Shift up"]');
  await expect(shiftUp.getByTestId('action-place')).toContainText('Right side Paddle');
  await expect(shiftUp.getByTestId('action-game-name')).toHaveCount(0);
  // Only the kinds a racing sheet has are offered as filters, and a row does not repeat
  // the kind it is listed under.
  await expect(page.locator('[data-testid="sheet-actions"] .cs-chip')).toHaveText([
    'Driving',
    'View',
  ]);
  await expect(shiftUp.locator('.rr-row-sub')).toHaveCount(0);
  await shot('iracing-by-action');
  await page.getByTestId('sheet-view-devices').click();

  // Le Mans Ultimate: the D-pad is on the hat, and what it has twice is flagged.
  await choose(page, 'sheet-aircraft', 'Le Mans Ultimate · All cars');
  await expect(page.getByTestId('sheet-name')).toHaveText('Le Mans Ultimate');
  // What the paddle did in iRacing is not said of this sheet.
  await expect(page.getByTestId('sheet-last')).toHaveCount(0);
  await expect(page.getByTestId('sheet-layout-source')).toHaveAttribute('data-source', 'builtin');
  await expect(control(page, 'hat:1:U')).toContainText('Pit Menu Up');
  await expect(control(page, 'hat:1:U')).toHaveAttribute('data-kind', 'pit');
  await expect(control(page, 'button:33')).toContainText('Bias Forward');
  await expect(control(page, 'button:33')).toHaveAttribute('data-kind', 'car');
  await expect(page.getByTestId('sheet-open-bindings')).toHaveAttribute(
    'href',
    /\/configure\/racing\/lmu$/
  );
  expect(await labelFit(page)).toMatchObject({ clipped: [], refitted: [], shortened: [] });
  await control(page, 'button:33').click();
  await expect(page.getByTestId('detail-binding')).toContainText('Bias Forward');
  await expect(page.getByTestId('detail-also')).toContainText('Button 104');
  await shot('lmu-wheel');

  // The quick look works for a wheel as it does for a stick.
  await page.getByTestId('sheet-quick').click();
  const quick = page.getByTestId('quick-look');
  await expect(quick).toHaveAttribute('data-live', 'true');
  await expect(quick.getByTestId('sheet-view')).toHaveAttribute('data-device', '0EB7:0007');
  await page.getByTestId('quick-search').locator('input').fill('pit');
  await expect(page.getByTestId('quick-answer').first()).toContainText('Pit');
  await shot('lmu-quick-look');

  // The same readers serve the input tester: it knows what the paddle does in iRacing.
  await page.getByTestId('nav-devices').click();
  await page.getByTestId('devices-tab-test').click();
  await expect(page.getByTestId('tester-page')).toHaveAttribute('data-live', 'true');
  await page.getByTestId('tester-aircraft').click();
  await page.getByRole('option', { name: 'iRacing · All cars' }).click();
  await expect(page.getByTestId('bound-waiting')).toContainText('what it does in iRacing');
  await sendInput([state(CONTROLLERS.wheel)]);
  await sendInput([state(CONTROLLERS.wheel, { pressed: [5] })]);
  await expect(page.getByTestId('bound-control')).toHaveText(
    'Button 5 on FANATEC Podium Wheel Base DD2'
  );
  await expect(page.getByTestId('bound-action')).toHaveCount(1);
  await expect(page.getByTestId('tester-bound')).toContainText('Shift up');
  await sendInput([state(CONTROLLERS.wheel)]);
  await sendInput([state(CONTROLLERS.wheel, { pressed: [100] })]);
  await expect(page.getByTestId('bound-none')).toContainText('Nothing is bound to it in iRacing');
});

test('cheat sheets: in the layout editor, Save layout and Cancel stay in the window from the top of the page to its end, and Cancel asks before it drops a change', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-editor-save-bar');
  const { page, shot, sendInput } = run;
  // The window as it opens, not the tall one of the other editor scenarios: the editor is
  // longer than it.
  await openSheets(page);
  await device(page, 'Stick').click();
  await page.getByTestId('sheet-edit-layout').click();
  const editor = page.getByTestId('layout-editor');
  await expect(editor).toHaveAttribute('data-dirty', 'false');
  const save = page.getByTestId('editor-save');
  const cancel = page.getByTestId('editor-cancel');
  await expect(save).toHaveText('Save layout');
  await expect(save).toBeDisabled();
  await expect(page.getByTestId('save-bar-clean')).toHaveText('No unsaved changes');

  // Press the weapon release on the stick and give it its name: a change to save.
  await sendInput([state(CONTROLLERS.stick)]);
  await sendInput([state(CONTROLLERS.stick, { pressed: [20] })]);
  const name = page.getByTestId('editor-control-name').locator('input');
  await expect(name).toHaveValue('Red button');
  await sendInput([state(CONTROLLERS.stick)]);
  await name.fill('Weapon release');
  await expect(editor).toHaveAttribute('data-dirty', 'true');
  await expect(page.getByTestId('save-bar-unsaved')).toHaveText('Unsaved changes');
  await expect(save).toBeEnabled();
  await expectSaveBarPinned(page, save, shot);
  await expect(cancel).toBeInViewport({ ratio: 1 });

  // Cancel would drop the name: the bar asks, and "Keep editing" keeps it.
  await cancel.click();
  await expect(page.getByTestId('save-bar-leave')).toBeVisible();
  await shot('cancel-asks');
  await page.getByTestId('save-bar-leave-stay').click();
  await expect(editor).toBeVisible();
  await expect(name).toHaveValue('Weapon release');

  // The palette's sheet of this aircraft opens this page afresh, which would drop the name
  // as well: the bar asks first, and "Keep editing" keeps it.
  await paletteChoose(page, 'sheet f18', /^Cheat sheet: F\/A-18C/);
  await expect(page.getByTestId('save-bar-leave')).toBeVisible();
  await shot('palette-asks');
  await page.getByTestId('save-bar-leave-stay').click();
  await expect(editor).toBeVisible();
  await expect(name).toHaveValue('Weapon release');
  await expect(page.getByTestId('save-bar-unsaved')).toHaveText('Unsaved changes');

  // Saved from the bar: the editor closes, the bar goes with it, and the sheet has the name.
  await save.click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId('save-bar')).toHaveCount(0);
  await expect(page.getByTestId('sheet-layout-source')).toHaveAttribute('data-source', 'user');

  // With nothing changed, Cancel closes the editor without a question.
  await page.getByTestId('sheet-edit-layout').click();
  await expect(editor).toHaveAttribute('data-dirty', 'false');
  await cancel.click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId('save-bar-leave')).toHaveCount(0);

  // Changed again, and the palette's sheet chosen with "Leave without saving": the page
  // opens afresh on that sheet, and the editor and its change are gone.
  await page.getByTestId('sheet-edit-layout').click();
  await sendInput([state(CONTROLLERS.stick)]);
  await sendInput([state(CONTROLLERS.stick, { pressed: [20] })]);
  await expect(name).toHaveValue('Weapon release');
  await sendInput([state(CONTROLLERS.stick)]);
  await name.fill('Pickle');
  await expect(editor).toHaveAttribute('data-dirty', 'true');
  await paletteChoose(page, 'sheet f18', /^Cheat sheet: F\/A-18C/);
  await expect(page.getByTestId('save-bar-leave')).toBeVisible();
  await page.getByTestId('save-bar-leave-go').click();
  await expect(page).toHaveURL(/#\/configure\/cheat-sheets\?game=dcs&aircraft=FA-18C_hornet$/);
  await expect(page.getByTestId('cheat-sheets-page')).toBeVisible();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId('save-bar-leave')).toHaveCount(0);
});

/** Ctrl+K, the words typed, the row marked checked by its title, and Enter. */
async function paletteChoose(page: Page, typed: string, title: RegExp): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.type(typed);
  await expect(
    page.locator('[data-testid="palette-row"][aria-selected="true"] .rr-palette-title')
  ).toHaveText(title);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toBeHidden();
}
