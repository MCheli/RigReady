/**
 * NFR-005: every IPC channel validates its input, and no value from the renderer can make
 * main read, write or start something outside the folders RigReady may use.
 *
 * Nothing here is a hand-written list of channels: contracts are found by glob
 * (tests/schemaWalk.ts), handlers come from the wired app, and the fields a channel takes
 * are read from its zod schema. A new feature is covered the moment its folder exists.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isWithin } from '../../src/core/paths';
import { appContract } from '../../src/shared/appContract';
import { CHANNEL_PATTERN, EVENT_PATTERN, channelName, eventName } from '../../src/shared/channels';
import type { ChannelDef, Envelope } from '../../src/shared/ipc';
import { repoRoot, tempDir, wiredApp, type WiredApp } from '../helpers';
import { discoverContracts, leaves, sample, withValueAt, type Leaf } from '../schemaWalk';

interface Channel {
  name: string;
  feature: string;
  def: ChannelDef;
}

const contracts = discoverContracts();
const channels: Channel[] = contracts.flatMap((contract) =>
  Object.entries(contract.channels).map(([key, def]) => ({
    name: channelName(contract.feature, key),
    feature: contract.feature,
    def,
  }))
);
/** The shell's own two channels are handled in src/main/index.ts, which needs Electron. */
const wired = channels.filter((c) => c.feature !== appContract.feature);

let app: WiredApp;
let outside: { dir: string; cleanup: () => Promise<void> };
/** Every file, program and process the app touched whose path carries the canary. */
const touched: string[] = [];

const CANARY = 'canary-zz91';
const SECRET = 'TOP-SECRET-CONTENT-zz91';

/** Answers within the time, or says which call hung. */
async function call(channel: Channel, input: unknown, ms = 20_000): Promise<Envelope> {
  const handler = app.wiring.handlers.get(channel.name);
  if (!handler) throw new Error(`No handler for ${channel.name}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      handler(input),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${channel.name} did not answer in ${ms} ms`)),
          ms
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Records every FileStore, Shell and process call whose path carries the canary. */
function watchThePorts(): void {
  const files = app.ports.files as unknown as Record<string, (...args: unknown[]) => unknown>;
  const proto = Object.getPrototypeOf(files) as object;
  // Not paths: a group's reason, journal ids, retention settings.
  const notPaths = new Set(['beginGroup', 'undo', 'undoGroup', 'prune']);
  for (const name of Object.getOwnPropertyNames(proto)) {
    const original = Object.getOwnPropertyDescriptor(proto, name)?.value as unknown;
    if (name === 'constructor' || typeof original !== 'function' || notPaths.has(name)) continue;
    // write(path, content) and its lossyRewrite(path, content) guard: the content is not a path.
    // Everything else: the first two arguments.
    const positions = name === 'write' || name === 'lossyRewrite' ? [0] : [0, 1];
    files[name] = (...args: unknown[]) => {
      for (const arg of positions.map((i) => args[i])) {
        if (typeof arg === 'string' && arg.includes(CANARY)) touched.push(`files.${name} ${arg}`);
      }
      return (original as (...a: unknown[]) => unknown).apply(files, args);
    };
  }
  const { shell, processes } = app.ports;
  const run = shell.run.bind(shell);
  shell.run = (exe, args, options) => {
    if ([exe, ...args].some((a) => a.includes(CANARY))) touched.push(`shell.run ${exe}`);
    return run(exe, args, options);
  };
  const launch = shell.launch.bind(shell);
  shell.launch = (exe, args, options) => {
    if ([exe, ...args].some((a) => a.includes(CANARY))) touched.push(`shell.launch ${exe}`);
    return launch(exe, args, options);
  };
  const start = processes.start.bind(processes);
  processes.start = (target) => {
    if ([target.exe, ...(target.args ?? [])].some((a) => a.includes(CANARY))) {
      touched.push(`processes.start ${target.exe}`);
    }
    return start(target);
  };
}

beforeAll(async () => {
  app = await wiredApp('flying-all-good');
  outside = await tempDir('rigready-test-outside-');
  await fs.writeFile(path.join(outside.dir, `${CANARY}.txt`), SECRET);
  watchThePorts();
});
afterAll(async () => {
  await app?.cleanup();
  await outside?.cleanup();
});

// ---- every channel is validated -----------------------------------------------------------

describe('NFR-005 every channel goes through its contract', () => {
  it('each contract channel has exactly one handler and each handler has a contract', () => {
    expect(contracts.length).toBeGreaterThan(10);
    expect(wired.length).toBeGreaterThan(150);
    const declared = new Set(wired.map((c) => c.name));
    const handled = new Set(app.wiring.handlers.keys());
    expect([...declared].filter((name) => !handled.has(name))).toEqual([]);
    // A handler without a contract would be a channel nothing validates.
    expect([...handled].filter((name) => !declared.has(name))).toEqual([]);
    // One contract per feature id, the id of its folder's feature.
    const features = new Set(app.wiring.features.map((f) => f.id));
    for (const contract of contracts) {
      if (contract.feature !== appContract.feature) {
        expect(features.has(contract.feature), contract.feature).toBe(true);
      }
    }
  });

  it('every channel and event name fits the pattern the preload script lets through, and nothing else does', () => {
    for (const channel of channels) expect(channel.name).toMatch(CHANNEL_PATTERN);
    for (const contract of contracts) {
      for (const event of Object.keys(contract.events)) {
        const name = eventName(contract.feature, event);
        expect(name).toMatch(EVENT_PATTERN);
        // An event name is never an invoke channel, and the other way round.
        expect(CHANNEL_PATTERN.test(name)).toBe(false);
      }
    }
    for (const channel of channels) expect(EVENT_PATTERN.test(channel.name)).toBe(false);
    for (const hostile of [
      '',
      'fly',
      ':check',
      'fly:',
      'Fly:check',
      'fly:check:extra',
      '../fly:check',
      'fly:check\n',
      'fly:event:result',
      'ELECTRON_BROWSER_REQUIRE',
      '__proto__:x',
      'fly:__proto__',
    ]) {
      expect(CHANNEL_PATTERN.test(hostile), JSON.stringify(hostile)).toBe(false);
    }
    for (const hostile of [
      'fly:check',
      'fly:event:',
      ':event:x',
      'fly:event:x:y',
      'fly:event:x\n',
    ]) {
      expect(EVENT_PATTERN.test(hostile), JSON.stringify(hostile)).toBe(false);
    }
  });

  it('the shell’s own channels are bound from their contract too (src/main/index.ts)', async () => {
    const main = await fs.readFile(path.join(repoRoot, 'src', 'main', 'index.ts'), 'utf8');
    // bind() + wireFeatures() is the same validating path the features use.
    expect(main).toMatch(/const appBinding = bind\(appContract, \{/);
    expect(main).toMatch(
      /wireFeatures\(\{\s*features: \[\{ id: 'app', setup: \(\) => \[appBinding\] \}\]/
    );
    // Nothing is registered with ipcMain except through the validated handlers map.
    const direct = main.match(/ipcMain\.(handle|on|once)\(/g) ?? [];
    expect(direct).toHaveLength(1);
    expect(main).toMatch(
      /for \(const channel of handlers\.keys\(\)\) \{\s*ipcMain\.handle\(channel, \(_event, rawInput: unknown\) => call\(channel, rawInput\)\);/
    );
  });
});

// ---- malformed input ----------------------------------------------------------------------

function nested(depth: number): unknown {
  let value: unknown = 'x';
  for (let i = 0; i < depth; i++) value = { a: value };
  return value;
}

const MALFORMED: [string, unknown][] = [
  ['undefined', undefined],
  ['null', null],
  ['a number', 42],
  ['NaN', Number.NaN],
  ['a string', 'x'],
  ['a boolean', true],
  ['an array', [1, 'two', null]],
  ['an empty object', {}],
  ['an object with unknown keys', { zz: 1, yy: 'x' }],
  ['a 2 MB string', 'A'.repeat(2_000_000)],
  ['an object nested 3000 deep', nested(3000)],
  [
    'prototype-pollution keys',
    JSON.parse(
      '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"prototype":{"polluted":"yes"}}'
    ) as unknown,
  ],
];

/** A value of another type than the leaf wants. */
function wrongFor(leaf: Leaf): unknown {
  switch (leaf.type) {
    case 'string':
    case 'enum':
    case 'literal':
    case 'template_literal':
      return { not: 'a string' };
    case 'number':
    case 'int':
      return 'not a number';
    case 'boolean':
      return 'not a boolean';
    default:
      return undefined;
  }
}

describe('NFR-005 malformed input', () => {
  it('a sample input can be built for every channel from its schema alone', () => {
    const without = channels.filter((c) => !c.def.input.safeParse(sample(c.def.input)).success);
    // Two schemas carry refinements a generated value cannot satisfy; the rest of the audit
    // still sends them everything it sends the others.
    expect(without.map((c) => c.name).sort()).toEqual([
      'racing:beamngCopyToController',
      'racing:beamngCopyToControllerPreview',
      'racing:savePresets',
    ]);
  });

  it('every channel answers every malformed shape with a validation error and never throws', async () => {
    let rejected = 0;
    let acceptedBySchema = 0;
    const neverRejects: string[] = [];
    for (const channel of wired) {
      let rejectedHere = 0;
      for (const [what, value] of MALFORMED) {
        if (channel.def.input.safeParse(value).success) {
          // The schema takes it (no input needed, or every field optional): not malformed here.
          acceptedBySchema++;
          continue;
        }
        const envelope = await call(channel, value);
        expect(envelope, `${channel.name} <- ${what}`).toMatchObject({
          ok: false,
          error: { code: 'ipc.input' },
        });
        rejected++;
        rejectedHere++;
      }
      if (rejectedHere < 6) neverRejects.push(channel.name);
    }
    // Every channel refuses most of the shapes; none takes "anything".
    expect(neverRejects).toEqual([]);
    expect(rejected).toBeGreaterThan(wired.length * 8);
    console.log(
      `  NFR-005: ${wired.length} channels x ${MALFORMED.length} malformed shapes: ${rejected} rejected with ipc.input, ${acceptedBySchema} are valid input for their channel`
    );
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('undefined is refused wherever a channel needs input', async () => {
    const needsInput = wired.filter((c) => sample(c.def.input) !== undefined);
    expect(needsInput.length).toBeGreaterThan(80);
    const lax: string[] = [];
    for (const channel of needsInput) {
      // All-optional objects may accept {} but never "no input at all" unless the schema says so.
      if (channel.def.input.safeParse(undefined).success) {
        lax.push(channel.name);
        continue;
      }
      expect(await call(channel, undefined)).toMatchObject({
        ok: false,
        error: { code: 'ipc.input' },
      });
    }
    // Channels whose schema has only optional or defaulted fields (prefault): no input is input.
    expect(lax.every((name) => channels.some((c) => c.name === name))).toBe(true);
  });

  it('a field of the wrong type is refused, field by field', async () => {
    let checked = 0;
    for (const channel of wired) {
      const base = sample(channel.def.input);
      if (base === undefined || !channel.def.input.safeParse(base).success) continue;
      const seen = new Set<string>();
      for (const leaf of leaves(channel.def.input)) {
        const id = leaf.path.join('.');
        const wrong = wrongFor(leaf);
        if (wrong === undefined || seen.has(id)) continue;
        seen.add(id);
        const input = withValueAt(base, leaf.path, wrong);
        // A union may offer another type for the same key; then this is not wrong.
        if (channel.def.input.safeParse(input).success) continue;
        const envelope = await call(channel, input);
        expect(envelope, `${channel.name} ${id}`).toMatchObject({
          ok: false,
          error: { code: 'ipc.input' },
        });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    console.log(`  NFR-005: ${checked} wrongly typed fields refused`);
  });

  it('valid shapes with hostile content (huge strings, deep objects, prototype keys) get an answer, not a crash', async () => {
    const huge = 'B'.repeat(1_000_000);
    const polluting = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}'
    ) as unknown;
    let calls = 0;
    for (const channel of wired) {
      const base = sample(channel.def.input);
      if (base === undefined) continue;
      const all = leaves(channel.def.input);
      const variants: unknown[] = [];
      // Every string at once, as long as the schema still accepts it.
      let withHuge: unknown = base;
      for (const leaf of all.filter((l) => l.type === 'string')) {
        const next = withValueAt(withHuge, leaf.path, huge);
        if (channel.def.input.safeParse(next).success) withHuge = next;
      }
      if (withHuge !== base) variants.push(withHuge);
      // Free-form fields (a check's params, a setup's extensions): deep and polluting values.
      for (const leaf of all.filter((l) => l.type === 'unknown' || l.type === 'any')) {
        for (const value of [nested(3000), polluting]) {
          const next = withValueAt(base, leaf.path, value);
          if (channel.def.input.safeParse(next).success) variants.push(next);
        }
      }
      for (const input of variants) {
        const envelope = await call(channel, input, 60_000);
        expect(typeof envelope.ok, channel.name).toBe('boolean');
        if (!envelope.ok) expect(typeof envelope.error.code).toBe('string');
        calls++;
      }
    }
    expect(calls).toBeGreaterThan(20);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  }, 300_000);
});

// ---- paths ----------------------------------------------------------------------------------

/** Keys that name a file, a folder or a program. */
const PATH_KEY =
  /^(path|file|filename|dir|directory|folder|exe|cwd|target|destination|source|location|from|to)$|[a-z](Path|File|FileName|Dir|Directory|Folder|Exe)$/i;

const lastKey = (leaf: Leaf): string =>
  [...leaf.path].reverse().find((key) => key !== '[]' && key !== '{}') ?? '';

/**
 * Channels whose path-like field is stored as data and not used as a path by the call.
 * Each entry needs its reason; the audit still proves that nothing outside the allowed
 * folders is touched and nothing is started when they are called.
 */
const DATA_ONLY: Record<string, string> = {
  // The program a setup launches. Saving the setup reads, writes and starts nothing at that
  // path: it is written into the setup file under the data root. It is used only when the
  // user presses Launch, as an executable plus argument array (NFR-004), and a game may be
  // installed anywhere on the PC, so no root list can confine it.
  'profiles:save launch.exe': 'launch target of a setup, stored as data',
  'profiles:save launch.cwd': 'working folder of that launch target, stored as data',
  'profiles:create launch.exe': 'launch target of a new setup, stored as data',
  'profiles:create launch.cwd': 'working folder of that launch target, stored as data',
};

describe('NFR-005 paths from the renderer', () => {
  const pathFields = (): { channel: Channel; leaf: Leaf }[] => {
    const found: { channel: Channel; leaf: Leaf }[] = [];
    for (const channel of channels) {
      const seen = new Set<string>();
      for (const leaf of leaves(channel.def.input)) {
        const id = leaf.path.join('.');
        if (leaf.type !== 'string' || seen.has(id) || !PATH_KEY.test(lastKey(leaf))) continue;
        seen.add(id);
        found.push({ channel, leaf });
      }
    }
    return found;
  };

  /** Hostile values for one field, each carrying the canary so any use of it is seen. */
  const hostilePaths = (): [string, string][] => {
    const docs = app.ports.folders.documents();
    const outsideName = path.basename(outside.dir);
    return [
      ['a Windows system path', `C:/Windows/System32/${CANARY}`],
      ['an existing file outside every allowed folder', path.join(outside.dir, `${CANARY}.txt`)],
      ['a .. traversal out of Documents', `${docs}\\..\\..\\${outsideName}\\${CANARY}.txt`],
      ['a relative traversal', `..\\..\\..\\${outsideName}\\${CANARY}.txt`],
      ['a path variable climbing out', `{DOCUMENTS}/../../${outsideName}/${CANARY}.txt`],
      ['a UNC path', `\\\\${CANARY}.invalid\\share\\x.txt`],
      ['a long-path prefix', `\\\\?\\${path.join(outside.dir, `${CANARY}.txt`)}`],
      ['a device path', `\\\\.\\${CANARY}`],
    ];
  };

  /** Not under the fake user folder or the data root: outside everything the app may use. */
  const outsideEverything = (entry: string): boolean => {
    const target = entry.slice(entry.indexOf(' ') + 1);
    return !isWithin(app.home, target) && !isWithin(app.ports.folders.dataRoot(), target);
  };

  /** The sample input, and the same with ids that exist, so a call gets as far as using the path. */
  const bases = async (channel: Channel): Promise<unknown[]> => {
    const base = sample(channel.def.input);
    const profiles = await app.wiring.context.profiles.list();
    const profileId = profiles.ok ? profiles.value[0]?.id : undefined;
    const out = [base];
    for (const known of [profileId, '@always']) {
      if (!known) continue;
      let next = base;
      for (const leaf of leaves(channel.def.input)) {
        if (leaf.type !== 'string' || !/^(scope|profileId|id)$/.test(lastKey(leaf))) continue;
        const candidate = withValueAt(next, leaf.path, known);
        if (channel.def.input.safeParse(candidate).success) next = candidate;
      }
      if (JSON.stringify(next) !== JSON.stringify(base)) out.push(next);
    }
    return out;
  };

  it('lists the channels that take a path-like field (found by walking the schemas)', () => {
    const found = pathFields().map(({ channel, leaf }) => `${channel.name} ${leaf.path.join('.')}`);
    console.log(`  NFR-005 path-like fields (${found.length}):\n    ${found.join('\n    ')}`);
    // The tracked-item path is the one that names a file to read and write.
    expect(found).toContain('backup:previewItem path');
    expect(found).toContain('backup:saveItem item.path');
    // Every allowlist entry is a field that exists; a renamed field cannot stay excused.
    for (const entry of Object.keys(DATA_ONLY)) expect(found).toContain(entry);
    expect(Object.keys(DATA_ONLY).length).toBeLessThanOrEqual(4);
  });

  it('C:/Windows/System32/x, a traversal, a UNC path and a device path are refused by every path-taking channel', async () => {
    const accepted: string[] = [];
    let sent = 0;
    for (const { channel, leaf } of pathFields()) {
      if (!app.wiring.handlers.has(channel.name)) continue;
      const field = `${channel.name} ${leaf.path.join('.')}`;
      for (const base of await bases(channel)) {
        for (const [what, hostile] of hostilePaths()) {
          const input = withValueAt(base, leaf.path, hostile);
          // Refused by the schema itself (a pattern, a length): the strongest refusal.
          if (!channel.def.input.safeParse(input).success) continue;
          touched.length = 0;
          const envelope = await call(channel, input);
          sent++;
          // Not a read of content, not a write, not a start: whatever the answer was.
          expect(touched.filter(outsideEverything), `${field} <- ${what}`).toEqual([]);
          expect(JSON.stringify(envelope)).not.toContain(SECRET);
          if (envelope.ok && !(field in DATA_ONLY)) accepted.push(`${field} <- ${what}`);
        }
      }
    }
    expect(sent).toBeGreaterThan(30);
    expect(accepted).toEqual([]);
    // The file outside is as it was and has no neighbours.
    expect(await fs.readdir(outside.dir)).toEqual([`${CANARY}.txt`]);
    expect(await fs.readFile(path.join(outside.dir, `${CANARY}.txt`), 'utf8')).toBe(SECRET);
  }, 300_000);

  it('no string field of any channel, path-like or not, makes main touch a file outside the allowed folders', async () => {
    let sent = 0;
    const violations: string[] = [];
    const payloads = (): string[] => [
      path.join(outside.dir, `${CANARY}.txt`),
      `..\\..\\..\\${path.basename(outside.dir)}\\${CANARY}.txt`,
      `C:/Windows/System32/${CANARY}`,
    ];
    for (const channel of wired) {
      const base = sample(channel.def.input);
      const seen = new Set<string>();
      for (const leaf of leaves(channel.def.input)) {
        const id = leaf.path.join('.');
        if (leaf.type !== 'string' || seen.has(id)) continue;
        seen.add(id);
        for (const hostile of payloads()) {
          const input = withValueAt(base, leaf.path, hostile);
          if (!channel.def.input.safeParse(input).success) continue;
          touched.length = 0;
          const envelope = await call(channel, input);
          sent++;
          for (const entry of touched.filter(outsideEverything)) {
            violations.push(`${channel.name} ${id}: ${entry}`);
          }
          if (JSON.stringify(envelope).includes(SECRET)) {
            violations.push(`${channel.name} ${id}: answered with the file's content`);
          }
        }
      }
    }
    expect(sent).toBeGreaterThan(300);
    expect(violations).toEqual([]);
    expect(await fs.readdir(outside.dir)).toEqual([`${CANARY}.txt`]);
    expect(await fs.readFile(path.join(outside.dir, `${CANARY}.txt`), 'utf8')).toBe(SECRET);
    console.log(`  NFR-005: ${sent} hostile strings sent across ${wired.length} channels`);
  }, 300_000);

  it('a path picked in the native dialog is accepted where the same path typed is refused', async () => {
    const preview = wired.find((c) => c.name === 'backup:previewItem')!;
    const file = path.join(outside.dir, `${CANARY}.txt`);
    const draft = { label: 'Tool', path: file, kind: 'file' };
    expect(await call(preview, draft)).toMatchObject({
      ok: false,
      error: { code: 'path.outside' },
    });
    // The picker runs in main; the renderer only learns what was chosen.
    app.ports.dialogs.script.open.push([file]);
    const browsed = await app.invoke<{ path: string } | null>('backup:browse', { kind: 'file' });
    expect(browsed?.path).toBe(file);
    expect(await call(preview, draft)).toMatchObject({ ok: true, value: { exists: true } });
    // Its neighbours were not picked.
    expect(
      await call(preview, { ...draft, path: path.join(outside.dir, 'other.txt') })
    ).toMatchObject({ ok: false, error: { code: 'path.outside' } });
  });
});

// ---- the renderer's sandbox -----------------------------------------------------------------

describe('NFR-005 renderer hardening', () => {
  it('every window is created with contextIsolation on, nodeIntegration off and the sandbox on', async () => {
    const files = [
      path.join(repoRoot, 'src', 'main', 'index.ts'),
      path.join(repoRoot, 'src', 'platform', 'electron', 'index.ts'),
    ];
    let windows = 0;
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(/new BrowserWindow\(\{/g)) {
        windows++;
        // The options object of this window, up to the end of its webPreferences.
        const options = text.slice(match.index, match.index + 1500);
        const prefs = /webPreferences:\s*\{([^}]*)\}/.exec(options)?.[1];
        expect(prefs, `${path.basename(file)} window ${windows}`).toBeDefined();
        expect(prefs).toMatch(/contextIsolation:\s*true/);
        expect(prefs).toMatch(/sandbox:\s*true/);
        expect(prefs).not.toMatch(/nodeIntegration:\s*true/);
        expect(prefs).not.toMatch(
          /webSecurity:\s*false|allowRunningInsecureContent|webviewTag:\s*true/
        );
        // The app window names it; the helper windows run no scripts at all.
        expect(prefs).toMatch(/nodeIntegration:\s*false|javascript:\s*false/);
      }
    }
    expect(windows).toBeGreaterThanOrEqual(3);
    const main = await fs.readFile(files[0]!, 'utf8');
    // Links open in the browser, never in the app window; the window never navigates away.
    expect(main).toMatch(/setWindowOpenHandler\(/);
    expect(main).toMatch(/action: 'deny'/);
    expect(main).toMatch(/'will-navigate', \(event\) => event\.preventDefault\(\)/);
  });

  it('the page’s Content-Security-Policy allows scripts from the app only: nothing remote, inline or evaluated', async () => {
    const html = await fs.readFile(path.join(repoRoot, 'src', 'renderer', 'index.html'), 'utf8');
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
    expect(csp).toBeDefined();
    const directives = new Map(
      csp!
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .map(([name, ...values]) => [name!, values] as const)
    );
    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
    for (const [name, values] of directives) {
      for (const value of values) {
        // No remote origin, no wildcard, in any directive.
        expect(value, name).not.toMatch(/^(https?:|wss?:|\*|ftp:)/);
        if (name !== 'style-src') expect(value, name).not.toMatch(/unsafe-inline|unsafe-eval/);
      }
    }
    // No inline script in the page, and no script from anywhere but the app.
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]![1]).toMatch(/src="\.\/main\.ts"/);
    expect(scripts[0]![2]!.trim()).toBe('');
  });

  it('the preload script exposes only invoke and on, each checking the channel name first', async () => {
    const preload = await fs.readFile(path.join(repoRoot, 'src', 'main', 'preload.ts'), 'utf8');
    expect(preload.match(/exposeInMainWorld\(/g)).toHaveLength(1);
    expect(preload).toMatch(/exposeInMainWorld\('rigready', \{\s*invoke\(/);
    expect(preload).toMatch(/if \(!CHANNEL_PATTERN\.test\(channel\)\)/);
    expect(preload).toMatch(/if \(!EVENT_PATTERN\.test\(channel\)\) throw/);
    // ipcRenderer itself is never handed to the page, and nothing else of Node or Electron.
    expect(preload).not.toMatch(/ipcRenderer\.(send|sendSync|postMessage)\(/);
    expect(preload).not.toMatch(/require\(|process\.|shell\b|remote\b/);
    const exposed = /exposeInMainWorld\('rigready', \{([\s\S]*)\}\);/.exec(preload)?.[1] ?? '';
    const members = [...exposed.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1]);
    expect(members).toEqual(['invoke', 'on']);
  });
});
