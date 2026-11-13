import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ActionReport, ChecklistReport } from '../../../core/checks/engine';
import { err } from '../../../core/result';
import { PROFILE_CHECK, PROFILE_FIX } from './profileSwitch';

/**
 * A setup that switches iRacing to the control profile it is driven with: "Test Profile
 * CTSV" for all cars at Make ready, and back to what was there ("Baseline") at Stand down.
 * On the control profiles of the owner's rig at 12:27 on 13 Nov 2026.
 */

let app: WiredApp | undefined;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
  app = undefined;
});

const TEST = 'Test Profile CTSV';
const SIMULATOR = {
  op: 'startProcess' as const,
  name: 'iRacingSim64DX11.exe',
  path: 'C:\\iRacing\\iRacingSim64DX11.exe',
};
const SETUP = 'cts-v';

async function start(profile = TEST): Promise<WiredApp> {
  const a = (app = await wiredApp('iracing-bindings-profile-car', {
    files: ['Documents/iRacing/**'],
  }));
  const saved = await a.wiring.context.profiles.save({
    schemaVersion: 1,
    id: SETUP,
    name: 'Cadillac CTS-V',
    game: 'iracing',
    createdAt: '2026-11-13T12:00:00.000Z',
    updatedAt: '2026-11-13T12:00:00.000Z',
    checks: [
      {
        id: 'c1',
        type: PROFILE_CHECK,
        title: `iRacing control profile: ${profile}`,
        required: true,
        params: { profile },
        remediation: { type: PROFILE_FIX, params: { profile } },
      },
    ],
    extensions: {},
  });
  if (!saved.ok) throw new Error(saved.error.message);
  return a;
}
const appIni = (a: WiredApp): string =>
  path.join(a.ports.folders.documents(), 'iRacing', 'app.ini');
const iniText = async (a: WiredApp): Promise<string> => fs.readFile(appIni(a), 'latin1');
const check = (a: WiredApp): Promise<ChecklistReport> =>
  a.invoke<ChecklistReport>('fly:check', { profileId: SETUP });
const makeReady = (a: WiredApp): Promise<ActionReport> =>
  a.invoke<ActionReport>('fly:makeReady', { profileId: SETUP });
const standDown = (a: WiredApp): Promise<ActionReport> =>
  a.invoke<ActionReport>('fly:standDown', { profileId: SETUP });
const stepOf = (report: ActionReport, title: string) => report.steps.find((s) => s.title === title);
async function journal(a: WiredApp) {
  const entries = await a.ports.files.journal();
  if (!entries.ok) throw new Error(entries.error.message);
  return entries.value;
}

describe('a setup switches iRacing’s control profile for all cars', () => {
  it('Make ready sets it in app.ini, only that line changes, and Stand down puts the old one back', async () => {
    const a = await start();
    const original = await fs.readFile(appIni(a));
    const before = await check(a);
    expect(before.results[0]).toMatchObject({
      status: 'fail',
      summary: 'iRacing uses “Baseline” for all cars',
      details: [`This setup uses “${TEST}”.`],
      fix: `Make “${TEST}” iRacing’s control profile for all cars in app.ini`,
    });

    const ready = await makeReady(a);
    expect(ready.steps).toEqual([
      expect.objectContaining({
        ok: true,
        message: `Made “${TEST}” iRacing’s control profile for all cars in app.ini (it was “Baseline”). Stand down puts “Baseline” back.`,
      }),
    ]);
    expect(ready.report.results[0]).toMatchObject({
      status: 'pass',
      summary: `iRacing uses “${TEST}” for all cars`,
    });
    // One line of app.ini changed; the car's own line and everything else stayed.
    const switched = await iniText(a);
    expect(switched).toBe(
      original.toString('latin1').replace('\r\nGlobal=Baseline\r\n', `\r\nGlobal=${TEST}\r\n`)
    );
    expect(switched).toContain(`[ControlProfiles]\r\ncadillacctsvr=${TEST}\r\nGlobal=${TEST}\r\n`);
    const written = await journal(a);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      path: appIni(a),
      groupReason: `iRacing control profile for all cars: “${TEST}”`,
    });
    expect(written[0]!.backupPath).not.toBeNull();

    const down = await standDown(a);
    expect(stepOf(down, 'iRacing control profile')).toMatchObject({
      ok: true,
      message: 'Put back “Baseline” as iRacing’s control profile for all cars in app.ini.',
    });
    expect((await fs.readFile(appIni(a))).equals(original)).toBe(true);
    expect((await journal(a))[0]).toMatchObject({
      groupReason: 'iRacing control profile for all cars: “Baseline” again',
    });
    // A second Stand down has nothing to put back, and says nothing.
    expect(stepOf(await standDown(a), 'iRacing control profile')).toBeUndefined();
    expect(await journal(a)).toHaveLength(2);
  });

  it('while iRacing runs, the step fails with the reason and app.ini is not written', async () => {
    const a = await start();
    const original = await fs.readFile(appIni(a));
    await mutate(a, [SIMULATOR]);
    const ready = await makeReady(a);
    expect(ready.steps[0]).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        'iRacing is running. Close iRacing first: it writes app.ini when it closes and would put its own profile back.'
      ),
    });
    expect(ready.report.results[0]?.status).toBe('fail');
    expect((await fs.readFile(appIni(a))).equals(original)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('a Stand down while iRacing still runs says so, keeps what to put back, and a later one does it', async () => {
    const a = await start();
    const original = await fs.readFile(appIni(a));
    await makeReady(a);
    await mutate(a, [SIMULATOR]);
    const down = await standDown(a);
    expect(stepOf(down, 'iRacing control profile')).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        '“Baseline” was not put back as iRacing’s control profile. iRacing is running.'
      ),
    });
    expect(await iniText(a)).toContain(`Global=${TEST}\r\n`);
    await mutate(a, [{ op: 'stopProcess', name: 'iRacingSim64DX11.exe' }]);
    expect(stepOf(await standDown(a), 'iRacing control profile')?.ok).toBe(true);
    expect((await fs.readFile(appIni(a))).equals(original)).toBe(true);
  });

  it('leaves a profile chosen in iRacing after Make ready as it is', async () => {
    const a = await start();
    await makeReady(a);
    // The user picked another profile in iRacing's Options; iRacing wrote app.ini.
    await fs.writeFile(
      appIni(a),
      (await iniText(a)).replace(`Global=${TEST}`, 'Global=Baseline2'),
      'latin1'
    );
    const changed = await fs.readFile(appIni(a));
    const down = await standDown(a);
    expect(stepOf(down, 'iRacing control profile')).toMatchObject({
      ok: true,
      message: `Left iRacing’s control profile as it is: app.ini names “Baseline2” for all cars now, not “${TEST}” as Make ready left it.`,
    });
    expect((await fs.readFile(appIni(a))).equals(changed)).toBe(true);
  });

  it('a profile that is not on this PC: the check says so and no fix is offered', async () => {
    const a = await start('Wet Weather');
    const report = await check(a);
    expect(report.results[0]).toMatchObject({
      status: 'fail',
      details: [
        'This setup uses “Wet Weather”.',
        'iRacing has no control profile “Wet Weather” on this PC. Make it in iRacing: Options, then Controls.',
      ],
    });
    expect(report.results[0]?.fix).toBeUndefined();
    const original = await fs.readFile(appIni(a));
    await makeReady(a);
    expect((await fs.readFile(appIni(a))).equals(original)).toBe(true);
    expect(await journal(a)).toEqual([]);
  });

  it('passes when app.ini names the profile already, and then writes nothing', async () => {
    const a = await start('Baseline');
    expect((await check(a)).results[0]).toMatchObject({
      status: 'pass',
      summary: 'iRacing uses “Baseline” for all cars',
    });
    await makeReady(a);
    await standDown(a);
    expect(await journal(a)).toEqual([]);
  });

  it('offers the profiles on this PC by name in the setup editor, the one in use marked', async () => {
    const a = await start();
    const types = await a.invoke<{
      checks: {
        type: string;
        pickers?: { choices: { value: string; detail?: string; current?: boolean }[] }[];
      }[];
    }>('profiles:types');
    const picker = types.checks.find((t) => t.type === PROFILE_CHECK)?.pickers?.[0];
    expect(picker?.choices).toEqual([
      { value: 'Baseline', label: 'Baseline', detail: 'Used for all cars now', current: true },
      { value: TEST, label: TEST, detail: 'Used by cadillacctsvr' },
    ]);
  });

  it('on an iRacing without control profiles the check cannot tell, and nothing is written', async () => {
    const a = (app = await wiredApp('iracing-bindings-car', { files: ['Documents/iRacing/**'] }));
    const saved = await a.wiring.context.profiles.save({
      schemaVersion: 1,
      id: SETUP,
      name: 'Old iRacing',
      game: 'iracing',
      createdAt: '2026-11-13T12:00:00.000Z',
      updatedAt: '2026-11-13T12:00:00.000Z',
      checks: [
        {
          id: 'c1',
          type: PROFILE_CHECK,
          title: 'iRacing control profile: Baseline',
          required: true,
          params: { profile: 'Baseline' },
          remediation: { type: PROFILE_FIX, params: { profile: 'Baseline' } },
        },
      ],
      extensions: {},
    });
    expect(saved.ok).toBe(true);
    expect((await check(a)).results[0]).toMatchObject({
      status: 'error',
      summary: 'This iRacing keeps no control profiles',
    });
    await makeReady(a);
    expect(await journal(a)).toEqual([]);
  });

  it('an empty Global= has nothing to put back: no switch, nothing noted, nothing written', async () => {
    const a = await start();
    await fs.writeFile(
      appIni(a),
      (await iniText(a)).replace('Global=Baseline\r\n', 'Global=\r\n'),
      'latin1'
    );
    const before = await fs.readFile(appIni(a));
    const ready = await makeReady(a);
    expect(ready.steps[0]).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        'app.ini names no control profile for all cars, so Stand down would have nothing to put back'
      ),
    });
    expect((await fs.readFile(appIni(a))).equals(before)).toBe(true);
    expect(stepOf(await standDown(a), 'iRacing control profile')).toBeUndefined();
    expect(await journal(a)).toEqual([]);
  });

  it('when app.ini cannot be read back after the switch, Stand down still knows what to put back', async () => {
    const a = await start();
    const original = await fs.readFile(appIni(a));
    const files = a.ports.files as unknown as {
      write: (...args: unknown[]) => Promise<unknown>;
      readBytes: (file: string) => Promise<unknown>;
    };
    const write = files.write.bind(files);
    const readBytes = files.readBytes.bind(files);
    let written = false;
    files.write = async (...args: unknown[]) => {
      const done = await write(...args);
      if (args[0] === appIni(a)) written = true;
      return done;
    };
    files.readBytes = async (file: string) =>
      written && file === appIni(a)
        ? err('test.disk', 'The disk did not answer.')
        : readBytes(file);
    const ready = await makeReady(a);
    expect(ready.steps[0]).toMatchObject({ ok: false });
    // The switch did happen.
    expect(await iniText(a)).toContain(`\r\nGlobal=${TEST}\r\n`);

    files.write = write;
    files.readBytes = readBytes;
    const down = await standDown(a);
    expect(stepOf(down, 'iRacing control profile')).toMatchObject({
      ok: true,
      message: 'Put back “Baseline” as iRacing’s control profile for all cars in app.ini.',
    });
    expect((await fs.readFile(appIni(a))).equals(original)).toBe(true);
  });

  it('a Stand down that wrote the old profile but could not read it back is finished by the next one', async () => {
    const a = await start();
    const original = await fs.readFile(appIni(a));
    await makeReady(a);
    // As if the last Stand down had written "Baseline" and then failed to read it back.
    await fs.writeFile(appIni(a), original);
    const down = await standDown(a);
    expect(stepOf(down, 'iRacing control profile')).toMatchObject({
      ok: true,
      message: '“Baseline” is iRacing’s control profile for all cars again (app.ini).',
    });
    expect(stepOf(await standDown(a), 'iRacing control profile')).toBeUndefined();
  });

  it('is not met when app.ini names the profile but iRacing has no bindings file in it', async () => {
    const a = await start('Baseline');
    await fs.rm(
      path.join(
        a.ports.folders.documents(),
        'iRacing',
        'profiles',
        'controls',
        'Baseline',
        'controls.cfg'
      )
    );
    expect((await check(a)).results[0]).toMatchObject({
      status: 'fail',
      summary: 'iRacing uses “Baseline” for all cars',
      details: expect.arrayContaining([
        'iRacing uses the control profile “Baseline” for all cars, but RigReady found no controls.cfg in it.',
      ]),
    });
  });
});
