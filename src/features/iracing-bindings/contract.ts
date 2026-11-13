import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';

/** The id of the set every car uses (Documents\iRacing\controls.cfg). */
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
});
export type BindingSet = z.infer<typeof BindingSetSchema>;

export const OverviewSchema = z.object({
  /** iRacing's program was found on this PC. */
  installed: z.boolean(),
  /** Documents\iRacing, when it exists. */
  folder: z.string().optional(),
  /** The simulator is running now: it writes its files when it exits. */
  simRunning: z.boolean(),
  /** The sets found, "All cars" first. Empty when iRacing has no controls.cfg yet. */
  sets: z.array(BindingSetSchema),
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

export const iracingBindingsContract = defineContract('iracing-bindings', {
  /** Where iRacing keeps bindings and which sets there are. */
  overview: channel(noInput, OverviewSchema, {
    describe:
      "Says whether iRacing's bindings are on this PC, where they are kept, whether the simulator is running, and which sets there are: one for all cars, and one for each car that has custom controls. Start here: the set ids iracing-bindings:set takes come from it. Changes nothing.",
    tier: 'read',
  }),
  /** Every action of one set, with what is bound to it. */
  set: channel(z.object({ id: z.string() }), SetViewSchema, {
    describe:
      'Lists every action of one iRacing binding set with what is bound to it (a controller button or axis, or a key), the controllers the set names and whether each is plugged in, the inputs that do more than one thing, and for a car what differs from the set for all cars. id is a set id from iracing-bindings:overview ("all" for all cars). Reads only: RigReady does not change iRacing bindings.',
    tier: 'read',
  }),
});
