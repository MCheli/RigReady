import { promises as fs } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Locator, Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test, type RunningApp } from './harness';

/**
 * A sheet from the user's own photos of a controller RigReady has no drawing of. A control
 * is pressed on the (fake) device as a hand would press it, then its place is clicked on the
 * photo: no button numbers are typed anywhere. The photos here are drawn in this file, pixel
 * by pixel: never a maker's picture, never a real photo.
 */

interface Controller {
  index: number;
  name: string;
  guid: string;
  numAxes: number;
  numButtons: number;
  numHats: number;
}

/** The button box of the recorded rig: 41 buttons and two sliders, no drawing, no names. */
const PANEL_GUID = 'DF6F4BD0-FA0C-11F0-8002-444553540000';
const PANEL_FILE = '3344-C259.rrlayout.json';
/**
 * The X52 Pro the scenario plugs in: RigReady knows its controls by name but has no
 * drawing of it (the Warthog throttle, used here before, has a drawing since 12 Nov).
 */
const NAMED_GUID = '3A7C1E23-7A11-11EF-8004-444553540000';
/** The Warthog stick of the same scenario: RigReady has a drawing of it. */
const STICK_GUID = '3A7C1E20-7A11-11EF-8001-444553540000';

// ---- made-up photos ----

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type Colour = [number, number, number];
/** A PNG of the given size whose every pixel is asked of `colour`. */
function png(width: number, height: number, colour: (x: number, y: number) => Colour): Buffer {
  const line = width * 3 + 1;
  const raw = Buffer.alloc(line * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colour(x, y);
      const at = y * line + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8; // bits per channel
  head[9] = 2; // red, green, blue
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const DESK: Colour = [186, 168, 140];
const BODY: Colour = [46, 50, 58];
const CAPS: Colour[] = [
  [214, 72, 60],
  [236, 190, 70],
  [92, 160, 214],
];

/** A box on a desk seen from above: three rows of round caps and two slider slots. */
const boxFromAbove = (): Buffer =>
  png(720, 480, (x, y) => {
    if (x < 36 || x > 684 || y < 36 || y > 444) return DESK;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const dx = x - (110 + col * 92);
        const dy = y - (120 + row * 110);
        if (dx * dx + dy * dy < 26 * 26) return CAPS[row]!;
      }
    }
    for (const slot of [580, 640]) {
      if (Math.abs(x - slot) < 7 && y > 90 && y < 390) return [18, 20, 24];
      if (Math.abs(x - slot) < 18 && Math.abs(y - 200) < 12) return [222, 224, 228];
    }
    return BODY;
  });

/** The same box seen from its side, taller than wide: a rim, two knobs and a lever. */
const boxFromTheSide = (): Buffer =>
  png(420, 600, (x, y) => {
    if (x < 60 || x > 360 || y < 60 || y > 540) return DESK;
    if (y < 96) return [70, 76, 88];
    for (const knob of [200, 330]) {
      const dx = x - 210;
      const dy = y - knob;
      if (dx * dx + dy * dy < 40 * 40) return [222, 224, 228];
    }
    if (Math.abs(x - 210) < 10 && y > 420 && y < 520) return CAPS[0]!;
    return BODY;
  });

/** A throttle from above, as plain shapes: a base, two grips and a few caps. */
const throttleFromAbove = (): Buffer =>
  png(640, 480, (x, y) => {
    if (x < 30 || x > 610 || y < 30 || y > 450) return DESK;
    if (y > 300) return BODY;
    for (const grip of [230, 410]) {
      if (Math.abs(x - grip) < 70 && y > 70 && y < 300) return [64, 70, 80];
      const dx = x - grip;
      const dy = y - 130;
      if (dx * dx + dy * dy < 20 * 20) return CAPS[2]!;
    }
    return [92, 98, 108];
  });

// ---- hands ----

/** Calls the app's own IPC from the page, as a screen does. */
async function invoke<T>(page: Page, channel: string, input?: unknown): Promise<T> {
  const answer = (await page.evaluate(
    ([name, payload]) =>
      (
        globalThis as unknown as {
          rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
        }
      ).rigready.invoke(name as string, payload),
    [channel, input] as const
  )) as { ok: boolean; value?: T; error?: { message: string } };
  if (!answer.ok) throw new Error(answer.error?.message ?? 'failed');
  return answer.value as T;
}

async function controller(page: Page, guid: string): Promise<Controller> {
  const all = await invoke<Controller[]>(page, 'devices:inputDevices');
  const found = all.find((c) => c.guid.toUpperCase() === guid);
  if (!found) throw new Error(`No controller ${guid} on the fake rig.`);
  return found;
}

const HAT: Record<string, [number, number]> = { U: [0, 1], UR: [1, 1], R: [1, 0], D: [0, -1] };

let clock = 20_000;
/** A controller with the given controls held (button:12, hat:1:U) and its axes where said. */
function stateOf(c: Controller, held: string[] = [], axes: Record<number, number> = {}) {
  return {
    index: c.index,
    name: c.name,
    axes: Array.from({ length: c.numAxes }, (_, i) => axes[i] ?? 0),
    buttons: Array.from({ length: c.numButtons }, (_, i) => held.includes(`button:${i + 1}`)),
    hats: Array.from({ length: c.numHats }, (_, i): [number, number] => {
      const on = held.find((id) => id.startsWith(`hat:${i + 1}:`));
      return on ? (HAT[on.split(':')[2]!] ?? [0, 0]) : [0, 0];
    }),
    timestamp: clock++,
  };
}

/** Presses a control and lets it go again, as a finger does. */
async function tap(run: RunningApp, c: Controller, control: string): Promise<void> {
  await run.sendInput([stateOf(c, [control])]);
  await run.sendInput([stateOf(c)]);
}

async function openSheets(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-cheat-sheets').click();
  await expect(page.getByTestId('cheat-sheets-page')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('cheat-sheets-page')).toHaveAttribute('data-live', 'true');
  await expect(page.getByTestId('sheet-view')).toBeVisible();
}

/** The entry of a device in the list of the sheet, found by the name Windows gives it. */
const deviceEntry = (page: Page, name: string): Locator =>
  page.locator('[data-testid="sheet-device"]').filter({ hasText: name });

/** The pieces of the page a photo is worked on with. */
function placer(page: Page) {
  const canvas = page.getByTestId('photo-canvas');
  return {
    canvas,
    prompt: page.getByTestId('photo-prompt'),
    ask: page.getByTestId('photo-ask'),
    more: page.getByTestId('photo-ask-more'),
    progress: page.getByTestId('photo-progress'),
    dot: (id: string) => page.locator(`[data-testid="photo-dot"][data-dot="${id}"]`),
    chip: (key: string) => page.locator(`[data-testid="photo-chip"][data-control="${key}"]`),
    tab: (index: number) => page.locator(`[data-testid="photo-view-tab"][data-view="${index}"]`),
    /** Clicks the photo at a share of its width and height. */
    click: async (fx: number, fy: number): Promise<void> => {
      const box = (await canvas.boundingBox())!;
      await canvas.click({ position: { x: box.width * fx, y: box.height * fy } });
    },
  };
}

/** Where a dot is on screen: its middle. */
async function middle(dot: Locator): Promise<{ x: number; y: number }> {
  const box = (await dot.locator('.ph-spot').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function writeDocs(run: RunningApp, files: Record<string, Buffer | string>): Promise<void> {
  const docs = path.join(run.home, 'Documents');
  await fs.mkdir(docs, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(docs, name), content);
  }
}

test('cheat sheets: my own photos - press a control and click its place, undo, move and take off, a hat as one, two named photos, a half-done sheet', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-known-devices', 'cheat-sheets-photo', {
    dialogs: { open: [['Documents/box-top.png'], ['Documents/box-side.png']] },
  });
  const { page, shot } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await writeDocs(run, { 'box-top.png': boxFromAbove(), 'box-side.png': boxFromTheSide() });
  await openSheets(page);
  const panel = await controller(page, PANEL_GUID);
  await run.sendInput([stateOf(panel)]);

  // The button box has no drawing: it shows as cards. One button starts the photo route.
  await deviceEntry(page, panel.name).click();
  const source = page.getByTestId('sheet-layout-source');
  await expect(source).toHaveAttribute('data-picture', 'cards');
  await page.getByTestId('sheet-photo-drawing').click();
  const mode = page.getByTestId('editor-mode');
  await expect(mode).toHaveAttribute('data-mode', 'photos');
  const p = placer(page);
  await expect(p.canvas.locator('image')).toHaveCount(1);
  await expect(p.ask).toHaveText('Press a control on the device.');
  await expect(p.more).toContainText('No numbers to type');
  await expect(p.progress).toHaveText('0 of 43 controls placed');
  await expect(page.getByTestId('editor-photos-sub')).toContainText('Nothing is placed yet');
  await expect(page.getByTestId('editor-save')).toBeDisabled();
  await expect(page.getByTestId('photo-private')).toContainText(
    "Your photos stay on this PC, in RigReady's folder. Nothing is uploaded."
  );
  await shot('nothing-placed');

  // Press button 5: it waits for its place, and its chip in the list lights while held.
  await run.sendInput([stateOf(panel, ['button:5'])]);
  await expect(p.prompt).toHaveAttribute('data-state', 'place');
  await expect(p.ask).toHaveText('Button 5: click where it is on the photo.');
  await expect(p.chip('button:5')).toHaveClass(/\bon\b/);
  await shot('pressed-waits-for-its-place');
  await run.sendInput([stateOf(panel)]);
  await p.click(0.15, 0.25);
  await expect(p.dot('button-5')).toBeVisible();
  await expect(p.ask).toHaveText('Button 5 is placed. Press the next control.');
  await expect(p.progress).toHaveText('1 of 43 controls placed');
  await expect(p.chip('button:5')).toHaveCount(0);
  await expect(page.getByTestId('editor-save')).toBeEnabled();
  await expect(page.getByTestId('editor-photos-sub')).toContainText('Save at any time');

  // The next one lands in the wrong place: undo takes it back, and it is placed again.
  await tap(run, panel, 'button:6');
  await expect(p.ask).toHaveText('Button 6: click where it is on the photo.');
  await p.click(0.9, 0.9);
  await expect(p.dot('button-6')).toBeVisible();
  await page.getByTestId('photo-undo').click();
  await expect(p.dot('button-6')).toHaveCount(0);
  await expect(p.ask).toHaveText('The last change is undone.');
  await expect(p.progress).toHaveText('1 of 43 controls placed');
  await tap(run, panel, 'button:6');
  await p.click(0.28, 0.25);
  await expect(p.dot('button-6')).toBeVisible();

  // Pressed again, a placed control is moved by a new click.
  const before = await middle(p.dot('button-5'));
  await tap(run, panel, 'button:5');
  await expect(p.prompt).toHaveAttribute('data-state', 'move');
  await expect(p.ask).toHaveText('Button 5 is on the photo already.');
  await p.click(0.15, 0.5);
  await expect(p.ask).toHaveText('Button 5 is moved.');
  const moved = await middle(p.dot('button-5'));
  expect(moved.y).toBeGreaterThan(before.y + 60);
  expect(Math.abs(moved.x - before.x)).toBeLessThan(4);

  // Or dragged.
  const from = await middle(p.dot('button-6'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 20, { steps: 4 });
  await page.mouse.move(from.x + 64, from.y + 4, { steps: 4 });
  await page.mouse.up();
  const dragged = await middle(p.dot('button-6'));
  expect(dragged.x).toBeGreaterThan(from.x + 50);

  // A control placed by its chip, with no press, and taken off again.
  await p.chip('button:12').click();
  await expect(p.ask).toHaveText('Button 12: click where it is on the photo.');
  await p.click(0.5, 0.8);
  await expect(p.dot('button-12')).toBeVisible();
  await expect(page.getByTestId('photo-control-inputs')).toHaveText('Button 12');
  await page.getByTestId('photo-take-off').click();
  await expect(p.dot('button-12')).toHaveCount(0);
  await expect(p.ask).toHaveText('Button 12 is off the photo.');
  await expect(p.chip('button:12')).toBeVisible();
  await expect(p.progress).toHaveText('2 of 43 controls placed');

  // With the keys: the arrows nudge the selected dot, and Delete takes it off.
  await p.chip('button:12').click();
  await p.click(0.5, 0.8);
  await expect(p.dot('button-12')).toHaveClass(/\bsel\b/);
  const still = await middle(p.dot('button-12'));
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await middle(p.dot('button-12'))).x).toBeGreaterThan(still.x + 10);
  await page.keyboard.press('Delete');
  await expect(p.dot('button-12')).toHaveCount(0);
  await expect(p.ask).toHaveText('Button 12 is off the photo.');
  await expect(p.progress).toHaveText('2 of 43 controls placed');

  // A hat that Windows reports as five buttons: its ways are asked for in turn.
  await page.getByTestId('photo-hat').click();
  await expect(p.prompt).toHaveAttribute('data-state', 'hat');
  await expect(p.ask).toHaveText('Push the hat up.');
  await expect(p.more).toContainText('Hat 1, step 1 of 5.');
  await expect(page.getByTestId('photo-hat-done')).toBeDisabled();
  await tap(run, panel, 'button:7');
  await expect(p.ask).toHaveText('Push it to the right.');
  await tap(run, panel, 'button:8');
  await expect(p.ask).toHaveText('Push it down.');
  await expect(p.more).toHaveText('Hat 1, step 3 of 5. So far: ↑ Button 7, → Button 8.');
  await shot('hat-ways-in-turn');
  // A click on the photo places nothing while the ways are still being asked for.
  await p.click(0.5, 0.5);
  await expect(p.prompt).toHaveAttribute('data-state', 'hat');
  await tap(run, panel, 'button:9');
  await tap(run, panel, 'button:10');
  await expect(p.ask).toHaveText('Press it in.');
  await expect(page.getByTestId('photo-hat-skip')).toHaveText('It does not press');
  await tap(run, panel, 'button:11');
  // One control with five ways, and one click for all of them.
  await expect(p.prompt).toHaveAttribute('data-state', 'place');
  await expect(p.ask).toHaveText('Hat 1: click where it is on the photo.');
  await expect(p.more).toContainText('Its 5 ways share this one place.');
  await p.click(0.55, 0.5);
  await expect(p.dot('hat-button-7')).toBeVisible();
  await expect(page.getByTestId('photo-control-inputs')).toHaveText(
    '↑ Button 7, → Button 8, ↓ Button 9, ← Button 10, press Button 11'
  );
  await expect(p.progress).toHaveText('7 of 43 controls placed');
  const name = page.getByTestId('photo-control-name');
  await name.fill('View hat');
  await name.press('Enter');
  await name.blur();
  await expect(p.dot('hat-button-7')).toContainText('View hat');
  // Any way of it lights the one dot.
  await run.sendInput([stateOf(panel, ['button:9'])]);
  await expect(p.dot('hat-button-7')).toHaveClass(/\bon\b/);
  await page.getByTestId('photo-cancel').click();
  await run.sendInput([stateOf(panel)]);

  // A slider is moved, not pressed.
  await run.sendInput([stateOf(panel, [], { 0: 0.9 })]);
  await expect(p.ask).toHaveText('Slider 1: click where it is on the photo.');
  await p.click(0.8, 0.42);
  await expect(p.dot('axis-SLIDER1')).toBeVisible();
  await run.sendInput([stateOf(panel)]);

  // A second photo: the box from its side. Each photo has a name.
  await page.getByTestId('photo-add-view').click();
  await expect(p.tab(1)).toHaveClass(/\bon\b/);
  await expect(p.ask).toHaveText(
    'The photo is added. Give each photo a name, such as Top or Back.'
  );
  const viewName = page.getByTestId('photo-view-name');
  // The letters typed so far stay in the field while the device reports something.
  await viewName.fill('Si');
  await run.sendInput([stateOf(panel, ['button:30'])]);
  await expect(p.chip('button:30')).toHaveClass(/\bon\b/);
  await expect(viewName).toHaveValue('Si');
  await run.sendInput([stateOf(panel)]);
  await expect(p.chip('button:30')).not.toHaveClass(/\bon\b/);
  await expect(viewName).toHaveValue('Si');
  await page.getByTestId('photo-cancel').click();
  await viewName.fill('Side');
  await viewName.blur();
  await expect(p.tab(1)).toContainText('Side');
  await p.chip('axis:SLIDER2').click();
  await p.click(0.5, 0.33);
  await expect(p.dot('axis-SLIDER2')).toBeVisible();
  await expect(p.tab(1)).toHaveAttribute('data-placed', '1');
  await shot('second-photo');
  // Pressing a control that is on the other photo brings that photo forward.
  await tap(run, panel, 'button:5');
  await expect(p.tab(0)).toHaveClass(/\bon\b/);
  await page.getByTestId('photo-cancel').click();
  await viewName.fill('Top');
  await viewName.blur();
  await expect(p.tab(0)).toContainText('Top');
  await expect(p.tab(0)).toHaveAttribute('data-placed', '4');

  // What is placed and what is not is said at all times.
  await expect(p.progress).toHaveText('9 of 43 controls placed');
  await expect(page.getByTestId('photo-unplaced-text')).toHaveText(
    'Not placed yet: Buttons 1 to 4, Buttons 12 to 41.'
  );
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('half-done');

  // Saved half-done: it is the sheet of the box from now on.
  await page.getByTestId('editor-save').click();
  await expect(source).toHaveAttribute('data-picture', 'drawing');
  await expect(source).toHaveText('Your photos, 9 of 43 controls placed');
  await expect(page.getByTestId('sheet-picture-notes')).toContainText(
    'Not placed on a photo yet: Buttons 1 to 4, Buttons 12 to 41. They are in the list under the photo.'
  );
  const sheet = page.getByTestId('sheet-view');
  await expect(sheet.locator('svg image.cs-view')).toHaveCount(2);
  await expect(sheet.locator('.cs-view-name')).toHaveText(['Top', 'Side']);
  await expect(sheet.locator('[data-anchor="hat-button-7"] .cs-bhead')).toContainText('View hat');
  await expect(sheet).toContainText('MORE CONTROLS · not placed on a photo yet');
  // A press lights its control: on the photo for a way of the hat, in the list for a
  // button that has no place yet.
  await run.sendInput([stateOf(panel, ['button:8'])]);
  await expect(sheet.locator('.cs-ctl[data-control="button:8"]')).toHaveClass(/cs-on/);
  await run.sendInput([stateOf(panel, ['button:20'])]);
  await expect(sheet.locator('.cs-ctl[data-control="button:20"]')).toHaveClass(/cs-on/);
  await shot('sheet-half-done');
  await run.sendInput([stateOf(panel)]);

  // The photos are kept in RigReady's own folder, as the JPEG copies RigReady made.
  const saved = JSON.parse(
    await fs.readFile(path.join(run.dataRoot, 'cheat-sheets', 'layouts', PANEL_FILE), 'utf8')
  ) as { drawing: { custom: { views: { name: string; image: string }[]; controls: unknown[] } } };
  expect(saved.drawing.custom.views.map((view) => view.name)).toEqual(['Top', 'Side']);
  for (const view of saved.drawing.custom.views) {
    expect(view.image.startsWith('data:image/jpeg;base64,')).toBe(true);
  }
  expect(saved.drawing.custom.controls).toHaveLength(5);

  // Opened again it is where it was left, and a photo with what is on it can be removed.
  await page.getByTestId('sheet-edit-layout').click();
  await expect(mode).toHaveAttribute('data-mode', 'photos');
  await expect(p.progress).toHaveText('9 of 43 controls placed');
  await p.tab(1).click();
  await page.getByTestId('photo-view-remove').click();
  await expect(p.ask).toHaveText(
    'The photo Side is removed, and with it the control placed on it.'
  );
  await expect(page.getByTestId('photo-view-tab')).toHaveCount(1);
  await expect(p.chip('axis:SLIDER2')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('photo-view-tab')).toHaveCount(2);
  await expect(p.progress).toHaveText('9 of 43 controls placed');
  await page.getByTestId('editor-cancel').click();
  await expect(source).toHaveText('Your photos, 9 of 43 controls placed');
});

test('cheat sheets: a half-done photo is the picture in the trainer and on the kneeboard page, and a press lights something there', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-known-devices', 'cheat-sheets-photo-used', {
    dialogs: { open: [['Documents/box-top.png'], ['Documents/box-side.png']] },
  });
  const { page, shot } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await writeDocs(run, { 'box-top.png': boxFromAbove(), 'box-side.png': boxFromTheSide() });
  await openSheets(page);
  const panel = await controller(page, PANEL_GUID);
  await run.sendInput([stateOf(panel)]);
  const entry = deviceEntry(page, panel.name);
  await entry.click();
  const key = (await entry.getAttribute('data-key'))!;
  const title = (await entry.getAttribute('data-title'))!;

  // Two photos, three controls placed, the rest left for later.
  await page.getByTestId('sheet-photo-drawing').click();
  await expect(page.getByTestId('editor-mode')).toHaveAttribute('data-mode', 'photos');
  const p = placer(page);
  await tap(run, panel, 'button:1');
  await p.click(0.15, 0.25);
  await tap(run, panel, 'button:2');
  await p.click(0.28, 0.25);
  await page.getByTestId('photo-add-view').click();
  await expect(p.tab(1)).toHaveClass(/\bon\b/);
  await tap(run, panel, 'button:3');
  await p.click(0.5, 0.33);
  await expect(p.progress).toHaveText('3 of 43 controls placed');
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('sheet-layout-source')).toHaveText(
    'Your photos, 3 of 43 controls placed'
  );

  // The trainer shows the photos for this device. A button with no place yet is held down:
  // it is lit in the list under the photos, and so is the control a card asks for.
  const deck = await invoke<{
    cards: { answers: { deviceKey: string; control: string }[] }[];
  }>(page, 'cheat-sheets:trainerDeck', { game: 'dcs', aircraftId: 'FA-18C_hornet' });
  const asked = new Set(
    deck.cards
      .flatMap((card) => card.answers.filter((a) => a.deviceKey === key))
      .map((a) => a.control)
  );
  const spare = Array.from({ length: panel.numButtons }, (_, i) => `button:${i + 1}`).find(
    (control) => !asked.has(control) && !['button:1', 'button:2', 'button:3'].includes(control)
  );
  expect(spare, 'a button of the box that no card asks for').toBeDefined();
  await page.getByTestId('sheet-learn').click();
  const trainer = page.getByTestId('trainer-page');
  await trainer.getByTestId('trainer-device').click();
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('option', { name: new RegExp('^' + escaped + ' · ') }).click();
  await run.sendInput([stateOf(panel, [spare!])]);
  await expect(trainer).toHaveAttribute('data-live', 'true');
  await expect(trainer).toHaveAttribute('data-heard', '1');
  await trainer.getByTestId('trainer-start').click();
  const verdict = trainer.getByTestId('trainer-verdict');
  await expect(verdict).toHaveAttribute('data-phase', 'asking');
  await trainer.getByTestId('trainer-show').click();
  await expect(verdict).toHaveAttribute('data-phase', 'shown');
  const picture = trainer.locator(`[data-testid="trainer-picture"][data-device="${key}"]`);
  await expect(picture.locator('svg image.cs-view')).toHaveCount(2);
  const targets = ((await picture.getAttribute('data-target')) ?? '').split(' ').filter(Boolean);
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    await expect(picture.locator(`.cs-ctl[data-control="${target}"]`)).toHaveClass(/tr-target/);
  }
  await expect(picture.locator(`.cs-ctl[data-control="${spare}"]`)).toHaveClass(/cs-on/);
  await shot('trainer');
  await run.sendInput([stateOf(panel)]);
  await trainer.getByTestId('trainer-stop').click();

  // Its kneeboard page, by day and by night: the photos, then the list of what is not placed.
  await trainer.getByTestId('trainer-back').click();
  await expect(page.getByTestId('sheet-view')).toBeVisible();
  await deviceEntry(page, panel.name).click();
  await page.getByTestId('sheet-kneeboard').click();
  const preview = page.getByTestId('kneeboard-preview');
  await expect(preview).toHaveAttribute('data-busy', 'false');
  await expect(preview).toHaveAttribute('data-style', 'light');
  const savePage = async (shotFile: string): Promise<void> => {
    const data = /^data:image\/png;base64,(.+)$/.exec(
      (await preview.getAttribute('src')) ?? ''
    )?.[1];
    expect(data, 'the preview is a PNG').toBeDefined();
    await fs.writeFile(shotFile.replace(/\.png$/, '-page.png'), Buffer.from(data!, 'base64'));
  };
  await savePage(await shot('kneeboard-day'));
  await page.getByTestId('kneeboard-preview-night').click();
  await expect(preview).toHaveAttribute('data-style', 'night');
  await expect(preview).toHaveAttribute('data-busy', 'false');
  await savePage(await shot('kneeboard-night'));

  // Exported for the game: the page of the box is a real kneeboard page.
  const dialog = page.getByTestId('kneeboard-dialog');
  await page.getByTestId('kneeboard-style-light').click();
  for (const box of await dialog.locator('[data-testid="kneeboard-device"] input').all()) {
    await box.uncheck();
  }
  await dialog.locator(`[data-testid="kneeboard-device"][data-key="${key}"] input`).check();
  await page.getByTestId('kneeboard-export').click();
  await expect(page.getByTestId('kneeboard-export-confirm')).toContainText('created');
  await page.getByTestId('kneeboard-export-go').click();
  await expect(page.getByTestId('kneeboard-done')).toHaveAttribute('data-written', '2');
  const folder = path.join(run.home, 'Saved Games', 'DCS', 'Kneeboard', 'FA-18C_hornet');
  const pages = (await fs.readdir(folder)).filter((file) => file.includes(title));
  expect(pages).toHaveLength(1);
  const bytes = await fs.readFile(path.join(folder, pages[0]!));
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  expect({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }).toEqual({
    width: 768,
    height: 1024,
  });
  await fs.copyFile(
    path.join(folder, pages[0]!),
    (await shot('kneeboard-exported')).replace(/\.png$/, '-page.png')
  );
});

test('cheat sheets: a file that is not a picture or is too large is refused with the reason, and a control known by name comes whole', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-known-devices', 'cheat-sheets-photo-named', {
    dialogs: {
      open: [
        ['Documents/notes.jpg'],
        ['Documents/too-large.png'],
        ['Documents/throttle.png'],
        ['Documents/throttle.png'],
      ],
    },
  });
  const { page, shot } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await writeDocs(run, {
    // Named like a picture, but text inside.
    'notes.jpg': 'These are my notes, not a photo.',
    'too-large.png': boxFromAbove(),
    'throttle.png': throttleFromAbove(),
  });
  await fs.truncate(path.join(run.home, 'Documents', 'too-large.png'), 26 * 1024 * 1024);
  await openSheets(page);
  const x52 = await controller(page, NAMED_GUID);
  await run.sendInput([stateOf(x52)]);
  await deviceEntry(page, x52.name).click();
  const source = page.getByTestId('sheet-layout-source');
  await expect(source).toHaveAttribute('data-picture', 'list');

  // Not a picture: refused, with the reason, and nothing changes.
  await page.getByTestId('sheet-photo-drawing').click();
  const problem = page.getByTestId('editor-error');
  await expect(problem).toContainText(
    'notes.jpg is not a picture RigReady can open. Choose a JPEG, PNG or WebP photo.'
  );
  const mode = page.getByTestId('editor-mode');
  await expect(mode).not.toHaveAttribute('data-mode', 'photos');
  await shot('refused-not-a-picture');
  // Too large: refused as well.
  await page.getByTestId('editor-photo-drawing').click();
  await expect(problem).toContainText(
    'too-large.png is too large (26 MB). RigReady takes photos up to 25 MB. Save a smaller copy and choose that.'
  );
  await expect(mode).not.toHaveAttribute('data-mode', 'photos');
  await shot('refused-too-large');
  // A picture: taken.
  await page.getByTestId('editor-photo-drawing').click();
  await expect(mode).toHaveAttribute('data-mode', 'photos');
  await expect(problem).toHaveCount(0);
  const p = placer(page);
  // The 16 controls RigReady knows by name count once each, with the 15 inputs its map
  // leaves out (the wheel and MFD buttons, the rotaries, the slider).
  await expect(p.progress).toHaveText('0 of 31 controls placed');

  // One way of the stick's top hat is pressed: the whole hat waits for its one place.
  await tap(run, x52, 'button:20');
  await expect(p.ask).toHaveText('Stick top hat: click where it is on the photo.');
  await expect(p.more).toContainText('Its 4 ways share this one place.');
  await p.click(0.36, 0.27);
  await expect(p.dot('h1')).toBeVisible();
  await expect(p.progress).toHaveText('1 of 31 controls placed');
  // Another way of it is the same control: it is on the photo already.
  await tap(run, x52, 'button:22');
  await expect(p.prompt).toHaveAttribute('data-state', 'move');
  await expect(p.ask).toHaveText('Stick top hat is on the photo already.');
  await page.getByTestId('photo-armed-take-off').click();
  await expect(p.ask).toHaveText('Stick top hat is off the photo.');
  await expect(p.dot('h1')).toHaveCount(0);
  await page.getByTestId('photo-undo').click();
  await expect(p.dot('h1')).toBeVisible();

  // The hat Windows reports as a hat: one push, to a corner even, and it is the POV hat.
  await tap(run, x52, 'hat:1:UR');
  await expect(p.ask).toHaveText('Stick POV hat: click where it is on the photo.');
  await expect(p.more).toContainText('Its 8 ways share this one place.');
  await p.click(0.64, 0.27);
  await expect(p.dot('pov')).toBeVisible();
  // Through "Place a hat" it is the same control: a hat that does not press.
  await page.getByTestId('photo-hat').click();
  await tap(run, x52, 'hat:1:U');
  await expect(p.ask).toHaveText('Press it in.');
  await expect(p.more).toHaveText('Stick POV hat, step 5 of 5. So far: all its ways.');
  await page.getByTestId('photo-hat-skip').click();
  await expect(p.ask).toHaveText('Stick POV hat is on the photo already.');
  await page.getByTestId('photo-cancel').click();

  // The stick's roll, pitch and twist are one control with three ways: moving one arms it.
  await run.sendInput([stateOf(x52, [], { 0: 0.9 })]);
  await expect(p.ask).toHaveText('Stick: click where it is on the photo.');
  await expect(p.more).toContainText('Its 3 ways share this one place.');
  await p.click(0.5, 0.45);
  await expect(p.dot('stick')).toBeVisible();
  await run.sendInput([stateOf(x52)]);
  await expect(p.progress).toHaveText('3 of 31 controls placed');
  await shot('named-controls');

  await page.getByTestId('editor-save').click();
  await expect(source).toHaveAttribute('data-picture', 'drawing');
  await expect(source).toHaveText('Your photos, 3 of 31 controls placed');
  const sheet = page.getByTestId('sheet-view');
  await expect(sheet.locator('svg image.cs-view')).toHaveCount(1);
  for (const [anchor, head] of [
    ['h1', 'Stick top hat'],
    ['pov', 'Stick POV hat'],
    ['stick', 'Stick'],
  ] as const) {
    await expect(sheet.locator(`[data-anchor="${anchor}"] .cs-bhead`)).toContainText(head);
  }
  await expect(page.getByTestId('sheet-picture-notes')).toContainText('Not placed on a photo yet:');
  await shot('sheet-named');

  // Discarded, the X52 Pro is the named list it was.
  await page.getByTestId('sheet-edit-layout').click();
  await expect(mode).toHaveAttribute('data-mode', 'photos');
  await page.getByTestId('editor-reset').click();
  await expect(source).toHaveAttribute('data-picture', 'list');

  // A device RigReady has a drawing of: its drawing editor offers the photos too, and
  // the photos offer the way back to RigReady's drawing.
  const stick = await controller(page, STICK_GUID);
  await deviceEntry(page, stick.name).click();
  await expect(source).toHaveAttribute('data-picture', 'drawing');
  await expect(page.getByTestId('sheet-photo-drawing')).toHaveCount(0);
  await page.getByTestId('sheet-edit-layout').click();
  await expect(mode).toHaveAttribute('data-mode', 'drawing');
  await page.getByTestId('editor-use-photos').click();
  await expect(mode).toHaveAttribute('data-mode', 'photos');
  await expect(p.canvas.locator('image')).toHaveCount(1);
  await expect(p.progress).toHaveText('0 of 10 controls placed');
  await expect(page.getByTestId('editor-save')).toBeDisabled();
  await page.getByTestId('photo-use-shipped').click();
  await expect(mode).toHaveAttribute('data-mode', 'drawing');
  await page.getByTestId('editor-cancel').click();
  await expect(source).toHaveAttribute('data-picture', 'drawing');
  await expect(source).not.toContainText('Your photos');
});

test('cheat sheets: a device that is not connected is placed from the list of its controls', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-known-devices', 'cheat-sheets-photo-unplugged', {
    dialogs: { open: [['Documents/pedals.png'], ['Documents/pedals-again.png']] },
  });
  const { page, shot } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await writeDocs(run, { 'pedals.png': boxFromTheSide(), 'pedals-again.png': boxFromAbove() });
  await run.mutate([{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await openSheets(page);
  await page.locator('[data-testid="sheet-device"][data-title="Pedals"]').click();
  await page.getByTestId('sheet-photo-drawing').click();
  await expect(page.getByTestId('editor-mode')).toHaveAttribute('data-mode', 'photos');
  const p = placer(page);
  await expect(p.ask).toHaveText('This device is not connected.');
  await expect(p.more).toContainText('Click a control under Not placed yet');
  // Nothing reports what the pedals have while they are unplugged: the list is what is
  // bound on them in the chosen aircraft (three axes and a hat in this scenario).
  await expect(p.progress).toHaveText('0 of 4 controls placed');
  await p.chip('axis:Z').click();
  await expect(p.ask).toHaveText('Z axis: click where it is on the photo.');
  await expect(p.more).toHaveText('Picked the wrong one? Click another.');
  await p.click(0.5, 0.7);
  await expect(p.dot('axis-Z')).toBeVisible();
  await expect(p.ask).toHaveText('Z axis is placed. Click the next one under Not placed yet.');
  // The photo is taller than the window here: the line that says what to do stays in sight.
  await expect(p.prompt).toBeInViewport();
  await expect(page.getByTestId('photo-unplaced-text')).toHaveText(
    'Not placed yet: X axis, Y axis, Hat 1.'
  );
  await shot('not-connected');

  // The photo is replaced by another: what is placed stays on it.
  const image = p.canvas.locator('image');
  const first = await image.getAttribute('href');
  await page.getByTestId('photo-view-replace').click();
  await expect(p.ask).toHaveText(
    'The photo is replaced. Check that each control is still at its place.'
  );
  expect(await image.getAttribute('href')).not.toBe(first);
  await expect(p.dot('axis-Z')).toBeVisible();
  await expect(p.progress).toHaveText('1 of 4 controls placed');

  // "Label goes" puts its label on a side of the photo: saved, its block is on that side.
  const source = page.getByTestId('sheet-layout-source');
  const mode = page.getByTestId('editor-mode');
  const block = page.getByTestId('sheet-view').locator('[data-anchor="axis-Z"]');
  for (const side of ['left', 'right'] as const) {
    await p.dot('axis-Z').locator('.ph-spot').click();
    await expect(p.dot('axis-Z')).toHaveClass(/\bsel\b/);
    await page.getByTestId(`photo-side-${side}`).click();
    await page.getByTestId('editor-save').click();
    await expect(source).toHaveText('Your photos, 1 of 4 controls placed');
    await expect(block).toHaveAttribute('data-side', side);
    await page.getByTestId('sheet-edit-layout').click();
    await expect(mode).toHaveAttribute('data-mode', 'photos');
  }

  // "Arrange cards myself" leaves the photos for the cards; cancelled, the photos stay.
  await page.getByTestId('photo-use-cards').click();
  await expect(mode).toHaveAttribute('data-mode', 'cards');
  await page.getByTestId('editor-cancel').click();
  await expect(source).toHaveText('Your photos, 1 of 4 controls placed');
});
