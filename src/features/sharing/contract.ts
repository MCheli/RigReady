import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { CompatibilitySchema, PictureShapeSchema } from './core/schema';

const FindingSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'path',
    'instancePath',
    'audioId',
    'serial',
    'machineName',
    'userName',
    'deviceId',
    'unchecked',
  ]),
  value: z.string(),
  removeText: z.string(),
  where: z.array(z.string()),
  defaultAction: z.enum(['keep', 'remove']),
});
export type FindingView = z.infer<typeof FindingSchema>;

const StrippedSchema = z.object({
  kind: z.enum(['launch', 'check', 'fix', 'action']),
  name: z.string(),
  description: z.string(),
});

const PathReason = z.object({ path: z.string(), reason: z.string() });

const ReviewSchema = z.object({
  profileName: z.string(),
  game: z.string().optional(),
  items: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      path: z.string(),
      fileCount: z.number(),
      totalBytes: z.number(),
      problem: z.string().optional(),
    })
  ),
  findings: z.array(FindingSchema),
  stripped: z.array(StrippedSchema),
  excluded: z.array(PathReason),
  files: z.array(z.object({ group: z.string(), path: z.string(), size: z.number() })),
  compatibility: CompatibilitySchema,
  notes: z.string(),
});
export type ExportReviewView = z.infer<typeof ReviewSchema>;

const ImportReportSchema = z.object({
  importId: z.string(),
  fileName: z.string(),
  name: z.string(),
  notes: z.string(),
  createdAt: z.string(),
  appVersion: z.string(),
  compatibility: z.object({
    devices: z.array(
      z.object({
        name: z.string(),
        vendorId: z.string(),
        productId: z.string(),
        required: z.boolean(),
        present: z.boolean(),
      })
    ),
    software: z.array(
      z.object({
        name: z.string(),
        kind: z.enum(['game', 'app']),
        required: z.boolean(),
        found: z.boolean(),
        detail: z.string(),
      })
    ),
    displays: z.object({ needed: z.number(), here: z.number(), summary: z.string() }).optional(),
  }),
  wantedToRun: z.array(StrippedSchema.extend({ inFile: z.boolean() })),
  excluded: z.array(PathReason),
  parts: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      detail: z.string(),
      importable: z.boolean(),
      problem: z.string().optional(),
      stored: z.string().optional(),
      target: z.string().optional(),
      files: z
        .array(
          z.object({
            path: z.string(),
            size: z.number(),
            status: z.enum(['new', 'same', 'different']),
          })
        )
        .optional(),
    })
  ),
});
export type ImportReportView = z.infer<typeof ImportReportSchema>;

const ImportResultSchema = z.object({
  name: z.string(),
  profileId: z.string().optional(),
  profileName: z.string().optional(),
  layoutName: z.string().optional(),
  written: z.array(z.string()),
  unchanged: z.array(z.string()),
  failed: z.array(z.object({ label: z.string(), reason: z.string() })),
  groupId: z.string().optional(),
  deviceIds: z.object({ files: z.array(z.string()), message: z.string() }).optional(),
  /** Checks for devices not found on this PC: imported switched off, by title. */
  switchedOff: z.array(z.string()).default([]),
});
export type ImportResultView = z.infer<typeof ImportResultSchema>;

const ExportInput = z.object({
  profileId: z.string().min(1).max(80),
  includeItems: z.array(z.string().max(80)).max(200).default([]),
});

const PictureInput = z.object({
  profileId: z.string().min(1).max(80),
  shape: PictureShapeSchema.default('wide'),
});

const PicturePreviewSchema = z.object({
  image: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  monitors: z.number().int(),
  controllers: z.number().int(),
  apps: z.number().int(),
  /** Where the monitor arrangement comes from: the setup's layout check, or the monitors as they are. */
  monitorsFrom: z.enum(['setup', 'now', 'none']),
});
export type PicturePreviewView = z.infer<typeof PicturePreviewSchema>;

export const sharingContract = defineContract('sharing', {
  /** Setups that can be shared. */
  profiles: channel(
    noInput,
    z.array(z.object({ id: z.string(), name: z.string(), game: z.string().optional() })),
    {
      describe: 'Setups that can be shared, with the ids that prepare and picturePreview take.',
      tier: 'read',
    }
  ),
  /** What the shared file would contain and every personal detail found. Writes nothing. */
  prepare: channel(ExportInput, ReviewSchema, {
    describe:
      'What a shared .rigready file of a setup would contain and every personal detail found in it. profileId comes from sharing:profiles. Writes nothing.',
    tier: 'read',
  }),
  /** Writes the .rigready file where the user picks; null when cancelled. */
  export: channel(
    ExportInput.extend({
      decisions: z.record(z.string(), z.enum(['keep', 'remove'])).default({}),
      notes: z.string().max(10_000),
      /** The user ticked "I reviewed this". */
      reviewed: z.literal(true),
    }),
    z.object({ path: z.string(), size: z.number() }).nullable(),
    {
      describe:
        'Writes the .rigready file to a place the user picks with a dialog, after the user reviewed it; null when cancelled.',
      tier: 'off',
    }
  ),
  /** Opens a .rigready file and reports what it holds and how it fits this PC; null when cancelled. */
  openImport: channel(noInput, ImportReportSchema.nullable(), {
    describe:
      'Asks the user for a .rigready file with a dialog and reports what it holds and how it fits this PC; null when cancelled.',
    tier: 'off',
  }),
  import: channel(
    z.object({
      importId: z.string(),
      parts: z.array(z.string()).min(1),
      conflict: z.enum(['overwrite', 'keepBoth']).default('overwrite'),
    }),
    ImportResultSchema,
    {
      describe:
        'Imports the chosen parts of an opened .rigready file as a setup and writes its files. importId and part ids come from sharing:openImport. Undo it with undoImport or on the Safety page.',
      tier: 'change',
    }
  ),
  /**
   * Undoes an import in one step: the files it wrote are put back and the setup it
   * created is removed. Fails with `journal.changed` when something was edited since;
   * `force` undoes anyway.
   */
  undoImport: channel(
    z.object({ groupId: z.string(), force: z.boolean().default(false) }),
    z.object({ files: z.number(), setupRemoved: z.boolean() }),
    {
      describe:
        'Undoes an import in one step: the files it wrote are put back and the setup it created is removed. groupId comes from the import result or safety:journal. Fails when something was edited since unless force is set.',
      tier: 'change',
    }
  ),
  /**
   * A picture of a setup (name, game, monitors to scale, controllers, helper apps) exactly
   * as Save would write it, as a PNG data URL. Nothing personal is in it. Writes nothing.
   */
  picturePreview: channel(PictureInput, PicturePreviewSchema, {
    describe:
      'A picture of a setup (name, game, monitors, controllers, helper apps) as a PNG data URL, with nothing personal in it. profileId comes from sharing:profiles. Writes nothing.',
    tier: 'read',
  }),
  /**
   * Writes that picture where the user picks; null when cancelled. Answers with the picture
   * that is in the file, which the page then shows.
   */
  savePicture: channel(
    PictureInput,
    PicturePreviewSchema.extend({ path: z.string(), size: z.number() }).nullable(),
    {
      describe:
        'Writes the setup picture to a place the user picks with a dialog; null when cancelled.',
      tier: 'off',
    }
  ),
});
