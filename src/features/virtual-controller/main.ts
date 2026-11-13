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
import { copyName } from './core/builtins';
import { Emulator } from './core/emulator';
import { computeReport, isVirtualPadLike, planMapping } from './core/mapping';
import { profileSources, type PadProfile } from './core/profile';
import type { Running } from './core/running';
import { distinctLabels, nameKey } from './core/names';
import { ProfileStore } from './core/store';
import { setupNames, setupsByPadProfile, withPadProfileName, type SetupRef } from './core/usedBy';
import { DRIVER_DOWNLOAD, HIDHIDE_DOWNLOAD } from './links';

/** The live view sends at most this often. */
const LIVE_MS = 33;

let active: Emulator | undefined;

/** What the page needs to know beyond one profile: the names in use and who uses what. */
interface Around {
  devices: InputDevice[];
  /** How many profiles have each name (by nameKey). */
  names: Map<string, number>;
  usedBy: Map<string, SetupRef[]>;
}

function summary(profile: PadProfile, builtin: boolean, around: Around): ProfileSummary {
  const plan = planMapping(profile, around.devices);
  return {
    id: profile.id,
    name: profile.name,
    ...(profile.description ? { description: profile.description } : {}),
    kind: profile.kind,
    builtin,
    mapped: profileSources(profile).length,
    missing: plan.missing,
    ...(profile.game ? { game: profile.game } : {}),
    sameName: (around.names.get(nameKey(profile.name)) ?? 0) > 1,
    usedBy: around.usedBy.get(profile.id) ?? [],
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
          profiles: all.ok ? distinctLabels(all.value.mine) : [],
        });
      });
    };

    /**
     * Which setups start each profile, from the setups themselves (the core store every
     * feature reads them through). `note` is set when that could not be found out in
     * full: the page then says so, and a delete is confirmed as if a setup used the profile.
     */
    const setupsUsing = async (): Promise<{ by: Map<string, SetupRef[]>; note?: string }> => {
      const listed = await ctx.profiles.listDetailed();
      if (!listed.ok) {
        return {
          by: new Map(),
          note: `The setups could not be read (${listed.error.message}), so RigReady cannot say which setups use a profile.`,
        };
      }
      const by = setupsByPadProfile(listed.value.profiles.map((p) => p.profile));
      const unread = listed.value.invalid.length;
      if (unread === 0) return { by };
      return {
        by,
        note: `${unread === 1 ? 'One setup file' : `${unread} setup files`} could not be read, so a setup that uses a profile may be missing here.`,
      };
    };
    /**
     * A renamed profile takes its new name to the setups that start it: a setup keeps the
     * name beside the id, and the Play page reads it there. A setup that cannot be written
     * keeps the old name until its step is chosen again; that is logged, and the rename
     * itself stands.
     */
    const renameInSetups = async (profileId: string, name: string): Promise<void> => {
      const listed = await ctx.profiles.listDetailed();
      if (!listed.ok) {
        log.error(`setups not read after a profile was renamed: ${listed.error.message}`);
        return;
      }
      for (const { profile: setup } of listed.value.profiles) {
        const renamed = withPadProfileName(setup, profileId, name);
        if (!renamed) continue;
        const saved = await ctx.profiles.save(renamed);
        if (!saved.ok) {
          log.error(`setup ${setup.id} keeps the old profile name: ${saved.error.message}`);
        }
      }
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
      const [service, cli, all, found, setups] = await Promise.all([
        ctx.ports.services.get(DRIVER_SERVICE),
        findHidHideCli(ctx.ports),
        store.all(),
        controllers(),
        setupsUsing(),
      ]);
      if (!all.ok) return all;
      const names = new Map<string, number>();
      for (const p of [...all.value.builtin, ...all.value.mine]) {
        names.set(nameKey(p.name), (names.get(nameKey(p.name)) ?? 0) + 1);
      }
      const around: Around = { devices: found.ok ? found.value : [], names, usedBy: setups.by };
      const devices = around.devices;
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
          builtin: all.value.builtin.map((p) => summary(p, true, around)),
          mine: all.value.mine.map((p) => summary(p, false, around)),
        },
        controllers: devices.map((d) => ({
          name: d.name,
          guid: d.guid,
          axisNames: d.axisNames,
          numButtons: d.numButtons,
          numHats: d.numHats,
        })),
        ...(found.ok ? {} : { inputError: found.error.message }),
        ...(setups.note ? { setupsNote: setups.note } : {}),
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
            profiles: distinctLabels(all.value.mine),
          });
        },
        profile: ({ id }) => store.get(id),
        save: async ({ profile }) => {
          const before = await store.get(profile.id);
          const saved = await store.save(profile);
          if (!saved.ok) return saved;
          if (before.ok && before.value.name !== saved.value.name) {
            await renameInSetups(saved.value.id, saved.value.name);
          }
          announce(emulator.current());
          return saved;
        },
        copy: async ({ from, name }) => {
          const source = await store.get(from);
          if (!source.ok) return source;
          const copied = await store.copy(from, name ?? copyName(source.value));
          if (copied.ok) announce(emulator.current());
          return copied;
        },
        remove: async ({ id, evenIfUsed }) => {
          if (emulator.current()?.profileId === id) {
            return err('vc.inUse', 'This profile is running. Stop the virtual controller first.');
          }
          const all = await store.all();
          if (!all.ok) return all;
          // Only a profile that is there is asked about: one that is gone answers
          // "nothing removed" below, and a starting point is refused by the store.
          if (!evenIfUsed && all.value.mine.some((p) => p.id === id)) {
            // A profile a setup starts is not deleted by one press: that is how a setup
            // lost its virtual controller on 12 November 2026.
            const setups = await setupsUsing();
            const users = setups.by.get(id) ?? [];
            if (users.length > 0) {
              return err(
                'vc.usedBySetups',
                `${users.length === 1 ? 'The setup' : 'The setups'} ${setupNames(users)} ${users.length === 1 ? 'starts' : 'start'} this profile (${id}). Deleting it breaks that step: the game would start without a virtual controller.`,
                users.map((s) => s.id).join(', ')
              );
            }
            if (setups.note) return err('vc.setupsUnread', setups.note);
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
