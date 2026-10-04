import path from 'node:path';
import { z } from 'zod';
import type { BackupSource } from '../../../core/backupSources';
import type { CheckContext } from '../../../core/checks/registry';
import { previewWrites, type PlannedWrite } from '../../../core/files/preview';
import { err, ok, type Result } from '../../../core/result';
import type { RegistryHive } from '../../../shared/models';
import type { BackupGame, BindingBackup, WritePreviewView } from '../contract';
import { BindingBackupSchema } from '../contract';
import { locationOf, refuseWhileRunning, type RacingContext } from './context';

/**
 * Quick backups of a racing game's bindings (and the Fanatec App's settings), kept under
 * <data root>/racing/backups/<game>/<id>/. Restoring writes through FileStore, so every
 * file is backed up again first and the restore can be undone on the Safety page.
 */

interface Source {
  path: string;
  label: string;
  restorable: boolean;
}

async function existing(ctx: RacingContext, sources: Source[]): Promise<Source[]> {
  const out: Source[] = [];
  for (const s of sources) if (await ctx.ports.files.exists(s.path)) out.push(s);
  return out;
}

export const fanatecPrefs = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.appData(), 'com.example', 'Fanatec', 'shared_preferences.json');

async function sources(ctx: RacingContext, game: BackupGame): Promise<Source[]> {
  switch (game) {
    case 'iracing': {
      const dir = await locationOf(ctx, 'iracing', 'documents');
      if (!dir) return [];
      const list: Source[] = [
        {
          path: path.join(dir, 'controls.cfg'),
          label: 'Bindings (controls.cfg)',
          restorable: true,
        },
        {
          path: path.join(dir, 'joyCalib.yaml'),
          label: 'Calibration (joyCalib.yaml)',
          restorable: true,
        },
        {
          path: path.join(dir, 'app.ini'),
          label: 'Options and force feedback (app.ini)',
          restorable: true,
        },
      ];
      const cars = await ctx.ports.files.list(path.join(dir, 'setups'));
      for (const car of cars.ok ? cars.value : []) {
        for (const file of ['controls.cfg', 'joyCalib.yaml']) {
          list.push({
            path: path.join(dir, 'setups', car, file),
            label: `${car}: ${file}`,
            restorable: true,
          });
        }
      }
      return existing(ctx, list);
    }
    case 'lmu': {
      const dir = await locationOf(ctx, 'lmu', 'player');
      if (!dir) return [];
      return existing(ctx, [
        {
          path: path.join(dir, 'direct input.json'),
          label: 'Bindings and force feedback',
          restorable: true,
        },
        {
          path: path.join(dir, 'current controls.json'),
          label: 'Control options',
          restorable: true,
        },
        { path: path.join(dir, 'Settings.JSON'), label: 'Game settings', restorable: true },
      ]);
    }
    case 'beamng': {
      const user = await locationOf(ctx, 'beamng', 'user');
      if (!user) return [];
      const dir = path.join(user, 'settings', 'inputmaps');
      const tree = await ctx.ports.files.listTree(dir, { include: ['*.diff'], maxEntries: 2000 });
      return (tree.ok ? tree.value : []).map((e) => ({
        path: e.path,
        label: `Bindings: ${e.relativePath}`,
        restorable: true,
      }));
    }
    case 'assetto-corsa': {
      const dir = await locationOf(ctx, 'assetto-corsa', 'cfg');
      if (!dir) return [];
      return existing(ctx, [
        {
          path: path.join(dir, 'controls.ini'),
          label: 'Bindings and force feedback',
          restorable: true,
        },
      ]);
    }
    case 'fanatec':
      return existing(ctx, [
        { path: fanatecPrefs(ctx), label: 'Fanatec App settings', restorable: true },
      ]);
  }
}

const backupsRoot = (ctx: RacingContext, game: BackupGame): string =>
  path.join(ctx.ports.folders.dataRoot(), 'racing', 'backups', game);

const FANATEC_SERVICE_KEY = 'Software\\Endor\\FanatecService';

/**
 * What the backup page offers for Fanatec: the Fanatec App's settings file, and the
 * driver's registry settings as a record in every full backup. The record can be read
 * back; nothing writes it to the registry (the registry port is read-only).
 */
export const fanatecBackupSource: BackupSource = {
  id: 'fanatec',
  label: 'Fanatec',
  async suggest(ctx) {
    return ok([
      {
        label: 'Fanatec App settings',
        path: fanatecPrefs(ctx),
        kind: 'file' as const,
        description: "The Fanatec App's own preferences (shared_preferences.json).",
      },
    ]);
  },
  program: {
    name: 'Fanatec App',
    processes: ['Fanatec.exe'],
    why: 'The Fanatec App writes its settings when it closes, which would undo the restore.',
    restart: true,
  },
  async records(ctx) {
    const values = await ctx.ports.registry.listValues('HKCU', FANATEC_SERVICE_KEY);
    const keys = await ctx.ports.registry.listKeys('HKCU', FANATEC_SERVICE_KEY);
    const empty =
      Object.keys(values.ok ? values.value : {}).length === 0 &&
      (keys.ok ? keys.value : []).length === 0;
    if (empty) return ok([]);
    return ok([
      {
        id: 'service',
        label: 'Fanatec driver settings (registry)',
        from: `HKEY_CURRENT_USER\\${FANATEC_SERVICE_KEY}`,
        data: await exportRegistry(ctx, 'HKCU', FANATEC_SERVICE_KEY),
      },
    ]);
  },
};

/** Every value below a registry key, as data (the registry port is read-only: shown, never restored). */
async function exportRegistry(
  ctx: CheckContext,
  hive: RegistryHive,
  key: string
): Promise<Record<string, unknown>> {
  const values = await ctx.ports.registry.listValues(hive, key);
  const out: Record<string, unknown> = { values: values.ok ? values.value : {} };
  const keys = await ctx.ports.registry.listKeys(hive, key);
  const children: Record<string, unknown> = {};
  for (const child of keys.ok ? keys.value : []) {
    children[child] = await exportRegistry(ctx, hive, `${key}\\${child}`);
  }
  if (Object.keys(children).length > 0) out['keys'] = children;
  return out;
}

export async function listBackups(ctx: RacingContext, game: BackupGame): Promise<BindingBackup[]> {
  const root = backupsRoot(ctx, game);
  const names = await ctx.ports.files.list(root);
  const out: BindingBackup[] = [];
  for (const name of names.ok ? names.value : []) {
    const manifest = path.join(root, name, 'manifest.json');
    if (!(await ctx.ports.files.exists(manifest))) continue;
    const text = await ctx.ports.files.readText(manifest);
    if (!text.ok) continue;
    try {
      const parsed = BindingBackupSchema.safeParse(JSON.parse(text.value));
      if (parsed.success) out.push(parsed.data);
    } catch {
      // A damaged manifest is skipped, not fatal.
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function backupNow(
  ctx: RacingContext,
  game: BackupGame
): Promise<Result<BindingBackup>> {
  const files = await sources(ctx, game);
  if (files.length === 0 && game !== 'fanatec') {
    return err('racing.backup', 'There are no binding files to back up yet.');
  }
  const now = ctx.ports.clock.now();
  let id = now.toISOString().replace(/[:.]/g, '-');
  const existingIds = new Set((await listBackups(ctx, game)).map((b) => b.id));
  for (let n = 2; existingIds.has(id); n++) id = `${now.toISOString().replace(/[:.]/g, '-')}-${n}`;
  const dir = path.join(backupsRoot(ctx, game), id);
  const stored: BindingBackup['files'] = [];
  for (const [index, file] of files.entries()) {
    const bytes = await ctx.ports.files.readBytes(file.path);
    if (!bytes.ok) return bytes;
    const name = `${String(index + 1).padStart(3, '0')}-${path.basename(file.path)}`;
    const written = await ctx.ports.files.write(path.join(dir, name), bytes.value, {
      reason: 'RigReady backup',
    });
    if (!written.ok) return written;
    stored.push({
      path: file.path,
      stored: name,
      label: file.label,
      restorable: file.restorable,
      size: bytes.value.length,
    });
  }
  if (game === 'fanatec') {
    const registry = await exportRegistry(ctx, 'HKCU', FANATEC_SERVICE_KEY);
    const text = JSON.stringify(registry, null, 2) + '\n';
    const name = `${String(stored.length + 1).padStart(3, '0')}-FanatecService-registry.json`;
    const written = await ctx.ports.files.write(path.join(dir, name), text, {
      reason: 'RigReady backup',
    });
    if (!written.ok) return written;
    stored.push({
      path: 'HKEY_CURRENT_USER\\Software\\Endor\\FanatecService',
      stored: name,
      label: 'Fanatec Service settings (registry, kept as a record)',
      restorable: false,
      size: text.length,
    });
  }
  const backup: BindingBackup = { id, game, createdAt: now.toISOString(), files: stored };
  const manifest = await ctx.ports.files.write(
    path.join(dir, 'manifest.json'),
    JSON.stringify(backup, null, 2) + '\n',
    {
      reason: 'RigReady backup',
    }
  );
  if (!manifest.ok) return manifest;
  return ok(backup);
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const GAME_NAMES: Record<BackupGame, string> = {
  iracing: 'iRacing',
  lmu: 'Le Mans Ultimate',
  beamng: 'BeamNG.drive',
  'assetto-corsa': 'Assetto Corsa',
  fanatec: 'Fanatec App',
};

export const RestoreOptionsSchema = z.object({ closeApp: z.boolean().default(false) });

/** What restoring a backup would do to each file on disk now. Nothing is written. */
export async function previewRestoreBackup(
  ctx: RacingContext,
  game: BackupGame,
  id: string
): Promise<Result<WritePreviewView>> {
  const backup = (await listBackups(ctx, game)).find((b) => b.id === id);
  if (!backup) return err('racing.backup', 'That backup no longer exists.');
  const dir = path.join(backupsRoot(ctx, game), id);
  const restorable = backup.files.filter((f) => f.restorable);
  const planned: PlannedWrite[] = [];
  for (const file of restorable) {
    const bytes = await ctx.ports.files.readBytes(path.join(dir, file.stored));
    if (!bytes.ok) return bytes;
    planned.push({ path: file.path, content: bytes.value });
  }
  const preview = await previewWrites(ctx.ports.files, planned);
  if (!preview.ok) return preview;
  return ok({
    summary: preview.value.summary,
    files: preview.value.entries.map((entry, index) => ({
      path: entry.path,
      label: restorable[index]!.label,
      change: entry.change,
      detail: entry.summary,
    })),
  });
}

/**
 * Puts the files of a backup back. Refused while the game that owns them runs; for the
 * Fanatec App, `closeApp` closes it first and starts it again afterwards.
 */
export async function restoreBackup(
  ctx: RacingContext,
  game: BackupGame,
  id: string,
  options: { closeApp?: boolean } = {}
): Promise<Result<{ message: string }>> {
  const backup = (await listBackups(ctx, game)).find((b) => b.id === id);
  if (!backup) return err('racing.backup', 'That backup no longer exists.');
  let reopen: string | undefined;
  if (game === 'fanatec') {
    const list = await ctx.ports.processes.list();
    const app = list.ok
      ? list.value.find((p) => p.name.toLowerCase() === 'fanatec.exe')
      : undefined;
    if (app) {
      if (!options.closeApp) {
        return err(
          'racing.appOpen',
          'The Fanatec App is open. It must be closed while its settings are restored.'
        );
      }
      const closed = await ctx.ports.processes.close(app.pid, { waitMs: 10_000 });
      if (!closed.ok) return closed;
      reopen =
        app.path ??
        path.join(ctx.ports.folders.programFiles(), 'Fanatec', 'FanatecUI', 'UI', 'Fanatec.exe');
    }
  } else {
    const blocked = await refuseWhileRunning(ctx, game);
    if (!blocked.ok) return blocked;
  }
  const dir = path.join(backupsRoot(ctx, game), id);
  const group = ctx.ports.files.beginGroup(
    `Restore ${GAME_NAMES[game]} ${game === 'fanatec' ? 'settings' : 'bindings'} from ${when(backup.createdAt)}`
  );
  let restored = 0;
  for (const file of backup.files.filter((f) => f.restorable)) {
    const bytes = await ctx.ports.files.readBytes(path.join(dir, file.stored));
    if (!bytes.ok) return bytes;
    const written = await ctx.ports.files.write(file.path, bytes.value, {
      reason: `Restore ${file.label}`,
      group,
    });
    if (!written.ok) return written;
    const back = await ctx.ports.files.readBytes(file.path);
    if (!back.ok || Buffer.compare(Buffer.from(back.value), Buffer.from(bytes.value)) !== 0) {
      return err('racing.backup', `${path.basename(file.path)} did not keep the restored content.`);
    }
    restored++;
  }
  let message = `Restored ${restored} ${restored === 1 ? 'file' : 'files'} from ${when(backup.createdAt)}. Undo is on the Safety page.`;
  if (reopen) {
    const started = await ctx.ports.processes.start({ exe: reopen, args: [] });
    message += started.ok
      ? ' The Fanatec App was started again.'
      : ' Start the Fanatec App again yourself.';
  }
  return ok({ message });
}

export async function deleteBackup(
  ctx: RacingContext,
  game: BackupGame,
  id: string
): Promise<Result<void>> {
  const backup = (await listBackups(ctx, game)).find((b) => b.id === id);
  if (!backup) return err('racing.backup', 'That backup no longer exists.');
  const dir = path.join(backupsRoot(ctx, game), id);
  // The manifest first: once it is gone the backup is no longer listed.
  for (const name of ['manifest.json', ...backup.files.map((f) => f.stored)]) {
    const removed = await ctx.ports.files.remove(path.join(dir, name), {
      reason: 'Delete a RigReady backup',
    });
    if (!removed.ok) return removed;
  }
  return ok(undefined);
}
