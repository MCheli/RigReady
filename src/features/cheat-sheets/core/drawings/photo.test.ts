import { describe, expect, it } from 'vitest';
import { generateLayout } from '../generate';
import { knownDeviceFor } from '../known';
import { kneeboardDevicePage, KNEEBOARD_FILL } from '../pages';
import { pictureFor, planPicture, renderPictureSvg } from '../picture';
import type { SheetControl, SheetDevice } from '../sheet';
import {
  crossings,
  MAX_VIEWS,
  parseDrawing,
  photo as photos,
  type DeviceDrawing,
  type Photo,
} from './index';

/**
 * A drawing made from the user's own photos: several named photos one under the other,
 * a control put on a photo by pressing it and clicking its place, the ways of one hat at
 * one place, and what is said about a drawing that is only half done.
 */

/** A tiny real PNG, standing in for a photo. Its size in pixels is said beside it. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAFklEQVR4nGNsaGhgwAaYsIoOWgkAVXYBjYpOvYQAAAAASUVORK5CYII=';
const shot = (width: number, height: number, image = PNG): Photo => ({ image, width, height });

/** A made-up button box: twelve buttons, two axes and a hat. Nothing is known about it. */
const BOX = { title: 'Button box', vendorId: '1209', productId: 'ab01' };
const REPORTS = { buttons: 12, axes: ['X', 'Y'], hats: 1 };

const button = (n: number) => photos.controlOfInput(`button:${n}`);
const idsOf = (drawing: DeviceDrawing): string[] => drawing.controls.map((c) => c.id);
const at = (drawing: DeviceDrawing, id: string) => drawing.controls.find((c) => c.id === id)?.at;

/** The Thrustmaster HOTAS Warthog throttle: RigReady knows its controls by name. */
const WARTHOG = knownDeviceFor({ vendorId: '044F', productId: '0404' })!.controls;

describe('the photos of a drawing', () => {
  it('starts from one photo, as wide as the drawing, with nothing placed and so not yet a drawing to save', () => {
    const drawing = photos.photoDrawing(BOX, shot(1000, 800));
    expect(drawing).toMatchObject({
      name: 'Button box (my photos)',
      match: { vendorId: '1209', productIds: ['AB01'], names: [] },
      size: { width: 500, height: 400 },
      views: [{ name: 'Photo 1', image: PNG, x: 0, y: 0, w: 500, h: 400 }],
      paths: [],
      controls: [],
    });
    expect(photos.isPhotoDrawing(drawing)).toBe(true);
    // One photo has no name over it.
    expect(photos.viewsAreNamed(drawing.views!)).toBe(false);
    // Nothing placed: the format asks for one control at least.
    expect(parseDrawing(drawing).ok).toBe(false);
    const placed = photos.place(drawing, button(5), { x: 100, y: 100 });
    expect(parseDrawing(placed)).toMatchObject({ ok: true });
    // A strip or a tower of a photo is kept to a shape a page can hold.
    expect(photos.photoDrawing(BOX, shot(1000, 50)).size).toEqual({ width: 500, height: 120 });
    expect(photos.photoDrawing(BOX, shot(100, 1000)).size).toEqual({ width: 500, height: 1400 });
  });

  it('adds photos under the first, each with a name over it, and keeps every control on its photo', () => {
    let drawing = photos.photoDrawing(BOX, shot(1000, 800));
    drawing = photos.place(drawing, button(1), { x: 250, y: 200 });
    expect(photos.nextViewName(drawing)).toBe('Photo 2');
    const two = photos.addView(drawing, shot(800, 800), 'Back')!;
    // Room for a name over each: 28 over the first, 16 between them and 28 over the second.
    expect(two.views).toMatchObject([
      { name: 'Photo 1', x: 0, y: 28, w: 500, h: 400 },
      { name: 'Back', x: 0, y: 472, w: 500, h: 500 },
    ]);
    expect(two.size).toEqual({ width: 500, height: 972 });
    expect(photos.viewsAreNamed(two.views!)).toBe(true);
    // The button is still in the middle of the first photo.
    expect(at(two, 'button-1')).toEqual({ x: 250, y: 228 });
    expect(parseDrawing(two)).toMatchObject({ ok: true });

    // No more than the drawing can hold.
    let full = two;
    for (let n = 3; n <= MAX_VIEWS; n++) full = photos.addView(full, shot(400, 300))!;
    expect(full.views).toHaveLength(MAX_VIEWS);
    expect(full.views!.map((view) => view.name)).toEqual([
      'Photo 1',
      'Back',
      'Photo 3',
      'Photo 4',
      'Photo 5',
      'Photo 6',
    ]);
    expect(photos.addView(full, shot(400, 300))).toBeUndefined();
    expect(parseDrawing(full)).toMatchObject({ ok: true });
  });

  it('renames a photo, replaces one with its controls where they were, and removes one with what was on it', () => {
    let drawing = photos.photoDrawing(BOX, shot(1000, 800));
    drawing = photos.addView(drawing, shot(800, 800), 'Back')!;
    drawing = photos.place(drawing, button(1), { x: 250, y: 228 });
    drawing = photos.place(drawing, button(2), { x: 100, y: 972 });
    expect(photos.viewAt(drawing.views!, at(drawing, 'button-1')!)).toBe(0);
    expect(photos.viewAt(drawing.views!, at(drawing, 'button-2')!)).toBe(1);

    const named = photos.renameView(drawing, 0, '  Front  ');
    expect(named.views!.map((view) => view.name)).toEqual(['Front', 'Back']);
    expect(photos.renameView(named, 0, '   ').views![0]!.name).toBe('Front');
    expect(named.controls).toEqual(drawing.controls);

    // A flatter photo in place of the first: the button is still in its middle, the second
    // photo and its button moved up with it.
    const replaced = photos.replaceView(named, 0, shot(1000, 400));
    expect(replaced.views).toMatchObject([
      { name: 'Front', y: 28, h: 200 },
      { name: 'Back', y: 272, h: 500 },
    ]);
    expect(at(replaced, 'button-1')).toEqual({ x: 250, y: 128 });
    expect(at(replaced, 'button-2')).toEqual({ x: 100, y: 772 });

    // The first photo removed: its button is not placed any more, the other one stays on
    // its photo, which has no name over it now that it is alone.
    const alone = photos.removeView(replaced, 0);
    expect(alone.views).toMatchObject([{ name: 'Back', y: 0, h: 500 }]);
    expect(idsOf(alone)).toEqual(['button-2']);
    expect(at(alone, 'button-2')).toEqual({ x: 100, y: 500 });
  });

  it('reads a drawing with one picture, as they were made before, as one photo', () => {
    const before: DeviceDrawing = {
      ...photos.photoDrawing(BOX, shot(1000, 800)),
      image: PNG,
      controls: [{ ...button(3), at: { x: 250, y: 200 } }],
    };
    delete before.views;
    expect(photos.isPhotoDrawing(before)).toBe(true);
    expect(photos.photoViews(before)).toEqual([
      { name: 'Photo 1', image: PNG, x: 0, y: 0, w: 500, h: 400 },
    ]);
    const two = photos.addView(before, shot(500, 500))!;
    expect(two.image).toBeUndefined();
    expect(two.views!.map((view) => view.name)).toEqual(['Photo 1', 'Photo 2']);
    expect(at(two, 'button-3')).toEqual({ x: 250, y: 228 });
    // A drawing of paths is not one of photos.
    expect(photos.isPhotoDrawing({ size: before.size })).toBe(false);
  });
});

describe('a control on a photo', () => {
  it('is the button or axis that was pressed, or the whole hat for one way of it', () => {
    expect(button(5)).toMatchObject({
      id: 'button-5',
      name: 'Button 5',
      glyph: 'button',
      inputs: [{ id: 'button:5' }],
    });
    expect(photos.controlOfInput('axis:Z')).toMatchObject({
      id: 'axis-Z',
      name: 'Z axis',
      glyph: 'axis',
      inputs: [{ id: 'axis:Z' }],
    });
    const hat = photos.controlOfInput('hat:1:R');
    expect(hat).toMatchObject({ id: 'hat-1', name: 'Hat 1', glyph: 'hat' });
    expect(hat.inputs.map((input) => `${input.tag} ${input.id}`)).toEqual([
      '↑ hat:1:U',
      '↗ hat:1:UR',
      '→ hat:1:R',
      '↘ hat:1:DR',
      '↓ hat:1:D',
      '↙ hat:1:DL',
      '← hat:1:L',
      '↖ hat:1:UL',
    ]);
  });

  it('is the whole control by its maker’s name on a model RigReady knows the controls of', () => {
    // One way of the mic switch is all five of its ways.
    const mic = photos.controlOfInput('button:3', WARTHOG);
    expect(mic).toMatchObject({ id: 'ms', name: 'MS mic switch', glyph: 'hat' });
    expect(mic.inputs.map((input) => input.id)).toEqual([
      'button:3',
      'button:4',
      'button:5',
      'button:6',
      'button:2',
    ]);
    expect(photos.controlOfInput('axis:RZ', WARTHOG)).toMatchObject({
      id: 'throttles',
      name: 'Throttles',
      glyph: 'axis',
      inputs: [
        { id: 'axis:RZ', tag: 'Left' },
        { id: 'axis:Z', tag: 'Right' },
      ],
    });
    expect(photos.controlOfInput('button:15', WARTHOG)).toMatchObject({
      id: 'ltb',
      name: 'LTB left throttle button',
      glyph: 'button',
    });
    // A four-way hat pushed to a corner is still that hat, not a second one.
    expect(photos.controlOfInput('hat:1:U', WARTHOG).id).toBe('coolie');
    expect(photos.controlOfInput('hat:1:UR', WARTHOG).id).toBe('coolie');
    // What the names do not cover is still a control by itself.
    expect(photos.controlOfInput('button:40', WARTHOG).id).toBe('button-40');
  });

  it('groups the ways of a hat that reports buttons, and its press, into one control', () => {
    const hat = photos.hatGroup(
      {
        up: 'button:7',
        right: 'button:8',
        down: 'button:9',
        left: 'button:10',
        press: 'button:11',
      },
      'Hat 2'
    )!;
    expect(hat).toMatchObject({ id: 'hat-button-7', name: 'Hat 2', glyph: 'hat' });
    expect(hat.inputs).toEqual([
      { id: 'button:7', tag: '↑' },
      { id: 'button:8', tag: '→' },
      { id: 'button:9', tag: '↓' },
      { id: 'button:10', tag: '←' },
      { id: 'button:11', tag: 'press' },
    ]);
    // A rocker has two ways only; the same button heard twice counts once.
    expect(photos.hatGroup({ up: 'button:7', down: 'button:9' }, 'Rocker')!.inputs).toEqual([
      { id: 'button:7', tag: '↑' },
      { id: 'button:9', tag: '↓' },
    ]);
    expect(photos.hatGroup({ up: 'button:7', right: 'button:7' }, 'Hat 2')!.inputs).toHaveLength(1);
    expect(photos.hatGroup({}, 'Hat 2')).toBeUndefined();

    // A hat Windows reports as a hat: all its ways, and the button it presses.
    expect(photos.povOf({ up: 'hat:1:U' })).toBe(1);
    expect(photos.povOf({ up: 'button:7' })).toBeUndefined();
    const pov = photos.hatGroup({ up: 'hat:1:U', press: 'button:4' }, 'Trim hat')!;
    expect(pov).toMatchObject({ id: 'hat-1', name: 'Trim hat', glyph: 'hat' });
    expect(pov.inputs).toHaveLength(9);
    expect(pov.inputs[8]).toEqual({ id: 'button:4', tag: 'press' });
    expect(photos.hatGroup({ up: 'hat:1:U' }, 'Hat 1')!.inputs).toHaveLength(8);
  });

  it('names the next hat after the ones Windows reports and the ones already placed', () => {
    let drawing = photos.photoDrawing(BOX, shot(1000, 800));
    expect(photos.nextHatName(drawing, REPORTS)).toBe('Hat 2');
    expect(photos.nextHatName(drawing, undefined)).toBe('Hat 1');
    drawing = photos.place(drawing, photos.hatGroup({ up: 'button:7' }, 'Hat 2')!, { x: 9, y: 9 });
    expect(photos.nextHatName(drawing, REPORTS)).toBe('Hat 3');
  });

  it('is placed, moved, taken off, named and given a side, always on a photo', () => {
    let drawing = photos.photoDrawing(BOX, shot(1000, 800));
    drawing = photos.addView(drawing, shot(800, 800), 'Back')!;
    drawing = photos.place(drawing, button(1), { x: 120.4, y: 100.6 });
    expect(at(drawing, 'button-1')).toEqual({ x: 120, y: 101 });
    expect(photos.controlWith(drawing, 'button:1')?.id).toBe('button-1');
    expect(photos.controlWith(drawing, 'button:2')).toBeUndefined();

    // Placed again is moved: still one control.
    drawing = photos.place(drawing, button(1), { x: 300, y: 600 });
    expect(idsOf(drawing)).toEqual(['button-1']);
    expect(at(drawing, 'button-1')).toEqual({ x: 300, y: 600 });

    // Never between two photos, on the name of one, or off the side: the nearest photo.
    drawing = photos.moveTo(drawing, 'button-1', { x: -40, y: 440 });
    expect(at(drawing, 'button-1')).toEqual({ x: 0, y: 428 });
    drawing = photos.moveTo(drawing, 'button-1', { x: 900, y: 465 });
    expect(at(drawing, 'button-1')).toEqual({ x: 500, y: 472 });
    expect(photos.ontoPhoto(drawing, { x: 250, y: 5 })).toEqual({ x: 250, y: 28 });

    drawing = photos.renameControl(drawing, 'button-1', '  Gear lever  ');
    expect(drawing.controls[0]!.name).toBe('Gear lever');
    expect(photos.renameControl(drawing, 'button-1', '  ').controls[0]!.name).toBe('Gear lever');
    expect(
      photos.renameControl(drawing, 'button-1', 'x'.repeat(90)).controls[0]!.name
    ).toHaveLength(60);
    drawing = photos.sideControl(drawing, 'button-1', 'left');
    expect(drawing.controls[0]!.side).toBe('left');
    drawing = photos.sideControl(drawing, 'button-1', undefined);
    expect('side' in drawing.controls[0]!).toBe(false);

    expect(idsOf(photos.takeOff(drawing, 'button-1'))).toEqual([]);
    expect(idsOf(photos.takeOff(drawing, 'nothing'))).toEqual(['button-1']);
  });

  it('takes a button placed alone into the hat it turns out to be a way of', () => {
    let drawing = photos.photoDrawing(BOX, shot(1000, 800));
    drawing = photos.place(drawing, button(7), { x: 100, y: 100 });
    drawing = photos.place(drawing, button(12), { x: 400, y: 300 });
    const hat = photos.hatGroup({ up: 'button:7', down: 'button:9' }, 'Hat 2')!;
    drawing = photos.place(drawing, hat, { x: 200, y: 200 });
    expect(idsOf(drawing)).toEqual(['button-12', 'hat-button-7']);
    expect(photos.controlWith(drawing, 'button:7')?.id).toBe('hat-button-7');
    // No input is on the drawing twice: it is still a drawing the format takes.
    expect(parseDrawing(drawing)).toMatchObject({ ok: true });

    // And the other way: a hat that loses one of its ways keeps the rest.
    drawing = photos.place(drawing, button(9), { x: 300, y: 100 });
    expect(photos.controlWith(drawing, 'button:9')?.id).toBe('button-9');
    expect(drawing.controls.find((c) => c.id === 'hat-button-7')!.inputs).toEqual([
      { id: 'button:7', tag: '↑' },
    ]);
    expect(parseDrawing(drawing)).toMatchObject({ ok: true });
  });
});

describe('what is placed and what is not', () => {
  it('counts every button, axis and hat once and says what is left in words', () => {
    let drawing = photos.photoDrawing(BOX, shot(1000, 800));
    const none = photos.placement(drawing, REPORTS, ['button:5', 'hat:1:U']);
    expect(none).toMatchObject({
      total: 15,
      placed: 0,
      text: 'Buttons 1 to 12, X axis, Y axis, Hat 1',
    });
    expect(none.unplaced.map((u) => u.key)).toEqual([
      'axis:X',
      'axis:Y',
      'hat:1',
      ...Array.from({ length: 12 }, (_, i) => `button:${i + 1}`),
    ]);
    // What is bound is marked: a button, and the hat for one way of it.
    expect(none.unplaced.filter((u) => u.bound).map((u) => u.key)).toEqual(['hat:1', 'button:5']);
    expect(none.unplaced.find((u) => u.key === 'button:5')).toEqual({
      key: 'button:5',
      label: '5',
      input: 'button:5',
      bound: true,
    });
    expect(none.unplaced.find((u) => u.key === 'hat:1')).toMatchObject({
      label: 'Hat 1',
      input: 'hat:1:D',
    });

    drawing = photos.place(drawing, button(1), { x: 10, y: 10 });
    drawing = photos.place(drawing, button(2), { x: 20, y: 10 });
    drawing = photos.place(drawing, button(4), { x: 30, y: 10 });
    drawing = photos.place(drawing, button(7), { x: 40, y: 10 });
    drawing = photos.place(drawing, button(10), { x: 50, y: 10 });
    drawing = photos.place(drawing, photos.controlOfInput('hat:1:L'), { x: 60, y: 10 });
    drawing = photos.place(drawing, photos.controlOfInput('axis:X'), { x: 70, y: 10 });
    expect(photos.placement(drawing, REPORTS, [])).toMatchObject({
      total: 15,
      placed: 7,
      text: 'Button 3, Buttons 5 and 6, Buttons 8 and 9, Buttons 11 and 12, Y axis',
    });

    // Something bound that the device does not report (it is not attached) counts too.
    expect(photos.placement(drawing, undefined, ['button:40', 'button:1'])).toMatchObject({
      total: 8,
      placed: 7,
      text: 'Button 40',
    });

    // All of it placed.
    for (const n of [3, 5, 6, 8, 9, 11, 12]) {
      drawing = photos.place(drawing, button(n), { x: 10 * n, y: 50 });
    }
    drawing = photos.place(drawing, photos.controlOfInput('axis:Y'), { x: 70, y: 90 });
    expect(photos.placement(drawing, REPORTS, [])).toEqual({
      total: 15,
      placed: 15,
      unplaced: [],
      text: '',
    });
  });

  it('counts a control with a name of its maker’s once, with all its ways', () => {
    const reports = { buttons: 32, axes: ['X', 'Y', 'Z', 'RZ', 'SLIDER1'], hats: 1 };
    let drawing = photos.photoDrawing(
      { title: 'Throttle', vendorId: '044F', productId: '0404' },
      shot(1200, 900)
    );
    const none = photos.placement(drawing, reports, ['button:4'], WARTHOG);
    // Twenty controls by name stand for 32 buttons, five axes and a hat.
    expect(none.total).toBe(WARTHOG.length);
    expect(none.total).toBe(20);
    expect(none.placed).toBe(0);
    expect(none.unplaced.map((u) => u.key)).toContain('named:ms');
    expect(none.unplaced.find((u) => u.key === 'named:ms')).toMatchObject({
      label: 'MS mic switch',
      bound: true,
    });
    expect(none.unplaced.find((u) => u.key === 'named:coolie')).toMatchObject({
      label: 'Coolie switch',
      bound: false,
    });
    expect(none.text).toContain('MS mic switch');
    expect(none.text).not.toMatch(/Button \d|Hat 1/);

    drawing = photos.place(drawing, photos.controlOfInput('button:3', WARTHOG), { x: 80, y: 80 });
    drawing = photos.place(drawing, photos.controlOfInput('hat:1:U', WARTHOG), { x: 90, y: 90 });
    const two = photos.placement(drawing, reports, ['button:4'], WARTHOG);
    expect(two).toMatchObject({ total: 20, placed: 2 });
    expect(two.unplaced.map((u) => u.key)).not.toContain('named:ms');
    expect(two.unplaced.map((u) => u.key)).not.toContain('named:coolie');
    // The corners of the four-way hat are not a second hat left to place.
    expect(two.unplaced.map((u) => u.key)).not.toContain('hat:1');
  });
});

// ---- on the sheet ----

function bound(id: string, short: string): SheetControl {
  return {
    id,
    name: id,
    bindings: [
      {
        actionId: `${id}-${short}`,
        action: short,
        short,
        modifiers: [],
        category: [],
        kind: 'systems',
        source: 'user',
        alsoOn: [],
      },
    ],
    conflict: false,
  };
}

/** The button box on a sheet, with a drawing of the user's photos saved for it. */
function boxOnSheet(drawing: DeviceDrawing, controls: SheetControl[]): SheetDevice {
  const layout = generateLayout({
    name: 'Button box',
    vendorId: '1209',
    productId: 'AB01',
    buttons: REPORTS.buttons,
    axes: REPORTS.axes,
    hats: REPORTS.hats,
  });
  return {
    key: '1209:AB01',
    name: 'Button box',
    title: 'Button box',
    vendorId: '1209',
    productId: 'AB01',
    connected: true,
    reports: REPORTS,
    layout: { ...layout, drawing: { anchors: {}, sides: {}, names: {}, custom: drawing } },
    layoutSource: 'user',
    controls,
    other: [],
    counts: { placed: 0, bound: controls.length, empty: 0, conflicts: 0, hidden: 0 },
    route: '/dcs/bindings',
  };
}

/** Two photos, a button on each, and a hat of four buttons and its press on the first. */
function halfDone(): DeviceDrawing {
  let drawing = photos.photoDrawing(BOX, shot(1000, 800));
  drawing = photos.addView(drawing, shot(800, 600), 'Back')!;
  drawing = photos.renameView(drawing, 0, 'Front');
  drawing = photos.place(drawing, button(1), { x: 120, y: 120 });
  drawing = photos.place(drawing, button(2), { x: 380, y: 700 });
  const hat = photos.hatGroup(
    { up: 'button:7', right: 'button:8', down: 'button:9', left: 'button:10', press: 'button:11' },
    'Hat 2'
  )!;
  return photos.place(drawing, hat, { x: 300, y: 250 });
}

const CONTROLS = [
  bound('button:1', 'Master arm'),
  bound('button:2', 'Gear up'),
  bound('button:5', 'Flaps down'),
  bound('button:7', 'Trim nose down'),
  bound('button:9', 'Trim nose up'),
  bound('button:11', 'Trim reset'),
  bound('hat:1:U', 'Look up'),
];

describe('a drawing of photos on the sheet', () => {
  it('is drawn like any drawing: each photo with its name, a label block per control, the ways of a hat in one block', () => {
    const device = boxOnSheet(halfDone(), CONTROLS);
    const picture = pictureFor(device);
    expect(picture).toMatchObject({ kind: 'drawing', source: 'custom' });
    const plan = planPicture(device, { showEmpty: true })!;
    expect(plan.placed).toBeDefined();
    expect(crossings(plan.callouts)).toBe(0);
    // One block for the hat, with a row per way that does something.
    const hat = plan.callouts.find((c) => c.control.id === 'hat-button-7')!;
    // The hat has a name, and keeps its numbers. A control still called by its number
    // says the number once.
    expect(hat.head).toBe('Hat 2 · 7–11');
    expect(plan.callouts.find((c) => c.control.id === 'button-1')?.head).toBe('Button 1');
    expect(hat.rows.filter((row) => row.kind).map((row) => `${row.id} ${row.text}`)).toEqual([
      expect.stringMatching(/^button:7 .*Trim nose down$/),
      expect.stringMatching(/^button:9 .*Trim nose up$/),
      expect.stringMatching(/^button:11 .*Trim reset$/),
    ]);

    const svg = renderPictureSvg(device, { theme: 'dark', showEmpty: true });
    expect(svg.match(/<image class="cs-view"/g)).toHaveLength(2);
    expect(svg).toContain('>Front</text>');
    expect(svg).toContain('>Back</text>');
    // A pale spot under each marker and a pale edge on each leader, to show on any photo.
    expect(svg.match(/class="cs-photo-spot"/g)).toHaveLength(3);
    expect(svg.match(/class="cs-lead-halo"/g)).toHaveLength(plan.callouts.length);
    expect(svg).not.toMatch(/<script|javascript:/i);
  });

  it('never leaves out what is not placed yet: it is in the list under the photos, and a press of it lights', () => {
    const device = boxOnSheet(halfDone(), CONTROLS);
    const plan = planPicture(device, { showEmpty: true })!;
    // Bound and not placed: Flaps on button 5, Look up on the hat Windows reports.
    expect(plan.extras.filter((row) => row.kind).map((row) => row.id)).toEqual([
      'hat:1:U',
      'button:5',
    ]);
    const svg = renderPictureSvg(device, { theme: 'dark', showEmpty: true });
    expect(svg).toContain('MORE CONTROLS · not placed on a photo yet');
    expect(svg).not.toContain('not on the drawing');
    // Everything the device reports is something the page can light when it is pressed.
    for (const id of [
      'button:1',
      'button:5',
      'button:7',
      'button:11',
      'button:3',
      'button:12',
      'axis:X',
      'hat:1:U',
      'hat:1:DL',
    ]) {
      expect(svg, id).toContain(`data-control="${id}"`);
    }
    // With the empty controls hidden, what is bound and not placed is still listed.
    const bare = renderPictureSvg(device, { theme: 'dark', showEmpty: false });
    expect(bare).toContain('data-control="button:5"');
    expect(bare).not.toContain('data-control="button:3"');

    // The trainer leaves the words off and keeps every control that does something.
    const quiet = renderPictureSvg(
      { ...device, controls: [] },
      { theme: 'dark', showEmpty: true, listed: CONTROLS.map((c) => c.id) }
    );
    for (const control of CONTROLS) expect(quiet).toContain(`data-control="${control.id}"`);
    expect(quiet).not.toContain('Flaps down');
  });

  it('makes tall photos smaller to fit a kneeboard page, the labels kept at a size to read', () => {
    let drawing = photos.photoDrawing(BOX, shot(600, 900));
    drawing = photos.addView(drawing, shot(600, 900), 'Back')!;
    drawing = photos.addView(drawing, shot(600, 900), 'Left side')!;
    drawing = photos.place(drawing, button(1), { x: 120, y: 120 });
    drawing = photos.place(drawing, button(2), { x: 380, y: 1000 });
    drawing = photos.place(drawing, button(5), { x: 250, y: 1900 });
    const device = boxOnSheet(drawing, CONTROLS);
    // Three photos one under the other are far taller than a page.
    expect(drawing.size.height).toBeGreaterThan(1.5 * KNEEBOARD_FILL);
    const own = planPicture(device, { showEmpty: false })!;
    expect(own.height).toBeGreaterThan(KNEEBOARD_FILL);

    const page = planPicture(device, {
      showEmpty: false,
      fontScale: 1.12,
      fill: KNEEBOARD_FILL,
      maxFontScale: 1.55,
    })!;
    expect(page.height).toBeLessThanOrEqual(KNEEBOARD_FILL);
    expect(page.placed!.scale).toBeLessThan(own.placed!.scale);
    expect(page.placed!.scale).toBeGreaterThanOrEqual(0.3);
    expect(page.callouts[0]!.size).toBeGreaterThanOrEqual(own.callouts[0]!.size);
    expect(crossings(page.callouts)).toBe(0);
    for (const callout of page.callouts) {
      expect(callout.x).toBeGreaterThanOrEqual(0);
      expect(callout.x + callout.w).toBeLessThanOrEqual(page.width);
      expect(callout.y + callout.h).toBeLessThanOrEqual(page.height);
    }

    // The kneeboard page of the device carries the photos and every label.
    const html = kneeboardDevicePage(
      {
        game: 'dcs',
        gameName: 'DCS World',
        aircraft: { id: 'FA-18C_hornet', name: 'F/A-18C', hasUserBindings: true },
        devices: [device],
      } as never,
      device,
      { style: 'light', stamp: '2026-11-12' }
    );
    expect(html.match(/<image class="cs-view"/g)).toHaveLength(3);
    expect(html).toContain('Master arm');
    expect(html).toContain('Flaps down');
  });
});
