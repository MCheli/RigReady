import path from 'node:path';
import { z } from 'zod';
import type {
  CaptureCandidate,
  CaptureDefinition,
  CheckContext,
  CheckDefinition,
} from '../../../core/checks/registry';
import type { GameInstall, GameRegistry, GameVersion } from '../../../core/games';
import { err, ok, type Result } from '../../../core/result';
import { listSteamApps } from '../../../core/steam';

export const GAME_UPDATED = 'game.updated';

export const GameUpdatedParamsSchema = z.object({
  /** Game module id, e.g. "dcs". */
  game: z.string().min(1),
  /** The version the user last confirmed works ("Mark verified"). */
  verifiedVersion: z.string().optional(),
});
export type GameUpdatedParams = z.infer<typeof GameUpdatedParamsSchema>;

/**
 * The installed version of a game: the module's own answer when it has one, otherwise
 * the Steam build of the install (its folder is matched to an app manifest).
 */
export async function installedVersion(
  ctx: CheckContext,
  games: GameRegistry,
  gameId: string
): Promise<Result<{ name: string; version: GameVersion }>> {
  const module = games.get(gameId);
  if (!module)
    return err('game.unknown', `This version of RigReady does not know the game "${gameId}".`);
  const installs = await module.detect(ctx);
  if (!installs.ok) return installs;
  const install: GameInstall | undefined = installs.value[0];
  if (!install) return err('game.notFound', `${module.name} was not found on this PC.`);
  if (module.installedVersion) {
    const version = await module.installedVersion(ctx, install);
    return version.ok ? ok({ name: module.name, version: version.value }) : version;
  }
  const apps = await listSteamApps(ctx.ports);
  if (!apps.ok) return apps;
  const app = apps.value.find(
    (a) =>
      path.resolve(a.installDir).toLowerCase() === path.resolve(install.installDir).toLowerCase()
  );
  if (!app) {
    return err(
      'game.version',
      `RigReady cannot tell which version of ${module.name} is installed.`
    );
  }
  return ok({
    name: module.name,
    version: { version: `build ${app.buildId}`, updatePending: app.updatePending },
  });
}

export function createGameUpdatedCheck(games: GameRegistry): CheckDefinition<GameUpdatedParams> {
  return {
    type: GAME_UPDATED,
    group: 'other',
    label: 'Game updated since you last verified',
    params: GameUpdatedParamsSchema,
    // A heads-up, never a reason the rig is not ready.
    advisory: true,
    fixes: ['instructions.show', 'script.run'],
    async run(params, ctx) {
      const found = await installedVersion(ctx, games, params.game);
      if (!found.ok) return { pass: false, error: true, summary: found.error.message };
      const { name, version } = found.value;
      const details = version.updatePending
        ? ['An update is waiting to be installed; the game may not start until it is.']
        : [];
      if (!params.verifiedVersion) {
        return {
          pass: false,
          summary: `${name} ${version.version} has not been verified yet`,
          details,
        };
      }
      if (params.verifiedVersion === version.version) {
        return { pass: true, summary: `${name} ${version.version}, verified`, details };
      }
      return {
        pass: false,
        summary: `${name} updated ${params.verifiedVersion} -> ${version.version} since you last verified`,
        details: [
          'Check your bindings and settings in the game, then mark it verified.',
          ...details,
        ],
      };
    },
    acknowledge: {
      label: 'Mark verified',
      async run(params, ctx) {
        const found = await installedVersion(ctx, games, params.game);
        if (!found.ok) return found;
        return ok({ ...params, verifiedVersion: found.value.version.version });
      },
    },
  };
}

/** Offers "updated since you last verified" for every detected game. */
export function createGameUpdatedCapture(games: GameRegistry): CaptureDefinition {
  return {
    id: 'game-updated',
    label: 'Game versions',
    async capture(ctx) {
      const candidates: CaptureCandidate[] = [];
      for (const module of games.all()) {
        const found = await installedVersion(ctx, games, module.id);
        if (!found.ok) continue;
        const title = `${module.name} not updated since verified`;
        candidates.push({
          key: `game:${module.id}`,
          group: 'other',
          title,
          description: `Warns after an update (now ${found.value.version.version})`,
          selectedByDefault: false,
          check: {
            type: GAME_UPDATED,
            title,
            required: false,
            params: { game: module.id, verifiedVersion: found.value.version.version },
          },
        });
      }
      return ok(candidates);
    },
  };
}
