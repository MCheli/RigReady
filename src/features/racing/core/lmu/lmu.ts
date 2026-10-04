import path from 'node:path';
import { changePreview } from '../../../../core/files/preview';
import { err, ok, type Result } from '../../../../core/result';
import { readSteamApp } from '../../../../core/steam';
import type { ChangePreview } from '../../../../shared/changePreview';
import type { InputDevice } from '../../../../shared/models';
import type { LmuDeviceView, LmuView } from '../../contract';
import {
  cleanGuid,
  installOf,
  isRunning,
  liveControllers,
  locationOf,
  racingGame,
  refuseWhileRunning,
  type RacingContext,
} from '../context';
import {
  axisName,
  COMPATIBILITY_PID,
  FANATEC_PRODUCTS,
  FANATEC_VENDOR,
  vidPidFromProductGuid,
} from '../devices';
import { planLmuRename, type LmuRenamePlan } from './rename';

/**
 * Le Mans Ultimate's bindings, UserData\player\direct input.json. Action names are plain
 * English; "id" encodes the input: 0-15 axis halves, 16-31 POV hats, 32+ buttons.
 * Devices are keyed by "<product name>:<instance name>-<16 hex>"; how the suffix is made
 * is unknown, so RigReady never makes one up. What it can repair is the name in front of it,
 * when Windows renamed a controller (rename.ts, docs/research/racing.md 3.3).
 */

const DIRECT_INPUT = 'direct input.json';

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
  /** direct input.json exactly as it is on disk; a repair changes this text, not the data. */
  directInputText?: string;
  controls?: Json;
  problems: string[];
}

async function readJson(
  ctx: RacingContext,
  file: string
): Promise<Result<{ value: Json; text: string } | undefined>> {
  if (!(await ctx.ports.files.exists(file))) return ok(undefined);
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) return text;
  try {
    const value: unknown = JSON.parse(text.value);
    return isObject(value)
      ? ok({ value, text: text.value })
      : err('lmu.json', `${path.basename(file)} is not a JSON object.`);
  } catch (e) {
    return err('lmu.json', `${path.basename(file)} is not valid JSON.`, String(e));
  }
}

export async function readLmuFiles(ctx: RacingContext): Promise<LmuFiles | undefined> {
  const player = await locationOf(ctx, 'lmu', 'player');
  if (!player) return undefined;
  const files: LmuFiles = { player, problems: [] };
  const di = await readJson(ctx, path.join(player, DIRECT_INPUT));
  if (di.ok) {
    if (di.value) {
      files.directInput = di.value.value;
      files.directInputText = di.value.text;
    }
  } else files.problems.push(di.error.message);
  const controls = await readJson(ctx, path.join(player, 'current controls.json'));
  if (controls.ok) {
    if (controls.value) files.controls = controls.value.value;
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
  const plan = live ? planLmuRename(files.directInputText ?? '', di, live) : undefined;
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
    const rename = plan?.renames.find((r) => r.oldKey === key);
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
      state: rename ? 'renamed' : deviceState(ids, live),
      ...(rename
        ? { rename: { name: rename.newName, exact: rename.existing, bindings: rename.bindings } }
        : {}),
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

interface RepairPlan extends LmuRenamePlan {
  file: string;
}

/** The repaired direct input.json, or why there is none. Reads only. */
async function planRepair(ctx: RacingContext): Promise<Result<RepairPlan>> {
  const files = await readLmuFiles(ctx);
  if (!files) return err('racing.repair', 'The Le Mans Ultimate player folder was not found.');
  if (!files.directInput || files.directInputText === undefined) {
    return err(
      'racing.repair',
      files.problems[0] ?? 'Le Mans Ultimate has no bindings file (direct input.json) yet.'
    );
  }
  const live = await liveControllers(ctx);
  if (!live) return err('racing.repair', 'The connected controllers cannot be read right now.');
  const plan = planLmuRename(files.directInputText, files.directInput, live);
  if (!plan) {
    return err('racing.repair', 'No controller in the Le Mans Ultimate bindings needs a new name.');
  }
  return ok({ ...plan, file: path.join(files.player, DIRECT_INPUT) });
}

/** What the repair would change in direct input.json. Nothing is written. */
export async function previewRepairLmu(ctx: RacingContext): Promise<Result<ChangePreview>> {
  const plan = await planRepair(ctx);
  if (!plan.ok) return plan;
  return changePreview(ctx.ports.files, [{ path: plan.value.file, content: plan.value.text }]);
}

/**
 * Puts the name Windows now gives a controller into direct input.json, so the bindings made
 * under its old name reach it again. One journaled action: the file is backed up first and
 * read back after. Refused while the game runs (it rewrites the file on start and exit).
 */
export async function repairLmu(
  ctx: RacingContext
): Promise<Result<{ message: string; file: string }>> {
  const blocked = await refuseWhileRunning(ctx, 'lmu');
  if (!blocked.ok) return blocked;
  const plan = await planRepair(ctx);
  if (!plan.ok) return plan;
  const { file, text, renames, bindings } = plan.value;
  const names = [...new Set(renames.map((r) => r.newName))].join(', ');
  const group = ctx.ports.files.beginGroup(`Point Le Mans Ultimate at the new name of ${names}`);
  const written = await ctx.ports.files.write(file, text, {
    reason: `Update the controller name in ${DIRECT_INPUT}`,
    group,
  });
  if (!written.ok) return written;
  // Read back: only report what is really on disk.
  const back = await ctx.ports.files.readText(file);
  if (!back.ok) return back;
  if (back.value !== text) {
    return err('racing.repair', `${DIRECT_INPUT} did not keep the change.`);
  }
  const what = bindings === 1 ? '1 binding' : `${bindings} bindings`;
  return ok({
    message: `Pointed ${what} at ${names}. Start Le Mans Ultimate once and check they are still there. Undo is on the Safety page.`,
    file,
  });
}
