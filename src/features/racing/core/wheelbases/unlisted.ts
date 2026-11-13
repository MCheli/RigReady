import path from 'node:path';
import { z } from 'zod';
import type { CheckContext } from '../../../../core/checks/registry';
import { JsonStore } from '../../../../core/jsonStore';
import { err, ok, type Result } from '../../../../core/result';
import type { DeviceInfo, InputDevice } from '../../../../shared/models';
import type { MyWheel, UnlistedController } from '../../contract';
import { productOf } from './products';

/**
 * Wheel bases RigReady does not know. The table (./products.ts) names the models whose USB
 * ids a source gives; a base of another make, or a newer model, is not in it. Such a base is
 * still seen on USB like any controller. This file says which connected controllers the
 * table does not know, which of them look like a wheel base, and keeps the ones the user
 * said are their wheel base ("My wheel is not listed").
 *
 * What the device layer knows about a controller is its name, its USB ids, and the axes,
 * buttons and hats of the controllers games see for it. It does not say whether a controller
 * has force feedback, so that is not part of the guess. The guess only decides the wording
 * on the page; the user picks the wheel, RigReady never adds one by itself.
 */

const Id = z.string().regex(/^[0-9A-F]{4}$/);

export const StoredWheelSchema = z.object({
  vendorId: Id,
  productId: Id,
  /** The name the device reported when it was added. */
  name: z.string().max(200),
  /** The maker, when the user gave one. A label: nothing is looked up by it. */
  maker: z.string().max(60).optional(),
  addedAt: z.string().optional(),
});
export type StoredWheel = z.infer<typeof StoredWheelSchema>;

export const StoredWheelsSchema = z.object({ wheels: z.array(StoredWheelSchema).default([]) });

/** <data folder>/racing/wheels.json: on this PC only, never in a shared setup. */
export function wheelStore(ctx: CheckContext): JsonStore<typeof StoredWheelsSchema> {
  return new JsonStore(
    ctx.ports.files,
    path.join(ctx.ports.folders.dataRoot(), 'racing', 'wheels.json'),
    StoredWheelsSchema
  );
}

/** The wheel bases the user added. A file that cannot be read gives none, and adding says why. */
export async function readMyWheels(ctx: CheckContext): Promise<StoredWheel[]> {
  const read = await wheelStore(ctx).read();
  return read.ok ? read.value.wheels : [];
}

const sameModel = (
  a: { vendorId: string; productId: string },
  b: { vendorId: string; productId: string }
): boolean =>
  a.vendorId.toUpperCase() === b.vendorId.toUpperCase() &&
  a.productId.toUpperCase() === b.productId.toUpperCase();

export const storedWheelOf = (
  mine: readonly StoredWheel[],
  device: { vendorId: string; productId: string }
): StoredWheel | undefined => mine.find((w) => sameModel(w, device));

const controllersFor = (
  live: InputDevice[] | undefined,
  device: { vendorId: string; productId: string }
): InputDevice[] => (live ?? []).filter((c) => sameModel(c, device));

/** Windows lists it as a game controller, or games see a controller for it. */
const isController = (device: DeviceInfo, live: InputDevice[] | undefined): boolean =>
  !device.isHub && (device.isGameController || controllersFor(live, device).length > 0);

/** A name that says the controller is something other than a wheel base. */
const NOT_A_BASE =
  /pedal|shifter|hand ?brake|button ?box|stick|throttle|rudder|flight|hotas|yoke|trim|collective|cyclic|panel|game ?pad|keyboard|mouse|xbox|dual ?sense|dual ?shock|wireless controller/i;

/** A name that says the controller is a steering wheel. */
const WHEEL_NAME = /wheel|steering|direct ?drive|\bDD\d*\b/i;

/**
 * Makers whose USB id is on racing gear only. Logitech, Thrustmaster and Moza also make
 * flight controllers, and 0483 and 16D0 are chip makers' ids shared by many products, so a
 * controller with one of those ids is judged by its name alone.
 */
const WHEEL_MAKERS: Readonly<Record<string, string>> = {
  '0EB7': 'Fanatec',
  '3670': 'Simagic',
  '2433': 'Asetek',
  '3416': 'Cammus',
};

/**
 * Does a controller the table does not know look like a wheel base? By its name, or by a
 * wheel maker's id when it is not plainly a set of pedals (axes, no buttons) or a shifter
 * (buttons, no axes). Returns why, as a sentence, or undefined.
 */
export function looksLikeWheelBase(
  device: Pick<DeviceInfo, 'vendorId' | 'name'>,
  controller: Pick<InputDevice, 'numAxes' | 'numButtons'> | undefined
): string | undefined {
  if (NOT_A_BASE.test(device.name)) return undefined;
  if (WHEEL_NAME.test(device.name)) return 'Its name says it is a wheel.';
  const maker = WHEEL_MAKERS[device.vendorId.toUpperCase()];
  if (maker && (!controller || (controller.numAxes > 0 && controller.numButtons > 0)))
    return `It is from ${maker}, a maker of wheel bases.`;
  return undefined;
}

/**
 * Every connected controller the table does not know and the user has not added, one per
 * model, the ones that look like a wheel base first.
 */
export function unlistedControllers(
  devices: DeviceInfo[],
  live: InputDevice[] | undefined,
  mine: readonly StoredWheel[]
): UnlistedController[] {
  const out: UnlistedController[] = [];
  for (const device of devices) {
    if (!isController(device, live)) continue;
    if (productOf(device.vendorId, device.productId)) continue;
    if (storedWheelOf(mine, device)) continue;
    if (out.some((o) => sameModel(o, device))) continue;
    const controllers = controllersFor(live, device);
    const first = controllers[0];
    const why = looksLikeWheelBase(device, first);
    out.push({
      vendorId: device.vendorId.toUpperCase(),
      productId: device.productId.toUpperCase(),
      name: device.name || first?.name || `${device.vendorId}:${device.productId}`,
      controllers: controllers.length,
      axes: first?.numAxes ?? 0,
      buttons: first?.numButtons ?? 0,
      looksLikeWheel: why !== undefined,
      ...(why ? { why } : {}),
    });
  }
  return [...out.filter((o) => o.looksLikeWheel), ...out.filter((o) => !o.looksLikeWheel)];
}

/**
 * For "My wheel is not listed": the connected controllers that can be picked, and the wheel
 * bases the user added, each with whether it is connected now.
 */
export async function unlistedView(
  ctx: CheckContext
): Promise<{ unlisted: UnlistedController[]; myWheels: MyWheel[] }> {
  const mine = await readMyWheels(ctx);
  const devices = await ctx.ports.devices.list();
  const all = devices.ok ? devices.value : [];
  const started = await ctx.ports.input.start();
  const live = started.ok ? started.value : undefined;
  return {
    unlisted: unlistedControllers(all, live, mine),
    myWheels: mine.map((wheel) => ({
      vendorId: wheel.vendorId,
      productId: wheel.productId,
      name: wheel.name,
      ...(wheel.maker ? { maker: wheel.maker } : {}),
      connected: all.some((d) => !d.isHub && sameModel(d, wheel)),
    })),
  };
}

export { UNLISTED_NOT_AVAILABLE, UNLISTED_WORKS } from './unlistedScope';

/**
 * "My wheel is not listed": remembers a controller that is connected now as the user's wheel
 * base. Only RigReady's own file is written. Refused for a model the table knows (it needs no
 * adding) and for a controller that is not connected (its name comes from the device).
 */
export async function addMyWheel(
  ctx: CheckContext,
  input: { vendorId: string; productId: string; maker?: string | undefined }
): Promise<Result<StoredWheel>> {
  const vendorId = input.vendorId.toUpperCase();
  const productId = input.productId.toUpperCase();
  if (productOf(vendorId, productId))
    return err(
      'racing.wheelKnown',
      'RigReady already knows this model. The Wheel page shows it without it being added.'
    );
  const devices = await ctx.ports.devices.list();
  if (!devices.ok) return devices;
  const started = await ctx.ports.input.start();
  const live = started.ok ? started.value : undefined;
  const device = devices.value.find(
    (d) => sameModel(d, { vendorId, productId }) && isController(d, live)
  );
  if (!device)
    return err(
      'racing.wheelNotConnected',
      'That controller is not connected now. Plug it in and switch it on, then pick it again.'
    );
  const maker = input.maker?.trim();
  const wheel: StoredWheel = {
    vendorId,
    productId,
    name: (device.name || controllersFor(live, device)[0]?.name || `${vendorId}:${productId}`)
      .trim()
      .slice(0, 200),
    ...(maker ? { maker } : {}),
    addedAt: ctx.ports.clock.now().toISOString(),
  };
  const saved = await wheelStore(ctx).update((current) => ({
    wheels: [...current.wheels.filter((w) => !sameModel(w, wheel)), wheel],
  }));
  if (!saved.ok) return saved;
  return ok(wheel);
}

/** Forgets a wheel base the user added. Refused when it is not in the list. */
export async function removeMyWheel(
  ctx: CheckContext,
  ref: { vendorId: string; productId: string }
): Promise<Result<StoredWheel>> {
  const mine = await wheelStore(ctx).read();
  if (!mine.ok) return mine;
  const wheel = storedWheelOf(mine.value.wheels, ref);
  if (!wheel)
    return err('racing.wheelNotAdded', 'That wheel base is not one you added, so nothing changed.');
  const saved = await wheelStore(ctx).update((current) => ({
    wheels: current.wheels.filter((w) => !sameModel(w, ref)),
  }));
  if (!saved.ok) return saved;
  return ok(wheel);
}
