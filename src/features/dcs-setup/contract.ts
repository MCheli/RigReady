import { z } from 'zod';
import { ChangePreviewSchema } from '../../shared/changePreview';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { LaunchTargetSchema } from '../../shared/models';
import { ExportToolSchema } from './core/exportLua';
import { DesktopDisplaySchema, ScreenSetupSchema } from './core/screens';
import { RuntimeFeatureSchema } from './core/simAppProShared';

const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const OptionsSchema = z.object({
  multiMonitorSetup: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  aspect: z.number().optional(),
  fullScreen: z.boolean().optional(),
  vr: z.boolean().optional(),
});

export const LineDiffSchema = z.object({
  kind: z.enum(['same', 'added', 'removed']),
  text: z.string(),
});

const MonitorSetupFileSchema = z.object({
  path: z.string(),
  folder: z.enum(['user', 'install']),
  stem: z.string(),
  name: z.string(),
  description: z.string(),
  cameras: z.array(z.object({ name: z.string(), rect: RectSchema })),
  exports: z.array(z.object({ name: z.string(), rect: RectSchema })),
  error: z.string().optional(),
  /** Who wrote it, as far as can be told. */
  author: z.enum(['rigready', 'simapppro', 'dcs', 'other']),
});
export type MonitorSetupFileView = z.infer<typeof MonitorSetupFileSchema>;

const ToolStatusSchema = z.object({
  tool: ExportToolSchema,
  name: z.string(),
  purpose: z.string(),
  /** Active load lines (more than one is a duplicate). */
  active: z.number().int(),
  /** Commented-out load lines. */
  disabled: z.number().int(),
  /** The tool's script is in Saved Games. */
  installed: z.boolean(),
});

export const OverviewSchema = z.object({
  found: z.boolean(),
  problem: z.string().optional(),
  installs: z.array(
    z.object({
      source: z.enum(['steam', 'standalone', 'store']),
      installDir: z.string(),
      userDir: z.string().optional(),
      launch: LaunchTargetSchema.optional(),
      version: z.string().optional(),
      updatePending: z.boolean().optional(),
      versionProblem: z.string().optional(),
    })
  ),
  userFolders: z.array(z.object({ label: z.string(), path: z.string(), orphaned: z.boolean() })),
  lastRun: z.string().optional(),
  verified: z.object({ version: z.string(), at: z.string() }).optional(),
  aircraft: z.array(
    z.object({
      unit: z.string(),
      label: z.string(),
      module: z.string().optional(),
      hasBindings: z.boolean(),
    })
  ),
  options: OptionsSchema.optional(),
  optionsProblem: z.string().optional(),
  monitorSetup: z.object({
    option: z.string().optional(),
    file: MonitorSetupFileSchema.optional(),
    rigReady: z.boolean(),
    problems: z.array(z.string()),
  }),
  exportLua: z.object({
    exists: z.boolean(),
    tools: z.array(ToolStatusSchema),
    unknown: z.number().int(),
    changedOutside: z.boolean(),
    streamDeckNeedsExportScript: z.boolean(),
  }),
  simAppPro: z.object({
    installed: z.boolean(),
    version: z.string().optional(),
    running: z.boolean(),
    planFound: z.boolean(),
  }),
  managedChanged: z.array(z.string()),
  dcsRunning: z.boolean(),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const DesktopChoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  displays: z.array(DesktopDisplaySchema),
});
export type DesktopChoice = z.infer<typeof DesktopChoiceSchema>;

export const CatalogSchema = z.array(
  z.object({ unit: z.string(), label: z.string(), displays: z.array(z.string()) })
);

export const ScreensStateSchema = z.object({
  problem: z.string().optional(),
  /** False when DCS World is not on this PC at all (the page shows the shared empty state). */
  dcsFound: z.boolean().optional(),
  desktops: z.array(DesktopChoiceSchema),
  saved: ScreenSetupSchema.optional(),
  files: z.array(MonitorSetupFileSchema),
  options: OptionsSchema.optional(),
  rigReady: z.object({
    path: z.string(),
    exists: z.boolean(),
    editedOutside: z.boolean(),
    selected: z.boolean(),
  }),
  /** Every installed aircraft with exportable displays (read from its cockpit scripts), or the built-in list. */
  catalog: CatalogSchema,
  /** The unit of the aircraft the setup in use is for, when its name says: the editor starts on it. */
  aircraftInUse: z.string().optional(),
  simAppProPlan: z.boolean(),
  dcsRunning: z.boolean(),
});
export type ScreensState = z.infer<typeof ScreensStateSchema>;

/** One of SimAppPro's screens and the monitor it was paired with (core/simAppProImport.ts). */
export const PlanScreenSchema = z.object({
  planId: z.string(),
  rect: RectSchema.optional(),
  main: z.boolean(),
  shows: z.array(z.string()),
  aircraft: z.string().optional(),
  displayId: z.string().optional(),
  how: z.enum(['chosen', 'name', 'position', 'left', 'none']),
  certain: z.boolean(),
  note: z.string(),
});
export const PlanPairingSchema = z.object({
  /** True when no pairing needs the user's eye. */
  certain: z.boolean(),
  screens: z.array(PlanScreenSchema),
});
export type PlanPairing = z.infer<typeof PlanPairingSchema>;

export const ApplyScreensSchema = z.object({
  setup: ScreenSetupSchema,
  /** Also set options.lua width/height/aspect to the window the setup needs. */
  setResolution: z.boolean().default(true),
  /** The user saw that RigReady.lua was edited outside RigReady and chose to replace it. */
  overwriteEdited: z.boolean().default(false),
  /**
   * The user looked at which of SimAppPro's screens is which monitor and said the pairing
   * is right. Needed only while the last import was not certain of a pairing this setup uses.
   */
  pairingChecked: z.boolean().default(false),
});

export const ScreensPreviewSchema = z.object({
  /**
   * Present while applying would be refused for an unchecked pairing: the pairing of the
   * last import from SimAppPro, for the user to look at.
   */
  pairingToCheck: PlanPairingSchema.optional(),
  lua: z.string(),
  window: RectSchema,
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  file: z.object({
    path: z.string(),
    status: z.enum(['new', 'same', 'update', 'editedOutside']),
    /** Against what is on disk now. */
    diff: z.array(LineDiffSchema),
  }),
  optionChanges: z.array(z.string()),
  dcsRunning: z.boolean(),
});
export type ScreensPreview = z.infer<typeof ScreensPreviewSchema>;

export const ExportActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), tool: ExportToolSchema }),
  z.object({ kind: z.literal('remove'), tool: ExportToolSchema }),
  z.object({ kind: z.literal('dedupe'), tool: ExportToolSchema }),
  z.object({ kind: z.literal('restore') }),
]);
export type ExportAction = z.infer<typeof ExportActionSchema>;

export const ExportStateSchema = z.object({
  problem: z.string().optional(),
  /** False when DCS World is not on this PC at all. */
  dcsFound: z.boolean().optional(),
  path: z.string(),
  exists: z.boolean(),
  lines: z.array(
    z.object({
      index: z.number().int(),
      text: z.string(),
      eol: z.enum(['\r\n', '\n', '']),
      tool: z.string().optional(),
      helper: z.boolean(),
      disabled: z.boolean(),
    })
  ),
  tools: z.array(ToolStatusSchema),
  unknown: z.number().int(),
  changedOutside: z
    .object({ added: z.array(z.string()), removed: z.array(z.string()), at: z.string() })
    .optional(),
  streamDeckDcsPlugin: z.boolean(),
  dcsRunning: z.boolean(),
  simAppProRunning: z.boolean(),
});
export type ExportState = z.infer<typeof ExportStateSchema>;

const MessageSchema = z.object({ message: z.string(), changes: z.array(z.string()).default([]) });

export const SimAppProStateSchema = z.object({
  /** False when DCS World is not on this PC at all: there is nothing to do in place of SimAppPro. */
  dcsFound: z.boolean().optional(),
  installed: z.boolean(),
  version: z.string().optional(),
  running: z.boolean(),
  planFound: z.boolean(),
  profiles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      features: z.array(RuntimeFeatureSchema),
    })
  ),
  managed: z.array(
    z.object({
      label: z.string(),
      path: z.string(),
      status: z.enum(['unchanged', 'changed', 'notManaged', 'missing']),
      details: z.array(z.string()),
    })
  ),
});
export type SimAppProState = z.infer<typeof SimAppProStateSchema>;

export const dcsSetupContract = defineContract('dcs-setup', {
  /** Everything about DCS at a glance. */
  overview: channel(noInput, OverviewSchema, {
    describe:
      'Everything about DCS at a glance: where it is installed, its version, the Saved Games folder, the monitor setup in use, Export.lua tools, SimAppPro, files RigReady manages that were changed outside it, and whether DCS is running. Changes nothing.',
    tier: 'read',
  }),
  /** The screen editor's starting point. */
  screens: channel(noInput, ScreensStateSchema, {
    describe:
      'The starting point for the DCS screen setup: monitor layouts (desktop ids), the saved screen setup, monitor setup files, options.lua values, the aircraft catalog and whether DCS is running. Changes nothing.',
    tier: 'read',
  }),
  /** SimAppPro's MFD plan as a screen setup for one of the monitor layouts. */
  importSimAppPro: channel(
    z.object({
      desktopId: z.string(),
      /** The user's own pairing: SimAppPro's screen id to a monitor id of the layout, or null to leave that screen out. */
      pairs: z.record(z.string(), z.string().nullable()).default({}),
    }),
    z.object({
      setup: ScreenSetupSchema,
      unmatched: z.array(z.string()),
      catalog: CatalogSchema,
      pairing: PlanPairingSchema,
    }),
    {
      describe:
        "Turns SimAppPro's MFD plan into a screen setup for one monitor layout, with the screens it could not place. desktopId comes from dcs-setup:screens. SimAppPro knows a screen only by where it was on the desktop when the plan was saved, so the answer also says which of its screens was paired with which monitor, how (the name the user gave the monitor, or its position) and whether that is certain. When pairing.certain is false, show the user the pairing and let them correct it (pass their choice as pairs) before the setup is applied: until the user has said the pairing is right, dcs-setup:applyScreens refuses a setup that uses a pairing RigReady was not sure of. Nothing is saved; pass the setup to previewScreens and applyScreens.",
      tier: 'read',
    }
  ),
  /** "Identify screens": a number on every monitor, with what the setup shows there. */
  identifyScreens: channel(
    z.object({ setup: ScreenSetupSchema }),
    z.object({ shown: z.number().int(), off: z.number().int() }),
    {
      describe:
        "Shows a number on every monitor that is on for a few seconds, with the user's name for the monitor and what the given screen setup shows there, so the user can tell which screen is which. The numbers are the same as on the Monitors page. Changes nothing.",
      tier: 'read',
    }
  ),
  previewScreens: channel(ApplyScreensSchema, ScreensPreviewSchema, {
    describe:
      'Shows what applying a screen setup would write (RigReady.lua and the options.lua keys), with errors found and files edited outside RigReady. When the answer has pairingToCheck, the setup uses a pairing from the last SimAppPro import that RigReady was not sure of: show the user those pairings before anything else. Nothing is changed. Call it before dcs-setup:applyScreens and show the user.',
    tier: 'read',
  }),
  /** Writes RigReady.lua and selects it in options.lua, as one undoable change. */
  applyScreens: channel(ApplyScreensSchema, MessageSchema, {
    describe:
      'Writes RigReady.lua and selects it in options.lua (and sets the resolution when setResolution) as one change that can be undone. Call dcs-setup:previewScreens first and show the user. DCS must be closed. Refused with the reason dcs.screens.pairing while the setup uses a pairing from the last SimAppPro import that RigReady was not sure of: show the user which screen was paired with which monitor, and pass pairingChecked true only after the user has said the pairing is right.',
    tier: 'change',
  }),
  exportLua: channel(noInput, ExportStateSchema, {
    describe:
      "The state of DCS's Export.lua: which tools (such as WinWing or DCS-BIOS) are loaded, installed or loaded twice, and whether it changed since RigReady last saw it. Changes nothing.",
    tier: 'read',
  }),
  previewExport: channel(
    ExportActionSchema,
    z.object({ diff: z.array(LineDiffSchema), changed: z.boolean() }),
    {
      describe:
        'Shows the line by line change to Export.lua that adding, removing or deduplicating a tool (or restoring) would make. Tool names come from dcs-setup:exportLua. Nothing is changed. Call it before dcs-setup:applyExport and show the user.',
      tier: 'read',
    }
  ),
  applyExport: channel(ExportActionSchema, MessageSchema, {
    describe:
      "Changes Export.lua: adds, removes or deduplicates one tool's lines, or restores the kept version. Call dcs-setup:previewExport first and show the user. DCS must be closed.",
    tier: 'change',
  }),
  /** Takes Export.lua as it is now as the version to keep. */
  acceptExport: channel(noInput, MessageSchema, {
    describe:
      "Takes Export.lua as it is now as the version RigReady keeps and compares with, so changes made outside RigReady stop being reported. Only RigReady's own record changes.",
    tier: 'change',
  }),
  simAppPro: channel(noInput, SimAppProStateSchema, {
    describe:
      'The state of SimAppPro (WinWing): installed, version, running, whether its MFD plan exists, each setup with the WinWing features it needs, and the DCS files SimAppPro manages. Changes nothing.',
    tier: 'read',
  }),
  setRuntimeFeatures: channel(
    z.object({ profileId: z.string(), features: z.array(RuntimeFeatureSchema) }),
    MessageSchema,
    {
      describe:
        'Sets which WinWing features (backlight, displays, vibration) a setup needs SimAppPro running for, adding or taking out that checklist item. profileId comes from the profiles in dcs-setup:simAppPro.',
      tier: 'change',
    }
  ),
  /** Puts back RigReady.lua, the options.lua keys and the Export.lua tools RigReady last set. */
  restoreManaged: channel(noInput, MessageSchema, {
    describe:
      'Puts back RigReady.lua, the options.lua keys and the Export.lua tools RigReady last set, after something else changed them. Call dcs-setup:restoreManagedPreview first and show the user. DCS must be closed.',
    tier: 'change',
  }),
  /** Which files that restore would change and how. Reads only. */
  restoreManagedPreview: channel(noInput, ChangePreviewSchema, {
    describe:
      'Shows which files dcs-setup:restoreManaged would change and how. Nothing is changed.',
    tier: 'read',
  }),
  /** Remembers the installed DCS version as one that works. */
  markVerified: channel(noInput, MessageSchema, {
    describe:
      "Remembers the installed DCS version as one that works, so a later update is noticed. Only RigReady's own record changes.",
    tier: 'change',
  }),
});
