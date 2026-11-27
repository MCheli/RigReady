import { controlLabel } from '../../../core/bindings';
import { sha256 } from '../../../core/files/fileStore';
import { changePreview } from '../../../core/files/preview';
import { registryValuePath } from '../../../core/files/registryValues';
import { err, ok, type Result } from '../../../core/result';
import type { ChangeResult, TuneRequest, TuneReview, Tuning } from '../contract';
import { parseCalibration, tuneAxisText, type AxisTuning } from './calibration';
import { exactBytes, oneAtATime, whyBlocked } from './change';
import { parseHardwareIdentifier, parseSaveKey, textOfBinary } from './rewired';
import { GAME_NAME, REGISTRY_KEY, axisNamesOf, overview, type BindingsContext } from './view';

/**
 * The dead zones and the sensitivity of a controller's axes, as the game saved them in its
 * calibration for the controller: read for the page, and one axis changed after a review,
 * through FileStore (a backup, the Safety page, Undo). The game reads its calibration when
 * it starts and saves it from its own Calibrate window, so a change is refused while it runs.
 */

interface Stored {
  valueName: string;
  text: string;
  deviceName: string;
}

const IN_GAME = 'Set it in the game: Settings, Controls, then Calibrate.';

/** The saved calibration the game uses for a controller of the page. */
async function storedCalibration(ctx: BindingsContext, deviceId: string): Promise<Result<Stored>> {
  const view = await overview(ctx);
  if (!view.ok) return view;
  const device = view.value.devices.find((d) => d.id === deviceId && d.kind === 'controller');
  if (!device?.vendorId || !device.productId) {
    return err(
      'nuclear-option.tuning.device',
      `RigReady tunes the axes of a controller the game has saved bindings for. ${IN_GAME}`
    );
  }
  // The calibration's name says the model, not which unit of it: with two of one model
  // RigReady cannot tell whose it is.
  const sameModel = view.value.devices.filter(
    (d) => d.vendorId === device.vendorId && d.productId === device.productId
  );
  if (sameModel.length > 1) {
    return err(
      'nuclear-option.tuning.twins',
      `Two controllers of this model have saved bindings, and the game’s calibration does not say which of them it is for. ${IN_GAME}`
    );
  }
  const values = await ctx.ports.registry.listValues('HKCU', REGISTRY_KEY);
  if (!values.ok) return values;
  const found = Object.entries(values.value).flatMap(([name, value]) => {
    const key = parseSaveKey(name);
    if (key?.dataType !== 'CalibrationMap' || key.parts.controllerType !== 'Joystick') return [];
    const identity = key.parts.hardwareIdentifier
      ? parseHardwareIdentifier(key.parts.hardwareIdentifier)
      : undefined;
    if (
      !identity ||
      identity.vendorId !== device.vendorId ||
      identity.productId !== device.productId
    ) {
      return [];
    }
    return [{ name, value, form: identity.form }];
  });
  // As for the saved maps: a later build saves under a shorter identifier and can leave the
  // earlier value in place; the later one is what the game uses.
  const short = found.filter((f) => f.form === 'short');
  const used = short.length > 0 ? short : found;
  if (used.length === 0) {
    return err(
      'nuclear-option.tuning.none',
      'Nuclear Option has saved no calibration for this controller yet. Start the game once with it plugged in.'
    );
  }
  if (used.length > 1) {
    return err(
      'nuclear-option.tuning.two',
      `Nuclear Option has saved two calibrations for this controller, and RigReady cannot tell which one it uses. ${IN_GAME}`
    );
  }
  const one = used[0]!;
  const text = one.value.type === 'binary' ? textOfBinary(one.value.value) : undefined;
  if (text === undefined) {
    return err(
      'nuclear-option.tuning.form',
      `The game’s saved calibration for this controller is not stored as text. ${IN_GAME}`
    );
  }
  return ok({ valueName: one.name, text, deviceName: device.name });
}

const body = (text: string): string => (text.endsWith('\0') ? text.slice(0, -1) : text);

const axisLabel = (names: string[], index: number): string => {
  const name = names[index];
  return name ? controlLabel({ kind: 'axis', axis: name }) : `Axis ${index}`;
};

/** The axes of one controller with how each is tuned now. Reads only. */
export async function tuningOf(ctx: BindingsContext, deviceId: string): Promise<Result<Tuning>> {
  const stored = await storedCalibration(ctx, deviceId);
  if (!stored.ok) return stored;
  const parsed = parseCalibration(body(stored.value.text));
  if (!parsed.ok) return parsed;
  const asked = await axisNamesOf(ctx, deviceId);
  if (!asked.ok) return asked;
  // The controller's own axes when it is plugged in and says which it has; the usual ones
  // by the game's numbers when it is not.
  const names = asked.value.asked ? asked.value.names : [];
  const count = asked.value.asked ? names.length : asked.value.names.length;
  return ok({
    device: stored.value.deviceName,
    named: asked.value.asked,
    axes: parsed.value.axes.slice(0, count).map((a) => ({
      index: a.index,
      name: axisLabel(names, a.index),
      tunable: a.tunable,
      unread: a.unread,
      deadZone: a.deadZone,
      ...(a.upperDeadZone !== undefined ? { upperDeadZone: a.upperDeadZone } : {}),
      sensitivity: a.sensitivity,
      reversed: a.invert,
    })),
  });
}

const percent = (value: number): string => `${Math.round(value * 100)} %`;

/** "dead zone 5 %, upper dead zone 0 %, sensitivity 1" */
function inWords(t: AxisTuning): string {
  return [
    `dead zone ${percent(t.deadZone)}`,
    ...(t.upperDeadZone !== undefined ? [`upper dead zone ${percent(t.upperDeadZone)}`] : []),
    `sensitivity ${Number(t.sensitivity.toFixed(2))}`,
  ].join(', ');
}

interface Plan {
  valueName: string;
  address: string;
  bytes: Uint8Array;
  seen: string;
  deviceName: string;
  axisName: string;
  before: string;
  after: string;
  same: boolean;
}

async function plan(ctx: BindingsContext, request: TuneRequest): Promise<Result<Plan>> {
  const stored = await storedCalibration(ctx, request.device);
  if (!stored.ok) return stored;
  const exact = await exactBytes(ctx, stored.value.valueName, stored.value.text);
  if (!exact.ok) return exact;
  const asked = await axisNamesOf(ctx, request.device);
  if (!asked.ok) return asked;
  const names = asked.value.asked ? asked.value.names : [];
  // Rounded to what the page offers: whole percents, and hundredths of the sensitivity.
  const round = (value: number): number => Math.round(value * 100) / 100;
  const tuned = tuneAxisText(stored.value.text, request.axis, {
    deadZone: round(request.deadZone),
    ...(request.upperDeadZone !== undefined ? { upperDeadZone: round(request.upperDeadZone) } : {}),
    sensitivity: round(request.sensitivity),
  });
  if (!tuned.ok) return tuned;
  const bytes = Buffer.from(tuned.value.text, 'utf8');
  return ok({
    valueName: stored.value.valueName,
    address: registryValuePath('HKCU', REGISTRY_KEY, stored.value.valueName),
    bytes: new Uint8Array(bytes),
    seen: sha256(`${stored.value.valueName}\n${sha256(exact.value)}\n${sha256(bytes)}`),
    deviceName: stored.value.deviceName,
    axisName: axisLabel(names, request.axis),
    before: inWords(tuned.value.before),
    after: inWords(tuned.value.after),
    same: tuned.value.same,
  });
}

/** One axis's tuning as it would be. Writes nothing. */
export async function reviewTune(
  ctx: BindingsContext,
  request: TuneRequest
): Promise<Result<TuneReview>> {
  const planned = await plan(ctx, request);
  if (!planned.ok) return planned;
  const p = planned.value;
  const preview = await changePreview(
    ctx.ports.files,
    [{ path: p.address, content: p.bytes }],
    () => `${GAME_NAME}’s saved calibration for ${p.deviceName} (registry)`
  );
  if (!preview.ok) return preview;
  const blocked = await whyBlocked(ctx);
  return ok({
    device: p.deviceName,
    axis: p.axisName,
    before: p.before,
    after: p.after,
    same: p.same,
    ...(blocked ? { blocked } : {}),
    preview: preview.value,
    seen: p.seen,
  });
}

/**
 * Writes one axis's tuning: refused while the game runs, a backup first, and the value is
 * read back before anything is called done. The page calls this only from the review's Save.
 */
export function applyTune(
  ctx: BindingsContext,
  request: TuneRequest
): Promise<Result<ChangeResult>> {
  return oneAtATime(async (): Promise<Result<ChangeResult>> => {
    const blocked = await whyBlocked(ctx);
    if (blocked) return err('nuclear-option.edit.blocked', blocked);
    const planned = await plan(ctx, request);
    if (!planned.ok) return planned;
    const p = planned.value;
    if (request.seen !== undefined && request.seen !== p.seen) {
      return err(
        'nuclear-option.edit.changed',
        'The game’s saved calibration changed after the change was shown, so nothing was written. Look at the change again.'
      );
    }
    if (p.same) {
      return ok({
        changed: false,
        message: `Nothing was changed: ${p.axisName} of ${p.deviceName} is tuned so already.`,
      });
    }
    const group = ctx.ports.files.beginGroup(
      `${GAME_NAME} axis tuning: ${p.axisName} of ${p.deviceName}: ${p.after}`
    );
    const written = await ctx.ports.files.write(p.address, p.bytes, {
      reason: `Tune one axis in the calibration ${GAME_NAME} saved in the registry`,
      group,
    });
    if (!written.ok) return written;
    const back = await ctx.ports.registry.getValue('HKCU', REGISTRY_KEY, p.valueName);
    if (!back.ok) return back;
    const kept =
      back.value?.type === 'binary' &&
      back.value.value.toLowerCase() === Buffer.from(p.bytes).toString('hex');
    if (!kept) return err('nuclear-option.edit.notKept', 'The registry did not keep the change.');
    return ok({
      changed: true,
      message: `Saved: ${p.axisName} of ${p.deviceName} now has ${p.after}. Undo is on the Safety page.`,
    });
  });
}
