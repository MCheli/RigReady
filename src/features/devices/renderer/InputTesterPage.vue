<script setup lang="ts">
import DeviceTabs from './DeviceTabs.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { onMachineChanged } from '../../../renderer/machine';
import { boundControl } from '../core/bound';
import { gameInputLabel } from '../core/input';
import CompactController from './CompactController.vue';
import ControllerView from './ControllerView.vue';
import { useDevicesStore, useInputStore } from './store';

const input = useInputStore();
const devicesStore = useDevicesStore();
const route = useRoute();
const router = useRouter();

const raw = ref(false);
const now = ref(Date.now());
const selected = computed<number | undefined>(() => {
  const value = route.query['controller'];
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : undefined;
});
const current = computed(() =>
  selected.value === undefined ? undefined : input.devices.find((d) => d.index === selected.value)
);
const name = (index: number): string => {
  const device = input.deviceFor(index);
  return device ? devicesStore.controllerName(device) : `Controller ${index + 1}`;
};

function select(index: number | undefined): void {
  void router.replace({ query: index === undefined ? {} : { controller: String(index) } });
}

const RECENT_MS = 900;
const recent = (index: number): boolean =>
  now.value - (input.lastActivity.get(index) ?? 0) < RECENT_MS;

const entries = computed(() => {
  void input.logVersion;
  const list = input.log.entries;
  return (
    selected.value === undefined ? list : list.filter((e) => e.deviceIndex === selected.value)
  ).slice(0, 80);
});
const lastInput = computed(() => {
  void input.logVersion;
  if (selected.value !== undefined) return input.lastByIndex.get(selected.value);
  const last = input.lastInput;
  return last ? `${name(last.index)}: ${last.text}` : undefined;
});

// ---- what the control does in a game ----
const aircraftItems = computed(() => [
  { title: 'Do not show', value: '' },
  ...input.sources.flatMap((source) =>
    source.aircraft.map((a) => ({
      title: `${source.gameName.replace(/ World$/, '')} · ${a.name}`,
      value: `${source.game}/${a.id}`,
    }))
  ),
]);
/** The control used last (on the chosen controller, or on any) and what it does in the chosen aircraft. */
const lastBound = computed(() => {
  void input.logVersion;
  const bound = input.bound;
  if (!bound) return undefined;
  const last =
    selected.value === undefined
      ? input.lastControl
      : input.lastControlByIndex.has(selected.value)
        ? { index: selected.value, input: input.lastControlByIndex.get(selected.value)! }
        : undefined;
  if (!last) return { aircraft: bound.aircraft.name, gameName: bound.gameName };
  const guid = input.deviceFor(last.index)?.guid;
  const controller = bound.controllers.find((c) => c.guid === guid?.toUpperCase());
  const control = boundControl(bound, guid, last.input);
  return {
    aircraft: bound.aircraft.name,
    gameName: bound.gameName,
    control: `${gameInputLabel(last.input)} on ${name(last.index)}`,
    input: last.input,
    actions: control?.actions ?? [],
    duplicate: control?.duplicate ?? false,
    route: controller?.route,
  };
});

const time = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

let ticker: ReturnType<typeof setInterval> | undefined;
let offMachine: (() => void) | undefined;
onMounted(async () => {
  input.setNamer((d) => devicesStore.controllerName(d));
  ticker = setInterval(() => (now.value = Date.now()), 150);
  offMachine = onMachineChanged(() => {
    void input.loadDevices();
    void devicesStore.load();
  });
  if (!devicesStore.overview) void devicesStore.load();
  void input.loadSources();
  // Bindings may have been edited since this page was last open.
  if (input.boundChoice) void input.chooseBound(input.boundChoice);
  await input.acquire();
});
onBeforeUnmount(() => {
  clearInterval(ticker);
  offMachine?.();
  void input.release();
});
watch(selected, () => (now.value = Date.now()));
</script>

<template>
  <div data-testid="tester-page" :data-live="input.watching">
    <div class="d-flex align-start">
      <div>
        <h1 class="rr-page-title">Input tester</h1>
        <p class="rr-page-sub">
          Buttons, axes and hats exactly as a game reads them through DirectInput.
        </p>
      </div>
      <v-spacer />
      <v-switch v-model="raw" label="Raw values" data-testid="tester-raw" class="flex-grow-0" />
    </div>
    <DeviceTabs />

    <v-alert
      v-if="input.error"
      type="warning"
      variant="tonal"
      class="mb-4"
      data-testid="tester-error"
    >
      {{ input.error }}
    </v-alert>

    <div class="tester-bar">
      <v-chip-group
        :model-value="selected ?? -1"
        mandatory
        selected-class="tester-chip-on"
        class="tester-chips"
      >
        <v-chip :value="-1" variant="outlined" data-testid="tester-all" @click="select(undefined)"
          >All controllers</v-chip
        >
        <v-chip
          v-for="d in input.devices"
          :key="d.index"
          :value="d.index"
          variant="outlined"
          :class="{ 'tester-chip-live': recent(d.index) }"
          data-testid="tester-pick"
          :data-index="d.index"
          @click="select(d.index)"
          >{{ name(d.index) }}</v-chip
        >
      </v-chip-group>
    </div>

    <div class="tester-last rr-panel" data-testid="tester-last-input">
      <v-icon icon="mdi-gesture-tap-button" size="18" class="rr-muted" />
      <span v-if="lastInput"
        >Last input: <strong>{{ lastInput }}</strong></span
      >
      <span v-else class="rr-muted">Last input: nothing yet. Press a button or move an axis.</span>
    </div>

    <div v-if="input.sources.length > 0" class="tester-bound rr-panel" data-testid="tester-bound">
      <v-select
        class="tester-aircraft"
        label="Show what it does in"
        :items="aircraftItems"
        :model-value="input.boundChoice"
        density="compact"
        variant="outlined"
        hide-details
        data-testid="tester-aircraft"
        @update:model-value="input.chooseBound(String($event ?? ''))"
      />
      <div class="rr-row-main">
        <div v-if="input.boundError" class="rr-warn" data-testid="bound-error">
          {{ input.boundError }}
        </div>
        <div v-else-if="!lastBound" class="rr-muted">
          Choose an aircraft or a game to see what each control you press is bound to.
        </div>
        <div v-else-if="!lastBound.control" class="rr-muted" data-testid="bound-waiting">
          Press a button or move an axis to see what it does in {{ lastBound.aircraft }}.
        </div>
        <template v-else>
          <div class="rr-row-title" data-testid="bound-control" :data-input="lastBound.input">
            {{ lastBound.control }}
          </div>
          <div v-if="lastBound.actions.length === 0" class="rr-muted" data-testid="bound-none">
            Nothing is bound to it in {{ lastBound.aircraft }}.
          </div>
          <ul v-else class="bound-actions">
            <li v-for="(a, i) in lastBound.actions" :key="i" data-testid="bound-action">
              <strong>{{ a.action }}</strong>
              <span v-if="a.modifiers.length" class="rr-muted">
                with {{ a.modifiers.join(' + ') }}</span
              >
              <span v-if="a.category.length" class="rr-muted"> · {{ a.category.join(' · ') }}</span>
              <span class="bound-chip">{{
                a.source === 'user'
                  ? 'Yours'
                  : `${lastBound.gameName.replace(/ World$/, '')} default`
              }}</span>
            </li>
          </ul>
          <div v-if="lastBound.duplicate" class="rr-warn" data-testid="bound-duplicate">
            <v-icon icon="mdi-alert" size="16" /> This control does several things at once in
            {{ lastBound.aircraft }}. If that is not what you want, clear one of them on the
            bindings page.
          </div>
        </template>
      </div>
      <v-btn
        v-if="lastBound?.route"
        size="small"
        variant="text"
        prepend-icon="mdi-open-in-app"
        :to="lastBound.route"
        data-testid="bound-open"
        >Open its bindings</v-btn
      >
    </div>

    <div class="tester-grid">
      <div>
        <div
          v-if="input.ready && input.devices.length === 0 && !input.error"
          class="rr-panel rr-empty"
          data-testid="tester-empty"
        >
          No game controllers are connected.
        </div>
        <div v-else-if="current" class="rr-panel tester-single">
          <div class="d-flex align-center mb-3">
            <div>
              <div class="rr-row-title tester-title">{{ name(current.index) }}</div>
              <div class="rr-row-sub rr-mono">{{ current.guid }}</div>
            </div>
            <v-spacer />
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-view-list"
              @click="select(undefined)"
              >All controllers</v-btn
            >
          </div>
          <ControllerView :device="current" :raw="raw" />
        </div>
        <div v-else-if="selected !== undefined" class="rr-panel rr-empty">
          That controller is not connected any more.
          <v-btn variant="text" @click="select(undefined)">Show all controllers</v-btn>
        </div>
        <div v-else class="rr-panel" data-testid="tester-all-list">
          <CompactController
            v-for="d in input.devices"
            :key="d.index"
            :device="d"
            :name="name(d.index)"
            :recent="recent(d.index)"
            @open="select(d.index)"
          />
        </div>
      </div>

      <aside class="rr-panel tester-log">
        <div class="d-flex align-center tester-log-head">
          <h2 class="rr-section-title mb-0">Activity</h2>
          <v-spacer />
          <v-btn
            size="small"
            variant="text"
            :disabled="entries.length === 0"
            data-testid="tester-clear"
            @click="input.clearLog()"
            >Clear</v-btn
          >
        </div>
        <ol class="tester-log-list" data-testid="tester-log">
          <li v-for="e in entries" :key="e.id" :class="`log-${e.kind}`" data-testid="log-entry">
            <span class="rr-mono rr-muted">{{ time(e.time) }}</span>
            <span>
              <span v-if="selected === undefined" class="rr-muted">{{ e.device }} · </span
              >{{ e.text }}
            </span>
          </li>
        </ol>
        <p v-if="entries.length === 0" class="rr-muted tester-log-empty">
          Presses, releases and axis movements appear here, newest first.
        </p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.tester-bar {
  margin-bottom: 12px;
}
.tester-chips :deep(.v-chip) {
  font-size: 12.5px;
}
.tester-chips :deep(.tester-chip-on) {
  border-color: var(--rr-accent);
  color: var(--rr-accent);
}
.tester-chips :deep(.tester-chip-live) {
  background: color-mix(in srgb, var(--rr-accent) 18%, transparent);
}
.tester-last {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  margin-bottom: 16px;
  font-size: 13.5px;
}
.tester-bound {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: 13.5px;
}
.tester-aircraft {
  flex: 0 0 260px;
}
.bound-actions {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
}
.bound-actions li {
  padding: 2px 0;
}
.bound-chip {
  margin-left: 8px;
  font-size: 11.5px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--rr-border);
  color: var(--rr-muted);
  white-space: nowrap;
}
.tester-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}
.tester-single {
  padding: 16px;
}
.tester-title {
  font-size: 15px;
}
.tester-log {
  padding: 12px 0 8px;
  position: sticky;
  top: 72px;
  max-height: calc(100vh - 100px);
  display: flex;
  flex-direction: column;
}
.tester-log-head {
  padding: 0 12px 6px 16px;
}
.tester-log-list {
  list-style: none;
  margin: 0;
  padding: 0 16px;
  overflow-y: auto;
  font-size: 12.5px;
}
.tester-log-list li {
  display: grid;
  grid-template-columns: 92px 1fr;
  gap: 8px;
  padding: 3px 0;
  border-top: 1px solid var(--rr-border);
}
.tester-log-list li:first-child {
  border-top: none;
}
.tester-log-empty {
  font-size: 12.5px;
  padding: 0 16px;
  margin: 0;
}
</style>
