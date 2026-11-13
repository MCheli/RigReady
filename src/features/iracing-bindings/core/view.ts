import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import { sameGuid } from '../../../core/directInput';
import { gameRunning, type GameRegistry } from '../../../core/games';
import type { DeviceNames } from '../../../core/names';
import { err, ok, type Result } from '../../../core/result';
import type { InputDevice } from '../../../shared/models';
import {
  ALL_CARS,
  type Action,
  type ActionBinding,
  type BindingSet,
  type BindingSource,
  type Device,
  type DeviceState,
  type Overview,
  type SetView,
  type SharedInput,
} from '../contract';
import { readCalibration, shownAxisName, type CalibratedDevice } from './calibration';
import { parseControlsFile, usbIdsOf, type ControlRecord, type ControlsFile } from './controlsFile';
import { iracingActionGroup, iracingActionLabel, iracingKeyLabel } from './names';

/**
 * What the iRacing bindings page shows: the sets iRacing keeps (one for all cars, one for
 * each car with custom controls) and, for one set, every action with what is bound to it.
 * Everything here reads; nothing is written to iRacing's files (changing one binding is
 * in change.ts).
 */

/** What this code needs: the ports, and the game registry for where iRacing keeps its files. */
export interface BindingsContext extends CheckContext {
  games: GameRegistry;
}

const GAME = 'iracing';
const CAR_PREFIX = 'car:';
const CONTROLS = 'controls.cfg';
const CALIBRATION = 'joyCalib.yaml';
const KEYBOARD = 'keyboard';
const UNREADABLE = 'A binding RigReady cannot read';

/** Documents\iRacing, when iRacing has made it. */
async function userFolder(ctx: BindingsContext): Promise<string | undefined> {
  const module = ctx.games.get(GAME);
  if (!module) return undefined;
  const locations = await module.configLocations(ctx);
  return locations.ok ? locations.value.find((l) => l.id === 'documents')?.path : undefined;
}

/** The folders under setups: one for each car that was driven at least once. */
async function carFolders(ctx: BindingsContext, folder: string): Promise<string[]> {
  const listed = await ctx.ports.files.list(path.join(folder, 'setups'));
  return listed.ok ? [...listed.value].sort((a, b) => a.localeCompare(b)) : [];
}

/** Where iRacing keeps its control profiles (2026 Season 3 and later). */
const PROFILES = path.join('profiles', 'controls');

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
const asFolderName = (name: string): string | undefined =>
  name.length > 0 &&
  name.length <= 200 &&
  name !== '.' &&
  name !== '..' &&
  !/[\\/:*?"<>|\x00-\x1f]/.test(name) &&
  !/[. ]$/.test(name)
    ? name
    : undefined;

interface Located {
  sets: BindingSet[];
  source: BindingSource;
}

/** The bindings files from before control profiles that are on this PC. */
async function oldFiles(ctx: BindingsContext, folder: string, cars: string[]): Promise<string[]> {
  const files = [
    path.join(folder, CONTROLS),
    ...cars.map((car) => path.join(folder, 'setups', car, CONTROLS)),
  ];
  const found: string[] = [];
  for (const file of files) if (await ctx.ports.files.exists(file)) found.push(file);
  return found;
}

/**
 * The sets iRacing uses, "All cars" first. An iRacing with control profiles loads the
 * profile that app.ini [ControlProfiles] names: "Global" for all cars, and for a car, a
 * line whose key is iRacing's path name of the car and whose value is the profile's folder
 * ("cadillacctsvr=Test Profile CTSV", as iRacing 2026.11 wrote it on the owner's rig). A
 * car is listed from that line alone: it needs no folder of its own under Documents. A car
 * whose line names the profile for all cars has no bindings of its own and is not listed.
 * The older controls.cfg files are then listed as not read. Without a profiles folder (an
 * iRacing from before them) the sets are those files: one for all cars, and one for each
 * car that has its own.
 *
 * The rest of the app finds the same files with src/core/iracingControls.ts once that is
 * merged (features may not import each other); tests/unit/iracingControlProfiles.test.ts
 * holds the two rules together. Change both or neither.
 */
async function locateSets(ctx: BindingsContext, folder: string, cars: string[]): Promise<Located> {
  const profiles = path.join(folder, PROFILES);
  if (!(await ctx.ports.files.exists(profiles))) {
    const sets: BindingSet[] = [];
    const general = path.join(folder, CONTROLS);
    if (await ctx.ports.files.exists(general)) {
      sets.push({ id: ALL_CARS, name: 'All cars', general: true, file: general });
    }
    for (const car of cars) {
      const file = path.join(folder, 'setups', car, CONTROLS);
      if (await ctx.ports.files.exists(file)) {
        sets.push({ id: `${CAR_PREFIX}${car}`, name: car, general: false, file });
      }
    }
    return { sets, source: { kind: 'files', oldFiles: [] } };
  }

  const ini = path.join(folder, 'app.ini');
  const text = (await ctx.ports.files.exists(ini))
    ? await ctx.ports.files.readText(ini)
    : undefined;
  const lines = text?.ok ? controlProfileLines(text.value) : [];
  const fileOf = (profile: string): string | undefined => {
    const name = asFolderName(profile);
    return name ? path.join(profiles, name, CONTROLS) : undefined;
  };
  const sets: BindingSet[] = [];
  const global = lines.find((l) => l.key.toLowerCase() === 'global')?.value || undefined;
  const globalFile = global ? fileOf(global) : undefined;
  let problem: string | undefined;
  if (!text?.ok) {
    problem =
      'iRacing keeps control profiles, but RigReady could not read app.ini, which says which profile iRacing uses.';
  } else if (!global) {
    problem =
      'iRacing keeps control profiles, but app.ini names none for all cars, so RigReady cannot tell which bindings iRacing uses.';
  } else if (!globalFile || !(await ctx.ports.files.exists(globalFile))) {
    problem = `iRacing uses the control profile “${global}” for all cars, but RigReady found no controls.cfg in it.`;
  } else {
    sets.push({ id: ALL_CARS, name: 'All cars', general: true, file: globalFile, profile: global });
  }
  // Every other line is one car, by the path name iRacing gives it; the first line for a
  // car counts, whatever its case. A car on the profile for all cars has none of its own.
  const onGeneral = (value: string): boolean =>
    sets.some((s) => s.general) && value.toLowerCase() === global!.toLowerCase();
  const carLines = lines
    .filter((l) => l.key.toLowerCase() !== 'global')
    .filter((l, i, all) => all.findIndex((o) => o.key.toLowerCase() === l.key.toLowerCase()) === i)
    .filter((l) => !onGeneral(l.value))
    .sort((a, b) => a.key.localeCompare(b.key));
  for (const line of carLines) {
    const file = fileOf(line.value);
    if (file && (await ctx.ports.files.exists(file))) {
      sets.push({
        id: `${CAR_PREFIX}${line.key}`,
        name: line.key,
        general: false,
        file,
        profile: line.value,
      });
    }
  }
  // Cars that name the same profile share one file: a change for one is a change for all.
  for (const set of sets) {
    if (set.general) continue;
    const others = sets
      .filter((s) => !s.general && s !== set && s.file.toLowerCase() === set.file.toLowerCase())
      .map((s) => s.name);
    if (others.length) set.sharedWith = others;
  }
  return {
    sets,
    source: {
      kind: 'profiles',
      ...(global ? { profile: global } : {}),
      ...(problem ? { problem } : {}),
      oldFiles: await oldFiles(ctx, folder, cars),
    },
  };
}

/**
 * The programs that write these files: the simulator, not the launcher. Only the simulator
 * writes controls.cfg, when it exits.
 */
export function simulatorOf(ctx: BindingsContext): { processes: string[] } {
  const module = ctx.games.get(GAME);
  return { processes: module?.closeBeforeRestore?.processes ?? module?.processes ?? [] };
}

export async function overview(ctx: BindingsContext, repairRoute?: string): Promise<Overview> {
  const module = ctx.games.get(GAME);
  const installs = module ? await module.detect(ctx) : undefined;
  const folder = await userFolder(ctx);
  const cars = folder ? await carFolders(ctx, folder) : [];
  const located: Located = folder
    ? await locateSets(ctx, folder, cars)
    : { sets: [], source: { kind: 'files', oldFiles: [] } };
  return {
    installed: installs?.ok === true && installs.value.length > 0,
    ...(folder ? { folder } : {}),
    simRunning: await gameRunning(ctx, simulatorOf(ctx)),
    sets: located.sets,
    source: located.source,
    carFolders: cars.length,
    ...(repairRoute ? { repairRoute } : {}),
  };
}

export interface FoundSet {
  /** Documents\iRacing. */
  folder: string;
  sets: BindingSet[];
  set: BindingSet;
}

/**
 * One set by its id. The id is looked up among the sets that are really there; it never
 * becomes a path by itself.
 */
export async function findSet(ctx: BindingsContext, id: string): Promise<Result<FoundSet>> {
  const folder = await userFolder(ctx);
  if (!folder) {
    return err('iracing-bindings.notFound', 'The iRacing folder in Documents was not found.');
  }
  const { sets, source } = await locateSets(ctx, folder, await carFolders(ctx, folder));
  const set = sets.find((s) => s.id === id);
  if (!set) {
    return err(
      'iracing-bindings.noSet',
      id !== ALL_CARS
        ? 'iRacing has no custom controls for that car.'
        : (source.problem ??
            'iRacing has no controls.cfg yet. Bind something in iRacing first; this page then fills in.')
    );
  }
  return ok({ folder, sets, set });
}

interface LoadedSet {
  file: ControlsFile;
  calibration: CalibratedDevice[];
  /** The calibration file is there but names no device. */
  calibrationUnread: boolean;
}

async function load(
  ctx: BindingsContext,
  set: BindingSet,
  folder: string,
  generalFile: string | undefined,
  withBytes?: Uint8Array
): Promise<Result<LoadedSet>> {
  const bytes = withBytes ? ok(withBytes) : await ctx.ports.files.readBytes(set.file);
  if (!bytes.ok) {
    return err(
      'iracing-bindings.read',
      `RigReady could not read ${set.file}.`,
      bytes.error.message
    );
  }
  const file = parseControlsFile(bytes.value);
  if (!file.ok) return file;
  // The calibration beside the set's file; for a car, the one for all cars names the rest.
  const generalFolder = generalFile ? path.dirname(generalFile) : folder;
  const places = set.general
    ? [path.join(path.dirname(set.file), CALIBRATION)]
    : [path.join(path.dirname(set.file), CALIBRATION), path.join(generalFolder, CALIBRATION)];
  const calibration: CalibratedDevice[] = [];
  let calibrationUnread = false;
  for (const place of places) {
    if (!(await ctx.ports.files.exists(place))) continue;
    const text = await ctx.ports.files.readText(place);
    const devices = text.ok ? readCalibration(text.value) : [];
    if (devices.length === 0) calibrationUnread = true;
    for (const device of devices) {
      if (!calibration.some((c) => c.instanceGuid === device.instanceGuid))
        calibration.push(device);
    }
  }
  return ok({ file: file.value, calibration, calibrationUnread });
}

/** One bound input, by something two actions on the same input share. */
interface Resolved {
  binding: ActionBinding;
  /** Device and input in a form that is equal exactly when the input is the same. */
  same: string;
}

function resolve(
  record: ControlRecord,
  deviceName: (instanceGuid: string) => string,
  calibration: CalibratedDevice[]
): Resolved | undefined {
  const b = record.binding;
  if (b.kind === 'none') return undefined;
  const unreadable: Resolved = {
    binding: { kind: 'unknown', device: '', deviceName: '', input: UNREADABLE },
    same: '',
  };
  if (b.kind === 'unknown' || !record.understood) return unreadable;
  if (b.kind === 'key') {
    return {
      binding: {
        kind: 'key',
        device: KEYBOARD,
        deviceName: 'Keyboard',
        input: iracingKeyLabel(b.keyCode, b.modifiers),
      },
      same: `${KEYBOARD}|key ${b.keyCode} ${b.modifiers}`,
    };
  }
  const name = deviceName(b.instanceGuid);
  if (b.kind === 'axis') {
    const named = calibration.find((c) => c.instanceGuid === b.instanceGuid)?.axes.get(b.axis);
    const axis = named ? shownAxisName(named, usbIdsOf(b.productGuid)) : `Axis ${b.axis}`;
    // Steering is one axis in two halves: each action has one way of turning.
    const half = /^Steer(Left|Right)\d?$/.exec(record.action)?.[1];
    // The last field is 1 on the second half of the steering axis. What another value
    // means anywhere else is not known, so it is shown as it is.
    const direction = half || b.direction === 0 ? '' : ` (direction ${b.direction})`;
    return {
      binding: {
        kind: 'axis',
        device: b.instanceGuid,
        deviceName: name,
        input: half ? `${axis}, turning ${half.toLowerCase()}` : `${axis}${direction}`,
      },
      same: `${b.instanceGuid}|axis ${b.axis} ${b.direction}`,
    };
  }
  if (b.buttons.length === 0) return unreadable;
  const numbers = b.buttons.map((n) => n + 1);
  return {
    binding: {
      kind: 'button',
      device: b.instanceGuid,
      deviceName: name,
      // Every file seen names one button; more than one is listed as it stands.
      input: numbers.length === 1 ? `Button ${numbers[0]}` : `Buttons ${numbers.join(' and ')}`,
    },
    same: `${b.instanceGuid}|buttons ${b.buttons.join(' ')}`,
  };
}

/**
 * The camera editor's own controls ("CamLatInc"; not "DCam...", the driver's seat view).
 * iRacing's default keys share with them: A is the pit speed limiter and moves the camera.
 */
const isCameraEditor = (action: string): boolean => /^Cam[A-Z]/.test(action);

const spoken = (binding: ActionBinding | undefined): string =>
  binding
    ? binding.deviceName
      ? `${binding.deviceName}: ${binding.input}`
      : binding.input
    : 'Not bound';

function stateOf(
  instanceGuid: string,
  ids: { vendorId: string; productId: string } | undefined,
  live: InputDevice[] | undefined,
  named: Set<string>
): DeviceState {
  if (!live) return 'unknown';
  if (live.some((d) => sameGuid(d.guid, instanceGuid))) return 'connected';
  // The same model under an id the file does not name: Windows gave the controller a new id.
  const moved = live.some(
    (d) =>
      ids !== undefined &&
      d.vendorId === ids.vendorId &&
      d.productId === ids.productId &&
      !named.has(d.guid.toUpperCase())
  );
  return moved ? 'moved' : 'missing';
}

/**
 * The set with the plain names another feature knows for iRacing's actions (the binding
 * guide's, by iRacing's own id, through ctx.bindings.labels). Where there is none, the name
 * stays this feature's own. A name is for reading: the id stays what is matched and shown.
 */
export function withPlainNames(
  view: Result<SetView>,
  labels: Record<string, string>
): Result<SetView> {
  if (!view.ok) return view;
  const named = <T extends { id: string; name: string }>(action: T): T => {
    const label = labels[action.id]?.trim();
    return label ? { ...action, name: label } : action;
  };
  return ok({
    ...view.value,
    actions: view.value.actions.map(named),
    shared: view.value.shared.map((s) => ({ ...s, actions: s.actions.map(named) })),
  });
}

/**
 * Every action of one set with what is bound to it. With `withBytes`, the set as it would
 * be with those bytes in its file: how a change is shown before it is saved.
 */
export async function setView(
  ctx: BindingsContext,
  id: string,
  names: DeviceNames,
  withBytes?: Uint8Array
): Promise<Result<SetView>> {
  const found = await findSet(ctx, id);
  if (!found.ok) return found;
  const { folder, sets, set } = found.value;
  const loaded = await load(ctx, set, folder, sets.find((s) => s.general)?.file, withBytes);
  if (!loaded.ok) return loaded;
  const { file, calibration } = loaded.value;

  const started = await ctx.ports.input.start();
  const live = started.ok ? started.value : undefined;
  const productOf = new Map<string, string>();
  for (const record of file.records) {
    const b = record.binding;
    if (b.kind === 'axis' || b.kind === 'button') productOf.set(b.instanceGuid, b.productGuid);
  }
  const named = new Set(productOf.keys());
  const controllers = new Map<string, Device>();
  for (const [instanceGuid, productGuid] of productOf) {
    const ids = usbIdsOf(productGuid);
    const attached = live?.find((d) => sameGuid(d.guid, instanceGuid));
    const sameModel = ids
      ? live?.find((d) => d.vendorId === ids.vendorId && d.productId === ids.productId)
      : undefined;
    const givenName = ids ? names.nameOf({ ...ids, guid: instanceGuid }) : undefined;
    controllers.set(instanceGuid, {
      key: instanceGuid,
      kind: 'controller',
      name:
        calibration.find((c) => c.instanceGuid === instanceGuid)?.name ??
        attached?.name.trim() ??
        sameModel?.name.trim() ??
        (ids ? `Controller ${ids.vendorId}:${ids.productId}` : 'Unknown controller'),
      ...(givenName ? { givenName } : {}),
      ...(ids ?? {}),
      state: stateOf(instanceGuid, ids, live, named),
      bound: 0,
    });
  }
  const keyboard: Device = {
    key: KEYBOARD,
    kind: 'keyboard',
    name: 'Keyboard',
    state: 'connected',
    bound: 0,
  };
  // A controller only "All cars" names is not in this car's list; its calibration still names it.
  let generalCalibration: CalibratedDevice[] = [];
  const deviceName = (instanceGuid: string): string => {
    const device = controllers.get(instanceGuid);
    return (
      device?.givenName ??
      device?.name ??
      generalCalibration.find((c) => c.instanceGuid === instanceGuid)?.name ??
      'Unknown controller'
    );
  };

  // What "All cars" has, to say where a car's own set differs.
  let general: Map<string, ControlRecord> | undefined;
  let generalSpoken: ((record: ControlRecord | undefined) => string) | undefined;
  const notes: string[] = [];
  if (!set.general) {
    const generalSet = sets.find((s) => s.general);
    const generalLoaded = generalSet
      ? await load(ctx, generalSet, folder, generalSet.file)
      : undefined;
    if (generalLoaded?.ok) {
      general = new Map(generalLoaded.value.file.records.map((r) => [r.action, r]));
      generalCalibration = generalLoaded.value.calibration;
      generalSpoken = (record) =>
        spoken(record ? resolve(record, deviceName, generalCalibration)?.binding : undefined);
    } else {
      notes.push(
        'The bindings for all cars could not be read, so this page cannot say where this car differs.'
      );
    }
  }
  if (loaded.value.calibrationUnread) {
    notes.push(
      'iRacing’s calibration file (joyCalib.yaml) could not be read, so some axes are shown by number.'
    );
  }

  const actions: Action[] = [];
  const byInput = new Map<string, { binding: ActionBinding; actions: SharedInput['actions'] }>();
  let unread = 0;
  for (const record of file.records) {
    const resolved = resolve(record, deviceName, calibration);
    const name = iracingActionLabel(record.action);
    const group = iracingActionGroup(record.action);
    if (resolved) {
      if (resolved.binding.kind === 'unknown') unread++;
      else {
        const device =
          resolved.binding.device === KEYBOARD
            ? keyboard
            : controllers.get(resolved.binding.device);
        if (device) device.bound++;
        const entry = byInput.get(resolved.same) ?? { binding: resolved.binding, actions: [] };
        entry.actions.push({ id: record.action, name, group });
        byInput.set(resolved.same, entry);
      }
    }
    const before = general?.get(record.action);
    const differs =
      general !== undefined &&
      (before === undefined || !before.data.every((value, i) => value === record.data[i]));
    actions.push({
      id: record.action,
      name,
      group,
      accepts: record.accepts,
      ...(resolved ? { binding: resolved.binding } : {}),
      differs,
      ...(differs && generalSpoken ? { general: generalSpoken(before) } : {}),
    });
  }
  const shared: SharedInput[] = [...byInput.values()]
    .filter((entry) => entry.actions.length > 1)
    .map((entry) => ({
      device: entry.binding.device,
      deviceName: entry.binding.deviceName,
      input: entry.binding.input,
      actions: entry.actions,
      cameraEditor: entry.actions.filter((a) => !isCameraEditor(a.id)).length <= 1,
    }))
    // The ones worth a look first.
    .sort((a, b) => Number(a.cameraEditor) - Number(b.cameraEditor));
  const bound = actions.filter((a) => a.binding !== undefined).length;
  const devices = [...controllers.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (keyboard.bound > 0) devices.push(keyboard);
  return ok({
    set,
    devices,
    actions,
    shared,
    counts: {
      actions: actions.length,
      bound,
      unbound: actions.length - bound,
      unread,
      differs: actions.filter((a) => a.differs).length,
    },
    notes,
  });
}
