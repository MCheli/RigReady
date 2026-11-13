import path from 'node:path';
import { z } from 'zod';
import type {
  CheckDefinition,
  ParamPicker,
  PickerChoice,
  RemediationDefinition,
} from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import { inControlProfiles, locateIracingControls } from '../../../core/iracingControls';
import type { ProfileStore } from '../../../core/profile/store';
import { err, ok, type Result } from '../../../core/result';
import type { Clock } from '../../../core/ports';
import { isToolBackup, type BackupGame, type BindingBackup } from '../contract';
import { backupsRoot, listBackups, restoreBackup } from './backups';
import { locationOf, RACING_GAMES, type RacingContext, type RacingGameId } from './context';

/**
 * A setup that expects one particular set of bindings: the way to keep a variant of a
 * racing setup per steering wheel (rim). "iRacing GT3" and its copy "iRacing GT3 -
 * Formula rim" each name a binding backup; the check says whether the game's binding
 * files are that set now, and its fix puts the set back (through the journal, refused
 * while the game runs).
 *
 * Only the binding files are compared and restored. A backup also holds the game's
 * options (iRacing's app.ini, Le Mans Ultimate's Settings.JSON); those change with normal
 * play and are left alone here.
 */

export const BINDING_SET = 'racing.bindingSet';
export const RESTORE_BINDING_SET = 'racing.restoreBindingSet';

const GAME_IDS = RACING_GAMES.map((g) => g.id) as [RacingGameId, ...RacingGameId[]];

export const BindingSetParamsSchema = z.object({
  game: z.enum(GAME_IDS),
  /** Id of the racing backup that holds the set. */
  backupId: z.string().regex(/^[\w-]+$/),
  /** What the owner calls the set ("Formula rim"); shown, never matched on. */
  name: z.string().max(80).default(''),
});
export type BindingSetParams = z.infer<typeof BindingSetParamsSchema>;

const BINDING_FILE_NAMES: Record<RacingGameId, string[] | 'all'> = {
  iracing: ['controls.cfg', 'joycalib.yaml'],
  lmu: ['direct input.json', 'current controls.json'],
  beamng: 'all',
  'assetto-corsa': ['controls.ini'],
};

/** True for the files of a backup that hold bindings and calibration, not game options. */
export function isBindingFile(
  game: BackupGame,
  file: { path: string; restorable: boolean }
): boolean {
  if (!file.restorable || isToolBackup(game)) return false;
  const names = BINDING_FILE_NAMES[game];
  return names === 'all' || names.includes(path.basename(file.path).toLowerCase());
}

const gameName = (game: RacingGameId): string => RACING_GAMES.find((g) => g.id === game)!.name;

/** "Formula rim", or the date of the backup when it has no name. */
export function setLabel(backup: Pick<BindingBackup, 'name' | 'createdAt'>, fallback = ''): string {
  if (backup.name?.trim()) return backup.name.trim();
  if (fallback.trim()) return fallback.trim();
  return `backup of ${savedOn(backup)}`;
}

export interface SetComparison {
  backup?: BindingBackup;
  /** Binding files of the set, by file name. */
  files: string[];
  /** Those that differ from the set now, or are missing. */
  different: string[];
  /**
   * Binding files of the set that the game no longer reads: an iRacing backup made before
   * iRacing kept control profiles holds the older controls.cfg. Not compared, not restored.
   */
  notRead: string[];
}

/**
 * The binding files of a backup that the game no longer reads, by path. Only iRacing has
 * them: once it keeps control profiles, a file outside profiles\controls is not its bindings.
 */
async function notReadByGame(
  ctx: RacingContext,
  game: RacingGameId,
  backup: BindingBackup
): Promise<Set<string>> {
  if (game !== 'iracing') return new Set();
  const folder = await locationOf(ctx, 'iracing', 'documents');
  if (!folder) return new Set();
  const located = await locateIracingControls(ctx.ports.files, folder);
  if (located.kind !== 'profiles') return new Set();
  return new Set(
    backup.files
      .filter((f) => isBindingFile(game, f) && !inControlProfiles(folder, f.path))
      .map((f) => f.path)
  );
}

/** True for a file of a backup that holds bindings the game still reads. */
export async function bindingFilter(
  ctx: RacingContext,
  game: RacingGameId,
  backup: BindingBackup
): Promise<(file: { path: string; restorable: boolean }) => boolean> {
  const notRead = await notReadByGame(ctx, game, backup);
  return (file) => isBindingFile(game, file) && !notRead.has(file.path);
}

/** How the game's binding files compare with a backup now. Reads only. */
export async function compareWithSet(
  ctx: RacingContext,
  game: RacingGameId,
  backupId: string
): Promise<SetComparison> {
  const backup = (await listBackups(ctx, game)).find((b) => b.id === backupId);
  if (!backup) return { files: [], different: [], notRead: [] };
  const dir = path.join(backupsRoot(ctx, game), backup.id);
  const files: string[] = [];
  const different: string[] = [];
  const notRead: string[] = [];
  const skipped = await notReadByGame(ctx, game, backup);
  for (const file of backup.files.filter((f) => isBindingFile(game, f))) {
    const name = path.basename(file.path);
    if (skipped.has(file.path)) {
      notRead.push(name);
      continue;
    }
    files.push(name);
    const stored = await ctx.ports.files.readBytes(path.join(dir, file.stored));
    const current = (await ctx.ports.files.exists(file.path))
      ? await ctx.ports.files.readBytes(file.path)
      : undefined;
    const same =
      stored.ok &&
      current?.ok === true &&
      Buffer.compare(Buffer.from(stored.value), Buffer.from(current.value)) === 0;
    if (!same) different.push(name);
  }
  return { backup, files, different, notRead };
}

/** Why a set whose files the game no longer reads cannot be its bindings. */
const notReadText = (label: string): string =>
  `"${label}" was saved before iRacing kept its bindings in control profiles, so it holds files iRacing no longer reads. Back up the bindings again on Configure › Games › Racing › iRacing and use that backup.`;

const savedOn = (backup: Pick<BindingBackup, 'createdAt'>): string =>
  new Date(backup.createdAt).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * The saved bindings of every racing game, by name, for the setup editor: a setup stores
 * the id of a backup (a timestamp), which nobody can type. Choosing one fills in the id,
 * its name and the game it belongs to. Only backups that hold binding files are listed.
 * The id is the moment of the backup, so two games can have a backup with the same id:
 * both are listed, and the game each one fills in is what tells them apart.
 */
export function bindingSetPicker(games: GameRegistry): ParamPicker {
  return {
    list: 'racing.bindingSets',
    param: 'backupId',
    label: 'Saved bindings',
    fills: ['name', 'game'],
    empty:
      'You have no saved bindings yet. Back them up on Configure > Games > Racing, then choose them here.',
    async choices(ctx) {
      const rctx = { ...ctx, games };
      const out: PickerChoice[] = [];
      for (const game of RACING_GAMES) {
        for (const backup of await listBackups(rctx, game.id)) {
          if (!backup.files.some((f) => isBindingFile(game.id, f))) continue;
          const label = setLabel(backup);
          out.push({
            value: backup.id,
            label,
            // A named set says when it was saved; an unnamed one is already called by its date.
            detail: backup.name?.trim() ? game.name + ', saved ' + savedOn(backup) : game.name,
            fill: { name: label, game: game.id },
          });
        }
      }
      return ok(out);
    },
  };
}

export function bindingSetCheck(games: GameRegistry): CheckDefinition<BindingSetParams> {
  return {
    type: BINDING_SET,
    group: 'files',
    label: 'Racing bindings are the saved set',
    params: BindingSetParamsSchema,
    fixes: [RESTORE_BINDING_SET],
    picker: bindingSetPicker(games),
    async run(params, ctx) {
      const compared = await compareWithSet({ ...ctx, games }, params.game, params.backupId);
      if (!compared.backup) {
        return {
          pass: false,
          summary: `The saved bindings "${params.name || params.backupId}" no longer exist`,
          details: [
            `Open Configure › Racing › ${gameName(params.game)}, back up the bindings this setup should use and choose "Use in a setup".`,
          ],
        };
      }
      const label = setLabel(compared.backup, params.name);
      if (compared.files.length === 0 && compared.notRead.length > 0) {
        return {
          pass: false,
          summary: `"${label}" holds iRacing bindings from before control profiles`,
          details: [notReadText(label)],
        };
      }
      if (compared.files.length === 0) {
        return { pass: false, summary: `"${label}" holds no binding files` };
      }
      if (compared.different.length === 0) {
        return {
          pass: true,
          summary: `${gameName(params.game)} has the bindings saved as "${label}"`,
        };
      }
      const n = compared.different.length;
      return {
        pass: false,
        summary: `${gameName(params.game)} has other bindings than "${label}": ${n} of ${compared.files.length} ${compared.files.length === 1 ? 'file' : 'files'} differ`,
        details: compared.different.map((name) => `${name} is not the one saved in "${label}".`),
      };
    },
  };
}

export function restoreBindingSetFix(games: GameRegistry): RemediationDefinition<BindingSetParams> {
  return {
    type: RESTORE_BINDING_SET,
    label: 'Restore the saved racing bindings',
    order: 300,
    params: BindingSetParamsSchema,
    picker: bindingSetPicker(games),
    describe: (params) => `Restore the bindings saved as "${params.name || params.backupId}"`,
    async run(params, ctx) {
      const rctx = { ...ctx, games };
      const before = await compareWithSet(rctx, params.game, params.backupId);
      if (!before.backup) {
        return err('racing.backup', `The saved bindings "${params.name}" no longer exist.`);
      }
      const label = setLabel(before.backup, params.name);
      // Never put back a file the game no longer reads and call that its bindings.
      if (before.files.length === 0 && before.notRead.length > 0) {
        return err('racing.backup', notReadText(label));
      }
      const only = await bindingFilter(rctx, params.game, before.backup);
      const restored = await restoreBackup(rctx, params.game, params.backupId, {
        only,
        what: `"${label}"`,
      });
      if (!restored.ok) return restored;
      // Read back: success only when the game's files really are the set now.
      const after = await compareWithSet(rctx, params.game, params.backupId);
      if (after.different.length > 0) {
        return err(
          'racing.backup',
          `${after.different.join(', ')} did not keep the bindings saved as "${label}".`
        );
      }
      const n = after.files.length;
      return ok(
        `Restored the ${gameName(params.game)} bindings saved as "${label}" (${n} ${n === 1 ? 'file' : 'files'}); the ones that were there are backed up`
      );
    },
  };
}

export interface SetupUse {
  id: string;
  name: string;
  /** The backup this setup expects, when it expects one. */
  backupId?: string;
}

interface Deps {
  profiles: ProfileStore;
  clock: Clock;
}

/** The setups for a game, with the binding set each expects. */
export async function setupsFor(deps: Deps, game: RacingGameId): Promise<Result<SetupUse[]>> {
  const profiles = await deps.profiles.list();
  if (!profiles.ok) return profiles;
  return ok(
    profiles.value
      .filter((p) => p.game === game)
      .map((p) => {
        const item = p.checks.find((c) => c.type === BINDING_SET && c.params['game'] === game);
        const backupId = item?.params['backupId'];
        return {
          id: p.id,
          name: p.name,
          ...(typeof backupId === 'string' ? { backupId } : {}),
        };
      })
  );
}

/**
 * Makes a setup expect the bindings of a backup: one checklist item with its fix,
 * replacing the one it had for this game.
 */
export async function useSetInSetup(
  ctx: RacingContext,
  deps: Deps,
  game: BackupGame,
  backupId: string,
  profileId: string
): Promise<Result<{ message: string }>> {
  if (isToolBackup(game)) {
    return err('racing.backup', 'Wheel software settings are not bindings of a game.');
  }
  const backup = (await listBackups(ctx, game)).find((b) => b.id === backupId);
  if (!backup) return err('racing.backup', 'That backup no longer exists.');
  if (!backup.files.some((f) => isBindingFile(game, f))) {
    return err('racing.backup', 'That backup holds no binding files.');
  }
  const profile = await deps.profiles.get(profileId);
  if (!profile.ok) return profile;
  if (profile.value.game !== game) {
    return err(
      'racing.setup',
      `"${profile.value.name}" is a setup for another game, so these ${gameName(game)} bindings do not belong to it.`
    );
  }
  const label = setLabel(backup);
  const params: BindingSetParams = { game, backupId, name: label };
  const others = profile.value.checks.filter(
    (c) => !(c.type === BINDING_SET && c.params['game'] === game)
  );
  let id = `racing-bindings-${game}`;
  for (let n = 2; others.some((c) => c.id === id); n++) id = `racing-bindings-${game}-${n}`;
  const saved = await deps.profiles.save({
    ...profile.value,
    updatedAt: deps.clock.now().toISOString(),
    checks: [
      ...others,
      {
        id,
        type: BINDING_SET,
        title: `${gameName(game)} bindings: ${label}`,
        required: true,
        params,
        remediation: { type: RESTORE_BINDING_SET, params },
      },
    ],
  });
  if (!saved.ok) return saved;
  return ok({
    message: `"${profile.value.name}" now expects the bindings saved as "${label}", and Make ready restores them.`,
  });
}

/** Takes the binding set item out of a setup again. */
export async function stopUsingSet(
  deps: Deps,
  game: BackupGame,
  profileId: string
): Promise<Result<{ message: string }>> {
  const profile = await deps.profiles.get(profileId);
  if (!profile.ok) return profile;
  const others = profile.value.checks.filter(
    (c) => !(c.type === BINDING_SET && c.params['game'] === game)
  );
  if (others.length === profile.value.checks.length) {
    return ok({ message: `"${profile.value.name}" did not expect particular bindings.` });
  }
  const saved = await deps.profiles.save({
    ...profile.value,
    updatedAt: deps.clock.now().toISOString(),
    checks: others,
  });
  if (!saved.ok) return saved;
  return ok({ message: `"${profile.value.name}" no longer expects particular bindings.` });
}
