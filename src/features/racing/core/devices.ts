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

export const FANATEC_VENDOR = '0EB7';

/** Fanatec product ids (docs/research/racing.md 1.3, from hid-ftec.h and the driver's registry). */
export const FANATEC_PRODUCTS: Record<string, { name: string; base: boolean }> = {
  '0001': { name: 'ClubSport Wheel Base V2', base: true },
  '0004': { name: 'ClubSport Wheel Base V2.5', base: true },
  '0005': { name: 'CSL Elite Wheel Base (PS4)', base: true },
  '0006': { name: 'Podium Wheel Base DD1', base: true },
  '0007': { name: 'Podium Wheel Base DD2', base: true },
  '0011': { name: 'CSR Elite', base: true },
  '0020': { name: 'CSL DD', base: true },
  '0197': { name: 'Porsche 911 Wheel Base', base: true },
  '0E03': { name: 'CSL Elite Wheel Base', base: true },
  '183B': { name: 'ClubSport Pedals V3', base: false },
  '6204': { name: 'CSL Elite Pedals', base: false },
  '6205': { name: 'CSL Pedals LC', base: false },
  '6206': { name: 'CSL Pedals LC V2', base: false },
  '1A92': { name: 'ClubSport USB adapter (shifter)', base: false },
  '1A93': { name: 'ClubSport USB adapter (handbrake)', base: false },
};

/** A direct-drive base in compatibility (yellow) mode reports itself as a CSW V2.5. */
export const COMPATIBILITY_PID = '0004';

/**
 * DirectInput axis names of a Fanatec base with the Fanatec driver (from its OEM registry
 * entries, seen in BeamNG's log): X wheel, Y combined pedals, Z accelerator, RZ brake,
 * slider 1 clutch, slider 2 dial.
 */
const FANATEC_AXES: Record<string, string> = {
  X: 'Wheel',
  Y: 'Combined pedals',
  Z: 'Accelerator',
  RX: 'X rotation',
  RY: 'Y rotation',
  RZ: 'Brake',
  S0: 'Clutch',
  S1: 'Dial',
};

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

/** A plain name for a DirectInput axis ("X", "RZ", "S0") on a given controller. */
export function axisName(axis: string, vendorId?: string, productId?: string): string {
  const fanatecBase =
    vendorId?.toUpperCase() === FANATEC_VENDOR &&
    FANATEC_PRODUCTS[productId?.toUpperCase() ?? '']?.base;
  return (fanatecBase ? FANATEC_AXES[axis] : GENERIC_AXES[axis]) ?? axis;
}
