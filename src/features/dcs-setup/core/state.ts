import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { FileStore } from '../../../core/ports';
import { ExportToolSchema } from './exportLua';
import { ScreenSetupSchema } from './screens';

/**
 * What RigReady remembers about the DCS files it manages, in
 * <data root>/dcs-setup/state.json: the screen setup the user made, and the exact text it
 * last wrote (or the user accepted) for each file, so a change made by another program
 * (SimAppPro, an installer, a hand edit) can be noticed and undone.
 */

const ManagedTextSchema = z.object({
  path: z.string(),
  text: z.string(),
  at: z.string(),
});
export type ManagedText = z.infer<typeof ManagedTextSchema>;

export const ManagedOptionsSchema = z.object({
  path: z.string(),
  multiMonitorSetup: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  at: z.string(),
});
export type ManagedOptions = z.infer<typeof ManagedOptionsSchema>;

export const DcsSetupStateSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** The screen setup as last saved in the editor. */
  screens: ScreenSetupSchema.optional(),
  /** Saved Games\DCS\Config\MonitorSetup\RigReady.lua as RigReady last wrote it. */
  monitorSetup: ManagedTextSchema.optional(),
  /** Export.lua as RigReady last wrote it or the user last accepted it. */
  exportLua: ManagedTextSchema.optional(),
  /** The tools Export.lua is expected to load (kept when RigReady last wrote it). */
  exportTools: z.array(ExportToolSchema).default([]),
  /** The options.lua keys RigReady last set. */
  options: ManagedOptionsSchema.optional(),
  /** The DCS version the user last confirmed works. */
  verified: z.object({ version: z.string(), at: z.string() }).optional(),
});
export type DcsSetupState = z.infer<typeof DcsSetupStateSchema>;

export function createStateStore(files: FileStore, dataRoot: string) {
  return new JsonStore(files, path.join(dataRoot, 'dcs-setup', 'state.json'), DcsSetupStateSchema);
}
export type StateStore = ReturnType<typeof createStateStore>;
