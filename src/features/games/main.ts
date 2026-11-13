import { bind, defineFeatureMain } from '../../core/feature';
import type { GameModule } from '../../core/games';
import { err, ok } from '../../core/result';
import { gamesContract, type UserGameView } from './contract';
import { UserGames, type UserGame } from './core/customGames';
import type { GameModuleExtras } from './core/helpers';
import {
  forgetFolder,
  launchGame,
  rememberFolder,
  summarizeGames,
  summarizeOne,
  type ExtrasById,
} from './core/summary';
import { UserGamePicks } from './core/userGamePicks';

/** Game modules are discovered the same way features are: drop a folder in, export a module. */
const modules = import.meta.glob<{ default: GameModule; extras?: GameModuleExtras }>(
  './*/module.ts',
  { eager: true }
);

export default defineFeatureMain({
  id: 'games',
  setup(ctx) {
    const extras: ExtrasById = new Map();
    for (const [file, module] of Object.entries(modules)) {
      if (!module.default?.id) throw new Error(`${file} must default-export a GameModule`);
      // The family (flight, racing) is part of what other features may know about a game.
      const kind = module.default.kind ?? module.extras?.kind;
      ctx.games.register(kind ? { ...module.default, kind } : module.default);
      if (module.extras) extras.set(module.default.id, module.extras);
    }
    // The games the user added are read once at start (one small file) and registered as
    // modules. Every channel here waits for that; the shell reads the settings and the data
    // files' health after wiring and before it takes a call, by which time this is done.
    const userGames = new UserGames(ctx, extras);
    const ready = userGames.load().catch((e: unknown) => ctx.log.error('user games', e));
    const picks = new UserGamePicks(ctx);

    const view = async (game: UserGame): Promise<UserGameView> => ({
      id: game.id,
      name: game.name,
      kind: game.kind,
      ...(game.program ? { program: game.program, programRef: 'saved-0' } : {}),
      folders: game.folders.map((folder, i) => ({ ref: `saved-${i}`, path: folder })),
      ...(game.steamAppId ? { steamAppId: game.steamAppId } : {}),
      processes: game.processes,
      usedBy: await userGames.usedBy(game.id),
      problems: game.problems,
    });

    return [
      bind(gamesContract, {
        list: async () => {
          await ready;
          return ok(await summarizeGames(ctx.games, ctx, extras));
        },
        get: async ({ gameId }) => {
          await ready;
          return summarizeOne(ctx.games, extras, ctx, gameId);
        },
        async chooseFolder({ gameId }) {
          await ready;
          const game = ctx.games.get(gameId);
          const picked = await ctx.ports.dialogs.open({
            title: `Where is ${game?.name ?? 'the game'} installed?`,
            directory: true,
          });
          if (!picked.ok) return picked;
          const folder = picked.value[0];
          if (folder) {
            const saved = await rememberFolder(ctx, gameId, extras.get(gameId), folder);
            if (!saved.ok) return saved;
          }
          const summary = await summarizeOne(ctx.games, extras, ctx, gameId);
          return summary.ok ? ok({ chosen: folder !== undefined, game: summary.value }) : summary;
        },
        async forgetFolder({ gameId }) {
          await ready;
          const forgotten = await forgetFolder(ctx, gameId);
          if (!forgotten.ok) return forgotten;
          return summarizeOne(ctx.games, extras, ctx, gameId);
        },
        async launch({ gameId }) {
          await ready;
          const summary = await summarizeOne(ctx.games, extras, ctx, gameId);
          if (!summary.ok) return summary;
          return launchGame(ctx, summary.value);
        },
        async userGames() {
          await ready;
          // Read again: the file may have been edited by hand since the start.
          await userGames.load();
          const games: UserGameView[] = [];
          for (const game of userGames.list()) games.push(await view(game));
          return ok({ games, problems: userGames.problems() });
        },
        pickProgram: async () => picks.program(),
        pickFolder: async ({ game }) => picks.folder(game),
        async saveUserGame(input) {
          await ready;
          const existing = input.gameId ? userGames.get(input.gameId) : undefined;
          if (input.gameId && !existing) {
            return err('games.unknown', 'That game is no longer among the games you added.');
          }
          const draft = picks.resolve(input, existing);
          if (!draft.ok) return draft;
          const saved = await userGames.save(draft.value);
          if (!saved.ok) return saved;
          return summarizeOne(ctx.games, extras, ctx, saved.value.id);
        },
        async removeUserGame({ gameId }) {
          await ready;
          return userGames.remove(gameId);
        },
      }),
    ];
  },
});
