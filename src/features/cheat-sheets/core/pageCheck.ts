import { unzlibSync } from 'fflate';
import { err, ok, type Result } from '../../../core/result';

/**
 * The check after rendering: is the end of a page's list in the picture? A list page ends
 * with a short bar in a colour nothing else on the page has (END_MARK in pages.ts). The
 * list is clipped to its room on the page, so when the bar is in the rendered picture,
 * every row above it is too; when it is not, part of the list was cut off and the page
 * must not be written. This reads the picture itself, so it holds whatever the renderer
 * made of the fonts and the wrapping.
 */

/** The marks a page says must be visible: the colours of its data-must-show attributes. */
export function marksOf(html: string): string[] {
  return [...html.matchAll(/data-must-show="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]!.toLowerCase());
}

interface Pixels {
  width: number;
  height: number;
  /** Bytes per pixel: 3 (RGB) or 4 (RGBA). */
  step: number;
  /** One row after another, each `width * step` bytes. */
  data: Uint8Array;
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** The pixels of a PNG as Chromium and the fakes write them: 8 bits a channel, RGB or RGBA, not interlaced. */
export function decodePng(bytes: Uint8Array): Result<Pixels> {
  const bad = (why: string): Result<Pixels> =>
    err('page.picture', 'The rendered page could not be read.', why);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || signature.some((b, i) => bytes[i] !== b)) return bad('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let step = 0;
  const parts: Uint8Array[] = [];
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (body.length !== length) return bad('cut short');
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const [depth, colour, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) {
        return bad(`format ${depth}/${colour}/${interlace}`);
      }
      step = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      parts.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (!width || !height || !step || parts.length === 0) return bad('no picture data');
  const packed = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    packed.set(part, offset);
    offset += part.length;
  }
  let raw: Uint8Array;
  try {
    raw = unzlibSync(packed);
  } catch (e) {
    return bad(String(e));
  }
  const stride = width * step;
  if (raw.length < (stride + 1) * height) return bad('too little picture data');
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const from = y * (stride + 1) + 1;
    const to = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= step ? data[to + x - step]! : 0;
      const up = y > 0 ? data[to + x - stride]! : 0;
      const upLeft = y > 0 && x >= step ? data[to + x - stride - step]! : 0;
      const value = raw[from + x]!;
      data[to + x] =
        filter === 0
          ? value
          : filter === 1
            ? value + left
            : filter === 2
              ? value + up
              : filter === 3
                ? value + ((left + up) >> 1)
                : value + paeth(left, up, upLeft);
    }
    if (filter > 4) return bad(`filter ${filter}`);
  }
  return ok({ width, height, step, data });
}

/**
 * True when the picture shows a bar of the colour: a run of at least `run` pixels of it
 * in two rows, one under the other. A bar only one row of which is left in view counts
 * as cut off, and so does a thin rule that happens to have the colour. The tolerance
 * allows for a picture that was scaled down from a larger capture.
 */
export function showsMark(pixels: Pixels, colour: string, run = 24, tolerance = 16): boolean {
  const want = [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16));
  const { width, height, step, data } = pixels;
  let above = false;
  for (let y = 0; y < height; y++) {
    let length = 0;
    let found = false;
    for (let x = 0; x < width && !found; x++) {
      const at = (y * width + x) * step;
      const match =
        Math.abs(data[at]! - want[0]!) <= tolerance &&
        Math.abs(data[at + 1]! - want[1]!) <= tolerance &&
        Math.abs(data[at + 2]! - want[2]!) <= tolerance;
      length = match ? length + 1 : 0;
      found = length >= run;
    }
    if (found && above) return true;
    above = found;
  }
  return false;
}

/**
 * Checks a rendered page against its HTML: every mark the page says must be visible is in
 * the picture. A page without marks (a device's drawing, which is scaled to fit) passes.
 */
export function pageComplete(html: string, png: Uint8Array): Result<boolean> {
  const marks = marksOf(html);
  if (marks.length === 0) return ok(true);
  const pixels = decodePng(png);
  if (!pixels.ok) return pixels;
  return ok(marks.every((mark) => showsMark(pixels.value, mark)));
}
