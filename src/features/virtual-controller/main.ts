import { bind, defineFeatureMain, type MainContext } from '../../core/feature';
import { findHidHideCli } from '../../core/hidhide';
import { listenForPresses } from '../../core/inputPresses';
import { err, ok, type Result } from '../../core/result';
import type { InputDevice, InputState } from '../../shared/models';
import { virtualControllerContract, type ProfileSummary, type VcState } from './contract';
import {
  driverCheck,
  DRIVER_SERVICE,
  installDriverInstructions,
  standDownStep,
  startRemediation,
  stopRemediation,
} from './core/checks';
import { Emulator } from './core/emulator';
import { computeReport, isVirtualPadLike, planMapping } from './core/mapping';
import { profileSources, type PadProfile } from './core/profile';
import type { Running } from './core/running';
import { ProfileStore } from './core/store';
import { DRIVER_DOWNLOAD, HIDHIDE_DOWNLOAD } from './links';

/** The live view sends at most this often. */
const LIVE_MS = 33;

let active: Emulator | undefined;

function summary(profile: PadProfile, builtin: boolean, devices: InputDevice[]): ProfileSummary {
  const plan = planMapping(profile, devices);
  return {
    id: profile.id,
    name: profile.name,
    ...(profile.description ? { description: profile.description } : {}),
    kind: profile.kind,
    builtin,
    mapped: profileSources(profile).length,
    missing: plan.missing,
  };
}

export default defineFeatureMain({
  id: 'virtual-controller',
  setup(ctx: MainContext) {
    const store = new ProfileStore(ctx.ports);
    const log = ctx.log.child('virtual-controller');

    const announce = (running: Running | undefined, note?: string): void => {
      void store.all().then((all) => {
        ctx.emit(virtualControllerContract, 'changed', {
          ...(running ? { running } : {}),
          ...(note ? { note } : {}),
          profiles: all.ok ? all.value.mine.map((p) => ({ id: p.id, name: p.name })) : [],
        });
      });
    };
    const emulator = new Emulator(ctx.ports, log, announce);
    active = emulator;
    const current = (): Emulator => emulator;

    ctx.checks.registerCheck(driverCheck);
    ctx.checks.registerRemediation(installDriverInstructions);
    ctx.checks.registerRemediation(startRemediation(current, store));
    ctx.checks.registerRemediation(stopRemediation(current));
    ctx.checks.registerStandDownStep(standDownStep(current));

    const controllers = async (): Promise<Result<InputDevice[]>> => {
      const started = await ctx.ports.input.start();
      if (!started.ok) return started;
      return ok(started.value.filter((d) => !isVirtualPadLike(d)));
    };

    // ---- the live view: what the virtual controller reports, or would for an edited profile ----
    let liveOff: (() => void) | undefined;
    let liveTimer: ReturnType<typeof setTimeout> | undefined;
    const stopLive = (): void => {
      liveOff?.();
      liveOff = undefined;
      clearTimeout(liveTimer);
      liveTimer = undefined;
    };
    const startLive = async (edited: PadProfile | undefined): Promise<void> => {
      stopLive();
      const started = await ctx.ports.input.start();
      const devices = started.ok ? started.value.filter((d) => !isVirtualPadLike(d)) : [];
      const latest = new Map<number, InputState>();
      let due = false;
      const send = (): void => {
        liveTimer = undefined;
        due = false;
        const profile = edited ?? emulator.profileInUse();
        const report = edited
          ? computeReport(edited, planMapping(edited, devices), latest)
          : emulator.lastReport();
        if (!profile || !report) return;
        ctx.emit(virtualControllerContract, 'live', {
          report,
          plugged: emulator.current() !== undefined,
        });
      };
      liveOff = ctx.ports.input.subscribe((states) => {
        for (const state of states) latest.set(state.index, state);
        if (due) return;
        due = true;
        liveTimer = setTimeout(send, LIVE_MS);
      });
      send();
    };

    const state = async (): Promise<Result<VcState>> => {
      const [service, cli, all, found] = await Promise.all([
        ctx.ports.services.get(DRIVER_SERVICE),
        findHidHideCli(ctx.ports),
        store.all(),
        controllers(),
      ]);
      if (!all.ok) return all;
      const devices = found.ok ? found.value : [];
      const running = emulator.current();
      return ok({
        driver: {
          installed: service.ok && service.value !== undefined,
          running: service.ok && service.value?.state === 'running',
          ...(service.ok && service.value ? { state: service.value.state } : {}),
          downloadUrl: DRIVER_DOWNLOAD,
        },
        hidHide: { installed: cli !== undefined, downloadUrl: HIDHIDE_DOWNLOAD },
        ...(running ? { running } : {}),
        profiles: {
          builtin: all.value.builtin.map((p) => summary(p, true, devices)),
          mine: all.value.mine.map((p) => summary(p, false, devices)),
        },
        controllers: devices.map((d) => ({
          name: d.name,
          guid: d.guid,
          axisNames: d.axisNames,
          numButtons: d.numButtons,
          numHats: d.numHats,
        })),
        ...(found.ok ? {} : { inputError: found.error.message }),
      });
    };

    return [
      bind(virtualControllerContract, {
        state,
        running: async () => {
          const all = await store.all();
          if (!all.ok) return all;
          return ok({
            running: emulator.current() ?? null,
            profiles: all.value.mine.map((p) => ({ id: p.id, name: p.name })),
          });
        },
        profile: ({ id }) => store.get(id),
        save: async ({ profile }) => {
          const saved = await store.save(profile);
          if (saved.ok) announce(emulator.current());
          return saved;
        },
        copy: async ({ from, name }) => {
          const copied = await store.copy(from, name);
          if (copied.ok) announce(emulator.current());
          return copied;
        },
        remove: async ({ id }) => {
          if (emulator.current()?.profileId === id) {
            return err('vc.inUse', 'This profile is running. Stop the virtual controller first.');
          }
          const removed = await store.remove(id);
          if (!removed.ok) return removed;
          announce(emulator.current());
          return ok({ removed: removed.value });
        },
        start: async ({ id, hide }) => {
          const profile = await store.get(id);
          if (!profile.ok) return profile;
          return emulator.start(profile.value, { hide, by: 'hand' });
        },
        stop: async () => {
          const stopped = await emulator.stop();
          return stopped.ok ? ok({ message: stopped.value }) : stopped;
        },
        detect: async ({ seconds }) => {
          const started = await ctx.ports.input.start();
          if (!started.ok) return started;
          return new Promise((resolve) => {
            // The latest state of each controller, read before the presses are judged.
            const latest = new Map<number, InputState>();
            const offLatest = ctx.ports.input.subscribe((states) => {
              for (const s of states) latest.set(s.index, s);
            });
            const timer = setTimeout(() => {
              off();
              offLatest();
              resolve(ok({ press: null }));
            }, seconds * 1000);
            const off = listenForPresses(ctx.ports.input, (press) => {
              if (isVirtualPadLike(press.device)) return;
              if (press.kind === 'axis') {
                // Letting go of a stick that was held over (the one just mapped) is not a
                // choice: an axis counts only when it is pushed away from the centre.
                const at = press.device.axisNames.indexOf(press.input.replace(/^JOY_/, ''));
                const value = latest.get(press.device.index)?.axes[at] ?? 0;
                if (Math.abs(value) < 0.45) return;
              }
              clearTimeout(timer);
              off();
              offLatest();
              resolve(
                ok({
                  press: {
                    device: { name: press.device.name, guid: press.device.guid },
                    input: press.input,
                    kind: press.kind,
                  },
                })
              );
            });
          });
        },
        live: async ({ on, profile }) => {
          if (!on) {
            stopLive();
            return ok({ watching: false });
          }
          await startLive(profile);
          return ok({ watching: true });
        },
      }),
    ];
  },
  async start() {
    // A run that never stopped (RigReady was ended) may have left controllers hidden: they
    // are shown to games again. A failure is logged by the emulator.
    await active?.recover();
  },
  async dispose() {
    await active?.dispose();
  },
});
