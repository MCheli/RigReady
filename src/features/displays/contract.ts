import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { DisplayLayoutSchema, DisplayTargetSchema, RotationSchema } from '../../shared/models';

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
  connected: z.boolean(),
});
export type LayoutMonitor = z.infer<typeof LayoutMonitorSchema>;

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
});
export type ApplyPreview = z.infer<typeof ApplyPreviewSchema>;

export const RecoveryViewSchema = z.object({
  savedAt: z.string(),
  /** One line per monitor of the layout that would come back. */
  lines: z.array(z.string()),
});
export type RecoveryView = z.infer<typeof RecoveryViewSchema>;

export const displaysContract = defineContract(
  'displays',
  {
    read: channel(noInput, DisplayLayoutSchema),
    /** Whether a keep-or-revert decision is open, and how long the countdown is in total. */
    pending: channel(noInput, z.object({ pending: z.boolean(), seconds: z.number() })),
    /** Keep the layout that was just applied. */
    keep: channel(noInput, z.object({ kept: z.boolean() })),
    /** Go back to the layout from before the last apply. */
    revert: channel(noInput, DisplayLayoutSchema),

    /** Everything the Monitors page shows. */
    view: channel(noInput, DisplaysViewSchema),
    /** Shows each enabled monitor's number on the monitor itself for a few seconds. */
    identify: channel(noInput, z.object({ shown: z.number().int(), off: z.number().int() })),
    /**
     * "Which way is up?": turns one monitor upside down (its rotation plus 180°), with
     * the keep-or-revert question. When kept, every saved layout that has this monitor
     * in the old orientation gets the new one, so the answer is stored where it is used.
     */
    flip: channel(
      z.object({ id: z.string() }),
      z.object({ kept: z.boolean(), layoutsUpdated: z.number().int(), message: z.string() })
    ),
    /** The user says Identify's arrow points up on every monitor that is on. */
    confirmUpright: channel(noInput, DisplaysViewSchema),
    /** Names a monitor ("MFD left"); an empty name removes it. */
    setName: channel(z.object({ id: z.string(), name: z.string() }), DisplaysViewSchema),
    /** Saves the monitors as they are now under a new name. */
    saveLayout: channel(z.object({ name: z.string() }), DisplaysViewSchema),
    /** Replaces a saved layout's arrangement with the monitors as they are now. */
    updateLayout: channel(z.object({ id: z.string() }), DisplaysViewSchema),
    /** Saves an edited arrangement of a layout. */
    editLayout: channel(
      z.object({ id: z.string(), displays: z.array(DisplayTargetSchema).min(1) }),
      DisplaysViewSchema
    ),
    renameLayout: channel(z.object({ id: z.string(), name: z.string() }), DisplaysViewSchema),
    removeLayout: channel(z.object({ id: z.string() }), DisplaysViewSchema),
    /** The layout Stand down goes back to; null for none. */
    setDeskLayout: channel(z.object({ id: z.string().nullable() }), DisplaysViewSchema),
    /** What applying a layout would change. */
    preview: channel(z.object({ id: z.string() }), ApplyPreviewSchema),
    /**
     * Applies a saved layout, then the keep-or-revert countdown runs. A layout with
     * monitors that are not connected is applied only with `withoutMissing`.
     */
    applyLayout: channel(
      z.object({ id: z.string(), withoutMissing: z.boolean().default(false) }),
      z.object({ message: z.string() })
    ),
    /** A layout change that was never kept or reverted because RigReady closed. */
    recovery: channel(noInput, RecoveryViewSchema.nullable()),
    /** Puts back the layout from before that change (restore) or forgets it. */
    recover: channel(z.object({ restore: z.boolean() }), z.object({ message: z.string() })),
  },
  {
    /** A layout was applied; it reverts by itself after `seconds` unless kept. */
    applied: z.object({ seconds: z.number() }),
    settled: z.object({ outcome: z.enum(['kept', 'reverted', 'revertFailed']) }),
  }
);
