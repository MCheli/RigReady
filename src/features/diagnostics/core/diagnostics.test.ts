import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appErrors } from '../../../core/errorCenter';
import { createLogger, createRedactor, logFile } from '../../../core/logger';
import { privacyContext, Scanner } from '../../../core/privacy';
import { RotatingFileSink } from '../../../platform/node';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ErrorReportView, LogView, Overview } from '../contract';
import { readOverview, setLogLevel } from './diagnostics';

let apps: WiredApp[] = [];
beforeEach(() => appErrors.reset(() => new Date('2026-10-03T12:00:00.000Z')));
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

async function start(scenario = 'flying-all-good', files: string[] = []): Promise<WiredApp> {
  const app = await wiredApp(scenario, { files });
  apps.push(app);
  return app;
}

/** Writes log lines the way the app does: through the logger, into <data root>/logs. */
async function writeLog(
  app: WiredApp,
  write: (log: ReturnType<typeof createLogger>) => void
): Promise<void> {
  const sink = new RotatingFileSink(logFile(app.ports.folders.dataRoot()));
  write(createLogger(sink, app.clock, 'debug', 'app', { redact: createRedactor([app.home]) }));
  await sink.close();
}

const serialsOf = (app: WiredApp): string[] =>
  app.ports.state.devices.map((d) => d.serial).filter((s): s is string => !!s && s.length >= 4);

/** Everything personal on the fake PC, in every spelling it could be written. */
function personal(app: WiredApp): string[] {
  return [
    app.home,
    app.home.replace(/\\/g, '\\\\'),
    app.home.replace(/\\/g, '/'),
    path.basename(app.home),
    app.ports.folders.machineName(),
    ...serialsOf(app),
  ];
}

function expectScrubbed(app: WiredApp, name: string, content: string): void {
  for (const secret of personal(app)) {
    expect(content.toLowerCase(), `${name} contains ${secret}`).not.toContain(secret.toLowerCase());
  }
}

describe('diagnostics overview', () => {
  it('shows versions, the data root, the games found and the devices of this PC', async () => {
    const app = await start('flying-all-good', ['Program Files (x86)/Steam/**']);
    const view = await app.invoke<Overview>('diagnostics:overview');
    expect(view.app.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(view.app.node).toMatch(/^v?\d+\./);
    expect(view.app.os).toMatch(/\(x64|arm64|ia32\)|\(/);
    expect(view.dataRoot).toBe(app.ports.folders.dataRoot());
    expect(view.logFolder).toBe(path.join(app.ports.folders.dataRoot(), 'logs'));
    expect(view.log).toEqual({ level: 'info', fixedByEnvironment: false });
    const dcs = view.games.found.find((g) => g.id === 'dcs');
    expect(dcs?.installs[0]).toMatchObject({ source: 'steam' });
    expect(dcs?.installs[0]?.installDir).toContain('DCSWorld');
    expect(view.devices.error).toBeUndefined();
    expect(
      view.devices.controllers.some((d) => d.vendorId === '044F' && d.productId === 'B68F')
    ).toBe(true);
    expect(view.devices.usbDevices).toBe(app.ports.state.devices.length);
    expect(view.devices.hubs).toBeGreaterThan(0);
    expect(view.monitors.list.length).toBeGreaterThan(1);
    expect(view.monitors.list.some((m) => /5120x1440 at 0,0.*main/.test(m))).toBe(true);
    expect(view.dataFiles.map((f) => [f.id, f.ok])).toEqual([
      ['settings', true],
      ['profiles', true],
      ['layouts', true],
      ['journal', true],
    ]);
    expect(view.dataFiles.find((f) => f.id === 'profiles')?.summary).toBe('1 setup');
  });

  it('on a PC with no sim and one stick it says so, without an error', async () => {
    const app = await start('generic-fresh');
    const view = await app.invoke<Overview>('diagnostics:overview');
    expect(view.games.found).toEqual([]);
    expect(view.games.notFound).toContain('DCS World');
    expect(view.devices.controllers.map((d) => d.name)).toContain('Logitech Extreme 3D');
    expect(view.monitors.list).toEqual(['BenQ GW2480: 1920x1080 at 0,0, main']);
    expect(view.dataFiles.find((f) => f.id === 'settings')?.summary).toBe(
      'Not saved yet; defaults are in use'
    );
    expect(view.dataFiles.find((f) => f.id === 'journal')?.summary).toBe('No changes recorded yet');
  });

  it('a provider that does not answer or fails is reported in its section; the rest still shows', async () => {
    const app = await start('generic-fresh');
    await mutate(app, [{ op: 'hangProvider', port: 'devices' }]);
    app.ports.displays.read = async () => ({
      ok: false,
      error: { code: 'display.read', message: 'The display driver did not answer.', detail: '0x5' },
    });
    const ctx = { ...app.wiring.context };
    const view = await readOverview(ctx, { appVersion: '9.9.9', sectionTimeoutMs: 50 });
    if (!view.ok) throw new Error('overview failed');
    expect(view.value.devices.error).toBe('The device list did not answer within 0.05 s.');
    expect(view.value.devices.controllers).toEqual([]);
    expect(view.value.monitors.error).toBe('The display driver did not answer. (0x5)');
    expect(view.value.app.version).toBe('9.9.9');
    expect(view.value.dataFiles).toHaveLength(4);

    // A game module that throws is named, not fatal.
    const dcs = app.wiring.context.games.get('dcs')!;
    const detect = dcs.detect;
    dcs.detect = async () => {
      throw new Error('registry exploded');
    };
    try {
      const again = await readOverview(ctx, { appVersion: '9.9.9', sectionTimeoutMs: 50 });
      if (!again.ok) throw new Error('overview failed');
      expect(again.value.games.found.find((g) => g.id === 'dcs')?.error).toContain(
        'registry exploded'
      );
    } finally {
      // Game modules are shared by every app in this file.
      dcs.detect = detect;
    }
  });

  it('names a damaged data file instead of hiding it', async () => {
    const app = await start('flying-all-good');
    const dataRoot = app.ports.folders.dataRoot();
    await fs.writeFile(path.join(dataRoot, 'profiles', 'broken.yaml'), 'name: [unclosed');
    await fs.mkdir(path.join(dataRoot, 'displays'), { recursive: true });
    await fs.writeFile(path.join(dataRoot, 'displays', 'layouts.json'), '{"layouts": 5}');
    await fs.writeFile(
      path.join(dataRoot, 'journal.jsonl'),
      '{"id":"a","time":"2026-10-01T00:00:00.000Z","path":"C:\\\\x","action":"write","reason":"r","backupPath":null}\n{"id":"b","ti'
    );
    const view = await app.invoke<Overview>('diagnostics:overview');
    const byId = Object.fromEntries(view.dataFiles.map((f) => [f.id, f]));
    expect(byId['profiles']).toMatchObject({
      ok: false,
      summary: '1 setup; 1 file cannot be read (broken.yaml)',
    });
    expect(byId['layouts']?.ok).toBe(false);
    expect(byId['layouts']?.summary).toContain('are not valid');
    expect(byId['journal']).toMatchObject({
      ok: false,
      summary: '1 change; 1 line cannot be read',
    });
  });
});

describe('diagnostics log', () => {
  it('reads the newest entries back, and says so when nothing was logged yet', async () => {
    const app = await start('generic-fresh');
    const empty = await app.invoke<LogView>('diagnostics:log');
    expect(empty).toMatchObject({ entries: [], older: 0, exists: false });

    await writeLog(app, (log) => {
      for (let i = 1; i <= 30; i++) log.info(`entry ${i}`);
      log.child('fly').warn('TrackIR is not running');
      log.child('displays').error('apply failed', new Error('driver said no'));
    });
    const view = await app.invoke<LogView>('diagnostics:log', { limit: 10 });
    expect(view.exists).toBe(true);
    expect(view.entries).toHaveLength(10);
    expect(view.older).toBe(22);
    expect(view.entries[9]).toMatchObject({ level: 'error', scope: 'displays' });
    expect(view.entries[9]!.text).toContain('apply failed Error: driver said no');
    expect(view.entries[8]).toMatchObject({
      level: 'warn',
      scope: 'fly',
      text: 'TrackIR is not running',
    });
    const all = await app.invoke<LogView>('diagnostics:log');
    expect(all.entries).toHaveLength(32);
  });

  it('the detailed log switch is a setting; the environment variable wins', async () => {
    const app = await start('generic-fresh');
    const changed = await app.invoke<{ level: string }>('diagnostics:setLogLevel', {
      level: 'debug',
    });
    expect(changed.level).toBe('debug');
    const view = await app.invoke<Overview>('diagnostics:overview');
    expect(view.log).toEqual({ level: 'debug', fixedByEnvironment: false });
    const saved = JSON.parse(
      await fs.readFile(path.join(app.ports.folders.dataRoot(), 'settings.json'), 'utf8')
    );
    expect(saved.logLevel).toBe('debug');

    const fixed = await setLogLevel(app.wiring.context, 'info', { RIGREADY_LOG_LEVEL: 'warn' });
    expect(fixed).toMatchObject({ ok: false, error: { code: 'diagnostics.levelFixed' } });
    const env = await readOverview(app.wiring.context, {
      appVersion: '1.0.0',
      env: { RIGREADY_LOG_LEVEL: 'warn' },
      versions: { electron: '40.0.0', chrome: '140.0.0', node: '22.0.0' },
    });
    if (!env.ok) throw new Error('overview failed');
    expect(env.value.log).toEqual({ level: 'warn', fixedByEnvironment: true });
    expect(env.value.app).toMatchObject({ electron: '40.0.0', chrome: '140.0.0', node: '22.0.0' });
  });
});

describe('copy, open and export', () => {
  /** A log with things in it that must not leave the PC. */
  async function personalLog(app: WiredApp): Promise<void> {
    const serial = serialsOf(app)[0]!;
    await writeLog(app, (log) => {
      log.info('started', { dataRoot: app.ports.folders.dataRoot() });
      log.info(`device ${serial} on ${app.ports.folders.machineName()} plugged in`);
      log.warn('instance USB\\VID_044F&PID_B68F\\' + serial);
      log.error('could not read', {
        file: path.join(app.home, 'Saved Games', 'DCS', 'Config', 'options.lua'),
      });
    });
  }

  it('Copy diagnostics puts the scrubbed text on the clipboard', async () => {
    const app = await start('flying-all-good', [
      'Program Files (x86)/Steam/**',
      'Saved Games/DCS/**',
    ]);
    await personalLog(app);
    appErrors.report('main', new Error(`boom in ${path.join(app.home, 'x.js')}`));
    const result = await app.invoke<{ characters: number }>('diagnostics:copy');
    expect(app.ports.clipboard.copied).toHaveLength(1);
    const text = app.ports.clipboard.copied[0]!;
    expect(result.characters).toBe(text.length);
    for (const heading of [
      'RigReady diagnostics',
      'Games',
      'Game controllers and input devices',
      'Monitors',
      "RigReady's own files",
      'Unexpected errors in this run',
      'Recent log',
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain('DCS World: steam, {DCS_INSTALL}');
    expect(text).toContain('T-Pendular-Rudder (044F:B68F)');
    expect(text).toContain('Data folder: {RIGREADY_HOME}');
    expect(text).toContain('main: boom in');
    expect(text).toMatch(/ERROR \[app\] could not read/);
    expect(text).toContain('Settings: ');
    expectScrubbed(app, 'clipboard', text);
  });

  it('Open log folder starts Explorer with the folder as one argument', async () => {
    const app = await start('generic-fresh');
    const result = await app.invoke<{ opened: boolean }>('diagnostics:openLogFolder');
    expect(result.opened).toBe(true);
    const folder = path.join(app.ports.folders.dataRoot(), 'logs');
    const call = app.ports.shell.calls.at(-1)!;
    expect(call.exe).toMatch(/\\explorer\.exe$/);
    expect(call.args).toEqual([folder]);
    // The folder exists even before anything was logged.
    expect((await fs.stat(folder)).isDirectory()).toBe(true);
  });

  it('Export diagnostics writes a zip that passes the privacy scrub of a shared setup', async () => {
    const app = await start('flying-all-good', [
      'Program Files (x86)/Steam/**',
      'Saved Games/DCS/**',
    ]);
    await personalLog(app);
    // An older, rotated log file and a settings file are included too.
    await fs.writeFile(
      `${logFile(app.ports.folders.dataRoot())}.1`,
      `2026-10-01T10:00:00.000Z INFO  [app] older, from ${app.ports.folders.machineName()}\n`
    );
    await app.invoke('settings:update', { minimizeToTray: false });

    // Cancelled: nothing is written and nothing is claimed.
    const cancelled = await app.invoke<{ saved: boolean }>('diagnostics:export');
    expect(cancelled.saved).toBe(false);

    const target = path.join(app.home, 'Documents', 'diag');
    app.ports.dialogs.script.save.push(target);
    const result = await app.invoke<{
      saved: boolean;
      path: string;
      files: string[];
      bytes: number;
    }>('diagnostics:export');
    expect(result).toMatchObject({ saved: true, path: `${target}.zip` });
    expect(result.files).toEqual([
      'diagnostics.txt',
      'logs/rigready.log',
      'logs/rigready.log.1',
      'settings.json',
    ]);
    const bytes = await fs.readFile(`${target}.zip`);
    expect(result.bytes).toBe(bytes.length);
    const entries = unzipSync(new Uint8Array(bytes));
    expect(Object.keys(entries).sort()).toEqual([...result.files].sort());

    // The same rules the privacy review of a shared setup applies find nothing left to remove.
    const scanner = new Scanner(await privacyContext(app.wiring.context, app.wiring.context.games));
    for (const [name, data] of Object.entries(entries)) {
      const content = new TextDecoder().decode(data);
      expectScrubbed(app, name, content);
      scanner.transform(content, name, 'profile', () => 'keep');
    }
    expect(scanner.list().map((f) => `${f.kind}: ${f.value} in ${f.where.join(', ')}`)).toEqual([]);
    const report = new TextDecoder().decode(entries['diagnostics.txt']);
    expect(report).toContain('RigReady diagnostics');
    expect(new TextDecoder().decode(entries['logs/rigready.log.1'])).toContain('older, from my-pc');
    expect(JSON.parse(new TextDecoder().decode(entries['settings.json'])).minimizeToTray).toBe(
      false
    );
    // It is a file outside RigReady's folder, so it is in the journal like any other.
    const journal = await app.ports.files.journal();
    expect(journal.ok && journal.value[0]).toMatchObject({
      path: `${target}.zip`,
      reason: 'Export diagnostics',
    });
    // The dialog suggested a dated name in Documents.
    const asked = app.ports.dialogs.calls.at(-1)!;
    expect(asked.options).toMatchObject({
      defaultPath: path.join(app.home, 'Documents', 'RigReady-diagnostics-2026-10-03-12-00.zip'),
    });
  });

  it('a log file that cannot be read is named in the export instead of failing it', async () => {
    const app = await start('generic-fresh');
    await personalLog(app);
    const realRead = app.ports.files.readText.bind(app.ports.files);
    app.ports.files.readText = async (file) =>
      file.endsWith('rigready.log')
        ? {
            ok: false,
            error: { code: 'file.read', message: 'Could not read the log.', detail: 'EBUSY' },
          }
        : realRead(file);
    const target = path.join(app.home, 'Documents', 'locked.zip');
    app.ports.dialogs.script.save.push(target);
    const result = await app.invoke<{ saved: boolean }>('diagnostics:export');
    expect(result.saved).toBe(true);
    const entries = unzipSync(new Uint8Array(await fs.readFile(target)));
    expect(new TextDecoder().decode(entries['logs/rigready.log'])).toBe(
      'Could not be read: Could not read the log. (EBUSY)\n'
    );
    expect(new TextDecoder().decode(entries['diagnostics.txt'])).toContain(
      'Could not be read: Could not read the log. (EBUSY)'
    );
  });
});

describe('unexpected errors', () => {
  it('reach the window as an event, can be copied with details, and are dismissed', async () => {
    const app = await start('generic-fresh');
    const fromMain = appErrors.report('main', new Error('tray exploded'));
    const event = app.events.find((e) => e.channel === 'diagnostics:event:error');
    expect(event?.payload).toMatchObject({
      id: fromMain.id,
      source: 'main',
      message: 'tray exploded',
    });

    const fromWindow = await app.invoke<ErrorReportView>('diagnostics:report', {
      message: 'Cannot read properties of undefined',
      detail: 'at Page.vue:12',
    });
    expect(fromWindow).toMatchObject({ source: 'window', count: 1, detail: 'at Page.vue:12' });
    // The same error again only counts up.
    const again = await app.invoke<ErrorReportView>('diagnostics:report', {
      message: 'Cannot read properties of undefined',
    });
    expect(again).toMatchObject({ id: fromWindow.id, count: 2 });

    const pending = await app.invoke<ErrorReportView[]>('diagnostics:errors');
    expect(pending.map((r) => r.message)).toEqual([
      'tray exploded',
      'Cannot read properties of undefined',
    ]);

    const copied = await app.invoke<{ characters: number }>('diagnostics:copyError', {
      id: fromMain.id,
    });
    const text = app.ports.clipboard.copied.at(-1)!;
    expect(copied.characters).toBe(text.length);
    expect(text).toMatch(/^RigReady \d+\.\d+\.\d+\S* on /);
    expect(text).toContain('2026-10-03T12:00:00.000Z unexpected error in main');
    expect(text).toContain('tray exploded');
    expect(text).toContain('Error: tray exploded\n    at ');
    await expect(app.invoke('diagnostics:copyError', { id: 'nope' })).rejects.toThrow(
      /no longer in the list/
    );

    const one = await app.invoke<{ remaining: number }>('diagnostics:dismissErrors', {
      ids: [fromMain.id],
    });
    expect(one.remaining).toBe(1);
    const none = await app.invoke<{ remaining: number }>('diagnostics:dismissErrors');
    expect(none.remaining).toBe(0);
    expect(await app.invoke<ErrorReportView[]>('diagnostics:errors')).toEqual([]);
    // Dismissed, but still part of the diagnostics of this run.
    await app.invoke('diagnostics:copy');
    expect(app.ports.clipboard.copied.at(-1)).toContain('main: tray exploded');
  });
});
