import { z } from 'zod';
import { HAT_DIRECTIONS } from '../../core/bindings';
import { channel, defineContract, noInput } from '../../shared/ipc';

/** The control on the controller, in core's vocabulary (button 1 is the first button). */
const ControlSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('button'), index: z.number().int() }),
  z.object({ kind: z.literal('hat'), hat: z.number().int(), direction: z.enum(HAT_DIRECTIONS) }),
  z.object({ kind: z.literal('axis'), axis: z.string() }),
]);

const BindingSchema = z.object({
  /** The game's action id, as text. */
  actionId: z.string(),
  /** The action as the game's controls screen names it: "Toggle Gear", "Pitch Down". */
  action: z.string(),
  /** "Flight Controls", "Camera Controls", ... */
  category: z.string(),
  /** The tab of the game's controls screen the binding is under: "Game", "Chat", ... */
  mapCategory: z.string(),
  /** The input as the game's own screen shows it: "Button 4" (counted from 0), "Axis 1", "W". */
  input: z.string(),
  /** The input in RigReady's words: "Button 5", "Y axis", "W". */
  inputLabel: z.string(),
  kind: z.enum(['button', 'hat', 'axis', 'key']),
  control: ControlSchema.optional(),
  /** Keys that must be held with it: "Ctrl", "Shift". */
  modifiers: z.array(z.string()),
  /** The axis is reversed in the game. */
  inverted: z.boolean(),
});
export type OverviewBinding = z.infer<typeof BindingSchema>;

const DeviceSchema = z.object({
  id: z.string(),
  kind: z.enum(['controller', 'keyboard', 'mouse']),
  name: z.string(),
  /** Plugged in now (always true for the keyboard and the mouse). */
  connected: z.boolean(),
  /** DirectInput instance GUID of the plugged-in controller. */
  guid: z.string().optional(),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  controls: z
    .object({ buttons: z.number().int(), hats: z.number().int(), axes: z.array(z.string()) })
    .optional(),
  bindings: z.array(BindingSchema),
});
export type OverviewDevice = z.infer<typeof DeviceSchema>;

const OverviewSchema = z.object({
  /** The game is found on this PC. */
  installed: z.boolean(),
  /** The game has saved bindings on this PC (it does once it has run). */
  saved: z.boolean(),
  /** Where the bindings were read from, in words. */
  registryKey: z.string(),
  devices: z.array(DeviceSchema),
  /** Saved maps that could not be read, in words. */
  problems: z.array(z.string()),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const nuclearOptionBindingsContract = defineContract('nuclear-option-bindings', {
  overview: channel(noInput, OverviewSchema, {
    describe:
      'Nuclear Option’s bindings as the game saved them: every controller, the keyboard and the mouse, with the action each input does. Read from the registry; changes nothing. The game has one set of bindings for every aircraft.',
    tier: 'read',
  }),
});
