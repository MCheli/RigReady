import path from 'node:path';
import type { MainContext } from '../../../core/feature';
import type { JournalEntry } from '../../../core/ports';
import { ok, type Result } from '../../../core/result';
import type { SafetyView } from '../contract';

type Ctx = Pick<MainContext, 'ports' | 'settings' | 'log'>;

function kindOf(entry: JournalEntry): 'created' | 'changed' | 'deleted' {
  if (entry.action === 'remove') return 'deleted';
  return entry.backupPath === null ? 'created' : 'changed';
}

export async function readSafety(ctx: Ctx): Promise<Result<SafetyView>> {
  const groups = await ctx.ports.files.journalGroups();
  if (!groups.ok) return groups;
  const bytes = await ctx.ports.files.backupBytes();
  if (!bytes.ok) return bytes;
  const settings = await ctx.settings.get();
  if (!settings.ok) return settings;
  return ok({
    groups: groups.value.map((group) => ({
      id: group.id,
      time: group.time,
      reason: group.reason,
      undone: group.undone,
      isUndo: group.entries.every((e) => e.undoOf !== undefined),
      changes: group.entries.map((e) => ({
        id: e.id,
        path: e.path,
        kind: kindOf(e),
        undone: e.undone,
      })),
    })),
    backupBytes: bytes.value,
    retention: settings.value.retention,
    backupFolder: path.join(ctx.ports.folders.dataRoot(), 'backups', 'auto'),
  });
}

export async function undoGroup(
  ctx: Ctx,
  groupId: string,
  force: boolean
): Promise<Result<SafetyView>> {
  const undone = await ctx.ports.files.undoGroup(groupId, { force });
  if (!undone.ok) return undone;
  ctx.log.info(`undid "${undone.value.reason}"`, {
    files: undone.value.entries.map((e) => e.path),
  });
  return readSafety(ctx);
}
