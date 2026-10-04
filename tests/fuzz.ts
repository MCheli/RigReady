/**
 * The damaged-file corpus for NFR-008: what a reader may find instead of the file it
 * expects. Deterministic (a seeded generator), so a failure can be reproduced.
 */

/** mulberry32: small, fast, good enough for test data. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBytes(length: number, seed: number): Uint8Array {
  const next = seeded(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(next() * 256);
  return out;
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

export function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = code >> 8;
  }
  return out;
}

export interface Variant {
  name: string;
  bytes: Uint8Array;
  /** True when the content still means what the original meant (a reader should accept it). */
  sameMeaning?: boolean;
}

/** The file cut at every `step`th byte (25 cuts by default), never the whole file. */
export function truncations(original: Uint8Array, cuts = 25): Variant[] {
  const step = Math.max(1, Math.floor(original.length / cuts));
  const out: Variant[] = [];
  for (let at = step; at < original.length; at += step) {
    out.push({ name: `cut at byte ${at} of ${original.length}`, bytes: original.subarray(0, at) });
  }
  return out;
}

/** Small damaged versions of one valid file. */
export function damaged(original: Uint8Array, seed = 1): Variant[] {
  const half = original.subarray(0, Math.floor(original.length / 2));
  return [
    { name: 'empty', bytes: new Uint8Array(0) },
    { name: 'one byte', bytes: original.subarray(0, 1) },
    { name: 'whitespace only', bytes: encode(' \r\n\t\n') },
    { name: 'garbage bytes', bytes: randomBytes(4096, seed) },
    { name: 'NUL bytes', bytes: new Uint8Array(2048) },
    { name: 'cut in half', bytes: half },
    // Bytes that are not UTF-8 in the middle of otherwise valid content.
    {
      name: 'not UTF-8',
      bytes: concat(
        half,
        new Uint8Array([0xff, 0xfe, 0xc3, 0x28, 0xa0, 0xa1, 0xe2, 0x82]),
        original.subarray(half.length)
      ),
    },
    {
      name: 'Latin-1 text',
      bytes: new Uint8Array([...encode('name = caf'), 0xe9, 0x0d, 0x0a, ...encode('x = 1'), 0xb0]),
    },
    {
      name: 'UTF-16 with a byte order mark',
      bytes: utf16le(new TextDecoder().decode(original).slice(0, 4000)),
    },
    { name: 'UTF-8 byte order mark first', bytes: concat(BOM, original), sameMeaning: true },
    { name: 'only a byte order mark', bytes: BOM },
    { name: 'another format: JSON', bytes: encode('{"a":[1,2,{"b":null}],"c":"d"}') },
    { name: 'another format: YAML', bytes: encode('a:\n  - 1\n  - b: [x, y]\nc: "d"\n') },
    { name: 'another format: INI', bytes: encode('[Section]\r\nkey=value\r\n; comment\r\n') },
    { name: 'another format: Lua', bytes: encode('local t = { ["a"] = 1, }\nreturn t') },
    { name: 'a JSON scalar', bytes: encode('null') },
    { name: 'a JSON array', bytes: encode('[]') },
    { name: 'a JSON string', bytes: encode('"text"') },
  ];
}

/** Large and deep inputs: a reader must refuse them or get through them quickly. */
export function huge(megabytes = 20): Variant[] {
  const size = megabytes * 1024 * 1024;
  const deep = 100_000;
  return [
    { name: `${megabytes} MB of one character`, bytes: new Uint8Array(size).fill(0x61) },
    { name: `${megabytes} MB of garbage`, bytes: randomBytes(size, 7) },
    {
      name: `${megabytes} MB of short lines`,
      bytes: encode('key = value\n'.repeat(Math.floor(size / 12))),
    },
    {
      name: 'one line of 8 MB',
      bytes: concat(encode('"'), new Uint8Array(8 * 1024 * 1024).fill(0x78)),
    },
    { name: 'arrays nested 100 000 deep', bytes: encode('['.repeat(deep) + ']'.repeat(deep)) },
    {
      name: 'objects nested 100 000 deep',
      bytes: encode('{"a":'.repeat(deep) + '1' + '}'.repeat(deep)),
    },
    { name: 'braces nested 100 000 deep', bytes: encode('{'.repeat(deep) + '}'.repeat(deep)) },
    { name: 'unclosed braces 100 000 deep', bytes: encode('a = ' + '{'.repeat(deep)) },
    { name: 'quoted keys nested 50 000 deep', bytes: encode('"k"\n{\n'.repeat(50_000)) },
    { name: 'a million small entries', bytes: encode('[' + '1,'.repeat(1_000_000) + '1]') },
  ];
}

/**
 * Runs something and fails with the variant's name when it throws or takes too long.
 * Returns what it returned.
 */
export async function survives<T>(
  what: string,
  run: () => T | Promise<T>,
  maxMs = 15_000
): Promise<T> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what}: no answer within ${maxMs} ms (a hang)`)),
      maxMs
    );
  });
  try {
    const value = await Promise.race([Promise.resolve().then(run), slow]);
    const took = Date.now() - started;
    if (took > maxMs) throw new Error(`${what}: took ${took} ms`);
    return value;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(what)) throw e;
    throw new Error(`${what}: threw ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}
