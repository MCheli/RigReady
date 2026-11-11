import { z } from 'zod';
import type { CheckContext, CheckDefinition } from '../../../../core/checks/registry';
import { WheelBrandSchema } from '../../contract';
import { productOf } from './products';

/**
 * The wheel rotation, only where a file or the registry holds it. Of every brand, only the
 * Fanatec driver writes it down where RigReady can read it: its cache of the hardware it
 * last saw (HKLM\SOFTWARE\WOW6432Node\Fanatec Endor AG\FanatecWheel\{GUID}\<slot>,
 * WheelRotation; docs/research/racing.md 5.3). It is what the driver last recorded, not a
 * live reading of the base. Moza, Logitech, Simagic, Thrustmaster, Simucube, Asetek and
 * Cammus keep it on the base or in a format nobody has documented
 * (docs/research/wheelbases.md), so no rotation is offered for them.
 */

const FANATEC_ROOT = 'SOFTWARE\\WOW6432Node\\Fanatec Endor AG\\FanatecWheel';

export async function readWheelRotation(
  ctx: CheckContext,
  brand: string | undefined
): Promise<number | undefined> {
  if (brand !== 'fanatec') return undefined;
  const guids = await ctx.ports.registry.listKeys('HKLM', FANATEC_ROOT);
  for (const guid of guids.ok ? guids.value : []) {
    const slots = await ctx.ports.registry.listKeys('HKLM', `${FANATEC_ROOT}\\${guid}`);
    for (const slot of slots.ok ? slots.value : []) {
      const values = await ctx.ports.registry.listValues(
        'HKLM',
        `${FANATEC_ROOT}\\${guid}\\${slot}`
      );
      const v = values.ok ? values.value['WheelRotation'] : undefined;
      if (v?.type === 'number' && v.value > 0) return v.value;
    }
  }
  return undefined;
}

export const WHEEL_ROTATION = 'racing.wheelRotation';
export const WheelRotationParamsSchema = z.object({
  brand: WheelBrandSchema,
  degrees: z.number().int().min(90).max(3600),
});

/** Optional check: the rotation the driver recorded is the one the setup expects. */
export const wheelRotationCheck: CheckDefinition<z.infer<typeof WheelRotationParamsSchema>> = {
  type: WHEEL_ROTATION,
  group: 'devices',
  label: 'Wheel rotation as expected',
  params: WheelRotationParamsSchema,
  async run(params, ctx) {
    // A recorded rotation says nothing about a base that is not here.
    const devices = await ctx.ports.devices.list();
    if (!devices.ok) return { pass: false, summary: devices.error.message };
    const connected = devices.value.some((d) => {
      const product = productOf(d.vendorId, d.productId);
      return product?.role === 'base' && product.brand === params.brand;
    });
    if (!connected) return { pass: false, summary: 'The wheel base is not connected' };
    const degrees = await readWheelRotation(ctx, params.brand);
    if (degrees === undefined)
      return {
        pass: false,
        summary: 'The rotation cannot be read',
        details: [
          params.brand === 'fanatec'
            ? 'The Fanatec driver has not recorded a rotation on this PC.'
            : 'Only the Fanatec driver records the rotation where RigReady can read it.',
        ],
      };
    if (degrees === params.degrees)
      return { pass: true, summary: `${degrees}°, as the driver last recorded it` };
    return {
      pass: false,
      summary: `${degrees}°, not ${params.degrees}°`,
      details: [
        'This is what the driver last recorded. Set the rotation on the base (SEN) or in the Fanatec App.',
      ],
    };
  },
};
