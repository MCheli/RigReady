/**
 * The icon files are rendered from the brand masters by `npm run icons` (scripts/icons.mjs)
 * and committed. This keeps a stale or hand-edited copy from shipping: the .ico has every
 * size Windows draws, the PNGs are the sizes the code expects, the installer sidebar is what
 * NSIS wants, the website's favicon is the small master, and the masters use the design
 * tokens of src/renderer/styles.css.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pngSize } from '../../src/platform/fake/png';

const root = path.resolve(__dirname, '..', '..');
const read = (file: string): Promise<Buffer> => fs.readFile(path.join(root, file));
const text = (file: string): Promise<string> => fs.readFile(path.join(root, file), 'utf8');

/** The entries of a Windows icon file: the size each claims, and the size its bitmap has. */
function icoEntries(ico: Buffer): { size: number; bitmap: number; bits: number }[] {
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const at = 6 + index * 16;
    const offset = ico.readUInt32LE(at + 12);
    // A bitmap entry starts with a BITMAPINFOHEADER whose height counts the mask too.
    expect(ico.readUInt32LE(offset)).toBe(40);
    return {
      size: ico.readUInt8(at) || 256,
      bitmap: ico.readInt32LE(offset + 4),
      bits: ico.readUInt16LE(offset + 14),
    };
  });
}

describe('icons: the committed icon files are what scripts/icons.mjs renders', () => {
  it('assets/icon.ico has a 32-bit bitmap for every size Windows draws, 16 to 256', async () => {
    const entries = icoEntries(await read('assets/icon.ico'));
    expect(entries.map((entry) => entry.size)).toEqual([16, 20, 24, 32, 48, 64, 128, 256]);
    for (const entry of entries) {
      expect(entry.bitmap, `${entry.size} px entry`).toBe(entry.size);
      expect(entry.bits, `${entry.size} px entry`).toBe(32);
    }
  });

  it('the PNGs are the sizes the app and the website expect', async () => {
    expect(pngSize(await read('assets/icon.png'))).toEqual({ width: 512, height: 512 });
    expect(pngSize(await read('assets/tray-16.png'))).toEqual({ width: 16, height: 16 });
    // src/main/index.ts paints the status badge onto this one at 32 px.
    expect(pngSize(await read('assets/tray-32.png'))).toEqual({ width: 32, height: 32 });
  });

  it('the installer sidebar is the 24-bit 164 x 314 bitmap NSIS wants', async () => {
    const bmp = await read('build/installerSidebar.bmp');
    expect(bmp.toString('ascii', 0, 2)).toBe('BM');
    expect(bmp.readInt32LE(18)).toBe(164);
    expect(bmp.readInt32LE(22)).toBe(314);
    expect(bmp.readUInt16LE(28)).toBe(24);
  });

  it('the website favicon is the small master', async () => {
    const strip = (svg: string): string => svg.replace(/<!--[\s\S]*?-->\s*/g, '').trim();
    expect(strip(await text('site/favicon.svg'))).toBe(
      strip(await text('assets/brand/rigready-small.svg'))
    );
  });

  it('the masters use the surface and accent tokens of the design system', async () => {
    const styles = await text('src/renderer/styles.css');
    const surface = /--rr-surface:\s*(#[0-9a-f]{6})/i.exec(styles)?.[1];
    const accent = /--rr-accent:\s*(#[0-9a-f]{6})/i.exec(styles)?.[1];
    expect(surface).toBeDefined();
    expect(accent).toBeDefined();
    for (const file of ['assets/brand/rigready.svg', 'assets/brand/rigready-small.svg']) {
      const svg = await text(file);
      expect(svg, file).toContain(`fill="${surface}"`);
      expect(svg, file).toContain(`stroke="${accent}"`);
    }
  });
});
