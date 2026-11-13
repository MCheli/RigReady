import { z } from 'zod';
import type {
  CaptureDefinition,
  CheckContext,
  CheckDefinition,
  CheckOutcome,
} from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import { deviceKind } from '../../../core/gearKind';
import type { DeviceNames } from '../../../core/names';
import { ok } from '../../../core/result';
import type { DeviceInfo, InputDevice } from '../../../shared/models';
import { cleanGuid, installOf, type RacingContext } from './context';
import { readFiles } from './iracing/iracing';
import type { CalibratedDevice } from './iracing/joyCalib';
import { productOf } from './wheelbases/products';

/**
 * "The wheel and pedals are calibrated in iRacing": before a race, whether iRacing will ask
 * to calibrate. iRacing keeps the calibration of each controller in the joyCalib.yaml of the
 * control profile it uses (Documents\iRacing\profiles\controls\<name>\, or Documents\iRacing
 * on an iRacing from before control profiles; src/core/iracingControls.ts finds it), one
 * entry per controller, keyed by the controller's DirectInput instance GUID and product GUID.
 *
 * What counts as calibrated, from the owner's real file (docs/research/iracing-bindings.md,
 * "joyCalib.yaml: what proves a controller is calibrated"):
 * - [V] An entry has DeviceName, InstanceGUID, ProductGUID and AxisList; each axis has its
 *   number, its name, and CalibMin, CalibCenter and CalibMax as measured.
 * - [I] A controller is calibrated when an entry carries its instance GUID as Windows gives
 *   it now and at least one axis with a range (CalibMax above CalibMin). An entry under
 *   another instance GUID with the same product GUID is the same model under an older
 *   Windows id: iRacing treats the controller as new and asks again (racing.md 2.5).
 * - [I] A wheel base that shows up as two DirectInput controllers of one USB device is
 *   calibrated when one of them is, as iRacing calibrates one collection. Separate units of
 *   one model are judged one by one (`gearCalibration`).
 *
 * The wheel and pedals are the controllers plugged in now that are racing gear: what the
 * owner said on the Devices page first (a device said to be flight gear is left out), then
 * the wheel bases and pedals the racing table knows by USB id, then the name. Pedals plugged
 * into a wheel base are axes of the base, so the base's entry covers them.
 */

export const IRACING_CALIBRATION = 'racing.iracingCalibration';
export const CALIBRATION_TITLE = 'Wheel and pedals calibrated in iRacing';

/** Rudder pedals for flying, by name: pedals, but not for driving. */
const FLIGHT_PEDALS = /\b(rudder|tpr|t-?pendular|crosswind|slaw|mfg|tfrp|pro flight)\b/i;

export type RacingGear = 'wheel' | 'pedals';

/** Whether a controller is a wheel or pedals for driving, and which. */
export function racingGearOf(
  controller: Pick<InputDevice, 'name' | 'vendorId' | 'productId' | 'guid'>,
  names: DeviceNames
): RacingGear | undefined {
  const { vendorId, productId } = controller;
  const said =
    vendorId && productId
      ? names.whatIs?.({ vendorId, productId, guid: controller.guid })
      : undefined;
  if (said?.usedFor === 'flight') return undefined;
  if (said?.kind) return said.kind === 'wheel' || said.kind === 'pedals' ? said.kind : undefined;
  const role = productOf(vendorId, productId)?.role;
  if (role === 'base') return 'wheel';
  if (role === 'pedals') return 'pedals';
  if (role) return undefined;
  const kind = deviceKind(controller.name);
  if (kind === 'wheel') return 'wheel';
  if (kind === 'pedals' && !FLIGHT_PEDALS.test(controller.name)) return 'pedals';
  return undefined;
}

export type CalibrationState = 'calibrated' | 'old-id' | 'missing';

export interface GearCalibration {
  /** The name the owner gave it, or the name Windows gives it. */
  name: string;
  gear: RacingGear;
  vendorId?: string;
  productId?: string;
  state: CalibrationState;
}

const hasRange = (entry: CalibratedDevice): boolean =>
  entry.axes.some((a) => a.min !== undefined && a.max !== undefined && a.max > a.min);

/**
 * Each wheel and pedal set plugged in now, with whether iRacing has calibrated it.
 * `calibration` is the profile's joyCalib.yaml as read (empty when there is none).
 *
 * One physical device is one entry: DirectInput controllers that Windows says belong to the
 * same USB device (`usbInstanceId`, a base listed as two collections) are judged together,
 * and calibrated when one of them is. Without that, each controller is judged on its own,
 * so two identical pedal sets are never taken for one; a base listed twice may then warn,
 * but never passes for a unit iRacing has not calibrated.
 */
export function gearCalibration(
  live: InputDevice[],
  calibration: CalibratedDevice[],
  names: DeviceNames
): GearCalibration[] {
  const models = new Map<string, { gear: RacingGear; controllers: InputDevice[] }>();
  for (const controller of live) {
    const gear = racingGearOf(controller, names);
    if (!gear) continue;
    const key = controller.usbInstanceId
      ? `usb:${controller.usbInstanceId.toUpperCase()}`
      : `guid:${cleanGuid(controller.guid)}`;
    const model = models.get(key) ?? { gear, controllers: [] };
    model.controllers.push(controller);
    models.set(key, model);
  }
  const out: GearCalibration[] = [];
  for (const { gear, controllers } of models.values()) {
    const first = controllers[0]!;
    const entries = controllers.map((c) =>
      calibration.find((e) => e.instanceGuid === cleanGuid(c.guid))
    );
    const calibrated = entries.some((e) => e !== undefined && hasRange(e));
    // An entry of the same model is an older id only when no controller plugged in now has
    // it: an identical second unit is uncalibrated, not the first one under a new id.
    const older = calibration.some(
      (e) =>
        !live.some((c) => cleanGuid(c.guid) === e.instanceGuid) &&
        controllers.some((c) => c.productGuid !== '' && e.productGuid === cleanGuid(c.productGuid))
    );
    const given =
      first.vendorId && first.productId
        ? names.nameOf({ vendorId: first.vendorId, productId: first.productId, guid: first.guid })
        : undefined;
    out.push({
      name: given ?? first.name.trim(),
      gear,
      ...(first.vendorId ? { vendorId: first.vendorId } : {}),
      ...(first.productId ? { productId: first.productId } : {}),
      state: calibrated ? 'calibrated' : older ? 'old-id' : 'missing',
    });
  }
  return out;
}

const list = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const CALIBRATE_IN_IRACING = 'Calibrate in iRacing: Options, then Controls.';

/** What the check says, from what was found. */
export function calibrationOutcome(gear: GearCalibration[], profile?: string): CheckOutcome {
  if (gear.length === 0) {
    return {
      pass: false,
      summary: 'No wheel or pedals are plugged in',
      details: ['Plug in the wheel and pedals. This then checks that iRacing has calibrated them.'],
    };
  }
  const where = profile ? ` (control profile “${profile}”)` : '';
  const not = gear.filter((g) => g.state !== 'calibrated');
  if (not.length === 0) {
    const names = gear.map((g) => g.name);
    return {
      pass: true,
      summary: `${list(names)} ${names.length === 1 ? 'is' : 'are'} calibrated in iRacing${where}`,
    };
  }
  const missing = not.filter((g) => g.state === 'missing');
  const older = not.filter((g) => g.state === 'old-id');
  const details: string[] = [];
  if (missing.length > 0) {
    details.push(
      `iRacing has no calibration for ${list(missing.map((g) => g.name))}, so it will ask you to calibrate ${missing.length === 1 ? 'it' : 'them'}. ${CALIBRATE_IN_IRACING}`
    );
  }
  for (const g of older) {
    details.push(
      `${g.name} is calibrated under an older Windows id, so iRacing will ask you to calibrate it again. Open Configure › Racing › iRacing to point iRacing at the new id, or ${CALIBRATE_IN_IRACING.charAt(0).toLowerCase()}${CALIBRATE_IN_IRACING.slice(1)}`
    );
  }
  return {
    pass: false,
    summary: `Not calibrated in iRacing${where}: ${list(not.map((g) => g.name))}`,
    details,
  };
}

/** The names the owner gave devices, from the devices this run of checks has listed. */
export type NamesFor = (present?: DeviceInfo[]) => Promise<DeviceNames>;

async function namesOf(ctx: CheckContext, names: NamesFor): Promise<DeviceNames> {
  // The check's own (cached) list of USB devices: the lookup does not list them again.
  const listed = await ctx.ports.devices.list();
  return names(listed.ok ? listed.value : undefined);
}

export function iracingCalibrationCheck(
  games: GameRegistry,
  names: NamesFor
): CheckDefinition<Record<string, never>> {
  return {
    type: IRACING_CALIBRATION,
    group: 'files',
    label: CALIBRATION_TITLE,
    params: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    async run(_params, checkCtx) {
      const ctx: RacingContext = { ...checkCtx, games };
      const files = await readFiles(ctx);
      if (!files) return { pass: false, summary: 'The iRacing folder in Documents was not found' };
      const set = files.located.general;
      if (!set) {
        return {
          pass: false,
          summary: 'RigReady cannot tell which control profile iRacing uses',
          ...(files.located.problem ? { details: [files.located.problem] } : {}),
        };
      }
      const started = await ctx.ports.input.start();
      if (!started.ok) return { pass: false, error: true, summary: started.error.message };
      const said = await namesOf(ctx, names);
      // Nothing to judge without a wheel or pedals, whatever the file holds.
      if (!started.value.some((c) => racingGearOf(c, said))) return calibrationOutcome([]);
      if (files.calibration === undefined && (await ctx.ports.files.exists(set.calibration))) {
        return {
          pass: false,
          error: true,
          summary: 'RigReady could not read iRacing’s calibration file',
          details: [set.calibration, ...files.problems],
        };
      }
      return calibrationOutcome(
        gearCalibration(started.value, files.calibration ?? [], said),
        set.profile
      );
    },
  };
}

/** Offers the check for a setup made on a PC with iRacing and a wheel or pedals plugged in. */
export function iracingCalibrationCapture(games: GameRegistry, names: NamesFor): CaptureDefinition {
  return {
    id: 'racing-iracing-calibration',
    label: 'iRacing calibration',
    async capture(checkCtx) {
      const ctx: RacingContext = { ...checkCtx, games };
      if (!(await installOf(ctx, 'iracing'))) return ok([]);
      const started = await ctx.ports.input.start();
      if (!started.ok) return ok([]);
      const said = await namesOf(ctx, names);
      if (!started.value.some((c) => racingGearOf(c, said))) return ok([]);
      return ok([
        {
          key: 'racing:iracing-calibration',
          game: 'iracing',
          group: 'files',
          title: CALIBRATION_TITLE,
          description: 'Warns before iRacing asks you to calibrate the wheel or pedals',
          selectedByDefault: true,
          icon: 'mdi-tune-variant',
          check: {
            type: IRACING_CALIBRATION,
            title: CALIBRATION_TITLE,
            // iRacing still starts without it: it asks to calibrate, so this warns.
            required: false,
            params: {},
          },
        },
      ]);
    },
  };
}
