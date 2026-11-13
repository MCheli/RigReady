import { bind, defineFeatureMain } from '../../core/feature';
import { listenForPresses } from '../../core/inputPresses';
import { ok } from '../../core/result';
import { iracingBindingsContract } from './contract';
import { applyChange, pressedOf, reviewChange } from './core/change';
import { applyCopy, compareProfiles, reviewCopy } from './core/copy';
import { profileSwitch, switchMemory } from './core/profileSwitch';
import { profilesInUse } from './core/profiles';
import { overview, setView, type BindingsContext } from './core/view';

/**
 * iRacing bindings, read from iRacing's own files, and one binding changed at a time: the
 * page shows what would change first, and the write goes through FileStore. With control
 * profiles: the profiles, copying bindings between them, and a setup item that switches the
 * profile iRacing loads for all cars.
 */

/** Stops reporting controller presses to the page; set while the page listens. */
let stopListening: (() => void) | undefined;
/**
 * Counts the starts and stops of listening. The input reader can take seconds to start: a
 * start that a stop (or a later start) overtook meanwhile listens to nothing.
 */
let listenTurn = 0;

export default defineFeatureMain({
  id: 'iracing-bindings',
  setup(ctx) {
    const bctx: BindingsContext = { ports: ctx.ports, log: ctx.log, games: ctx.games };
    const switching = profileSwitch(
      ctx.games,
      switchMemory(ctx.ports.files, ctx.ports.folders.dataRoot())
    );
    ctx.checks.registerCheck(switching.check);
    ctx.checks.registerRemediation(switching.fix);
    ctx.checks.registerStandDownStep(switching.step);
    return [
      bind(iracingBindingsContract, {
        // The page that repairs a controller's id belongs to whichever feature reads
        // iRacing bindings for the rest of the app; it is asked for, not named here.
        overview: async () => {
          const profiles = await profilesInUse(bctx);
          return ok({
            ...(await overview(bctx, ctx.bindings.get('iracing')?.route())),
            ...(profiles ? { profiles } : {}),
          });
        },
        set: async ({ id }) => setView(bctx, id, await ctx.names.devices()),

        changePreview: async (request) => reviewChange(bctx, request, await ctx.names.devices()),
        change: async (request) => applyChange(bctx, request, await ctx.names.devices()),

        async listenStart() {
          const mine = ++listenTurn;
          const started = await ctx.ports.input.start();
          if (!started.ok) return started;
          const names = await ctx.names.devices();
          if (mine !== listenTurn) return ok({ listening: false });
          stopListening?.();
          stopListening = listenForPresses(ctx.ports.input, (press) =>
            ctx.emit(iracingBindingsContract, 'pressed', pressedOf(press, names))
          );
          return ok({ listening: true });
        },
        async listenStop() {
          listenTurn++;
          stopListening?.();
          stopListening = undefined;
          return ok({ listening: false });
        },

        copyCompare: async (request) => compareProfiles(bctx, request, await ctx.names.devices()),
        copyPreview: (request) => reviewCopy(bctx, request),
        async copy(request) {
          const copied = await applyCopy(bctx, request);
          // The cheat sheets and the overlay read the same profile through the racing reader.
          if (copied.ok && copied.value.copied > 0) ctx.bindings.notifyChanged({ game: 'iracing' });
          return copied;
        },
      }),
    ];
  },
  dispose() {
    stopListening?.();
    stopListening = undefined;
  },
});
