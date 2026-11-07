import path from 'node:path';
import type { MainContext } from '../../../core/feature';
import type { JournalEntry } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { runningHolders, runningText } from '../../../core/runningPrograms';
import type { SafetyView } from '../contract';

type Ctx = Pick<MainContext, 'ports' | 'settings' | 'log' | 'games' | 'backupSources'>;

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

/**
 * Puts the files of one action back. Not while a game or tool that holds them is running:
 * it would write them again on exit, as it would after a restore, so the same detection
 * refuses with the same words, and `force` (for a file changed since) is no way past it.
 */
export async function undoGroup(
  ctx: Ctx,
  groupId: string,
  force: boolean
): Promise<Result<SafetyView>> {
  const groups = await ctx.ports.files.journalGroups();
  if (!groups.ok) return groups;
  const group = groups.value.find((g) => g.id === groupId);
  const holding = await runningHolders(
    ctx,
    (group?.entries ?? [])
      .filter((e) => !e.undone)
      .map((e) => ({ label: path.basename(e.path), target: e.path }))
  );
  if (!holding.ok) return holding;
  if (holding.value.length > 0) {
    return err(
      'restore.running',
      `${runningText(holding.value)} Close ${holding.value.length === 1 ? 'it' : 'them'} first. Nothing was undone.`
    );
  }
  const undone = await ctx.ports.files.undoGroup(groupId, { force });
  if (!undone.ok) return undone;
  ctx.log.info(`undid "${undone.value.reason}"`, {
    files: undone.value.entries.map((e) => e.path),
  });
  return readSafety(ctx);
}
