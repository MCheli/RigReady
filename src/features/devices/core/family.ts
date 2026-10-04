import type { GameKind } from '../../../shared/models';

/**
 * Which family of sims a piece of hardware is made for, from its USB vendor (and, for
 * vendors that make both kinds, its product). General knowledge about sim hardware, used
 * only to decide what a new setup keeps by default: a wheel base is not part of a setup
 * for a flight sim just because it is plugged in. Unknown hardware has no family and
 * suits any setup.
 */

const FLIGHT_VENDORS = new Set([
  '4098', // WinWing
  '3344', // Virpil
  '231D', // VKB
  '06A3', // Saitek
  '0738', // Mad Catz / Saitek (X-55, X-56)
  '068E', // CH Products
  '294B', // Honeycomb Aeronautical
  '131D', // NaturalPoint (TrackIR)
]);

const RACING_VENDORS = new Set([
  '0EB7', // Fanatec (Endor)
  '346E', // Moza Racing
  '3670', // Simagic
  '30B7', // Heusinkveld
  '2433', // Asetek SimSports
]);

/** Vendors that make both: the product decides. Upper-case "VVVV:PPPP". */
const BY_PRODUCT: Record<string, GameKind> = {
  // Thrustmaster flight
  '044F:B10A': 'flight', // T.16000M
  '044F:B687': 'flight', // TWCS throttle
  '044F:0402': 'flight', // HOTAS Warthog stick
  '044F:0404': 'flight', // HOTAS Warthog throttle
  '044F:B68F': 'flight', // TPR pendular rudder
  '044F:B679': 'flight', // T.Flight rudder pedals
  '044F:B678': 'flight', // TFRP rudder
  '044F:B108': 'flight', // T.Flight HOTAS X
  '044F:B67B': 'flight', // T.Flight HOTAS 4
  '044F:B351': 'flight', // Cougar MFD 1
  '044F:B352': 'flight', // Cougar MFD 2
  // Thrustmaster racing
  '044F:B65E': 'racing', // T500 RS
  '044F:B66E': 'racing', // T300 RS
  '044F:B66D': 'racing', // T300 RS (PS4 mode)
  '044F:B677': 'racing', // T150
  '044F:B669': 'racing', // TX
  '044F:B67F': 'racing', // TMX
  '044F:B689': 'racing', // TS-PC Racer
  '044F:B692': 'racing', // TS-XW
  '044F:B696': 'racing', // T248
  '044F:B660': 'racing', // T3PA pedals
  // Logitech flight
  '046D:C215': 'flight', // Extreme 3D Pro
  '046D:C2A8': 'flight', // X52 (Logitech era)
  // Logitech racing
  '046D:C24F': 'racing', // G29
  '046D:C260': 'racing', // G29 (PS4 mode)
  '046D:C262': 'racing', // G920
  '046D:C266': 'racing', // G923 (PlayStation)
  '046D:C26E': 'racing', // G923 (Xbox)
  '046D:C272': 'racing', // Pro Racing Wheel
  '046D:C294': 'racing', // Driving Force
  '046D:C298': 'racing', // Driving Force Pro
  '046D:C299': 'racing', // G25
  '046D:C29A': 'racing', // Driving Force GT
  '046D:C29B': 'racing', // G27
};

export function simFamily(vendorId: string, productId: string): GameKind | undefined {
  const vendor = vendorId.toUpperCase();
  const byProduct = BY_PRODUCT[`${vendor}:${productId.toUpperCase()}`];
  if (byProduct) return byProduct;
  if (FLIGHT_VENDORS.has(vendor)) return 'flight';
  if (RACING_VENDORS.has(vendor)) return 'racing';
  return undefined;
}
