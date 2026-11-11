import { z } from 'zod';
import type { CheckContext, CheckDefinition, CheckOutcome } from '../../../../core/checks/registry';
import type { DeviceInfo, InputDevice } from '../../../../shared/models';
import type { WheelBrandId, WheelPart, WheelStatus } from '../../contract';
import { BACKUP_GAMES } from '../../contract';
import { axisName, neutralAxisName } from '../devices';
import { findProgram } from '../software';
import { brandOf, WHEEL_BRAND_LIST, type BrandSoftware, type WheelBrand } from './brands';
import { COMPATIBILITY_PID, FANATEC_VENDOR, productOf, type WheelProduct } from './products';

/**
 * The wheel base of any brand as Windows and games see it: which base, in which mode, the
 * rim and pedals beside it, what each axis is, and the maker's software. The brand comes
 * from the USB ids (./products.ts); what is known about it from ./brands.ts.
 */

export interface WheelPartFound extends WheelPart {
  device: DeviceInfo;
  product: WheelProduct;
}

/** Every wheel part on USB, in the order Windows lists them, one per USB device. */
export function wheelParts(devices: DeviceInfo[]): WheelPartFound[] {
  const out: WheelPartFound[] = [];
  for (const device of devices) {
    const product = productOf(device.vendorId, device.productId);
    if (!product) continue;
    out.push({
      role: product.role,
      name: device.name || product.name,
      vendorId: device.vendorId,
      productId: device.productId,
      device,
      product,
    });
  }
  return out;
}

export const wheelBases = (devices: DeviceInfo[]): WheelPartFound[] =>
  wheelParts(devices).filter((p) => p.role === 'base');

export function controllersOf(
  live: InputDevice[] | undefined,
  device: { vendorId: string; productId: string }
): InputDevice[] {
  return (live ?? []).filter(
    (d) => d.vendorId === device.vendorId && d.productId === device.productId
  );
}

/** The mode a base is in, as far as its USB id tells. */
export function modeOf(part: { vendorId: string; productId: string; product: WheelProduct }): {
  mode: WheelStatus['mode'];
  label: string;
} {
  const brand = brandOf(part.product.brand);
  if (part.vendorId === FANATEC_VENDOR && part.productId === COMPATIBILITY_PID)
    return { mode: 'compatibility', label: 'Compatibility (yellow) mode' };
  const mode = part.product.mode;
  if (mode === 'console' || mode === 'boot')
    return { mode: 'console', label: part.product.modeLabel ?? 'Console mode' };
  if (brand?.modeDetectable || mode === 'pc')
    return { mode: 'pc', label: part.product.modeLabel ?? brand?.pcModeLabel ?? 'PC mode' };
  return { mode: 'unknown', label: 'Mode not shown by its USB id' };
}

export interface SoftwareState {
  software: BrandSoftware;
  installed: boolean;
  version?: string;
  running: boolean;
  /** Where to start it from, when known. */
  exe?: string;
  /** The state of its Windows service, when it has one. */
  service?: 'running' | 'stopped' | 'absent';
}

/** What of a brand's software is on this PC, installed and running. */
export async function softwareStates(
  ctx: CheckContext,
  brand: WheelBrand
): Promise<SoftwareState[]> {
  const list = await ctx.ports.processes.list();
  const processes = list.ok ? list.value : [];
  const out: SoftwareState[] = [];
  for (const software of brand.software) {
    const program = software.uninstall ? await findProgram(ctx, software.uninstall) : undefined;
    const proc = software.process
      ? processes.find((p) => p.name.toLowerCase() === software.process!.toLowerCase())
      : undefined;
    let exe: string | undefined;
    for (const candidate of software.exe?.(ctx.ports.folders) ?? []) {
      if (await ctx.ports.files.exists(candidate)) {
        exe = candidate;
        break;
      }
    }
    exe ??= proc?.path;
    let service: SoftwareState['service'];
    if (software.service) {
      const s = await ctx.ports.services.get(software.service);
      service = s.ok && s.value ? (s.value.state === 'running' ? 'running' : 'stopped') : 'absent';
    }
    out.push({
      software,
      installed:
        program !== undefined ||
        exe !== undefined ||
        proc !== undefined ||
        (service !== undefined && service !== 'absent'),
      running: proc !== undefined || service === 'running',
      ...(program?.version ? { version: program.version } : {}),
      ...(exe ? { exe } : {}),
      ...(service ? { service } : {}),
    });
  }
  return out;
}

function softwareRow(state: SoftwareState): WheelStatus['software'][number] {
  const { software } = state;
  if (!state.installed)
    return { label: `${software.name} (${software.purpose})`, value: 'Not installed', ok: false };
  const parts = ['Installed'];
  if (state.version) parts.push(state.version);
  if (software.process || software.service) parts.push(state.running ? 'running' : 'not running');
  return {
    label: `${software.name} (${software.purpose})`,
    value: parts.join(' · '),
    ok: software.process || software.service ? state.running : true,
  };
}

/** The brand whose software or traces are on a PC with no base connected. */
async function brandWithoutBase(ctx: CheckContext): Promise<WheelBrand | undefined> {
  for (const brand of WHEEL_BRAND_LIST) {
    if (brand.id === 'fanatec') continue;
    const states = await softwareStates(ctx, brand);
    if (states.some((s) => s.installed)) return brand;
  }
  return undefined;
}

/** The brand-neutral half of the Wheel page; Fanatec adds its own (../fanatec/fanatec.ts). */
export async function wheelBaseStatus(
  ctx: CheckContext,
  options: { fanatecTraces: boolean }
): Promise<{ status: WheelStatus; brand?: WheelBrand; states: SoftwareState[] }> {
  const devices = await ctx.ports.devices.list();
  const all = devices.ok ? devices.value : [];
  const started = await ctx.ports.input.start();
  const live = started.ok ? started.value : undefined;
  const parts = wheelParts(all);
  const base = parts.find((p) => p.role === 'base');
  let brand = brandOf(base?.product.brand);
  if (!brand) brand = options.fanatecTraces ? brandOf('fanatec') : await brandWithoutBase(ctx);
  if (!brand) {
    // No base and no wheel software: nothing to say about any brand.
    return {
      status: {
        connected: false,
        verifiedOnHardware: false,
        mode: 'none',
        controllers: 0,
        accessories: [],
        parts: [],
        axes: [],
        axesSourced: false,
        software: [],
        profiles: [],
        recommendedLinks: [],
        others: [],
        lastSeen: [],
      },
      states: [],
    };
  }
  const own = parts.filter((p) => p.product.brand === brand.id);
  const status: WheelStatus = {
    connected: base !== undefined,
    brand: brand.id as WheelBrandId,
    brandName: brand.name,
    verifiedOnHardware: brand.verifiedOnHardware,
    mode: 'none',
    controllers: 0,
    accessories: own.filter((p) => p.role !== 'base').map((p) => p.product.name),
    parts: own
      .filter((p) => p.role !== 'base' || p === base)
      .map(({ role, name, vendorId, productId }) => ({ role, name, vendorId, productId })),
    axes: [],
    axesSourced: false,
    software: [],
    softwareNote: brand.softwareNote,
    profiles: [],
    recommendedLinks: brand.recommendedLinks ?? [],
    others: parts
      .filter((p) => p.role === 'base' && p !== base)
      .map((p) => `${brandOf(p.product.brand)?.name ?? ''} ${p.product.name}`.trim()),
    lastSeen: [],
  };
  if (base) {
    const { mode, label } = modeOf(base);
    status.mode = mode;
    status.modeLabel = label;
    if (mode !== 'pc' && mode !== 'unknown' && brand.modeHelp) status.modeHelp = brand.modeHelp;
    status.name = base.device.name || base.product.name;
    status.vendorId = base.vendorId;
    status.productId = base.productId;
    const controllers = controllersOf(live, base);
    status.controllers = controllers.length;
    if (brand.controllersNote) status.controllersNote = brand.controllersNote;
    const hub = base.device.hubChain[0]?.name;
    if (hub) status.connection = hub;
    const axes = controllers[0]?.axisNames ?? [];
    status.axes = axes.map((a) => {
      const axis = neutralAxisName(a);
      return { axis, name: axisName(axis, base.vendorId, base.productId) };
    });
    status.axesSourced = brand.baseAxes !== undefined;
  }
  const states = await softwareStates(ctx, brand);
  status.software = states.map(softwareRow);
  for (const p of brand.profiles) {
    const file = p.path(ctx.ports.folders);
    status.profiles.push({
      label: p.label,
      path: file,
      present: await ctx.ports.files.exists(file),
    });
  }
  if (brand.profiles.length > 0 && (BACKUP_GAMES as readonly string[]).includes(brand.id))
    status.backup = brand.id;
  return { status, brand, states };
}

// ---------------------------------------------------------------- The base check

export const WHEEL_BASE = 'racing.wheelBase';

export const WheelBaseParamsSchema = z.object({
  vendorId: z
    .string()
    .regex(/^[0-9A-Fa-f]{4}$/)
    .default(FANATEC_VENDOR),
  productId: z.string().regex(/^[0-9A-Fa-f]{4}$/),
});
export type WheelBaseParams = z.infer<typeof WheelBaseParamsSchema>;

const nameOf = (vendorId: string, productId: string): string => {
  const product = productOf(vendorId, productId);
  if (!product) return `${vendorId}:${productId}`;
  return `${brandOf(product.brand)?.name ?? ''} ${product.name}`.trim();
};

function controllerLine(count: number, brand: WheelBrand | undefined): string {
  if (count >= 2)
    return brand?.controllersNote
      ? `Games see it as ${count} controllers with the same name; that is normal for this base.`
      : `Games see it as ${count} controllers.`;
  if (count === 1) return 'Games see it as one controller.';
  return 'Games do not see it as a controller yet.';
}

/** Is the expected base connected, in the expected mode? Any brand. */
export async function runWheelBaseCheck(
  params: WheelBaseParams,
  ctx: CheckContext
): Promise<CheckOutcome> {
  const devices = await ctx.ports.devices.list();
  if (!devices.ok) return { pass: false, summary: devices.error.message };
  const vendorId = params.vendorId.toUpperCase();
  const productId = params.productId.toUpperCase();
  const expected = productOf(vendorId, productId);
  const brand = brandOf(expected?.brand);
  const started = await ctx.ports.input.start();
  const live = started.ok ? started.value : undefined;
  const found = devices.value.find((d) => d.vendorId === vendorId && d.productId === productId);
  if (found) {
    const count = controllersOf(live, found).length;
    const details = [controllerLine(count, brand)];
    const hub = found.hubChain[0]?.name;
    if (hub && /hub/i.test(hub))
      details.push(
        `Connected through ${hub}. Wheel makers and iRacing advise a port on the PC itself.`
      );
    if (live && count === 0) {
      return {
        pass: false,
        summary: 'Connected, but games cannot see it',
        details: [
          `Windows lists the base on USB but no game controller for it. Check the ${brand?.name ?? 'wheel'} driver or software.`,
        ],
      };
    }
    const mode = expected
      ? modeOf({ vendorId, productId, product: expected })
      : { mode: 'unknown' as const, label: '' };
    if (mode.mode === 'console' && expected) {
      // The setup was made with the base in this mode: it is what the setup expects.
      details.push(`It reports itself in ${mode.label}.`);
    }
    return { pass: true, summary: `Connected${mode.mode === 'pc' ? ' in PC mode' : ''}`, details };
  }
  const bases = wheelBases(devices.value);
  // The same base in another mode: the brand's other ids are on USB, the expected one is not.
  if (expected?.role === 'base' && vendorId === FANATEC_VENDOR) {
    const compatible = bases.find(
      (b) => b.vendorId === FANATEC_VENDOR && b.productId === COMPATIBILITY_PID
    );
    if (compatible && productId !== COMPATIBILITY_PID) {
      return {
        pass: false,
        summary: 'In compatibility (yellow) mode',
        details: [
          `The base reports itself as a ClubSport V2.5 (0EB7:0004), so bindings saved in PC mode do not match it.`,
          'Switch the base to PC (red) mode in its tuning menu or the Fanatec App.',
        ],
      };
    }
  }
  const otherMode = bases.find(
    (b) =>
      b.product.brand === expected?.brand &&
      (b.product.mode === 'console' || b.product.mode === 'boot')
  );
  if (otherMode && expected) {
    return {
      pass: false,
      summary: `In ${otherMode.product.modeLabel ?? 'another mode'}`,
      details: [
        `The base reports itself as ${otherMode.vendorId}:${otherMode.productId}, not ${vendorId}:${productId}, so bindings saved in PC mode may not match it.`,
        ...(brand?.modeHelp ? [brand.modeHelp] : []),
      ],
    };
  }
  const other = bases[0];
  if (other) {
    return {
      pass: false,
      summary: `A different base is connected: ${
        other.product.brand === expected?.brand
          ? other.product.name
          : nameOf(other.vendorId, other.productId)
      }`,
    };
  }
  return { pass: false, summary: 'Not connected' };
}

export const wheelBaseCheck: CheckDefinition<WheelBaseParams> = {
  type: WHEEL_BASE,
  group: 'devices',
  label: 'Wheel base connected in the right mode',
  params: WheelBaseParamsSchema,
  run: runWheelBaseCheck,
};

export type { BrandSoftware };
