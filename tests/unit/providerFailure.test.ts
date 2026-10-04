import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/core/logger';
import { NameRegistry } from '../../src/core/names';
import { refuseWhileRunning } from '../../src/features/racing/core/context';
import { discoverFeatures, wireFeatures } from '../../src/main/bootstrap';
import { NodeRawFs } from '../../src/platform/node';
import { mutate, scenarioRig, wiredApp, type TestRig, type WiredApp } from '../helpers';

/** Expected failures are values that reach the screen, never a throw and never a wrong "all fine". */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function rigOn(scenario: string): Promise<TestRig> {
  const rig = await scenarioRig(scenario, { files: [] });
  cleanups.push(rig.cleanup);
  return rig;
}

describe('a provider that fails', () => {
  it('the failProvider mutation makes every read of a port answer with an error, and stops again', async () => {
    const rig = await rigOn('generic-fresh');
    await mutate(rig, [
      { op: 'failProvider', port: 'devices', message: 'USB enumeration failed.' },
      { op: 'failProvider', port: 'displays' },
      { op: 'failProvider', port: 'audio' },
      { op: 'failProvider', port: 'processes' },
      { op: 'failProvider', port: 'services' },
    ]);
    expect(await rig.ports.devices.list()).toEqual({
      ok: false,
      error: {
        code: 'devices.read',
        message: 'USB enumeration failed.',
        detail: 'The driver call failed (0x80004005).',
      },
    });
    for (const read of [
      () => rig.ports.displays.read(),
      () => rig.ports.audio.read(),
      () => rig.ports.processes.list(),
      () => rig.ports.services.list(),
      () => rig.ports.services.get('Spooler'),
    ]) {
      const result = await read();
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.message).toMatch(/^Windows did not answer the request for /);
    }
    await mutate(rig, [{ op: 'failProvider', port: 'devices', fail: false }]);
    expect((await rig.ports.devices.list()).ok).toBe(true);
    expect((await rig.ports.displays.read()).ok).toBe(false);
  });

  it('every check of a setup reports the failure as not met, with the message', async () => {
    const app: WiredApp = await wiredApp('flying-all-good', { files: [] });
    cleanups.push(app.cleanup);
    await mutate(app, [
      { op: 'failProvider', port: 'devices', message: 'USB enumeration failed.' },
      { op: 'failProvider', port: 'processes', message: 'The process list failed.' },
      { op: 'failProvider', port: 'displays', message: 'The display driver failed.' },
    ]);
    const report = await app.invoke<{
      ready: boolean;
      results: { status: string; summary: string; group: string }[];
    }>('fly:check', { profileId: 'dcs-f-a-18c' });
    expect(report.ready).toBe(false);
    const summaries = new Set(report.results.map((r) => r.summary));
    expect(summaries).toContain('USB enumeration failed.');
    expect(summaries).toContain('The process list failed.');
    expect([...summaries].some((s) => s.includes('The display driver failed.'))).toBe(true);
    expect(report.results.every((r) => r.status !== 'pass')).toBe(true);
    // The pages' own reads fail as results, through IPC validation.
    for (const channel of ['devices:overview', 'displays:view', 'displays:read']) {
      const envelope = await app.wiring.handlers.get(channel)?.(undefined);
      expect(envelope, channel).toMatchObject({ ok: false });
      if (envelope && !envelope.ok) expect(envelope.error.code).not.toMatch(/^ipc\./);
    }
  });

  it('a game is not written to when RigReady cannot see whether it is running', async () => {
    const rig = await rigOn('racing-fresh');
    expect(await refuseWhileRunning(rig.ctx, 'iracing')).toEqual({ ok: true, value: undefined });
    await mutate(rig, [{ op: 'failProvider', port: 'processes', message: 'Access is denied.' }]);
    expect(await refuseWhileRunning(rig.ctx, 'iracing')).toEqual({
      ok: false,
      error: {
        code: 'racing.processes',
        message:
          'RigReady could not see which programs are running, so it cannot tell whether iRacing is open.',
        detail: 'Access is denied.',
      },
    });
  });

  it('a folder that exists but cannot be listed is an error, not an empty folder', async () => {
    const rig = await rigOn('generic-fresh');
    const raw = new NodeRawFs();
    const file = path.join(rig.home, 'not-a-folder');
    await fs.writeFile(file, 'x');
    await expect(raw.list(file)).rejects.toThrow(/ENOTDIR/);
    expect(await raw.list(path.join(rig.home, 'missing'))).toEqual([]);
    const listed = await rig.ports.files.list(file);
    expect(listed).toMatchObject({ ok: false, error: { code: 'file.list' } });
    expect(await rig.ports.files.listEntries(file)).toMatchObject({ ok: false });
    expect(await rig.ports.files.listTree(file)).toMatchObject({ ok: false });
    expect(await rig.ports.files.list(path.join(rig.home, 'missing'))).toEqual({
      ok: true,
      value: [],
    });
  });
});

describe('what is logged about failures', () => {
  it('an error answer of any request is in the detailed log; a handler that throws is an error entry', async () => {
    const rig = await rigOn('generic-fresh');
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line) }, rig.clock, 'debug');
    const wiring = wireFeatures({
      features: [
        ...discoverFeatures(),
        {
          id: 'broken',
          setup: () => [],
        },
      ],
      ports: rig.ports,
      log,
      send: () => {},
    });
    await mutate(rig, [{ op: 'failProvider', port: 'audio', message: 'No audio service.' }]);
    const answer = await wiring.handlers.get('audio:view')!(undefined);
    expect(answer.ok).toBe(false);
    expect(lines.some((l) => /DEBUG \[app\] ipc audio:view answered with an error/.test(l))).toBe(
      true
    );
    expect(lines.join('')).toContain('No audio service.');

    // A bug in a handler: the screen gets an error result, and the log gets the stack.
    rig.ports.audio.read = async () => {
      throw new Error('null dereference in the audio provider');
    };
    const thrown = await wiring.handlers.get('audio:view')!(undefined);
    expect(thrown).toMatchObject({ ok: false, error: { code: 'ipc.handler' } });
    expect(lines.some((l) => /ERROR \[app\] ipc audio:view Error: null dereference/.test(l))).toBe(
      true
    );
  });

  it('names are never worth failing for, but a provider that fails is logged', async () => {
    const lines: string[] = [];
    const rig = await rigOn('generic-fresh');
    const names = new NameRegistry(createLogger({ write: (l) => lines.push(l) }, rig.clock));
    names.provideMonitors(async () => {
      throw new Error('names.json is damaged');
    });
    names.provideDevices(async () => {
      throw new Error('devices.json is damaged');
    });
    expect(await names.monitors()).toEqual({});
    expect((await names.devices()).nameOf({ vendorId: '044F', productId: 'B68F' })).toBeUndefined();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('WARN  [app] monitor names could not be read Error: names.json');
    expect(lines[1]).toContain('device names could not be read');
    // Without a logger it still does not throw.
    const quiet = new NameRegistry();
    quiet.provideMonitors(async () => {
      throw new Error('x');
    });
    expect(await quiet.monitors()).toEqual({});
  });
});
