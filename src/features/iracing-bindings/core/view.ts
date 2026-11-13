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
 * in change.ts, behind a switch).
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

/** The sets iRacing keeps, "All cars" first; a car is one only when it has a controls.cfg of its own. */
async function findSets(
  ctx: BindingsContext,
  folder: string,
  cars: string[]
): Promise<BindingSet[]> {
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
  return sets;
}

/**
 * The programs that write these files: the simulator, not the launcher. Only the simulator
 * writes controls.cfg, when it exits.
 */
export function simulatorOf(ctx: BindingsContext): { processes: string[] } {
  const module = ctx.games.get(GAME);
  return { processes: module?.closeBeforeRestore?.processes ?? module?.processes ?? [] };
}

export async function overview(
  ctx: BindingsContext,
  repairRoute?: string,
  editing = false
): Promise<Overview> {
  const module = ctx.games.get(GAME);
  const installs = module ? await module.detect(ctx) : undefined;
  const folder = await userFolder(ctx);
  const cars = folder ? await carFolders(ctx, folder) : [];
  return {
    installed: installs?.ok === true && installs.value.length > 0,
    ...(folder ? { folder } : {}),
    simRunning: await gameRunning(ctx, simulatorOf(ctx)),
    sets: folder ? await findSets(ctx, folder, cars) : [],
    carFolders: cars.length,
    ...(repairRoute ? { repairRoute } : {}),
    editing,
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
  const sets = await findSets(ctx, folder, await carFolders(ctx, folder));
  const set = sets.find((s) => s.id === id);
  if (!set) {
    return err(
      'iracing-bindings.noSet',
      id === ALL_CARS
        ? 'iRacing has no controls.cfg yet. Bind something in iRacing first; this page then fills in.'
        : 'iRacing has no custom controls for that car.'
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
  // A car's folder may hold a calibration of its own; the general one names the rest.
  const places = set.general
    ? [path.join(folder, CALIBRATION)]
    : [path.join(path.dirname(set.file), CALIBRATION), path.join(folder, CALIBRATION)];
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
  const loaded = await load(ctx, set, folder, withBytes);
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
    const generalLoaded = generalSet ? await load(ctx, generalSet, folder) : undefined;
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
