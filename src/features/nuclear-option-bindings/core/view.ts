import {
  controlLabel,
  type AircraftBindings,
  type BindingReader,
  type BoundAction,
  type BoundAircraft,
  type BoundControl,
  type BoundDevice,
  type BoundInput,
} from '../../../core/bindings';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import { err, ok, type Result } from '../../../core/result';
import type { InputDevice } from '../../../shared/models';
import type { Overview, OverviewBinding, OverviewDevice } from '../contract';
import {
  ACTIONS,
  actionOf,
  bindingActionId,
  bindingName,
  mapCategoryName,
  mapCategoryOf,
} from './actions';
import { gameKeyByNumbers, keyName, modifierName, MODIFIERS, mouseElementName } from './keys';
import {
  parseControllerMap,
  parseHardwareIdentifier,
  parseSaveKey,
  textOfBinary,
  type ControllerMap,
  type ElementMap,
} from './rewired';

/**
 * Nuclear Option's bindings as the game saved them, read from the registry values the
 * Rewired library writes (HKEY_CURRENT_USER\Software\Shockfront\NuclearOption). This
 * file only reads; what the feature writes goes through FileStore, in change.ts.
 *
 * What is verified and what is inferred: docs/research/nuclear-option.md, section 4.
 */

/** What this code needs: the ports, and the game registry to say whether the game is here. */
export interface BindingsContext extends CheckContext {
  games: GameRegistry;
}

export const GAME = 'nuclear-option';
export const GAME_NAME = 'Nuclear Option';
export const ROUTE = '/configure/nuclear-option-bindings';
export const REGISTRY_KEY = 'Software\\Shockfront\\NuclearOption';
/** The one set of bindings the game has: it keeps none per aircraft. */
export const ALL_AIRCRAFT = 'all';

/**
 * The axes of a controller in the order Rewired numbers them (0, 1, 2, ...) when the
 * controller is not plugged in to ask. Inferred: DirectInput's order.
 */
const AXIS_ORDER = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1', 'SLIDER2'];
/** Rewired numbers the buttons of a controller it has no definition for from 32. */
const FIRST_BUTTON = 32;

/** A saved joystick map with what its registry key says about the controller. */
interface SavedMap {
  map: ControllerMap;
  vendorId?: string;
  productId?: string;
  /** Which unit of the same model: 0 the first. */
  duplicate: number;
  /** The registry value the map was read from, and its text exactly as stored. */
  valueName: string;
  text: string;
}

interface Saved {
  maps: SavedMap[];
  /** Values that are Rewired's but could not be read, in words. */
  problems: string[];
  /**
   * The controllers (by the id the page knows them by) with a saved map that could not be
   * read. What such a map holds is not known, so the controller is not cleared as a whole.
   */
  unread: Set<string>;
  /** The key holds values of the game at all. */
  found: boolean;
}

async function readSaved(ctx: BindingsContext): Promise<Result<Saved>> {
  const values = await ctx.ports.registry.listValues('HKCU', REGISTRY_KEY);
  if (!values.ok) return values;
  const saved: Saved = {
    maps: [],
    problems: [],
    unread: new Set(),
    found: Object.keys(values.value).length > 0,
  };

  // What each value is, from its name alone.
  const entries = Object.entries(values.value).flatMap(([name, value]) => {
    const key = parseSaveKey(name);
    if (!key || key.dataType !== 'ControllerMap') return [];
    const identity = key.parts.hardwareIdentifier
      ? parseHardwareIdentifier(key.parts.hardwareIdentifier)
      : undefined;
    const duplicate = Number(key.parts.duplicate ?? '0');
    return [
      {
        name,
        value,
        type: key.parts.controllerMapType ?? 'a map',
        identity,
        duplicate: Number.isInteger(duplicate) && duplicate >= 0 ? duplicate : 0,
        category: key.parts.categoryId ?? '',
      },
    ];
  });
  const unit = (e: (typeof entries)[number]): string =>
    `${e.identity?.vendorId}:${e.identity?.productId}:${e.duplicate}:${e.category}`;
  // A later game build saves a controller's map under a shorter identifier and can leave
  // the map it saved before in place. Where both are there for one controller and one map
  // category, the later one is what the game uses (its controller assignments name it), so
  // the earlier one is left out, also when the later one cannot be read.
  const later = new Set(entries.filter((e) => e.identity?.form === 'short').map(unit));

  // The controller a value is for is in its name, so it is known also when the value is not read.
  const unread = (entry: (typeof entries)[number]): void => {
    if (entry.type === 'JoystickMap' && entry.identity) {
      saved.unread.add(
        `controller:${entry.identity.vendorId}:${entry.identity.productId}:${entry.duplicate}`
      );
    }
  };
  for (const entry of entries) {
    if (entry.identity?.form === 'guid' && later.has(unit(entry))) continue;
    const text = entry.value.type === 'binary' ? textOfBinary(entry.value.value) : undefined;
    if (text === undefined) {
      saved.problems.push(`A saved ${entry.type} is not stored as text, so it was left out.`);
      unread(entry);
      continue;
    }
    const map = parseControllerMap(text);
    if (!map.ok) {
      saved.problems.push(`A saved ${entry.type} could not be read: ${map.error.message}`);
      unread(entry);
      continue;
    }
    saved.maps.push({
      map: map.value,
      ...(entry.identity
        ? { vendorId: entry.identity.vendorId, productId: entry.identity.productId }
        : {}),
      duplicate: entry.duplicate,
      valueName: entry.name,
      text,
    });
  }
  return ok(saved);
}

const unitOf = (m: SavedMap): string => `${m.vendorId ?? ''}:${m.productId ?? ''}:${m.duplicate}`;

/** The id the page knows a controller by: one per unit of a model. */
const controllerId = (entry: SavedMap): string =>
  entry.vendorId
    ? `controller:${unitOf(entry)}`
    : `controller:${entry.map.hardwareName}:${entry.duplicate}`;

/** A controller's saved map for the game's own category ("Game"), as stored: what a change edits. */
export interface StoredMap {
  valueName: string;
  text: string;
  map: ControllerMap;
  /** The controller's name as the game saved it. */
  deviceName: string;
}

export async function storedGameMap(
  ctx: BindingsContext,
  deviceId: string
): Promise<Result<StoredMap>> {
  const saved = await readSaved(ctx);
  if (!saved.ok) return saved;
  const found = saved.value.maps.find(
    (m) => m.map.kind === 'JoystickMap' && m.map.categoryId === 0 && controllerId(m) === deviceId
  );
  if (!found) {
    return err(
      'nuclear-option.noMap',
      'Nuclear Option has saved no bindings for this controller, so there is nothing to change. Start the game once with it plugged in.'
    );
  }
  return ok({
    valueName: found.valueName,
    text: found.text,
    map: found.map,
    deviceName: found.map.hardwareName || 'the controller',
  });
}

/** The id the page knows the keyboard by. */
export const KEYBOARD = 'keyboard';

/** The keyboard's saved map for one tab of the game's controls screen, as stored. */
export async function storedKeyboardMap(
  ctx: BindingsContext,
  mapCategory: number
): Promise<Result<StoredMap>> {
  const saved = await readSaved(ctx);
  if (!saved.ok) return saved;
  const maps = saved.value.maps.filter(
    (m) => m.map.kind === 'KeyboardMap' && m.map.categoryId === mapCategory
  );
  // Two maps for one tab: which of them the game reads is not known, so neither is changed.
  if (maps.length > 1) {
    return err(
      'nuclear-option.edit.twoMaps',
      'Nuclear Option has saved two sets of key bindings for that tab of its controls screen, and RigReady cannot tell which one it uses. Change the key in the game.'
    );
  }
  const found = maps[0];
  if (!found) {
    return err(
      'nuclear-option.noMap',
      'Nuclear Option has saved no key bindings for that tab of its controls screen, so there is nothing to change. Start the game once.'
    );
  }
  return ok({
    valueName: found.valueName,
    text: found.text,
    map: found.map,
    deviceName: 'the keyboard',
  });
}

/**
 * Every saved map of a controller, as stored: the Game category's and the other
 * categories' (Chat, Mission Editor, Debug). What clearing a controller empties.
 */
export async function storedControllerMaps(
  ctx: BindingsContext,
  deviceId: string
): Promise<Result<StoredMap[]>> {
  const saved = await readSaved(ctx);
  if (!saved.ok) return saved;
  // One of its maps could not be read: clearing the others would leave the controller partly
  // cleared and say it was done.
  if (saved.value.unread.has(deviceId)) {
    return err(
      'nuclear-option.edit.unread',
      'One of the game’s saved maps for this controller could not be read, so RigReady does not clear the controller: it could not tell what would be left. Clear its bindings in the game.'
    );
  }
  const found = saved.value.maps.filter(
    (m) => m.map.kind === 'JoystickMap' && controllerId(m) === deviceId
  );
  if (found.length === 0) {
    return err(
      'nuclear-option.noMap',
      'Nuclear Option has saved no bindings for this controller, so there is nothing to clear.'
    );
  }
  return ok(
    found
      .sort((a, b) => a.map.categoryId - b.map.categoryId)
      .map((m) => ({
        valueName: m.valueName,
        text: m.text,
        map: m.map,
        deviceName: m.map.hardwareName || 'the controller',
      }))
  );
}

/**
 * The axes of a controller by the names RigReady shows them under, in the order the game
 * numbers them (0 first): the plugged-in controller's own, or the usual order when it is not
 * plugged in or reports none.
 */
export async function axisNamesOf(
  ctx: BindingsContext,
  deviceId: string
): Promise<Result<{ names: string[]; asked: boolean }>> {
  const view = await overview(ctx);
  if (!view.ok) return view;
  const device = view.value.devices.find((d) => d.id === deviceId);
  const live = device?.connected ? (device.controls?.axes ?? []) : [];
  // `asked`: the controller is plugged in and said which axes it has. Otherwise the names
  // are the usual order, good enough to name what is bound, not to choose where to bind.
  return ok(live.length > 0 ? { names: live, asked: true } : { names: AXIS_ORDER, asked: false });
}

/** The control of a controller an element id means; undefined for one that is not understood. */
export function controlOf(element: ElementMap, live?: InputDevice): BoundControl | undefined {
  const id = element.elementIdentifierId;
  if (element.elementType === 0) {
    if (id < 0 || id >= FIRST_BUTTON) return undefined;
    // A plugged-in controller says which axes it has: an id past them is not one of its axes.
    const known = live && live.axisNames.length > 0 ? live.axisNames : AXIS_ORDER;
    const axis = known[id];
    return axis ? { kind: 'axis', axis } : undefined;
  }
  if (id < FIRST_BUTTON) return undefined;
  return { kind: 'button', index: id - FIRST_BUTTON + 1 };
}

/** The element as the game's own controls screen shows it: "Button 4" (from 0), "Axis 1". */
function gameInput(element: ElementMap): string {
  const id = element.elementIdentifierId;
  if (element.elementType === 0) return `Axis ${id}`;
  return id >= FIRST_BUTTON ? `Button ${id - FIRST_BUTTON}` : `Element ${id}`;
}

function joystickBinding(
  element: ElementMap,
  mapCategory: number,
  live?: InputDevice
): OverviewBinding {
  const action = actionOf(element.actionId);
  const control = controlOf(element, live);
  const wholeAxis = element.elementType === 0 && element.axisRange === 0;
  const half =
    element.elementType === 0 && element.axisRange === 1
      ? ' (positive half)'
      : element.elementType === 0 && element.axisRange === 2
        ? ' (negative half)'
        : '';
  return {
    actionId: bindingActionId(action, wholeAxis, element.axisContribution),
    action: bindingName(action, wholeAxis, element.axisContribution),
    category: action.category,
    mapCategory: mapCategoryName(mapCategory),
    input: gameInput(element),
    inputLabel: (control ? controlLabel(control) : gameInput(element)) + half,
    kind: control?.kind ?? (element.elementType === 0 ? 'axis' : 'button'),
    ...(control ? { control } : {}),
    modifiers: [],
    inverted: element.elementType === 0 && element.invert,
  };
}

function keyBinding(element: ElementMap, mapCategory: number): OverviewBinding {
  const action = actionOf(element.actionId);
  const key = keyName(element.keyboardKeyCode);
  const known = gameKeyByNumbers(element.elementIdentifierId, element.keyboardKeyCode);
  return {
    actionId: bindingActionId(action, false, element.axisContribution),
    action: bindingName(action, false, element.axisContribution),
    category: action.category,
    mapCategory: mapCategoryName(mapCategory),
    input: key,
    inputLabel: key,
    kind: 'key',
    modifiers: element.modifierKeys.flatMap((m) => modifierName(m) ?? []),
    inverted: false,
    // Only for a key whose two numbers are the table's, held with modifier keys it knows.
    ...(known && element.modifierKeys.every((m) => [0, 1, 2, 3].includes(m))
      ? {
          key: {
            code: known.dom,
            ctrl: element.modifierKeys.includes(MODIFIERS.ctrl),
            alt: element.modifierKeys.includes(MODIFIERS.alt),
            shift: element.modifierKeys.includes(MODIFIERS.shift),
          },
        }
      : {}),
  };
}

function mouseBinding(element: ElementMap, mapCategory: number): OverviewBinding {
  const action = actionOf(element.actionId);
  const name = mouseElementName(element.elementType, element.elementIdentifierId);
  return {
    actionId: bindingActionId(action, element.elementType === 0, element.axisContribution),
    action: bindingName(action, element.elementType === 0, element.axisContribution),
    category: action.category,
    mapCategory: mapCategoryName(mapCategory),
    input: name,
    inputLabel: name,
    kind: element.elementType === 0 ? 'axis' : 'button',
    modifiers: [],
    inverted: element.elementType === 0 && element.invert,
  };
}

const enabledOf = (map: ControllerMap): ElementMap[] =>
  [...map.axisMaps, ...map.buttonMaps].filter((e) => e.enabled);

/** The plugged-in controller a saved map belongs to: the nth of its model. */
function liveFor(saved: SavedMap, live: InputDevice[]): InputDevice | undefined {
  if (!saved.vendorId || !saved.productId) return undefined;
  const same = live
    .filter((d) => d.vendorId === saved.vendorId && d.productId === saved.productId)
    .sort((a, b) => (a.enumerationIndex ?? a.index) - (b.enumerationIndex ?? b.index));
  return same[saved.duplicate];
}

function sortBindings(bindings: OverviewBinding[]): OverviewBinding[] {
  const order = new Map(ACTIONS.map((a, i) => [String(a.id), i]));
  return [...bindings].sort(
    (a, b) =>
      (order.get(a.actionId.split(':')[0]!) ?? 999) -
        (order.get(b.actionId.split(':')[0]!) ?? 999) || a.action.localeCompare(b.action)
  );
}

function devicesOf(saved: Saved, live: InputDevice[]): OverviewDevice[] {
  const devices = new Map<string, OverviewDevice>();
  const add = (id: string, make: () => OverviewDevice, bindings: OverviewBinding[]): void => {
    const device = devices.get(id) ?? make();
    device.bindings.push(...bindings);
    devices.set(id, device);
  };
  for (const entry of saved.maps) {
    const { map } = entry;
    if (map.kind === 'KeyboardMap') {
      add(
        'keyboard',
        () => ({
          id: 'keyboard',
          kind: 'keyboard',
          name: 'Keyboard',
          connected: true,
          bindings: [],
        }),
        enabledOf(map).map((e) => keyBinding(e, map.categoryId))
      );
    } else if (map.kind === 'MouseMap') {
      add(
        'mouse',
        () => ({ id: 'mouse', kind: 'mouse', name: 'Mouse', connected: true, bindings: [] }),
        enabledOf(map).map((e) => mouseBinding(e, map.categoryId))
      );
    } else {
      const connected = liveFor(entry, live);
      // One device per unit of a model, whichever identifier its maps were saved under; a
      // map whose identifier RigReady cannot read is told apart by the name inside it.
      const id = controllerId(entry);
      add(
        id,
        () => ({
          id,
          kind: 'controller',
          name: connected?.name ?? (map.hardwareName || 'A controller without a name'),
          connected: connected !== undefined,
          ...(connected ? { guid: connected.guid } : {}),
          ...(entry.vendorId ? { vendorId: entry.vendorId } : {}),
          ...(entry.productId ? { productId: entry.productId } : {}),
          ...(connected
            ? {
                controls: {
                  buttons: connected.numButtons,
                  hats: connected.numHats,
                  axes: connected.axisNames,
                },
              }
            : {}),
          bindings: [],
        }),
        enabledOf(map).map((e) => joystickBinding(e, map.categoryId, connected))
      );
    }
  }
  const rank = { controller: 0, keyboard: 1, mouse: 2 } as const;
  return [...devices.values()]
    .map((d) => ({ ...d, bindings: sortBindings(d.bindings) }))
    .sort(
      (a, b) =>
        rank[a.kind] - rank[b.kind] ||
        Number(b.connected) - Number(a.connected) ||
        b.bindings.length - a.bindings.length ||
        a.name.localeCompare(b.name)
    );
}

async function installed(ctx: BindingsContext): Promise<boolean> {
  const found = await ctx.games.get(GAME)?.detect(ctx);
  return found?.ok === true && found.value.length > 0;
}

async function liveControllers(ctx: BindingsContext): Promise<InputDevice[]> {
  const started = await ctx.ports.input.start();
  return started.ok ? started.value : [];
}

/** Everything the page shows. */
export async function overview(ctx: BindingsContext): Promise<Result<Overview>> {
  const saved = await readSaved(ctx);
  if (!saved.ok) return saved;
  const devices = devicesOf(saved.value, await liveControllers(ctx));
  return ok({
    installed: await installed(ctx),
    saved: saved.value.maps.length > 0 || saved.value.problems.length > 0,
    registryKey: `HKEY_CURRENT_USER\\${REGISTRY_KEY}`,
    devices,
    actions: ACTIONS.flatMap((a) => {
      const entry = (takes: 'button' | 'axis', name: string, side?: '+' | '-') => ({
        id: a.id,
        ...(side ? { side } : {}),
        key: side ? `${a.id}:${side}` : String(a.id),
        name,
        category: a.category,
        mapCategory: mapCategoryName(mapCategoryOf(a)),
        takes,
      });
      if (a.kind !== 'axis') return [entry('button', a.name)];
      return [
        entry('axis', a.name),
        ...(a.positive ? [entry('button', a.positive, '+')] : []),
        ...(a.negative ? [entry('button', a.negative, '-')] : []),
      ];
    }),
    problems: saved.value.problems,
  });
}

const AIRCRAFT: BoundAircraft = {
  id: ALL_AIRCRAFT,
  name: 'All aircraft',
  hasUserBindings: true,
  general: true,
};

function boundDevice(device: OverviewDevice): BoundDevice {
  return {
    kind: device.kind,
    name: device.name,
    ...(device.guid ? { guid: device.guid } : {}),
    ...(device.vendorId ? { vendorId: device.vendorId } : {}),
    ...(device.productId ? { productId: device.productId } : {}),
    connected: device.connected,
    ...(device.controls ? { controls: device.controls } : {}),
    bindings: device.bindings.map((b): BoundInput => ({
      input: b.input,
      inputLabel: b.inputLabel,
      kind: b.kind,
      ...(b.control ? { control: b.control } : {}),
      modifiers: b.modifiers,
      actionId: b.actionId,
      action: b.action,
      category: [b.category],
      source: 'user',
    })),
  };
}

/** Nuclear Option's bindings for the cheat sheets, the trainer, the overlay and the tester. */
export function createBindingReader(ctx: BindingsContext): BindingReader {
  return {
    game: GAME,
    gameName: GAME_NAME,
    async available() {
      if (await installed(ctx)) return true;
      const saved = await readSaved(ctx);
      return saved.ok && (saved.value.maps.length > 0 || saved.value.problems.length > 0);
    },
    aircraft: async () => ok([AIRCRAFT]),
    async bindings(aircraftId): Promise<Result<AircraftBindings>> {
      if (aircraftId !== ALL_AIRCRAFT) {
        return err(
          'nuclear-option.aircraft',
          'Nuclear Option has one set of bindings for every aircraft.'
        );
      }
      const view = await overview(ctx);
      if (!view.ok) return view;
      return ok({ aircraft: AIRCRAFT, devices: view.value.devices.map(boundDevice) });
    },
    route: (target) => (target?.guid ? `${ROUTE}?guid=${encodeURIComponent(target.guid)}` : ROUTE),
    routesToDevice: true,
    async actions(aircraftId): Promise<Result<BoundAction[]>> {
      if (aircraftId !== ALL_AIRCRAFT) {
        return err(
          'nuclear-option.aircraft',
          'Nuclear Option has one set of bindings for every aircraft.'
        );
      }
      return ok(
        // An axis action is three things to bind: the axis, and each side for a button or a
        // key, each under the id its bindings carry.
        ACTIONS.flatMap((a): BoundAction[] => {
          const whole: BoundAction = {
            id: String(a.id),
            name: a.name,
            category: [a.category],
            kind: a.kind,
            editable: false,
          };
          if (a.kind !== 'axis') return [whole];
          const side = (n: number, name: string | undefined): BoundAction[] =>
            name
              ? [{ ...whole, id: bindingActionId(a, false, n), name, kind: 'button' as const }]
              : [];
          return [whole, ...side(0, a.positive), ...side(1, a.negative)];
        })
      );
    },
  };
}
