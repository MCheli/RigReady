import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLogger,
  createRedactor,
  DeferredSink,
  filterLog,
  LOG_KEEP_OLDER,
  LOG_MAX_BYTES,
  LOG_MAX_TEXT,
  logFile,
  parseLog,
  parseLogLevel,
  type LogLevel,
} from '../../src/core/logger';
import { AI_KEY_SECRET } from '../../src/core/settings';
import { discoverFeatures, wireFeatures } from '../../src/main/bootstrap';
import { startLogging } from '../../src/main/logging';
import { RotatingFileSink } from '../../src/platform/node';
import { scenarioRig, tempDir, TestClock, type TestRig } from '../helpers';

const KEY = 'sk-ant-api03-Zx9Qw7Lm2Kp5Rt8Vb1Nc4Hd6Jf3Gs0AaBbCcDdEeFf';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function capture(level: LogLevel | (() => LogLevel) = 'debug', homes: string[] = []) {
  const lines: string[] = [];
  const log = createLogger({ write: (l) => lines.push(l) }, new TestClock(), level, 'app', {
    redact: createRedactor(homes),
  });
  return { lines, log };
}

describe('the logger', () => {
  it('has four levels, and the level can change while the app runs', () => {
    let level: LogLevel = 'warn';
    const { lines, log } = capture(() => level);
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(lines.map((l) => l.split(' ')[1])).toEqual(['WARN', 'ERROR']);
    level = 'debug';
    log.child('devices').debug('now shown');
    expect(lines[2]).toBe('2026-10-03T12:00:00.000Z DEBUG [devices] now shown\n');
    expect(parseLogLevel('DEBUG')).toBe('debug');
    expect(parseLogLevel(' warn ')).toBe('warn');
    expect(parseLogLevel('verbose')).toBeUndefined();
    expect(parseLogLevel(undefined)).toBeUndefined();
  });

  it('never writes the Anthropic key, whatever the caller passes', () => {
    const { lines, log } = capture();
    log.info(`calling with ${KEY}`);
    log.info('request', { headers: { 'x-api-key': KEY, authorization: `Bearer ${KEY}` } });
    log.error('failed', new Error(`401 for key ${KEY}`));
    log.warn('text', `{"x-api-key":"${KEY}"}`);
    log.info('other secrets', {
      password: 'hunter2hunter2',
      apiKey: 'abcd1234efgh',
      token: 'tok_12345678',
    });
    const all = lines.join('');
    expect(all).not.toContain(KEY);
    expect(all).not.toContain('Zx9Qw7Lm2Kp5');
    expect(all).not.toContain('hunter2');
    expect(all).not.toContain('abcd1234efgh');
    expect(all).not.toContain('tok_12345678');
    expect(lines[0]).toContain('calling with sk-ant-***');
    expect(lines).toHaveLength(5);
  });

  it('writes paths, but with the home folder as ~ and no Windows user name', () => {
    const { lines, log } = capture('debug', ['D:\\Profiles\\mark']);
    log.info('read C:\\Users\\Jane Doe\\Saved Games\\DCS\\Config\\options.lua');
    log.info('wrote', { file: 'C:\\Users\\jane\\Documents\\iRacing\\app.ini' });
    log.info('forward C:/Users/jane/AppData/Local/x.json and D:/Profiles/mark/y.txt');
    log.info('redirected home', { dir: 'D:\\Profiles\\mark\\.rigready\\profiles' });
    log.info('C:\\Users\\Public\\Documents\\shared.txt and C:\\Program Files\\Eagle Dynamics');
    const all = lines.join('');
    expect(all).not.toMatch(/jane/i);
    expect(all).not.toContain('mark');
    // What support needs is still there: which file, in which folder below the home.
    expect(lines[0]).toContain('C:\\Users\\~\\Saved Games\\DCS\\Config\\options.lua');
    expect(lines[1]).toContain('"C:\\\\Users\\\\~\\\\Documents\\\\iRacing\\\\app.ini"');
    expect(lines[2]).toContain('C:/Users/~/AppData/Local/x.json and ~/y.txt');
    expect(lines[3]).toContain('"~\\\\.rigready\\\\profiles"');
    expect(lines[4]).toContain('C:\\Users\\Public\\Documents\\shared.txt');
    expect(lines[4]).toContain('C:\\Program Files\\Eagle Dynamics');
  });

  it('a home folder with a space in the user name is replaced whole when it is known', () => {
    const { lines, log } = capture('debug', ['C:\\Users\\Jane Doe']);
    log.info('read C:\\Users\\Jane Doe\\Saved Games\\DCS\\Config\\options.lua', {
      also: 'c:/users/jane doe/Documents',
    });
    expect(lines[0]).toContain('read ~\\Saved Games\\DCS\\Config\\options.lua');
    expect(lines[0]).toContain('"~/Documents"');
    expect(lines[0]).not.toMatch(/jane|doe/i);
  });

  it('does not write file contents: long texts are cut and binary data is only counted', () => {
    const { lines, log } = capture();
    const content = 'options = {\n' + '  ["graphics"] = { ["width"] = 5120 },\n'.repeat(400) + '}';
    log.debug('parsed', {
      text: content,
      bytes: new Uint8Array(4096),
      nested: { list: [content] },
    });
    log.debug('as message data', content);
    for (const line of lines) {
      expect(line.length).toBeLessThan(LOG_MAX_TEXT * 3 + 400);
      expect(line).toContain('more characters not logged');
    }
    expect(lines[0]).toContain('"bytes":"[4096 bytes]"');
    // One entry is one line: a multi-line text continues indented.
    expect(
      lines[1]!
        .trimEnd()
        .split('\n')
        .slice(1)
        .every((l) => l.startsWith('    '))
    ).toBe(true);
  });

  it('survives data that cannot be written as JSON', () => {
    const { lines, log } = capture();
    const circular: Record<string, unknown> = { name: 'loop' };
    circular['self'] = circular;
    log.info('circular', circular);
    log.info('odd', {
      big: 12n,
      fn: () => 1,
      when: new Date(Number.NaN),
      deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
    });
    const throwing = {
      get boom(): string {
        throw new Error('getter');
      },
    };
    log.info('throws', throwing);
    log.info(
      'many',
      Array.from({ length: 80 }, (_, i) => i)
    );
    expect(lines[0]).toContain('{"name":"loop","self":"[circular]"}');
    expect(lines[1]).toContain('"big":"12"');
    expect(lines[1]).toContain('"fn":"[function]"');
    expect(lines[1]).toContain('"when":"Invalid Date"');
    expect(lines[1]).toContain('"[...]"');
    expect(lines[2]).toContain('throws [object Object]');
    expect(lines[3]).toContain('"... 30 more"');
  });

  it('is read back entry by entry, with stacks kept with their entry', () => {
    const { lines, log } = capture();
    log.info('first', { n: 1 });
    log.child('fly').error('check threw', new Error('boom'));
    log.warn('last');
    const entries = parseLog('not a log line\n' + lines.join(''));
    expect(entries.map((e) => [e.level, e.scope])).toEqual([
      ['info', 'app'],
      ['error', 'fly'],
      ['warn', 'app'],
    ]);
    expect(entries[0]!.text).toBe('first {"n":1}');
    expect(entries[1]!.text).toMatch(/^check threw Error: boom\n\s+at /);
    expect(entries[0]!.time).toBe('2026-10-03T12:00:00.000Z');
    expect(filterLog(entries, 'warn').map((e) => e.level)).toEqual(['error', 'warn']);
    expect(filterLog(entries, 'debug')).toHaveLength(3);
    expect(parseLog('')).toEqual([]);
  });

  it('keeps what is logged before the log file is open', () => {
    const sink = new DeferredSink();
    const written: string[] = [];
    sink.write('early 1\n');
    sink.write('early 2\n');
    sink.attach({ write: (line) => written.push(line) });
    sink.write('late\n');
    expect(written).toEqual(['early 1\n', 'early 2\n', 'late\n']);
  });
});

describe('the log file', () => {
  it('defaults to five files of five megabytes', () => {
    expect(LOG_MAX_BYTES).toBe(5_000_000);
    expect(LOG_KEEP_OLDER + 1).toBe(5);
  });

  it('rotates at the size limit and never keeps more than the configured number of files', async () => {
    const { dir, cleanup } = await tempDir();
    cleanups.push(cleanup);
    const file = path.join(dir, 'logs', 'rigready.log');
    // A small limit: 200 bytes a file, four older files.
    const sink = new RotatingFileSink(file, 200, 4);
    for (let i = 0; i < 60; i++)
      sink.write(`line ${String(i).padStart(3, '0')} ${'x'.repeat(30)}\n`);
    await sink.close();
    const names = (await fs.readdir(path.dirname(file))).sort();
    expect(names).toEqual([
      'rigready.log',
      'rigready.log.1',
      'rigready.log.2',
      'rigready.log.3',
      'rigready.log.4',
    ]);
    let total = 0;
    for (const name of names) {
      const size = (await fs.stat(path.join(path.dirname(file), name))).size;
      expect(size).toBeLessThanOrEqual(200);
      total += size;
    }
    expect(total).toBeLessThanOrEqual(5 * 200);
    // The newest lines are in the current file, in order; older files hold older lines.
    const current = await fs.readFile(file, 'utf8');
    expect(current.trimEnd().split('\n').pop()).toContain('line 059');
    expect(await fs.readFile(`${file}.1`, 'utf8')).toContain('line 05');
    expect(sink.dropped).toBe(0);

    // A second run appends to the same file and keeps rotating.
    const again = new RotatingFileSink(file, 200, 4);
    again.write('after restart\n');
    await again.close();
    expect(await fs.readFile(file, 'utf8')).toContain('after restart');
  });

  it('does not block or throw when the log cannot be written; it counts what was lost', async () => {
    const { dir, cleanup } = await tempDir();
    cleanups.push(cleanup);
    // The "logs" folder is a file, so nothing can be created below it.
    await fs.writeFile(path.join(dir, 'logs'), 'in the way');
    const sink = new RotatingFileSink(path.join(dir, 'logs', 'rigready.log'));
    sink.write('one\n');
    sink.write('two\n');
    await sink.close();
    expect(sink.dropped).toBe(2);
  });
});

describe('the app log', () => {
  it('the level comes from RIGREADY_LOG_LEVEL, else from the setting, else it is info', async () => {
    const rig = await scenarioRig('generic-fresh', { files: [] });
    cleanups.push(rig.cleanup);
    const dataRoot = rig.ports.folders.dataRoot();
    const read = (): Promise<string> => fs.readFile(logFile(dataRoot), 'utf8');
    const wiring = wireFeatures({
      features: discoverFeatures(),
      ports: rig.ports,
      log: createLogger({ write: () => {} }, rig.clock),
      send: () => {},
    });
    const { settings } = wiring.context;

    const logging = startLogging(rig.clock, { USERPROFILE: rig.home });
    logging.log.info('before the file is open');
    logging.open(dataRoot, [rig.home]);
    await logging.follow(settings);
    logging.log.debug('hidden at info');
    expect((await settings.update({ logLevel: 'debug' })).ok).toBe(true);
    logging.log.debug(`shown at debug, in ${path.join(rig.home, 'Documents')}`);
    await logging.flush();
    const text = await read();
    expect(text).toContain('before the file is open');
    expect(text).not.toContain('hidden at info');
    expect(text).toContain('log level is now debug');
    expect(text).toContain(`shown at debug, in ~${path.sep}Documents`);
    expect(text).not.toContain(rig.home);

    // The environment wins over the setting.
    const fixed = startLogging(rig.clock, { RIGREADY_LOG_LEVEL: 'error' });
    fixed.open(dataRoot, []);
    await fixed.follow(settings);
    fixed.log.warn('not written');
    fixed.log.error('written');
    await fixed.flush();
    const after = await read();
    expect(after).not.toContain('not written');
    expect(after).toMatch(/ERROR \[app\] written/);
    // Nothing to flush is fine too.
    await startLogging(rig.clock, {}).flush();
  });
});

/** Every channel that takes no input: what every page calls when it opens. */
async function callEverything(
  wiring: ReturnType<typeof wireFeatures>,
  skip: RegExp
): Promise<string[]> {
  const called: string[] = [];
  for (const [channel, handler] of wiring.handlers) {
    if (skip.test(channel)) continue;
    await handler(undefined);
    called.push(channel);
  }
  return called;
}

describe('what the whole app logs', () => {
  let rig: TestRig;

  it('at the most detailed level: no API key, no file contents, no home folder', async () => {
    rig = await scenarioRig('flying-all-good');
    cleanups.push(rig.cleanup);
    const lines: string[] = [];
    const log = createLogger({ write: (l) => lines.push(l) }, rig.clock, 'debug', 'app', {
      redact: createRedactor([rig.home]),
    });
    const wiring = wireFeatures({
      features: discoverFeatures(),
      ports: rig.ports,
      log,
      send: () => {},
    });
    // A key is stored, and files RigReady reads carry a marker.
    const stored = await wiring.handlers.get('settings:setAiKey')!({ key: KEY });
    expect(stored.ok).toBe(true);
    expect((await rig.ports.secrets.get(AI_KEY_SECRET)).ok).toBe(true);
    const marker = 'MARKER_FILE_CONTENT_7731';
    const options = path.join(rig.home, 'Saved Games', 'DCS', 'Config', 'options.lua');
    await fs.appendFile(options, `\n-- ${marker}\n`);
    const profile = path.join(rig.ports.folders.dataRoot(), 'profiles', 'dcs-f-a-18c.yaml');
    await fs.appendFile(profile, `\n# ${marker}\n`);
    await fs.appendFile(path.join(rig.home, 'Documents', 'iRacing', 'app.ini'), `\n; ${marker}\n`);

    // Stand down, apply and the like wait for the user; everything else answers at once.
    const called = await callEverything(
      wiring,
      /^(displays:(keep|revert)|fly:(standDown|makeReady|launch)|app:)/
    );
    expect(called.length).toBeGreaterThan(40);
    await wiring.handlers.get('fly:check')!({ profileId: 'dcs-f-a-18c' });
    await wiring.handlers.get('diagnostics:report')!({
      message: `renderer failed with ${KEY}`,
      detail: `at ${path.join(rig.home, 'x.js')}`,
    });
    log.info('done');

    const all = lines.join('');
    expect(lines.length).toBeGreaterThan(1);
    expect(all).not.toContain(KEY);
    expect(all).not.toContain(marker);
    expect(all).not.toContain(rig.home);
    expect(all).not.toContain(path.basename(rig.home));
  }, 120_000);
});
