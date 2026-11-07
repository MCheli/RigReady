import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import {
  AircraftViewSchema,
  AppliedSchema,
  BindingOpSchema,
  ChangePlanSchema,
  ComparisonSchema,
  CopyPreviewSchema,
  DeviceRoleSchema,
  MappingSchema,
  MigrationScanSchema,
  OverviewSchema,
  SnapshotSchema,
} from './core/model';

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
    overview: channel(noInput, OverviewSchema, {
      describe:
        'Lists where DCS keeps bindings, every aircraft that has bindings or defaults, and how many controllers have stale device ids. Start here: the aircraft ids the other dcs-bindings channels take come from it. Changes nothing.',
      tier: 'read',
    }),
    /** Effective bindings of one aircraft on every device, with problems found. */
    aircraft: channel(z.object({ id: z.string() }), AircraftViewSchema, {
      describe:
        'The effective bindings of one aircraft on every controller, with the problems found (unwanted defaults, conflicts, duplicates). id is an aircraft id from dcs-bindings:overview. Changes nothing.',
      tier: 'read',
    }),

    /** What a device is used for; decides which default bindings count as unwanted. */
    setRole: channel(
      z.object({
        name: z.string(),
        vendorId: z.string().optional(),
        productId: z.string().optional(),
        role: DeviceRoleSchema,
      }),
      z.object({ saved: z.boolean() }),
      {
        describe:
          "Saves what a controller is used for (its role), which decides which default bindings count as unwanted on it. name, vendorId and productId identify the device as dcs-bindings:aircraft lists it. Saved in RigReady's settings; DCS files are not touched.",
        tier: 'change',
      }
    ),
    /** Marks an action as intentionally bound more than once (or takes the mark away). */
    setExpected: channel(
      z.object({ aircraft: z.string(), commandId: z.string(), expected: z.boolean() }),
      z.object({ saved: z.boolean() }),
      {
        describe:
          "Marks one action of an aircraft as meant to be bound more than once, so it is no longer reported as a problem (expected false takes the mark away). aircraft and commandId come from dcs-bindings:aircraft. Saved in RigReady's settings.",
        tier: 'change',
      }
    ),

    /** What a list of edits would write. Nothing is changed. */
    plan: channel(Edits, ChangePlanSchema, {
      describe:
        'Shows what a list of binding edits would write to the DCS input files, file by file, and whether DCS being open blocks it. Nothing is changed. Call it before dcs-bindings:apply and show the user. Edits come from cleanupOps or copyOps or are built from dcs-bindings:aircraft.',
      tier: 'read',
    }),
    /** Writes the edits as one undoable change. Refused while DCS is running. */
    apply: channel(Edits, AppliedSchema, {
      describe:
        'Writes a list of binding edits to the DCS input files as one change that can be undone, and answers with its groupId for dcs-bindings:undo. Call dcs-bindings:plan first and show the user. DCS must be closed.',
      tier: 'change',
    }),
    /** The edits that cancel unwanted default bindings, for some aircraft or all of them. */
    cleanupOps: channel(
      z.object({
        /** Aircraft ids; empty means every aircraft DCS has defaults for. */
        aircraft: z.array(z.string()),
        /** Only these problems (ids from the aircraft view); all when left out. */
        only: z.array(z.string()).optional(),
      }),
      z.object({ ops: z.array(BindingOpSchema), aircraft: z.array(z.string()) }),
      {
        describe:
          'Works out the edits that take away unwanted default bindings for some aircraft (empty list: every aircraft with defaults), optionally only for problem ids from dcs-bindings:aircraft. Changes nothing; pass the edits to dcs-bindings:plan, then apply.',
        tier: 'read',
      }
    ),
    /** Puts back everything one applied change wrote. */
    undo: channel(z.object({ groupId: z.string() }), z.object({ undone: z.boolean() }), {
      describe:
        'Puts back everything one applied bindings change wrote. groupId comes from the answer of apply, migrationApply or snapshotRestore. DCS must be closed.',
      tier: 'change',
    }),

    migrationScan: channel(noInput, MigrationScanSchema, {
      describe:
        'Finds binding files whose controller has a new Windows device id (stale ids), and the connected devices they could move to. Changes nothing. Use it when bindings went missing after a controller was replugged or Windows was reinstalled.',
      tier: 'read',
    }),
    migrationPlan: channel(Mappings, ChangePlanSchema, {
      describe:
        'Shows what moving bindings from stale device ids to connected devices would write. from is an orphan id and toGuid a device from dcs-bindings:migrationScan. Nothing is changed. Call it before dcs-bindings:migrationApply and show the user.',
      tier: 'read',
    }),
    migrationApply: channel(Mappings, AppliedSchema, {
      describe:
        'Moves bindings from stale device ids to the connected devices given, as one change that can be undone. Call dcs-bindings:migrationPlan first and show the user. DCS must be closed.',
      tier: 'change',
    }),

    copyPreview: channel(
      z.object({ from: z.string(), to: z.string(), deviceIds: z.array(z.string()) }),
      CopyPreviewSchema,
      {
        describe:
          'Proposes how the bindings of one aircraft could be copied to another on the given devices, matching action by action, with what has no counterpart. from and to are aircraft ids and deviceIds device ids from dcs-bindings:aircraft. Changes nothing.',
        tier: 'read',
      }
    ),
    /** The edits for the ticked proposals of a copy preview. */
    copyOps: channel(
      z.object({
        from: z.string(),
        to: z.string(),
        deviceIds: z.array(z.string()),
        selected: z.array(z.string()),
      }),
      z.object({ ops: z.array(BindingOpSchema), summary: z.string() }),
      {
        describe:
          'Turns the chosen proposals of dcs-bindings:copyPreview (selected proposal ids) into binding edits. Changes nothing; pass the edits to dcs-bindings:plan, then apply.',
        tier: 'read',
      }
    ),

    snapshots: channel(noInput, z.array(SnapshotSchema), {
      describe:
        'Lists the bindings snapshots RigReady has kept (named copies of DCS input folders). Snapshot ids for the other snapshot channels come from here. Changes nothing.',
      tier: 'read',
    }),
    snapshotCreate: channel(
      z.object({ name: z.string(), aircraft: z.array(z.string()) }),
      SnapshotSchema,
      {
        describe:
          "Takes a named snapshot of the bindings of the given aircraft (ids from dcs-bindings:overview) into RigReady's folder. DCS files are only read.",
        tier: 'change',
      }
    ),
    snapshotRename: channel(z.object({ id: z.string(), name: z.string() }), SnapshotSchema, {
      describe: 'Gives a bindings snapshot a new name. id comes from dcs-bindings:snapshots.',
      tier: 'change',
    }),
    snapshotDelete: channel(z.object({ id: z.string() }), z.object({ deleted: z.boolean() }), {
      describe:
        "Deletes a bindings snapshot from RigReady's folder for good. id comes from dcs-bindings:snapshots. Ask the user first.",
      tier: 'change',
    }),
    snapshotRestorePlan: channel(Restore, ChangePlanSchema, {
      describe:
        'Shows what restoring a bindings snapshot would write, with remapIds moving old device ids to the controllers connected now. id comes from dcs-bindings:snapshots. Nothing is changed. Call it before dcs-bindings:snapshotRestore and show the user.',
      tier: 'read',
    }),
    snapshotRestore: channel(Restore, AppliedSchema, {
      describe:
        'Puts the bindings of a snapshot back into DCS as one change that can be undone. Call dcs-bindings:snapshotRestorePlan first and show the user. DCS must be closed.',
      tier: 'change',
    }),
    /** `right` left out compares with the bindings DCS has now. */
    snapshotCompare: channel(
      z.object({ left: z.string(), right: z.string().optional() }),
      ComparisonSchema,
      {
        describe:
          'Compares two bindings snapshots, or one snapshot with the bindings DCS has now when right is left out, action by action. Ids come from dcs-bindings:snapshots. Changes nothing.',
        tier: 'read',
      }
    ),

    /** Starts reporting presses on any controller as `pressed` events. */
    listenStart: channel(noInput, z.object({ listening: z.boolean() }), {
      describe: 'Starts sending pressed events for every controller press, for the bindings page.',
      tier: 'off',
    }),
    listenStop: channel(noInput, z.object({ listening: z.boolean() }), {
      describe: 'Stops the pressed events started by listenStart.',
      tier: 'off',
    }),
  },
  {
    /** A button, hat direction or axis the user just used. */
    pressed: PressedSchema,
    /** A fix asked for the Device IDs screen to be shown. */
    openMigration: z.object({}),
  }
);
