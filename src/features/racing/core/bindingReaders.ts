import path from 'node:path';
import {
  controlLabel,
  type AircraftBindings,
  type BindingReader,
  type BoundAircraft,
  type BoundControl,
  type BoundDevice,
  type BoundHatDirection,
  type BoundInput,
} from '../../../core/bindings';
import { err, ok, type Result } from '../../../core/result';
import type { InputDevice } from '../../../shared/models';
import { AC_AXES, acActionLabel, parseIni } from './assettoCorsa';
import { beamngView } from './beamng/beamng';
import { racingCategory, type RacingCategory } from './categories';
import { cleanGuid, liveControllers, locationOf, type RacingContext } from './context';
import { axisName, vidPidFromProductGuid } from './devices';
import { readFiles as readIracingFiles } from './iracing/iracing';
import { iracingActionGroup, iracingActionLabel, iracingKeyLabel } from './iracing/labels';
import { readLmuFiles } from './lmu/lmu';

/**
 * The racing games' bindings for the rest of the app (`ctx.bindings.get('iracing')` and
 * so on): what the racing pages show, in core's game-neutral shape, so cheat sheets, the
 * input tester and the guides work for a wheel the way they do for a stick.
 *
 * "Aircraft" is whatever the game keeps a set of bindings for: one set for all cars, plus
 * a set per car or vehicle where the game has that (iRacing's custom controls for a car,
 * BeamNG's per-vehicle maps). Every reader only reads, and on a PC without the game it is
 * simply not available.
 */

/** The id of the set every car uses. */
export const ALL_CARS = 'all';

/** The set every car uses: a page about it is titled by the game. */
const GENERAL = { id: ALL_CARS, hasUserBindings: true, general: true } as const;

const RACING_AXES = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'S0', 'S1'] as const;

/** The racing code's axis names ("S0") as core's ("SLIDER1"). */
const neutralAxis = (axis: string): string =>
  axis === 'S0' ? 'SLIDER1' : axis === 'S1' ? 'SLIDER2' : axis;

/** A binding being collected: which half of an axis it sits on, when it is on one half. */
type Draft = BoundInput & { half?: '+' | '-' };

interface DraftDevice {
  kind: BoundDevice['kind'];
  name: string;
  guid?: string;
  vendorId?: string;
  productId?: string;
  connected: boolean;
  live?: InputDevice;
  drafts: Draft[];
}

function binding(
  input: string,
  control: BoundControl | undefined,
  action: { id: string; name: string; category?: RacingCategory },
  extra: {
    label?: string;
    modifiers?: string[];
    source?: 'user' | 'default';
    half?: '+' | '-';
  } = {}
): Draft {
  return {
    input,
    inputLabel: extra.label ?? (control ? controlLabel(control) : input),
    kind: control?.kind ?? 'button',
    ...(control ? { control } : {}),
    modifiers: extra.modifiers ?? [],
    actionId: action.id,
    action: action.name,
    category: [action.category ?? racingCategory(action.name)],
    source: extra.source ?? 'user',
    ...(extra.half ? { half: extra.half } : {}),
  };
}

function keyBinding(key: string, action: { id: string; name: string }): Draft {
  return {
    input: key,
    inputLabel: key,
    kind: 'key',
    modifiers: [],
    actionId: action.id,
    action: action.name,
    category: [racingCategory(action.name)],
    source: 'user',
  };
}

const sameAxis = (a: Draft, b: Draft): boolean =>
  a.control?.kind === 'axis' && b.control?.kind === 'axis' && a.control.axis === b.control.axis;

/**
 * Two actions on the two halves of one axis ("Steer left" and "Steer right" on the wheel,
 * "Look left" and "Look right" on a rocker) are one thing to the driver: they become one
 * binding, so a sheet does not flag them as two actions firing together.
 */
export function mergeAxisHalves(drafts: Draft[]): BoundInput[] {
  const out: BoundInput[] = [];
  const used = new Set<Draft>();
  for (const draft of drafts) {
    if (used.has(draft)) continue;
    used.add(draft);
    const { half, ...plain } = draft;
    if (!half) {
      out.push(plain);
      continue;
    }
    const other = drafts.find(
      (d) => !used.has(d) && d.half !== undefined && d.half !== half && sameAxis(d, draft)
    );
    if (!other) {
      // One half on its own is how a pedal is bound: the axis is the whole control.
      out.push(plain);
      continue;
    }
    used.add(other);
    const steering = /steer/i.test(draft.action) && /steer/i.test(other.action);
    out.push({
      ...plain,
      actionId: steering ? 'steering' : `${draft.actionId}+${other.actionId}`,
      action: steering ? 'Steering' : `${draft.action} / ${other.action}`,
    });
  }
  return out;
}

function finish(devices: DraftDevice[]): BoundDevice[] {
  return devices.map(({ drafts, live, ...device }) => ({
    ...device,
    ...(live
      ? { controls: { buttons: live.numButtons, hats: live.numHats, axes: live.axisNames } }
      : {}),
    bindings: mergeAxisHalves(drafts),
  }));
}

/** The one connected controller of a model; nothing when there are several (never a guess). */
function onlyOfModel(
  live: InputDevice[] | undefined,
  ids: { vendorId: string; productId: string } | undefined
): { live?: InputDevice; connected: boolean } {
  if (!live || !ids) return { connected: false };
  const same = live.filter((d) => d.vendorId === ids.vendorId && d.productId === ids.productId);
  return { ...(same.length === 1 ? { live: same[0]! } : {}), connected: same.length > 0 };
}

const routeOf = (game: string) => (): string => `/configure/racing/${game}`;

/** `available()` must never fail: a reader that cannot tell is not available. */
async function quietly(ctx: RacingContext, game: string, check: () => Promise<boolean>) {
  try {
    return await check();
  } catch (e) {
    ctx.log.warn(`racing: could not tell whether ${game} bindings are on this PC`, e);
    return false;
  }
}

// ---- iRacing ----

/** iRacing names axes in joyCalib.yaml ("Wheel Axis", "Brake"); DirectInput calls them X, RZ. */
export function axisFromName(
  name: string,
  vendorId?: string,
  productId?: string
): string | undefined {
  const plain = (text: string): string =>
    text
      .toLowerCase()
      .replace(/\s+axis$/, '')
      .trim();
  const wanted = plain(name);
  if (!wanted) return undefined;
  for (const ids of [
    [vendorId, productId],
    [undefined, undefined],
  ] as const) {
    for (const axis of RACING_AXES) {
      if (plain(axisName(axis, ids[0], ids[1])) === wanted) return neutralAxis(axis);
    }
  }
  return undefined;
}

const IRACING_GROUPS: Record<ReturnType<typeof iracingActionGroup>, RacingCategory> = {
  Driving: 'Driving',
  'In-car adjustments': 'Car adjustments',
  'Cameras and replay': 'View',
  'Interface and chat': 'Other',
};

function iracingAction(id: string): { id: string; name: string; category: RacingCategory } {
  const name = iracingActionLabel(id);
  const byName = racingCategory(name);
  return {
    id,
    name,
    category: byName === 'Other' ? IRACING_GROUPS[iracingActionGroup(id)] : byName,
  };
}

const CAR_PREFIX = 'car:';

async function iracingCars(ctx: RacingContext, documents: string): Promise<string[]> {
  const cars = await ctx.ports.files.list(path.join(documents, 'setups'));
  const out: string[] = [];
  for (const car of cars.ok ? cars.value.sort() : []) {
    if (await ctx.ports.files.exists(path.join(documents, 'setups', car, 'controls.cfg'))) {
      out.push(car);
    }
  }
  return out;
}

export function iracingReader(ctx: RacingContext): BindingReader {
  const documents = (): Promise<string | undefined> => locationOf(ctx, 'iracing', 'documents');
  return {
    game: 'iracing',
    gameName: 'iRacing',
    available: () =>
      quietly(ctx, 'iRacing', async () => {
        const folder = await documents();
        return (
          folder !== undefined && (await ctx.ports.files.exists(path.join(folder, 'controls.cfg')))
        );
      }),
    async aircraft() {
      const folder = await documents();
      if (!folder) return ok([]);
      const general = await ctx.ports.files.exists(path.join(folder, 'controls.cfg'));
      const cars = await iracingCars(ctx, folder);
      return ok([
        ...(general ? [{ ...GENERAL, name: 'All cars' }] : []),
        ...cars.map((car): BoundAircraft => ({
          id: `${CAR_PREFIX}${car}`,
          name: car,
          hasUserBindings: true,
        })),
      ]);
    },
    async bindings(aircraftId): Promise<Result<AircraftBindings>> {
      const folder = await documents();
      if (!folder) return err('racing.bindings', 'The iRacing folder in Documents was not found.');
      let car: string | undefined;
      if (aircraftId !== ALL_CARS) {
        // Only a car iRacing really has custom controls for: the id never becomes a path by itself.
        car = (await iracingCars(ctx, folder)).find((c) => `${CAR_PREFIX}${c}` === aircraftId);
        if (!car) return err('racing.bindings', 'iRacing has no custom controls for that car.');
      }
      const files = await readIracingFiles(ctx, car);
      if (!files?.controls) {
        return err(
          'racing.bindings',
          files?.problems[0] ?? 'iRacing has no controls.cfg yet: bind something in iRacing first.'
        );
      }
      // A car's folder usually has no calibration of its own; the general one names the axes.
      const calibration =
        files.calibration ?? (car ? (await readIracingFiles(ctx))?.calibration : undefined) ?? [];
      const live = await liveControllers(ctx);
      const devices = new Map<string, DraftDevice>();
      const keyboard: DraftDevice = {
        kind: 'keyboard',
        name: 'Keyboard',
        connected: true,
        drafts: [],
      };
      const deviceOf = (instanceGuid: string, productGuid: string): DraftDevice => {
        const guid = cleanGuid(instanceGuid);
        let device = devices.get(guid);
        if (!device) {
          const ids = vidPidFromProductGuid(cleanGuid(productGuid));
          const attached = (live ?? []).find((d) => cleanGuid(d.guid) === guid);
          const calibrated = calibration.find((c) => c.instanceGuid === guid);
          device = {
            kind: 'controller',
            name:
              calibrated?.name ??
              attached?.name ??
              (ids ? `Controller ${ids.vendorId}:${ids.productId}` : 'Unknown controller'),
            guid,
            ...(ids ?? {}),
            connected: attached !== undefined,
            ...(attached ? { live: attached } : {}),
            drafts: [],
          };
          devices.set(guid, device);
        }
        return device;
      };
      for (const record of files.controls.records) {
        const b = record.binding;
        if (b.kind === 'none') continue;
        const action = iracingAction(record.action);
        if (b.kind === 'key') {
          keyboard.drafts.push(keyBinding(iracingKeyLabel(b.keyCode, b.modifiers), action));
          continue;
        }
        const device = deviceOf(b.instanceGuid, b.productGuid);
        if (b.kind === 'axis') {
          const named = calibration
            .find((c) => c.instanceGuid === device.guid)
            ?.axes.find((a) => a.axis === b.axis)?.name;
          const axis = named ? axisFromName(named, device.vendorId, device.productId) : undefined;
          const half = /^Steer(Left|Right)$/.test(record.action)
            ? b.direction === 1
              ? '+'
              : '-'
            : undefined;
          device.drafts.push(
            binding(`axis ${b.axis}`, axis ? { kind: 'axis', axis } : undefined, action, {
              label: named || `Axis ${b.axis}`,
              ...(half ? { half } : {}),
            })
          );
        } else {
          // Several buttons in one binding are held together: the last is the one pressed.
          const buttons = [...b.buttons].sort((x, y) => x - y);
          const last = buttons.pop();
          if (last === undefined) continue;
          device.drafts.push(
            binding(`button ${last}`, { kind: 'button', index: last + 1 }, action, {
              modifiers: buttons.map((n) => `Button ${n + 1}`),
            })
          );
        }
      }
      const all = [...devices.values(), ...(keyboard.drafts.length > 0 ? [keyboard] : [])];
      return ok({
        aircraft: car
          ? { id: aircraftId, name: car, hasUserBindings: true }
          : { ...GENERAL, name: 'All cars' },
        devices: finish(all),
      });
    },
    route: routeOf('iracing'),
  };
}

// ---- Le Mans Ultimate ----

const LMU_HAT: BoundHatDirection[] = ['U', 'R', 'D', 'L'];

/** Le Mans Ultimate's input number as a control: 0-15 axis halves, 16-31 hats, 32+ buttons. */
export function lmuControl(id: number): { control: BoundControl; half?: '+' | '-' } | undefined {
  if (!Number.isInteger(id) || id < 0) return undefined;
  if (id < 16) {
    return {
      control: { kind: 'axis', axis: neutralAxis(RACING_AXES[Math.floor(id / 2)]!) },
      half: id % 2 === 0 ? '+' : '-',
    };
  }
  if (id < 32) {
    return {
      control: {
        kind: 'hat',
        hat: Math.floor((id - 16) / 4) + 1,
        direction: LMU_HAT[(id - 16) % 4]!,
      },
    };
  }
  return { control: { kind: 'button', index: id - 32 + 1 } };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function lmuReader(ctx: RacingContext): BindingReader {
  const file = async (): Promise<string | undefined> => {
    const player = await locationOf(ctx, 'lmu', 'player');
    return player ? path.join(player, 'direct input.json') : undefined;
  };
  const exists = async (): Promise<boolean> => {
    const f = await file();
    return f !== undefined && (await ctx.ports.files.exists(f));
  };
  return {
    game: 'lmu',
    gameName: 'Le Mans Ultimate',
    available: () => quietly(ctx, 'Le Mans Ultimate', exists),
    async aircraft() {
      return ok((await exists()) ? [{ ...GENERAL, name: 'All cars' }] : []);
    },
    async bindings(aircraftId): Promise<Result<AircraftBindings>> {
      if (aircraftId !== ALL_CARS) {
        return err('racing.bindings', 'Le Mans Ultimate keeps one set of bindings for every car.');
      }
      const files = await readLmuFiles(ctx);
      if (!files?.directInput) {
        return err(
          'racing.bindings',
          files?.problems[0] ??
            'Le Mans Ultimate has no bindings file yet: bind something in the game first.'
        );
      }
      const di = files.directInput;
      const live = await liveControllers(ctx);
      const devices = new Map<string, DraftDevice>();
      const deviceOf = (key: string): DraftDevice => {
        let device = devices.get(key);
        if (!device) {
          const all = isObject(di['Devices']) ? di['Devices'] : {};
          const raw = isObject(all[key]) ? all[key] : {};
          const guid =
            typeof raw['product guid'] === 'string' ? cleanGuid(raw['product guid']) : '';
          const ids = vidPidFromProductGuid(guid);
          const found = onlyOfModel(live, ids);
          device = {
            kind: 'controller',
            name:
              typeof raw['product name'] === 'string' ? raw['product name'] : key.split(':')[0]!,
            ...(found.live ? { guid: cleanGuid(found.live.guid), live: found.live } : {}),
            ...(ids ?? {}),
            connected: found.connected,
            drafts: [],
          };
          devices.set(key, device);
        }
        return device;
      };
      for (const section of ['Input', 'Alternative Input']) {
        const entries = isObject(di[section]) ? di[section] : {};
        for (const [action, raw] of Object.entries(entries)) {
          if (
            !isObject(raw) ||
            typeof raw['device'] !== 'string' ||
            typeof raw['id'] !== 'number'
          ) {
            continue;
          }
          const input = lmuControl(raw['id']);
          const device = deviceOf(raw['device']);
          const axis = raw['id'] < 16 ? RACING_AXES[Math.floor(raw['id'] / 2)] : undefined;
          device.drafts.push(
            binding(
              `id ${raw['id']}`,
              input?.control,
              { id: action, name: action },
              {
                ...(axis ? { label: axisName(axis, device.vendorId, device.productId) } : {}),
                ...(input?.half ? { half: input.half } : {}),
              }
            )
          );
        }
      }
      return ok({
        aircraft: { ...GENERAL, name: 'All cars' },
        devices: finish([...devices.values()]),
      });
    },
    route: routeOf('lmu'),
  };
}

// ---- BeamNG.drive ----

const BEAMNG_AXES: Record<string, string> = {
  xaxis: 'X',
  yaxis: 'Y',
  zaxis: 'Z',
  rxaxis: 'RX',
  ryaxis: 'RY',
  rzaxis: 'RZ',
  slider: 'SLIDER1',
  slider2: 'SLIDER2',
};
const BEAMNG_POV: Record<string, BoundHatDirection> = {
  upov: 'U',
  dpov: 'D',
  lpov: 'L',
  rpov: 'R',
};

/** BeamNG's control names on a DirectInput controller: "button11", "xaxis", "upov". */
export function beamngControl(control: string): BoundControl | undefined {
  const axis = BEAMNG_AXES[control];
  if (axis) return { kind: 'axis', axis };
  const button = /^button(\d{1,3})$/.exec(control);
  if (button) return { kind: 'button', index: Number(button[1]) + 1 };
  const pov = /^([udlr]pov)(\d?)$/.exec(control);
  if (pov) {
    return { kind: 'hat', hat: pov[2] ? Number(pov[2]) + 1 : 1, direction: BEAMNG_POV[pov[1]!]! };
  }
  return undefined;
}

export function beamngReader(ctx: RacingContext): BindingReader {
  const inputmaps = async (): Promise<string | undefined> => {
    const user = await locationOf(ctx, 'beamng', 'user');
    return user ? path.join(user, 'settings', 'inputmaps') : undefined;
  };
  return {
    game: 'beamng',
    gameName: 'BeamNG.drive',
    available: () =>
      quietly(ctx, 'BeamNG.drive', async () => {
        const dir = await inputmaps();
        if (!dir) return false;
        const maps = await ctx.ports.files.listTree(dir, { include: ['*.diff'], maxEntries: 2000 });
        return maps.ok && maps.value.length > 0;
      }),
    async aircraft() {
      const view = await beamngView(ctx);
      const general = view.maps.filter((m) => !m.vehicle);
      const vehicles = [...new Set(view.maps.flatMap((m) => (m.vehicle ? [m.vehicle] : [])))];
      return ok([
        ...(view.maps.length > 0
          ? [
              {
                ...GENERAL,
                name: 'All vehicles',
                hasUserBindings: general.some((m) => m.bindings.some((b) => b.yours)),
              },
            ]
          : []),
        ...vehicles.sort().map((vehicle): BoundAircraft => ({
          id: `vehicle:${vehicle}`,
          name: vehicle,
          hasUserBindings: true,
        })),
      ]);
    },
    async bindings(aircraftId): Promise<Result<AircraftBindings>> {
      const view = await beamngView(ctx);
      const vehicle = aircraftId === ALL_CARS ? undefined : aircraftId.replace(/^vehicle:/, '');
      if (vehicle !== undefined && !view.maps.some((m) => m.vehicle === vehicle)) {
        return err('racing.bindings', 'BeamNG.drive has no bindings of its own for that vehicle.');
      }
      if (view.maps.length === 0) {
        return err(
          'racing.bindings',
          view.problems[0] ?? 'BeamNG.drive has no bindings yet: bind something in the game first.'
        );
      }
      const live = await liveControllers(ctx);
      const devices = new Map<string, DraftDevice>();
      // The general maps apply in every vehicle; a vehicle's own maps come on top of them.
      for (const map of view.maps) {
        if (map.vehicle && map.vehicle !== vehicle) continue;
        let device = devices.get(map.vidpid);
        if (!device) {
          const ids =
            map.vendorId && map.productId
              ? { vendorId: map.vendorId, productId: map.productId }
              : undefined;
          const found = onlyOfModel(live, ids);
          const typed = map.state === 'keyboard';
          device = {
            kind: !typed ? 'controller' : /mouse/i.test(map.vidpid) ? 'mouse' : 'keyboard',
            name: map.name,
            ...(found.live ? { guid: cleanGuid(found.live.guid), live: found.live } : {}),
            ...(ids ?? {}),
            connected: typed || found.connected,
            drafts: [],
          };
          devices.set(map.vidpid, device);
        }
        for (const b of map.bindings) {
          const action = { id: b.action, name: b.label };
          const source = b.yours ? 'user' : 'default';
          if (device.kind !== 'controller') {
            device.drafts.push({ ...keyBinding(b.input, action), source });
            continue;
          }
          const control = beamngControl(b.control);
          device.drafts.push(binding(b.control, control, action, { label: b.input, source }));
        }
      }
      return ok({
        aircraft: {
          id: aircraftId,
          ...(vehicle === undefined ? { general: true } : {}),
          name: vehicle ?? 'All vehicles',
          hasUserBindings: [...devices.values()].some((d) =>
            d.drafts.some((b) => b.source === 'user')
          ),
        },
        devices: finish([...devices.values()]),
      });
    },
    route: routeOf('beamng'),
  };
}

// ---- Assetto Corsa ----

export function assettoCorsaReader(ctx: RacingContext): BindingReader {
  const file = async (): Promise<string | undefined> => {
    const cfg = await locationOf(ctx, 'assetto-corsa', 'cfg');
    return cfg ? path.join(cfg, 'controls.ini') : undefined;
  };
  const exists = async (): Promise<boolean> => {
    const f = await file();
    return f !== undefined && (await ctx.ports.files.exists(f));
  };
  return {
    game: 'assetto-corsa',
    gameName: 'Assetto Corsa',
    available: () => quietly(ctx, 'Assetto Corsa', exists),
    async aircraft() {
      return ok((await exists()) ? [{ ...GENERAL, name: 'All cars' }] : []);
    },
    async bindings(aircraftId): Promise<Result<AircraftBindings>> {
      if (aircraftId !== ALL_CARS) {
        return err('racing.bindings', 'Assetto Corsa keeps one set of bindings for every car.');
      }
      const f = await file();
      if (!f || !(await ctx.ports.files.exists(f))) {
        return err('racing.bindings', 'Assetto Corsa has no controls.ini yet.');
      }
      const text = await ctx.ports.files.readText(f);
      if (!text.ok) return text;
      const ini = parseIni(text.value);
      const live = await liveControllers(ctx);
      const listed = ini.get('CONTROLLERS') ?? new Map<string, { value: string }>();
      const devices = new Map<number, DraftDevice>();
      const keyboard: DraftDevice = {
        kind: 'keyboard',
        name: 'Keyboard',
        connected: true,
        drafts: [],
      };
      const deviceOf = (joy: number): DraftDevice => {
        let device = devices.get(joy);
        if (!device) {
          const guid = cleanGuid(listed.get(`__IGUID${joy}`)?.value ?? '');
          const ids = vidPidFromProductGuid(cleanGuid(listed.get(`PGUID${joy}`)?.value ?? ''));
          const attached = guid ? (live ?? []).find((d) => cleanGuid(d.guid) === guid) : undefined;
          device = {
            kind: 'controller',
            name: listed.get(`CON${joy}`)?.value || attached?.name || `Controller ${joy}`,
            ...(guid ? { guid } : {}),
            ...(ids ?? {}),
            connected: attached !== undefined,
            ...(attached ? { live: attached } : {}),
            drafts: [],
          };
          devices.set(joy, device);
        }
        return device;
      };
      for (const [section, values] of ini) {
        const number = (key: string): number => Number.parseInt(values.get(key)?.value ?? '', 10);
        const joy = number('JOY');
        const action = { id: section, name: acActionLabel(section) };
        const axle = number('AXLE');
        const button = number('BUTTON');
        if (joy >= 0 && axle >= 0 && AC_AXES[axle]) {
          const device = deviceOf(joy);
          const axis = AC_AXES[axle]!;
          device.drafts.push(
            binding(`AXLE=${axle}`, { kind: 'axis', axis: neutralAxis(axis) }, action, {
              label: axisName(axis, device.vendorId, device.productId),
            })
          );
        }
        if (joy >= 0 && button >= 0) {
          deviceOf(joy).drafts.push(
            binding(`BUTTON=${button}`, { kind: 'button', index: button + 1 }, action)
          );
        }
        const key = values.get('KEY');
        if (key && key.value !== '-1' && key.value !== '' && values.has('BUTTON')) {
          keyboard.drafts.push(keyBinding(key.comment || key.value, action));
        }
      }
      const all = [
        ...[...devices.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => d),
        ...(keyboard.drafts.length > 0 ? [keyboard] : []),
      ];
      return ok({
        aircraft: { ...GENERAL, name: 'All cars' },
        devices: finish(all),
      });
    },
    route: routeOf('assetto-corsa'),
  };
}

export function racingBindingReaders(ctx: RacingContext): BindingReader[] {
  return [iracingReader(ctx), lmuReader(ctx), beamngReader(ctx), assettoCorsaReader(ctx)];
}
