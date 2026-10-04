<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import { onMachineChanged } from '../../../renderer/machine';
import ActionsTab from './ActionsTab.vue';
import BindDialog from './BindDialog.vue';
import CopyTab from './CopyTab.vue';
import DeviceIdsTab from './DeviceIdsTab.vue';
import DevicesTab from './DevicesTab.vue';
import OverviewTab from './OverviewTab.vue';
import PlanDialog from './PlanDialog.vue';
import ProblemsTab from './ProblemsTab.vue';
import SnapshotsTab from './SnapshotsTab.vue';
import { useBindingsStore } from './store';

const store = useBindingsStore();
const route = useRoute();
const router = useRouter();

const TABS = [
  { id: 'overview', title: 'Overview' },
  { id: 'devices', title: 'Devices' },
  { id: 'actions', title: 'Actions' },
  { id: 'problems', title: 'Problems' },
  { id: 'device-ids', title: 'Device IDs' },
  { id: 'copy', title: 'Copy' },
  { id: 'snapshots', title: 'Snapshots' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const tab = computed<TabId>(() => {
  const wanted = String(route.params['tab'] ?? '');
  return TABS.some((t) => t.id === wanted) ? (wanted as TabId) : 'overview';
});

// A new tab or aircraft starts at the top of the page.
watch([tab, () => store.aircraftId], () => window.scrollTo({ top: 0 }));

function go(id: string): void {
  void router.push({ path: `/configure/dcs-bindings/${id}`, query: route.query });
}

const problemCount = computed(() => {
  const p = store.view?.problems;
  if (!p) return 0;
  return (
    p.inputConflicts.length +
    p.actionDuplicates.filter((d) => !d.expected).length +
    p.unwantedDefaults.length +
    p.importantUnbound.length
  );
});

const aircraftItems = computed(() =>
  (store.overview?.aircraft ?? []).map((a) => ({
    title: a.name,
    value: a.id,
    subtitle:
      a.userFiles > 0
        ? `${a.userFiles} binding ${a.userFiles === 1 ? 'file' : 'files'}`
        : 'DCS defaults only',
  }))
);

/** A link from another page names the aircraft (and device) to open on; unknown ids are ignored. */
async function openFromRoute(): Promise<void> {
  const wanted = route.query['aircraft'];
  if (typeof wanted === 'string' && store.overview?.aircraft.some((a) => a.id === wanted)) {
    await store.selectAircraft(wanted);
  }
}
watch(
  () => route.query['aircraft'],
  () => void openFromRoute()
);

let off: (() => void) | undefined;
onMounted(() => {
  void store.load().then(openFromRoute);
  off = onMachineChanged(() => void store.load());
});
onBeforeUnmount(() => off?.());
</script>

<template>
  <div class="rr-page bind-page" data-testid="bindings-page">
    <div class="bind-head">
      <div>
        <h1 class="rr-page-title">DCS bindings</h1>
        <p class="rr-page-sub">
          What every control does in each aircraft: DCS's defaults plus your own changes.
        </p>
      </div>
      <v-select
        v-if="aircraftItems.length > 0"
        class="bind-aircraft"
        label="Aircraft"
        :items="aircraftItems"
        item-props
        :model-value="store.aircraftId"
        data-testid="bindings-aircraft"
        @update:model-value="store.selectAircraft(String($event))"
      />
    </div>

    <v-alert v-if="store.error" type="error" variant="tonal" class="mb-4" data-testid="bind-error">
      {{ store.error }}
    </v-alert>

    <div v-if="store.loading" class="rr-panel rr-empty" data-testid="bind-loading">
      Reading DCS's input files…
    </div>

    <NotOnThisPc
      v-else-if="store.overview && !store.overview.found && store.overview.aircraft.length === 0"
      name="DCS World"
      :looked="['every Steam library', 'the standalone install folders', 'Saved Games\\DCS']"
      game-page="/configure/games/dcs"
      data-testid="bind-not-found"
    />

    <template v-else-if="store.overview">
      <v-alert
        v-if="store.overview.dcsRunning"
        type="warning"
        variant="tonal"
        class="mb-4"
        data-testid="bind-dcs-running"
      >
        DCS is running. You can look around, but nothing can be saved until it is closed: DCS would
        overwrite the change.
      </v-alert>
      <v-alert
        v-if="store.overview.staleDeviceIds > 0 && tab !== 'device-ids'"
        type="warning"
        variant="tonal"
        class="mb-4"
        data-testid="bind-stale-ids"
      >
        <div class="bind-alert-row">
          <span>
            Bindings for
            {{
              store.overview.staleDeviceIds === 1
                ? 'one device belong'
                : `${store.overview.staleDeviceIds} devices belong`
            }}
            to an old device ID, so DCS does not use them. Windows gives a device a new ID after a
            reinstall or driver reset.
          </span>
          <v-btn
            size="small"
            variant="tonal"
            data-testid="bind-open-device-ids"
            @click="go('device-ids')"
          >
            Fix device IDs
          </v-btn>
        </div>
      </v-alert>

      <v-tabs
        :model-value="tab"
        density="comfortable"
        color="primary"
        class="bind-tabs"
        data-testid="bind-tabs"
        @update:model-value="go(String($event))"
      >
        <v-tab v-for="t in TABS" :key="t.id" :value="t.id" :data-testid="`bind-tab-${t.id}`">
          {{ t.title }}
          <span
            v-if="t.id === 'problems' && problemCount > 0"
            class="bind-count rr-warn"
            data-testid="bind-problem-count"
          >
            {{ problemCount }}
          </span>
          <span
            v-if="t.id === 'device-ids' && store.overview.staleDeviceIds > 0"
            class="bind-count rr-warn"
          >
            {{ store.overview.staleDeviceIds }}
          </span>
        </v-tab>
      </v-tabs>

      <DeviceIdsTab v-if="tab === 'device-ids'" />
      <SnapshotsTab v-else-if="tab === 'snapshots'" />
      <template v-else-if="store.view">
        <OverviewTab v-if="tab === 'overview'" @open="go" />
        <DevicesTab v-else-if="tab === 'devices'" />
        <ActionsTab v-else-if="tab === 'actions'" />
        <ProblemsTab v-else-if="tab === 'problems'" />
        <CopyTab v-else-if="tab === 'copy'" />
      </template>
      <div v-else-if="!store.error" class="rr-panel rr-empty" data-testid="bind-no-aircraft">
        DCS's input files for an aircraft were not found, and there are no binding files yet.
      </div>
    </template>

    <!-- Staged edits wait here until they are reviewed and saved together. -->
    <div v-if="store.staged.length > 0" class="bind-staged rr-panel" data-testid="bind-staged">
      <div class="bind-staged-main">
        <div class="rr-row-title">
          {{ store.staged.length }} staged {{ store.staged.length === 1 ? 'change' : 'changes' }},
          not saved yet
        </div>
        <div class="bind-staged-list">
          <div
            v-for="change in store.staged"
            :key="change.id"
            class="bind-staged-item"
            data-testid="bind-staged-item"
          >
            <span>{{ change.text }}</span>
            <v-btn
              icon="mdi-close"
              size="x-small"
              variant="text"
              density="compact"
              aria-label="Drop this change"
              data-testid="bind-unstage"
              @click="store.unstage(change.id)"
            />
          </div>
        </div>
      </div>
      <v-btn variant="text" data-testid="bind-discard" @click="store.staged = []">Discard</v-btn>
      <v-btn color="primary" data-testid="bind-review" @click="store.reviewStaged()">
        Review and save
      </v-btn>
    </div>

    <div v-if="store.saved" class="bind-saved rr-panel" data-testid="bind-saved">
      <v-icon
        :icon="store.saved.undone ? 'mdi-undo' : 'mdi-check'"
        size="18"
        :class="store.saved.undone ? 'rr-muted' : 'rr-ok'"
      />
      <span class="bind-saved-text">
        <template v-if="store.saved.undone">Undone: {{ store.saved.summary }}</template>
        <template v-else>
          Saved: {{ store.saved.summary }} ({{ store.saved.files }}
          {{ store.saved.files === 1 ? 'file' : 'files' }}, backed up first)
        </template>
      </span>
      <v-btn
        v-if="!store.saved.undone"
        size="small"
        variant="tonal"
        prepend-icon="mdi-undo"
        data-testid="bind-undo"
        @click="store.undoSaved()"
      >
        Undo
      </v-btn>
      <v-btn
        icon="mdi-close"
        size="x-small"
        variant="text"
        aria-label="Dismiss"
        data-testid="bind-saved-dismiss"
        @click="store.saved = undefined"
      />
    </div>

    <PlanDialog />
    <BindDialog />
  </div>
</template>

<style scoped>
.bind-page {
  max-width: 1120px;
  padding-bottom: 140px;
}
.bind-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}
.bind-aircraft {
  flex: 0 0 280px;
}
.bind-alert-row {
  display: flex;
  align-items: center;
  gap: 16px;
  justify-content: space-between;
}
.bind-tabs {
  margin-bottom: 20px;
  border-bottom: 1px solid var(--rr-border);
}
.bind-count {
  margin-left: 8px;
  min-width: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--rr-surface-2);
  border: 1px solid var(--rr-border);
  font-size: 11.5px;
  line-height: 18px;
}
.bind-staged,
.bind-saved {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 20px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  width: min(760px, calc(100vw - 320px));
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  background: var(--rr-surface-2);
}
.bind-saved {
  bottom: 20px;
}
.bind-staged + .bind-saved {
  bottom: 132px;
}
.bind-staged-main {
  flex: 1;
  min-width: 0;
}
.bind-staged-list {
  max-height: 72px;
  overflow-y: auto;
  margin-top: 2px;
}
.bind-staged-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.bind-saved-text {
  flex: 1;
  font-size: 13.5px;
}
</style>
