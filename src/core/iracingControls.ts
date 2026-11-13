import path from 'node:path';
import type { FileStore } from './ports';

/**
 * Where iRacing keeps the bindings it uses. Shared by the features that read or write
 * iRacing's controls.cfg and joyCalib.yaml outside the iRacing bindings page (the racing
 * feature's iRacing page, id repair, binding reader for cheat sheets, backups and saved sets,
 * and the iRacing game module), so they all find the same files. Features may not import
 * each other; the iRacing bindings page keeps its own copy of this lookup, and
 * tests/unit/iracingControlProfiles.test.ts holds the two together.
 *
 * Since 2026 Season 3 iRacing keeps control profiles: Documents\iRacing\profiles\controls\
 * <name>\controls.cfg and joyCalib.yaml. app.ini [ControlProfiles] names the profile in use:
 * `Global=<name>` for all cars, and `<car>=<name>` for a car with a profile of its own, where
 * <car> is iRacing's path name for the car ("cadillacctsvr") and the car need not have a folder
 * under setups (seen on the owner's rig on 13 Nov 2026). The older Documents\iRacing\
 * controls.cfg (and setups\<car>\controls.cfg) are then no longer read by iRacing, so once a
 * profiles folder exists they are never used in place of the profile: when the profile cannot
 * be found, `problem` says why and there is no set for all cars.
 * docs/research/iracing-bindings.md, "Control profiles".
 */

export const IRACING_CONTROLS = 'controls.cfg';
export const IRACING_CALIBRATION = 'joyCalib.yaml';
/** Under Documents\iRacing: where iRacing keeps its control profiles. */
export const IRACING_PROFILES = path.join('profiles', 'controls');

/** One set of bindings iRacing reads: the one for all cars, or one car's own. */
export interface IracingControlSet {
  /**
   * The car, for a car's own set; absent for the set for all cars. With control profiles,
   * iRacing's path name for it as app.ini has it ("cadillacctsvr"); before them, its folder
   * under setups ("mx5 mx52016"). A name to show and look up by, never a path.
   */
  car?: string;
  /** The controls.cfg of the set. */
  controls: string;
  /** The joyCalib.yaml beside it, which may not exist. */
  calibration: string;
  /** The control profile the set belongs to; absent on an iRacing from before them. */
  profile?: string;
}

export interface IracingControls {
  /** "profiles": iRacing keeps control profiles. "files": an iRacing from before them. */
  kind: 'profiles' | 'files';
  /**
   * The set for all cars. On an iRacing from before profiles it is always the older files
   * (they may not exist yet: iRacing writes them the first time controls are set up). With
   * profiles, only when app.ini names a profile that has a controls.cfg.
   */
  general?: IracingControlSet;
  /**
   * Cars with bindings of their own whose controls.cfg exists, by name. With profiles, a car
   * whose line names the profile for all cars is not listed: it has no bindings of its own.
   */
  cars: IracingControlSet[];
  /** The profile for all cars, as app.ini names it. */
  profile?: string;
  /** Why no set for all cars could be found among the profiles, when none could. */
  problem?: string;
  /** With profiles: the older controls.cfg files on this PC, which iRacing no longer reads. */
  oldFiles: string[];
}

type Files = Pick<FileStore, 'exists' | 'readText' | 'list'>;

/** The [ControlProfiles] lines of app.ini, key and value, in file order. Reads only. */
export function controlProfileLines(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    const section = /^\s*\[(.+)\]\s*$/.exec(line);
    if (section) {
      inSection = section[1]!.trim().toLowerCase() === 'controlprofiles';
      continue;
    }
    if (!inSection || /^\s*;/.test(line)) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    // iRacing pads a value and puts a comment after a tab: "key=value    \t; what it is".
    const value = line
      .slice(at + 1)
      .replace(/\t.*$/, '')
      .replace(/\s;.*$/, '')
      .trim();
    out.push({ key: line.slice(0, at).trim(), value });
  }
  return out;
}

/** A profile name from app.ini, when it can only be one folder under profiles\controls. */
export const profileFolderName = (name: string): string | undefined =>
  name.length > 0 &&
  name.length <= 200 &&
  name !== '.' &&
  name !== '..' &&
  !/[\\/:*?"<>|\x00-\x1f]/.test(name) &&
  !/[. ]$/.test(name)
    ? name
    : undefined;

/** The folders under setups: one for each car that was driven at least once, sorted. */
export async function iracingCarFolders(files: Files, folder: string): Promise<string[]> {
  const listed = await files.list(path.join(folder, 'setups'));
  return listed.ok ? [...listed.value].sort((a, b) => a.localeCompare(b)) : [];
}

/** The bindings files (controls.cfg) from before control profiles that are on this PC. */
async function olderFiles(files: Files, folder: string, cars: string[]): Promise<string[]> {
  const candidates = [
    path.join(folder, IRACING_CONTROLS),
    ...cars.map((car) => path.join(folder, 'setups', car, IRACING_CONTROLS)),
  ];
  const found: string[] = [];
  for (const file of candidates) if (await files.exists(file)) found.push(file);
  return found;
}

/**
 * The sets iRacing reads, found in Documents\iRacing (`folder`). With control profiles: the
 * profile app.ini names for all cars (section and key matched whatever their case), and for
 * each other line of [ControlProfiles], that car's profile. Without a profiles folder (an
 * iRacing from before them): Documents\iRacing\controls.cfg and each setups\<car>\controls.cfg
 * that exists. Reads only. `cars` are the folders under setups when the caller has them already.
 */
export async function locateIracingControls(
  files: Files,
  folder: string,
  cars?: string[]
): Promise<IracingControls> {
  const carFolders = cars ?? (await iracingCarFolders(files, folder));
  const profiles = path.join(folder, IRACING_PROFILES);
  if (!(await files.exists(profiles))) {
    const own: IracingControlSet[] = [];
    for (const car of carFolders) {
      const dir = path.join(folder, 'setups', car);
      if (await files.exists(path.join(dir, IRACING_CONTROLS))) {
        own.push({
          car,
          controls: path.join(dir, IRACING_CONTROLS),
          calibration: path.join(dir, IRACING_CALIBRATION),
        });
      }
    }
    return {
      kind: 'files',
      general: {
        controls: path.join(folder, IRACING_CONTROLS),
        calibration: path.join(folder, IRACING_CALIBRATION),
      },
      cars: own,
      oldFiles: [],
    };
  }

  const ini = path.join(folder, 'app.ini');
  const text = (await files.exists(ini)) ? await files.readText(ini) : undefined;
  const lines = text?.ok ? controlProfileLines(text.value) : [];
  const setOf = async (profile: string, car?: string): Promise<IracingControlSet | undefined> => {
    const name = profileFolderName(profile);
    if (!name) return undefined;
    const dir = path.join(profiles, name);
    const controls = path.join(dir, IRACING_CONTROLS);
    if (!(await files.exists(controls))) return undefined;
    return {
      ...(car !== undefined ? { car } : {}),
      controls,
      calibration: path.join(dir, IRACING_CALIBRATION),
      profile,
    };
  };

  const global = lines.find((l) => l.key.toLowerCase() === 'global')?.value || undefined;
  const general = global ? await setOf(global) : undefined;
  let problem: string | undefined;
  if (!text?.ok) {
    problem =
      'iRacing keeps control profiles, but RigReady could not read app.ini, which says which profile iRacing uses.';
  } else if (!global) {
    problem =
      'iRacing keeps control profiles, but app.ini names none for all cars, so RigReady cannot tell which bindings iRacing uses.';
  } else if (!general) {
    problem = `iRacing uses the control profile “${global}” for all cars, but RigReady found no controls.cfg in it.`;
  }
  // Every other line is a car: iRacing's path name for it, then its profile. The first line
  // for a car counts; a car on the profile for all cars has no bindings of its own.
  const own: IracingControlSet[] = [];
  const seen = new Set<string>(['global']);
  for (const { key, value } of lines) {
    if (seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    if (general && value.toLowerCase() === global!.toLowerCase()) continue;
    const set = await setOf(value, key);
    if (set) own.push(set);
  }
  own.sort((a, b) => a.car!.localeCompare(b.car!));
  return {
    kind: 'profiles',
    ...(general ? { general } : {}),
    cars: own,
    ...(global ? { profile: global } : {}),
    ...(problem ? { problem } : {}),
    oldFiles: await olderFiles(files, folder, carFolders),
  };
}

/** True for a path under Documents\iRacing\profiles\controls (`folder` is Documents\iRacing). */
export function inControlProfiles(folder: string, file: string): boolean {
  const relative = path.relative(path.join(folder, IRACING_PROFILES), file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
