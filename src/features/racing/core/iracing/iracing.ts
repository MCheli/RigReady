import path from 'node:path';
import { changePreview } from '../../../../core/files/preview';
import { err, ok, type Result } from '../../../../core/result';
import type { ChangePreview } from '../../../../shared/changePreview';
import type { InputDevice } from '../../../../shared/models';
import type { IracingDeviceView, IracingView } from '../../contract';
import {
  cleanGuid,
  installOf,
  isRunning,
  liveControllers,
  locationOf,
  refuseWhileRunning,
  type RacingContext,
} from '../context';
import { vidPidFromProductGuid } from '../devices';
import {
  devicesInControls,
  parseControlsCfg,
  replaceGuidBytes,
  type ControlsCfg,
} from './controlsCfg';
import { parseJoyCalib, replaceGuidText, type CalibratedDevice } from './joyCalib';
import { iracingActionGroup, iracingActionLabel, iracingKeyLabel } from './labels';

/** iRacing's bindings, calibration and device ids, as a page shows them. docs/research/racing.md 2.3-2.5. */

export const SIM_EXE = 'iRacingSim64DX11.exe';

interface IracingFiles {
  folder: string;
  controls?: ControlsCfg;
  calibration?: CalibratedDevice[];
  problems: string[];
}

async function readFiles(ctx: RacingContext): Promise<IracingFiles | undefined> {
  const folder = await locationOf(ctx, 'iracing', 'documents');
  if (!folder) return undefined;
  const problems: string[] = [];
  const result: IracingFiles = { folder, problems };
  const cfg = path.join(folder, 'controls.cfg');
  if (await ctx.ports.files.exists(cfg)) {
    const bytes = await ctx.ports.files.readBytes(cfg);
    const parsed = bytes.ok ? parseControlsCfg(bytes.value) : bytes;
    if (parsed.ok) result.controls = parsed.value;
    else problems.push(parsed.error.message);
  }
  const calib = path.join(folder, 'joyCalib.yaml');
  if (await ctx.ports.files.exists(calib)) {
    const text = await ctx.ports.files.readText(calib);
    const parsed = text.ok ? parseJoyCalib(text.value) : text;
    if (parsed.ok) result.calibration = parsed.value;
    else problems.push(parsed.error.message);
  }
  return result;
}

/** The DirectInput collection number in an instance GUID: 20B0BED0-03A4-11F1-8001-... -> "8001". */
const collection = (guid: string): string => cleanGuid(guid).split('-')[3] ?? '';

/**
 * Which connected controller an old id most likely became. Only an unambiguous match is
 * suggested: exactly one controller of the same model, or exactly one whose collection
 * number matches (a wheel base that shows up as two same-named controllers). Otherwise
 * the user chooses.
 */
export function suggestTarget(oldGuid: string, candidates: InputDevice[]): string | undefined {
  if (candidates.length === 1) return candidates[0]!.guid;
  const same = candidates.filter((c) => collection(c.guid) === collection(oldGuid));
  return same.length === 1 ? same[0]!.guid : undefined;
}

function deviceViews(files: IracingFiles, live: InputDevice[] | undefined): IracingDeviceView[] {
  const fromControls = files.controls ? devicesInControls(files.controls) : [];
  const keys = new Map<string, { instanceGuid: string; productGuid: string; name?: string }>();
  for (const d of files.calibration ?? []) {
    keys.set(d.instanceGuid, {
      instanceGuid: d.instanceGuid,
      productGuid: d.productGuid,
      name: d.name,
    });
  }
  for (const d of fromControls) {
    if (!keys.has(d.instanceGuid)) keys.set(d.instanceGuid, { ...d });
  }
  const views: IracingDeviceView[] = [];
  for (const { instanceGuid, productGuid, name } of keys.values()) {
    const calib = files.calibration?.find((c) => c.instanceGuid === instanceGuid);
    const ids = vidPidFromProductGuid(productGuid);
    const sameModel = (live ?? []).filter((d) => cleanGuid(d.productGuid) === productGuid);
    const connected = (live ?? []).some((d) => cleanGuid(d.guid) === instanceGuid);
    const state: IracingDeviceView['state'] =
      live === undefined
        ? 'unknown'
        : connected
          ? 'connected'
          : sameModel.length > 0
            ? 'moved'
            : 'missing';
    const suggested = state === 'moved' ? suggestTarget(instanceGuid, sameModel) : undefined;
    views.push({
      key: instanceGuid,
      name:
        name ??
        sameModel[0]?.name ??
        (ids ? `Controller ${ids.vendorId}:${ids.productId}` : 'Unknown controller'),
      instanceGuid,
      productGuid,
      ...(ids ? { vendorId: ids.vendorId, productId: ids.productId } : {}),
      state,
      calibrated: calib !== undefined,
      axes: (calib?.axes ?? []).map((a) => ({
        axis: a.axis,
        name: a.name || `Axis ${a.axis}`,
        range:
          a.min !== undefined && a.max !== undefined
            ? `${a.min}–${a.max}${a.center !== undefined ? `, centre ${a.center}` : ''}`
            : '',
      })),
      bindingCount: fromControls.find((d) => d.instanceGuid === instanceGuid)?.actions.length ?? 0,
      candidates:
        state === 'moved'
          ? sameModel.map((d) => ({
              guid: cleanGuid(d.guid),
              label: `${d.name.trim()} · ${d.numButtons} buttons · id ${cleanGuid(d.guid).slice(0, 8)}…${cleanGuid(d.guid).slice(19, 23)}`,
            }))
          : [],
      ...(suggested ? { suggested: cleanGuid(suggested) } : {}),
    });
  }
  return views;
}

export async function iracingView(ctx: RacingContext): Promise<IracingView> {
  const install = await installOf(ctx, 'iracing');
  const files = await readFiles(ctx);
  const live = await liveControllers(ctx);
  const view: IracingView = {
    installed: install !== undefined,
    running: await isRunning(ctx, [SIM_EXE, 'iRacingUI.exe']),
    simRunning: await isRunning(ctx, [SIM_EXE]),
    controlsFound: files?.controls !== undefined,
    calibrationFound: files?.calibration !== undefined,
    problems: files?.problems ?? [],
    devices: [],
    bindings: [],
    unboundCount: 0,
    customCars: [],
    forceFeedback: [],
  };
  if (!files) return view;
  view.userFolder = files.folder;
  view.devices = deviceViews(files, live);
  const nameOf = new Map(view.devices.map((d) => [d.key, d.name]));
  for (const record of files.controls?.records ?? []) {
    const b = record.binding;
    if (b.kind === 'none') {
      view.unboundCount++;
      continue;
    }
    const base = {
      action: record.action,
      label: iracingActionLabel(record.action),
      group: iracingActionGroup(record.action),
    };
    if (b.kind === 'key') {
      view.bindings.push({
        ...base,
        deviceName: 'Keyboard',
        input: iracingKeyLabel(b.keyCode, b.modifiers),
      });
      continue;
    }
    const device = cleanGuid(b.instanceGuid);
    const deviceName = nameOf.get(device) ?? 'Unknown controller';
    if (b.kind === 'axis') {
      const calib = files.calibration?.find((c) => c.instanceGuid === device);
      const axisName = calib?.axes.find((a) => a.axis === b.axis)?.name || `Axis ${b.axis}`;
      const half = /^Steer(Left|Right)$/.test(record.action)
        ? b.direction === 1
          ? ', turning right'
          : ', turning left'
        : '';
      view.bindings.push({ ...base, device, deviceName, input: `${axisName}${half}` });
    } else {
      const input = b.buttons.length
        ? b.buttons.map((n) => `Button ${n + 1}`).join(' + ')
        : 'Button';
      view.bindings.push({ ...base, device, deviceName, input });
    }
  }
  const cars = await ctx.ports.files.list(path.join(files.folder, 'setups'));
  for (const car of cars.ok ? cars.value : []) {
    if (await ctx.ports.files.exists(path.join(files.folder, 'setups', car, 'controls.cfg'))) {
      view.customCars.push(car);
    }
  }
  view.forceFeedback = await forceFeedbackSettings(ctx, files.folder);
  return view;
}

/** app.ini [Force Feedback]: key=value padded, then TAB ; comment. Read only. */
export async function forceFeedbackSettings(
  ctx: RacingContext,
  folder: string
): Promise<{ key: string; value: string; note: string }[]> {
  const file = path.join(folder, 'app.ini');
  if (!(await ctx.ports.files.exists(file))) return [];
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) return [];
  const out: { key: string; value: string; note: string }[] = [];
  let inSection = false;
  for (const line of text.value.split(/\r?\n/)) {
    const section = /^\s*\[(.+)\]\s*$/.exec(line);
    if (section) {
      inSection = section[1] === 'Force Feedback';
      continue;
    }
    if (!inSection) continue;
    const match = /^\s*([^=;\s]+)\s*=\s*([^\t;]*?)\s*(?:\t?;\s*(.*))?$/.exec(line);
    if (match) out.push({ key: match[1]!, value: match[2]!, note: (match[3] ?? '').trim() });
  }
  return out;
}

export interface GuidMapping {
  from: string;
  to: string;
}

interface RepairPlan {
  folder: string;
  planned: { file: string; content: Uint8Array | string }[];
  /** Bindings in the main controls.cfg that get the new id. */
  bindings: number;
  names: string[];
}

/** The files a repair would rewrite and their new content. Reads only. */
async function planRepair(ctx: RacingContext, mapping: GuidMapping[]): Promise<Result<RepairPlan>> {
  if (mapping.length === 0)
    return err('racing.repair', 'Choose at least one controller to update.');
  const files = await readFiles(ctx);
  if (!files) return err('racing.repair', 'The iRacing folder in Documents was not found.');
  const live = await liveControllers(ctx);
  if (!live) return err('racing.repair', 'The connected controllers cannot be read right now.');
  const devices = deviceViews(files, live);
  for (const m of mapping) {
    const from = devices.find((d) => d.key === cleanGuid(m.from));
    if (!from) return err('racing.repair', `iRacing has no controller with the id ${m.from}.`);
    if (from.state !== 'moved') {
      return err('racing.repair', `${from.name} does not need to be updated.`);
    }
    if (!from.candidates.some((c) => c.guid === cleanGuid(m.to))) {
      return err('racing.repair', `The chosen controller is not a connected ${from.name}.`);
    }
  }

  const targets = [
    path.join(files.folder, 'controls.cfg'),
    path.join(files.folder, 'joyCalib.yaml'),
  ];
  const cars = await ctx.ports.files.list(path.join(files.folder, 'setups'));
  for (const car of cars.ok ? cars.value : []) {
    targets.push(
      path.join(files.folder, 'setups', car, 'controls.cfg'),
      path.join(files.folder, 'setups', car, 'joyCalib.yaml')
    );
  }
  const planned: { file: string; content: Uint8Array | string }[] = [];
  let bindings = 0;
  for (const file of targets) {
    if (!(await ctx.ports.files.exists(file))) continue;
    if (file.endsWith('.cfg')) {
      const bytes = await ctx.ports.files.readBytes(file);
      if (!bytes.ok) return bytes;
      let current = bytes.value;
      let changed = 0;
      for (const m of mapping) {
        const replaced = replaceGuidBytes(current, m.from, m.to);
        current = replaced.bytes;
        changed += replaced.count;
      }
      if (changed > 0) {
        planned.push({ file, content: current });
        if (file === targets[0]) bindings = changed;
      }
    } else {
      const text = await ctx.ports.files.readText(file);
      if (!text.ok) return text;
      let current = text.value;
      let changed = 0;
      for (const m of mapping) {
        const replaced = replaceGuidText(current, m.from, m.to);
        current = replaced.text;
        changed += replaced.count;
      }
      if (changed > 0) planned.push({ file, content: current });
    }
  }
  if (planned.length === 0)
    return err('racing.repair', 'Nothing in the iRacing files refers to that id.');

  const names = mapping.map((m) => devices.find((d) => d.key === cleanGuid(m.from))!.name);
  return ok({ folder: files.folder, planned, bindings, names });
}

/** Which iRacing files the repair would change and how. Nothing is written. */
export async function previewRepairIracing(
  ctx: RacingContext,
  mapping: GuidMapping[]
): Promise<Result<ChangePreview>> {
  const plan = await planRepair(ctx, mapping);
  if (!plan.ok) return plan;
  return changePreview(
    ctx.ports.files,
    plan.value.planned.map((p) => ({ path: p.file, content: p.content })),
    (write) => path.relative(plan.value.folder, write.path).replace(/\\/g, '/')
  );
}

/**
 * Points iRacing at a controller's new Windows id: replaces the old instance GUID with the
 * new one in controls.cfg (16 bytes, in place) and joyCalib.yaml (text), and in any car's
 * custom controls. One journaled action; every file is backed up first and read back after.
 */
export async function repairIracing(
  ctx: RacingContext,
  mapping: GuidMapping[]
): Promise<Result<{ message: string; files: string[] }>> {
  const blocked = await refuseWhileRunning(ctx, 'iracing');
  if (!blocked.ok) return blocked;
  const plan = await planRepair(ctx, mapping);
  if (!plan.ok) return plan;
  const { planned, bindings, names } = plan.value;
  const group = ctx.ports.files.beginGroup(
    `Point iRacing at the new Windows id of ${names.join(', ')}`
  );
  for (const { file, content } of planned) {
    const written = await ctx.ports.files.write(file, content, {
      reason: `Update the controller id in ${path.basename(file)}`,
      group,
    });
    if (!written.ok) return written;
    // Read back: only report what is really on disk.
    const back =
      typeof content === 'string'
        ? await ctx.ports.files.readText(file)
        : await ctx.ports.files.readBytes(file);
    if (!back.ok) return back;
    const same =
      typeof content === 'string'
        ? back.value === content
        : Buffer.from(back.value as Uint8Array).equals(Buffer.from(content));
    if (!same) return err('racing.repair', `${path.basename(file)} did not keep the change.`);
  }
  const what = bindings === 1 ? '1 binding' : `${bindings} bindings`;
  return ok({
    message: `Updated ${what} and the calibration of ${names.join(', ')}. Undo is on the Safety page.`,
    files: planned.map((p) => p.file),
  });
}
