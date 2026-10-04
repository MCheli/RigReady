<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { onMachineChanged } from '../../../renderer/machine';
import AiTab from './AiTab.vue';
import PayloadDialog from './PayloadDialog.vue';
import PrioritiesTab from './PrioritiesTab.vue';
import ReviewDialog from './ReviewDialog.vue';
import WalkthroughTab from './WalkthroughTab.vue';
import { useAiStore } from './store';

const store = useAiStore();
const route = useRoute();
const router = useRouter();

const tabs = computed(() => [
  { id: 'walkthrough', title: 'Walkthrough' },
  { id: 'priorities', title: 'Priorities' },
  ...(store.keyPresent ? [{ id: 'ai', title: 'AI help' }] : []),
]);

const tab = computed(() => {
  const wanted = String(route.params['tab'] ?? '');
  return tabs.value.some((t) => t.id === wanted) ? wanted : 'walkthrough';
});

function go(id: string): void {
  void router.push({ path: `/configure/ai-assist/${id}`, query: route.query });
}

watch([tab, () => store.aircraftId], () => window.scrollTo({ top: 0 }));

const aircraftItems = computed(() =>
  (store.list?.aircraft ?? []).map((a) => ({
    title: a.name,
    value: a.id,
    subtitle:
      a.guide === 'shipped'
        ? 'Guide included'
        : a.guide === 'drafted'
          ? 'Guide drafted by AI'
          : 'No guide yet',
  }))
);

const staged = computed(() => store.guide?.staged ?? []);

let off: (() => void) | undefined;
let offPress: (() => void) | undefined;
let offProgress: (() => void) | undefined;
onMounted(() => {
  void store.load();
  off = onMachineChanged(() => void store.load());
  offPress = store.api.on('pressed', (press) => void store.pressed(press));
  offProgress = store.api.on('sendProgress', (update) => store.progressed(update));
});
onBeforeUnmount(() => {
  off?.();
  offPress?.();
  offProgress?.();
  if (store.listeningFor) void store.stopListening();
});
</script>

<template>
  <div class="rr-page guide-page" data-testid="ai-guide-page">
    <div class="guide-head">
      <div>
        <h1 class="rr-page-title">Binding guide</h1>
        <p class="rr-page-sub">
          What matters in each aircraft, in plain language and in priority order, and a walkthrough
          that binds it with you.
        </p>
      </div>
      <v-select
        v-if="aircraftItems.length > 0"
        class="guide-aircraft"
        label="Aircraft"
        :items="aircraftItems"
        item-props
        :model-value="store.aircraftId"
        data-testid="ai-aircraft"
        @update:model-value="store.selectAircraft(String($event))"
      />
    </div>

    <v-alert v-if="store.error" type="error" variant="tonal" class="mb-4" data-testid="ai-error">
      {{ store.error }}
    </v-alert>

    <div v-if="store.loading" class="rr-panel rr-empty">Reading DCS's input files…</div>

    <div
      v-else-if="store.list && !store.list.available"
      class="rr-panel rr-empty"
      data-testid="ai-no-dcs"
    >
      <v-icon icon="mdi-airplane-off" size="36" class="mb-3" />
      <div class="rr-row-title">DCS World was not found on this PC</div>
      <div class="rr-row-sub">
        The binding guide works on DCS's own list of actions. Install DCS and start it once.
      </div>
    </div>

    <div
      v-else-if="store.list && store.list.aircraft.length === 0"
      class="rr-panel rr-empty"
      data-testid="ai-no-aircraft"
    >
      DCS's input files for an aircraft were not found.
    </div>

    <template v-else-if="store.guide">
      <div class="guide-tabbar">
        <v-tabs
          :model-value="tab"
          density="comfortable"
          color="primary"
          class="guide-tabs"
          data-testid="ai-tabs"
          @update:model-value="go(String($event))"
        >
          <v-tab v-for="t in tabs" :key="t.id" :value="t.id" :data-testid="`ai-tab-${t.id}`">
            {{ t.title }}
          </v-tab>
        </v-tabs>
        <router-link
          v-if="store.status && !store.keyPresent"
          to="/configure/settings"
          class="guide-setup-ai"
          data-testid="ai-setup-link"
        >
          <v-icon icon="mdi-creation-outline" size="16" /> Set up AI help
        </router-link>
      </div>

      <WalkthroughTab v-if="tab === 'walkthrough'" @open="go" />
      <PrioritiesTab v-else-if="tab === 'priorities'" />
      <AiTab v-else-if="tab === 'ai'" />
    </template>

    <div v-if="staged.length > 0" class="guide-staged rr-panel" data-testid="ai-staged">
      <div class="guide-staged-main">
        <div class="rr-row-title">
          {{ staged.length }} staged {{ staged.length === 1 ? 'change' : 'changes' }}, not written
          yet
        </div>
        <div class="guide-staged-list">
          <div
            v-for="change in staged"
            :key="change.id"
            class="guide-staged-item"
            data-testid="ai-staged-item"
          >
            <span>
              {{ change.label }} → {{ change.deviceName }} · {{ change.inputLabel }}
              <span v-if="change.replaces.length > 0" class="rr-warn">
                (replaces {{ change.replaces.join(', ') }})
              </span>
              <span v-if="change.clashesWith.length > 0" class="rr-bad">
                (same control as another staged change)
              </span>
            </span>
            <v-btn
              icon="mdi-close"
              size="x-small"
              variant="text"
              density="compact"
              aria-label="Drop this change"
              data-testid="ai-unstage"
              @click="store.unstage(change.id)"
            />
          </div>
        </div>
      </div>
      <v-btn variant="text" data-testid="ai-discard" @click="store.unstage()">Discard</v-btn>
      <v-btn color="primary" data-testid="ai-review" @click="store.reviewStaged()">
        Review and write
      </v-btn>
    </div>

    <div v-if="store.saved" class="guide-saved rr-panel" data-testid="ai-saved">
      <v-icon
        :icon="store.saved.undone ? 'mdi-undo' : 'mdi-check'"
        size="18"
        :class="store.saved.undone ? 'rr-muted' : 'rr-ok'"
      />
      <span class="guide-saved-text">
        <template v-if="store.saved.undone">Undone: {{ store.saved.summary }}</template>
        <template v-else>
          Written: {{ store.saved.summary }} ({{ store.saved.files }}
          {{ store.saved.files === 1 ? 'file' : 'files' }}, backed up first)
        </template>
      </span>
      <v-btn
        v-if="!store.saved.undone"
        size="small"
        variant="tonal"
        prepend-icon="mdi-undo"
        data-testid="ai-undo"
        @click="store.undoSaved()"
      >
        Undo
      </v-btn>
      <v-btn
        icon="mdi-close"
        size="x-small"
        variant="text"
        aria-label="Dismiss"
        @click="store.saved = undefined"
      />
    </div>

    <ReviewDialog />
    <PayloadDialog />
  </div>
</template>

<style scoped>
.guide-page {
  max-width: 1120px;
  padding-bottom: 150px;
}
.guide-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}
.guide-aircraft {
  flex: 0 0 280px;
}
.guide-tabbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--rr-border);
  margin-bottom: 20px;
}
.guide-setup-ai {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--rr-accent);
  text-decoration: none;
}
.guide-staged,
.guide-saved {
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
.guide-staged + .guide-saved {
  bottom: 132px;
}
.guide-staged-main {
  flex: 1;
  min-width: 0;
}
.guide-staged-list {
  max-height: 72px;
  overflow-y: auto;
  margin-top: 2px;
}
.guide-staged-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.guide-saved-text {
  flex: 1;
  font-size: 13.5px;
}
</style>
