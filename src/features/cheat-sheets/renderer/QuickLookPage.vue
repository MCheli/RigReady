<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { onMachineChanged } from '../../../renderer/machine';
import { CATEGORIES } from '../core/categories';
import { kindsOn } from '../core/pages';
import { actionIndex } from '../core/sheet';
import SheetView from './SheetView.vue';
import { useCheatSheets } from './store';

/**
 * Quick look: just the sheet, filling the window, for a glance while flying. It follows
 * the device you touch and answers "which control does X?" from its search box. Opened
 * in the main window or popped out as a small window that stays on top.
 */
const store = useCheatSheets();
const route = useRoute();
const router = useRouter();

const popped = computed(() => route.query['popped'] === '1');
const search = ref('');
const error = ref('');
const device = computed(() => store.device);
const needle = computed(() => search.value.trim().toLowerCase());

const pressed = computed(() =>
  device.value?.guid ? (store.pressed.get(device.value.guid) ?? []) : []
);
const axes = computed(() => (device.value?.guid ? (store.axes.get(device.value.guid) ?? {}) : {}));

/** "I want to do X": the actions that match, with where they are. */
const answers = computed(() => {
  if (!store.sheet || needle.value.length < 2) return [];
  return actionIndex(store.sheet)
    .filter((entry) =>
      [entry.action, ...entry.category].join(' ').toLowerCase().includes(needle.value)
    )
    .slice(0, 8);
});
const keep = computed(() => {
  if (answers.value.length === 0 || !device.value) return undefined;
  const ids = new Set<string>();
  for (const entry of answers.value) {
    for (const place of entry.places)
      if (place.deviceKey === device.value.key) ids.add(place.control);
  }
  return ids;
});

function show(deviceKey: string): void {
  store.deviceKey = deviceKey;
}

async function popOut(): Promise<void> {
  error.value = '';
  const result = await store.api.popOut({
    game: store.game,
    aircraftId: store.aircraftId,
    ...(device.value ? { deviceKey: device.value.key } : {}),
  });
  if (!result.ok) error.value = result.error.message;
}

function back(): void {
  void router.push({
    path: '/configure/cheat-sheets',
    query: { game: store.game, aircraft: store.aircraftId, device: device.value?.key ?? '' },
  });
}

let offMachine: (() => void) | undefined;
onMounted(async () => {
  const game = typeof route.query['game'] === 'string' ? route.query['game'] : '';
  const aircraft = typeof route.query['aircraft'] === 'string' ? route.query['aircraft'] : '';
  await store.load(game && aircraft ? `${game}/${aircraft}` : undefined);
  const wanted = route.query['device'];
  if (typeof wanted === 'string' && store.sheet?.devices.some((d) => d.key === wanted)) {
    store.deviceKey = wanted;
  }
  offMachine = onMachineChanged(() => void store.refresh());
  await store.acquire();
});
onBeforeUnmount(() => {
  offMachine?.();
  void store.release();
});
</script>

<template>
  <div
    class="ql"
    data-testid="quick-look"
    :data-popped="popped"
    :data-live="store.watching"
    :data-ready="store.loaded && !store.loading"
  >
    <div class="ql-bar">
      <v-select
        class="ql-aircraft"
        :items="store.aircraftItems"
        :model-value="store.choice"
        density="compact"
        variant="outlined"
        hide-details
        data-testid="quick-aircraft"
        @update:model-value="store.choose(String($event))"
      />
      <v-select
        class="ql-device"
        :items="(store.sheet?.devices ?? []).map((d) => ({ title: d.title, value: d.key }))"
        :model-value="device?.key"
        density="compact"
        variant="outlined"
        hide-details
        data-testid="quick-device"
        @update:model-value="show(String($event))"
      />
      <v-text-field
        v-model="search"
        class="ql-search"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        prepend-inner-icon="mdi-magnify"
        placeholder="Which control does…"
        data-testid="quick-search"
        @click:clear="search = ''"
      />
      <v-checkbox
        v-model="store.follow"
        label="Follow my hands"
        density="compact"
        hide-details
        class="flex-grow-0"
        data-testid="quick-follow"
      />
      <v-spacer />
      <v-btn
        v-if="!popped"
        size="small"
        variant="tonal"
        prepend-icon="mdi-dock-window"
        data-testid="quick-popout"
        @click="popOut"
        >Pop out</v-btn
      >
      <v-btn
        v-if="!popped"
        size="small"
        variant="text"
        prepend-icon="mdi-arrow-left"
        data-testid="quick-back"
        @click="back"
        >Full page</v-btn
      >
    </div>

    <div v-if="store.error || error" class="ql-note rr-warn" data-testid="quick-error">
      {{ store.error || error }}
    </div>

    <div v-if="answers.length > 0" class="ql-answers" data-testid="quick-answers">
      <div
        v-for="entry in answers"
        :key="entry.actionId"
        class="ql-answer"
        data-testid="quick-answer"
      >
        <i :style="{ background: CATEGORIES[entry.kind].color }"></i>
        <span class="ql-answer-action">{{ entry.action }}</span>
        <button
          v-for="(place, i) in entry.places"
          :key="i"
          type="button"
          class="ql-place"
          @click="show(place.deviceKey)"
        >
          {{ place.device }} ·
          <span v-if="place.modifiers.length">{{ place.modifiers.join('+') }} + </span>
          <strong>{{ place.physical ?? place.controlName }}</strong>
        </button>
      </div>
    </div>
    <div v-else-if="needle.length >= 2" class="ql-note rr-muted" data-testid="quick-no-answer">
      Nothing bound matches “{{ search }}”.
    </div>

    <div class="ql-last" data-testid="quick-last" :data-last="store.lastPress?.control ?? ''">
      <template v-if="store.lastPress">
        <span class="rr-muted">{{ store.lastPress.device }} · {{ store.lastPress.name }}</span>
        <strong>{{ store.lastPress.actions.join(' / ') || 'nothing bound' }}</strong>
        <em v-if="store.lastPress.note">{{ store.lastPress.note }}</em>
      </template>
      <span v-else class="rr-muted">Press a control to see what it does.</span>
    </div>

    <div v-if="device" class="ql-sheet">
      <SheetView
        :device="device"
        :show-empty="false"
        :pressed="pressed"
        :axes="axes"
        :keep="keep"
      />
      <div class="ql-legend">
        <span v-for="id in kindsOn(device)" :key="id" class="ql-chip">
          <i :style="{ background: CATEGORIES[id].color }"></i>{{ CATEGORIES[id].label }}
        </span>
      </div>
    </div>
    <div
      v-else-if="store.loaded && !store.loading"
      class="ql-note rr-muted"
      data-testid="quick-empty"
    >
      There is no sheet to show: no game whose bindings RigReady can read was found.
    </div>
  </div>
</template>

<style scoped>
/* Fills the whole window, over the app's own navigation: this view is only the sheet. */
.ql {
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: var(--rr-bg);
  overflow-y: auto;
  padding: 10px 12px 14px;
}
.ql-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.ql-aircraft {
  max-width: 190px;
  min-width: 150px;
}
.ql-device {
  max-width: 250px;
  min-width: 160px;
}
.ql-search {
  max-width: 230px;
  min-width: 150px;
}
.ql-note {
  font-size: 13px;
  margin: 6px 2px;
}
.ql-answers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.ql-answer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
}
.ql-answer i,
.ql-chip i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}
.ql-answer-action {
  font-weight: 600;
}
.ql-place {
  font-size: 12.5px;
  color: var(--rr-text);
  background: var(--rr-surface-2);
  border: 1px solid var(--rr-border);
  border-radius: 7px;
  padding: 2px 8px;
  cursor: pointer;
}
.ql-last {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-height: 34px;
  padding: 6px 10px;
  margin-bottom: 8px;
  border-radius: 8px;
  background: var(--rr-surface);
  border: 1px solid var(--rr-border);
  font-size: 13px;
}
.ql-last strong {
  font-size: 16px;
  color: var(--rr-accent);
}
.ql-last em {
  color: var(--rr-accent);
}
.ql-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 8px;
  font-size: 12px;
}
.ql-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
</style>
