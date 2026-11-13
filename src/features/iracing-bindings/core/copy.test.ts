import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixturesDir, mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { Envelope } from '../../../shared/ipc';
import type { CopyCompare, CopyRequest, CopyResult, CopyReview, Overview } from '../contract';
import { RECORD_BYTES, parseControlsFile } from './controlsFile';
import { KEPT_BYTES } from './edit';

/**
 * The control profiles of iRacing 2026.11, as the owner's rig had them at 12:27 on 13 Nov
 * 2026: "Baseline" for all cars, and "Test Profile CTSV" for the Cadillac CTS-V, which is
 * Baseline with two more bindings (LookUp on button 10 of the wheel, ToggleUIVisibleDrive on
 * Shift+J). The made-up wheel id of the recorded rig stands in for the real one.
 */

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

const BASELINE = 'Baseline';
const TEST = 'Test Profile CTSV';
const SIMULATOR = {
  op: 'startProcess' as const,
  name: 'iRacingSim64DX11.exe',
  path: 'C:\\iRacing\\iRacingSim64DX11.exe',
};

async function start(): Promise<WiredApp> {
  return (app = await wiredApp('iracing-bindings-profile-car', {
    files: ['Documents/iRacing/**'],
  }));
}
const call = (a: WiredApp, channel: string, input?: unknown): Promise<Envelope> =>
  a.wiring.handlers.get(`iracing-bindings:${channel}`)!(input);
const compare = (a: WiredApp, fromProfile: string, toProfile: string): Promise<CopyCompare> =>
  a.invoke<CopyCompare>('iracing-bindings:copyCompare', { fromProfile, toProfile });
const profilesDir = (a: WiredApp): string =>
  path.join(a.ports.folders.documents(), 'iRacing', 'profiles', 'controls');
const fileOf = (a: WiredApp, profile: string): string =>
  path.join(profilesDir(a), profile, 'controls.cfg');
const bytesOf = async (file: string): Promise<Buffer> => fs.readFile(file);
async function journal(a: WiredApp) {
  const entries = await a.ports.files.journal();
  if (!entries.ok) throw new Error(entries.error.message);
  return entries.value;
}
/** The offsets of the bytes that differ, by the action whose record holds each. */
function changedRecords(before: Uint8Array, after: Uint8Array): Map<string, number[]> {
  expect(after.length).toBe(before.length);
  const parsed = parseControlsFile(before);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const out = new Map<string, number[]>();
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const record = parsed.value.records.find((r) => i >= r.offset && i < r.offset + RECORD_BYTES);
    const name = record?.action ?? 'outside every record';
    out.set(name, [...(out.get(name) ?? []), i - (record?.offset ?? 0)]);
  }
  return out;
}
/** A profile of our own, made from another one's file with some bytes changed. */
async function makeProfile(
  a: WiredApp,
  name: string,
  from: string,
  change: (bytes: Buffer) => void = () => undefined
): Promise<string> {
  const bytes = Buffer.from(await bytesOf(fileOf(a, from)));
  change(bytes);
  await fs.mkdir(path.join(profilesDir(a), name), { recursive: true });
  await fs.writeFile(fileOf(a, name), bytes);
  return fileOf(a, name);
}
/** Where the 68 bytes of one action's record start in a file. */
function recordAt(bytes: Uint8Array, action: string): number {
  const parsed = parseControlsFile(bytes);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value.records.find((r) => r.action === action)!.offset;
}

describe('iRacing control profiles: which there are, and which cars use which', () => {
  it('lists every profile, the one for all cars, and the car that has its own', async () => {
    const a = await start();
    const overview = await a.invoke<Overview>('iracing-bindings:overview');
    expect(overview.profiles).toEqual({
      appIni: path.join(a.ports.folders.documents(), 'iRacing', 'app.ini'),
      global: BASELINE,
      profiles: [
        {
          name: BASELINE,
          folder: path.join(profilesDir(a), BASELINE),
          hasControls: true,
          forAllCars: true,
          cars: [],
        },
        {
          name: TEST,
          folder: path.join(profilesDir(a), TEST),
          hasControls: true,
          forAllCars: false,
          cars: ['cadillacctsvr'],
        },
      ],
      missing: [],
    });
  });

  it('a profile no car uses, a car on the profile for all cars, and a line naming no folder', async () => {
    const a = await start();
    await makeProfile(a, 'Night', BASELINE);
    await fs.mkdir(path.join(profilesDir(a), 'Empty'), { recursive: true });
    const ini = path.join(a.ports.folders.documents(), 'iRacing', 'app.ini');
    const text = await fs.readFile(ini, 'latin1');
    await fs.writeFile(
      ini,
      text.replace(
        '[ControlProfiles]\r\n',
        '[ControlProfiles]\r\nmx5 mx52016=baseline\r\nporsche911gt3r=Gone Profile\r\nCADILLACCTSVR=Night\r\n'
      ),
      'latin1'
    );
    const { profiles } = await a.invoke<Overview>('iracing-bindings:overview');
    expect(
      profiles!.profiles.map((p) => [p.name, p.hasControls, p.forAllCars, p.cars.join(', ')])
    ).toEqual([
      // The car on the profile for all cars is named, whatever the case of its line.
      [BASELINE, true, true, 'mx5 mx52016'],
      ['Empty', false, false, ''],
      // The first line of a car counts, whatever its case: "CADILLACCTSVR=Night" came first.
      ['Night', true, false, 'CADILLACCTSVR'],
      [TEST, true, false, ''],
    ]);
    expect(profiles!.missing).toEqual([{ car: 'porsche911gt3r', profile: 'Gone Profile' }]);
  });

  it('says nothing about profiles on an iRacing from before them', async () => {
    const a = (app = await wiredApp('iracing-bindings-car', { files: ['Documents/iRacing/**'] }));
    expect((await a.invoke<Overview>('iracing-bindings:overview')).profiles).toBeUndefined();
  });
});

describe('copying bindings from one control profile into another', () => {
  it('lists what differs and what copying does, and writes nothing', async () => {
    const a = await start();
    const baseline = await bytesOf(fileOf(a, BASELINE));
    const into = await compare(a, TEST, BASELINE);
    expect(into).toMatchObject({ from: TEST, to: BASELINE, same: 367, file: fileOf(a, BASELINE) });
    expect(into.blocked).toBeUndefined();
    expect(into.rows).toEqual([
      expect.objectContaining({
        id: 'LookUp',
        name: 'Look up',
        kind: 'copy',
        from: 'Button 10 on FANATEC Podium Wheel Base DD2',
        to: 'Not bound',
      }),
      expect.objectContaining({
        id: 'ToggleUIVisibleDrive',
        kind: 'copy',
        from: 'Shift+J on the keyboard',
        to: 'Not bound',
      }),
    ]);
    // The other way round, copying clears them.
    const back = await compare(a, BASELINE, TEST);
    expect(back.rows.map((r) => [r.id, r.kind, r.from, r.to])).toEqual([
      ['LookUp', 'clear', 'Not bound', 'Button 10 on FANATEC Podium Wheel Base DD2'],
      ['ToggleUIVisibleDrive', 'clear', 'Not bound', 'Shift+J on the keyboard'],
    ]);
    expect((await bytesOf(fileOf(a, BASELINE))).equals(baseline)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('copies the two bindings and gives byte for byte the profile iRacing wrote with them', async () => {
    const a = await start();
    const before = await bytesOf(fileOf(a, BASELINE));
    const request: CopyRequest = {
      fromProfile: TEST,
      toProfile: BASELINE,
      actions: ['LookUp', 'ToggleUIVisibleDrive'],
    };
    const review = await a.invoke<CopyReview>('iracing-bindings:copyPreview', request);
    expect(review).toMatchObject({
      from: TEST,
      to: BASELINE,
      count: 2,
      clears: 0,
      usedBy: `iRacing uses “${BASELINE}” for all cars.`,
    });
    expect(review.preview.files).toEqual([
      expect.objectContaining({ path: fileOf(a, BASELINE), change: 'modified' }),
    ]);
    // Looking is not writing.
    expect((await bytesOf(fileOf(a, BASELINE))).equals(before)).toBe(true);
    expect(await journal(a)).toEqual([]);

    const done = await a.invoke<CopyResult>('iracing-bindings:copy', {
      ...request,
      seen: review.seen,
    });
    expect(done).toEqual({
      copied: 2,
      message: `Copied 2 bindings from “${TEST}” into “${BASELINE}”. Undo is on the Safety page.`,
      file: fileOf(a, BASELINE),
    });
    const after = await bytesOf(fileOf(a, BASELINE));
    // Only the two records, and only their bytes +8 to +67.
    const changed = changedRecords(before, after);
    expect([...changed.keys()]).toEqual(['LookUp', 'ToggleUIVisibleDrive']);
    for (const offsets of changed.values()) {
      for (const at of offsets) {
        expect(at).toBeGreaterThanOrEqual(KEPT_BYTES);
        expect(at).toBeLessThan(RECORD_BYTES);
      }
    }
    // Baseline is now exactly the file iRacing wrote for the car's profile.
    const iracing = await fs.readFile(
      path.join(fixturesDir, 'scenarios', 'data', 'iracing-bindings', 'profile-car-controls.cfg')
    );
    expect(after.equals(iracing)).toBe(true);
    expect((await compare(a, TEST, BASELINE)).rows).toEqual([]);

    // One entry on the Safety page, with a backup, and Undo puts the file back.
    const entries = await journal(a);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: fileOf(a, BASELINE),
      groupReason: `iRacing control profile “${BASELINE}”: 2 bindings copied from “${TEST}”`,
    });
    expect(entries[0]!.backupPath).not.toBeNull();
    expect(await a.ports.files.undoGroup(entries[0]!.groupId!, { force: false })).toMatchObject({
      ok: true,
    });
    expect((await bytesOf(fileOf(a, BASELINE))).equals(before)).toBe(true);
  });

  it('copies only the ticked actions, and clears where the profile copied from has nothing', async () => {
    const a = await start();
    const before = await bytesOf(fileOf(a, TEST));
    const baseline = await bytesOf(fileOf(a, BASELINE));
    const done = await a.invoke<CopyResult>('iracing-bindings:copy', {
      fromProfile: BASELINE,
      toProfile: TEST,
      actions: ['ToggleUIVisibleDrive'],
    });
    expect(done.copied).toBe(1);
    const after = await bytesOf(fileOf(a, TEST));
    expect([...changedRecords(before, after).keys()]).toEqual(['ToggleUIVisibleDrive']);
    // The record now ends exactly as Baseline's; its first two fields are its own.
    const at = recordAt(after, 'ToggleUIVisibleDrive');
    const from = recordAt(baseline, 'ToggleUIVisibleDrive');
    expect(after.subarray(at + KEPT_BYTES, at + RECORD_BYTES)).toEqual(
      baseline.subarray(from + KEPT_BYTES, from + RECORD_BYTES)
    );
    expect(after.subarray(at, at + KEPT_BYTES)).toEqual(before.subarray(at, at + KEPT_BYTES));
    // The profile copied from is never written.
    expect((await bytesOf(fileOf(a, BASELINE))).equals(baseline)).toBe(true);
    expect((await compare(a, BASELINE, TEST)).rows.map((r) => r.id)).toEqual(['LookUp']);
  });

  it('leaves an axis, its calibration and what it cannot read, and says why', async () => {
    const a = await start();
    // A profile where the throttle is on another axis number and one key is one RigReady
    // has no name for, beside an action it cannot read.
    const odd = await makeProfile(a, 'Odd', TEST, (bytes) => {
      const throttle = recordAt(bytes, 'Throttle');
      expect(bytes.readUInt32LE(throttle + 8)).toBe(1);
      bytes.writeUInt32LE(bytes.readUInt32LE(throttle + 12) + 1, throttle + 12);
      const pit = recordAt(bytes, 'PitSpeedLimiter');
      bytes.writeUInt32LE(4, pit + 8);
      bytes.writeUInt32LE(0xfe, pit + 12);
      const box = recordAt(bytes, 'BlackBoxShowPrev');
      bytes.writeUInt32LE(9, box + 8);
    });
    const calibration = path.join(profilesDir(a), BASELINE, 'joyCalib.yaml');
    const calibrationBefore = await bytesOf(calibration);
    const odds = await compare(a, 'Odd', BASELINE);
    const byId = new Map(odds.rows.map((r) => [r.id, r]));
    expect(byId.get('Throttle')).toMatchObject({
      kind: 'kept',
      from: 'An axis on FANATEC Podium Wheel Base DD2',
      why: 'An axis is bound and calibrated in iRacing itself, so RigReady leaves it and its calibration as they are.',
    });
    expect(byId.get('PitSpeedLimiter')).toMatchObject({
      kind: 'kept',
      why: 'That key is not in iRacing’s list of keys. Bind it in iRacing.',
    });
    expect(byId.get('BlackBoxShowPrev')).toMatchObject({
      kind: 'kept',
      from: 'A binding RigReady cannot read',
      why: 'RigReady cannot read this binding exactly, so it does not copy it.',
    });
    expect(byId.get('LookUp')?.kind).toBe('copy');
    // Asked anyway, the copy is refused as a whole and nothing is written.
    const before = await bytesOf(fileOf(a, BASELINE));
    for (const action of ['Throttle', 'PitSpeedLimiter', 'BlackBoxShowPrev']) {
      const answer = await call(a, 'copy', {
        fromProfile: 'Odd',
        toProfile: BASELINE,
        actions: ['LookUp', action],
      });
      expect(answer.ok, action).toBe(false);
    }
    expect((await bytesOf(fileOf(a, BASELINE))).equals(before)).toBe(true);
    expect((await bytesOf(calibration)).equals(calibrationBefore)).toBe(true);
    expect((await bytesOf(odd)).length).toBe(before.length);
    expect(await journal(a)).toEqual([]);
  });

  it('an action the other profile does not have yet is left, with the reason', async () => {
    const a = await start();
    // The older controls.cfg as a profile: iRacing's build of April 2026 had 367 actions.
    const older = await bytesOf(path.join(a.ports.folders.documents(), 'iRacing', 'controls.cfg'));
    await fs.mkdir(path.join(profilesDir(a), 'April'), { recursive: true });
    await fs.writeFile(fileOf(a, 'April'), older);
    const rows = (await compare(a, TEST, 'April')).rows;
    expect(rows.find((r) => r.id === 'ToggleUIVisibleDrive')).toMatchObject({
      kind: 'kept',
      why: '“April” has no such action.',
    });
    expect(rows.find((r) => r.id === 'LookUp')?.kind).toBe('copy');
  });

  it('while iRacing runs: says so first and writes nothing', async () => {
    const a = await start();
    await mutate(a, [SIMULATOR]);
    const before = await bytesOf(fileOf(a, BASELINE));
    const why =
      'Close iRacing first. iRacing writes its bindings when it closes and would undo the change.';
    expect((await compare(a, TEST, BASELINE)).blocked).toBe(why);
    const request = { fromProfile: TEST, toProfile: BASELINE, actions: ['LookUp'] };
    expect((await a.invoke<CopyReview>('iracing-bindings:copyPreview', request)).blocked).toBe(why);
    const answer = await call(a, 'copy', request);
    expect(answer).toMatchObject({ ok: false, error: { code: 'iracing-bindings.copy.blocked' } });
    expect((await bytesOf(fileOf(a, BASELINE))).equals(before)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('writes nothing when the file changed after the copy was shown', async () => {
    const a = await start();
    const request = { fromProfile: TEST, toProfile: BASELINE, actions: ['LookUp'] };
    const review = await a.invoke<CopyReview>('iracing-bindings:copyPreview', request);
    const file = fileOf(a, BASELINE);
    const changed = Buffer.from(await bytesOf(file));
    // Starter is on S; someone moved it to T in iRacing meanwhile.
    changed[recordAt(changed, 'Starter') + 12] = 0x54;
    await fs.writeFile(file, changed);
    const answer = await call(a, 'copy', { ...request, seen: review.seen });
    expect(answer).toMatchObject({ ok: false, error: { code: 'iracing-bindings.copy.changed' } });
    expect((await bytesOf(file)).equals(changed)).toBe(true);
  });

  it('finds a profile by its name among the folders there, never as a path', async () => {
    const a = await start();
    for (const name of [
      '..',
      '../..',
      'C:\\Windows',
      '..\\Baseline',
      'Nope',
      BASELINE.toLowerCase(),
    ]) {
      for (const channel of ['copyCompare', 'copyPreview', 'copy']) {
        const answer = await call(a, channel, {
          fromProfile: name,
          toProfile: BASELINE,
          actions: ['LookUp'],
        });
        expect(answer.ok, `${channel} ${name}`).toBe(false);
      }
    }
    const same = await call(a, 'copyCompare', { fromProfile: BASELINE, toProfile: BASELINE });
    expect(same).toMatchObject({ ok: false, error: { code: 'iracing-bindings.copy.same' } });
    expect(await journal(a)).toEqual([]);
  });

  it('nothing to copy: says so and writes nothing', async () => {
    const a = await start();
    await a.invoke<CopyResult>('iracing-bindings:copy', {
      fromProfile: TEST,
      toProfile: BASELINE,
      actions: ['LookUp'],
    });
    const again = await a.invoke<CopyResult>('iracing-bindings:copy', {
      fromProfile: TEST,
      toProfile: BASELINE,
      actions: ['LookUp'],
    });
    expect(again).toMatchObject({ copied: 0 });
    expect(again.message).toBe(`Nothing was changed: “${BASELINE}” already has these bindings.`);
    expect(await journal(a)).toHaveLength(1);
  });
});
