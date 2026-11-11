import { brandOf } from './wheelbases/brands';
import { productOf } from './wheelbases/products';

/** Controller identity helpers shared by the racing games and the wheel checks. */

/** "{00070EB7-0000-0000-0000-504944564944}" -> { vendorId: "0EB7", productId: "0007" }. */
export function vidPidFromProductGuid(
  productGuid: string
): { vendorId: string; productId: string } | undefined {
  const match = /^\{?([0-9A-F]{4})([0-9A-F]{4})-0000-0000-0000-504944564944\}?$/i.exec(productGuid);
  if (!match) return undefined;
  return { vendorId: match[2]!.toUpperCase(), productId: match[1]!.toUpperCase() };
}

/** "00070eb7" (BeamNG's file name: product id then vendor id) -> ids. */
export function vidPidFromBeamng(
  vidpid: string
): { vendorId: string; productId: string } | undefined {
  const match = /^([0-9A-F]{4})([0-9A-F]{4})$/i.exec(vidpid);
  if (!match) return undefined;
  return { vendorId: match[2]!.toUpperCase(), productId: match[1]!.toUpperCase() };
}

export { COMPATIBILITY_PID, FANATEC_PRODUCTS, FANATEC_VENDOR } from './wheelbases/products';

const GENERIC_AXES: Record<string, string> = {
  X: 'X axis',
  Y: 'Y axis',
  Z: 'Z axis',
  RX: 'X rotation',
  RY: 'Y rotation',
  RZ: 'Z rotation',
  S0: 'Slider 1',
  S1: 'Slider 2',
};

/** "SLIDER1" (the controller list's spelling) -> "S0" (the games'). */
export const neutralAxisName = (axis: string): string =>
  ({ SLIDER1: 'S0', SLIDER2: 'S1' })[axis.toUpperCase()] ?? axis.toUpperCase();

/**
 * A plain name for a DirectInput axis ("X", "RZ", "S0") on a given controller: what the
 * brand uses it for on a wheel base, where a source says so (./wheelbases/brands.ts), and
 * the generic name otherwise.
 */
export function axisName(axis: string, vendorId?: string, productId?: string): string {
  const product = productOf(vendorId, productId);
  const named = product?.role === 'base' ? brandOf(product.brand)?.baseAxes?.[axis] : undefined;
  return named ?? GENERIC_AXES[axis] ?? axis;
}
