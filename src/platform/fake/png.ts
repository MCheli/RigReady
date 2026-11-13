import { zlibSync } from 'fflate';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One chunk of a PNG file: length, type, data and checksum. */
export function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A real, single-colour PNG of the given size: what the fake Render port returns. Each of
 * `bands` is painted as a strip four rows high across the bottom, one above the other.
 */
export function solidPng(
  width: number,
  height: number,
  rgb: [number, number, number] = [255, 255, 255],
  bands: [number, number, number][] = []
): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const rowOf = (colour: [number, number, number]): Uint8Array => {
    const row = new Uint8Array(1 + width * 3);
    for (let x = 0; x < width; x++) row.set(colour, 1 + x * 3);
    return row;
  };
  const row = rowOf(rgb);
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) raw.set(row, y * row.length);
  bands.forEach((band, at) => {
    const strip = rowOf(band);
    for (let y = height - 4 * (at + 1); y < height - 4 * at; y++) {
      if (y >= 0) raw.set(strip, y * row.length);
    }
  });
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw)),
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

/** Width and height from a PNG's header; undefined when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
