<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { onMachineChanged } from '../../../renderer/machine';
import { GUIDE_GAMES, type GuideGame } from '../core/pack';
import AiTab from './AiTab.vue';
import IracingBindDialog from './IracingBindDialog.vue';
import PayloadDialog from './PayloadDialog.vue';
import PrioritiesTab from './PrioritiesTab.vue';
import ReviewDialog from './ReviewDialog.vue';
import WalkthroughTab from './WalkthroughTab.vue';
import { useAssistantStore } from './assistantStore';
import { useAiStore } from './store';

const store = useAiStore();
const assistant = useAssistantStore();
const route = useRoute();
const router = useRouter();

/** The game the address asks for (?game=iracing), when it names one. */
const asked = (): GuideGame | undefined => {
  const wanted = String(route.query['game'] ?? '');
  return (GUIDE_GAMES as readonly string[]).includes(wanted) ? (wanted as GuideGame) : undefined;
};

/** The games found on this PC, for the picker; the one shown even when it is not here. */
const gameItems = computed(() =>
  store.games
    .filter((g) => g.available || g.id === store.game)
    .map((g) => ({ title: g.name, value: g.id }))
);
const iracing = computed(() => store.game === 'iracing');

/** The address keeps the game; the watch below follows it, so a link and the picker agree. */
function chooseGame(id: GuideGame): void {
  if (asked() === id) void store.selectGame(id);
  else void router.replace({ path: route.path, query: { ...route.query, game: id } });
}

const tabs = computed(() => [
  { id: 'walkthrough', title: 'Walkthrough' },
  { id: 'priorities', title: 'Priorities' },
  ...(store.aiReady ? [{ id: 'ai', title: 'AI help' }] : []),
]);

const tab = computed(() => {
  const wanted = String(route.params['tab'] ?? '');
  return tabs.value.some((t) => t.id === wanted) ? wanted : 'walkthrough';
});

function go(id: string): void {
  void router.push({ path: `/configure/ai-assist/${id}`, query: route.query });
}

watch([tab, () => store.aircraftId], () => window.scrollTo({ top: 0 }));
// A link that names another game (?game=dcs) while the page is open switches to it.
watch(
  () => route.query['game'],
  () => {
    const wanted = asked();
    if (wanted && wanted !== store.game) void store.selectGame(wanted);
  }
);

const aircraftItems = computed(() =>
  (store.list?.aircraft ?? []).map((a) => ({
    title: a.name,
    value: a.id,
    subtitle: a.uses
      ? `Uses the ${a.uses} guide`
      : a.guide === 'shipped'
        ? 'Guide included'
        : a.guide === 'drafted'
          ? 'Guide drafted by AI'
          : a.guide === 'own'
            ? 'Your own guide'
            : 'No guide yet',
  }))
);

const staged = computed(() => store.guide?.staged ?? []);
/** iRacing lists cars with controls of their own after the classes. */
const hasCars = computed(() =>
  (store.list?.aircraft ?? []).some((a) => a.id.startsWith('iracing:car:'))
);
/** Where the iRacing bindings shown are kept, in words. */
const iracingWhere = computed(() => {
  const i = store.guide?.iracing;
  if (!i) return '';
  const set =
    i.setName === 'All cars' ? 'the bindings for all cars' : `the bindings of ${i.setName}`;
  return i.profile ? `${set}, in iRacing’s control profile “${i.profile}”` : set;
});
let off: (() => void) | undefined;
let offPress: (() => void) | undefined;
let offProgress: (() => void) | undefined;
onMounted(() => {
  void store.load(asked());
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
        <p v-if="iracing" class="rr-page-sub">
          For iRacing: what matters in each class of car, in plain language and in priority order,
          and a walkthrough that binds it with you.
        </p>
        <p v-else-if="store.game === 'dcs'" class="rr-page-sub">
          For DCS World: what matters in each aircraft, in plain language and in priority order, and
          a walkthrough that binds it with you.
        </p>
        <p v-else class="rr-page-sub">
          For DCS World and iRacing: what matters in each aircraft or class of car, in plain
          language and in priority order, and a walkthrough that binds it with you.
        </p>
        <v-btn
          v-if="store.aiReady"
          size="small"
          variant="text"
          prepend-icon="mdi-message-processing-outline"
          data-testid="ai-open-assistant"
          @click="assistant.open = true"
          >Ask the assistant about anything else</v-btn
        >
      </div>
      <div class="guide-pickers">
        <v-select
          v-if="gameItems.length > 0"
          class="guide-game"
          label="Game"
          :items="gameItems"
          :model-value="store.game"
          data-testid="ai-game"
          @update:model-value="chooseGame($event as GuideGame)"
        />
        <v-select
          v-if="aircraftItems.length > 0"
          class="guide-aircraft"
          :label="iracing ? (hasCars ? 'Class or car' : 'Car class') : 'Aircraft'"
          :items="aircraftItems"
          item-props
          :model-value="store.aircraftId"
          data-testid="ai-aircraft"
          @update:model-value="store.selectAircraft(String($event))"
        />
      </div>
    </div>

    <v-alert v-if="store.error" type="error" variant="tonal" class="mb-4" data-testid="ai-error">
      {{ store.error }}
    </v-alert>

    <PageSkeleton v-if="store.loading" label="Reading the games’ bindings…" />

    <div v-else-if="!store.game" class="rr-panel rr-empty" data-testid="ai-no-game">
      <v-icon icon="mdi-controller-off" size="36" class="mb-3" />
      <div class="rr-row-title">Neither DCS World nor iRacing was found on this PC</div>
      <div class="rr-row-sub">
        The binding guide works on the games’ own lists of actions. Install one of them and start it
        once.
      </div>
    </div>

    <div
      v-else-if="store.list && !store.list.available && !iracing"
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
      v-else-if="store.list && !store.list.available && iracing"
      class="rr-panel rr-empty"
      data-testid="ai-no-iracing"
    >
      <v-icon icon="mdi-steering-off" size="36" class="mb-3" />
      <div class="rr-row-title">iRacing was not found on this PC</div>
      <div class="rr-row-sub">
        The binding guide works on iRacing's own list of actions. Install iRacing and set up your
        controls in it once.
      </div>
    </div>

    <div
      v-else-if="store.list && iracing && store.list.problem"
      class="rr-panel rr-empty"
      data-testid="ai-iracing-unread"
    >
      <v-icon icon="mdi-steering" size="36" class="mb-3" />
      <div class="rr-row-title">iRacing's bindings cannot be read yet</div>
      <div class="rr-row-sub">{{ store.list.problem }}</div>
    </div>

    <div
      v-else-if="store.list && store.list.aircraft.length === 0"
      class="rr-panel rr-empty"
      data-testid="ai-no-aircraft"
    >
      DCS's input files for an aircraft were not found.
    </div>

    <template v-else-if="store.guide">
      <div v-if="store.guide.iracing" class="guide-iracing" data-testid="ai-iracing-where">
        <p class="guide-iracing-line">
          <v-icon icon="mdi-steering" size="16" class="rr-muted" />
          This guide works on {{ iracingWhere }}.
          <router-link
            :to="{ path: '/configure/iracing-bindings', query: { set: store.guide.iracing.set } }"
            data-testid="ai-iracing-page"
          >
            See them all
          </router-link>
        </p>
        <p
          v-if="store.guide.guide?.suggested"
          class="guide-iracing-line"
          data-testid="ai-iracing-suggested"
        >
          <v-icon icon="mdi-lightbulb-on-outline" size="16" class="rr-muted" />
          RigReady uses the {{ store.guide.guide.suggested.className }} guide here, because the
          car's folder name has “{{ store.guide.guide.suggested.token }}” in it. A guide of your own
          for this car takes its place.
        </p>
        <v-alert
          v-if="store.guide.iracing.simRunning"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3"
          data-testid="ai-iracing-running"
        >
          iRacing is running. It writes its bindings when it closes, so RigReady saves nothing until
          then, and a binding changed in iRacing shows here once it has closed.
        </v-alert>
        <p
          v-for="(note, n) in store.guide.iracing.notes"
          :key="n"
          class="guide-iracing-line rr-muted"
        >
          {{ note }}
        </p>
      </div>

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
          v-if="store.status && !store.aiReady"
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

    <div v-if="store.iracingSaved" class="guide-saved rr-panel" data-testid="ai-iracing-saved">
      <v-icon icon="mdi-check" size="18" class="rr-ok" />
      <span class="guide-saved-text">{{ store.iracingSaved }}</span>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-shield-check-outline"
        to="/configure/safety"
        data-testid="ai-iracing-safety"
      >
        Open the Safety page
      </v-btn>
      <v-btn
        icon="mdi-close"
        size="x-small"
        variant="text"
        aria-label="Dismiss"
        @click="store.iracingSaved = undefined"
      />
    </div>

    <ReviewDialog />
    <PayloadDialog />
    <IracingBindDialog />
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
.guide-pickers {
  display: flex;
  gap: 12px;
  flex: 0 0 auto;
}
.guide-game {
  flex: 0 0 160px;
}
.guide-aircraft {
  flex: 0 0 280px;
}
.guide-iracing {
  margin: -4px 0 12px;
}
.guide-iracing-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 8px;
  font-size: 13.5px;
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
