import { bind, defineFeatureMain } from '../../core/feature';
import { listenForPresses } from '../../core/inputPresses';
import { ok } from '../../core/result';
import { nuclearOptionBindingsContract } from './contract';
import { nuclearOptionBackupSource } from './core/backup';
import { applyChange, applyClearDevice, reviewChange, reviewClearDevice } from './core/change';
import {
  applyRestore,
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  renameSnapshot,
  reviewRestore,
} from './core/snapshots';
import { createBindingReader, GAME, overview, type BindingsContext } from './core/view';

/**
 * Nuclear Option's bindings, read from the registry values the game saves. The reader it
 * registers is what the cheat sheets, the trainer, the overlay and the input tester draw
 * from. A change to a controller's bindings is written through FileStore (core/change.ts).
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
        clearDevicePreview: (request) => reviewClearDevice(bctx, request),
        async clearDevice(request) {
          const cleared = await applyClearDevice(bctx, request);
          // Also after a failure: one of the controller's maps may have been cleared before
          // it, and the cheat sheets and the overlay must not go on showing its bindings.
          if (!cleared.ok || cleared.value.changed) ctx.bindings.notifyChanged({ game: GAME });
          return cleared;
        },
        snapshots: () => listSnapshots(bctx),
        snapshotCreate: ({ name }) => createSnapshot(bctx, name),
        snapshotRename: ({ id, name }) => renameSnapshot(bctx, id, name),
        snapshotDelete: ({ id }) => deleteSnapshot(bctx, id),
        snapshotRestorePreview: ({ id }) => reviewRestore(bctx, id),
        async snapshotRestore({ id, seen }) {
          const restored = await applyRestore(bctx, id, seen);
          // Also after a failure: part of the snapshot may have been put back before it.
          if (!restored.ok || restored.value.changed) ctx.bindings.notifyChanged({ game: GAME });
          return restored;
        },
        async listenStart() {
          const mine = ++listenTurn;
          const started = await ctx.ports.input.start();
          if (!started.ok) return started;
          if (mine !== listenTurn) return ok({ listening: false });
          stopListening?.();
          stopListening = listenForPresses(ctx.ports.input, (press) => {
            if (press.kind === 'axis') {
              // "JOY_RZ": the axis by the name the controller gives it.
              ctx.emit(nuclearOptionBindingsContract, 'moved', {
                device: press.device.guid,
                deviceName: press.device.name.trim(),
                axis: press.input.replace(/^JOY_/, ''),
              });
              return;
            }
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
