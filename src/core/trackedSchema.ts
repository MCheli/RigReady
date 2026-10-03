import { z } from 'zod';

/**
 * A file or folder RigReady backs up for the user ("tracked item"). Paths are stored
 * with path variables so they mean the right place on any PC. Kept per profile in
 * profile.extensions.backup and globally by the backup feature; the sharing feature
 * reads a profile's items to offer its config files.
 */
export const TrackedItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  label: z.string().trim().min(1).max(80),
  /** "{DCS_USER}/Config/Input"; absolute when no variable covers it. */
  path: z.string().min(1).max(1024),
  kind: z.enum(['file', 'folder']),
  include: z.array(z.string().min(1).max(200)).max(50).default([]),
  exclude: z.array(z.string().min(1).max(200)).max(50).default([]),
  game: z.string().optional(),
});
export type TrackedItem = z.infer<typeof TrackedItemSchema>;

/** profile.extensions[BACKUP_EXTENSION] */
export const BACKUP_EXTENSION = 'backup';
export const BackupExtensionSchema = z.object({ items: z.array(TrackedItemSchema).default([]) });
