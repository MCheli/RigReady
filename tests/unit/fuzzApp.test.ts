import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Envelope } from '../../src/shared/ipc';
import { startupNotices } from '../../src/core/dataHealth';
import { damaged, survives } from '../fuzz';
import { wiredApp, type WiredApp } from '../helpers';

/**
 * NFR-008, the whole app: every recorded game and tool file of the rig (DCS Lua, iRacing
 * cfg/ini/yaml, LMU and BeamNG JSON, Assetto Corsa INI, Steam VDF/ACF, TrackIR, Stream
 * Deck, SimAppPro, Fanatec) and every setup is replaced by a damaged version, then every
 * request a page makes when it opens is sent, through IPC validation as the window
 * would. Whatever a reader does with the file, the request must come back as a value
 * (data or an error result): never a throw (`ipc.handler`), never a malformed answer
 * (`ipc.output`), never a hang.
 */

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

async function start(scenario = 'flying-all-good'): Promise<WiredApp> {
  const app = await wiredApp(scenario);
  apps.push(app);
  return app;
}

async function walk(dir: string, visit: (file: string) => Promise<void>): Promise<number> {
  let count = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += await walk(full, visit);
    else {
      await visit(full);
      count++;
    }
  }
  return count;
}

/** These wait for the user (a countdown, a picker that a test would have to script). */
const WAITS_FOR_USER =
  /^(displays:(keep|revert|identify|confirmUpright)|fly:(standDown|makeReady|launch)|profiles:waitForPress)$/;

const GAMES = [
  'dcs',
  'iracing',
  'lmu',
  'beamng',
  'msfs2024',
  'assetto-corsa',
  'assetto-corsa-evo',
  'assetto-corsa-rally',
];

/** Requests with input that read files: what the pages ask for after their first load. */
const WITH_INPUT: [string, unknown][] = [
  ['fly:view', { profileId: 'dcs-f-a-18c' }],
  ['fly:check', { profileId: 'dcs-f-a-18c' }],
  ['fly:gameStatus', { profileId: 'dcs-f-a-18c' }],
  ['profiles:get', { id: 'dcs-f-a-18c' }],
  ['profiles:edit', { id: 'dcs-f-a-18c' }],
  ['profiles:shortcut', { id: 'dcs-f-a-18c' }],
  ['sharing:prepare', { profileId: 'dcs-f-a-18c' }],
  ['backup:changes', { profileId: 'dcs-f-a-18c' }],
  ['backup:backUp', { scope: { kind: 'full' } }],
  ['backup:backUp', { scope: { kind: 'profile', profileId: 'dcs-f-a-18c' } }],
  ['dcs-bindings:aircraft', { id: 'FA-18C_hornet' }],
  ['dcs-bindings:aircraft', { id: 'UH-1H' }],
  ['dcs-bindings:cleanupOps', { aircraft: [] }],
  ['devices:boundInputs', { game: 'dcs', aircraftId: 'FA-18C_hornet' }],
  ['racing:backups', { game: 'iracing' }],
  ['racing:backups', { game: 'lmu' }],
  ['racing:beamngCopyOlderPreview', { version: '0.36' }],
  ['stream-deck:createBackup', { name: 'fuzz' }],
  ...GAMES.map((gameId): [string, unknown] => ['games:get', { gameId }]),
];

interface Outcome {
  calls: number;
  answered: number;
  problems: string[];
}

/** Sends every request and collects the ones that came back as a crash. */
async function askEverything(app: WiredApp, label: string): Promise<Outcome> {
  const outcome: Outcome = { calls: 0, answered: 0, problems: [] };
  const ask = async (channel: string, input: unknown): Promise<void> => {
    const handler = app.wiring.handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    outcome.calls++;
    let envelope: Envelope;
    try {
      envelope = await survives(`${label}: ${channel}`, () => handler(input), 30_000);
    } catch (e) {
      outcome.problems.push(e instanceof Error ? e.message.split('\n')[0]! : String(e));
      return;
    }
    if (envelope.ok) outcome.answered++;
    else if (envelope.error.code === 'ipc.handler' || envelope.error.code === 'ipc.output') {
      outcome.problems.push(
        `${label}: ${channel} -> ${envelope.error.code}: ${envelope.error.detail ?? envelope.error.message}`.slice(
          0,
          400
        )
      );
    } else if (envelope.error.code !== 'ipc.input') outcome.answered++;
  };
  for (const channel of app.wiring.handlers.keys()) {
    if (WAITS_FOR_USER.test(channel)) continue;
    await ask(channel, undefined);
  }
  for (const [channel, input] of WITH_INPUT) await ask(channel, input);
  return outcome;
}

/** Replaces every file below the fake user folder (the data root included) with a damaged version. */
async function damageEverything(app: WiredApp, kind: string): Promise<number> {
  return walk(app.home, async (file) => {
    const original = new Uint8Array(await fs.readFile(file));
    const variant = damaged(original, original.length + 1).find((v) => v.name === kind);
    if (!variant) throw new Error(`No variant "${kind}"`);
    await fs.writeFile(file, variant.bytes);
  });
}

const KINDS = [
  'empty',
  'garbage bytes',
  'NUL bytes',
  'cut in half',
  'not UTF-8',
  'Latin-1 text',
  'UTF-16 with a byte order mark',
  'UTF-8 byte order mark first',
  'another format: JSON',
  'another format: Lua',
  'a JSON scalar',
];

describe('NFR-008: the whole app on damaged files', () => {
  it('the rig as recorded answers every request (the baseline)', async () => {
    const app = await start();
    const outcome = await askEverything(app, 'as recorded');
    expect(outcome.problems).toEqual([]);
    expect(outcome.calls).toBeGreaterThan(70);
    expect(outcome.answered).toBeGreaterThan(60);
  }, 300_000);

  for (const kind of KINDS) {
    it(`every file replaced by "${kind}": every request still comes back as a value`, async () => {
      const app = await start();
      const files = await damageEverything(app, kind);
      expect(files).toBeGreaterThan(300);
      const outcome = await askEverything(app, kind);
      expect(outcome.problems).toEqual([]);
      expect(outcome.calls).toBeGreaterThan(70);
    }, 300_000);
  }

  it('every file locked (reads fail with EBUSY at the file port): every request still comes back as a value', async () => {
    const app = await start();
    const busy = (file: string) => ({
      ok: false as const,
      error: {
        code: 'file.read',
        message: `Could not read ${file}.`,
        detail: `EBUSY: resource busy or locked, open '${file}'`,
      },
    });
    app.ports.files.readText = async (file) => busy(file);
    app.ports.files.readBytes = async (file) => busy(file);
    const outcome = await askEverything(app, 'locked');
    expect(outcome.problems).toEqual([]);
  }, 300_000);

  it('every file gone, and then every folder: "not found" answers, never a crash', async () => {
    const app = await start();
    const removed = await walk(app.home, (file) => fs.rm(file));
    expect(removed).toBeGreaterThan(300);
    const outcome = await askEverything(app, 'files deleted');
    expect(outcome.problems).toEqual([]);

    for (const entry of await fs.readdir(app.home)) {
      await fs.rm(path.join(app.home, entry), { recursive: true, force: true });
    }
    const empty = await askEverything(app, 'folders deleted');
    expect(empty.problems).toEqual([]);
    const games = await app.invoke<{ id: string; installs: unknown[] }[]>('games:list');
    expect(games.every((g) => g.installs.length === 0)).toBe(true);
  }, 300_000);

  it('every JSON store of RigReady is garbage: no request overwrites one without keeping it aside', async () => {
    const key = (file: string): string => path.resolve(file).toLowerCase();
    // First, on an untouched app: which .json files under the data root do the features ask for?
    const stores = new Set<string>();
    {
      const probe = await start();
      const root = probe.ports.folders.dataRoot().toLowerCase();
      const exists = probe.ports.files.exists.bind(probe.ports.files);
      probe.ports.files.exists = async (file) => {
        if (key(file).startsWith(root) && key(file).endsWith('.json')) {
          stores.add(path.relative(root, key(file)));
        }
        return exists(file);
      };
      await probe.wiring.context.settings.get();
      await startupNotices(probe.wiring.context);
      await askEverything(probe, 'probe');
    }
    expect(stores.size).toBeGreaterThan(8);

    const aside = new Set<string>();
    const overwritten = new Set<string>();
    const written = new Set<string>();
    let dataRoot = '';
    // The files are garbage before any feature is set up: a feature that reads its store
    // while it starts (the updater reads the settings) meets the damaged file too.
    const app = await wiredApp('flying-all-good', {
      beforeWiring: (rig) => {
        dataRoot = rig.ports.folders.dataRoot().toLowerCase();
        const files = rig.ports.files;
        const isStore = (file: string): boolean =>
          key(file).startsWith(dataRoot) && stores.has(path.relative(dataRoot, key(file)));
        const garbage = '\u0000\u0001 not json {{{ ';
        const real = {
          exists: files.exists.bind(files),
          stat: files.stat.bind(files),
          readText: files.readText.bind(files),
          readBytes: files.readBytes.bind(files),
          write: files.write.bind(files),
        };
        // Every .json file under the data root exists and is garbage, whatever a feature calls it,
        // until something is written in its place.
        const virtual = (file: string): boolean => isStore(file) && !written.has(key(file));
        files.exists = async (file) => (virtual(file) ? true : real.exists(file));
        files.stat = async (file) =>
          virtual(file)
            ? {
                ok: true,
                value: {
                  name: path.basename(file),
                  path: file,
                  isDirectory: false,
                  size: garbage.length,
                  mtimeMs: 0,
                },
              }
            : real.stat(file);
        files.readText = async (file) =>
          virtual(file) ? { ok: true, value: garbage } : real.readText(file);
        files.readBytes = async (file) =>
          virtual(file)
            ? { ok: true, value: new TextEncoder().encode(garbage) }
            : real.readBytes(file);
        files.write = async (file, content, options) => {
          const name = path.basename(file);
          if (name.includes('.corrupt-')) {
            // layouts.corrupt-<time>.json keeps layouts.json: remember which store it stands for.
            aside.add(key(path.join(path.dirname(file), name.replace(/\.corrupt-.*$/, '.json'))));
          } else if (isStore(file)) {
            if (virtual(file) && !aside.has(key(file))) overwritten.add(key(file));
            written.add(key(file));
          }
          return real.write(file, content, options);
        };
      },
    });
    apps.push(app);

    // Startup first, as the app does it, then every request.
    const context = app.wiring.context;
    await context.settings.get();
    await startupNotices(context);
    const outcome = await askEverything(app, 'stores are garbage');
    expect(outcome.problems).toEqual([]);

    const relative = (file: string): string => path.relative(dataRoot, file).replace(/\\/g, '/');
    // state.json only remembers which setup was used last (ProfileStore says why that may be dropped).
    expect([...overwritten].map(relative).filter((name) => name !== 'state.json')).toEqual([]);
    // Settings and layouts were replaced, each after its copy was written.
    expect([...aside].map(relative).sort()).toEqual(['displays/layouts.json', 'settings.json']);
  }, 300_000);

  it('files changing under a running app: damaged after the first read, the next read copes', async () => {
    const app = await start();
    const first = await askEverything(app, 'before');
    expect(first.problems).toEqual([]);
    await damageEverything(app, 'cut in half');
    const second = await askEverything(app, 'cut after the first read');
    expect(second.problems).toEqual([]);
    await damageEverything(app, 'garbage bytes');
    const third = await askEverything(app, 'garbage after the second read');
    expect(third.problems).toEqual([]);
  }, 300_000);
});
