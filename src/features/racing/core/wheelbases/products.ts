/**
 * Wheel bases, rims and pedals of every major brand, by USB vendor and product id
 * (docs/research/wheelbases.md; Fanatec: docs/research/racing.md 1.3). Plain data, imported
 * by the controller helpers (../devices.ts) and the brand model (./brands.ts).
 *
 * Only Fanatec has been seen on a real wheel (the owner's Podium DD2). Every other id is
 * from the sources in the research note and has been tested on synthetic fixtures only.
 */

export type WheelRole = 'base' | 'rim' | 'pedals' | 'shifter' | 'handbrake' | 'other';

/**
 * pc: the base reports itself as what it is. compatibility: Fanatec's yellow mode.
 * console: a console mode (PlayStation, Xbox) or a legacy emulation. boot: a generic id the
 * base shows before its driver switches it to its own.
 */
export type WheelMode = 'pc' | 'compatibility' | 'console' | 'boot';

export interface WheelProduct {
  brand: string;
  name: string;
  role: WheelRole;
  /** Set only where the id says which mode the base is in. */
  mode?: WheelMode;
  /** For a non-PC id: the mode in words ("PS4 mode"). */
  modeLabel?: string;
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

const FANATEC_ROLES: Record<string, WheelRole> = {
  '183B': 'pedals',
  '6204': 'pedals',
  '6205': 'pedals',
  '6206': 'pedals',
  '1A92': 'shifter',
  '1A93': 'handbrake',
};

type Table = Record<string, Omit<WheelProduct, 'brand'>>;

/** Other brands: "VVVV:PPPP" -> product. Sources per row in docs/research/wheelbases.md. */
const OTHER_BRANDS: Record<string, Table> = {
  // Moza: the kernel's hid-ids.h. Each base has two ids; no source says what the second
  // one means, so both are the same model and neither is called a mode.
  moza: {
    '346E:0000': { name: 'R16 / R21', role: 'base' },
    '346E:0010': { name: 'R16 / R21', role: 'base' },
    '346E:0002': { name: 'R9', role: 'base' },
    '346E:0012': { name: 'R9', role: 'base' },
    '346E:0004': { name: 'R5', role: 'base' },
    '346E:0014': { name: 'R5', role: 'base' },
    '346E:0005': { name: 'R3', role: 'base' },
    '346E:0015': { name: 'R3', role: 'base' },
    '346E:0006': { name: 'R12', role: 'base' },
    '346E:0016': { name: 'R12', role: 'base' },
  },
  // Logitech: hid-ids.h, new-lg4ff and Logitech's driver INF. Only the G29's switch shows
  // in the id; Logitech advises the PS4 position on a PC.
  logitech: {
    '046D:C24F': {
      name: 'G29 Driving Force',
      role: 'base',
      mode: 'console',
      modeLabel: 'PS3 switch position',
    },
    '046D:C260': { name: 'G29 Driving Force', role: 'base', mode: 'pc' },
    '046D:C262': { name: 'G920 Driving Force', role: 'base', mode: 'pc' },
    '046D:C266': { name: 'G923 (PlayStation and PC)', role: 'base', mode: 'pc' },
    '046D:C267': { name: 'G923 (PlayStation and PC)', role: 'base', mode: 'pc' },
    '046D:C26D': { name: 'G923 (Xbox and PC)', role: 'base', mode: 'pc' },
    '046D:C26E': { name: 'G923 (Xbox and PC)', role: 'base', mode: 'pc' },
    '046D:C268': { name: 'PRO Racing Wheel (PlayStation and PC)', role: 'base', mode: 'pc' },
    '046D:C272': { name: 'PRO Racing Wheel (Xbox and PC)', role: 'base', mode: 'pc' },
    '046D:C29B': { name: 'G27', role: 'base', mode: 'pc' },
    '046D:C299': { name: 'G25', role: 'base', mode: 'pc' },
  },
  // Simagic: JacKeTUs/simagic-ff and the steering-wheels table. 0483 is STMicroelectronics'
  // generic vendor id (VRS uses 0483:A355); 0483:0522 is the Alpha family and the M10.
  simagic: {
    '0483:0522': { name: 'Alpha / Alpha Mini / Alpha U / M10', role: 'base' },
    '3670:0500': { name: 'EVO Sport', role: 'base' },
    '3670:0501': { name: 'EVO', role: 'base' },
    '3670:0502': { name: 'EVO Pro', role: 'base' },
  },
  // Thrustmaster: hid-thrustmaster.c and hid-tmff2. Every belt wheel starts as B65D and
  // the driver switches it to its own id; one still on B65D was not switched.
  thrustmaster: {
    '044F:B65D': {
      name: 'FFB Wheel (not switched by the driver yet)',
      role: 'base',
      mode: 'boot',
      modeLabel: 'the generic mode it starts in, before the Thrustmaster driver switches it',
    },
    '044F:B66E': { name: 'T300 RS', role: 'base', mode: 'pc' },
    '044F:B66F': {
      name: 'T300 RS',
      role: 'base',
      mode: 'console',
      modeLabel: 'PS3 advanced (F1) mode',
    },
    '044F:B66D': { name: 'T300 RS', role: 'base', mode: 'console', modeLabel: 'PS4 mode' },
    '044F:B696': { name: 'T248', role: 'base', mode: 'pc' },
    '044F:B669': { name: 'TX Racing Wheel', role: 'base', mode: 'pc' },
    '044F:B692': { name: 'TS-XW Racer', role: 'base', mode: 'pc' },
    '044F:B689': { name: 'TS-PC Racer', role: 'base', mode: 'pc' },
    '044F:B677': { name: 'T150', role: 'base', mode: 'pc' },
    '044F:B65E': { name: 'T500 RS', role: 'base', mode: 'pc' },
  },
  // Simucube: the steering-wheels table. 16D0 is a shared vendor id (MCS); the products are Simucube's.
  simucube: {
    '16D0:0D5A': { name: 'Simucube 1', role: 'base' },
    '16D0:0D61': { name: 'Simucube 2 Sport', role: 'base' },
    '16D0:0D60': { name: 'Simucube 2 Pro', role: 'base' },
    '16D0:0D5F': { name: 'Simucube 2 Ultimate', role: 'base' },
  },
  asetek: {
    '2433:F300': { name: 'Invicta', role: 'base' },
    '2433:F301': { name: 'Forte', role: 'base' },
    '2433:F303': { name: 'La Prima', role: 'base' },
    '2433:F306': { name: 'Tony Kanaan Edition', role: 'base' },
  },
  cammus: {
    '3416:0301': { name: 'C5', role: 'base' },
    '3416:0302': { name: 'C12', role: 'base' },
  },
};

function build(): Record<string, WheelProduct> {
  const out: Record<string, WheelProduct> = {};
  for (const [pid, p] of Object.entries(FANATEC_PRODUCTS))
    out[`${FANATEC_VENDOR}:${pid}`] = {
      brand: 'fanatec',
      name: p.name,
      role: p.base ? 'base' : FANATEC_ROLES[pid]!,
    };
  for (const [brand, table] of Object.entries(OTHER_BRANDS))
    for (const [id, p] of Object.entries(table)) out[id] = { ...p, brand };
  return out;
}

/** Every known product, by upper-case "VVVV:PPPP". */
export const WHEEL_PRODUCTS: Readonly<Record<string, WheelProduct>> = build();

export function productOf(
  vendorId: string | undefined,
  productId: string | undefined
): WheelProduct | undefined {
  if (!vendorId || !productId) return undefined;
  return WHEEL_PRODUCTS[`${vendorId.toUpperCase()}:${productId.toUpperCase()}`];
}
