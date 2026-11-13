import { bind, defineFeatureMain } from '../../core/feature';
import { listenForPresses } from '../../core/inputPresses';
import { ok } from '../../core/result';
import { iracingBindingsContract } from './contract';
import { applyChange, editingOn, pressedOf, refuseWhenOff, reviewChange } from './core/change';
import { clearGone, goneDevices, reviewClearGone } from './core/cleanup';
import { overview, setView, type BindingsContext } from './core/view';

/**
 * iRacing bindings, read from iRacing's own files.
 *
 * Changing one binding is built and switched off: unless RigReady was started with
 * RIGREADY_IRACING_EDIT=1, the four channels of it answer with an error and nothing is
 * read, listened to or written (docs/research/iracing-bindings.md says what is still to
 * be proven on a rig). With the switch on, the one write goes through FileStore.
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
    return [
      bind(iracingBindingsContract, {
        // The page that repairs a controller's id belongs to whichever feature reads
        // iRacing bindings for the rest of the app; it is asked for, not named here.
        overview: async () =>
          ok(await overview(bctx, ctx.bindings.get('iracing')?.route(), editingOn())),
        set: async ({ id }) => setView(bctx, id, await ctx.names.devices()),

        changePreview: async (request) => reviewChange(bctx, request, await ctx.names.devices()),
        change: async (request) => applyChange(bctx, request, await ctx.names.devices()),

        // Controllers that are gone: which they are, and clearing their bindings.
        goneDevices: async ({ set }) => goneDevices(bctx, set, await ctx.names.devices()),
        clearGonePreview: async (request) =>
          reviewClearGone(bctx, request, await ctx.names.devices()),
        async clearGone(request) {
          const cleared = await clearGone(bctx, request, await ctx.names.devices());
          // Cheat sheets, the overlay and the guides read the same file.
          if (cleared.ok) ctx.bindings.notifyChanged({ game: 'iracing' });
          return cleared;
        },

        async listenStart() {
          const on = refuseWhenOff();
          if (!on.ok) return on;
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
      }),
    ];
  },
  dispose() {
    stopListening?.();
    stopListening = undefined;
  },
});
