import { bind, defineFeatureMain, type MainContext } from '../../core/feature';
import type { Profile } from '../../core/profile/schema';
import { err, ok, type Result } from '../../core/result';
import type { DeviceInfo, InputDevice, InputState } from '../../shared/models';
import { devicesContract } from './contract';
import {
  DEVICE_CONNECTED,
  deviceCapture,
  deviceConnectedCheck,
  DeviceParamsSchema,
  matchesDevice,
} from './core/deviceCheck';
import { boundInputsOf, type BindingSource } from './core/bound';
import { analyzeHealth, type HealthReport, type Sample } from './core/health';
import { hidHideCached } from './core/hidhide';
import type { Overview } from './core/model';
import { ConnectionNotifier, diffDevices } from './core/notifier';
import { buildOverview, requirements } from './core/overview';
import {
  deviceNames,
  deviceStores,
  findName,
  HistorySchema,
  updateHistory,
  withControllerName,
  withName,
  type DevicesData,
} from './core/store';
import { buildUsbMap } from './core/usbMap';

/** How long the overview waits for the DirectInput reader before showing devices without it. */
const INPUT_WAIT_MS = 4000;
/** Live input reaches the window at most this often. */
const INPUT_FLUSH_MS = 16;

/** One per wiring (the app wires once; tests may wire several times). */
const cleanups = new Set<() => Promise<void>>();

function setupDevices(ctx: MainContext) {
  const { ports } = ctx;
  const stores = deviceStores(ports);

  // The DirectInput reader is shared by the whole app: start() is idempotent, so every use
  // simply asks for it (see InputProvider). A failed start is tried again by the next call.
  const startInput = (): Promise<Result<InputDevice[]>> => ports.input.start();

  // The names the owner gave devices, for every other feature (ctx.names.devices()).
  ctx.names.provideDevices(async () => {
    const [listed, data] = await Promise.all([ports.devices.list(), stores.data.read()]);
    return deviceNames(data.ok ? data.value.names : [], listed.ok ? listed.value : []);
  });

  /** The setup Fly shows: the one used last, else the first. */
  const activeProfile = async (): Promise<{ all: Profile[]; active?: Profile }> => {
    const profiles = await ctx.profiles.list();
    const all = profiles.ok ? profiles.value : [];
    const lastId = await ctx.profiles.lastProfileId();
    const active = all.find((p) => p.id === lastId) ?? all[0];
    return active ? { all, active } : { all };
  };

  const readData = async (): Promise<DevicesData> => {
    const data = await stores.data.read();
    if (!data.ok) throw new Error(data.error.message);
    return data.value;
  };

  async function overview(): Promise<Result<Overview>> {
    const listed = await ports.devices.list();
    if (!listed.ok) return listed;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const input = await Promise.race([
      startInput(),
      new Promise<'pending'>((resolve) => {
        timer = setTimeout(() => resolve('pending'), INPUT_WAIT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    const data = await stores.data.read();
    if (!data.ok) return data;
    const history = await updateHistory(stores, listed.value, ports.clock);
    const { all: allProfiles, active } = await activeProfile();
    const bindingPages: { label: string; route(guid: string): string }[] = [];
    for (const reader of ctx.bindings.all()) {
      if (!(await reader.available().catch(() => false))) continue;
      bindingPages.push({
        label: `${reader.gameName.replace(/ World$/, '')} bindings`,
        route: (guid) => reader.route({ guid }),
      });
    }
    const built = buildOverview({
      bindingPages,
      devices: listed.value,
      // The reader's current list: controllers come and go after it started.
      input: input !== 'pending' && input.ok ? ports.input.devices() : [],
      ...(input === 'pending'
        ? { inputError: 'Reading game controllers…' }
        : !input.ok
          ? { inputError: input.error.message }
          : {}),
      data: data.value,
      history: history.ok ? history.value : HistorySchema.parse({}),
      profiles: allProfiles,
      ...(active ? { activeProfile: active } : {}),
      hidHide: await hidHideCached(ports),
      rigReadyExe: process.execPath,
      now: ports.clock.now(),
    });
    return ok(input === 'pending' ? { ...built, inputPending: true } : built);
  }

  // ---- live input to the window, coalesced to the latest state per controller ----
  const watchers = new Set<string>();
  let stopWatching: (() => void) | undefined;
  // Waiting to be sent, in order. Axis-only updates of a controller replace each other;
  // a button or hat change is never dropped, however quickly it is undone.
  let pending: InputState[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    flushTimer = undefined;
    if (pending.length === 0 || watchers.size === 0) return;
    const states = pending;
    pending = [];
    ctx.emit(devicesContract, 'input', { states });
  };
  const queueState = (state: InputState): void => {
    const at = pending.findLastIndex((s) => s.index === state.index);
    const last = at >= 0 ? pending[at] : undefined;
    const same = (a: unknown[], b: unknown[]): boolean => JSON.stringify(a) === JSON.stringify(b);
    if (last && same(last.buttons, state.buttons) && same(last.hats, state.hats))
      pending[at] = state;
    else pending.push(state);
  };
  const watch = async (client: string, on: boolean): Promise<Result<{ watching: boolean }>> => {
    if (!on) {
      watchers.delete(client);
      if (watchers.size === 0) {
        stopWatching?.();
        stopWatching = undefined;
        pending = [];
      }
      return ok({ watching: false });
    }
    const started = await startInput();
    if (!started.ok) return started;
    watchers.add(client);
    stopWatching ??= ports.input.subscribe((states) => {
      for (const state of states) queueState(state);
      flushTimer ??= setTimeout(flush, INPUT_FLUSH_MS);
    });
    return ok({ watching: true });
  };

  // ---- health scan ----
  async function healthScan(seconds: number): Promise<Result<HealthReport>> {
    const started = await startInput();
    if (!started.ok) return started;
    const samples: Sample[] = [];
    const start = ports.clock.now().getTime();
    const off = ports.input.subscribe((states) => {
      const t = ports.clock.now().getTime();
      for (const state of states) samples.push({ t, state });
    });
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    off();
    const end = Math.max(ports.clock.now().getTime(), start + seconds * 1000);
    const devices = ports.input.devices().length > 0 ? ports.input.devices() : started.value;
    const data = await readData();
    const names = new Map<number, string>();
    const view = await overview();
    if (view.ok) {
      for (const device of view.value.devices) {
        device.controllers.forEach((c, i) => {
          const part = device.controllers.length > 1 ? ` (controller ${i + 1})` : '';
          names.set(c.index, `${device.name}${part}`);
        });
      }
    }
    return ok(
      analyzeHealth({
        devices,
        samples,
        start,
        end,
        expected: new Set(data.switches.map((s) => `${s.inputKey}/${s.button}`)),
        names,
      })
    );
  }

  // ---- plug and unplug: history and tray notifications ----
  let foreground = true;
  let known: DeviceInfo[] | undefined;
  let notifyCache: {
    data: DevicesData;
    present: DeviceInfo[];
    required: (d: DeviceInfo) => boolean;
  } = {
    data: { schemaVersion: 1, names: [], switches: [], notifications: 'controllers' },
    present: [],
    required: () => false,
  };
  const notifier = new ConnectionNotifier({
    notify: (title, body) => {
      void ports.notifications.notify({ title, body }).then((sent) => {
        if (!sent.ok) ctx.log.warn('could not show a notification', sent.error);
      });
    },
    wanted: (device) => {
      if (foreground) return false;
      switch (notifyCache.data.notifications) {
        case 'off':
          return false;
        case 'all':
          return true;
        case 'required':
          return notifyCache.required(device);
        case 'controllers':
          return device.isGameController || notifyCache.required(device);
      }
    },
    label: (device) =>
      findName(notifyCache.data.names, device, [...notifyCache.present, device])?.name ??
      device.name.trim(),
  });

  const refreshNotifyCache = async (present: DeviceInfo[]): Promise<void> => {
    const data = await stores.data.read();
    const { active } = await activeProfile();
    const needs = active ? requirements([active]) : [];
    notifyCache = {
      data: data.ok ? data.value : notifyCache.data,
      present,
      required: (d) => needs.some((n) => matchesDevice(d, n.params)),
    };
  };

  let queue: Promise<void> = Promise.resolve();
  const onDevicesChanged = (): void => {
    queue = queue
      .then(async () => {
        const listed = await ports.devices.list();
        if (!listed.ok) return;
        const previous = known;
        known = listed.value;
        await refreshNotifyCache(listed.value);
        if (!previous) return;
        const { added, removed } = diffDevices(previous, listed.value);
        if (added.length + removed.length === 0) return;
        notifier.changed(added, removed);
        // What was there a moment ago is remembered with its place, then marked gone.
        await updateHistory(stores, previous, ports.clock);
        await updateHistory(stores, listed.value, ports.clock);
      })
      .catch((e) => ctx.log.warn('device change handling failed', e));
  };
  const unsubscribe = ports.devices.subscribe(onDevicesChanged);
  // The starting picture, so the first change can be told apart. Nothing is written yet:
  // history is recorded on changes, when the Devices screen asks, and on quit.
  queue = queue
    .then(async () => {
      const listed = await ports.devices.list();
      if (listed.ok) known ??= listed.value;
    })
    .catch(() => undefined);

  const cleanup = async (): Promise<void> => {
    unsubscribe();
    stopWatching?.();
    notifier.dispose();
    clearTimeout(flushTimer);
    await queue;
    if (known) await updateHistory(stores, known, ports.clock);
  };
  cleanups.add(cleanup);

  const usbMap = async () => {
    const listed = await ports.devices.list();
    if (!listed.ok) return listed;
    const view = await overview();
    if (!view.ok) return view;
    const { active } = await activeProfile();
    const needs = active ? requirements([active]) : [];
    return ok(
      buildUsbMap(listed.value, view.value.devices, {
        required: (d) => needs.some((n) => matchesDevice(d, n.params)),
        ...(active ? { activeProfile: active.name } : {}),
      })
    );
  };

  return bind(devicesContract, {
    list: () => ports.devices.list(),
    overview,
    forCheck: async ({ profileId, itemId }) => {
      const profile = await ctx.profiles.get(profileId);
      if (!profile.ok) return err('devices.noSuchItem', 'That setup no longer exists.');
      const check = profile.value.checks.find((c) => c.id === itemId);
      const params =
        check?.type === DEVICE_CONNECTED ? DeviceParamsSchema.safeParse(check.params) : undefined;
      if (!check || !params?.success) {
        return err('devices.noSuchItem', 'That checklist item is not about a device.');
      }
      const listed = await ports.devices.list();
      if (!listed.ok) return listed;
      const { count: _count, ...identity } = params.data;
      return ok({
        title: check.title,
        profile: profile.value.name,
        identity,
        keys: listed.value.filter((d) => matchesDevice(d, params.data)).map((d) => d.instanceId),
      });
    },
    rename: async ({ key, name }) => {
      const listed = await ports.devices.list();
      if (!listed.ok) return listed;
      const present = listed.value.filter((d) => !d.isHub);
      const trimmed = name.trim();
      if (key.startsWith('guid:')) {
        const guid = key.slice(5);
        const controller = ports.input.devices().find((c) => c.guid === guid);
        if (!controller) return err('devices.gone', 'That controller is no longer connected.');
        const saved = await stores.data.update((data) =>
          withControllerName(
            data,
            {
              vendorId: controller.vendorId || '0000',
              productId: controller.productId || '0000',
              guid,
            },
            trimmed
          )
        );
        return saved.ok ? ok({ name: trimmed || null }) : saved;
      }
      const device = present.find((d) => d.instanceId === key);
      if (!device) return err('devices.gone', 'That device is no longer connected.');
      const saved = await stores.data.update((data) => withName(data, device, present, trimmed));
      if (!saved.ok) return saved;
      // Read it back: the name must now be found for this device.
      const found = findName(saved.value.names, device, present)?.name ?? null;
      if ((found ?? '') !== trimmed) {
        return err('devices.rename', 'The name could not be stored for this device.');
      }
      return ok({ name: found });
    },
    inputDevices: async () => {
      const started = await startInput();
      return started.ok ? ok(ports.input.devices()) : started;
    },
    watchInput: ({ client, on }) => watch(client, on),
    healthScan: ({ seconds }) => healthScan(seconds),
    markSwitch: async ({ inputKey, button, expected }) => {
      const saved = await stores.data.update((data) => {
        const switches = data.switches.filter(
          (s) => !(s.inputKey === inputKey && s.button === button)
        );
        if (expected) switches.push({ inputKey, button });
        return { ...data, switches };
      });
      return saved.ok ? ok({ switches: saved.value.switches.length }) : saved;
    },
    usbMap,
    bindingSources: async () => {
      const sources: BindingSource[] = [];
      for (const reader of ctx.bindings.all()) {
        if (!(await reader.available().catch(() => false))) continue;
        const aircraft = await reader.aircraft();
        if (!aircraft.ok) {
          ctx.log.warn(`bindings of ${reader.game} could not be listed`, aircraft.error);
          continue;
        }
        sources.push({ game: reader.game, gameName: reader.gameName, aircraft: aircraft.value });
      }
      return ok(sources);
    },
    boundInputs: async ({ game, aircraftId }) => {
      const reader = ctx.bindings.get(game);
      if (!reader) return err('devices.noBindings', 'Bindings of that game cannot be read here.');
      const bindings = await reader.bindings(aircraftId);
      return bindings.ok ? ok(boundInputsOf(reader, bindings.value)) : bindings;
    },
    setNotifications: async ({ mode }) => {
      const saved = await stores.data.update((data) => ({ ...data, notifications: mode }));
      if (!saved.ok) return saved;
      notifyCache = { ...notifyCache, data: saved.value };
      return ok({ mode: saved.value.notifications });
    },
    windowVisible: async ({ visible }) => {
      foreground = visible;
      return ok({ visible });
    },
  });
}

export default defineFeatureMain({
  id: 'devices',
  setup(ctx) {
    ctx.checks.registerCheck(deviceConnectedCheck);
    ctx.checks.registerCapture(deviceCapture);
    return [setupDevices(ctx)];
  },
  async dispose() {
    const all = [...cleanups];
    cleanups.clear();
    for (const cleanup of all) await cleanup();
  },
});
