import path from 'node:path';
import { sameGuid } from '../../../core/directInput';
import { sha256 } from '../../../core/files/fileStore';
import { changePreview } from '../../../core/files/preview';
import { IRACING_CALIBRATION, IRACING_CONTROLS } from '../../../core/iracingControls';
import type { DeviceNames } from '../../../core/names';
import { err, ok, type Result } from '../../../core/result';
import type { InputDevice } from '../../../shared/models';
import type {
  CopyCompare,
  CopyCompareRequest,
  CopyRequest,
  CopyResult,
  CopyReview,
  CopyRow,
} from '../contract';
import { readCalibration, type CalibratedDevice } from './calibration';
import { whyBlocked } from './change';
import {
  RECORD_BYTES,
  parseControlsFile,
  usbIdsOf,
  type ControlRecord,
  type ControlsFile,
} from './controlsFile';
import { changeBinding, KEPT_BYTES, type NewBinding } from './edit';
import { iracingActionGroup, iracingActionLabel, iracingKeyLabel } from './names';
import { profilesInUse } from './profiles';
import type { BindingsContext } from './view';

/**
 * Copying bindings from one control profile into another: the actions the user ticks, or
 * all of them. Like copying between aircraft in DCS, what would change is listed first,
 * the file is shown before it is written, and the write goes through FileStore (a backup
 * first, one entry on the Safety page).
 *
 * What is copied: a controller button or a key, and "not bound", exactly the kinds a change
 * on this page writes, with the same writer (edit.ts). Each copied record ends with the
 * same 60 bytes as the one in the profile it comes from, which iRacing itself wrote, and
 * keeps its own first two fields. No other byte of the file changes.
 *
 * What is not copied, and the review says so: an axis (in either profile) and the
 * calibration in joyCalib.yaml. iRacing calibrates an axis as it binds it, the two files
 * go together, and no file in which RigReady placed an axis record has been loaded by
 * iRacing; RigReady has no writer for joyCalib.yaml. Bind an axis in iRacing.
 */

interface Loaded {
  name: string;
  /** Which cars use the profile, in words. */
  usedBy: string;
  file: string;
  bytes: Uint8Array;
  parsed: ControlsFile;
  calibration: CalibratedDevice[];
}

async function loadProfile(ctx: BindingsContext, name: string): Promise<Result<Loaded>> {
  const inUse = await profilesInUse(ctx);
  if (!inUse) {
    return err(
      'iracing-bindings.copy.noProfiles',
      'This iRacing keeps no control profiles, so there is nothing to copy between.'
    );
  }
  // The name is looked up among the folders that are there; it never becomes a path itself.
  const profile = inUse.profiles.find((p) => p.name === name);
  if (!profile || !profile.hasControls) {
    return err(
      'iracing-bindings.copy.noProfile',
      `iRacing has no control profile “${name}” with bindings on this PC.`
    );
  }
  const file = path.join(profile.folder, IRACING_CONTROLS);
  const bytes = await ctx.ports.files.readBytes(file);
  if (!bytes.ok) {
    return err('iracing-bindings.read', `RigReady could not read ${file}.`, bytes.error.message);
  }
  const parsed = parseControlsFile(bytes.value);
  if (!parsed.ok) return parsed;
  const calibrationFile = path.join(profile.folder, IRACING_CALIBRATION);
  const text = (await ctx.ports.files.exists(calibrationFile))
    ? await ctx.ports.files.readText(calibrationFile)
    : undefined;
  return ok({
    name: profile.name,
    usedBy: profile.forAllCars
      ? `iRacing uses “${profile.name}” for all cars.`
      : profile.cars.length
        ? `“${profile.name}” is the profile of ${profile.cars.join(', ')}.`
        : `No car uses “${profile.name}” now.`,
    file,
    bytes: bytes.value,
    parsed: parsed.value,
    calibration: text?.ok ? readCalibration(text.value) : [],
  });
}

/** What a record holds, in the words the page uses ("Button 5 on Button Box", "Ctrl+R on the keyboard"). */
function words(
  record: ControlRecord | undefined,
  calibration: CalibratedDevice[],
  live: InputDevice[],
  names: DeviceNames
): string {
  const b = record?.binding;
  if (!record || !b || b.kind === 'none') return 'Not bound';
  if (b.kind === 'unknown' || !record.understood) return 'A binding RigReady cannot read';
  if (b.kind === 'key') return `${iracingKeyLabel(b.keyCode, b.modifiers)} on the keyboard`;
  const ids = usbIdsOf(b.productGuid);
  const device =
    (ids ? names.nameOf({ ...ids, guid: b.instanceGuid }) : undefined) ??
    calibration.find((c) => c.instanceGuid === b.instanceGuid)?.name ??
    live.find((d) => sameGuid(d.guid, b.instanceGuid))?.name.trim() ??
    (ids ? `Controller ${ids.vendorId}:${ids.productId}` : 'Unknown controller');
  if (b.kind === 'axis') return `An axis on ${device}`;
  const numbers = b.buttons.map((n) => n + 1);
  return numbers.length === 1
    ? `Button ${numbers[0]} on ${device}`
    : `Buttons ${numbers.join(' and ')} on ${device}`;
}

/** The binding to give the target, as the writer takes it; undefined when it is not one to copy. */
function copyable(record: ControlRecord): NewBinding | undefined {
  const b = record.binding;
  if (!record.understood) return undefined;
  if (b.kind === 'none') return null;
  if (b.kind === 'key') return { kind: 'key', keyCode: b.keyCode, modifiers: b.modifiers };
  if (b.kind === 'button' && b.buttons.length === 1) {
    return {
      kind: 'button',
      instanceGuid: b.instanceGuid,
      productGuid: b.productGuid,
      button: b.buttons[0]!,
    };
  }
  return undefined;
}

const sameData = (a: ControlRecord, b: ControlRecord): boolean =>
  a.data.subarray(KEPT_BYTES).every((value, i) => value === b.data[KEPT_BYTES + i]);

/** Why one action is left as it is in the target, when it is. */
function whyKept(
  from: ControlRecord,
  to: ControlRecord | undefined,
  toName: string
): string | undefined {
  if (!to) return `“${toName}” has no such action.`;
  if (from.binding.kind === 'axis' || to.binding.kind === 'axis') {
    return 'An axis is bound and calibrated in iRacing itself, so RigReady leaves it and its calibration as they are.';
  }
  if (!from.understood || from.binding.kind === 'unknown') {
    return 'RigReady cannot read this binding exactly, so it does not copy it.';
  }
  if (!to.understood || to.binding.kind === 'unknown') {
    return `RigReady cannot read what “${toName}” has here exactly, so it does not change it.`;
  }
  if (from.binding.kind === 'button' && from.binding.buttons.length !== 1) {
    return 'More than one button on one action has never been seen, so RigReady does not copy it.';
  }
  return undefined;
}

/**
 * Every action whose button or key differs between the two profiles, and what copying would
 * do to it. Reads only.
 */
export async function compareProfiles(
  ctx: BindingsContext,
  request: CopyCompareRequest,
  names: DeviceNames
): Promise<Result<CopyCompare>> {
  if (request.fromProfile === request.toProfile) {
    return err('iracing-bindings.copy.same', 'Choose two different profiles.');
  }
  const from = await loadProfile(ctx, request.fromProfile);
  if (!from.ok) return from;
  const to = await loadProfile(ctx, request.toProfile);
  if (!to.ok) return to;
  const started = await ctx.ports.input.start();
  const live = started.ok ? started.value : [];
  const target = new Map<string, ControlRecord[]>();
  for (const record of to.value.parsed.records) {
    target.set(record.action, [...(target.get(record.action) ?? []), record]);
  }
  const rows: CopyRow[] = [];
  let same = 0;
  for (const record of from.value.parsed.records) {
    const there = target.get(record.action);
    const other = there?.length === 1 ? there[0] : undefined;
    if (other && sameData(record, other)) {
      same++;
      continue;
    }
    const base = {
      id: record.action,
      name: iracingActionLabel(record.action),
      group: iracingActionGroup(record.action),
      from: words(record, from.value.calibration, live, names),
      to: words(other, to.value.calibration, live, names),
    };
    const kept =
      there && there.length > 1
        ? `This action is in “${to.value.name}” more than once, so RigReady does not change it.`
        : whyKept(record, other, to.value.name);
    const wanted = kept ? undefined : copyable(record);
    // The writer has the last word: what it refuses is not offered.
    const tried =
      kept || wanted === undefined
        ? undefined
        : changeBinding(to.value.bytes, record.action, wanted);
    if (kept || wanted === undefined || !tried?.ok) {
      rows.push({
        ...base,
        kind: 'kept',
        why:
          kept ??
          (tried && !tried.ok ? tried.error.message : 'RigReady does not copy this binding.'),
      });
    } else {
      rows.push({ ...base, kind: wanted === null ? 'clear' : 'copy' });
    }
  }
  const blocked = await whyBlocked(ctx);
  return ok({
    from: from.value.name,
    to: to.value.name,
    rows,
    same,
    file: to.value.file,
    ...(blocked ? { blocked } : {}),
  });
}

interface Plan {
  from: Loaded;
  to: Loaded;
  bytes: Uint8Array;
  copied: string[];
  clears: number;
}

/** The target file with the chosen actions copied, checked before it is handed over. */
async function plan(ctx: BindingsContext, request: CopyRequest): Promise<Result<Plan>> {
  if (request.fromProfile === request.toProfile) {
    return err('iracing-bindings.copy.same', 'Choose two different profiles.');
  }
  const from = await loadProfile(ctx, request.fromProfile);
  if (!from.ok) return from;
  const to = await loadProfile(ctx, request.toProfile);
  if (!to.ok) return to;
  const chosen = [...new Set(request.actions)];
  let bytes = to.value.bytes;
  const copied: string[] = [];
  let clears = 0;
  for (const action of chosen) {
    const records = from.value.parsed.records.filter((r) => r.action === action);
    const others = to.value.parsed.records.filter((r) => r.action === action);
    const record = records.length === 1 ? records[0]! : undefined;
    const other = others.length === 1 ? others[0] : undefined;
    const name = iracingActionLabel(action);
    if (!record) {
      return err('iracing-bindings.copy.noAction', `“${from.value.name}” has no action ${name}.`);
    }
    const kept =
      others.length > 1
        ? `This action is in “${to.value.name}” more than once.`
        : whyKept(record, other, to.value.name);
    const wanted = kept ? undefined : copyable(record);
    if (kept || wanted === undefined) {
      return err(
        'iracing-bindings.copy.kept',
        `${name} is not copied: ${kept ?? 'RigReady does not copy this binding.'} Nothing was changed.`
      );
    }
    if (other && sameData(record, other)) continue;
    const change = changeBinding(bytes, action, wanted);
    if (!change.ok) {
      return err(change.error.code, `${name}: ${change.error.message}`, change.error.detail);
    }
    bytes = change.value.bytes;
    copied.push(action);
    if (wanted === null) clears++;
  }

  // The whole result, checked against both files: only the chosen records changed, and each
  // ends with the very bytes of the record it was copied from.
  const before = to.value.bytes;
  const again = parseControlsFile(bytes);
  if (!again.ok || bytes.length !== before.length) {
    return err(
      'iracing-bindings.copy.reread',
      'The copied file did not read back. Nothing was changed.'
    );
  }
  const allowed = new Set(copied);
  for (let i = 0; i < again.value.records.length; i++) {
    const now = again.value.records[i]!;
    const was = to.value.parsed.records[i]!;
    const kept = was.data.every((value, j) => value === now.data[j]);
    const source = from.value.parsed.records.find((r) => r.action === now.action);
    const fine =
      now.action === was.action &&
      now.offset === was.offset &&
      (allowed.has(now.action)
        ? source !== undefined &&
          now.data.subarray(0, KEPT_BYTES).every((value, j) => value === was.data[j]) &&
          sameData(now, source)
        : kept);
    if (!fine) {
      return err(
        'iracing-bindings.copy.outside',
        'RigReady would have changed more than the chosen bindings. Nothing was changed.'
      );
    }
  }
  const outside = (at: number): boolean =>
    !again.value.records.some(
      (r) => allowed.has(r.action) && at >= r.offset + KEPT_BYTES && at < r.offset + RECORD_BYTES
    );
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== before[i] && outside(i)) {
      return err(
        'iracing-bindings.copy.outside',
        'RigReady would have changed more than the chosen bindings. Nothing was changed.'
      );
    }
  }
  return ok({ from: from.value, to: to.value, bytes, copied, clears });
}

const bindings = (n: number): string => `${n} ${n === 1 ? 'binding' : 'bindings'}`;

/** The copy as it would be written, for the user to look at first. Writes nothing. */
export async function reviewCopy(
  ctx: BindingsContext,
  request: CopyRequest
): Promise<Result<CopyReview>> {
  const planned = await plan(ctx, request);
  if (!planned.ok) return planned;
  const { from, to, bytes, copied, clears } = planned.value;
  const preview = await changePreview(ctx.ports.files, [{ path: to.file, content: bytes }]);
  if (!preview.ok) return preview;
  const blocked = await whyBlocked(ctx);
  return ok({
    from: from.name,
    to: to.name,
    count: copied.length,
    clears,
    usedBy: to.usedBy,
    preview: preview.value,
    seen: sha256(to.bytes),
    ...(blocked ? { blocked } : {}),
  });
}

/**
 * Writes the copy into the target profile's controls.cfg: refused while iRacing runs, a
 * backup first, and the file read back before anything is called done.
 */
export async function applyCopy(
  ctx: BindingsContext,
  request: CopyRequest
): Promise<Result<CopyResult>> {
  const blocked = await whyBlocked(ctx);
  if (blocked) return err('iracing-bindings.copy.blocked', blocked);
  const planned = await plan(ctx, request);
  if (!planned.ok) return planned;
  const { from, to, bytes, copied } = planned.value;
  if (request.seen !== undefined && request.seen !== sha256(to.bytes)) {
    return err(
      'iracing-bindings.copy.changed',
      `The bindings of “${to.name}” changed after the copy was shown, so nothing was written. Look at it again.`
    );
  }
  if (copied.length === 0) {
    return ok({
      copied: 0,
      message: `Nothing was changed: “${to.name}” already has these bindings.`,
      file: to.file,
    });
  }
  const group = ctx.ports.files.beginGroup(
    `iRacing control profile “${to.name}”: ${bindings(copied.length)} copied from “${from.name}”`
  );
  const written = await ctx.ports.files.write(to.file, bytes, {
    reason: `Copy ${bindings(copied.length)} into controls.cfg`,
    group,
  });
  if (!written.ok) return written;
  const back = await ctx.ports.files.readBytes(to.file);
  if (!back.ok) return back;
  if (back.value.length !== bytes.length || !back.value.every((value, i) => value === bytes[i])) {
    return err('iracing-bindings.copy.notKept', 'controls.cfg did not keep the copy.');
  }
  return ok({
    copied: copied.length,
    message: `Copied ${bindings(copied.length)} from “${from.name}” into “${to.name}”. Undo is on the Safety page.`,
    file: to.file,
  });
}
