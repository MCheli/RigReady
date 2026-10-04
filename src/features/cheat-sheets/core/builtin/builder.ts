import {
  LAYOUT_FORMAT,
  LAYOUT_VERSION,
  type CrossPosition,
  type DeviceLayoutInput,
  type LayoutControl,
  type LayoutGroup,
} from '../layout';

/**
 * A small drawing kit for the layouts RigReady ships. A shipped layout is data like any
 * other (it goes through the same schema as a file the user imports); this only saves
 * writing six hundred coordinates by hand.
 */

type Role = 'body' | 'panel' | 'screen' | 'line' | 'accent';
type Shape = NonNullable<DeviceLayoutInput['shapes']>[number];
type Pin = { x: number; y: number };

export class LayoutBuilder {
  private readonly shapes: Shape[] = [];
  private readonly groups: LayoutGroup[] = [];
  private readonly controls: LayoutControl[] = [];
  private readonly used = new Set<number>();

  constructor(
    private readonly name: string,
    private readonly vendorId: string,
    private readonly productIds: string[],
    private readonly width: number,
    private height: number,
    private readonly notes?: string
  ) {}

  rect(x: number, y: number, w: number, h: number, r = 0, role: Role = 'body'): this {
    this.shapes.push({ type: 'rect', x, y, w, h, r, role });
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, role: Role = 'body'): this {
    this.shapes.push({ type: 'ellipse', cx, cy, rx, ry, role });
    return this;
  }

  line(points: number[], role: Role = 'line', closed = false): this {
    this.shapes.push({ type: 'line', points, closed, role });
    return this;
  }

  text(x: number, y: number, text: string, size = 14, role: Role = 'line'): this {
    this.shapes.push({ type: 'text', x, y, text, size, role });
    return this;
  }

  group(label: string, x: number, y: number, w: number, h: number): this {
    this.groups.push({ label, x, y, w, h });
    return this;
  }

  button(n: number, x: number, y: number, w: number, h: number, label?: string, pin?: Pin): this {
    this.used.add(n);
    this.controls.push({
      kind: 'button',
      input: `button:${n}`,
      x,
      y,
      w,
      h,
      ...(label ? { label } : {}),
      ...(pin ? { pin } : {}),
    });
    return this;
  }

  axis(name: string, x: number, y: number, w: number, h: number, label?: string, pin?: Pin): this {
    this.controls.push({
      kind: 'axis',
      input: `axis:${name}`,
      x,
      y,
      w,
      h,
      ...(label ? { label } : {}),
      ...(pin ? { pin } : {}),
    });
    return this;
  }

  /** A hat or multi-way switch. Inputs are button numbers, or 'hat:1' for a whole POV hat. */
  cross(
    label: string,
    inputs: Partial<Record<CrossPosition, number>> | `hat:${number}`,
    x: number,
    y: number,
    w: number,
    h: number,
    pin?: Pin
  ): this {
    let ids: Partial<Record<CrossPosition, string>>;
    if (typeof inputs === 'string') {
      ids = Object.fromEntries(
        (['U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'] as const).map((d) => [d, `${inputs}:${d}`])
      );
    } else {
      ids = {};
      for (const [position, n] of Object.entries(inputs) as [CrossPosition, number][]) {
        ids[position] = `button:${n}`;
        this.used.add(n);
      }
    }
    this.controls.push({ kind: 'cross', label, inputs: ids, x, y, w, h, ...(pin ? { pin } : {}) });
    return this;
  }

  /**
   * A switch with several positions, or a few controls that belong together: a labelled
   * frame with one card per item, top to bottom. Returns the y below it.
   */
  stack(
    label: string,
    x: number,
    y: number,
    w: number,
    items: [number, string?][],
    cardH = 46
  ): number {
    const head = 22;
    const pad = 6;
    items.forEach(([n, text], i) => {
      this.button(n, x + pad, y + head + i * (cardH + 4), w - 2 * pad, cardH, text);
    });
    const h = head + items.length * (cardH + 4) - 4 + pad;
    this.group(label, x, y, w, h);
    return y + h;
  }

  /** Buttons left to right. */
  row(
    numbers: number[],
    x: number,
    y: number,
    w: number,
    h: number,
    gap = 6,
    labels: (string | undefined)[] = []
  ): this {
    numbers.forEach((n, i) => this.button(n, x + i * (w + gap), y, w, h, labels[i]));
    return this;
  }

  /**
   * Every button from 1 to `count` not placed yet, in a labelled frame of rows of eight
   * at `top`. Extends the canvas to fit. Returns the y below it.
   */
  rest(label: string, top: number, count: number, columns = 8): number {
    const numbers = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !this.used.has(n));
    if (numbers.length === 0) return top;
    const margin = 20;
    const pad = 10;
    const gap = 6;
    const head = 24;
    const cardH = 54;
    const w = (this.width - 2 * margin - 2 * pad - (columns - 1) * gap) / columns;
    numbers.forEach((n, i) => {
      this.button(
        n,
        Math.round((margin + pad + (i % columns) * (w + gap)) * 10) / 10,
        top + head + Math.floor(i / columns) * (cardH + gap),
        Math.round(w * 10) / 10,
        cardH
      );
    });
    const rows = Math.ceil(numbers.length / columns);
    const h = head + rows * (cardH + gap) - gap + pad;
    this.group(label, margin, top, this.width - 2 * margin, h);
    this.height = Math.max(this.height, top + h + margin);
    return top + h;
  }

  build(): DeviceLayoutInput {
    return {
      format: LAYOUT_FORMAT,
      version: LAYOUT_VERSION,
      name: this.name,
      match: { vendorId: this.vendorId, productIds: this.productIds },
      author: 'RigReady',
      license: 'CC0-1.0',
      ...(this.notes ? { notes: this.notes } : {}),
      canvas: { width: this.width, height: this.height },
      shapes: this.shapes,
      groups: this.groups,
      controls: this.controls,
    };
  }
}
