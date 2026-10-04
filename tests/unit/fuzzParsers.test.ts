import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { parseEdid } from '../../src/core/displays/edid';
import { parseJournal } from '../../src/core/files/fileStore';
import { stripBom } from '../../src/core/files/text';
import { createZip, readZip } from '../../src/core/files/zip';
import { parseLog } from '../../src/core/logger';
import { parseLuaData } from '../../src/core/lua/data';
import { runLua } from '../../src/core/lua/sandbox';
import { hasYamlComments } from '../../src/core/profile/store';
import { parseAppManifest } from '../../src/core/steam';
import { parseVdf, steamLibraryPaths } from '../../src/core/vdf';
import { parseGaming } from '../../src/features/devices/core/hidhide';
import { parseIni } from '../../src/features/racing/core/assettoCorsa';
import { parseRelaxedJson } from '../../src/features/racing/core/beamng/beamng';
import { parseControlsCfg } from '../../src/features/racing/core/iracing/controlsCfg';
import { parseJoyCalib } from '../../src/features/racing/core/iracing/joyCalib';
import { readPluginManifest } from '../../src/features/stream-deck/core/inventory';
import { decodeText, parseProfileMap } from '../../src/features/trackir/core/trackir';
import { damaged, huge, survives, truncations, type Variant } from '../fuzz';
import { fixturesDir } from '../helpers';

/**
 * NFR-008, the parsers: every function that turns file content into data is fed
 * damaged, foreign, cut-off, huge and deeply nested content. None may throw and none
 * may hang: a damaged file is an error value or an empty result.
 *
 * Text is decoded the way the file store does it (UTF-8, invalid bytes replaced).
 */

const rigFile = (...parts: string[]): string =>
  path.join(fixturesDir, 'rigs', 'mark-full', 'files', ...parts);
const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

interface Parser {
  name: string;
  /** A real file of this format from the recorded rig. */
  sample: string[];
  /** Parses; a throw or a hang fails the test. Returns something that says whether it was accepted. */
  parse(bytes: Uint8Array): unknown;
  /** Is the result a success? Used on the unchanged file and on the copy with a byte order mark. */
  accepted(result: unknown): boolean;
  /** Formats whose own readers do not strip a byte order mark (the caller does). */
  bomIsDamage?: boolean;
}

const isOk = (result: unknown): boolean => (result as { ok?: boolean }).ok === true;

const PARSERS: Parser[] = [
  {
    name: 'Steam library list (VDF)',
    sample: ['Program Files (x86)', 'Steam', 'steamapps', 'libraryfolders.vdf'],
    parse: (bytes) => {
      try {
        return { parsed: parseVdf(text(bytes)), libraries: steamLibraryPaths(text(bytes)) };
      } catch (e) {
        // Documented: parseVdf throws an Error for a damaged file and its callers
        // (findSteamLibraries, parseAppManifest) catch it. Anything that is not an Error is a bug.
        if (e instanceof Error) return { libraries: [] };
        throw e;
      }
    },
    accepted: (r) => (r as { libraries: string[] }).libraries.length > 0,
  },
  {
    name: 'Steam app manifest (ACF)',
    sample: ['Program Files (x86)', 'Steam', 'steamapps', 'appmanifest_223750.acf'],
    parse: (bytes) => parseAppManifest(text(bytes), 'C:\\Steam'),
    accepted: isOk,
  },
  {
    name: 'DCS options.lua (Lua data)',
    sample: ['Saved Games', 'DCS', 'Config', 'options.lua'],
    parse: (bytes) => parseLuaData(text(bytes)),
    accepted: isOk,
    bomIsDamage: true,
  },
  {
    name: 'DCS program run in the sandbox (Lua)',
    sample: ['Saved Games', 'DCS', 'Config', 'options.lua'],
    parse: (bytes) => runLua(text(bytes), { maxInstructions: 2_000_000 }),
    accepted: isOk,
    bomIsDamage: true,
  },
  {
    name: 'Assetto Corsa controls.ini (INI)',
    sample: ['Documents', 'Assetto Corsa', 'cfg', 'controls.ini'],
    parse: (bytes) => parseIni(text(bytes)),
    accepted: (r) => (r as Map<string, unknown>).size > 0,
  },
  {
    name: 'iRacing controls.cfg (binary)',
    sample: ['Documents', 'iRacing', 'controls.cfg'],
    parse: (bytes) => parseControlsCfg(bytes),
    accepted: isOk,
    bomIsDamage: true,
  },
  {
    name: 'iRacing joyCalib.yaml',
    sample: ['Documents', 'iRacing', 'joyCalib.yaml'],
    parse: (bytes) => parseJoyCalib(text(bytes)),
    accepted: isOk,
  },
  {
    name: 'BeamNG relaxed JSON',
    sample: ['AppData', 'Local', 'BeamNG', 'BeamNG.drive', 'current', 'settings', 'settings.json'],
    parse: (bytes) => {
      try {
        return { value: parseRelaxedJson(text(bytes)) };
      } catch (e) {
        // Documented: it throws a SyntaxError like JSON.parse; its callers catch it. Anything else is a bug.
        if (e instanceof SyntaxError) return { value: undefined };
        throw e;
      }
    },
    accepted: (r) => (r as { value: unknown }).value !== undefined,
    bomIsDamage: true,
  },
  {
    name: 'TrackIR ProfileMap.dat',
    sample: ['AppData', 'Roaming', 'NaturalPoint', 'TrackIR 5', 'ProfileMap.dat'],
    parse: (bytes) => parseProfileMap(decodeText(bytes)),
    accepted: (r) => (r as unknown[]).length > 0,
  },
  {
    name: 'Stream Deck plugin manifest',
    sample: ['AppData', 'Roaming', 'SimAppPro', 'GameExtendDisplay', 'MFD', 'DCS_config.json'],
    parse: (bytes) => readPluginManifest('com.example.sdPlugin', text(bytes)),
    accepted: (r) => (r as { id: string }).id === 'com.example',
  },
  {
    name: 'HidHide device list',
    sample: ['AppData', 'Roaming', 'SimAppPro', 'GameExtendDisplay', 'MFD', 'DCS_config.json'],
    parse: (bytes) => parseGaming(text(bytes)),
    accepted: Array.isArray,
  },
  {
    name: 'change journal (JSON lines)',
    sample: ['Documents', 'iRacing', 'app.ini'],
    parse: (bytes) => parseJournal(text(bytes)),
    accepted: Array.isArray,
  },
  {
    name: 'log file',
    sample: ['Saved Games', 'DCS', 'Logs', 'dcs.log'],
    parse: (bytes) => parseLog(text(bytes)),
    accepted: Array.isArray,
  },
  {
    name: 'YAML comment detection',
    sample: ['Documents', 'iRacing', 'joyCalib.yaml'],
    parse: (bytes) => hasYamlComments(text(bytes)),
    accepted: (r) => typeof r === 'boolean',
  },
  {
    name: 'EDID block',
    sample: ['Documents', 'iRacing', 'controls.cfg'],
    parse: (bytes) => parseEdid(bytes),
    accepted: (r) => typeof r === 'object',
  },
  {
    name: 'zip archive',
    sample: ['Documents', 'iRacing', 'controls.cfg'],
    parse: (bytes) => readZip(bytes, { maxTotalBytes: 8 * 1024 * 1024, maxEntries: 1000 }),
    // The sample is not a zip: it is refused, like every damaged one.
    accepted: (r) => !isOk(r),
    bomIsDamage: true,
  },
];

async function sampleOf(parser: Parser): Promise<Uint8Array> {
  return new Uint8Array(await fs.readFile(rigFile(...parser.sample)));
}

describe('NFR-008: parsers on damaged files', () => {
  for (const parser of PARSERS) {
    it(`${parser.name}: damaged, foreign and cut-off content never throws`, async () => {
      const sample = await sampleOf(parser);
      // The unchanged file is read.
      expect(parser.accepted(parser.parse(sample)), 'the recorded file').toBe(true);
      const variants: Variant[] = [...damaged(sample), ...truncations(sample)];
      expect(variants.length).toBeGreaterThan(30);
      for (const variant of variants) {
        const result = await survives(`${parser.name}, ${variant.name}`, () =>
          parser.parse(variant.bytes)
        );
        // With a byte order mark the content means the same, so it is read the same.
        if (variant.sameMeaning && !parser.bomIsDamage) {
          expect(parser.accepted(result), `${parser.name}, ${variant.name}`).toBe(true);
        }
      }
    });
  }

  it('huge and deeply nested content is refused or read quickly, never a stack overflow or a hang', async () => {
    const variants = huge(20);
    const timings: string[] = [];
    for (const parser of PARSERS) {
      for (const variant of variants) {
        const started = Date.now();
        await survives(
          `${parser.name}, ${variant.name}`,
          () => parser.parse(variant.bytes),
          20_000
        );
        const took = Date.now() - started;
        // Generous: other test runs share this machine. Before the size caps these took 4 to 17 s.
        if (took > 8000) timings.push(`${parser.name}, ${variant.name}: ${took} ms`);
      }
    }
    // Nothing takes long enough for a user to think the app hung.
    expect(timings).toEqual([]);
  }, 600_000);

  it('profile YAML: every damaged form is a parse error or a value, never a crash of the YAML reader', async () => {
    const sample = new Uint8Array(
      await fs.readFile(path.join(fixturesDir, 'scenarios', 'profiles', 'dcs-f-a-18c.yaml'))
    );
    for (const variant of [...damaged(sample), ...truncations(sample), ...huge(8)]) {
      await survives(
        `yaml, ${variant.name}`,
        () => {
          try {
            yaml.load(stripBom(text(variant.bytes)));
          } catch (e) {
            // js-yaml reports damage by throwing YAMLException; the profile store catches everything.
            if (!(e instanceof Error)) throw e;
          }
        },
        30_000
      );
    }
  }, 300_000);

  it('a zip is checked before it is unpacked: a bomb, a path outside the folder and a cut-off archive are refused', async () => {
    const built = createZip([
      { path: 'a.txt', data: new TextEncoder().encode('hello') },
      { path: 'folder/b.bin', data: new Uint8Array(5 * 1024 * 1024) },
    ]);
    if (!built.ok) throw new Error('zip');
    expect(readZip(built.value).ok).toBe(true);
    // 5 MB of zeros compresses to a few kilobytes: the declared size is what counts.
    expect(built.value.length).toBeLessThan(100_000);
    expect(readZip(built.value, { maxTotalBytes: 1024 * 1024 })).toMatchObject({
      ok: false,
      error: { code: 'zip.tooBig' },
    });
    expect(readZip(built.value, { maxEntries: 1 }).ok).toBe(false);
    for (const variant of [...damaged(built.value), ...truncations(built.value, 60)]) {
      const result = await survives(`zip, ${variant.name}`, () => readZip(variant.bytes));
      if (!variant.sameMeaning && result.ok) {
        // Whatever was accepted holds only safe names.
        for (const entry of result.value) expect(entry.path).not.toMatch(/^([a-zA-Z]:|\/)|\.\./);
      }
    }
    expect(createZip([{ path: '../outside.txt', data: new Uint8Array(1) }]).ok).toBe(false);
    expect(createZip([{ path: 'C:/Windows/x', data: new Uint8Array(1) }]).ok).toBe(false);
  });
});
