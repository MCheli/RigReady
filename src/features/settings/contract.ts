import { z } from 'zod';
import { NamedLayoutSchema } from '../../core/displays/layouts';
import { AppSettingsPatchSchema, AppSettingsSchema } from '../../core/settings';
import { channel, defineContract, noInput } from '../../shared/ipc';

/** Everything the Settings page shows. */
export const SettingsViewSchema = z.object({
  settings: AppSettingsSchema,
  /** Saved monitor layouts, for choosing the desk layout. */
  layouts: z.array(NamedLayoutSchema),
  /** What Windows says about the login item; null when it cannot be read in this run. */
  startsWithWindows: z.boolean().nullable(),
  /** Why Start with Windows cannot be changed here, when it cannot. */
  startWithWindowsProblem: z.string().optional(),
});
export type SettingsView = z.infer<typeof SettingsViewSchema>;

export const settingsContract = defineContract('settings', {
  get: channel(noInput, SettingsViewSchema),
  update: channel(AppSettingsPatchSchema, SettingsViewSchema),
  /** Saves the monitors as they are right now as a named layout. */
  saveCurrentLayout: channel(z.object({ name: z.string() }), SettingsViewSchema),
  renameLayout: channel(z.object({ id: z.string(), name: z.string() }), SettingsViewSchema),
  /** Deletes a layout; if it was the desk layout, Stand down no longer changes the monitors. */
  removeLayout: channel(z.object({ id: z.string() }), SettingsViewSchema),
  /** Stores the Anthropic API key encrypted for this Windows user. The key is never sent back. */
  setAiKey: channel(z.object({ key: z.string().trim().min(8).max(400) }), SettingsViewSchema),
  clearAiKey: channel(noInput, SettingsViewSchema),
});
