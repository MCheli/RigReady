import { bind, defineFeatureMain } from '../../core/feature';
import type { GameModule } from '../../core/games';
import { ok } from '../../core/result';
import { gamesContract } from './contract';
import type { GameModuleExtras } from './core/helpers';
import {
  forgetFolder,
  launchGame,
  rememberFolder,
  summarizeGames,
  summarizeOne,
  type ExtrasById,
} from './core/summary';

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
    return [
      bind(gamesContract, {
        list: async () => ok(await summarizeGames(ctx.games, ctx, extras)),
        get: ({ gameId }) => summarizeOne(ctx.games, extras, ctx, gameId),
        async chooseFolder({ gameId }) {
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
          const forgotten = await forgetFolder(ctx, gameId);
          if (!forgotten.ok) return forgotten;
          return summarizeOne(ctx.games, extras, ctx, gameId);
        },
        async launch({ gameId }) {
          const summary = await summarizeOne(ctx.games, extras, ctx, gameId);
          if (!summary.ok) return summary;
          return launchGame(ctx, summary.value);
        },
      }),
    ];
  },
});
