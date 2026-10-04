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
  catalog: CatalogSchema,
  simAppProPlan: z.boolean(),
  dcsRunning: z.boolean(),
});
export type ScreensState = z.infer<typeof ScreensStateSchema>;

export const ApplyScreensSchema = z.object({
  setup: ScreenSetupSchema,
  /** Also set options.lua width/height/aspect to the window the setup needs. */
  setResolution: z.boolean().default(true),
  /** The user saw that RigReady.lua was edited outside RigReady and chose to replace it. */
  overwriteEdited: z.boolean().default(false),
});

export const ScreensPreviewSchema = z.object({
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
  overview: channel(noInput, OverviewSchema),
  /** The screen editor's starting point. */
  screens: channel(noInput, ScreensStateSchema),
  /** SimAppPro's MFD plan as a screen setup for one of the monitor layouts. */
  importSimAppPro: channel(
    z.object({ desktopId: z.string() }),
    z.object({ setup: ScreenSetupSchema, unmatched: z.array(z.string()), catalog: CatalogSchema })
  ),
  previewScreens: channel(ApplyScreensSchema, ScreensPreviewSchema),
  /** Writes RigReady.lua and selects it in options.lua, as one undoable change. */
  applyScreens: channel(ApplyScreensSchema, MessageSchema),
  exportLua: channel(noInput, ExportStateSchema),
  previewExport: channel(
    ExportActionSchema,
    z.object({ diff: z.array(LineDiffSchema), changed: z.boolean() })
  ),
  applyExport: channel(ExportActionSchema, MessageSchema),
  /** Takes Export.lua as it is now as the version to keep. */
  acceptExport: channel(noInput, MessageSchema),
  simAppPro: channel(noInput, SimAppProStateSchema),
  setRuntimeFeatures: channel(
    z.object({ profileId: z.string(), features: z.array(RuntimeFeatureSchema) }),
    MessageSchema
  ),
  /** Puts back RigReady.lua, the options.lua keys and the Export.lua tools RigReady last set. */
  restoreManaged: channel(noInput, MessageSchema),
  /** Which files that restore would change and how. Reads only. */
  restoreManagedPreview: channel(noInput, ChangePreviewSchema),
  /** Remembers the installed DCS version as one that works. */
  markVerified: channel(noInput, MessageSchema),
});
