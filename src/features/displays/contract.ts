import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { DisplayLayoutSchema, DisplayTargetSchema, RotationSchema } from '../../shared/models';
import { PreviewMonitorSchema } from './core/previewMap';

/** A connected monitor as the Monitors page shows it. */
export const MonitorViewSchema = z.object({
  id: z.string(),
  /** EDID name, e.g. "USB_Monitor". */
  name: z.string(),
  /** What RigReady calls it: the user's name, or the EDID name with "(2 of 3)". */
  label: z.string(),
  /** The name the user gave it. */
  friendlyName: z.string().optional(),
  /** The number Identify shows on it; only monitors that are on have one. */
  number: z.number().int().optional(),
  edid: z.string().optional(),
  gdiName: z.string().optional(),
  /** HDMI, DisplayPort, USB, ... */
  connector: z.string().optional(),
  /** EDID serial number, when the monitor has a real one. */
  serial: z.string().optional(),
  /** For a USB screen: the serial of its USB device, which follows it to any port. */
  usbSerial: z.string().optional(),
  enabled: z.boolean(),
  primary: z.boolean(),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  rotation: RotationSchema,
  refreshHz: z.number().optional(),
  /** Other connected monitors share its EDID name. */
  identical: z.boolean(),
  /** How identical monitors are told apart: by a serial that follows the screen, or only by the port it is on. */
  toldApartBy: z.enum(['serial', 'port']).optional(),
  /** The user has looked at Identify's arrow on this screen and said it points up. */
  uprightConfirmed: z.boolean().default(false),
});
export type MonitorView = z.infer<typeof MonitorViewSchema>;

/** One monitor of a saved layout. */
export const LayoutMonitorSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  primary: z.boolean(),
  x: z.number().int(),
  y: z.number().int(),
  /** Desktop size; from the connected monitor when the layout does not say. */
  width: z.number().int(),
  height: z.number().int(),
  rotation: RotationSchema,
  /** The refresh rate the layout asks for; absent when it leaves the rate to Windows. */
  refreshHz: z.number().positive().optional(),
  connected: z.boolean(),
});
export type LayoutMonitor = z.infer<typeof LayoutMonitorSchema>;

/** A connected monitor a layout does not list, and whether it is on now. */
const UntouchedSchema = z.object({ label: z.string(), on: z.boolean() });

export const LayoutViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  updatedAt: z.string(),
  isDesk: z.boolean(),
  monitors: z.array(LayoutMonitorSchema),
  /** current: the monitors are arranged like this now; incomplete: some are not connected. */
  status: z.enum(['current', 'different', 'incomplete']),
  differences: z.array(z.string()),
  missing: z.array(z.string()),
  /** Connected monitors the layout does not list: applying it leaves them as they are. */
  untouched: z.array(UntouchedSchema).default([]),
});
export type LayoutView = z.infer<typeof LayoutViewSchema>;

export const DisplaysViewSchema = z.object({
  monitors: z.array(MonitorViewSchema),
  layouts: z.array(LayoutViewSchema),
  /** Set when the saved layouts file cannot be read. */
  layoutsError: z.string().optional(),
  deskLayoutId: z.string().optional(),
  /** A layout change made by RigReady can be undone (Windows' own changes cannot). */
  canRevert: z.boolean(),
});
export type DisplaysView = z.infer<typeof DisplaysViewSchema>;

/** "What would change" before a layout is applied. */
export const ApplyPreviewSchema = z.object({
  layoutId: z.string(),
  name: z.string(),
  changes: z.array(z.string()),
  missing: z.array(z.string()),
  /** The layout's main display when it is not connected. */
  primaryMissing: z.string().optional(),
  /** The monitor that would be the main display. */
  primaryLabel: z.string().optional(),
  /** Reasons it cannot be applied at all. */
  problems: z.array(z.string()),
  enabledCount: z.number().int(),
  /** Connected monitors the layout does not list: applying it leaves them as they are. */
  untouched: z.array(UntouchedSchema).default([]),
  /** Every monitor as it is now and as it would be, for the picture of the change. */
  before: z.array(PreviewMonitorSchema).default([]),
  after: z.array(PreviewMonitorSchema).default([]),
});
export type ApplyPreview = z.infer<typeof ApplyPreviewSchema>;

export const RecoveryViewSchema = z.object({
  savedAt: z.string(),
  /** One line per monitor of the layout that would come back. */
  lines: z.array(z.string()),
});
export type RecoveryView = z.infer<typeof RecoveryViewSchema>;

/** The "Keep this monitor layout?" question as it is shown. */
export const QuestionSchema = z.object({
  /** How long the countdown is in total. */
  seconds: z.number(),
  /** The assistant that asked for the change. Absent when it was done in RigReady's window. */
  askedBy: z.string().optional(),
  /**
   * Make ready or Stand down is asking, because this PC has not kept this layout before
   * with these monitors. Once it is kept they apply it without asking.
   */
  firstTime: z.boolean().optional(),
});
export type LayoutQuestion = z.infer<typeof QuestionSchema>;

/** What "Which way is up?" answers with. */
const TurnedSchema = z.object({
  kept: z.boolean(),
  layoutsUpdated: z.number().int(),
  message: z.string(),
});

export const displaysContract = defineContract(
  'displays',
  {
    read: channel(noInput, DisplayLayoutSchema, {
      describe:
        'Answers with the monitors as Windows has them arranged now: position, size, rotation, which are on and which is the main display. Changes nothing.',
      tier: 'read',
    }),
    /** Whether a keep-or-revert decision is open, and how long the countdown is in total. */
    pending: channel(noInput, QuestionSchema.extend({ pending: z.boolean() }), {
      describe:
        'Says whether a monitor change is waiting for keep or revert, how long its countdown is, and which assistant asked for the change. Changes nothing.',
      tier: 'read',
    }),
    /** Keep the layout that was just applied. */
    keep: channel(noInput, z.object({ kept: z.boolean() }), {
      describe:
        'Keeps the monitor layout that was just applied and stops the countdown that would undo it. Use only when the user says the new layout is fine. Better still, let the user press Keep it in RigReady: only that makes Make ready and Stand down apply the layout without asking next time.',
      tier: 'change',
    }),
    /** Go back to the layout from before the last apply. */
    revert: channel(noInput, DisplayLayoutSchema, {
      describe: 'Puts the monitors back as they were before the last change RigReady made.',
      tier: 'change',
    }),

    /** Everything the Monitors page shows. */
    view: channel(noInput, DisplaysViewSchema, {
      describe:
        'Answers with everything the Monitors page shows: each connected monitor with its name, the saved layouts and how each differs from now, and the layout Stand down goes back to. Layout and monitor ids come from here. Changes nothing.',
      tier: 'read',
    }),
    /** Shows each enabled monitor's number on the monitor itself for a few seconds. */
    identify: channel(noInput, z.object({ shown: z.number().int(), off: z.number().int() }), {
      describe:
        "Shows each monitor's number on the monitor itself for a few seconds, so the user can tell which is which. Changes nothing.",
      tier: 'read',
    }),
    /**
     * "Which way is up?": turns one monitor upside down (its rotation plus 180°), with
     * the keep-or-revert question. When kept, every saved layout that has this monitor
     * in the old orientation gets the new one, so the answer is stored where it is used.
     */
    flip: channel(z.object({ id: z.string() }), TurnedSchema, {
      describe:
        'Turns one monitor upside down, then waits until the person at the screens keeps it or the countdown puts it back. When kept, saved layouts with this monitor get the new rotation. id is a monitor id from displays:view. Ask the user first.',
      tier: 'change',
    }),
    /**
     * "Which way is up?" for a screen mounted on its side: turns one monitor so that the
     * arrow Identify draws, seen pointing `arrow`, points up. Right and left are quarter
     * turns: the monitors beside it move to stay beside it, in saved layouts too.
     */
    turn: channel(
      z.object({ id: z.string(), arrow: z.enum(['right', 'down', 'left']) }),
      TurnedSchema,
      {
        describe:
          'Turns one monitor so that the arrow displays:identify draws on it points up. arrow is where the user sees that arrow point now: right or left (a quarter turn; the monitors beside it move to stay beside it) or down (half a turn). Then waits until the person at the screens keeps it or the countdown puts it back. When kept, saved layouts with this monitor are corrected. id is a monitor id from displays:view. Ask the user which way the arrow points; never guess.',
        tier: 'change',
      }
    ),
    /** The user says Identify's arrow points up on every monitor that is on. */
    confirmUpright: channel(noInput, DisplaysViewSchema, {
      describe:
        "Records that the user saw Identify's arrow point up on every monitor that is on. Use only after the user said so.",
      tier: 'change',
    }),
    /** Names a monitor ("MFD left"); an empty name removes it. */
    setName: channel(z.object({ id: z.string(), name: z.string() }), DisplaysViewSchema, {
      describe:
        'Gives a monitor a name, such as MFD left; an empty name removes it. id is a monitor id from displays:view.',
      tier: 'change',
    }),
    /** Saves the monitors as they are now under a new name. */
    saveLayout: channel(z.object({ name: z.string() }), DisplaysViewSchema, {
      describe: 'Saves the monitors as they are now as a new layout with the given name.',
      tier: 'change',
    }),
    /**
     * "New layout": the monitors as they are now with only the chosen ones left on. Every
     * connected monitor is listed in it, the others as off.
     */
    newLayout: channel(
      z.object({ name: z.string(), stayOn: z.array(z.string()).min(1) }),
      DisplaysViewSchema,
      {
        describe:
          'Saves a new layout with the given name in which only the monitors in stayOn are on; every other connected monitor is saved as off, so applying the layout switches it off. stayOn holds monitor ids from displays:view, of monitors that are on now. Does not change the monitors.',
        tier: 'change',
      }
    ),
    /** Replaces a saved layout's arrangement with the monitors as they are now. */
    updateLayout: channel(z.object({ id: z.string() }), DisplaysViewSchema, {
      describe:
        "Replaces a saved layout's arrangement with the monitors as they are now. The arrangement it held is gone and cannot be brought back, so show the user what changes (the layout's differences in displays:view) and ask first. id is a layout id from displays:view.",
      tier: 'change',
    }),
    /** Saves an edited arrangement of a layout. */
    editLayout: channel(
      z.object({ id: z.string(), displays: z.array(DisplayTargetSchema).min(1) }),
      DisplaysViewSchema,
      {
        describe:
          'Saves an edited arrangement of a saved layout. id is a layout id from displays:view. Does not change the monitors.',
        tier: 'change',
      }
    ),
    renameLayout: channel(z.object({ id: z.string(), name: z.string() }), DisplaysViewSchema, {
      describe: 'Renames a saved layout. id is a layout id from displays:view.',
      tier: 'change',
    }),
    removeLayout: channel(z.object({ id: z.string() }), DisplaysViewSchema, {
      describe: 'Deletes a saved layout. id is a layout id from displays:view. Ask the user first.',
      tier: 'change',
    }),
    /** The layout Stand down goes back to; null for none. */
    setDeskLayout: channel(z.object({ id: z.string().nullable() }), DisplaysViewSchema, {
      describe:
        'Chooses the layout Stand down puts the monitors back to; null for None. id is a layout id from displays:view.',
      tier: 'change',
    }),
    /** What applying a layout would change. */
    preview: channel(z.object({ id: z.string() }), ApplyPreviewSchema, {
      describe:
        'Shows what applying a saved layout would change, which monitors are missing, and why it cannot be applied if so. Call it before displays:applyLayout and show the user. Changes nothing.',
      tier: 'read',
    }),
    /**
     * Applies a saved layout and waits for the answer to "Keep this monitor layout?".
     * `kept` is false when it went back. A layout with monitors that are not connected is
     * applied only with `withoutMissing`.
     */
    applyLayout: channel(
      z.object({ id: z.string(), withoutMissing: z.boolean().default(false) }),
      z.object({ kept: z.boolean(), message: z.string() }),
      {
        describe:
          'Applies a saved layout to the monitors, then waits: the person at the screens keeps it in RigReady, or the countdown puts the previous layout back. Answers with kept (false when the monitors went back) and what happened. withoutMissing applies it with monitors that are not connected left out. Call displays:preview first and show the user.',
        tier: 'change',
      }
    ),
    /** A layout change that was never kept or reverted because RigReady closed. */
    recovery: channel(noInput, RecoveryViewSchema.nullable(), {
      describe:
        'Answers with a monitor change that was never kept or reverted because RigReady closed, and the layout that would come back; null when there is none. Changes nothing.',
      tier: 'read',
    }),
    /** Puts back the layout from before that change (restore) or forgets it. */
    recover: channel(z.object({ restore: z.boolean() }), z.object({ message: z.string() }), {
      describe:
        'For the change displays:recovery reports: restore true puts the monitors back as they were before it and starts the keep-or-revert countdown, false forgets it.',
      tier: 'change',
    }),
  },
  {
    /** A layout was applied; it reverts by itself after `seconds` unless kept. */
    applied: QuestionSchema,
    settled: z.object({ outcome: z.enum(['kept', 'reverted', 'revertFailed']) }),
    /**
     * Make ready or Stand down applied a layout this PC has kept before, without the
     * question. Open pages show the monitors as they are now.
     */
    appliedKnown: z.object({}),
  }
);
