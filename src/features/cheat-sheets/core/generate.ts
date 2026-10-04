import {
  compareControlIds,
  HAT_DIRECTIONS,
  LAYOUT_FORMAT,
  LAYOUT_VERSION,
  placedControls,
  type DeviceLayout,
  type LayoutControl,
  type LayoutGroup,
} from './layout';

/**
 * A schematic picture for a device nobody has drawn: axes as named bars, hats as
 * crosses, buttons in rows of eight in the device's own numbering, each kind in its own
 * labelled frame. Made from what the device says about itself (how many buttons, which
 * axes, how many hats), so every controller has a sheet.
 */

/** What a controller says about itself, or what its bindings imply when it is not attached. */
export interface DeviceShape {
  name: string;
  vendorId: string;
  productId: string;
  buttons: number;
  /** DirectInput axis names: X, Y, Z, RX, RY, RZ, SLIDER1, SLIDER2. */
  axes: string[];
  hats: number;
}

export const CANVAS_WIDTH = 1000;
const MARGIN = 20;
const GAP = 6;
const FRAME_PAD = 10;
const FRAME_HEAD = 24;

export const BUTTON_COLUMNS = 8;
const BUTTON_H = 54;
const AXIS_COLUMNS = 4;
const AXIS_H = 62;
const CROSS_W = 312;
const CROSS_H = 204;

const inner = CANVAS_WIDTH - 2 * MARGIN - 2 * FRAME_PAD;
const cell = (columns: number): number => (inner - (columns - 1) * GAP) / columns;

/** Cards for these ids in rows, inside one labelled frame starting at `top`. */
function frame(
  label: string,
  top: number,
  ids: string[],
  kind: 'button' | 'axis',
  columns: number,
  height: number
): { controls: LayoutControl[]; group: LayoutGroup; bottom: number } {
  const w = cell(columns);
  const controls: LayoutControl[] = ids.map((input, i) => {
    const row = Math.floor(i / columns);
    // A little air after every second row of buttons keeps long runs readable.
    const air = kind === 'button' ? Math.floor(row / 2) * 6 : 0;
    return {
      kind,
      input,
      x: round(MARGIN + FRAME_PAD + (i % columns) * (w + GAP)),
      y: round(top + FRAME_HEAD + row * (height + GAP) + air),
      w: round(w),
      h: height,
    };
  });
  const rows = Math.ceil(ids.length / columns);
  const air = kind === 'button' ? Math.floor((rows - 1) / 2) * 6 : 0;
  const h = FRAME_HEAD + rows * (height + GAP) - GAP + air + FRAME_PAD;
  return {
    controls,
    group: { label, x: MARGIN, y: top, w: CANVAS_WIDTH - 2 * MARGIN, h },
    bottom: top + h,
  };
}

const round = (v: number): number => Math.round(v * 10) / 10;

export function generateLayout(shape: DeviceShape): DeviceLayout {
  const controls: LayoutControl[] = [];
  const groups: LayoutGroup[] = [];
  let top = MARGIN;

  if (shape.axes.length > 0) {
    const made = frame(
      'Axes',
      top,
      shape.axes.map((name) => `axis:${name}`),
      'axis',
      AXIS_COLUMNS,
      AXIS_H
    );
    controls.push(...made.controls);
    groups.push(made.group);
    top = made.bottom + 14;
  }

  if (shape.hats > 0) {
    const perRow = 3;
    const rows = Math.ceil(shape.hats / perRow);
    for (let hat = 1; hat <= shape.hats; hat++) {
      const i = hat - 1;
      controls.push({
        kind: 'cross',
        label: `Hat ${hat}`,
        inputs: Object.fromEntries(HAT_DIRECTIONS.map((d) => [d, `hat:${hat}:${d}`])),
        x: MARGIN + FRAME_PAD + (i % perRow) * (CROSS_W + GAP),
        y: top + FRAME_HEAD + Math.floor(i / perRow) * (CROSS_H + GAP),
        w: CROSS_W,
        h: CROSS_H,
      });
    }
    const h = FRAME_HEAD + rows * (CROSS_H + GAP) - GAP + FRAME_PAD;
    groups.push({
      label: shape.hats === 1 ? 'Hat' : 'Hats',
      x: MARGIN,
      y: top,
      w: CANVAS_WIDTH - 2 * MARGIN,
      h,
    });
    top += h + 14;
  }

  if (shape.buttons > 0) {
    const ids = Array.from({ length: shape.buttons }, (_, i) => `button:${i + 1}`);
    const made = frame('Buttons', top, ids, 'button', BUTTON_COLUMNS, BUTTON_H);
    controls.push(...made.controls);
    groups.push(made.group);
    top = made.bottom + 14;
  }

  return {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    name: shape.name.trim() || 'Controller',
    match: { vendorId: shape.vendorId, productIds: [shape.productId] },
    notes: 'Generated from what the device reports. Arrange it in the layout editor.',
    canvas: { width: CANVAS_WIDTH, height: Math.max(top - 14 + MARGIN, 200) },
    shapes: [],
    groups,
    controls,
  };
}

/**
 * Adds a frame "More controls" below a layout for controls it does not place: the ones
 * given (those that do something, so no binding is ever left off a sheet).
 */
export function appendUnplaced(layout: DeviceLayout, ids: string[]): DeviceLayout {
  const placed = placedControls(layout);
  const missing = [...new Set(ids)].filter((id) => !placed.has(id)).sort(compareControlIds);
  if (missing.length === 0) return layout;
  const scale = layout.canvas.width / CANVAS_WIDTH;
  const made = frame('More controls', 0, missing, 'button', BUTTON_COLUMNS, BUTTON_H);
  const top = layout.canvas.height;
  const place = <T extends { x: number; y: number; w: number; h: number }>(box: T): T => ({
    ...box,
    x: round(box.x * scale),
    y: round(top + box.y * scale),
    w: round(box.w * scale),
    h: round(box.h * scale),
  });
  return {
    ...layout,
    canvas: { width: layout.canvas.width, height: round(top + (made.bottom + MARGIN) * scale) },
    groups: [...layout.groups, place(made.group)],
    controls: [
      ...layout.controls,
      ...made.controls.map((control, i): LayoutControl => {
        const id = missing[i]!;
        const box = place({ x: control.x, y: control.y, w: control.w, h: control.h });
        return { kind: id.startsWith('axis:') ? 'axis' : 'button', input: id, ...box };
      }),
    ],
  };
}

/** The shape bindings imply for a device that is not attached: enough to draw its sheet. */
export function shapeFromControls(
  device: { name: string; vendorId?: string; productId?: string },
  ids: Iterable<string>
): DeviceShape {
  let buttons = 0;
  let hats = 0;
  const axes = new Set<string>();
  for (const id of ids) {
    const [kind, a] = id.split(':');
    if (kind === 'button') buttons = Math.max(buttons, Number(a));
    else if (kind === 'hat') hats = Math.max(hats, Number(a));
    else if (kind === 'axis' && a) axes.add(a);
  }
  const order = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1', 'SLIDER2'];
  return {
    name: device.name,
    vendorId: device.vendorId ?? '0000',
    productId: device.productId ?? '0000',
    buttons,
    axes: [...axes].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    hats,
  };
}
