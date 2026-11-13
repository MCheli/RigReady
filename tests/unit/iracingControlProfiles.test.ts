/**
 * Which of iRacing's files hold the bindings it uses: since 2026 Season 3, the control profile
 * app.ini [ControlProfiles] names. The iRacing bindings page finds it with its own lookup
 * (iracing-bindings/core/view.ts); the racing feature's iRacing page, id repair, binding
 * reader and backups and the iRacing game module use src/core/iracingControls.ts. No feature
 * imports another, so this test holds the two together: on each iRacing here both find the
 * same files for all cars and for each car, the same profile, the same problem and the same
 * older files that iRacing no longer reads.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { locateIracingControls } from '../../src/core/iracingControls';
import type { Overview } from '../../src/features/iracing-bindings/contract';
import { mutate, wiredApp, type WiredApp } from '../helpers';

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

const iracingDir = (a: WiredApp): string => path.join(a.ports.folders.documents(), 'iRacing');
const DATA = (name: string): string =>
  path.join(process.cwd(), 'fixtures', 'scenarios', 'data', 'iracing-bindings', name);

/** What each side found, in one shape: the sets with their files, and the source. */
async function both(a: WiredApp): Promise<{ page: unknown; shared: unknown }> {
  const overview = await a.invoke<Overview>('iracing-bindings:overview');
  const page = {
    sets: overview.sets.map((s) => ({
      car: s.general ? null : s.name,
      file: s.file,
      profile: s.profile ?? null,
    })),
    kind: overview.source.kind,
    profile: overview.source.profile ?? null,
    problem: overview.source.problem ?? null,
    oldFiles: overview.source.oldFiles,
  };
  const located = await locateIracingControls(a.ports.files, iracingDir(a));
  // Before control profiles the set for all cars is the place iRacing writes; the page lists
  // it once the file is there.
  const general =
    located.general && (await a.ports.files.exists(located.general.controls))
      ? [located.general]
      : [];
  const shared = {
    sets: [...general, ...located.cars].map((s) => ({
      car: s.car ?? null,
      file: s.controls,
      profile: s.profile ?? null,
    })),
    kind: located.kind,
    profile: located.profile ?? null,
    problem: located.problem ?? null,
    oldFiles: located.oldFiles,
  };
  return { page, shared };
}

async function setIni(a: WiredApp, lines: string): Promise<void> {
  await mutate(a, [
    {
      op: 'writeFile',
      path: 'Documents/iRacing/app.ini',
      content: `[Audio]\r\nvolume=1\r\n\r\n${lines}\r\n[Drive Screen]\r\nblackBox=2\r\n`,
    },
  ]);
}

describe('one rule for the files that hold iRacing’s bindings', () => {
  it('an iRacing from before control profiles: the older files, and a car with its own', async () => {
    app = await wiredApp('racing-fresh', { files: ['Documents/iRacing/**'] });
    const car = path.join(iracingDir(app), 'setups', 'mx5 mx52016');
    await fs.mkdir(car, { recursive: true });
    await fs.copyFile(DATA('controls-car.cfg'), path.join(car, 'controls.cfg'));
    const { page, shared } = await both(app);
    expect(shared).toEqual(page);
    expect(shared).toMatchObject({ kind: 'files', sets: [{ car: null }, { car: 'mx5 mx52016' }] });
  });

  it('the control profile app.ini names, whatever its name, with the older file not read', async () => {
    app = await wiredApp('iracing-bindings-profiles', { files: ['Documents/iRacing/**'] });
    let { page, shared } = await both(app);
    expect(shared).toEqual(page);
    expect(shared).toMatchObject({ kind: 'profiles', profile: 'Baseline', problem: null });

    await mutate(app, [
      {
        op: 'writeFile',
        path: 'Documents/iRacing/profiles/controls/Wheel only/controls.cfg',
        from: DATA('profile-controls.cfg'),
      },
    ]);
    await setIni(app, '[controlprofiles]\r\nglobal = Wheel only    \t; for all cars\r\n');
    ({ page, shared } = await both(app));
    expect(shared).toEqual(page);
    expect(shared).toMatchObject({ profile: 'Wheel only' });
  });

  it('the same problem when the profile cannot be found, and never the older file instead', async () => {
    app = await wiredApp('iracing-bindings-profiles', { files: ['Documents/iRacing/**'] });
    for (const lines of [
      '',
      '[ControlProfiles]\r\nGlobal=\r\n',
      '[ControlProfiles]\r\nGlobal=Gone\r\n',
      '[ControlProfiles]\r\nGlobal=..\\..\r\n',
      '[ControlProfiles]\r\nGlobal=Baseline.\r\n',
    ]) {
      await setIni(app, lines);
      const { page, shared } = await both(app);
      expect(shared, lines).toEqual(page);
      expect(shared, lines).toMatchObject({ sets: [], problem: expect.any(String) });
    }
    await mutate(app, [{ op: 'removeFile', path: 'Documents/iRacing/app.ini' }]);
    const { page, shared } = await both(app);
    expect(shared).toEqual(page);
    expect(shared).toMatchObject({ problem: expect.stringContaining('could not read app.ini') });
  });

  it('a car’s own profile as iRacing writes it: its path name, no folder under setups', async () => {
    // app.ini as the owner's rig had it at 12:27 on 13 Nov 2026, the car line first.
    app = await wiredApp('iracing-bindings-profiles', { files: ['Documents/iRacing/**'] });
    await mutate(app, [
      {
        op: 'writeFile',
        path: 'Documents/iRacing/profiles/controls/Test Profile CTSV/controls.cfg',
        from: DATA('profile-controls.cfg'),
      },
      {
        op: 'writeFile',
        path: 'Documents/iRacing/profiles/controls/Test Profile CTSV/joyCalib.yaml',
        from: DATA('profile-joyCalib.yaml'),
      },
    ]);
    expect(await fs.readdir(iracingDir(app))).not.toContain('setups');
    await setIni(app, '[ControlProfiles]\ncadillacctsvr=Test Profile CTSV\nGlobal=Baseline\n');
    let { page, shared } = await both(app);
    expect(shared).toEqual(page);
    expect(shared).toMatchObject({
      sets: [
        { car: null, profile: 'Baseline' },
        { car: 'cadillacctsvr', profile: 'Test Profile CTSV' },
      ],
    });

    // Lines that add no set on either side: a car on the profile for all cars, a profile
    // that is not there, a name that is no folder, a second line for the same car.
    await setIni(
      app,
      '[ControlProfiles]\r\nGlobal=Baseline\r\nporsche992rgt3=baseline\r\nferrari296gt3=Gone\r\nbmwm4gt3=..\\..\\Saved Games\r\ncadillacctsvr=Test Profile CTSV\r\nCADILLACCTSVR=Baseline\r\n'
    );
    ({ page, shared } = await both(app));
    expect(shared).toEqual(page);
    expect(shared).toMatchObject({
      sets: [{ car: null }, { car: 'cadillacctsvr', profile: 'Test Profile CTSV' }],
    });

    // Without a profile for all cars, a car's own is still listed on both sides.
    await setIni(app, '[ControlProfiles]\r\ncadillacctsvr=Test Profile CTSV\r\n');
    ({ page, shared } = await both(app));
    expect(shared).toEqual(page);
    expect(shared).toMatchObject({ sets: [{ car: 'cadillacctsvr' }], problem: expect.any(String) });
  });

  it('a car with a profile of its own', async () => {
    app = await wiredApp('iracing-bindings-profiles', { files: ['Documents/iRacing/**'] });
    await mutate(app, [
      {
        op: 'writeFile',
        path: 'Documents/iRacing/profiles/controls/mx5 mx52016/controls.cfg',
        from: DATA('controls-car.cfg'),
      },
      // The car's file from before control profiles: iRacing no longer reads it.
      {
        op: 'writeFile',
        path: 'Documents/iRacing/setups/mx5 mx52016/controls.cfg',
        from: DATA('controls-car.cfg'),
      },
    ]);
    await setIni(app, '[ControlProfiles]\r\nmx5 mx52016=mx5 mx52016\r\nGlobal=Baseline\r\n');
    const { page, shared } = await both(app);
    expect(shared).toEqual(page);
    expect(shared).toMatchObject({
      sets: [
        { car: null, profile: 'Baseline' },
        { car: 'mx5 mx52016', profile: 'mx5 mx52016' },
      ],
    });
  });
});
