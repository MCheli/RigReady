import { bind, defineFeatureMain } from '../../core/feature';
import { listenForPresses } from '../../core/inputPresses';
import { ok } from '../../core/result';
import { nuclearOptionBindingsContract } from './contract';
import { nuclearOptionBackupSource } from './core/backup';
import { applyChange, reviewChange } from './core/change';
import { createBindingReader, GAME, overview, type BindingsContext } from './core/view';

/**
 * Nuclear Option's bindings, read from the registry values the game saves. The reader it
 * registers is what the cheat sheets, the trainer, the overlay and the input tester draw
 * from. Nothing is written: the registry port only reads.
 */
/** Stops reporting controller presses to the page; set while the page listens. */
let stopListening: (() => void) | undefined;
/**
 * Counts the starts and stops of listening. The input reader can take seconds to start: a
 * start that a stop (or a later start) overtook meanwhile listens to nothing.
 */
let listenTurn = 0;

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
        async listenStart() {
          const mine = ++listenTurn;
          const started = await ctx.ports.input.start();
          if (!started.ok) return started;
          if (mine !== listenTurn) return ok({ listening: false });
          stopListening?.();
          stopListening = listenForPresses(ctx.ports.input, (press) => {
            const button = Number(/^JOY_BTN(\d+)$/.exec(press.input)?.[1]);
            if (press.kind !== 'button' || !Number.isInteger(button)) return;
            ctx.emit(nuclearOptionBindingsContract, 'pressed', {
              device: press.device.guid,
              deviceName: press.device.name.trim(),
              button,
            });
          });
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
