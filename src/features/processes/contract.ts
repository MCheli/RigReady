import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';

/** An image name as Windows reports it ("SimTool.exe"): no folder, nothing a file name cannot hold. */
export const ImageNameSchema = z
  .string()
  .max(100)
  .regex(/^[^\\/:*?"<>|\x00-\x1f]+\.exe$/i, 'An image name such as SimTool.exe');

/** The apps the user asked RigReady to offer in every new setup, as the Settings page shows them. */
export const OwnAppsViewSchema = z.object({
  /** `<data folder>/processes/known.json`. */
  file: z.string(),
  apps: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      /** Where it ran when it was added, as Windows reported it. */
      path: z.string(),
      closeAtStandDown: z.boolean(),
    })
  ),
  /** Entries in the file that RigReady does not use, each with why. */
  refused: z.array(z.object({ name: z.string(), why: z.string() })),
});
export type OwnAppsView = z.infer<typeof OwnAppsViewSchema>;

export const processesContract = defineContract('processes', {
  ownApps: channel(noInput, OwnAppsViewSchema, {
    describe:
      'Lists the programs the user asked RigReady to offer in every new setup ("Always offer this app" on the New setup page), and the entries of that list it does not use with why. Changes nothing.',
    tier: 'read',
  }),
  changeOwnApp: channel(
    z.object({
      name: ImageNameSchema,
      title: z.string().trim().min(1).max(80).optional(),
      closeAtStandDown: z.boolean().optional(),
    }),
    OwnAppsViewSchema,
    {
      describe:
        "Renames one of the user's own apps to offer, or says whether Stand down closes it. name comes from processes:ownApps. Changes RigReady's own list only.",
      tier: 'change',
    }
  ),
  forgetOwnApp: channel(z.object({ name: ImageNameSchema }), OwnAppsViewSchema, {
    describe:
      "Takes a program off the user's own list of apps to offer in every new setup. Setups made already keep their check. name comes from processes:ownApps.",
    tier: 'change',
  }),
});
