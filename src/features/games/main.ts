import { bind, defineFeatureMain } from '../../core/feature';
import type { GameModule } from '../../core/games';
import { ok } from '../../core/result';
import { gamesContract } from './contract';
import { summarizeGames } from './core/summary';

/** Game modules are discovered the same way features are: drop a folder in, export a module. */
const modules = import.meta.glob<{ default: GameModule }>('./*/module.ts', { eager: true });

export default defineFeatureMain({
  id: 'games',
  setup(ctx) {
    for (const [file, module] of Object.entries(modules)) {
      if (!module.default?.id) throw new Error(`${file} must default-export a GameModule`);
      ctx.games.register(module.default);
    }
    return [
      bind(gamesContract, {
        list: async () => ok(await summarizeGames(ctx.games, ctx)),
      }),
    ];
  },
});
