import { z } from 'zod';
import { ChangePreviewSchema } from '../../shared/changePreview';
import { channel, defineContract, noInput } from '../../shared/ipc';

/**
 * The id of the set every car uses: the control profile app.ini names for all cars
 * (Documents\iRacing\profiles\controls\<name>\controls.cfg), or on an iRacing from
 * before control profiles, Documents\iRacing\controls.cfg.
 */
export const ALL_CARS = 'all';

/** One set of bindings iRacing keeps: the one for all cars, or one car's custom controls. */
export const BindingSetSchema = z.object({
  /** "all", or "car:<folder>" for a car with custom controls. */
  id: z.string(),
  /** "All cars", or the car's folder name as iRacing has it ("mx5 mx52016"). */
  name: z.string(),
  general: z.boolean(),
  /** The controls.cfg this set is read from. */
  file: z.string(),
  /** The iRacing control profile the file belongs to; absent on an iRacing without them. */
  profile: z.string().optional(),
  /**
   * For a car: the other cars whose app.ini line names the same profile. A change to this
   * set changes their bindings too, and the page says so before and after saving.
   */
  sharedWith: z.array(z.string()).optional(),
});
export type BindingSet = z.infer<typeof BindingSetSchema>;

/**
 * Where this iRacing keeps the bindings it uses. Since 2026 Season 3 iRacing keeps control
 * profiles (Documents\iRacing\profiles\controls\<name>) and app.ini [ControlProfiles]
 * says which one it loads; the older files beside them are no longer read.
 */
export const BindingSourceSchema = z.object({
  /** "profiles": control profiles. "files": an iRacing from before them. */
  kind: z.enum(['profiles', 'files']),
  /** The profile for all cars, as app.ini names it. */
  profile: z.string().optional(),
  /** Why no set for all cars could be found among the profiles, when none could. */
  problem: z.string().optional(),
  /** Bindings files from before control profiles that iRacing no longer reads. */
  oldFiles: z.array(z.string()),
});
export type BindingSource = z.infer<typeof BindingSourceSchema>;

export const OverviewSchema = z.object({
  /** iRacing's program was found on this PC. */
  installed: z.boolean(),
  /** Documents\iRacing, when it exists. */
  folder: z.string().optional(),
  /** The simulator is running now: it writes its files when it exits. */
  simRunning: z.boolean(),
  /** The sets found, "All cars" first. Empty when iRacing has no controls.cfg yet. */
  sets: z.array(BindingSetSchema),
  /** Control profiles or the older files, and the profile iRacing loads for all cars. */
  source: BindingSourceSchema,
  /** How many car folders iRacing has under setups (cars driven at least once). */
  carFolders: z.number().int(),
  /** The page of the app that repairs a controller's id in iRacing's files, when there is one. */
  repairRoute: z.string().optional(),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const DeviceStateSchema = z.enum(['connected', 'moved', 'missing', 'unknown']);
export type DeviceState = z.infer<typeof DeviceStateSchema>;

export const DeviceSchema = z.object({
  /** The controller's DirectInput instance GUID as the file has it, or "keyboard". */
  key: z.string(),
  kind: z.enum(['controller', 'keyboard']),
  /** The name iRacing or Windows knows it by. */
  name: z.string(),
  /** The name the owner gave it in RigReady. */
  givenName: z.string().optional(),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  /**
   * connected: plugged in under the id the file names. moved: the same model is plugged
   * in under another Windows id. missing: not plugged in. unknown: the controllers could
   * not be read. The keyboard is always "connected".
   */
  state: DeviceStateSchema,
  /** How many actions are bound to it in this set. */
  bound: z.number().int(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const ActionBindingSchema = z.object({
  kind: z.enum(['axis', 'button', 'key', 'unknown']),
  /** Device key: a GUID or "keyboard". Empty for a binding RigReady cannot read. */
  device: z.string(),
  deviceName: z.string(),
  /** "Button 5", "Wheel Axis, turning right", "Ctrl+R". */
  input: z.string(),
});
export type ActionBinding = z.infer<typeof ActionBindingSchema>;

export const ActionGroupSchema = z.enum([
  'Driving',
  'In-car adjustments',
  'Cameras and replay',
  'Interface and chat',
]);
export type ActionGroup = z.infer<typeof ActionGroupSchema>;

export const ActionSchema = z.object({
  /** iRacing's own id of the action: "BrakeBiasInc". */
  id: z.string(),
  /** In plain words: "Brake bias up". */
  name: z.string(),
  group: ActionGroupSchema,
  /** What iRacing lets the action be bound to. */
  accepts: z.array(z.enum(['axis', 'button', 'key'])),
  /** Absent when nothing is bound. */
  binding: ActionBindingSchema.optional(),
  /** True when this car's set differs from "All cars" here. Always false for "All cars". */
  differs: z.boolean(),
  /** What "All cars" has for it, when this car's set differs ("Not bound" included). */
  general: z.string().optional(),
});
export type Action = z.infer<typeof ActionSchema>;

export const SharedInputSchema = z.object({
  device: z.string(),
  deviceName: z.string(),
  input: z.string(),
  actions: z.array(z.object({ id: z.string(), name: z.string(), group: ActionGroupSchema })),
  /**
   * True when at most one of the actions is outside iRacing's camera editor. iRacing's own
   * default keys are like that (A is the pit speed limiter and moves the camera), so these
   * are listed apart from the inputs that do two things while driving.
   */
  cameraEditor: z.boolean(),
});
export type SharedInput = z.infer<typeof SharedInputSchema>;

export const SetViewSchema = z.object({
  set: BindingSetSchema,
  devices: z.array(DeviceSchema),
  /** Every action in the file, bound or not, in the file's order. */
  actions: z.array(ActionSchema),
  /** Inputs that do more than one thing. */
  shared: z.array(SharedInputSchema),
  counts: z.object({
    actions: z.number().int(),
    bound: z.number().int(),
    unbound: z.number().int(),
    /** Bindings whose bytes RigReady does not fully understand. */
    unread: z.number().int(),
    /** Actions where this car differs from "All cars". 0 for "All cars". */
    differs: z.number().int(),
  }),
  /** Things worth knowing that are not errors: a calibration file that could not be read. */
  notes: z.array(z.string()),
});
export type SetView = z.infer<typeof SetViewSchema>;

/** What an action can be bound to from RigReady: one controller button, or one key. */
export const WantedBindingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('button'),
    /** The controller's DirectInput instance GUID, as a `pressed` event gives it. */
    device: z.string(),
    /** The button's number as the page shows it: the first button is 1. */
    button: z.number().int().min(1).max(128),
  }),
  z.object({
    kind: z.literal('key'),
    /** iRacing's own key code. */
    keyCode: z.number().int().min(0).max(255),
    /** Two bits each: Shift 0x03, Ctrl 0x0C, Alt 0x30. */
    modifiers: z.number().int().min(0).max(63),
  }),
]);
export type WantedBinding = z.infer<typeof WantedBindingSchema>;

export const ChangeRequestSchema = z.object({
  /** A set id from overview: "all", or "car:<folder>". */
  set: z.string(),
  /** iRacing's id of the action: "HeadlightFlash". */
  action: z.string(),
  /** What to bind it to; null clears the binding. */
  binding: WantedBindingSchema.nullable(),
  /**
   * The set's file as the preview read it (`seen` of changePreview). With it, change writes
   * nothing when the file is no longer that: what the user approved may not hold any more.
   */
  seen: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;

/** One change as it would be, before anything is written. */
export const ChangeReviewSchema = z.object({
  set: BindingSetSchema,
  action: z.object({ id: z.string(), name: z.string() }),
  /** What the action has now: "H on the keyboard", "Button 5 on Button Box", "Not bound". */
  before: z.string(),
  /** What it would have. */
  after: z.string(),
  /** True when the action already has exactly this: saving would change nothing. */
  same: z.boolean(),
  /** The other actions of this set the same button or key would also do. */
  conflicts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      group: ActionGroupSchema,
      /** An action of iRacing's camera editor: it only works while the editor is open. */
      cameraEditor: z.boolean(),
    })
  ),
  /** Why it cannot be saved right now (iRacing is open), when it cannot. */
  blocked: z.string().optional(),
  /** The file as it would change. */
  preview: ChangePreviewSchema,
  /** The file as this was worked out from (its SHA-256): hand it to change as `seen`. */
  seen: z.string(),
});
export type ChangeReview = z.infer<typeof ChangeReviewSchema>;

export const ChangeResultSchema = z.object({
  /** False when the action already had that binding: nothing was written. */
  changed: z.boolean(),
  message: z.string(),
  file: z.string(),
});
export type ChangeResult = z.infer<typeof ChangeResultSchema>;

/**
 * What RigReady makes of a controller a set names that is not plugged in now under that
 * id (core/cleanup.ts). Only "gone" is offered for clearing.
 * - gone: no controller of its model is plugged in, and RigReady has never seen one on
 *   this PC (the Devices page's history, the names and answers given there).
 * - unplugged: not plugged in today, but RigReady knows the model as the owner's.
 * - moved: a controller of its model is plugged in under a new Windows id (the id repair).
 * - unknown: RigReady cannot tell, so it leaves the bindings alone.
 */
export const GoneVerdictSchema = z.enum(['gone', 'unplugged', 'moved', 'unknown']);
export type GoneVerdict = z.infer<typeof GoneVerdictSchema>;

export const GoneDeviceSchema = z.object({
  /** The controller's DirectInput instance GUID as the file has it. */
  key: z.string(),
  name: z.string(),
  givenName: z.string().optional(),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  verdict: GoneVerdictSchema,
  /** Why, in one or two sentences. */
  why: z.string(),
  /** The actions bound on it in this set. */
  bindings: z.array(z.object({ action: z.string(), name: z.string(), input: z.string() })),
});
export type GoneDevice = z.infer<typeof GoneDeviceSchema>;

export const GoneViewSchema = z.object({
  set: BindingSetSchema,
  /** Every controller of the set that is not plugged in now under the id the file names. */
  devices: z.array(GoneDeviceSchema),
});
export type GoneView = z.infer<typeof GoneViewSchema>;

export const ClearGoneRequestSchema = z.object({
  /** A set id from overview. */
  set: z.string(),
  /** Instance GUIDs of controllers whose verdict is "gone", chosen one by one. */
  devices: z.array(z.string().max(64)).min(1).max(32),
  /** The set's file as the preview read it; clearGone writes nothing when it is no longer that. */
  seen: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type ClearGoneRequest = z.infer<typeof ClearGoneRequestSchema>;

export const ClearGoneReviewSchema = z.object({
  set: BindingSetSchema,
  devices: z.array(z.object({ key: z.string(), name: z.string(), count: z.number().int() })),
  /** Every binding that would be cleared, by device. */
  bindings: z.array(
    z.object({ device: z.string(), action: z.string(), name: z.string(), input: z.string() })
  ),
  /** Why it cannot be written right now (iRacing is open), when it cannot. */
  blocked: z.string().optional(),
  preview: ChangePreviewSchema,
  /** The file as this was worked out from: hand it to clearGone as `seen`. */
  seen: z.string(),
});
export type ClearGoneReview = z.infer<typeof ClearGoneReviewSchema>;

export const ClearGoneResultSchema = z.object({
  cleared: z.number().int(),
  message: z.string(),
  file: z.string(),
});
export type ClearGoneResult = z.infer<typeof ClearGoneResultSchema>;

/** Something the user just pressed on a controller while the page listens. */
export const PressedSchema = z.object({
  /** The controller's DirectInput instance GUID. */
  device: z.string(),
  deviceName: z.string(),
  kind: z.enum(['button', 'hat', 'axis']),
  /** For a button: its number, the first being 1. */
  button: z.number().int().optional(),
  /** "Button 5", "a hat switch", "an axis". */
  label: z.string(),
});
export type Pressed = z.infer<typeof PressedSchema>;

/** Why the channels that change a binding are not among a local AI's tools. */
const ON_THE_PAGE =
  'Used by the iRacing bindings page, where the user presses the button or the key and approves the change; it is not offered to a local AI.';
/** Why clearing the bindings of gone controllers is not among a local AI's tools either. */
const TICKED_ON_THE_PAGE =
  'Used by the iRacing bindings page, where the user ticks each controller that is gone for good and approves the change; it is not offered to a local AI.';

export const iracingBindingsContract = defineContract(
  'iracing-bindings',
  {
    /** Where iRacing keeps bindings and which sets there are. */
    overview: channel(noInput, OverviewSchema, {
      describe:
        "Says whether iRacing's bindings are on this PC, where they are kept, whether the simulator is running, and which sets there are: one for all cars, and one for each car that has custom controls. Start here: the set ids iracing-bindings:set takes come from it. Changes nothing.",
      tier: 'read',
    }),
    /** Every action of one set, with what is bound to it. */
    set: channel(z.object({ id: z.string() }), SetViewSchema, {
      describe:
        'Lists every action of one iRacing binding set with what is bound to it (a controller button or axis, or a key), the controllers the set names and whether each is plugged in, the inputs that do more than one thing, and for a car what differs from the set for all cars. id is a set id from iracing-bindings:overview ("all" for all cars). Reads only.',
      tier: 'read',
    }),

    /**
     * One binding as it would change, before anything is written: what the action has now
     * and would have, what else the same input does, and the file. Writes nothing.
     */
    changePreview: channel(ChangeRequestSchema, ChangeReviewSchema, {
      describe: `Shows what binding one iRacing action to a controller button or a key, or clearing it, would change. Writes nothing. ${ON_THE_PAGE}`,
      tier: 'off',
    }),
    /**
     * Sets or clears one binding in the set's controls.cfg, through FileStore (a backup
     * first, one entry on the Safety page). Refused while the simulator runs.
     */
    change: channel(ChangeRequestSchema, ChangeResultSchema, {
      describe: `Binds one iRacing action to a controller button or a key, or clears it, in iRacing's own file, after a backup. Refused while iRacing runs. ${ON_THE_PAGE}`,
      tier: 'off',
    }),

    /** The controllers of one set that are not plugged in, and which of them are gone. */
    goneDevices: channel(z.object({ set: z.string() }), GoneViewSchema, {
      describe:
        'Lists the controllers one iRacing binding set names that are not plugged in now, each with what RigReady makes of it: gone (never seen on this PC, so its bindings can be cleared), unplugged (known as the owner’s), moved (a new Windows id: the id repair on the racing iRacing page is the answer) or unknown. set is a set id from iracing-bindings:overview. Reads only.',
      tier: 'read',
    }),
    /** Clearing the bindings of the chosen gone controllers, as it would be. Writes nothing. */
    clearGonePreview: channel(ClearGoneRequestSchema, ClearGoneReviewSchema, {
      describe: `Shows which bindings clearing the chosen gone controllers of one iRacing set would remove, and the file change. Only controllers goneDevices calls gone are accepted. Writes nothing. ${TICKED_ON_THE_PAGE}`,
      tier: 'off',
    }),
    /** Clears them in the set's controls.cfg through FileStore. Refused while iRacing runs. */
    clearGone: channel(ClearGoneRequestSchema, ClearGoneResultSchema, {
      describe: `Clears every binding of the chosen gone controllers in one iRacing set's controls.cfg, after a backup, as one change Undo reverses. Refused while iRacing runs, and for a controller that is not gone. ${TICKED_ON_THE_PAGE}`,
      tier: 'off',
    }),

    /** Starts reporting presses on any controller as `pressed` events. */
    listenStart: channel(noInput, z.object({ listening: z.boolean() }), {
      describe:
        'Starts sending pressed events for every controller press, for binding by pressing on the iRacing bindings page.',
      tier: 'off',
    }),
    listenStop: channel(noInput, z.object({ listening: z.boolean() }), {
      describe: 'Stops the pressed events started by listenStart.',
      tier: 'off',
    }),
  },
  {
    /** A button, hat direction or axis the user just used, while the page listens. */
    pressed: PressedSchema,
  }
);
