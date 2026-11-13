import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { iracingBindingsContract } from './contract';
import { overview, setView, type BindingsContext } from './core/view';

/**
 * iRacing bindings, read from iRacing's own files. This feature reads only: nothing here
 * writes to Documents\iRacing (docs/research/iracing-bindings.md says why).
 */
export default defineFeatureMain({
  id: 'iracing-bindings',
  setup(ctx) {
    const bctx: BindingsContext = { ports: ctx.ports, log: ctx.log, games: ctx.games };
    return [
      bind(iracingBindingsContract, {
        // The page that repairs a controller's id belongs to whichever feature reads
        // iRacing bindings for the rest of the app; it is asked for, not named here.
        overview: async () => ok(await overview(bctx, ctx.bindings.get('iracing')?.route())),
        set: async ({ id }) => setView(bctx, id, await ctx.names.devices()),
      }),
    ];
  },
});
