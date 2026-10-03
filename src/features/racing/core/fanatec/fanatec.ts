import path from 'node:path';
import { z } from 'zod';
import type { CheckContext, CheckDefinition, CheckOutcome } from '../../../../core/checks/registry';
import type { DeviceInfo, InputDevice } from '../../../../shared/models';
import type { WheelStatus } from '../../contract';
import { COMPATIBILITY_PID, FANATEC_PRODUCTS, FANATEC_VENDOR } from '../devices';
import { findProgram } from '../software';

/**
 * The Fanatec wheel base as Windows and games see it (docs/research/racing.md 1.3, 5).
 * A Podium DD2 is USB 0EB7:0007 with no serial number; games see it as two DirectInput
 * controllers with the same name (both are the base, neither is a duplicate). In
 * compatibility (yellow) mode it reports 0EB7:0004 like a ClubSport V2.5, and bindings
 * made in PC (red) mode no longer match.
 */

export const WHEEL_BASE = 'racing.wheelBase';

export const WheelBaseParamsSchema = z.object({
  vendorId: z
    .string()
    .regex(/^[0-9A-Fa-f]{4}$/)
    .default(FANATEC_VENDOR),
  productId: z.string().regex(/^[0-9A-Fa-f]{4}$/),
});
export type WheelBaseParams = z.infer<typeof WheelBaseParamsSchema>;

const productName = (pid: string): string =>
  FANATEC_PRODUCTS[pid.toUpperCase()]?.name ?? `Fanatec ${pid}`;

export function fanatecBases(devices: DeviceInfo[]): DeviceInfo[] {
  return devices.filter(
    (d) => d.vendorId === FANATEC_VENDOR && FANATEC_PRODUCTS[d.productId]?.base
  );
}

function controllersOf(
  live: InputDevice[] | undefined,
  device: { vendorId: string; productId: string }
): InputDevice[] {
  return (live ?? []).filter(
    (d) => d.vendorId === device.vendorId && d.productId === device.productId
  );
}

function controllerLine(count: number): string {
  if (count >= 2)
    return `Games see it as ${count} controllers with the same name; that is normal for this base.`;
  if (count === 1) return 'Games see it as one controller.';
  return 'Games do not see it as a controller yet.';
}

/** Is the expected base connected, in the expected mode? */
export async function runWheelBaseCheck(
  params: WheelBaseParams,
  ctx: CheckContext
): Promise<CheckOutcome> {
  const devices = await ctx.ports.devices.list();
  if (!devices.ok) return { pass: false, summary: devices.error.message };
  const vendorId = params.vendorId.toUpperCase();
  const productId = params.productId.toUpperCase();
  const started = await ctx.ports.input.start();
  const live = started.ok ? started.value : undefined;
  const found = devices.value.find((d) => d.vendorId === vendorId && d.productId === productId);
  if (found) {
    const count = controllersOf(live, found).length;
    const details = [controllerLine(count)];
    const hub = found.hubChain[0]?.name;
    if (hub && /hub/i.test(hub))
      details.push(`Connected through ${hub}. Fanatec and iRacing advise a port on the PC itself.`);
    if (live && count === 0) {
      return {
        pass: false,
        summary: 'Connected, but games cannot see it',
        details: [
          'Windows lists the base on USB but no game controller for it. Check the Fanatec driver.',
        ],
      };
    }
    const mode = productId === COMPATIBILITY_PID ? '' : ' in PC mode';
    return { pass: true, summary: `Connected${mode}`, details };
  }
  const bases = fanatecBases(devices.value);
  const compatible = bases.find((d) => d.productId === COMPATIBILITY_PID);
  if (compatible && FANATEC_PRODUCTS[productId]?.base && productId !== COMPATIBILITY_PID) {
    return {
      pass: false,
      summary: 'In compatibility (yellow) mode',
      details: [
        `The base reports itself as a ClubSport V2.5 (0EB7:0004), so bindings saved in PC mode do not match it.`,
        'Switch the base to PC (red) mode in its tuning menu or the Fanatec App.',
      ],
    };
  }
  const other = bases[0];
  if (other) {
    return {
      pass: false,
      summary: `A different base is connected: ${productName(other.productId)}`,
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

/** Fanatec's own firmware list shipped with the driver: <PDD>3.6.1.2</PDD>. */
async function shippedFirmware(ctx: CheckContext): Promise<string | undefined> {
  const file = path.join(
    ctx.ports.folders.programFiles(),
    'Fanatec',
    'Fanatec Wheel',
    'fw',
    'versions.xml'
  );
  if (!(await ctx.ports.files.exists(file))) return undefined;
  const text = await ctx.ports.files.readText(file);
  return text.ok ? /<PDD>([^<]+)<\/PDD>/.exec(text.value)?.[1]?.trim() : undefined;
}

/** The driver's cache of the hardware it last saw (readable without admin rights). */
async function lastSeen(ctx: CheckContext): Promise<{ label: string; value: string }[]> {
  const root = 'SOFTWARE\\WOW6432Node\\Fanatec Endor AG\\FanatecWheel';
  const rims = new Set<number>();
  let wheelRotation: number | undefined;
  const guids = await ctx.ports.registry.listKeys('HKLM', root);
  for (const guid of guids.ok ? guids.value : []) {
    const slots = await ctx.ports.registry.listKeys('HKLM', `${root}\\${guid}`);
    for (const slot of slots.ok ? slots.value : []) {
      const values = await ctx.ports.registry.listValues('HKLM', `${root}\\${guid}\\${slot}`);
      if (!values.ok) continue;
      const num = (name: string): number | undefined => {
        const v = values.value[name];
        return v?.type === 'number' ? v.value : undefined;
      };
      const rim = num('RimType');
      const rotation = num('WheelRotation');
      if (rim !== undefined && rim !== 0) rims.add(rim);
      if (rotation !== undefined && rotation > 0) wheelRotation ??= rotation;
    }
  }
  const out: { label: string; value: string }[] = [];
  // Fanatec does not publish what the rim codes mean, so they are shown as codes.
  if (rims.size > 0) {
    out.push({
      label: rims.size === 1 ? 'Steering wheel (rim) code' : 'Steering wheel (rim) codes',
      value: [...rims].sort((a, b) => a - b).join(', '),
    });
  }
  if (wheelRotation !== undefined)
    out.push({ label: 'Wheel rotation', value: `${wheelRotation}°` });
  return out;
}

export async function wheelStatus(ctx: CheckContext): Promise<WheelStatus> {
  const devices = await ctx.ports.devices.list();
  const all = devices.ok ? devices.value : [];
  const started = await ctx.ports.input.start();
  const live = started.ok ? started.value : undefined;
  const base = fanatecBases(all)[0];
  const accessories = all
    .filter(
      (d) =>
        d.vendorId === FANATEC_VENDOR &&
        FANATEC_PRODUCTS[d.productId] &&
        !FANATEC_PRODUCTS[d.productId]!.base
    )
    .map((d) => productName(d.productId));
  const driver = await findProgram(ctx, /^FANATEC driver package/i);
  const app = await findProgram(ctx, /^FanatecApp/i);
  const pnp = await ctx.ports.services.get('FWPnpService');
  const processes = await ctx.ports.processes.list();
  const running = (name: string): boolean =>
    processes.ok && processes.value.some((p) => p.name.toLowerCase() === name.toLowerCase());
  const status: WheelStatus = {
    connected: base !== undefined,
    mode: base ? (base.productId === COMPATIBILITY_PID ? 'compatibility' : 'pc') : 'none',
    controllers: base ? controllersOf(live, base).length : 0,
    accessories,
    software: [
      {
        label: 'Fanatec driver',
        value: driver
          ? `Installed${driver.version ? ` · ${driver.version}` : ''}`
          : 'Not installed',
        ok: driver !== undefined,
      },
      {
        label: 'Fanatec Wheel Service (FWPnpService)',
        value:
          pnp.ok && pnp.value
            ? pnp.value.state === 'running'
              ? 'Running'
              : 'Not running'
            : 'Not installed',
        ok: pnp.ok && pnp.value?.state === 'running',
      },
      {
        label: 'Fanatec Service (LEDs, displays, game integration)',
        value: running('FanatecService.exe') ? 'Running' : 'Not running',
        ok: running('FanatecService.exe'),
      },
      {
        label: 'Fanatec App',
        value: app
          ? `Installed${app.version ? ` · ${app.version}` : ''}${running('Fanatec.exe') ? ' · open' : ''}`
          : 'Not installed',
        ok: app !== undefined,
      },
    ],
    lastSeen: await lastSeen(ctx),
  };
  if (base) {
    status.name = base.name || productName(base.productId);
    status.vendorId = base.vendorId;
    status.productId = base.productId;
    const hub = base.hubChain[0]?.name;
    if (hub) status.connection = hub;
  }
  const firmware = await shippedFirmware(ctx);
  if (firmware) status.firmwareShipped = firmware;
  return status;
}
