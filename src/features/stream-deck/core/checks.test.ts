import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { err } from '../../../core/result';
import { mutate, scenarioRig, wiredApp, type TestRig } from '../../../../tests/helpers';
import { closeApp, startApp } from './app';
import {
  connectedCheck,
  createStartRemediation,
  runningCheck,
  streamDeckCapture,
  streamDeckTrackedFiles,
} from './checks';

let rig: TestRig;
afterEach(() => rig?.cleanup());

const FILES = ['AppData/Roaming/Elgato/**', 'Program Files/Elgato/**'];
const sleepWith = (r: TestRig) => async (ms: number) => r.clock.advance(ms);

describe('stream-deck.running', () => {
  it('passes while the app runs and fails when it does not', async () => {
    rig = await scenarioRig('stream-deck-owner', { files: FILES });
    expect(await runningCheck.run({ closeOnStandDown: false }, rig.ctx)).toEqual({
      pass: true,
      summary: 'Running',
    });
    await mutate(rig, [{ op: 'stopProcess', name: 'StreamDeck.exe' }]);
    expect(await runningCheck.run({ closeOnStandDown: false }, rig.ctx)).toEqual({
      pass: false,
      summary: 'Not running',
    });
  });

  it('says when the app is not installed, and when the process list fails', async () => {
    rig = await scenarioRig('stream-deck-new-pc', { files: [] });
    expect(await runningCheck.run({ closeOnStandDown: false }, rig.ctx)).toMatchObject({
      pass: false,
      summary: 'Not installed',
    });
    rig.ports.processes.list = async () => err('process.list', 'No process list');
    expect(await runningCheck.run({ closeOnStandDown: false }, rig.ctx)).toEqual({
      pass: false,
      summary: 'No process list',
    });
  });

  it('is started by its fix, which waits until the app is running', async () => {
    rig = await scenarioRig('stream-deck-owner', { files: FILES });
    await mutate(rig, [{ op: 'stopProcess', name: 'StreamDeck.exe' }]);
    const fix = createStartRemediation(sleepWith(rig));
    expect(fix.describe({})).toBe('Start the Stream Deck app');
    expect(await fix.run({}, rig.ctx)).toEqual({ ok: true, value: 'Started Stream Deck' });
    expect(rig.ports.processes.started[0]!.exe).toBe(
      path.join(rig.home, 'Program Files', 'Elgato', 'StreamDeck', 'StreamDeck.exe')
    );
    expect(await runningCheck.run({ closeOnStandDown: false }, rig.ctx)).toMatchObject({
      pass: true,
    });
    expect(await fix.run({}, rig.ctx)).toEqual({
      ok: true,
      value: 'Stream Deck is already running',
    });
  });

  it('does not claim a start that did not happen', async () => {
    rig = await scenarioRig('stream-deck-owner', { files: FILES });
    await mutate(rig, [{ op: 'stopProcess', name: 'StreamDeck.exe' }]);
    rig.ports.processes.start = async () => ({ ok: true, value: { pid: 1 } });
    const result = await startApp(rig.ports, sleepWith(rig));
    expect(!result.ok && result.error.code).toBe('streamDeck.notStarted');
  });

  it('cannot start an app that is not installed', async () => {
    rig = await scenarioRig('stream-deck-new-pc', { files: [] });
    const result = await createStartRemediation(sleepWith(rig)).run({}, rig.ctx);
    expect(!result.ok && result.error.code).toBe('streamDeck.notInstalled');
  });

  it('closes the app on Stand down only when asked to', async () => {
    rig = await scenarioRig('stream-deck-owner', { files: FILES });
    expect(await runningCheck.standDown!({ closeOnStandDown: false }, rig.ctx)).toEqual({
      ok: true,
      value: null,
    });
    expect(await runningCheck.standDown!({ closeOnStandDown: true }, rig.ctx)).toEqual({
      ok: true,
      value: 'Closed Stream Deck',
    });
    expect(await runningCheck.standDown!({ closeOnStandDown: true }, rig.ctx)).toEqual({
      ok: true,
      value: null,
    });
  });

  it('passes on other close failures as they are', async () => {
    rig = await scenarioRig('stream-deck-owner', { files: FILES });
    rig.ports.processes.close = async () => err('process.stop', 'Access denied');
    expect(await closeApp(rig.ports)).toMatchObject({ ok: false, error: { code: 'process.stop' } });
  });
});

describe('stream-deck.connected', () => {
  it('passes for any Stream Deck, or for the one with a given serial', async () => {
    rig = await scenarioRig('stream-deck-owner', { files: [] });
    expect(await connectedCheck.run({}, rig.ctx)).toEqual({
      pass: true,
      summary: 'Stream Deck XL connected',
    });
    expect(await connectedCheck.run({ serial: 'A00NA33331P1UB' }, rig.ctx)).toMatchObject({
      pass: true,
    });
    expect(await connectedCheck.run({ serial: 'OTHER' }, rig.ctx)).toEqual({
      pass: false,
      summary: 'Not connected',
    });
    await mutate(rig, [{ op: 'unplugDevice', match: { vendorId: '0FD9' } }]);
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
});

describe('Stream Deck capture', () => {
  it('offers the app and the hardware as checks that work on any PC', async () => {
    rig = await scenarioRig('stream-deck-owner', { files: FILES });
    const candidates = await streamDeckCapture.capture(rig.ctx);
    expect(candidates.ok && candidates.value).toEqual([
      expect.objectContaining({
        group: 'apps',
        title: 'Stream Deck app',
        selectedByDefault: false,
        check: expect.objectContaining({
          type: 'stream-deck.running',
          remediation: { type: 'stream-deck.start', params: {} },
        }),
      }),
      expect.objectContaining({
        group: 'devices',
        title: 'Stream Deck hardware',
        check: expect.objectContaining({ type: 'stream-deck.connected', params: {} }),
      }),
    ]);
  });

  it('tells two Stream Decks apart by serial, and offers nothing on a PC without one', async () => {
    rig = await scenarioRig('stream-deck-owner', { files: FILES });
    const deck = rig.ports.state.devices.find((d) => d.vendorId === '0FD9')!;
    rig.ports.state.devices.push({
      ...deck,
      instanceId: 'USB\\VID_0FD9&PID_0080\\B1',
      productId: '0080',
      name: 'Stream Deck MK.2',
      serial: 'B1',
    });
    const two = await streamDeckCapture.capture(rig.ctx);
    const devices = two.ok ? two.value.filter((c) => c.group === 'devices') : [];
    expect(devices.map((c) => c.check.params)).toEqual([
      { serial: 'A00NA33331P1UB' },
      { serial: 'B1' },
    ]);
    await rig.cleanup();

    rig = await scenarioRig('stream-deck-new-pc', { files: [] });
    expect(await streamDeckCapture.capture(rig.ctx)).toEqual({ ok: true, value: [] });
  });

  it('is offered on the capture screen through the registry', async () => {
    const app = await wiredApp('stream-deck-owner', { files: FILES });
    try {
      expect(app.wiring.context.checks.check('stream-deck.running')).toBeDefined();
      expect(app.wiring.context.checks.remediation('stream-deck.start')).toBeDefined();
      expect(app.wiring.context.checks.allCaptures().map((c) => c.id)).toContain('stream-deck');
    } finally {
      await app.cleanup();
    }
  });
});

describe('Stream Deck tracked files', () => {
  it('names the profiles and plugins folders for a full backup', async () => {
    rig = await scenarioRig('stream-deck-owner', { files: FILES });
    const tracked = await streamDeckTrackedFiles(rig.ports);
    expect(tracked.ok && tracked.value.map((t) => t.label)).toEqual([
      'Stream Deck profiles',
      'Stream Deck plugins and their settings',
    ]);
    await rig.cleanup();
    rig = await scenarioRig('stream-deck-new-pc', { files: [] });
    expect(await streamDeckTrackedFiles(rig.ports)).toEqual({ ok: true, value: [] });
  });
});
