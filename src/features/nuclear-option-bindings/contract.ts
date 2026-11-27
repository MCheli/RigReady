import { z } from 'zod';
import { HAT_DIRECTIONS } from '../../core/bindings';
import { ChangePreviewSchema } from '../../shared/changePreview';
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
  /**
   * For a key RigReady can bind: the key as a change names it (the browser's name for the
   * physical key, and the modifier keys held with it). A row's Change and Clear send it back
   * as `replaces`, so that only this key of the action is touched.
   */
  key: z
    .object({ code: z.string(), ctrl: z.boolean(), alt: z.boolean(), shift: z.boolean() })
    .optional(),
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
  /**
   * What can be bound on a controller here, in the game's own order: each button action, and
   * each axis action as a whole (an axis) and by its two sides (a button each).
   */
  actions: z.array(
    z.object({
      /** The game's action id. */
      id: z.number().int(),
      /** The side of an axis action this entry is: "+" or "-". */
      side: z.enum(['+', '-']).optional(),
      /** The id of the bindings this entry has: "11", "25", "25:+". */
      key: z.string(),
      name: z.string(),
      category: z.string(),
      /** The tab of the game's controls screen its bindings are saved under: "Game", "Chat". */
      mapCategory: z.string(),
      /**
       * What it is bound to on a controller: a button, or an axis. On the keyboard, what
       * takes a button takes a key, and what takes an axis is not offered.
       */
      takes: z.enum(['button', 'axis']),
    })
  ),
  /** Saved maps that could not be read, in words. */
  problems: z.array(z.string()),
});
export type Overview = z.infer<typeof OverviewSchema>;

/** A key by the browser's name for the physical key, and the modifier keys held with it. */
const KeySchema = z.object({
  code: z.string().min(1).max(40),
  ctrl: z.boolean().default(false),
  alt: z.boolean().default(false),
  shift: z.boolean().default(false),
});

/**
 * One binding to change. On a controller: a button action bound to a button, one side of an
 * axis action bound to a button, or an axis action bound to an axis. On the keyboard: a
 * button action, or one side of an axis action, bound to a key. Or any of them cleared.
 */
export const ChangeRequestSchema = z
  .object({
    /** The controller, by its id in the overview. */
    device: z.string().min(1).max(300),
    /** The game's action id. */
    actionId: z.number().int().min(0).max(100000),
    /** For an axis action: the side a button is bound to ("+" Zoom In, "-" Zoom Out). */
    side: z.enum(['+', '-']).optional(),
    /** The button, as RigReady numbers buttons (1 is the first); null clears it. */
    button: z.number().int().min(1).max(128).nullable().optional(),
    /**
     * The controller's axis for an axis action as a whole, by the name RigReady shows it
     * under ("X", "RZ", "SLIDER1"), and whether the game is to reverse it; null clears it.
     */
    axis: z
      .object({ name: z.string().min(1).max(40), invert: z.boolean() })
      .nullable()
      .optional(),
    /**
     * On the keyboard (`device` "keyboard"): the key, by the browser's name for the physical
     * key (KeyboardEvent.code: "KeyG", "F7", "Numpad5"), and the modifier keys held with it;
     * null clears it.
     */
    key: KeySchema.nullable().optional(),
    /**
     * With `key`: the one of the action's keys this is about (the game's controls screen
     * shows two per action), as the overview gave it on the row. Without it, a clear takes
     * every key of the action and a bind adds a key beside what is there.
     */
    replaces: KeySchema.optional(),
    /**
     * The saved map as the preview read it (`seen` of changePreview). With it, change writes
     * nothing when the map is no longer that: what the user approved may not hold any more.
     */
    seen: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .refine((r) => [r.button, r.axis, r.key].filter((given) => given !== undefined).length === 1, {
    message: 'Give a button, an axis or a key: exactly one of them.',
  });
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;

/** One change as it would be, before anything is written. */
export const ChangeReviewSchema = z.object({
  /** The controller's name as the game saved it. */
  device: z.string(),
  action: z.string(),
  /** What the action is on now: "Button 3", "Not bound". */
  before: z.string(),
  after: z.string(),
  /** Nothing would change. */
  same: z.boolean(),
  /** What else is already on that button or axis: one press, or one movement, does those too. */
  alsoOnButton: z.array(z.string()),
  /** Why it cannot be saved right now (the game is running), when it cannot. */
  blocked: z.string().optional(),
  preview: ChangePreviewSchema,
  seen: z.string(),
});
export type ChangeReview = z.infer<typeof ChangeReviewSchema>;

export const ChangeResultSchema = z.object({ changed: z.boolean(), message: z.string() });
export type ChangeResult = z.infer<typeof ChangeResultSchema>;

/** A controller whose bindings are all to be cleared. */
export const ClearDeviceRequestSchema = z.object({
  /** The controller, by its id in the overview. */
  device: z.string().min(1).max(300),
  /** The saved maps as the preview read them (`seen` of clearDevicePreview). */
  seen: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type ClearDeviceRequest = z.infer<typeof ClearDeviceRequestSchema>;

/** Clearing a controller as it would be, before anything is written. */
export const ClearDeviceReviewSchema = z.object({
  /** The controller's name as the game saved it. */
  device: z.string(),
  /** How many bindings would go: buttons and axes, in every tab of the game's controls screen. */
  bindings: z.number().int(),
  /** Nothing is bound on it: nothing would change. */
  same: z.boolean(),
  /** Why it cannot be saved right now (the game is running), when it cannot. */
  blocked: z.string().optional(),
  preview: ChangePreviewSchema,
  seen: z.string(),
});
export type ClearDeviceReview = z.infer<typeof ClearDeviceReviewSchema>;

/** A named snapshot of the bindings, kept in RigReady's own folder. */
export const SnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** When it was taken, as an ISO date. */
  createdAt: z.string(),
  /** How many saved maps it holds, and how many bindings in them. */
  maps: z.number().int(),
  bindings: z.number().int(),
  /** What it has bindings for: each controller by name, "the keyboard", "the mouse". */
  devices: z.array(z.string()),
  /** Its file cannot be used (it was changed or cut short): it can only be deleted. */
  damaged: z.boolean().optional(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/** Restoring a snapshot as it would be, before anything is written. */
export const SnapshotRestoreReviewSchema = z.object({
  name: z.string(),
  /** Each device whose bindings would change: how many it has now, and in the snapshot. */
  devices: z.array(z.object({ name: z.string(), now: z.number().int(), then: z.number().int() })),
  /** Devices of the snapshot the game no longer has, or no longer uses, saved bindings for: not put back. */
  gone: z.array(z.string()),
  /** Devices the game has bindings for now that the snapshot does not hold: left as they are. */
  newer: z.array(z.string()),
  /** The bindings are already as in the snapshot. */
  same: z.boolean(),
  blocked: z.string().optional(),
  preview: ChangePreviewSchema,
  seen: z.string(),
});
export type SnapshotRestoreReview = z.infer<typeof SnapshotRestoreReviewSchema>;

const SnapshotId = z.object({ id: z.string().min(1).max(100) });
const SnapshotName = z.string().min(1).max(80);

/** A controller button the user just pressed, while the page listens. */
export const PressedSchema = z.object({
  /** The controller's DirectInput instance GUID. */
  device: z.string(),
  deviceName: z.string(),
  /** The button's number, the first being 1. */
  button: z.number().int(),
});
export type Pressed = z.infer<typeof PressedSchema>;

/** A controller axis the user just moved, while the page listens. */
export const MovedSchema = z.object({
  /** The controller's DirectInput instance GUID. */
  device: z.string(),
  deviceName: z.string(),
  /** The axis by the name RigReady shows it under: "X", "RZ", "SLIDER1". */
  axis: z.string(),
});
export type Moved = z.infer<typeof MovedSchema>;

const ON_THE_PAGE =
  'Changing a game binding is done on the Nuclear Option bindings page, where the person sees the change and presses Save.';

export const nuclearOptionBindingsContract = defineContract(
  'nuclear-option-bindings',
  {
    /** One change as it would be: what the action is on now and would be on. Writes nothing. */
    changePreview: channel(ChangeRequestSchema, ChangeReviewSchema, {
      describe: `Shows what binding one Nuclear Option action to a controller button or axis, or to a key, or clearing it, would change. Writes nothing. ${ON_THE_PAGE}`,
      tier: 'off',
    }),
    /**
     * Binds or clears one action on one controller in what the game saved, through FileStore
     * (a backup first, one entry on the Safety page). Refused while the game runs.
     */
    change: channel(ChangeRequestSchema, ChangeResultSchema, {
      describe: `Binds one Nuclear Option action to a controller button or axis, or to a key, or clears it, in the game's saved bindings, after a backup. Refused while the game runs. ${ON_THE_PAGE}`,
      tier: 'off',
    }),
    /** Clearing one controller as it would be: how many bindings would go. Writes nothing. */
    clearDevicePreview: channel(ClearDeviceRequestSchema, ClearDeviceReviewSchema, {
      describe: `Shows what taking every Nuclear Option binding off one controller would change. Writes nothing. ${ON_THE_PAGE}`,
      tier: 'off',
    }),
    /**
     * Takes every binding off one controller in what the game saved, through FileStore (a
     * backup first, one entry on the Safety page). Refused while the game runs.
     */
    clearDevice: channel(ClearDeviceRequestSchema, ChangeResultSchema, {
      describe: `Takes every Nuclear Option binding off one controller, buttons and axes, in the game's saved bindings, after a backup. Refused while the game runs. ${ON_THE_PAGE}`,
      tier: 'off',
    }),
    snapshots: channel(noInput, z.array(SnapshotSchema), {
      describe:
        'Lists the snapshots RigReady has kept of Nuclear Option’s bindings (named copies of what the game saved for every controller, the keyboard and the mouse). Ids for the other snapshot channels come from here. Changes nothing.',
      tier: 'read',
    }),
    snapshotCreate: channel(z.object({ name: SnapshotName }), SnapshotSchema, {
      describe:
        "Takes a named snapshot of Nuclear Option's bindings as the game saved them, into RigReady's own folder. The game's values are only read.",
      tier: 'change',
    }),
    snapshotRename: channel(SnapshotId.extend({ name: SnapshotName }), SnapshotSchema, {
      describe:
        'Gives a snapshot of Nuclear Option’s bindings a new name. id comes from nuclear-option-bindings:snapshots.',
      tier: 'change',
    }),
    snapshotDelete: channel(SnapshotId, z.object({ deleted: z.boolean() }), {
      describe:
        "Deletes a snapshot of Nuclear Option's bindings from RigReady's folder. id comes from nuclear-option-bindings:snapshots. Ask the user first.",
      tier: 'change',
    }),
    /** Restoring a snapshot as it would be: which devices change. Writes nothing. */
    snapshotRestorePreview: channel(SnapshotId, SnapshotRestoreReviewSchema, {
      describe: `Shows what putting a snapshot of Nuclear Option's bindings back would change. Writes nothing. ${ON_THE_PAGE}`,
      tier: 'off',
    }),
    /**
     * Puts a snapshot's bindings back into what the game saved, through FileStore (a backup
     * first, one entry on the Safety page). Refused while the game runs.
     */
    snapshotRestore: channel(
      SnapshotId.extend({
        seen: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .optional(),
      }),
      ChangeResultSchema,
      {
        describe: `Puts a snapshot of Nuclear Option's bindings back into the game's saved bindings, after a backup. Refused while the game runs. ${ON_THE_PAGE}`,
        tier: 'off',
      }
    ),
    overview: channel(noInput, OverviewSchema, {
      describe:
        'Nuclear Option’s bindings as the game saved them: every controller, the keyboard and the mouse, with the action each input does. Read from the registry; changes nothing. The game has one set of bindings for every aircraft.',
      tier: 'read',
    }),
    /** Starts reporting button presses on any controller as `pressed` events. */
    listenStart: channel(noInput, z.object({ listening: z.boolean() }), {
      describe:
        'Starts sending pressed events for every controller button press and moved events for every axis moved, for choosing a button or an axis by using it on the Nuclear Option bindings page.',
      tier: 'off',
    }),
    listenStop: channel(noInput, z.object({ listening: z.boolean() }), {
      describe: 'Stops the pressed events started by listenStart.',
      tier: 'off',
    }),
  },
  {
    /** A controller button the user just pressed, while the page listens. */
    pressed: PressedSchema,
    /** A controller axis the user just moved, while the page listens. */
    moved: MovedSchema,
  }
);
