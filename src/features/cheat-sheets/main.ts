import { bind, defineFeatureMain, type MainContext } from '../../core/feature';
import { err, ok } from '../../core/result';
import { cheatSheetsContract } from './contract';
import {
  addKneeboardCheck,
  createCapture,
  createKneeboardCheck,
  createRegenerate,
  kneeboardSetups,
  removeKneeboardCheck,
} from './core/check';
import { LiveTracker, type LiveDevice } from './core/live';
import { CheatSheets } from './core/service';

/** Live input reaches the windows at most this often. */
const FLUSH_MS = 25;

/** One per wiring (the app wires once; tests may wire several times). */
const cleanups = new Set<() => void>();

function setup(ctx: MainContext) {
  const service = new CheatSheets(ctx);
  ctx.checks.registerCheck(createKneeboardCheck(service));
  ctx.checks.registerRemediation(createRegenerate(service));
  ctx.checks.registerCapture(createCapture(service));
  const setups = { profiles: ctx.profiles, clock: ctx.ports.clock };

  // A bindings feature changed its game's files: every window with a sheet redraws it.
  // The pop-out is a window of its own and gets the same event as the main one.
  cleanups.add(
    ctx.bindings.onChanged((change) => ctx.emit(cheatSheetsContract, 'changed', change))
  );

  // ---- press a control, its label lights up ----
  const watchers = new Set<string>();
  const tracker = new LiveTracker();
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The latest state per controller waiting to be sent. Axis movement is coalesced; a
  // change of what is held is sent at once, so a quick press is never swallowed.
  const pending = new Map<string, LiveDevice>();
  const flush = (): void => {
    timer = undefined;
    if (pending.size === 0 || watchers.size === 0) return;
    const devices = [...pending.values()];
    pending.clear();
    ctx.emit(cheatSheetsContract, 'input', { devices });
  };
  const unwatch = (): void => {
    stop?.();
    stop = undefined;
    clearTimeout(timer);
    timer = undefined;
    pending.clear();
    tracker.reset();
  };
  cleanups.add(unwatch);

  return [
    bind(cheatSheetsContract, {
      overview: () => service.overview(),
      sheet: ({ game, aircraftId }) => service.sheet(game, aircraftId),
      setNote: ({ game, aircraftId, deviceKey, control, note }) =>
        service.setNote(game, aircraftId, deviceKey, control, note),

      saveLayout: ({ layout, vendorId, productId }) =>
        service.store.saveLayout(layout, { vendorId, productId }),
      resetLayout: (device) => service.store.resetLayout(device),
      exportLayout: ({ layout }) => service.exportLayout(layout),
      importLayout: (device) => service.importLayout(device),
      pickBackground: () => service.pickBackground(),

      savePdf: (input) => service.savePdf(input),

      kneeboardStatus: ({ game, aircraftId }) => service.kneeboardStatus(game, aircraftId),
      kneeboardPreview: (input) => service.kneeboardPreview(input),
      exportKneeboardPreview: ({ game, aircraftId, options }) =>
        service.exportKneeboardPreview(game, aircraftId, options),
      removeKneeboardPreview: ({ aircraftId }) => service.removeKneeboardPreview(aircraftId),
      exportKneeboard: ({ game, aircraftId, options }) =>
        service.exportKneeboard(game, aircraftId, options),
      removeKneeboard: ({ aircraftId }) => service.kneeboard.remove(aircraftId),

      kneeboardSetups: ({ game, aircraftId }) => kneeboardSetups(setups, game, aircraftId),
      async addKneeboardCheck({ game, aircraftId, profileId }) {
        // Only an aircraft the game really has: the id ends up in a setup and in a folder name.
        const aircraft = await ctx.bindings.get(game)?.aircraft();
        const known = aircraft?.ok ? aircraft.value.find((a) => a.id === aircraftId) : undefined;
        if (!known) return err('kneeboard.aircraft', 'That is not an aircraft of this game.');
        return addKneeboardCheck(service, setups, {
          game,
          aircraft: aircraftId,
          aircraftName: known.name,
          profileId,
        });
      },
      removeKneeboardCheck: ({ game, aircraftId, profileId }) =>
        removeKneeboardCheck(setups, { game, aircraft: aircraftId, profileId }),

      async watch({ client, on }) {
        if (!on) {
          watchers.delete(client);
          if (watchers.size === 0) unwatch();
          return ok({ watching: false });
        }
        const started = await ctx.ports.input.start();
        if (!started.ok) return started;
        watchers.add(client);
        stop ??= ctx.ports.input.subscribe((states) => {
          const devices = ctx.ports.input.devices();
          for (const state of states) {
            const live = tracker.update(
              devices.find((d) => d.index === state.index),
              state
            );
            if (!live) continue;
            let waiting = pending.get(live.guid);
            if (waiting && waiting.pressed.join() !== live.pressed.join()) {
              clearTimeout(timer);
              flush();
              waiting = undefined;
            }
            pending.set(
              live.guid,
              waiting
                ? {
                    ...live,
                    moved: [...new Set([...waiting.moved, ...live.moved])],
                  }
                : live
            );
          }
          timer ??= setTimeout(flush, FLUSH_MS);
        });
        return ok({ watching: true });
      },

      async popOut({ game, aircraftId, deviceKey }) {
        const query = new URLSearchParams({ game, aircraft: aircraftId, popped: '1' });
        if (deviceKey) query.set('device', deviceKey);
        return ctx.ports.window.openPanel({
          id: 'cheat-sheets-quick',
          route: `/configure/cheat-sheets/quick?${query.toString()}`,
          title: 'RigReady quick look',
          width: 560,
          height: 640,
          alwaysOnTop: true,
        });
      },
    }),
  ];
}

export default defineFeatureMain({
  id: 'cheat-sheets',
  setup,
  dispose() {
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
  },
});
