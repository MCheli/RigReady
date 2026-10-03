import path from 'node:path';
import { err, ok, type Result } from '../../../../core/result';
import { readSteamApp } from '../../../../core/steam';
import type { InputDevice } from '../../../../shared/models';
import type { LmuDeviceView, LmuView } from '../../contract';
import {
  cleanGuid,
  installOf,
  isRunning,
  liveControllers,
  locationOf,
  racingGame,
  type RacingContext,
} from '../context';
import {
  axisName,
  COMPATIBILITY_PID,
  FANATEC_PRODUCTS,
  FANATEC_VENDOR,
  vidPidFromProductGuid,
} from '../devices';

/**
 * Le Mans Ultimate's bindings, UserData\player\direct input.json. Action names are plain
 * English; "id" encodes the input: 0-15 axis halves, 16-31 POV hats, 32+ buttons.
 * Devices are keyed by "<product name>:<instance name>-<16 hex>"; how the suffix is made
 * is unknown, so RigReady never rewrites it (docs/research/racing.md 3.3).
 */

const AXES = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'S0', 'S1'];
const HAT = ['up', 'right', 'down', 'left'];

export function lmuInputLabel(id: number, vendorId?: string, productId?: string): string {
  if (id < 0) return `Input ${id}`;
  if (id < 16) {
    const axis = AXES[Math.floor(id / 2)]!;
    const sign = id % 2 === 0 ? '+' : '−';
    return `${axisName(axis, vendorId, productId)} (${axis}${sign})`;
  }
  if (id < 32) {
    const hat = Math.floor((id - 16) / 4);
    return `${hat === 0 ? 'D-pad' : `Hat ${hat + 1}`} ${HAT[(id - 16) % 4]}`;
  }
  return `Button ${id - 32 + 1}`;
}

const DeviceSchemaKeys = {
  productGuid: 'product guid',
  productName: 'product name',
  type: 'Type',
  ffb: 'Force Feedback',
  options: 'options',
} as const;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function format(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  return String(value);
}

export interface LmuFiles {
  player: string;
  directInput?: Json;
  controls?: Json;
  problems: string[];
}

async function readJson(ctx: RacingContext, file: string): Promise<Result<Json | undefined>> {
  if (!(await ctx.ports.files.exists(file))) return ok(undefined);
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) return text;
  try {
    const value: unknown = JSON.parse(text.value);
    return isObject(value)
      ? ok(value)
      : err('lmu.json', `${path.basename(file)} is not a JSON object.`);
  } catch (e) {
    return err('lmu.json', `${path.basename(file)} is not valid JSON.`, String(e));
  }
}

export async function readLmuFiles(ctx: RacingContext): Promise<LmuFiles | undefined> {
  const player = await locationOf(ctx, 'lmu', 'player');
  if (!player) return undefined;
  const files: LmuFiles = { player, problems: [] };
  const di = await readJson(ctx, path.join(player, 'direct input.json'));
  if (di.ok) {
    if (di.value) files.directInput = di.value;
  } else files.problems.push(di.error.message);
  const controls = await readJson(ctx, path.join(player, 'current controls.json'));
  if (controls.ok) {
    if (controls.value) files.controls = controls.value;
  } else files.problems.push(controls.error.message);
  return files;
}

function deviceState(
  ids: { vendorId: string; productId: string } | undefined,
  live: InputDevice[] | undefined
): LmuDeviceView['state'] {
  if (!live || !ids) return 'unknown';
  if (live.some((d) => d.vendorId === ids.vendorId && d.productId === ids.productId))
    return 'connected';
  const fanatecBase = ids.vendorId === FANATEC_VENDOR && FANATEC_PRODUCTS[ids.productId]?.base;
  if (
    fanatecBase &&
    live.some((d) => d.vendorId === FANATEC_VENDOR && d.productId === COMPATIBILITY_PID)
  ) {
    return 'other-mode';
  }
  return 'missing';
}

export async function lmuView(ctx: RacingContext): Promise<LmuView> {
  const install = await installOf(ctx, 'lmu');
  const app = await readSteamApp(ctx.ports, '2399420');
  const view: LmuView = {
    installed: install !== undefined,
    running: await isRunning(ctx, racingGame('lmu').processes),
    updatePending: app.ok && app.value ? app.value.updatePending : false,
    problems: [],
    devices: [],
    bindings: [],
    steering: [],
  };
  const files = await readLmuFiles(ctx);
  if (!files) return view;
  view.userFolder = files.player;
  view.problems = files.problems;
  const di = files.directInput;
  if (!di) return view;
  const live = await liveControllers(ctx);
  const devices = isObject(di['Devices']) ? di['Devices'] : {};
  for (const [key, raw] of Object.entries(devices)) {
    if (!isObject(raw)) continue;
    const productGuid =
      typeof raw[DeviceSchemaKeys.productGuid] === 'string'
        ? cleanGuid(raw[DeviceSchemaKeys.productGuid] as string)
        : '';
    const ids = vidPidFromProductGuid(productGuid);
    const ffbRaw = raw[DeviceSchemaKeys.ffb];
    const optionsRaw = raw[DeviceSchemaKeys.options];
    const ffb: Json = isObject(ffbRaw) ? ffbRaw : {};
    const options: Json = isObject(optionsRaw) ? optionsRaw : {};
    view.devices.push({
      key,
      name:
        typeof raw[DeviceSchemaKeys.productName] === 'string'
          ? (raw[DeviceSchemaKeys.productName] as string)
          : key.split(':')[0]!,
      ...(ids ? { vendorId: ids.vendorId, productId: ids.productId } : {}),
      type:
        typeof raw[DeviceSchemaKeys.type] === 'string'
          ? (raw[DeviceSchemaKeys.type] as string)
          : '',
      state: deviceState(ids, live),
      forceFeedback: Object.entries(ffb).map(([label, value]) => ({ label, value: format(value) })),
      options: Object.entries(options)
        .filter(([, value]) => typeof value !== 'object')
        .map(([label, value]) => ({ label, value: format(value) })),
      bindingCount: 0,
    });
  }
  for (const [slot, section] of [
    ['primary', 'Input'],
    ['alternative', 'Alternative Input'],
  ] as const) {
    const entries = isObject(di[section]) ? di[section] : {};
    for (const [action, raw] of Object.entries(entries)) {
      if (!isObject(raw) || typeof raw['device'] !== 'string' || typeof raw['id'] !== 'number')
        continue;
      const device = view.devices.find((d) => d.key === raw['device']);
      if (device) device.bindingCount++;
      view.bindings.push({
        action,
        slot,
        device: raw['device'],
        deviceName: device?.name ?? raw['device'].split(':')[0]!,
        input: lmuInputLabel(raw['id'], device?.vendorId, device?.productId),
      });
    }
  }
  // Alphabetical by action; an action's primary binding before its second one.
  view.bindings.sort((a, b) => a.action.localeCompare(b.action) || b.slot.localeCompare(a.slot));
  const controls = files.controls ?? {};
  const general = isObject(controls['General']) ? controls['General'] : controls;
  for (const key of ['Steering Wheel Range', 'Range From Vehicle', 'Use Custom Wheel']) {
    const value = findKey(general, key);
    if (value !== undefined) view.steering.push({ label: key, value: format(value) });
  }
  return view;
}

/** A key anywhere in a nested settings object (LMU groups its options by section). */
function findKey(value: unknown, key: string): unknown {
  if (!isObject(value)) return undefined;
  if (key in value) return value[key];
  for (const child of Object.values(value)) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}
