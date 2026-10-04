import { defineStore } from 'pinia';
import { computed, ref, shallowReactive, shallowRef } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import type { InputDevice, InputState } from '../../../shared/models';
import { devicesContract } from '../contract';
import type { BindingSource, BoundInputs } from '../core/bound';
import type { DeviceIdentity } from '../core/identity';
import { ActivityLog, widen, type AxisRange } from '../core/input';
import type { NotificationMode, Overview, RigDevice } from '../core/model';
import { AxisHistory, stickPairs } from '../core/trace';
import { addPainter, schedule } from './canvas';

/** The Devices overview: names, controllers, location, HidHide, what setups need. */
export const useDevicesStore = defineStore('devices', () => {
  const api = useClient(devicesContract);
  const overview = shallowRef<Overview>();
  const error = ref<string>();
  const loading = ref(false);
  let generation = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  async function load(): Promise<void> {
    const mine = ++generation;
    loading.value = true;
    const result = await api.overview();
    if (mine !== generation) return;
    loading.value = false;
    if (result.ok) {
      overview.value = result.value;
      error.value = undefined;
      clearTimeout(retry);
      // The controller reader was still starting: look again shortly.
      if (result.value.inputPending) retry = setTimeout(() => void load(), 1500);
    } else {
      error.value = errorText(result.error);
    }
  }

  async function rename(key: string, name: string): Promise<string | undefined> {
    const result = await api.rename({ key, name });
    if (!result.ok) return errorText(result.error);
    await load();
    return undefined;
  }

  async function setNotifications(mode: NotificationMode): Promise<string | undefined> {
    const result = await api.setNotifications({ mode });
    if (!result.ok) return errorText(result.error);
    if (overview.value) overview.value = { ...overview.value, notifications: result.value.mode };
    return undefined;
  }

  /** Which device a checklist item of a setup is about (the Fly screen's Diagnose link). */
  async function forCheck(
    profileId: string,
    itemId: string
  ): Promise<
    | { ok: true; title: string; profile: string; identity: DeviceIdentity; keys: string[] }
    | { ok: false; message: string }
  > {
    const result = await api.forCheck({ profileId, itemId });
    return result.ok
      ? { ok: true, ...result.value }
      : { ok: false, message: errorText(result.error) };
  }

  /** The device a DirectInput controller belongs to. */
  function deviceOfController(index: number): RigDevice | undefined {
    return overview.value?.devices.find((d) => d.controllers.some((c) => c.index === index));
  }

  /** What to call a controller: the device's name, with the collection when it has several. */
  function controllerName(controller: Pick<InputDevice, 'index' | 'name'>): string {
    const device = deviceOfController(controller.index);
    if (!device) return controller.name.trim();
    if (device.controllers.length > 1 && !device.controllersShared) {
      const position = device.controllers.findIndex((c) => c.index === controller.index) + 1;
      return `${device.name} (controller ${position} of ${device.controllers.length})`;
    }
    return device.name;
  }

  return {
    overview,
    error,
    loading,
    load,
    rename,
    setNotifications,
    forCheck,
    deviceOfController,
    controllerName,
  };
});

type Listener = (state: InputState, previous: InputState | undefined) => void;

/**
 * Live controller input. States arrive from main at most ~60 times a second; they are kept
 * outside Vue's reactivity and each controller's version is bumped at most once per frame,
 * so only the views of controllers that changed re-render. The canvases (traces, the stick
 * plot, the strips of the list) are painted in that same frame, after the versions.
 */
export const useInputStore = defineStore('devices-input', () => {
  const api = useClient(devicesContract);
  const reported = shallowRef<InputDevice[]>([]);
  const error = ref<string>();
  const ready = ref(false);
  /** True once main is sending live input to this window. */
  const watching = ref(false);
  const states = new Map<number, InputState>();
  /** Per controller index: bumped when its state changed (read it to re-render). */
  const versions = shallowReactive<Record<number, number>>({});
  /** Controllers seen in input but not (yet) in the reported list, e.g. just plugged in. */
  const extra = shallowRef<InputDevice[]>([]);
  const lastActivity = new Map<number, number>();
  const ranges = new Map<string, AxisRange>();
  /** Per controller: the last few seconds of its axes, for the traces and the stick plot. */
  const histories = new Map<number, AxisHistory>();
  /** Per controller: the buttons (zero-based) seen pressed since the tester was opened. */
  const tried = new Map<number, Set<number>>();
  /** Per controller: counts every state received. A canvas repaints when it changed. */
  const revisions = new Map<number, number>();
  /** Per controller: the two axes the plot shows, when the user chose them. */
  const pairs = shallowReactive<Record<number, { x: number; y: number }>>({});
  const log = new ActivityLog();
  const logVersion = ref(0);
  const lastInput = ref<{ index: number; text: string }>();
  /** The latest log line per controller. */
  const lastByIndex = new Map<number, string>();
  /** The control used last, as games name it (JOY_BTN12), overall and per controller. */
  const lastControl = ref<{ index: number; input: string }>();
  const lastControlByIndex = new Map<number, string>();
  /** "What does it do": the games whose bindings can be read, the aircraft chosen, its bindings. */
  const sources = shallowRef<BindingSource[]>([]);
  const boundChoice = ref('');
  const bound = shallowRef<BoundInputs>();
  const boundError = ref<string>();
  const listeners = new Set<Listener>();
  const client = `tester-${Math.random().toString(36).slice(2)}`;
  let users = 0;
  let off: (() => void) | undefined;
  let dirty = new Set<number>();
  let logged = false;
  let names: (d: InputDevice) => string = (d) => d.name.trim();

  const devices = computed(() =>
    [...reported.value, ...extra.value].sort((a, b) => a.index - b.index)
  );

  function deviceFor(index: number): InputDevice | undefined {
    return (
      reported.value.find((d) => d.index === index) ?? extra.value.find((d) => d.index === index)
    );
  }

  // First in the frame, before any canvas: what changed since the last one.
  addPainter(() => {
    if (dirty.size === 0 && !logged) return false;
    for (const index of dirty) versions[index] = (versions[index] ?? 0) + 1;
    dirty = new Set();
    logged = false;
    logVersion.value++;
    return false;
  });

  function receive(incoming: InputState[]): void {
    const now = Date.now();
    const at = performance.now();
    for (const state of incoming) {
      const previous = states.get(state.index);
      states.set(state.index, state);
      let device = deviceFor(state.index);
      if (!device) {
        device = {
          index: state.index,
          name: state.name,
          guid: `index-${state.index}`,
          productGuid: '',
          vendorId: '',
          productId: '',
          numAxes: state.axes.length,
          numButtons: state.buttons.length,
          numHats: state.hats.length,
          axisNames: [],
        };
        extra.value = [...extra.value, device];
      }
      state.axes.forEach((v, i) => {
        const key = `${state.index}:${i}`;
        ranges.set(key, widen(ranges.get(key), v));
      });
      let history = histories.get(state.index);
      if (!history || history.axes !== state.axes.length) {
        history = new AxisHistory(state.axes.length);
        histories.set(state.index, history);
      }
      history.push(at, state.axes);
      let pressed = tried.get(state.index);
      for (let b = 0; b < state.buttons.length; b++) {
        if (!state.buttons[b]) continue;
        if (!pressed) tried.set(state.index, (pressed = new Set()));
        pressed.add(b);
      }
      revisions.set(state.index, (revisions.get(state.index) ?? 0) + 1);
      if (previous) {
        const entry = log.record(device, names(device), previous, state, now);
        if (entry) {
          logged = true;
          lastActivity.set(state.index, now);
          lastInput.value = { index: state.index, text: entry.text };
          lastByIndex.set(state.index, entry.text);
          const used = log.lastControl;
          if (used?.deviceIndex === state.index) {
            lastControl.value = { index: used.deviceIndex, input: used.input };
            lastControlByIndex.set(used.deviceIndex, used.input);
          }
        }
      } else {
        log.record(device, names(device), undefined, state, now);
      }
      dirty.add(state.index);
      for (const listener of listeners) listener(state, previous);
    }
    if (logged || dirty.size > 0) schedule();
  }

  async function loadDevices(): Promise<void> {
    const result = await api.inputDevices();
    if (result.ok) {
      reported.value = result.value;
      extra.value = extra.value.filter((e) => !result.value.some((d) => d.index === e.index));
      error.value = undefined;
    } else {
      error.value = errorText(result.error);
    }
    ready.value = true;
  }

  /** Starts live input for a screen. Call release() when the screen goes away. */
  async function acquire(): Promise<void> {
    users++;
    if (users > 1) return;
    off = api.on('input', ({ states: incoming }) => receive(incoming));
    await loadDevices();
    const watched = await api.watchInput({ client, on: true });
    if (watched.ok) watching.value = users > 0;
    else error.value = errorText(watched.error);
  }

  async function release(): Promise<void> {
    users = Math.max(0, users - 1);
    if (users > 0) return;
    off?.();
    off = undefined;
    watching.value = false;
    await api.watchInput({ client, on: false });
  }

  function onInput(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setNamer(namer: (d: InputDevice) => string): void {
    names = namer;
  }

  function clearLog(): void {
    log.clear();
    lastInput.value = undefined;
    lastByIndex.clear();
    lastControl.value = undefined;
    lastControlByIndex.clear();
    logVersion.value++;
  }

  async function loadSources(): Promise<void> {
    const result = await api.bindingSources();
    if (result.ok) sources.value = result.value;
  }

  /** Reads what is bound in the chosen aircraft ("<game>/<aircraft id>"; empty shows nothing). */
  async function chooseBound(choice: string): Promise<void> {
    boundChoice.value = choice;
    boundError.value = undefined;
    if (!choice) {
      bound.value = undefined;
      return;
    }
    const at = choice.indexOf('/');
    const result = await api.boundInputs({
      game: choice.slice(0, at),
      aircraftId: choice.slice(at + 1),
    });
    if (boundChoice.value !== choice) return;
    if (result.ok) bound.value = result.value;
    else {
      bound.value = undefined;
      boundError.value = errorText(result.error);
    }
  }

  /**
   * Forgets what one controller has shown so far: the range each axis reached and which
   * buttons were pressed. What is held right now counts again at once.
   */
  function startAgain(index: number): void {
    for (const key of [...ranges.keys()]) if (key.startsWith(`${index}:`)) ranges.delete(key);
    const state = states.get(index);
    state?.axes.forEach((v, i) => ranges.set(`${index}:${i}`, widen(undefined, v)));
    tried.set(index, new Set(state?.buttons.flatMap((b, i) => (b ? [i] : [])) ?? []));
    revisions.set(index, (revisions.get(index) ?? 0) + 1);
    versions[index] = (versions[index] ?? 0) + 1;
    schedule();
  }

  /** The two axes the plot of a controller shows: the user's choice, else its stick. */
  function pairFor(device: InputDevice): { x: number; y: number } | undefined {
    const count = Math.max(device.numAxes, device.axisNames.length);
    const chosen = pairs[device.index];
    if (chosen && chosen.x < count && chosen.y < count) return chosen;
    return stickPairs(device)[0];
  }

  function choosePair(index: number, pair: { x: number; y: number }): void {
    pairs[index] = pair;
    schedule();
  }

  return {
    devices,
    error,
    ready,
    watching,
    states,
    versions,
    lastActivity,
    ranges,
    histories,
    tried,
    revisions,
    log,
    logVersion,
    lastInput,
    lastByIndex,
    lastControl,
    lastControlByIndex,
    sources,
    boundChoice,
    bound,
    boundError,
    loadSources,
    chooseBound,
    deviceFor,
    loadDevices,
    acquire,
    release,
    onInput,
    setNamer,
    clearLog,
    startAgain,
    pairFor,
    choosePair,
  };
});
