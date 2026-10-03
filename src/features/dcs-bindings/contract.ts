import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { AppliedSchema, ChangePlanSchema } from './core/model';
import { CopyPreviewSchema } from './core/model';
import { BindingOpSchema } from './core/model';
import { MappingSchema, MigrationScanSchema } from './core/model';
import { AircraftViewSchema, DeviceRoleSchema, OverviewSchema } from './core/model';
import { ComparisonSchema, SnapshotSchema } from './core/model';

export const PressedSchema = z.object({
  guid: z.string(),
  deviceName: z.string(),
  key: z.string(),
  label: z.string(),
  kind: z.enum(['button', 'hat', 'axis']),
});
export type Pressed = z.infer<typeof PressedSchema>;

const Edits = z.object({
  ops: z.array(BindingOpSchema).min(1),
  /** One line for the Safety page; generated when left out. */
  summary: z.string().optional(),
});
const Mappings = z.object({ mappings: z.array(MappingSchema).min(1) });
const Restore = z.object({ id: z.string(), remapIds: z.boolean().default(true) });

export const dcsBindingsContract = defineContract(
  'dcs-bindings',
  {
    /** Where DCS keeps bindings, which aircraft there are, and whether device ids have gone stale. */
    overview: channel(noInput, OverviewSchema),
    /** Effective bindings of one aircraft on every device, with problems found. */
    aircraft: channel(z.object({ id: z.string() }), AircraftViewSchema),

    /** What a device is used for; decides which default bindings count as unwanted. */
    setRole: channel(
      z.object({
        name: z.string(),
        vendorId: z.string().optional(),
        productId: z.string().optional(),
        role: DeviceRoleSchema,
      }),
      z.object({ saved: z.boolean() })
    ),
    /** Marks an action as intentionally bound more than once (or takes the mark away). */
    setExpected: channel(
      z.object({ aircraft: z.string(), commandId: z.string(), expected: z.boolean() }),
      z.object({ saved: z.boolean() })
    ),

    /** What a list of edits would write. Nothing is changed. */
    plan: channel(Edits, ChangePlanSchema),
    /** Writes the edits as one undoable change. Refused while DCS is running. */
    apply: channel(Edits, AppliedSchema),
    /** The edits that cancel unwanted default bindings, for some aircraft or all of them. */
    cleanupOps: channel(
      z.object({
        /** Aircraft ids; empty means every aircraft DCS has defaults for. */
        aircraft: z.array(z.string()),
        /** Only these problems (ids from the aircraft view); all when left out. */
        only: z.array(z.string()).optional(),
      }),
      z.object({ ops: z.array(BindingOpSchema), aircraft: z.array(z.string()) })
    ),
    /** Puts back everything one applied change wrote. */
    undo: channel(z.object({ groupId: z.string() }), z.object({ undone: z.boolean() })),

    migrationScan: channel(noInput, MigrationScanSchema),
    migrationPlan: channel(Mappings, ChangePlanSchema),
    migrationApply: channel(Mappings, AppliedSchema),

    copyPreview: channel(
      z.object({ from: z.string(), to: z.string(), deviceIds: z.array(z.string()) }),
      CopyPreviewSchema
    ),
    /** The edits for the ticked proposals of a copy preview. */
    copyOps: channel(
      z.object({
        from: z.string(),
        to: z.string(),
        deviceIds: z.array(z.string()),
        selected: z.array(z.string()),
      }),
      z.object({ ops: z.array(BindingOpSchema), summary: z.string() })
    ),

    snapshots: channel(noInput, z.array(SnapshotSchema)),
    snapshotCreate: channel(
      z.object({ name: z.string(), aircraft: z.array(z.string()) }),
      SnapshotSchema
    ),
    snapshotRename: channel(z.object({ id: z.string(), name: z.string() }), SnapshotSchema),
    snapshotDelete: channel(z.object({ id: z.string() }), z.object({ deleted: z.boolean() })),
    snapshotRestorePlan: channel(Restore, ChangePlanSchema),
    snapshotRestore: channel(Restore, AppliedSchema),
    /** `right` left out compares with the bindings DCS has now. */
    snapshotCompare: channel(
      z.object({ left: z.string(), right: z.string().optional() }),
      ComparisonSchema
    ),

    /** Starts reporting presses on any controller as `pressed` events. */
    listenStart: channel(noInput, z.object({ listening: z.boolean() })),
    listenStop: channel(noInput, z.object({ listening: z.boolean() })),
  },
  {
    /** A button, hat direction or axis the user just used. */
    pressed: PressedSchema,
    /** A fix asked for the Device IDs screen to be shown. */
    openMigration: z.object({}),
  }
);
