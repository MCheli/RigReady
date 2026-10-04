import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { CompatibilitySchema } from './core/schema';

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

export const sharingContract = defineContract('sharing', {
  /** Setups that can be shared. */
  profiles: channel(
    noInput,
    z.array(z.object({ id: z.string(), name: z.string(), game: z.string().optional() }))
  ),
  /** What the shared file would contain and every personal detail found. Writes nothing. */
  prepare: channel(ExportInput, ReviewSchema),
  /** Writes the .rigready file where the user picks; null when cancelled. */
  export: channel(
    ExportInput.extend({
      decisions: z.record(z.string(), z.enum(['keep', 'remove'])).default({}),
      notes: z.string().max(10_000),
      /** The user ticked "I reviewed this". */
      reviewed: z.literal(true),
    }),
    z.object({ path: z.string(), size: z.number() }).nullable()
  ),
  /** Opens a .rigready file and reports what it holds and how it fits this PC; null when cancelled. */
  openImport: channel(noInput, ImportReportSchema.nullable()),
  import: channel(
    z.object({
      importId: z.string(),
      parts: z.array(z.string()).min(1),
      conflict: z.enum(['overwrite', 'keepBoth']).default('overwrite'),
    }),
    ImportResultSchema
  ),
  /**
   * Undoes an import in one step: the files it wrote are put back and the setup it
   * created is removed. Fails with `journal.changed` when something was edited since;
   * `force` undoes anyway.
   */
  undoImport: channel(
    z.object({ groupId: z.string(), force: z.boolean().default(false) }),
    z.object({ files: z.number(), setupRemoved: z.boolean() })
  ),
});
