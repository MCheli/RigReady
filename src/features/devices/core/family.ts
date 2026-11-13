import type { DeviceSaid } from '../../../core/names';
import type { GameKind } from '../../../shared/models';

/**
 * Which family of sims a piece of hardware is made for, from its USB vendor (and, for
 * vendors that make both kinds, its product, or failing that its name). General knowledge
 * about sim hardware, used only to decide what a new setup keeps by default: a wheel base
 * is not part of a setup for a flight sim just because it is plugged in. Unknown hardware
 * has no family and suits any setup.
 *
 * The lists here are a first guess. The user can say what a device is used for on the
 * Devices page, and `familyOf` puts that answer first.
 *
 * The ids come from public lists; the sources for each are in docs/research/device-ids.md
 * (the Linux kernel's hid-ids.h, SDL's joystick lists, linux-usb.org's usb.ids,
 * linux-hardware.org, the linux-steering-wheels table and hid-tmff2). Ids added from
 * 2026-11 on are only added when one of those lists has them.
 */

const FLIGHT_VENDORS = new Set([
  '4098', // WinWing (WINCTRL)
  '3344', // Virpil
  '231D', // VKB
  '06A3', // Saitek, and Logitech's Saitek-line flight gear
  '0738', // Mad Catz / Saitek (X-55, X-56)
  '068E', // CH Products
  '294B', // Honeycomb Aeronautical
  '131D', // NaturalPoint (TrackIR)
]);

const RACING_VENDORS = new Set([
  '0EB7', // Fanatec (Endor)
  '346E', // Moza Racing (its flight gear is told apart by product and name below)
  '3670', // Simagic (the EVO bases; the older Alpha bases use 0483, below)
  '30B7', // Heusinkveld
  '2433', // Asetek SimSports
  '3416', // Cammus
]);

/**
 * By product, ahead of the vendor rule: vendors that make both kinds, vendors whose gear
 * is mostly one kind, and shared vendor ids (0483 is STMicroelectronics and 16D0 is MCS,
 * both used by many unrelated products). Upper-case "VVVV:PPPP".
 */
const BY_PRODUCT: Record<string, GameKind> = {
  // Thrustmaster flight
  '044F:0400': 'flight', // HOTAS Cougar
  '044F:0402': 'flight', // HOTAS Warthog stick
  '044F:0404': 'flight', // HOTAS Warthog throttle
  '044F:0405': 'flight', // TCA Sidestick Airbus (T.A320 Pilot)
  '044F:0406': 'flight', // TCA Sidestick Airbus, left hand (T.A320 Copilot)
  '044F:0407': 'flight', // TCA Quadrant Airbus (Q-Eng 1&2)
  '044F:0408': 'flight', // TCA Quadrant Airbus add-on (Q-Eng 3&4)
  '044F:0409': 'flight', // TCA Yoke Boeing
  '044F:040A': 'flight', // TCA Quadrant Boeing 1&2
  '044F:B106': 'flight', // T.Flight Stick X
  '044F:B107': 'flight', // T.Flight Stick X
  '044F:B108': 'flight', // T.Flight HOTAS X
  '044F:B109': 'flight', // T.Flight HOTAS (PS3)
  '044F:B10A': 'flight', // T.16000M
  '044F:B351': 'flight', // Cougar MFD 1
  '044F:B352': 'flight', // Cougar MFD 2
  '044F:B678': 'flight', // T.Flight Rudder Pedals
  '044F:B679': 'flight', // T-Rudder
  '044F:B67B': 'flight', // T.Flight HOTAS
  '044F:B67C': 'flight', // T.Flight HOTAS 4
  '044F:B687': 'flight', // TWCS throttle
  '044F:B68C': 'flight', // T.Flight HOTAS One
  '044F:B68D': 'flight', // T.Flight HOTAS One
  '044F:B68F': 'flight', // TPR pendular rudder
  // Thrustmaster racing
  '044F:B371': 'racing', // T-LCM pedals
  '044F:B653': 'racing', // RGT Force Feedback Clutch
  '044F:B65D': 'racing', // FFB wheel (several wheels, before their own mode starts)
  '044F:B65E': 'racing', // T500 RS
  '044F:B660': 'racing', // T500 RS gear shift
  '044F:B664': 'racing', // TX (initial mode)
  '044F:B668': 'racing', // T80
  '044F:B669': 'racing', // TX
  '044F:B66D': 'racing', // T300 RS (PS4 mode)
  '044F:B66E': 'racing', // T300 RS
  '044F:B66F': 'racing', // T300 RS (advanced mode)
  '044F:B671': 'racing', // Ferrari 458 Spider
  '044F:B677': 'racing', // T150
  '044F:B67E': 'racing', // TMX (Xbox protocol)
  '044F:B67F': 'racing', // TMX
  '044F:B689': 'racing', // TS-PC Racer
  '044F:B691': 'racing', // TS-XW (initial mode)
  '044F:B692': 'racing', // TS-XW
  '044F:B696': 'racing', // T248
  '044F:B69A': 'racing', // T248X
  '044F:B69C': 'racing', // T128X
  // Logitech flight
  '046D:C214': 'flight', // Attack 3
  '046D:C215': 'flight', // Extreme 3D Pro
  '046D:C287': 'flight', // Flight System G940
  '046D:C2A8': 'flight', // X52 (Logitech era; not in the public lists, kept from before)
  // Logitech racing
  '046D:C24F': 'racing', // G29
  '046D:C260': 'racing', // G29 (PS4 mode)
  '046D:C261': 'racing', // G920 (initial mode)
  '046D:C262': 'racing', // G920
  '046D:C266': 'racing', // G923 (PlayStation and PC)
  '046D:C267': 'racing', // G923 (PlayStation mode)
  '046D:C268': 'racing', // Pro Racing Wheel
  '046D:C269': 'racing', // Pro Racing Wheel (PlayStation mode)
  '046D:C26D': 'racing', // G923 (Xbox)
  '046D:C26E': 'racing', // G923
  '046D:C272': 'racing', // Pro Racing Wheel (Xbox)
  '046D:C294': 'racing', // Driving Force
  '046D:C295': 'racing', // MOMO Force
  '046D:C298': 'racing', // Driving Force Pro
  '046D:C299': 'racing', // G25
  '046D:C29A': 'racing', // Driving Force GT
  '046D:C29B': 'racing', // G27
  '046D:CA03': 'racing', // MOMO Racing
  // Saitek and Mad Catz racing wheels (both vendors are otherwise flight)
  '06A3:0200': 'racing', // Saitek Racing Wheel
  '06A3:0501': 'racing', // Saitek R100 Sports Wheel
  '06A3:0506': 'racing', // Saitek R220 Digital Wheel
  '06A3:0805': 'racing', // Saitek R440 Force Wheel
  '06A3:FF04': 'racing', // Saitek R440 Force Wheel
  '0738:4530': 'racing', // Mad Catz MC2 Racing Wheel and Pedals
  '0738:4730': 'racing', // Mad Catz MC2 Racing Wheel (Xbox 360)
  // Turtle Beach: flight and racing under one vendor id, which also covers its headsets
  '10F5:7077': 'racing', // VelocityOne Race
  '10F5:7084': 'flight', // VelocityOne (SDL lists it with the flight sticks)
  '10F5:7085': 'flight', // VelocityOne Throttle
  // Moza flight (the vendor is otherwise racing)
  '346E:1000': 'flight', // AB9 FFB base
  // Simucube (16D0 is shared)
  '16D0:0D5A': 'racing', // Simucube 1
  '16D0:0D5F': 'racing', // Simucube 2 Ultimate
  '16D0:0D60': 'racing', // Simucube 2 Pro
  '16D0:0D61': 'racing', // Simucube 2 Sport
  // STMicroelectronics ids (0483 is shared)
  '0483:0522': 'racing', // Simagic M10, Alpha Mini, Alpha, Alpha U
  '0483:A355': 'racing', // VRS DirectForce Pro
};

/**
 * Moza flight gear whose product id is in no public list, by the name it reports: the
 * names DCS ships default profiles for ("MOZA AB9 FFB Base", "MOZA MTP Throttle Panel",
 * "MOZA MTLP Take-off Landing Panel"), and the AB6 base and MH16 grip of the same line.
 */
const MOZA_FLIGHT_NAME = /\b(ab\d|mtp|mtlp|mh16)\b/i;

export function simFamily(
  vendorId: string,
  productId: string,
  name?: string
): GameKind | undefined {
  const vendor = vendorId.toUpperCase();
  const byProduct = BY_PRODUCT[`${vendor}:${productId.toUpperCase()}`];
  if (byProduct) return byProduct;
  if (vendor === '346E' && name && MOZA_FLIGHT_NAME.test(name)) return 'flight';
  if (FLIGHT_VENDORS.has(vendor)) return 'flight';
  if (RACING_VENDORS.has(vendor)) return 'racing';
  return undefined;
}

/**
 * The family a device counts as. What the user said it is used for comes first: flight
 * or racing is that family, and "both" is no family, so it suits any setup. With nothing
 * said it is what RigReady knows of the maker.
 */
export function familyOf(
  device: { vendorId: string; productId: string; name?: string | undefined },
  said?: Pick<DeviceSaid, 'usedFor'>
): GameKind | undefined {
  if (said?.usedFor === 'both') return undefined;
  return said?.usedFor ?? simFamily(device.vendorId, device.productId, device.name);
}
