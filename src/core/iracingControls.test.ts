import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  controlProfileLines,
  inControlProfiles,
  locateIracingControls,
  profileFolderName,
} from './iracingControls';
import { err, ok } from './result';

/**
 * The one rule every reader and writer of iRacing's controls.cfg and joyCalib.yaml follows:
 * since 2026 Season 3, the control profile app.ini names; before, the older files. Here on a
 * small folder in memory; the features' tests run it on the recorded rig and its profile.
 */

const folder = path.join(path.sep, 'Users', 'me', 'Documents', 'iRacing');
const at = (...parts: string[]): string => path.join(folder, ...parts);

/** A folder in memory: the files given, and every folder above them. */
function memory(files: Record<string, string>, unreadable: string[] = []) {
  const paths = new Map(Object.entries(files).map(([p, text]) => [path.normalize(p), text]));
  const dirs = new Set<string>();
  for (const p of paths.keys()) {
    for (let d = path.dirname(p); d !== path.dirname(d); d = path.dirname(d)) dirs.add(d);
  }
  return {
    exists: async (p: string) => paths.has(path.normalize(p)) || dirs.has(path.normalize(p)),
    readText: async (p: string) =>
      unreadable.includes(p)
        ? err('files.read', 'locked')
        : paths.has(path.normalize(p))
          ? ok(paths.get(path.normalize(p))!)
          : err('files.notFound', p),
    list: async (dir: string) => {
      const names = new Set<string>();
      for (const p of [...paths.keys(), ...dirs]) {
        if (path.dirname(p) === path.normalize(dir)) names.add(path.basename(p));
      }
      return ok([...names]);
    },
  };
}

const BASELINE = at('profiles', 'controls', 'Baseline');
const OLDER = {
  [at('controls.cfg')]: 'older',
  [at('joyCalib.yaml')]: 'older calibration',
  [at('setups', 'mx5 mx52016', 'car.sto')]: 'a setup',
};
const PROFILE = {
  [path.join(BASELINE, 'controls.cfg')]: 'profile',
  [path.join(BASELINE, 'joyCalib.yaml')]: 'profile calibration',
};
const ini = (lines: string): Record<string, string> => ({
  [at('app.ini')]: `[Audio]\r\nGlobal=Wrong\r\n${lines}[Next]\r\nGlobal=Other\r\n`,
});

describe('where iRacing keeps the bindings it uses', () => {
  it('before control profiles: the older files, and a car only when its folder has a controls.cfg', async () => {
    const files = memory({
      ...OLDER,
      [at('setups', 'porsche992rgt3', 'controls.cfg')]: 'car',
    });
    expect(await locateIracingControls(files, folder)).toEqual({
      kind: 'files',
      general: { controls: at('controls.cfg'), calibration: at('joyCalib.yaml') },
      cars: [
        {
          car: 'porsche992rgt3',
          controls: at('setups', 'porsche992rgt3', 'controls.cfg'),
          calibration: at('setups', 'porsche992rgt3', 'joyCalib.yaml'),
        },
      ],
      oldFiles: [],
    });
    // A new iRacing that has not written its bindings yet: still the place it will write them.
    expect((await locateIracingControls(memory({}), folder)).general).toEqual({
      controls: at('controls.cfg'),
      calibration: at('joyCalib.yaml'),
    });
  });

  it('with control profiles: the profile app.ini names for all cars, and the older file only listed as not read', async () => {
    const files = memory({
      ...OLDER,
      ...PROFILE,
      ...ini('[ControlProfiles]\r\nGlobal=Baseline\r\n'),
    });
    expect(await locateIracingControls(files, folder)).toEqual({
      kind: 'profiles',
      general: {
        controls: path.join(BASELINE, 'controls.cfg'),
        calibration: path.join(BASELINE, 'joyCalib.yaml'),
        profile: 'Baseline',
      },
      cars: [],
      profile: 'Baseline',
      oldFiles: [at('controls.cfg')],
    });
  });

  it('a car with a profile of its own is a line of [ControlProfiles], as iRacing writes it', async () => {
    // As on the owner's rig at 12:27 on 13 Nov 2026: the car line first, by iRacing's path
    // name for the car, which has no folder under setups; the profile's name has spaces.
    const ctsv = at('profiles', 'controls', 'Test Profile CTSV');
    const mx5 = at('profiles', 'controls', 'mx5 mx52016');
    const files = memory({
      ...OLDER,
      ...PROFILE,
      [path.join(ctsv, 'controls.cfg')]: 'car profile',
      [path.join(ctsv, 'joyCalib.yaml')]: 'car calibration',
      [path.join(mx5, 'controls.cfg')]: 'another car profile',
      [at('app.ini')]:
        '[ControlProfiles]\ncadillacctsvr=Test Profile CTSV\nGlobal=Baseline\n\n[controlprofiles]\nmx5 mx52016 = mx5 mx52016    \t; a comment\n',
    });
    const located = await locateIracingControls(files, folder);
    expect(located.general?.profile).toBe('Baseline');
    expect(located.cars).toEqual([
      {
        car: 'cadillacctsvr',
        controls: path.join(ctsv, 'controls.cfg'),
        calibration: path.join(ctsv, 'joyCalib.yaml'),
        profile: 'Test Profile CTSV',
      },
      {
        car: 'mx5 mx52016',
        controls: path.join(mx5, 'controls.cfg'),
        calibration: path.join(mx5, 'joyCalib.yaml'),
        profile: 'mx5 mx52016',
      },
    ]);
  });

  it('a car line on the profile for all cars, one naming no profile there, or a second line for a car, adds no set', async () => {
    const files = memory({
      ...OLDER,
      ...PROFILE,
      [at('profiles', 'controls', 'Mine', 'controls.cfg')]: 'mine',
      ...ini(
        '[ControlProfiles]\r\nGlobal=Baseline\r\nporsche992rgt3=baseline\r\nferrari296gt3=Gone\r\nbmwm4gt3=..\\..\\Saved Games\r\ncadillacctsvr=Mine\r\nCADILLACCTSVR=Baseline\r\n'
      ),
    });
    const located = await locateIracingControls(files, folder);
    expect(located.cars.map((c) => [c.car, c.profile])).toEqual([['cadillacctsvr', 'Mine']]);
    // Without a set for all cars, a car's own profile is still the car's.
    const noGlobal = memory({
      ...PROFILE,
      [at('profiles', 'controls', 'Mine', 'controls.cfg')]: 'mine',
      ...ini('[ControlProfiles]\r\ncadillacctsvr=Mine\r\n'),
    });
    const alone = await locateIracingControls(noGlobal, folder);
    expect(alone.general).toBeUndefined();
    expect(alone.cars.map((c) => c.car)).toEqual(['cadillacctsvr']);
  });

  it('says why when the profile cannot be found, and never falls back to the older file', async () => {
    const cases: [Record<string, string>, string][] = [
      [{}, 'could not read app.ini'],
      [ini('[ControlProfiles]\r\n'), 'app.ini names none for all cars'],
      [ini('[ControlProfiles]\r\nGlobal=\r\n'), 'app.ini names none for all cars'],
      [ini('[ControlProfiles]\r\nGlobal=Gone\r\n'), '“Gone” for all cars, but RigReady found no'],
    ];
    for (const [extra, problem] of cases) {
      const located = await locateIracingControls(
        memory({ ...OLDER, ...PROFILE, ...extra }),
        folder
      );
      expect(located.kind).toBe('profiles');
      expect(located.general).toBeUndefined();
      expect(located.problem).toContain(problem);
      expect(located.oldFiles).toEqual([at('controls.cfg')]);
    }
    const locked = memory({ ...PROFILE, ...ini('[ControlProfiles]\r\nGlobal=Baseline\r\n') }, [
      at('app.ini'),
    ]);
    expect((await locateIracingControls(locked, folder)).problem).toContain('could not read');
  });

  it('never turns a profile name that is not one plain folder name into a path', async () => {
    for (const name of [
      '..',
      '.',
      '..\\..\\Saved Games',
      'a/b',
      'C:x',
      'trailing.',
      'x'.repeat(201),
    ]) {
      expect(profileFolderName(name)).toBeUndefined();
      const files = memory({
        ...OLDER,
        ...PROFILE,
        [at('controls.cfg')]: 'older',
        ...ini(`[ControlProfiles]\r\nGlobal=${name}\r\n`),
      });
      const located = await locateIracingControls(files, folder);
      expect(located.general).toBeUndefined();
      expect(located.problem).toBeDefined();
    }
    expect(profileFolderName('mx5 mx52016')).toBe('mx5 mx52016');
  });

  it('reads the [ControlProfiles] lines as iRacing writes them', () => {
    expect(
      controlProfileLines(
        '[Audio]\nGlobal=Wrong\n[controlprofiles]\n; a comment\nGlobal = Baseline    \t; for all cars\nmx5 mx52016=Mine\n=nothing\nno equals\n[Next]\nGlobal=Other\n'
      )
    ).toEqual([
      { key: 'Global', value: 'Baseline' },
      { key: 'mx5 mx52016', value: 'Mine' },
    ]);
  });

  it('tells a file inside the control profiles from one beside them', () => {
    expect(inControlProfiles(folder, path.join(BASELINE, 'controls.cfg'))).toBe(true);
    // A profile whose name starts with two dots is a folder like any other.
    expect(profileFolderName('..Wheel')).toBe('..Wheel');
    expect(inControlProfiles(folder, at('profiles', 'controls', '..Wheel', 'controls.cfg'))).toBe(
      true
    );
    expect(inControlProfiles(folder, at('controls.cfg'))).toBe(false);
    expect(inControlProfiles(folder, at('profiles', 'controls'))).toBe(false);
    expect(inControlProfiles(folder, at('profiles', 'hud', 'Baseline.ini'))).toBe(false);
    expect(inControlProfiles(folder, at('profiles', 'controls', '..', '..', 'controls.cfg'))).toBe(
      false
    );
  });
});
