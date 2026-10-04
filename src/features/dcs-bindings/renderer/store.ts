import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { dcsBindingsContract } from '../contract';
import type {
  AircraftView,
  Applied,
  BindingOp,
  ChangePlan,
  CommandView,
  DeviceView,
  Mapping,
  Overview,
} from '../core/model';

/** One edit waiting to be saved, with the sentence shown in the list of staged changes. */
export interface StagedChange {
  id: number;
  op: BindingOp;
  text: string;
}

/** What the review dialog is about to write. */
export type ReviewRequest =
  | { type: 'edits'; ops: BindingOp[]; summary?: string; staged?: boolean }
  | { type: 'migration'; mappings: Mapping[] }
  | { type: 'restore'; id: string; remapIds: boolean };

export interface Review {
  request: ReviewRequest;
  plan?: ChangePlan;
  error?: string;
  busy: boolean;
}

/** What the bind dialog should open with. */
export interface BindRequest {
  mode: 'bind' | 'curve';
  commandId?: string;
  /** Limit the action list to these (an "important but unbound" item). */
  commandIds?: string[];
  deviceId?: string;
  key?: string;
  reformers?: string[];
}

export const useBindingsStore = defineStore('dcs-bindings', () => {
  const api = useClient(dcsBindingsContract);
  const overview = ref<Overview>();
  const aircraftId = ref<string>();
  const view = ref<AircraftView>();
  const loading = ref(true);
  const error = ref<string>();
  const staged = ref<StagedChange[]>([]);
  const review = ref<Review>();
  const bindRequest = ref<BindRequest>();
  /** The last change that was written, for the "Saved" line with Undo. */
  const saved = ref<Applied & { undone?: boolean }>();
  /** Bumped after every write so tabs that hold their own data reload it. */
  const revision = ref(0);
  let nextId = 1;
  let generation = 0;
  let planning = 0;

  const commands = computed(
    () => new Map<string, CommandView>((view.value?.commands ?? []).map((c) => [c.id, c]))
  );
  const devices = computed(
    () => new Map<string, DeviceView>((view.value?.devices ?? []).map((d) => [d.id, d]))
  );
  const controllers = computed(() =>
    (view.value?.devices ?? [])
      .filter((d) => d.type === 'joystick')
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name))
  );
  const commandName = (id: string): string => commands.value.get(id)?.name ?? id;
  /** The action in plain language, when a label file has one for it. */
  const commandPlain = (id: string): string | undefined => commands.value.get(id)?.plain;

  async function loadAircraft(id: string): Promise<void> {
    const mine = ++generation;
    aircraftId.value = id;
    const result = await api.aircraft({ id });
    if (mine !== generation) return;
    if (result.ok) {
      view.value = result.value;
      error.value = undefined;
    } else {
      view.value = undefined;
      error.value = errorText(result.error);
    }
  }

  async function load(): Promise<void> {
    const result = await api.overview();
    if (!result.ok) {
      error.value = errorText(result.error);
      loading.value = false;
      return;
    }
    overview.value = result.value;
    const known = result.value.aircraft.some((a) => a.id === aircraftId.value);
    const id = known ? aircraftId.value : result.value.aircraft[0]?.id;
    if (id) await loadAircraft(id);
    else view.value = undefined;
    loading.value = false;
  }

  async function selectAircraft(id: string): Promise<void> {
    if (id === aircraftId.value) return;
    staged.value = [];
    await loadAircraft(id);
  }

  function stage(op: BindingOp, text: string): void {
    staged.value = [...staged.value, { id: nextId++, op, text }];
  }

  function unstage(id: number): void {
    staged.value = staged.value.filter((s) => s.id !== id);
  }

  async function plan(request: ReviewRequest): Promise<void> {
    const mine = ++planning;
    review.value = { request, busy: true };
    const result =
      request.type === 'edits'
        ? await api.plan({
            ops: request.ops,
            ...(request.summary ? { summary: request.summary } : {}),
          })
        : request.type === 'migration'
          ? await api.migrationPlan({ mappings: request.mappings })
          : await api.snapshotRestorePlan({ id: request.id, remapIds: request.remapIds });
    // The dialog was closed, or another preview was asked for, in the meantime.
    if (mine !== planning || review.value === undefined) return;
    review.value = result.ok
      ? { request, plan: result.value, busy: false }
      : { request, error: errorText(result.error), busy: false };
  }

  /** Opens the review dialog on the staged edits. */
  function reviewStaged(): Promise<void> {
    return plan({ type: 'edits', ops: staged.value.map((s) => s.op), staged: true });
  }

  /** Opens the review dialog on a fix: these edits and nothing else. */
  function reviewOps(ops: BindingOp[], summary: string): Promise<void> {
    return plan({ type: 'edits', ops, summary });
  }

  async function applyReview(): Promise<void> {
    const current = review.value;
    if (!current?.plan || current.busy) return;
    const { request } = current;
    review.value = { ...current, busy: true };
    const result =
      request.type === 'edits'
        ? await api.apply({
            ops: request.ops,
            ...(request.summary ? { summary: request.summary } : {}),
          })
        : request.type === 'migration'
          ? await api.migrationApply({ mappings: request.mappings })
          : await api.snapshotRestore({ id: request.id, remapIds: request.remapIds });
    if (!result.ok) {
      review.value = { ...current, busy: false, error: errorText(result.error) };
      return;
    }
    if (request.type === 'edits' && request.staged) staged.value = [];
    review.value = undefined;
    saved.value = result.value;
    revision.value++;
    notifyMachineChanged();
    await load();
  }

  async function undoSaved(): Promise<void> {
    const last = saved.value;
    if (!last || last.undone) return;
    const result = await api.undo({ groupId: last.groupId });
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    saved.value = { ...last, undone: true };
    revision.value++;
    notifyMachineChanged();
    await load();
  }

  async function setRole(device: DeviceView, role: DeviceView['role']): Promise<void> {
    const result = await api.setRole({
      name: device.name,
      ...(device.vendorId ? { vendorId: device.vendorId } : {}),
      ...(device.productId ? { productId: device.productId } : {}),
      role,
    });
    if (!result.ok) error.value = errorText(result.error);
    await load();
  }

  async function setExpected(commandId: string, expected: boolean): Promise<void> {
    if (!aircraftId.value) return;
    const result = await api.setExpected({ aircraft: aircraftId.value, commandId, expected });
    if (!result.ok) error.value = errorText(result.error);
    await load();
  }

  return {
    api,
    overview,
    aircraftId,
    view,
    loading,
    error,
    staged,
    review,
    bindRequest,
    saved,
    revision,
    commands,
    devices,
    controllers,
    commandName,
    commandPlain,
    load,
    selectAircraft,
    stage,
    unstage,
    plan,
    reviewStaged,
    reviewOps,
    applyReview,
    undoSaved,
    setRole,
    setExpected,
  };
});
