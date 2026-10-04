import { z } from 'zod';

/**
 * "This is what will change", as it crosses IPC: what a user-triggered write outside
 * RigReady's folder will do to each file, shown before anything is written. Main builds it
 * with `changePreview()` (src/core/files/preview.ts) from the same plan it then applies;
 * the renderer shows it with `ChangePreview.vue` / `ConfirmChanges.vue`
 * (src/renderer/components).
 */
export const ChangeKindSchema = z.enum(['created', 'modified', 'unchanged', 'renamed', 'deleted']);
export type ChangeKind = z.infer<typeof ChangeKindSchema>;

export const ChangePreviewFileSchema = z.object({
  /** Absolute path of the file as it will be afterwards. */
  path: z.string(),
  /** What to call it in a list: "Bindings (controls.cfg)", or the file name. */
  label: z.string(),
  change: ChangeKindSchema,
  /** One line on how: "3 lines added, 1 removed", "30 KB to 31 KB", "New file (2 KB)". */
  detail: z.string(),
});
export type ChangePreviewFile = z.infer<typeof ChangePreviewFileSchema>;

export const ChangePreviewSchema = z.object({
  /** "2 files modified, 1 file created" */
  summary: z.string(),
  files: z.array(ChangePreviewFileSchema),
});
export type ChangePreview = z.infer<typeof ChangePreviewSchema>;
