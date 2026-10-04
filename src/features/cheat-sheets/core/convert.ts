import {
  DeviceLayoutSchema,
  LAYOUT_FORMAT,
  LAYOUT_VERSION,
  MAX_BACKGROUND_CHARS,
  type DeviceLayout,
  type LayoutControl,
} from './layout';

/**
 * Turns a Joystick Diagrams template (an SVG the user supplies) into a RigReady layout.
 * Those templates are drawings with placeholder texts where labels go: BUTTON_12,
 * AXIS_X, POV_1_U. The drawing becomes the layout's background image and every
 * placeholder becomes a control at the same place. RigReady ships none of those
 * templates (they are GPL); this only reads a file the user already has.
 */

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, k: Matrix): Matrix => [
  m[0] * k[0] + m[2] * k[1],
  m[1] * k[0] + m[3] * k[1],
  m[0] * k[2] + m[2] * k[3],
  m[1] * k[2] + m[3] * k[3],
  m[0] * k[4] + m[2] * k[5] + m[4],
  m[1] * k[4] + m[3] * k[5] + m[5],
];

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** translate(), scale(), matrix() and rotate() of an SVG transform attribute. */
export function parseTransform(value: string | undefined): Matrix {
  let matrix = IDENTITY;
  if (!value) return matrix;
  for (const [, name, args] of value.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = (args ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (v.some((x) => !Number.isFinite(x))) continue;
    if (name === 'translate') matrix = multiply(matrix, [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]);
    else if (name === 'scale')
      matrix = multiply(matrix, [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]);
    else if (name === 'matrix' && v.length === 6) matrix = multiply(matrix, v as Matrix);
    else if (name === 'rotate') {
      const a = ((v[0] ?? 0) * Math.PI) / 180;
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
      matrix = multiply(matrix, [1, 0, 0, 1, cx, cy]);
      matrix = multiply(matrix, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
      matrix = multiply(matrix, [1, 0, 0, 1, -cx, -cy]);
    }
  }
  return matrix;
}

function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, a, b] of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[name!.toLowerCase()] = a ?? b ?? '';
  }
  return out;
}

const SLIDERS: Record<string, string> = {
  SLIDER: 'SLIDER1',
  SLIDER_1: 'SLIDER1',
  SLIDER1: 'SLIDER1',
  SL0: 'SLIDER1',
  SLIDER_0: 'SLIDER1',
  SLIDER_2: 'SLIDER2',
  SLIDER2: 'SLIDER2',
  SL1: 'SLIDER2',
};

/** The control a placeholder stands for; undefined for modifier variants and other text. */
export function placeholderControl(
  text: string
): { id: string; kind: 'button' | 'axis' } | undefined {
  const value = text.trim().toUpperCase();
  const button = /^BUTTON_(\d{1,3})$/.exec(value);
  if (button && Number(button[1]) > 0) return { id: `button:${Number(button[1])}`, kind: 'button' };
  const pov = /^POV_(\d)_(U|UR|R|DR|D|DL|L|UL)$/.exec(value);
  if (pov) return { id: `hat:${pov[1]}:${pov[2]}`, kind: 'button' };
  const axis = /^AXIS_(X|Y|Z|RX|RY|RZ|SLIDER(?:_?\d)?|SL\d)$/.exec(value);
  if (axis) return { id: `axis:${SLIDERS[axis[1]!] ?? axis[1]}`, kind: 'axis' };
  return undefined;
}

export interface ConvertTarget {
  name: string;
  vendorId: string;
  productId: string;
}

export function convertJoystickDiagrams(
  svg: string,
  target: ConvertTarget
): { ok: true; layout: DeviceLayout; skipped: string[] } | { ok: false; reason: string } {
  const root = /<svg\b([^>]*)>/i.exec(svg);
  if (!root) return { ok: false, reason: 'It is not an SVG file.' };
  const rootAttrs = attributes(root[1] ?? '');
  const box = (rootAttrs['viewbox'] ?? '').split(/[\s,]+/).map(Number);
  let [minX, minY, width, height] = [
    0,
    0,
    parseFloat(rootAttrs['width'] ?? ''),
    parseFloat(rootAttrs['height'] ?? ''),
  ];
  if (box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) {
    [minX, minY, width, height] = box as [number, number, number, number];
  }
  if (!(width > 0) || !(height > 0)) {
    return {
      ok: false,
      reason: 'The SVG does not say how large it is (no viewBox or width and height).',
    };
  }

  // Walk the tags, keeping the transform of every open element.
  const stack: Matrix[] = [IDENTITY];
  const found = new Map<string, { kind: 'button' | 'axis'; x: number; y: number; size: number }>();
  const skipped: string[] = [];
  let text: { content: string; x?: number; y?: number; size: number; matrix: Matrix } | undefined;
  const tags = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (const match of svg.matchAll(tags)) {
    const [, closing, rawName, attrText, selfClosing, chars] = match;
    if (chars !== undefined) {
      if (text) text.content += chars;
      continue;
    }
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    if (closing) {
      if (name === 'text' && text) {
        const placeholder = placeholderControl(text.content);
        if (placeholder && text.x !== undefined && text.y !== undefined) {
          const [x, y] = apply(text.matrix, text.x, text.y);
          if (!found.has(placeholder.id)) {
            found.set(placeholder.id, { kind: placeholder.kind, x, y, size: text.size });
          }
        } else if (/^(BUTTON|AXIS|POV)_/i.test(text.content.trim())) {
          skipped.push(text.content.trim());
        }
        text = undefined;
      }
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = attributes(attrText ?? '');
    const matrix = multiply(stack[stack.length - 1]!, parseTransform(attrs['transform']));
    const fontSize = parseFloat(
      attrs['font-size'] ?? /font-size:\s*([\d.]+)/.exec(attrs['style'] ?? '')?.[1] ?? ''
    );
    if (name === 'text') {
      text = { content: '', size: Number.isFinite(fontSize) ? fontSize : 0, matrix };
      if (attrs['x'] !== undefined) text.x = parseFloat(attrs['x']);
      if (attrs['y'] !== undefined) text.y = parseFloat(attrs['y']);
    } else if (name === 'tspan' && text) {
      if (text.x === undefined && attrs['x'] !== undefined) text.x = parseFloat(attrs['x']);
      if (text.y === undefined && attrs['y'] !== undefined) text.y = parseFloat(attrs['y']);
      if (!text.size && Number.isFinite(fontSize)) text.size = fontSize;
    }
    if (!selfClosing) stack.push(matrix);
  }
  if (found.size === 0) {
    return {
      ok: false,
      reason:
        'No BUTTON_n, AXIS_x or POV_n_x placeholders were found, so this does not look like a Joystick Diagrams template.',
    };
  }

  // The drawing without its placeholder texts and without anything that could run.
  const drawing = svg
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/>(\s*)(?:BUTTON_\d+\w*|AXIS_\w+|POV_\d_\w+)(\s*)</gi, '>$1$2<');
  const image = `data:image/svg+xml;base64,${Buffer.from(drawing, 'utf8').toString('base64')}`;
  if (image.length > MAX_BACKGROUND_CHARS) {
    return { ok: false, reason: 'The drawing is too large to keep in a layout (over about 6 MB).' };
  }

  // Layouts are 1000 wide, so label text comes out the same size as on any other sheet.
  const scale = 1000 / width;
  const cardW = 124;
  const cardH = 46;
  const controls: LayoutControl[] = [...found.entries()].map(([id, at]) => {
    const x = (at.x - minX) * scale;
    const y = (at.y - minY) * scale - (at.size || 10) * scale * 0.9;
    return {
      kind: at.kind,
      input: id,
      x: Math.round(Math.max(0, Math.min(1000 - cardW, x)) * 10) / 10,
      y: Math.round(Math.max(0, Math.min(height * scale - cardH, y)) * 10) / 10,
      w: cardW,
      h: cardH,
    };
  });
  const parsed = DeviceLayoutSchema.safeParse({
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    name: target.name,
    match: { vendorId: target.vendorId, productIds: [target.productId] },
    notes:
      'Converted from a Joystick Diagrams template. Check where the cards landed and adjust them in the layout editor.',
    canvas: { width: 1000, height: Math.round(height * scale) },
    background: { image, x: 0, y: 0, w: 1000, h: Math.round(height * scale), opacity: 1 },
    shapes: [],
    groups: [],
    controls,
  });
  if (!parsed.success) return { ok: false, reason: parsed.error.message };
  return { ok: true, layout: parsed.data, skipped: [...new Set(skipped)] };
}
