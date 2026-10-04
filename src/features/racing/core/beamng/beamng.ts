import path from 'node:path';
import { changePreview, previewWrites, type PlannedWrite } from '../../../../core/files/preview';
import { err, ok, type Result } from '../../../../core/result';
import { productGuidFor } from '../../../../core/directInput';
import type { ChangePreview } from '../../../../shared/changePreview';
import type { InputDevice } from '../../../../shared/models';
import type { BeamngMapView, BeamngView, WritePreviewView } from '../../contract';
import {
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
  vidPidFromBeamng,
} from '../devices';
import { BEAMNG_ACTION_LABELS } from './actionLabels';

/**
 * BeamNG.drive bindings: settings\inputmaps\<pidvid>.diff in the user folder (and
 * <vehicle>\<pidvid>.diff for per-vehicle maps), each a diff against the game's factory
 * map <game>\settings\inputmaps\<pidvid>.json. Keyed by VID/PID only, so nothing needs
 * repairing after a USB port change. Force feedback lives in the steering binding.
 * See docs/research/racing.md section 4.3.
 */

interface RawBinding {
  action?: unknown;
  control?: unknown;
  [key: string]: unknown;
}

interface RawMap {
  bindings?: RawBinding[];
  removed?: RawBinding[];
  name?: string;
  vidpid?: string;
  devicetype?: string;
  guid?: string;
  [key: string]: unknown;
}

/** JSON, or JSON with comments and trailing commas (BeamNG's relaxed files). */
export function parseRelaxedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (inString) {
        out += c;
        if (c === '\\') out += text[++i] ?? '';
        else if (c === '"') inString = false;
      } else if (c === '"') {
        inString = true;
        out += c;
      } else if (c === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++;
        out += '\n';
      } else if (c === '/' && text[i + 1] === '*') {
        i = text.indexOf('*/', i + 2);
        if (i < 0) break;
        i++;
      } else out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  }
}

export function beamngActionLabel(action: string): string {
  const label = BEAMNG_ACTION_LABELS[action];
  if (label) return label;
  const text = action
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const AXIS_CONTROLS: Record<string, string> = {
  xaxis: 'X',
  yaxis: 'Y',
  zaxis: 'Z',
  rxaxis: 'RX',
  ryaxis: 'RY',
  rzaxis: 'RZ',
  slider: 'S0',
  slider2: 'S1',
};
const POV: Record<string, string> = {
  upov: 'D-pad up',
  dpov: 'D-pad down',
  lpov: 'D-pad left',
  rpov: 'D-pad right',
};

export function beamngControlLabel(control: string, vendorId?: string, productId?: string): string {
  const axis = AXIS_CONTROLS[control];
  if (axis) return axisName(axis, vendorId, productId);
  const button = /^button(\d+)$/.exec(control);
  if (button) return `Button ${Number(button[1]) + 1}`;
  if (POV[control]) return POV[control];
  // Keyboard and mouse controls are already words: "space", "lshift", "a".
  return control.length === 1
    ? control.toUpperCase()
    : control.charAt(0).toUpperCase() + control.slice(1);
}

const FFB_LABELS: Record<string, string> = {
  forceCoef: 'Strength',
  smoothing: 'Smoothing',
  smoothing2: 'High-speed smoothing',
  smoothing2automatic: 'High-speed smoothing is automatic',
  softlockForce: 'Soft-lock force',
  gforceCoef: 'Side-acceleration feel',
  frequency: 'Update rate (0 = automatic)',
  lowspeedCoef: 'Reduce strength at low speed',
  responseCorrected: 'Response correction',
  isVibrationEnabled: 'Vibration',
  enableBrakeForceFeedback: 'Brake force feedback',
  enableThrottleForceFeedback: 'Throttle force feedback',
  updateType: 'Update type',
};

function format(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  return JSON.stringify(value);
}

function bindingDetail(b: RawBinding): string {
  const parts: string[] = [];
  if (b['isInverted'] === true) parts.push('inverted');
  if (typeof b['deadzoneResting'] === 'number' && b['deadzoneResting'] > 0) {
    parts.push(`dead zone ${Math.round(b['deadzoneResting'] * 100)}%`);
  }
  if (typeof b['angle'] === 'number') parts.push(`${b['angle']}° rotation`);
  return parts.join(', ');
}

const keyOf = (b: RawBinding): string => `${String(b.action)}|${String(b.control)}`;

async function readMap(ctx: RacingContext, file: string): Promise<Result<RawMap>> {
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) return text;
  try {
    const value = parseRelaxedJson(text.value);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return err('beamng.map', `${path.basename(file)} is not a binding map.`);
    }
    return ok(value as RawMap);
  } catch (e) {
    return err('beamng.map', `${path.basename(file)} is not valid JSON.`, String(e));
  }
}

function deviceState(
  map: RawMap,
  ids: { vendorId: string; productId: string } | undefined,
  live: InputDevice[] | undefined
): BeamngMapView['state'] {
  if (map.devicetype && map.devicetype !== 'joystick') return 'keyboard';
  if (!ids || !live) return 'unknown';
  if (live.some((d) => d.vendorId === ids.vendorId && d.productId === ids.productId))
    return 'connected';
  const base = ids.vendorId === FANATEC_VENDOR && FANATEC_PRODUCTS[ids.productId]?.base;
  if (
    base &&
    live.some((d) => d.vendorId === FANATEC_VENDOR && d.productId === COMPATIBILITY_PID)
  ) {
    return 'other-mode';
  }
  return 'missing';
}

async function inputmapsOf(ctx: RacingContext): Promise<string | undefined> {
  const user = await locationOf(ctx, 'beamng', 'user');
  return user ? path.join(user, 'settings', 'inputmaps') : undefined;
}

export async function beamngView(ctx: RacingContext): Promise<BeamngView> {
  const install = await installOf(ctx, 'beamng');
  const view: BeamngView = {
    installed: install !== undefined,
    running: await isRunning(ctx, racingGame('beamng').processes),
    problems: [],
    maps: [],
    older: [],
  };
  const module = ctx.games.get('beamng');
  const locations = module ? await module.configLocations(ctx) : undefined;
  for (const location of locations?.ok ? locations.value : []) {
    if (location.id === 'user') view.userFolder = location.path;
    const legacy = /^legacy-(.+)$/.exec(location.id);
    if (legacy) {
      const maps = await ctx.ports.files.listTree(
        path.join(location.path, 'settings', 'inputmaps'),
        {
          include: ['*.diff'],
        }
      );
      view.older.push({
        version: legacy[1]!,
        path: location.path,
        bindingFiles: maps.ok ? maps.value.length : 0,
      });
    }
  }
  const dir = await inputmapsOf(ctx);
  if (!dir) return view;
  const files = await ctx.ports.files.listTree(dir, { include: ['*.diff'], maxEntries: 2000 });
  if (!files.ok) {
    view.problems.push(files.error.message);
    return view;
  }
  const live = await liveControllers(ctx);
  for (const entry of files.value.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    const map = await readMap(ctx, entry.path);
    if (!map.ok) {
      view.problems.push(map.error.message);
      continue;
    }
    const stem = path.basename(entry.name, '.diff');
    const vidpid = (map.value.vidpid ?? stem).toLowerCase();
    const ids = vidPidFromBeamng(vidpid);
    const parts = entry.relativePath.split('/');
    const vehicle = parts.length > 1 ? parts.slice(0, -1).join('/') : undefined;
    let factory: RawMap | undefined;
    // A per-vehicle map is a diff against that vehicle's own defaults (inside the vehicle's
    // archive), not the general map, so only top-level maps are merged.
    if (install && !vehicle) {
      const file = path.join(install.installDir, 'settings', 'inputmaps', `${vidpid}.json`);
      if (await ctx.ports.files.exists(file)) {
        const parsed = await readMap(ctx, file);
        if (parsed.ok) factory = parsed.value;
      }
    }
    const removed = new Set((map.value.removed ?? []).map(keyOf));
    const own = map.value.bindings ?? [];
    const ownKeys = new Set(own.map(keyOf));
    const effective: { binding: RawBinding; yours: boolean }[] = [
      ...(factory?.bindings ?? [])
        .filter((b) => !removed.has(keyOf(b)) && !ownKeys.has(keyOf(b)))
        .map((binding) => ({ binding, yours: false })),
      ...own.map((binding) => ({ binding, yours: true })),
    ];
    const steering =
      own.find((b) => b.action === 'steering') ??
      factory?.bindings?.find((b) => b.action === 'steering');
    const ffb =
      steering && typeof steering['ffb'] === 'object' && steering['ffb'] !== null
        ? (steering['ffb'] as Record<string, unknown>)
        : undefined;
    view.maps.push({
      file: entry.relativePath,
      ...(vehicle ? { vehicle } : {}),
      name: map.value.name ?? (ids ? `Controller ${ids.vendorId}:${ids.productId}` : stem),
      vidpid,
      ...(ids ? { vendorId: ids.vendorId, productId: ids.productId } : {}),
      state: deviceState(map.value, ids, live),
      factoryLoaded: factory !== undefined,
      bindings: effective
        .filter(
          ({ binding }) => typeof binding.action === 'string' && typeof binding.control === 'string'
        )
        .map(({ binding, yours }) => ({
          action: binding.action as string,
          label: beamngActionLabel(binding.action as string),
          input: beamngControlLabel(binding.control as string, ids?.vendorId, ids?.productId),
          detail: bindingDetail(binding),
          yours,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      removed: (map.value.removed ?? [])
        .filter((b) => typeof b.action === 'string' && typeof b.control === 'string')
        .map((b) => ({
          action: b.action as string,
          label: beamngActionLabel(b.action as string),
          input: beamngControlLabel(b.control as string, ids?.vendorId, ids?.productId),
        })),
      forceFeedback: steering
        ? [
            ...(typeof steering['angle'] === 'number'
              ? [{ label: 'Steering rotation (degrees)', value: String(steering['angle']) }]
              : []),
            ...(typeof steering['isForceEnabled'] === 'boolean'
              ? [{ label: 'Force feedback', value: format(steering['isForceEnabled']) }]
              : []),
            ...(typeof steering['isForceInverted'] === 'boolean'
              ? [{ label: 'Inverted', value: format(steering['isForceInverted']) }]
              : []),
            ...Object.entries(ffb ?? {})
              .filter(([key]) => FFB_LABELS[key])
              .map(([key, value]) => ({ label: FFB_LABELS[key]!, value: format(value) })),
          ]
        : [],
      targets:
        deviceState(map.value, ids, live) === 'missing'
          ? (live ?? [])
              .filter((d) => d.vendorId && d.productId)
              .map((d) => ({
                vidpid: `${d.productId}${d.vendorId}`.toLowerCase(),
                name: d.name.trim(),
              }))
              .filter((t, i, all) => all.findIndex((o) => o.vidpid === t.vidpid) === i)
              // A controller with bindings of its own in the same folder is not offered.
              .filter(
                (t) =>
                  !files.value.some(
                    (f) =>
                      f.relativePath.toLowerCase() ===
                      [...parts.slice(0, -1), `${t.vidpid}.diff`].join('/')
                  )
              )
          : [],
    });
  }
  return view;
}

/** Which binding files copying an older user folder's bindings would create and replace. Reads only. */
export async function previewCopyOlderBindings(
  ctx: RacingContext,
  version: string
): Promise<Result<WritePreviewView>> {
  const target = await inputmapsOf(ctx);
  if (!target) return err('beamng.copy', 'The current BeamNG.drive user folder was not found.');
  const source = await locationOf(ctx, 'beamng', `legacy-${version}`);
  if (!source) return err('beamng.copy', `There is no user folder of version ${version}.`);
  const tree = await ctx.ports.files.listTree(path.join(source, 'settings', 'inputmaps'), {
    include: ['*.diff'],
  });
  if (!tree.ok) return tree;
  const planned: PlannedWrite[] = [];
  for (const entry of tree.value) {
    const bytes = await ctx.ports.files.readBytes(entry.path);
    if (!bytes.ok) return bytes;
    planned.push({
      path: path.join(target, ...entry.relativePath.split('/')),
      content: bytes.value,
    });
  }
  const preview = await previewWrites(ctx.ports.files, planned);
  if (!preview.ok) return preview;
  return ok({
    summary: preview.value.summary,
    files: preview.value.entries.map((entry, index) => ({
      path: entry.path,
      label: tree.value[index]!.relativePath,
      change: entry.change,
      detail: entry.summary,
    })),
  });
}

/** Copies the binding files of an older user folder into the current one ("restore 0.31 bindings into 0.32"). */
export async function copyOlderBindings(
  ctx: RacingContext,
  version: string
): Promise<Result<{ message: string }>> {
  const blocked = await refuseWhileRunning(ctx, 'beamng');
  if (!blocked.ok) return blocked;
  const target = await inputmapsOf(ctx);
  if (!target) return err('beamng.copy', 'The current BeamNG.drive user folder was not found.');
  const source = await locationOf(ctx, 'beamng', `legacy-${version}`);
  if (!source) return err('beamng.copy', `There is no user folder of version ${version}.`);
  const copied = await ctx.ports.files.copyTree(
    path.join(source, 'settings', 'inputmaps'),
    target,
    {
      reason: `Copy BeamNG.drive ${version} bindings into the current user folder`,
      include: ['*.diff'],
    }
  );
  if (!copied.ok) return copied;
  const n = copied.value.files.length;
  if (n === 0) return err('beamng.copy', `The ${version} user folder has no binding files.`);
  return ok({
    message: `Copied ${n} binding ${n === 1 ? 'file' : 'files'} from ${version}. Undo is on the Safety page.`,
  });
}

/**
 * Gives a new controller the bindings of one that is no longer connected (a replaced
 * wheel base): writes <new pidvid>.diff with the same bindings. Refuses when the new
 * controller already has bindings of its own.
 */
async function planCopyToController(
  ctx: RacingContext,
  file: string,
  toVidpid: string
): Promise<Result<{ destination: string; content: string; targetName: string; mapName: string }>> {
  const dir = await inputmapsOf(ctx);
  if (!dir) return err('beamng.copy', 'The BeamNG.drive user folder was not found.');
  const view = await beamngView(ctx);
  const map = view.maps.find((m) => m.file === file);
  if (!map) return err('beamng.copy', `There is no binding file ${file}.`);
  const target = map.targets.find((t) => t.vidpid === toVidpid.toLowerCase());
  if (!target) return err('beamng.copy', 'Choose a controller that is connected now.');
  const ids = vidPidFromBeamng(target.vidpid)!;
  const source = path.join(dir, ...file.split('/'));
  const destination = path.join(path.dirname(source), `${target.vidpid}.diff`);
  if (await ctx.ports.files.exists(destination)) {
    return err(
      'beamng.copy',
      `${target.name} already has bindings of its own; RigReady does not overwrite them.`
    );
  }
  const raw = await readMap(ctx, source);
  if (!raw.ok) return raw;
  const copy: RawMap = {
    ...raw.value,
    name: target.name,
    vidpid: `${ids.productId}${ids.vendorId}`,
    guid: `{${productGuidFor(ids.vendorId, ids.productId)}}`,
  };
  return ok({
    destination,
    content: JSON.stringify(copy, null, 2) + '\n',
    targetName: target.name,
    mapName: map.name,
  });
}

/** The binding file that copy would create. Nothing is written. */
export async function previewCopyBindingsToController(
  ctx: RacingContext,
  file: string,
  toVidpid: string
): Promise<Result<ChangePreview>> {
  const plan = await planCopyToController(ctx, file, toVidpid);
  if (!plan.ok) return plan;
  return changePreview(ctx.ports.files, [
    { path: plan.value.destination, content: plan.value.content },
  ]);
}

export async function copyBindingsToController(
  ctx: RacingContext,
  file: string,
  toVidpid: string
): Promise<Result<{ message: string }>> {
  const blocked = await refuseWhileRunning(ctx, 'beamng');
  if (!blocked.ok) return blocked;
  const plan = await planCopyToController(ctx, file, toVidpid);
  if (!plan.ok) return plan;
  const { destination, content, targetName, mapName } = plan.value;
  const written = await ctx.ports.files.write(destination, content, {
    reason: `Give ${targetName} the BeamNG.drive bindings of ${mapName}`,
  });
  if (!written.ok) return written;
  return ok({
    message: `${targetName} now has the bindings of ${mapName}. Check them in the game: button numbers can differ between controllers.`,
  });
}
