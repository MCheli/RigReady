import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { err } from '../../../core/result';
import { mutate, scenarioRig, wiredApp, type TestRig } from '../../../../tests/helpers';
import {
  connectedCheck,
  createStartRemediation,
  runningCheck,
  startTrackIr,
  trackIrCapture,
} from './checks';
import { trackIrOverview } from './overview';
import {
  decodeText,
  detectTrackIr,
  parseProfileMap,
  readTrackIrProfiles,
  trackIrTrackedFiles,
} from './trackir';

let rig: TestRig;
afterEach(() => rig?.cleanup());

const FILES = ['AppData/Roaming/NaturalPoint/**', 'Program Files (x86)/TrackIR5/**'];
const sleepWith = (r: TestRig) => async (ms: number) => r.clock.advance(ms);

describe('TrackIR detection', () => {
  it('finds the software, its version, the camera and the NPClient registration games use', async () => {
    rig = await scenarioRig('trackir-ready', { files: FILES });
    const status = await detectTrackIr(rig.ports);
    expect(status.ok && status.value).toMatchObject({
      installed: true,
      exePath: path.join(rig.home, 'Program Files (x86)', 'TrackIR5', 'TrackIR5.exe'),
      version: '5.5.3.317',
      running: true,
      devices: [{ name: 'TrackIR 5', productId: '0159' }],
      npClient: {
        ok: true,
        path: path.join(rig.home, 'Program Files (x86)', 'TrackIR5') + path.sep,
      },
    });
  });

  it('explains why games cannot find TrackIR', async () => {
    rig = await scenarioRig('trackir-not-running', { files: FILES });
    let status = await detectTrackIr(rig.ports);
    expect(status.ok && status.value.npClient).toMatchObject({
      ok: false,
      problem: expect.stringContaining('start it once'),
    });
    expect(status.ok && status.value.running).toBe(false);
    await mutate(rig, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: 'Software\\NaturalPoint\\NATURALPOINT\\NPClient Location',
        name: 'Path',
        value: { type: 'string', value: 'C:\\opentrack\\' },
      },
    ]);
    status = await detectTrackIr(rig.ports);
    expect(status.ok && status.value.npClient).toMatchObject({
      ok: false,
      path: 'C:\\opentrack\\',
      problem: expect.stringContaining('no NPClient64.dll'),
    });
  });

  it('reports a PC without TrackIR', async () => {
    rig = await scenarioRig('trackir-not-installed', { files: [] });
    const status = await detectTrackIr(rig.ports);
    expect(status.ok && status.value).toMatchObject({
      installed: false,
      running: false,
      devices: [],
      npClient: { ok: false, problem: expect.stringContaining('not installed') },
    });
    const profiles = await readTrackIrProfiles(rig.ports);
    expect(profiles.ok && profiles.value).toEqual({
      settingsFound: false,
      profiles: [],
      map: { found: false, games: 0, byProfile: [] },
    });
  });

  it('fails cleanly when the machine cannot be read', async () => {
    rig = await scenarioRig('trackir-ready', { files: [] });
    rig.ports.devices.list = async () => err('devices.list', 'USB unavailable');
    expect(await detectTrackIr(rig.ports)).toMatchObject({ ok: false });
    expect(await trackIrOverview(rig.ports)).toMatchObject({ ok: false });
    rig.ports.processes.list = async () => err('process.list', 'No list');
    expect(await detectTrackIr(rig.ports)).toMatchObject({
      ok: false,
      error: { message: 'No list' },
    });
  });
});

describe('TrackIR profiles and the game map', () => {
  it('reads the profiles (UTF-16 or not), the last and exclusive profile, and the recorded map', async () => {
    rig = await scenarioRig('trackir-ready', { files: FILES });
    const result = await readTrackIrProfiles(rig.ports);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.profiles.map((p) => [p.file, p.name])).toEqual([
      ['default.xml', 'Default'],
      ['driving.xml', 'Driving'],
      ['flying.xml', 'Flying'],
      ['smooth.xml', 'Smooth'],
    ]);
    expect(result.value).toMatchObject({ settingsFound: true, lastProfile: 'default.xml' });
    expect(result.value.exclusiveProfile).toBeUndefined();
    // The owner's ProfileMap.dat: every game on default.xml; -1 is not a game.
    expect(result.value.map.found).toBe(true);
    expect(result.value.map.byProfile).toHaveLength(1);
    expect(result.value.map.byProfile[0]).toMatchObject({
      file: 'default.xml',
      name: 'Default',
      exists: true,
    });
    expect(result.value.map.games).toBe(result.value.map.byProfile[0]!.gameIds.length);
    expect(result.value.map.games).toBeGreaterThan(700);
    expect(result.value.map.byProfile[0]!.gameIds).not.toContain('-1');
  });

  it('flags a mapped profile file that does not exist and reads an exclusive profile', async () => {
    rig = await scenarioRig('trackir-ready', { files: FILES });
    const dir = path.join(rig.home, 'AppData', 'Roaming', 'NaturalPoint', 'TrackIR 5');
    await fs.writeFile(
      path.join(dir, 'ProfileMap.dat'),
      '-1 default.xml\r\n1001 flying.xml\r\n1002 gone.xml\r\n1003 flying.xml\r\nnonsense\r\n'
    );
    await fs.writeFile(
      path.join(dir, 'Settings.xml'),
      '<Settings><ExclusiveProfile>flying.xml</ExclusiveProfile><LastProfile>a &amp; b.xml</LastProfile></Settings>'
    );
    const result = await readTrackIrProfiles(rig.ports);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.map.byProfile).toEqual([
      { file: 'flying.xml', name: 'Flying', exists: true, gameIds: ['1001', '1003'] },
      { file: 'gone.xml', exists: false, gameIds: ['1002'] },
    ]);
    expect(result.value).toMatchObject({
      exclusiveProfile: 'flying.xml',
      lastProfile: 'a & b.xml',
    });
  });

  it('decodes the text encodings TrackIR uses', () => {
    const text = '<Name>Flying</Name>';
    expect(
      decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]))
    ).toBe(text);
    expect(decodeText(Buffer.from(text, 'utf16le'))).toBe(text);
    const be = Buffer.from(text, 'utf16le').swap16();
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe(text);
    expect(decodeText(Buffer.from(`\uFEFF${text}`, 'utf8'))).toBe(text);
    expect(parseProfileMap('1 a.xml\n  22   b c.xml  \nx')).toEqual([
      { gameId: '1', file: 'a.xml' },
      { gameId: '22', file: 'b c.xml' },
    ]);
  });

  it('lists the files a full backup should keep', async () => {
    rig = await scenarioRig('trackir-ready', { files: FILES });
    const tracked = await trackIrTrackedFiles(rig.ports);
    expect(tracked.ok && tracked.value.map((t) => t.label)).toEqual([
      'TrackIR settings',
      'TrackIR game-to-profile map',
      'TrackIR profile default.xml',
      'TrackIR profile driving.xml',
      'TrackIR profile flying.xml',
      'TrackIR profile smooth.xml',
    ]);
  });
});

describe('TrackIR checks', () => {
  it('trackir.running passes, fails and is fixed by starting TrackIR', async () => {
    rig = await scenarioRig('trackir-ready', { files: FILES });
    expect(await runningCheck.run({ closeOnStandDown: false }, rig.ctx)).toEqual({
      pass: true,
      summary: 'Running',
    });
    await mutate(rig, [{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
    expect(await runningCheck.run({ closeOnStandDown: false }, rig.ctx)).toEqual({
      pass: false,
      summary: 'Not running',
    });
    const fix = createStartRemediation(sleepWith(rig));
    expect(fix.describe({})).toBe('Start TrackIR');
    expect(await fix.run({}, rig.ctx)).toEqual({ ok: true, value: 'Started TrackIR' });
    expect(rig.ports.processes.started[0]!.exe).toBe(
      path.join(rig.home, 'Program Files (x86)', 'TrackIR5', 'TrackIR5.exe')
    );
    expect(await fix.run({}, rig.ctx)).toEqual({ ok: true, value: 'TrackIR is already running' });
  });

  it('notes when TrackIR runs but games cannot see it', async () => {
    rig = await scenarioRig('trackir-not-running', { files: FILES });
    await mutate(rig, [
      {
        op: 'startProcess',
        name: 'TrackIR5.exe',
        path: 'C:\\Program Files (x86)\\TrackIR5\\TrackIR5.exe',
      },
    ]);
    const outcome = await runningCheck.run({ closeOnStandDown: false }, rig.ctx);
    expect(outcome.pass).toBe(true);
    expect(outcome.details?.[0]).toContain('Games cannot find TrackIR');
  });

  it('does not claim a start that did not happen, nor start what is not installed', async () => {
    rig = await scenarioRig('trackir-not-running', { files: FILES });
    rig.ports.processes.start = async () => ({ ok: true, value: { pid: 1 } });
    expect(await startTrackIr(rig.ports, sleepWith(rig))).toMatchObject({
      ok: false,
      error: { code: 'trackir.notStarted' },
    });
    await rig.cleanup();
    rig = await scenarioRig('trackir-not-installed', { files: [] });
    expect(await runningCheck.run({ closeOnStandDown: false }, rig.ctx)).toEqual({
      pass: false,
      summary: 'Not installed',
    });
    expect(await startTrackIr(rig.ports, sleepWith(rig))).toMatchObject({
      ok: false,
      error: { code: 'trackir.notInstalled' },
    });
    rig.ports.processes.list = async () => err('process.list', 'No list');
    expect(await runningCheck.run({ closeOnStandDown: false }, rig.ctx)).toEqual({
      pass: false,
      summary: 'No list',
    });
  });

  it('closes TrackIR on Stand down only when asked to', async () => {
    rig = await scenarioRig('trackir-ready', { files: FILES });
    expect(await runningCheck.standDown!({ closeOnStandDown: false }, rig.ctx)).toEqual({
      ok: true,
      value: null,
    });
    expect(await runningCheck.standDown!({ closeOnStandDown: true }, rig.ctx)).toEqual({
      ok: true,
      value: 'Closed TrackIR',
    });
    expect(await runningCheck.standDown!({ closeOnStandDown: true }, rig.ctx)).toEqual({
      ok: true,
      value: null,
    });
    rig.ports.processes.list = async () => err('process.list', 'No list');
    expect(await runningCheck.standDown!({ closeOnStandDown: true }, rig.ctx)).toMatchObject({
      ok: false,
    });
  });

  it('trackir.connected follows the camera', async () => {
    rig = await scenarioRig('trackir-ready', { files: [] });
    expect(await connectedCheck.run({}, rig.ctx)).toEqual({
      pass: true,
      summary: 'TrackIR 5 connected · Generic USB Hub',
    });
    await mutate(rig, [{ op: 'unplugDevice', match: { vendorId: '131D' } }]);
    expect(await connectedCheck.run({}, rig.ctx)).toEqual({
      pass: false,
      summary: 'Not connected',
    });
    rig.ports.devices.list = async () => err('devices.list', 'USB unavailable');
    expect(await connectedCheck.run({}, rig.ctx)).toEqual({
      pass: false,
      summary: 'USB unavailable',
    });
  });

  it('capture offers the software and the camera, and nothing without TrackIR', async () => {
    rig = await scenarioRig('trackir-ready', { files: FILES });
    const candidates = await trackIrCapture.capture(rig.ctx);
    expect(candidates.ok && candidates.value.map((c) => [c.group, c.title, c.check.type])).toEqual([
      ['apps', 'TrackIR software', 'trackir.running'],
      ['devices', 'TrackIR camera', 'trackir.connected'],
    ]);
    await rig.cleanup();
    rig = await scenarioRig('trackir-not-installed', { files: [] });
    expect(await trackIrCapture.capture(rig.ctx)).toEqual({ ok: true, value: [] });
  });

  it('the overview and start channels work through IPC', async () => {
    const app = await wiredApp('trackir-not-running', { files: FILES });
    try {
      const overview = await app.invoke<{ status: { running: boolean }; downloadUrl: string }>(
        'trackir:overview'
      );
      expect(overview.status.running).toBe(false);
      expect(overview.downloadUrl).toBe('https://www.trackir.com/downloads/');
      app.ports.processes.start = async (target) => {
        app.ports.state.processes.push({ pid: 9000, name: 'TrackIR5.exe', path: target.exe });
        return { ok: true, value: { pid: 9000 } };
      };
      expect(await app.invoke('trackir:start')).toEqual({ message: 'Started TrackIR' });
    } finally {
      await app.cleanup();
    }
  });
});
