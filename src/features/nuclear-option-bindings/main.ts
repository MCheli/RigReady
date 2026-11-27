import { bind, defineFeatureMain } from '../../core/feature';
import { nuclearOptionBindingsContract } from './contract';
import { nuclearOptionBackupSource } from './core/backup';
import { applyChange, reviewChange } from './core/change';
import { createBindingReader, GAME, overview, type BindingsContext } from './core/view';

/**
 * Nuclear Option's bindings, read from the registry values the game saves. The reader it
 * registers is what the cheat sheets, the trainer, the overlay and the input tester draw
 * from. Nothing is written: the registry port only reads.
 */
export default defineFeatureMain({
  id: 'nuclear-option-bindings',
  setup(ctx) {
    const bctx: BindingsContext = { ports: ctx.ports, log: ctx.log, games: ctx.games };
    ctx.bindings.register(createBindingReader(bctx));
    // The bindings are registry values: a full backup keeps them as a record to read back.
    ctx.backupSources.register(nuclearOptionBackupSource);
    return [
      bind(nuclearOptionBindingsContract, {
        overview: () => overview(bctx),
        changePreview: (request) => reviewChange(bctx, request),
        async change(request) {
          const changed = await applyChange(bctx, request);
          // The cheat sheets, the trainer and the overlay read the same saved bindings.
          if (changed.ok && changed.value.changed) ctx.bindings.notifyChanged({ game: GAME });
          return changed;
        },
      }),
    ];
  },
});
