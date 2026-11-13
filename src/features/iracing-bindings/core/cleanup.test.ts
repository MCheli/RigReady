import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixturesDir, mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { Envelope } from '../../../shared/ipc';
import type {
  ClearGoneRequest,
  ClearGoneResult,
  ClearGoneReview,
  GoneDevice,
  GoneView,
  SetView,
} from '../contract';
import { EDIT_SWITCH } from './change';
import { clearDevices } from './cleanup';
import {
  RECORD_BYTES,
  encodeControlsFile,
  encodeRecordData,
  parseControlsFile,
} from './controlsFile';
import { KEPT_BYTES } from './edit';

/**
 * Clearing the bindings of controllers that are gone, on the scenario
 * iracing-bindings-cleanup: the owner's control profile with seven more bindings on three
 * controllers that are not plugged in. Two of them RigReady has never seen (gone), one the
 * Devices page's history saw (only unplugged).
 */

const SCENARIO = 'iracing-bindings-cleanup';
const WHEEL = '45D4BEA1-60A1-17D8-8001-444553540000';
const PEDALS = '5EED00A1-7A11-11EF-8001-444553540000';
const BOX = '5EED00A2-7A11-11EF-8002-444553540000';
const RUDDER = '0F1424B4-D566-14A0-801B-444553540000';
const PEDAL_ACTIONS = ['Throttle2', 'Brake2', 'Clutch2'];
const BOX_ACTIONS = ['HeadlightFlash', 'PushToPass', 'DRS'];
const OFF = {
  code: 'iracing-bindings.edit.off',
  message: 'RigReady does not change iRacing bindings yet. Change them in iRacing.',
};
const DATA = (name: string): string =>
  path.join(fixturesDir, 'scenarios', 'data', 'iracing-bindings', name);

let app: WiredApp | undefined;
let switchBefore: string | undefined;
beforeEach(() => {
  switchBefore = process.env[EDIT_SWITCH];
  delete process.env[EDIT_SWITCH];
});
afterEach(async () => {
  if (switchBefore === undefined) delete process.env[EDIT_SWITCH];
  else process.env[EDIT_SWITCH] = switchBefore;
  await app?.cleanup();
  app = undefined;
});

async function start(on: boolean, scenario = SCENARIO): Promise<WiredApp> {
  if (on) process.env[EDIT_SWITCH] = '1';
  return (app = await wiredApp(scenario, { files: ['Documents/iRacing/**'] }));
}
const call = (a: WiredApp, channel: string, input?: unknown): Promise<Envelope> =>
  a.wiring.handlers.get(`iracing-bindings:${channel}`)!(input);
const goneOf = (a: WiredApp, set = 'all'): Promise<GoneView> =>
  a.invoke<GoneView>('iracing-bindings:goneDevices', { set });
const review = (a: WiredApp, request: ClearGoneRequest): Promise<ClearGoneReview> =>
  a.invoke<ClearGoneReview>('iracing-bindings:clearGonePreview', request);
const clear = (a: WiredApp, request: ClearGoneRequest): Promise<ClearGoneResult> =>
  a.invoke<ClearGoneResult>('iracing-bindings:clearGone', request);
const device = (view: GoneView, key: string): GoneDevice | undefined =>
  view.devices.find((d) => d.key === key);

const profile = (a: WiredApp): string =>
  path.join(
    a.ports.folders.documents(),
    'iRacing',
    'profiles',
    'controls',
    'Baseline',
    'controls.cfg'
  );
const bytesOf = async (file: string): Promise<Uint8Array> =>
  new Uint8Array(await fs.readFile(file));
const equal = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
async function journal(a: WiredApp) {
  const entries = await a.ports.files.journal();
  if (!entries.ok) throw new Error(entries.error.message);
  return entries.value;
}
const historyFile = (a: WiredApp): string =>
  path.join(a.ports.folders.dataRoot(), 'devices-history.json');

/** Offsets, inside its record, of every byte that differs, by action. */
function changedRecords(before: Uint8Array, after: Uint8Array): Map<string, number[]> {
  expect(after.length).toBe(before.length);
  const parsed = parseControlsFile(before);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const out = new Map<string, number[]>();
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const record = parsed.value.records.find((r) => i >= r.offset && i < r.offset + RECORD_BYTES);
    const name = record?.action ?? '(outside every record)';
    out.set(name, [...(out.get(name) ?? []), i - (record?.offset ?? 0)]);
  }
  return out;
}

describe('iRacing cleanup: which controllers are gone', () => {
  it('lists the controllers that are not plugged in: two gone, one only unplugged, with why', async () => {
    const a = await start(false);
    const view = await goneOf(a);
    expect(view.set).toMatchObject({ id: 'all', general: true, profile: 'Baseline' });
    // The wheel is plugged in under the id the profile names: not listed.
    expect(device(view, WHEEL)).toBeUndefined();
    expect(view.devices.map((d) => [d.name, d.verdict])).toEqual([
      ['Controller 1209:5ED2', 'gone'],
      ['Load Cell Pedals', 'gone'],
      ['T-Pendular-Rudder', 'unplugged'],
    ]);
    expect(device(view, PEDALS)).toMatchObject({
      vendorId: '1209',
      productId: '5ED1',
      why: 'Not plugged in, and RigReady has never seen it on this PC. If it is yours and only unplugged, leave it.',
      bindings: [
        { action: 'Throttle2', name: expect.any(String), input: 'Throttle' },
        { action: 'Brake2', name: expect.any(String), input: 'Brake' },
        { action: 'Clutch2', name: expect.any(String), input: 'Clutch' },
      ],
    });
    // In the file's order.
    expect(device(view, BOX)!.bindings.map((b) => [b.action, b.input])).toEqual([
      ['PushToPass', 'Button 3'],
      ['DRS', 'Button 4'],
      ['HeadlightFlash', 'Button 1'],
    ]);
    // Unplugged today is not gone: the history saw it on 10 November.
    expect(device(view, RUDDER)!.why).toMatch(
      /^Unplugged today\. RigReady last saw it on this PC on 1[01] November 2026, so its bindings stay\. If Windows gives it a new id when you plug it in, point iRacing at the new id on the iRacing page\.$/
    );
    expect(device(view, RUDDER)!.bindings.map((b) => b.action)).toEqual(['Handbrake']);
  });

  it('knows a controller by the history the Devices page keeps: seen once, it is never gone', async () => {
    const a = await start(false);
    // Without the history the rudder pedals are a controller RigReady never saw.
    await fs.rm(historyFile(a));
    expect(device(await goneOf(a), RUDDER)!.verdict).toBe('gone');

    // Plugged in while RigReady watches: the Devices page records it, and it is listed no more.
    await mutate(a, [{ op: 'plugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
    await a.invoke('devices:overview');
    expect(device(await goneOf(a), RUDDER)).toBeUndefined();
    const history = JSON.parse(await fs.readFile(historyFile(a), 'utf8')) as {
      seen: { vendorId: string; productId: string }[];
    };
    expect(history.seen.some((e) => e.vendorId === '044F' && e.productId === 'B68F')).toBe(true);

    // Unplugged again: known, so it is only unplugged.
    await mutate(a, [{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
    const rudder = device(await goneOf(a), RUDDER)!;
    expect(rudder.verdict).toBe('unplugged');
    expect(rudder.why).toMatch(/^Unplugged today\. RigReady last saw it on this PC on /);
  });

  it('a controller the owner named on the Devices page is known, even before it was seen', async () => {
    const a = await start(false);
    await fs.rm(historyFile(a));
    await fs.writeFile(
      path.join(a.ports.folders.dataRoot(), 'devices.json'),
      JSON.stringify({ names: [{ vendorId: '1209', productId: '5ED1', name: 'Old pedals' }] })
    );
    const pedals = device(await goneOf(a), PEDALS)!;
    expect(pedals.verdict).toBe('unplugged');
    expect(pedals.why).toMatch(
      /^Unplugged today\. RigReady knows it as yours, so its bindings stay\./
    );
  });

  it('cannot tell when the history cannot be read, and then leaves every binding alone', async () => {
    const a = await start(true);
    await fs.writeFile(historyFile(a), 'not the history');
    const view = await goneOf(a);
    expect(view.devices.map((d) => d.verdict)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(device(view, PEDALS)!.why).toBe(
      'RigReady cannot read its list of the devices it has seen, so it cannot tell whether this one is yours. It leaves its bindings alone.'
    );
    expect(await call(a, 'clearGonePreview', { set: 'all', devices: [PEDALS] })).toMatchObject({
      ok: false,
      error: { code: 'iracing-bindings.cleanup.notGone' },
    });
  });

  it('cannot tell when Windows does not list the controllers', async () => {
    const a = await start(true);
    await mutate(a, [{ op: 'failProvider', port: 'input', message: 'No input reader.' }]);
    const view = await goneOf(a);
    // The wheel too: nothing is known to be plugged in.
    expect(view.devices.map((d) => d.verdict)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ]);
    expect(device(view, PEDALS)!.why).toBe(
      'Windows did not list the controllers, so RigReady cannot tell whether this one is plugged in. It leaves its bindings alone.'
    );
    expect((await call(a, 'clearGone', { set: 'all', devices: [PEDALS] })).ok).toBe(false);
  });

  it('a controller with a new Windows id is the id repair’s, never cleared', async () => {
    const a = await start(true, 'racing-iracing-profiles-moved-wheel');
    const view = await goneOf(a);
    expect(view.devices).toEqual([
      expect.objectContaining({
        key: WHEEL,
        verdict: 'moved',
        why: 'A controller of this model is plugged in with a new Windows id. Point iRacing at the new id instead of clearing: its bindings then work again.',
      }),
    ]);
    const before = await bytesOf(profile(a));
    expect(await call(a, 'clearGone', { set: 'all', devices: [WHEEL] })).toMatchObject({
      ok: false,
      error: { code: 'iracing-bindings.cleanup.notGone' },
    });
    expect(equal(await bytesOf(profile(a)), before)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('a second id of a model that is plugged in is not gone', async () => {
    const a = await start(true);
    // The handbrake on the wheel base under an id of its own, as a base that shows up twice would have it.
    const parsed = parseControlsFile(await bytesOf(profile(a)));
    if (!parsed.ok) throw new Error(parsed.error.message);
    const record = parsed.value.records.find((r) => r.action === 'Handbrake')!;
    record.data = encodeRecordData(record.flag, record.mask, {
      kind: 'axis',
      axis: 5,
      instanceGuid: '45D4BEA1-60A1-17D8-8002-444553540000',
      productGuid: '00070EB7-0000-0000-0000-504944564944',
      direction: 0,
    });
    await fs.writeFile(profile(a), encodeControlsFile(parsed.value));
    const twin = device(await goneOf(a), '45D4BEA1-60A1-17D8-8002-444553540000')!;
    expect(twin.verdict).toBe('unplugged');
    expect(twin.why).toBe(
      'Another controller of this model is plugged in, so these bindings may well be yours. RigReady leaves them alone.'
    );
  });

  it('names nothing on a set where every controller is plugged in', async () => {
    const a = await start(false, 'iracing-bindings-profiles');
    expect(await goneOf(a)).toMatchObject({ set: { id: 'all' }, devices: [] });
  });
});

describe('iRacing cleanup: clearing the bindings of a gone controller', () => {
  it('is switched off with changing bindings: reading goes on, nothing is written', async () => {
    const a = await start(false);
    const before = await bytesOf(profile(a));
    expect((await goneOf(a)).devices).toHaveLength(3);
    for (const channel of ['clearGonePreview', 'clearGone']) {
      expect(await call(a, channel, { set: 'all', devices: [PEDALS] })).toMatchObject({
        ok: false,
        error: OFF,
      });
    }
    expect(equal(await bytesOf(profile(a)), before)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('shows first which bindings go, per controller chosen, and writes nothing', async () => {
    const a = await start(true);
    const before = await bytesOf(profile(a));
    const shown = await review(a, { set: 'all', devices: [PEDALS] });
    expect(shown.set).toMatchObject({ id: 'all', profile: 'Baseline', file: profile(a) });
    expect(shown.devices).toEqual([{ key: PEDALS, name: 'Load Cell Pedals', count: 3 }]);
    expect(shown.bindings.map((b) => [b.action, b.input])).toEqual([
      ['Throttle2', 'Throttle'],
      ['Brake2', 'Brake'],
      ['Clutch2', 'Clutch'],
    ]);
    expect(shown.blocked).toBeUndefined();
    expect(shown.seen).toMatch(/^[0-9a-f]{64}$/);
    expect(shown.preview.files).toEqual([
      { path: profile(a), label: 'controls.cfg', change: 'modified', detail: expect.any(String) },
    ]);
    expect(equal(await bytesOf(profile(a)), before)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('clears the chosen controller and nothing else: a backup first, one change, and Undo puts it back', async () => {
    const a = await start(true);
    const before = await bytesOf(profile(a));
    const told: unknown[] = [];
    a.wiring.context.bindings.onChanged((change) => told.push(change));
    const shown = await review(a, { set: 'all', devices: [PEDALS] });
    const result = await clear(a, { set: 'all', devices: [PEDALS], seen: shown.seen });
    expect(result).toEqual({
      cleared: 3,
      message:
        'Cleared 3 bindings of Load Cell Pedals in iRacing’s file for all cars. Undo is on the Safety page.',
      file: profile(a),
    });

    // Only the binding bytes of those three records changed.
    const after = await bytesOf(profile(a));
    const changed = changedRecords(before, after);
    expect([...changed.keys()].sort()).toEqual([...PEDAL_ACTIONS].sort());
    for (const offsets of changed.values()) {
      for (const o of offsets) {
        expect(o).toBeGreaterThanOrEqual(KEPT_BYTES);
        expect(o).toBeLessThan(RECORD_BYTES);
      }
    }
    // The pedals are no longer named; the button box, which was not chosen, keeps its bindings.
    const view = await goneOf(a);
    expect(device(view, PEDALS)).toBeUndefined();
    expect(device(view, BOX)!.bindings).toHaveLength(3);
    const set = await a.invoke<SetView>('iracing-bindings:set', { id: 'all' });
    for (const id of PEDAL_ACTIONS) {
      expect(set.actions.find((x) => x.id === id)!.binding).toBeUndefined();
    }

    const entries = await journal(a);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: profile(a),
      action: 'write',
      reason: 'Clear the bindings of controllers that are gone in controls.cfg',
      groupReason: 'iRacing bindings for all cars: cleared 3 bindings of Load Cell Pedals',
    });
    expect(equal(await bytesOf(entries[0]!.backupPath!), before)).toBe(true);
    // Cheat sheets and the other pages that show bindings are told, once, after the write.
    expect(told).toEqual([{ game: 'iracing' }]);

    expect((await a.ports.files.undoGroup(entries[0]!.groupId!)).ok).toBe(true);
    expect(equal(await bytesOf(profile(a)), before)).toBe(true);
  });

  it('gives each cleared action exactly what iRacing had for it before it was bound', async () => {
    const a = await start(true);
    await clear(a, { set: 'all', devices: [PEDALS, BOX] });
    // The scenario's file is the owner's profile with seven records bound; six are cleared.
    const original = await bytesOf(DATA('profile-controls.cfg'));
    const changed = changedRecords(original, await bytesOf(profile(a)));
    expect([...changed.keys()]).toEqual(['Handbrake']);
  });

  it('never clears a controller that is only unplugged, whatever is asked', async () => {
    const a = await start(true);
    const before = await bytesOf(profile(a));
    for (const devices of [
      [RUDDER],
      [PEDALS, RUDDER],
      [WHEEL],
      ['00000000-0000-0000-0000-000000000000'],
    ]) {
      for (const channel of ['clearGonePreview', 'clearGone']) {
        const answer = await call(a, channel, { set: 'all', devices });
        expect(answer.ok, `${channel} ${devices.join(',')}`).toBe(false);
      }
    }
    const answer = await call(a, 'clearGone', { set: 'all', devices: [RUDDER] });
    expect(answer).toMatchObject({
      ok: false,
      error: {
        code: 'iracing-bindings.cleanup.notGone',
        message: expect.stringMatching(/^T-Pendular-Rudder: Unplugged today\./),
      },
    });
    expect(equal(await bytesOf(profile(a)), before)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('while iRacing runs, or when RigReady cannot see the programs: shown, and nothing is written', async () => {
    const a = await start(true);
    const before = await bytesOf(profile(a));
    await mutate(a, [
      {
        op: 'startProcess',
        name: 'iRacingSim64DX11.exe',
        path: 'C:\\iRacing\\iRacingSim64DX11.exe',
      },
    ]);
    const close =
      'Close iRacing first. iRacing writes its bindings when it closes and would undo the change.';
    expect((await review(a, { set: 'all', devices: [PEDALS] })).blocked).toBe(close);
    expect(await call(a, 'clearGone', { set: 'all', devices: [PEDALS] })).toMatchObject({
      ok: false,
      error: { code: 'iracing-bindings.edit.blocked', message: close },
    });
    await mutate(a, [
      { op: 'stopProcess', name: 'iRacingSim64DX11.exe' },
      { op: 'failProvider', port: 'processes', message: 'Access denied.' },
    ]);
    expect(await call(a, 'clearGone', { set: 'all', devices: [PEDALS] })).toMatchObject({
      ok: false,
      error: { code: 'iracing-bindings.edit.blocked' },
    });
    expect(equal(await bytesOf(profile(a)), before)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('writes nothing when the file changed after the review', async () => {
    const a = await start(true);
    const shown = await review(a, { set: 'all', devices: [PEDALS] });
    // iRacing saved its own bindings meanwhile.
    const parsed = parseControlsFile(await bytesOf(profile(a)));
    if (!parsed.ok) throw new Error(parsed.error.message);
    const record = parsed.value.records.find((r) => r.action === 'Starter')!;
    record.data = encodeRecordData(record.flag, record.mask, { kind: 'none' });
    await fs.writeFile(profile(a), encodeControlsFile(parsed.value));
    const changed = await bytesOf(profile(a));
    expect(
      await call(a, 'clearGone', { set: 'all', devices: [PEDALS], seen: shown.seen })
    ).toMatchObject({ ok: false, error: { code: 'iracing-bindings.cleanup.changed' } });
    expect(equal(await bytesOf(profile(a)), changed)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });
});

describe('iRacing cleanup: the bytes', () => {
  it('the scenario’s file is the owner’s profile with seven records bound to three made-up controllers', async () => {
    const original = parseControlsFile(await bytesOf(DATA('profile-controls.cfg')));
    const cleanup = parseControlsFile(await bytesOf(DATA('profile-cleanup.cfg')));
    if (!original.ok || !cleanup.ok) throw new Error('unreadable fixture');
    const differs = cleanup.value.records.filter(
      (r, i) => !equal(r.data, original.value.records[i]!.data)
    );
    expect(differs.map((r) => r.action).sort()).toEqual(
      [...PEDAL_ACTIONS, ...BOX_ACTIONS, 'Handbrake'].sort()
    );
    expect(differs.every((r) => r.understood)).toBe(true);
    for (const r of differs) {
      expect(original.value.records.find((o) => o.action === r.action)!.binding.kind).toBe('none');
    }
  });

  it('refuses rather than guess: nothing to clear, a file it cannot rebuild, an action twice', async () => {
    const bytes = await bytesOf(DATA('profile-cleanup.cfg'));
    expect(clearDevices(bytes, ['11111111-2222-3333-4444-555555555555'])).toMatchObject({
      ok: false,
      error: { code: 'iracing-bindings.cleanup.nothing' },
    });
    expect(clearDevices(new Uint8Array([1, 2, 3]), [PEDALS]).ok).toBe(false);

    // A file whose records leave bytes before the chunk end unread cannot be put together again.
    const parsed = parseControlsFile(bytes);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const twice = {
      ...parsed.value,
      records: [...parsed.value.records, parsed.value.records.find((r) => r.action === 'Brake2')!],
    };
    const encoded = encodeControlsFile(twice);
    // The chunk length in the header no longer covers the last record: fix it as iRacing would.
    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    const chunk = Buffer.from(encoded).indexOf(Buffer.from('LRTC'));
    view.setUint32(
      chunk + 8,
      view.getUint32(chunk + 8, true) + 'Brake2'.length + 1 + RECORD_BYTES,
      true
    );
    expect(clearDevices(encoded, [PEDALS])).toMatchObject({
      ok: false,
      error: { code: 'iracing-bindings.cleanup.twice' },
    });
  });

  it('clears an axis and a button record to all zeros after the first two fields', async () => {
    const bytes = await bytesOf(DATA('profile-cleanup.cfg'));
    const cleared = clearDevices(bytes, [PEDALS.toLowerCase(), `{${BOX}}`]);
    if (!cleared.ok) throw new Error(cleared.error.message);
    expect(cleared.value.actions.sort()).toEqual([...PEDAL_ACTIONS, ...BOX_ACTIONS].sort());
    const after = parseControlsFile(cleared.value.bytes);
    if (!after.ok) throw new Error(after.error.message);
    for (const action of cleared.value.actions) {
      const r = after.value.records.find((x) => x.action === action)!;
      expect(r.binding).toEqual({ kind: 'none' });
      expect(r.data.subarray(KEPT_BYTES).every((b) => b === 0)).toBe(true);
    }
  });
});
