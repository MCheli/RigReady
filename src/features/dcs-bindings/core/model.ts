import { z } from 'zod';

/**
 * The read model of DCS bindings that crosses IPC and that other features (cheat
 * sheets, AI guidance) build on: effective bindings per aircraft and device, with
 * plain-language labels. Produced by DcsBindings.view() in bindings.ts.
 */

export const AxisFilterSchema = z.object({
  deadzone: z.number(),
  saturationX: z.number(),
  saturationY: z.number(),
  hardwareDetent: z.boolean(),
  hardwareDetentAB: z.number(),
  hardwareDetentMax: z.number(),
  invert: z.boolean(),
  slider: z.boolean(),
  curvature: z.array(z.number()),
});

export const ComboSchema = z.object({
  /** DCS event name: JOY_BTN5, JOY_BTN_POV1_U, JOY_X, LShift. */
  key: z.string().min(1),
  /** Modifier names. */
  reformers: z.array(z.string()).default([]),
  filter: AxisFilterSchema.optional(),
});
export type ComboView = z.infer<typeof ComboSchema>;

export const CommandKindSchema = z.enum(['key', 'axis']);

export const DEVICE_ROLES = [
  'stick',
  'throttle',
  'pedals',
  'panel',
  'mfd',
  'none',
  'other',
] as const;
export const DeviceRoleSchema = z.enum(DEVICE_ROLES);
export type DeviceRole = z.infer<typeof DeviceRoleSchema>;

export const ROLE_LABELS: Record<DeviceRole, string> = {
  stick: 'Stick',
  throttle: 'Throttle',
  pedals: 'Pedals',
  panel: 'Panel or button box',
  mfd: 'MFD frame',
  none: 'Not used in DCS',
  other: 'Something else',
};

export const CommandSchema = z.object({
  /** "<kind>:<hash>", unique within an aircraft. */
  id: z.string(),
  kind: CommandKindSchema,
  /** DCS's command hash, the key of the entry in a binding file. */
  hash: z.string(),
  /** DCS's own name of the action, from its default input files. */
  name: z.string(),
  /**
   * What the action is in plain language ("Sensor select: HUD"), when a shipped label file
   * has one (core/bindings.ts `labels`). Shown first, with `name` beside it.
   */
  plain: z.string().optional(),
  /** Category path, e.g. ["Stick", "HOTAS"]. Empty when DCS gives none. */
  category: z.array(z.string()),
  /**
   * False when RigReady does not know the number DCS's engine uses for this action, so
   * it can show it but cannot write a binding for it yet.
   */
  editable: z.boolean(),
  /** True for an entry of a binding file that matches no action in the current defaults. */
  unmatched: z.boolean(),
});
export type CommandView = z.infer<typeof CommandSchema>;

export const BindingSourceSchema = z.enum(['default', 'user', 'template']);

export const BindingSchema = z.object({
  commandId: z.string(),
  combo: ComboSchema,
  /** "LCtrl + Button 34", "Hat 1 up", "Y axis". */
  label: z.string(),
  /** DCS default, the user's own file, or a template DCS ships for this device. */
  source: BindingSourceSchema,
  /** A default axis with a changed curve. */
  filterChanged: z.boolean(),
  /** The connected device has no such button, hat or axis: the binding can never fire. */
  inert: z.boolean(),
  /** What a default axis or button is for, from DCS's DefaultAssignments: "roll", "thrust". */
  purpose: z.string().optional(),
});
export type BindingView = z.infer<typeof BindingSchema>;

export const RemovedDefaultSchema = z.object({
  commandId: z.string(),
  combo: ComboSchema,
  label: z.string(),
});

export const DeviceTypeSchema = z.enum(['joystick', 'keyboard', 'mouse', 'trackir', 'headtracker']);

export const DeviceSchema = z.object({
  /** "<type>/<full id>", unique within an aircraft. */
  id: z.string(),
  type: DeviceTypeSchema,
  /** DirectInput product name, as in the binding file name. */
  name: z.string(),
  /** The name the owner gave the device (Devices page); shown first, with `name` beside it. */
  givenName: z.string().optional(),
  /** Instance GUID in DCS's casing; absent for the keyboard. */
  guid: z.string().optional(),
  /** "<name> {GUID}". */
  fullId: z.string(),
  /** Attached right now. */
  connected: z.boolean(),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  numButtons: z.number().int(),
  numHats: z.number().int(),
  axisNames: z.array(z.string()),
  role: DeviceRoleSchema,
  /** True when the role is RigReady's guess from the device name, not the user's choice. */
  roleSuggested: z.boolean(),
  file: z.object({
    /** Where the user's binding file is, or would be created. */
    path: z.string(),
    /** Which diff DCS uses: the user's, a template shipped with DCS, or none (defaults only). */
    source: z.enum(['user', 'template', 'none']),
    /** Set when the file exists but could not be read; its bindings are not shown. */
    error: z.string().optional(),
  }),
  bindings: z.array(BindingSchema),
  /** Defaults the binding file cancels. */
  removed: z.array(RemovedDefaultSchema),
  counts: z.object({
    /** Bindings that can fire. */
    active: z.number().int(),
    fromUser: z.number().int(),
    fromDefaults: z.number().int(),
    /** Defaults on controls the device does not have. */
    inert: z.number().int(),
  }),
});
export type DeviceView = z.infer<typeof DeviceSchema>;

export const ModifierSchema = z.object({
  name: z.string(),
  key: z.string(),
  /** "Keyboard" or a device's full id. */
  device: z.string(),
  /** "LCtrl", or "Button 5 on WINWING Orion Joystick ..." for a device button. */
  label: z.string(),
  isSwitch: z.boolean(),
  /** False when the modifier is a button of a device id that is not attached. */
  deviceConnected: z.boolean(),
  /** The user's modifiers.lua defines it (as opposed to DCS's defaults). */
  fromUser: z.boolean(),
});

export const OccurrenceSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string(),
  combo: ComboSchema,
  label: z.string(),
  source: BindingSourceSchema,
});

export const ProblemsSchema = z.object({
  /** One input (same key, same modifiers) bound to several actions on one device. */
  inputConflicts: z.array(
    z.object({
      id: z.string(),
      deviceId: z.string(),
      deviceName: z.string(),
      combo: ComboSchema,
      label: z.string(),
      commandIds: z.array(z.string()),
    })
  ),
  /** One action bound on several inputs or devices. */
  actionDuplicates: z.array(
    z.object({
      commandId: z.string(),
      occurrences: z.array(OccurrenceSchema),
      /** The user marked these multiples as intended. */
      expected: z.boolean(),
      /** Bound on more than one device (as opposed to twice on one). */
      acrossDevices: z.boolean(),
    })
  ),
  /** Defaults DCS put on a device that is not meant for them. */
  unwantedDefaults: z.array(
    z.object({
      id: z.string(),
      deviceId: z.string(),
      deviceName: z.string(),
      commandId: z.string(),
      combo: ComboSchema,
      label: z.string(),
      /** "Pitch on an MFD frame". */
      reason: z.string(),
    })
  ),
  /** Curated important actions with nothing bound on any controller. */
  importantUnbound: z.array(
    z.object({
      id: z.string(),
      tier: z.number().int(),
      tierTitle: z.string(),
      title: z.string(),
      why: z.string(),
      /** The actions that would satisfy it. */
      commandIds: z.array(z.string()),
      /** The keyboard shortcut that does work, when there is one. */
      keyboard: z.string().optional(),
    })
  ),
});
export type ProblemsView = z.infer<typeof ProblemsSchema>;

export const AircraftSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** DCS's default input files for it were found in the install. */
  hasDefaults: z.boolean(),
  /** Number of binding files in Saved Games for it. */
  userFiles: z.number().int(),
});
export type AircraftSummary = z.infer<typeof AircraftSummarySchema>;

export const AircraftViewSchema = z.object({
  aircraft: AircraftSummarySchema,
  devices: z.array(DeviceSchema),
  commands: z.array(CommandSchema),
  modifiers: z.array(ModifierSchema),
  problems: ProblemsSchema,
  /** Things the user should know: unreadable files, missing defaults. */
  warnings: z.array(z.string()),
  /** Actions RigReady can show but not edit, because the engine's number is unknown. */
  uneditableCommands: z.number().int(),
  dcsRunning: z.boolean(),
});
export type AircraftView = z.infer<typeof AircraftViewSchema>;

export const OverviewSchema = z.object({
  /** False when no DCS Saved Games folder was found. */
  found: z.boolean(),
  inputDir: z.string(),
  installDir: z.string().optional(),
  aircraft: z.array(AircraftSummarySchema),
  dcsRunning: z.boolean(),
  /** Binding files that belong to a device id that is no longer attached but whose device is. */
  staleDeviceIds: z.number().int(),
});
export type Overview = z.infer<typeof OverviewSchema>;

// ---------------------------------------------------------------------------
// Changes, edits, migration, copy and snapshots: what crosses IPC.
// ---------------------------------------------------------------------------

export const DiffLineSchema = z.object({
  type: z.enum(['same', 'add', 'del', 'gap']),
  text: z.string(),
});

export const PlannedFileSchema = z.object({
  path: z.string(),
  action: z.enum(['create', 'change', 'delete', 'rename']),
  /** For a rename: the new path. */
  to: z.string().optional(),
  /** "WINWING ICP · F/A-18C". */
  title: z.string(),
  /** What changes, in plain language, one line each. */
  lines: z.array(z.string()),
  /** The exact text change. */
  diff: z.array(DiffLineSchema),
});
export type PlannedFile = z.infer<typeof PlannedFileSchema>;

export const ChangePlanSchema = z.object({
  /** One line for the journal and the dialog title: "Clean up 12 default bindings (F/A-18C)". */
  summary: z.string(),
  files: z.array(PlannedFileSchema),
  /** Things that were left out or that the user should know before applying. */
  notes: z.array(z.string()),
  /** Set when the plan cannot be applied right now, with the reason. */
  blocked: z.string().optional(),
});
export type ChangePlan = z.infer<typeof ChangePlanSchema>;

export const AppliedSchema = z.object({
  /** The journal group, for Undo. */
  groupId: z.string(),
  summary: z.string(),
  files: z.number().int(),
});
export type Applied = z.infer<typeof AppliedSchema>;

const Target = { aircraft: z.string().min(1), deviceId: z.string().min(1) };

export const BindingOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('bind'), ...Target, commandId: z.string(), combo: ComboSchema }),
  z.object({ op: z.literal('unbind'), ...Target, commandId: z.string(), combo: ComboSchema }),
  z.object({
    op: z.literal('setFilter'),
    ...Target,
    commandId: z.string(),
    combo: ComboSchema,
    filter: AxisFilterSchema,
  }),
  /** Removes every default and every added binding of the device for this aircraft. */
  z.object({ op: z.literal('clearDevice'), ...Target }),
]);
export type BindingOp = z.infer<typeof BindingOpSchema>;

export const CandidateSchema = z.object({
  /** The attached device's instance GUID in DCS's casing. */
  guid: z.string(),
  name: z.string(),
  /** The name the owner gave this device on the Devices page, when it has one. */
  givenName: z.string().optional(),
  fullId: z.string(),
  /** DirectInput index, to match live input to this device. */
  index: z.number().int(),
  vendorId: z.string(),
  productId: z.string(),
  /** Files of the old id that would collide with a file already there under this device's current id. */
  ownFiles: z.number().int(),
  /** The device's name differs from the old file's (a grip or firmware change). */
  nameChanged: z.boolean(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const OrphanSchema = z.object({
  /** The old full id: "<name> {old GUID}". */
  id: z.string(),
  name: z.string(),
  oldGuid: z.string(),
  /** Binding files under the old id, in every aircraft folder. */
  files: z.array(z.object({ path: z.string(), folder: z.string(), type: z.string() })),
  /** modifiers.lua, disabled.lua and wizard.lua files that mention the old id. */
  references: z.array(z.string()),
  candidates: z.array(CandidateSchema),
  /**
   * ready: exactly one attached device can be meant. choose: several could, so the user
   * must pick (by pressing a button on the device). unplugged: no attached device has
   * this name, so there is nothing to move to.
   */
  status: z.enum(['ready', 'choose', 'unplugged']),
  /** For `ready`: the GUID to move to. */
  proposed: z.string().optional(),
  /** For `choose`: why RigReady will not pick by itself. */
  reason: z.string().optional(),
});
export type Orphan = z.infer<typeof OrphanSchema>;

export const MigrationScanSchema = z.object({
  inputDir: z.string(),
  orphans: z.array(OrphanSchema),
  dcsRunning: z.boolean(),
});
export type MigrationScan = z.infer<typeof MigrationScanSchema>;

export const MappingSchema = z.object({
  /** The orphan's id (old full id). */
  from: z.string(),
  /** The attached device to move to. */
  toGuid: z.string(),
  /** What to do when a file for the new id already exists. */
  onConflict: z.enum(['keep', 'replace', 'merge']).default('keep'),
});
export type Mapping = z.infer<typeof MappingSchema>;

export const CopyProposalSchema = z.object({
  /** Stable within one proposal list. */
  id: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  combo: ComboSchema,
  label: z.string(),
  from: z.object({ commandId: z.string(), name: z.string() }),
  to: z.object({ commandId: z.string(), name: z.string() }),
  /** Same DCS command in both aircraft, the same kind of control, or only the closest action. */
  match: z.enum(['same', 'equivalent', 'closest']),
  /** Actions in the target aircraft that this input does now and would stop doing. */
  replaces: z.array(z.string()),
  /** The target already has exactly this binding. */
  already: z.boolean(),
  /** Ticked by default. */
  selected: z.boolean(),
});
export type CopyProposal = z.infer<typeof CopyProposalSchema>;

export const CopyPreviewSchema = z.object({
  from: z.string(),
  to: z.string(),
  proposals: z.array(CopyProposalSchema),
  /** The user's bindings in the source that have no counterpart in the target aircraft. */
  unmatched: z.array(z.object({ deviceName: z.string(), label: z.string(), name: z.string() })),
});
export type CopyPreview = z.infer<typeof CopyPreviewSchema>;

export const SnapshotMetaSchema = z.object({
  name: z.string().min(1),
  createdAt: z.string(),
  /** From dcs.log; "unknown" when DCS has not been run. */
  dcsVersion: z.string(),
  /** Aircraft folders covered; empty means every folder. */
  aircraft: z.array(z.string()),
  devices: z.array(z.object({ name: z.string(), guid: z.string().optional() })),
});

export const SnapshotSchema = SnapshotMetaSchema.extend({
  id: z.string(),
  files: z.number().int(),
  bytes: z.number().int(),
  /** Aircraft folders that are actually in the snapshot. */
  folders: z.array(z.string()),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const ComparisonSchema = z.object({
  left: z.string(),
  right: z.string(),
  /** One entry per aircraft folder and device that differs. */
  devices: z.array(
    z.object({
      folder: z.string(),
      device: z.string(),
      /** In the right side only. */
      added: z.array(z.string()),
      /** In the left side only. */
      removed: z.array(z.string()),
      /** Same binding, different curve. */
      changed: z.array(z.string()),
    })
  ),
  /** Number of device files that are the same on both sides. */
  identical: z.number().int(),
});
export type Comparison = z.infer<typeof ComparisonSchema>;
