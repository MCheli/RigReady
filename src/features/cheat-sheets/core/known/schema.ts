import { z } from 'zod';
import { ControlIdSchema } from '../controlId';

/**
 * A known device: a controller model RigReady has no drawing or layout of, but whose
 * controls it can name. Its sheet is still the controls list (no picture), with one block
 * per physical control ("H2 TMS hat · 7–10", a row per direction) instead of buttons in
 * runs of eight. Where the names come from is in docs/research/device-control-names.md:
 * the per-device default bindings DCS World ships, cross-checked with the maker's manual.
 */

const hex4 = z
  .string()
  .regex(/^[0-9A-Fa-f]{4}$/)
  .transform((v) => v.toUpperCase());

export const KnownInputSchema = z.object({
  id: ControlIdSchema,
  /** The word for this input on its control: "↑", "Press", "Aft". */
  tag: z.string().min(1).max(12).optional(),
});
export type KnownInput = z.infer<typeof KnownInputSchema>;

export const KnownControlSchema = z.object({
  /** Stable within the device: "h2", "tg". */
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  /** What the maker calls it: "H2 TMS hat", "TG1 trigger, first stage". */
  name: z.string().min(1).max(48),
  inputs: z.array(KnownInputSchema).min(1).max(16),
});
export type KnownControl = z.infer<typeof KnownControlSchema>;

export const KnownDeviceSchema = z
  .object({
    /** "tm-warthog-stick". */
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    /** "Thrustmaster HOTAS Warthog joystick". */
    name: z.string().min(1).max(80),
    match: z
      .object({
        vendorId: hex4,
        productIds: z.array(hex4).max(16).default([]),
        /**
         * Parts of the name the device reports, any case, for models whose product id is
         * set by the firmware (VKB, Virpil) or not known. Tried after the product ids of
         * every known device.
         */
        names: z.array(z.string().min(4).max(60)).max(8).default([]),
      })
      .refine((m) => m.productIds.length > 0 || m.names.length > 0, {
        message: 'A known device says which devices it is: a product id or a part of the name.',
      }),
    /** What the device reports with its stock firmware: the inputs above stay inside it. */
    shape: z.object({
      buttons: z.number().int().min(0).max(128),
      hats: z.number().int().min(0).max(4),
      axes: z.array(z.enum(['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1', 'SLIDER2'])),
    }),
    /**
     * The numbering is the stock one: a device whose buttons can be renumbered (VKB,
     * Virpil, a TARGET profile) reads differently once someone has.
     */
    configurable: z.boolean().default(false),
    /** Shown under the sheet's title. */
    notes: z.string().max(400).optional(),
    controls: z.array(KnownControlSchema).min(1).max(80),
  })
  .superRefine((device, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    const inputs = new Set<string>();
    for (const control of device.controls) {
      if (ids.has(control.id)) ctx.addIssue({ code: 'custom', message: `${control.id} twice` });
      if (names.has(control.name)) {
        ctx.addIssue({ code: 'custom', message: `The name "${control.name}" twice` });
      }
      ids.add(control.id);
      names.add(control.name);
      for (const input of control.inputs) {
        if (inputs.has(input.id)) ctx.addIssue({ code: 'custom', message: `${input.id} twice` });
        inputs.add(input.id);
        const reason = outOfShape(input.id, device.shape);
        if (reason) ctx.addIssue({ code: 'custom', message: `${input.id}: ${reason}` });
      }
    }
  });
export type KnownDevice = z.infer<typeof KnownDeviceSchema>;
export type KnownDeviceInput = z.input<typeof KnownDeviceSchema>;

/** Why an input is not one the device reports, or undefined when it is. */
export function outOfShape(id: string, shape: KnownDevice['shape']): string | undefined {
  const [kind, a] = id.split(':');
  if (kind === 'button' && Number(a) > shape.buttons) {
    return `the device has ${shape.buttons} buttons`;
  }
  if (kind === 'hat' && Number(a) > shape.hats) return `the device has ${shape.hats} hats`;
  if (kind === 'axis' && !(shape.axes as string[]).includes(a ?? '')) {
    return `the device has no ${a} axis`;
  }
  return undefined;
}
