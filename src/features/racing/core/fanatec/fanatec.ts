import path from 'node:path';
import type { CheckContext } from '../../../../core/checks/registry';
import type { DeviceInfo } from '../../../../shared/models';
import type { WheelStatus } from '../../contract';
import { FANATEC_PRODUCTS, FANATEC_VENDOR } from '../devices';
import { findProgram } from '../software';
import { wheelBaseStatus } from '../wheelbases/wheel';

/**
 * The Fanatec wheel base as Windows and games see it (docs/research/racing.md 1.3, 5).
 * A Podium DD2 is USB 0EB7:0007 with no serial number; games see it as two DirectInput
 * controllers with the same name (both are the base, neither is a duplicate). In
 * compatibility (yellow) mode it reports 0EB7:0004 like a ClubSport V2.5, and bindings
 * made in PC (red) mode no longer match. The brand-neutral part of the page and the base
 * check are in ../wheelbases/wheel.ts.
 */

export function fanatecBases(devices: DeviceInfo[]): DeviceInfo[] {
  return devices.filter(
    (d) => d.vendorId === FANATEC_VENDOR && FANATEC_PRODUCTS[d.productId]?.base
  );
}

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

/** The Fanatec software rows: driver, wheel service, Fanatec Service and the App. */
async function fanatecSoftware(ctx: CheckContext): Promise<WheelStatus['software']> {
  const driver = await findProgram(ctx, /^FANATEC driver package/i);
  const app = await findProgram(ctx, /^FanatecApp/i);
  const pnp = await ctx.ports.services.get('FWPnpService');
  const processes = await ctx.ports.processes.list();
  const running = (name: string): boolean =>
    processes.ok && processes.value.some((p) => p.name.toLowerCase() === name.toLowerCase());
  return [
    {
      label: 'Fanatec driver',
      value: driver ? `Installed${driver.version ? ` · ${driver.version}` : ''}` : 'Not installed',
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
  ];
}

/**
 * The Wheel page's status: the brand-neutral part (../wheelbases/wheel.ts), and for a
 * Fanatec base, or a PC with Fanatec software and no other base, what the Fanatec driver
 * shows besides.
 */
export async function wheelStatus(ctx: CheckContext): Promise<WheelStatus> {
  const software = await fanatecSoftware(ctx);
  const seen = await lastSeen(ctx);
  const fanatecTraces = seen.length > 0 || software.some((s) => s.ok);
  const { status } = await wheelBaseStatus(ctx, { fanatecTraces });
  if (status.brand !== 'fanatec') return status;
  status.software = software;
  status.lastSeen = seen;
  const firmware = await shippedFirmware(ctx);
  if (firmware) status.firmwareShipped = firmware;
  return status;
}
