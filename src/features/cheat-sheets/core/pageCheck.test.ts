import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { chunk, solidPng } from '../../../platform/fake/png';
import { CATEGORIES } from './categories';
import { decodePng, marksOf, pageComplete, showsMark } from './pageCheck';
import { END_MARK } from './pages';
import { THEMES } from './render';

/**
 * The check after rendering: a list page must show the bar that ends its list. These
 * tests make their own pictures, with every row filter a PNG writer may use.
 */

type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const rgbOf = (colour: string): Rgb =>
  [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16)) as Rgb;
const MARK = END_MARK.light;

interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  colour: Rgb;
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** A PNG of a background with bars on it; row y is written with filter `filterOf(y)`. */
function picture(
  width: number,
  height: number,
  bars: Bar[],
  options: { alpha?: boolean; background?: Rgb; filterOf?: (y: number) => number } = {}
): Uint8Array {
  const step = options.alpha ? 4 : 3;
  const stride = width * step;
  const pixels = new Uint8Array(stride * height);
  const paint = (x: number, y: number, colour: Rgb): void => {
    pixels.set(options.alpha ? [...colour, 255] : colour, y * stride + x * step);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) paint(x, y, options.background ?? WHITE);
  }
  for (const bar of bars) {
    for (let y = bar.y; y < Math.min(height, bar.y + bar.height); y++) {
      for (let x = bar.x; x < Math.min(width, bar.x + bar.width); x++) paint(x, y, bar.colour);
    }
  }
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = options.filterOf?.(y) ?? 0;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const value = pixels[y * stride + x]!;
      const left = x >= step ? pixels[y * stride + x - step]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= step ? pixels[(y - 1) * stride + x - step]! : 0;
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter] ?? 0;
      raw[y * (stride + 1) + 1 + x] = (value - predicted) & 0xff;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = options.alpha ? 6 : 2;
  const packed = zlibSync(raw);
  // Two IDAT chunks, as a writer may split the data.
  const half = Math.floor(packed.length / 2);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', packed.subarray(0, half)),
    chunk('IDAT', packed.subarray(half)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const bar = (over: Partial<Bar> = {}): Bar => ({
  x: 30,
  y: 40,
  width: 44,
  height: 6,
  colour: rgbOf(MARK),
  ...over,
});
const shows = (png: Uint8Array, colour = MARK): boolean => {
  const pixels = decodePng(png);
  if (!pixels.ok) throw new Error(pixels.error.message);
  return showsMark(pixels.value, colour);
};
const page = (marks: string[]): string =>
  `<html><body>${marks.map((mark) => `<i class="end" data-must-show="${mark}"></i>`).join('')}</body></html>`;

describe('reading a rendered page', () => {
  it('reads the pixels whatever filter a row was written with, with or without transparency', () => {
    for (const alpha of [false, true]) {
      for (const filter of [0, 1, 2, 3, 4]) {
        const png = picture(100, 60, [bar(), bar({ x: 3, y: 2, width: 9, colour: [1, 2, 3] })], {
          alpha,
          filterOf: () => filter,
        });
        const pixels = decodePng(png);
        if (!pixels.ok) throw new Error(pixels.error.message);
        expect(pixels.value).toMatchObject({ width: 100, height: 60, step: alpha ? 4 : 3 });
        const at = (x: number, y: number): number[] => {
          const from = (y * 100 + x) * pixels.value.step;
          return [...pixels.value.data.subarray(from, from + 3)];
        };
        expect(at(0, 0)).toEqual(WHITE);
        expect(at(30, 40)).toEqual(rgbOf(MARK));
        expect(at(73, 45)).toEqual(rgbOf(MARK));
        expect(at(74, 45)).toEqual(WHITE);
        expect(at(11, 7)).toEqual([1, 2, 3]);
        expect(at(99, 59)).toEqual(WHITE);
      }
    }
    // Every row with another filter, as a real writer chooses them.
    expect(shows(picture(100, 60, [bar()], { alpha: true, filterOf: (y) => y % 5 }))).toBe(true);
  });

  it('reads what the fake renderer makes', () => {
    const pixels = decodePng(solidPng(20, 12, [9, 8, 7], [rgbOf(MARK)]));
    if (!pixels.ok) throw new Error(pixels.error.message);
    expect([...pixels.value.data.subarray(0, 3)]).toEqual([9, 8, 7]);
    expect([...pixels.value.data.subarray(pixels.value.data.length - 3)]).toEqual(rgbOf(MARK));
  });

  it('refuses what is not a picture it can read, and says why', () => {
    const good = picture(40, 20, [bar({ x: 2, y: 2, width: 30 })]);
    const why = (bytes: Uint8Array): unknown[] | 'read' => {
      const read = decodePng(bytes);
      return read.ok ? 'read' : [read.error.code, read.error.message, read.error.detail];
    };
    const message = 'The rendered page could not be read.';
    expect(why(new Uint8Array([1, 2, 3]))).toEqual(['page.picture', message, 'not a PNG']);
    expect(why(new TextEncoder().encode('<html>'.repeat(20)))).toEqual([
      'page.picture',
      message,
      'not a PNG',
    ]);
    expect(why(good.subarray(0, good.length - 20))).toEqual(['page.picture', message, 'cut short']);
    // A palette picture, and 16 bits a channel: not what the renderer writes.
    const palette = good.slice();
    palette[25] = 3;
    expect(why(palette)).toEqual(['page.picture', message, 'format 8/3/0']);
    const deep = good.slice();
    deep[24] = 16;
    expect(why(deep)).toEqual(['page.picture', message, 'format 16/2/0']);
    // The picture data spoilt, or not there.
    const header = good.subarray(0, 33);
    const end = chunk('IEND', new Uint8Array(0));
    const join = (...parts: Uint8Array[]): Uint8Array => {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    };
    expect(why(join(header, end))).toEqual(['page.picture', message, 'no picture data']);
    expect(why(join(header, chunk('IDAT', new Uint8Array([1, 2, 3, 4])), end))[0]).toBe(
      'page.picture'
    );
    expect(why(join(header, chunk('IDAT', zlibSync(new Uint8Array(10))), end))).toEqual([
      'page.picture',
      message,
      'too little picture data',
    ]);
    const filter = new Uint8Array((40 * 3 + 1) * 20);
    filter[0] = 7;
    expect(why(join(header, chunk('IDAT', zlibSync(filter)), end))).toEqual([
      'page.picture',
      message,
      'filter 7',
    ]);
    expect(why(good)).toBe('read');
  });
});

describe('the bar that ends a list', () => {
  it('is found when it is in the picture, also a little off its colour as after scaling', () => {
    expect(shows(picture(200, 100, [bar()]))).toBe(true);
    const [r, g, b] = rgbOf(MARK);
    expect(shows(picture(200, 100, [bar({ colour: [r + 12, g - 12, b + 12] })]))).toBe(true);
    expect(shows(picture(200, 100, [bar({ colour: [r + 30, g, b] })]))).toBe(false);
    // At the very bottom of the picture, two rows of it left.
    expect(shows(picture(200, 100, [bar({ y: 98 })]))).toBe(true);
  });

  it('is not found when it was cut off, or when something else merely has its colour', () => {
    expect(shows(picture(200, 100, []))).toBe(false);
    // One row of it left in view.
    expect(shows(picture(200, 100, [bar({ y: 99 })]))).toBe(false);
    // Cut off at the side: too little of it.
    expect(shows(picture(200, 100, [bar({ x: 180 })]))).toBe(false);
    // Thin rules of the colour, rows apart, and a small square of it.
    expect(
      shows(
        picture(200, 100, [
          bar({ y: 10, width: 150, height: 1 }),
          bar({ y: 30, width: 150, height: 1 }),
          bar({ y: 50, width: 10, height: 10 }),
        ])
      )
    ).toBe(false);
  });

  it('has a colour nothing else on a page has, in both styles', () => {
    const far = (a: Rgb, b: Rgb): boolean => a.some((value, at) => Math.abs(value - b[at]!) > 24);
    const others = (style: 'light' | 'night'): string[] => [
      ...Object.values(THEMES[style]).filter((value) => /^#[0-9a-f]{6}$/i.test(String(value))),
      ...Object.values(CATEGORIES).map((kind) => (style === 'night' ? kind.night : kind.color)),
    ];
    for (const style of ['light', 'night'] as const) {
      const mark = rgbOf(END_MARK[style]);
      const background = rgbOf(THEMES[style].bg);
      for (const colour of others(style)) {
        expect(far(mark, rgbOf(colour)), `${style} ${colour}`).toBe(true);
        // Nor on the way from that colour to the background, as the soft edge of a letter is.
        for (let share = 0.05; share < 1; share += 0.05) {
          const edge = rgbOf(colour).map((value, at) =>
            Math.round(value * share + background[at]! * (1 - share))
          ) as Rgb;
          expect(
            mark.some((value, at) => Math.abs(value - edge[at]!) > 16),
            `${style} ${colour} at ${share.toFixed(2)}`
          ).toBe(true);
        }
      }
    }
    expect(END_MARK.light).not.toBe(END_MARK.night);
  });
});

describe('a rendered page against its HTML', () => {
  it('passes a page that names no mark without looking at the picture', () => {
    expect(marksOf('<html><div class="pic"></div></html>')).toEqual([]);
    expect(pageComplete('<html><div class="pic"></div></html>', new Uint8Array([1]))).toEqual({
      ok: true,
      value: true,
    });
  });

  it('wants every mark of the page in the picture', () => {
    const other = '#123456';
    expect(marksOf(page([MARK.toUpperCase(), other]))).toEqual([MARK, other]);
    const one = picture(200, 100, [bar()]);
    const both = picture(200, 100, [bar(), bar({ y: 60, colour: rgbOf(other) })]);
    expect(pageComplete(page([MARK]), one)).toEqual({ ok: true, value: true });
    expect(pageComplete(page([MARK, other]), one)).toEqual({ ok: true, value: false });
    expect(pageComplete(page([MARK, other]), both)).toEqual({ ok: true, value: true });
    expect(pageComplete(page([MARK]), picture(200, 100, []))).toEqual({ ok: true, value: false });
    expect(pageComplete(page([MARK]), new Uint8Array([1, 2, 3]))).toMatchObject({
      ok: false,
      error: { code: 'page.picture' },
    });
  });
});
