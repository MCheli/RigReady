import { bind, defineFeatureMain } from '../../core/feature';
import { nuclearOptionBindingsContract } from './contract';
import { createBindingReader, overview, type BindingsContext } from './core/view';

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
    return [
      bind(nuclearOptionBindingsContract, {
        overview: () => overview(bctx),
      }),
    ];
  },
});
