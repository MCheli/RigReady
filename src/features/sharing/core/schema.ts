import { z } from 'zod';

export const CompatibilitySchema = z.object({
  hardware: z
    .array(
      z.object({
        name: z.string().max(200),
        vendorId: z.string().regex(/^[0-9A-F]{4}$/),
        productId: z.string().regex(/^[0-9A-F]{4}$/),
        required: z.boolean(),
      })
    )
    .max(200),
  software: z
    .array(
      z.object({
        name: z.string().max(200),
        kind: z.enum(['game', 'app']),
        required: z.boolean(),
        /** Game module id, for games. */
        game: z.string().max(64).optional(),
        /** Process name, for helper apps: "TrackIR5.exe". */
        process: z.string().max(200).optional(),
        /** How the game was installed where the setup was made. */
        source: z.string().max(40).optional(),
      })
    )
    .max(200),
  displays: z
    .object({
      count: z.number().int().min(0).max(32),
      summary: z.string().max(500),
    })
    .optional(),
});
export type Compatibility = z.infer<typeof CompatibilitySchema>;

/** The shapes a picture of a setup comes in: 16:9, or square. */
export const PictureShapeSchema = z.enum(['wide', 'square']);
export type PictureShape = z.infer<typeof PictureShapeSchema>;
