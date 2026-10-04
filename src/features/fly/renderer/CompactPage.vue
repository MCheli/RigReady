<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { flyContract } from '../contract';
import ReadinessDial from './ReadinessDial.vue';
import SessionBanner from './SessionBanner.vue';
import { ACTION_LABEL, listenForEnter, useHeadline, usePrimary } from './primary';
import { useFlyStore, type LaunchOutcome } from './store';

/**
 * The compact view: the dial, the setup switcher and the one action, small enough for a
 * corner of the screen. It is the same Fly screen with everything else left out: what it
 * cannot ask in so little room (a program that needs an OK before it runs) it leaves to
 * the full window, and says so.
 */
const fly = useFlyStore();
const api = useClient(flyContract);
const route = useRoute();
/** Opened as the small window that stays on top, not as a page of the main window. */
const inPanel = computed(() => route.query['panel'] === '1');
const headline = useHeadline(fly);
const { now: primaryNow, shown: primary } = usePrimary(fly);

const setups = computed(() => fly.profiles.map((p) => ({ value: p.id, title: p.name })));
const toneClass = computed(
  () => ({ ok: 'rr-ok', warn: 'rr-warn', bad: 'rr-bad', idle: 'rr-muted' })[headline.value.tone]
);
const sessionKind = computed(() => fly.profiles.find((p) => p.id === fly.session.profileId)?.kind);

/**
 * A fix or a launch step that runs a program is shown before it runs, and there is no room
 * for that here: the action is then left to the full window.
 */
const needsOk = computed(() => {
  const fixes = fly.items.some((item) => {
    const result = fly.results[item.itemId];
    return (
      result !== undefined &&
      result.status !== 'pass' &&
      result.fixKind === 'action' &&
      result.confirm !== undefined
    );
  });
  const steps = (fly.view?.actions ?? []).some(
    (action) => action.phase !== 'standDown' && action.confirm !== undefined
  );
  if (primary.value === 'makeReady') return fixes;
  if (primary.value === 'readyAndLaunch') return fixes || steps;
  return primary.value === 'launch' && steps;
});

/** "Launch" was pressed on a rig that is not ready: the button asks once more. */
const asking = ref(false);
/** A step before launch failed and stops the launch unless the user goes on. */
const paused = ref<{ at: number; message: string }>();
/** Make ready and launch stopped: something required still needs the user. */
const held = computed(() => fly.activity?.stage === 'held' && fly.readiness === 'notReady');
const anyway = computed(() => asking.value || held.value || paused.value !== undefined);
watch(
  () => fly.readiness,
  () => (asking.value = false)
);

const openError = ref<string>();

/** One line of words above the button: what stands in the way, or what the last action came to. */
const line = computed(() => {
  if (fly.error) return { tone: 'rr-bad', text: fly.error };
  if (openError.value) return { tone: 'rr-bad', text: openError.value };
  if (needsOk.value) {
    return {
      tone: 'rr-warn',
      text: 'This setup runs a program that is shown to you first. That is done in the full window.',
    };
  }
  if (paused.value) return { tone: 'rr-warn', text: paused.value.message };
  if (asking.value || held.value) {
    const [first, ...more] = fly.counts.failing;
    if (!first) return undefined;
    const others = more.length > 0 ? ` and ${more.length} more` : '';
    return { tone: 'rr-warn', text: `Not ready: ${first.title} — ${first.summary}${others}` };
  }
  // What the last action came to; once the game has closed, "Welcome back" says what matters.
  if (fly.activity?.headline && fly.session.phase !== 'ended') {
    return { tone: 'rr-muted', text: fly.activity.headline };
  }
  return undefined;
});

interface ButtonLook {
  label: string;
  icon: string;
  color: string | undefined;
  variant: 'flat' | 'tonal';
}

/** The one button: what it says and how it looks. None while a game is running. */
const button = computed<ButtonLook | undefined>(() => {
  if (anyway.value) {
    return {
      label: 'Launch anyway',
      icon: 'mdi-rocket-launch',
      color: 'warning',
      variant: 'tonal',
    };
  }
  const action = primary.value;
  if (!action) return undefined;
  const icon = {
    readyAndLaunch: 'mdi-rocket-launch',
    makeReady: 'mdi-wrench-check',
    launch: 'mdi-rocket-launch',
    standDown: 'mdi-power-standby',
  }[action];
  if (action !== 'launch') {
    return { label: ACTION_LABEL[action], icon, color: 'primary', variant: 'flat' };
  }
  // Launch is green once the rig is known to be ready, and never before.
  const ready = fly.readiness === 'ready' || fly.readiness === 'warnings';
  return {
    label: ACTION_LABEL.launch,
    icon,
    color: ready ? 'success' : undefined,
    variant: ready ? 'flat' : 'tonal',
  };
});

/**
 * Whether Enter, with nothing focused, presses the button. Never "Launch anyway":
 * launching past something required is a click (or the button focused and pressed), as in
 * the full window, not one Enter after another. And not what is left to the full window.
 */
const onEnter = computed(() => button.value !== undefined && !anyway.value && !needsOk.value);

function took(outcome: LaunchOutcome): void {
  if (outcome.paused) paused.value = { at: outcome.paused.at, message: outcome.paused.message };
}

async function run(): Promise<void> {
  if (fly.busy !== null || needsOk.value) return;
  openError.value = undefined;
  if (paused.value) {
    const at = paused.value.at;
    paused.value = undefined;
    took(await fly.launch({ resumeAfter: at, approved: [] }));
    return;
  }
  if (held.value) {
    took(await fly.launch({ approved: [], keep: true }));
    return;
  }
  // It acts on answers: a checklist run under way is finished first.
  await fly.settled();
  if (fly.busy !== null) return;
  const action = primaryNow.value;
  if (action === 'readyAndLaunch') {
    took(await fly.readyAndLaunch({ approvedFixes: [], approvedActions: [] }));
  } else if (action === 'makeReady') {
    await fly.makeReady([]);
  } else if (action === 'standDown') {
    await fly.standDown(false);
  } else if (action === 'launch') {
    // Never past something required without the user saying so: the button asks once more.
    if (fly.readiness === 'notReady' && !asking.value) {
      asking.value = true;
      return;
    }
    asking.value = false;
    took(await fly.launch({ approved: [] }));
  }
}

function cancel(): void {
  asking.value = false;
  paused.value = undefined;
}

async function openMain(): Promise<void> {
  const shown = await api.showMain();
  openError.value = shown.ok ? undefined : errorText(shown.error);
}

// ---- lifecycle: the same watching as the Fly screen ----
let timer: ReturnType<typeof setInterval> | undefined;
const offs: (() => void)[] = [];
const refresh = (): void => {
  if (!fly.anyChecking && fly.busy === null) void fly.check(true);
};

onMounted(async () => {
  offs.push(
    onMachineChanged(refresh),
    listenForEnter(
      () => void run(),
      () => onEnter.value
    )
  );
  await fly.load();
  timer = setInterval(refresh, 5000);
  window.addEventListener('focus', refresh);
  // A setup edited by hand, or changed from the tray, shows up here too.
  offs.push(await fly.watch(() => void fly.load()));
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener('focus', refresh);
  for (const off of offs) off();
});
</script>

<template>
  <div
    class="compact"
    :class="inPanel ? 'compact-panel' : 'rr-page'"
    data-testid="fly-compact-page"
    :data-panel="inPanel"
  >
    <template v-if="!inPanel">
      <h1 class="rr-page-title">Compact view</h1>
      <p class="rr-page-sub">
        The dial, the setup and the one action, as they are shown in the small window that stays on
        top. <router-link to="/fly" data-testid="compact-back">Back to the Fly screen</router-link>
      </p>
    </template>

    <div v-if="!fly.loaded" class="compact-line rr-muted">Loading…</div>

    <div v-else-if="!fly.activeId" class="compact-empty" data-testid="compact-empty">
      <p>There is no setup to show yet. The first one is made on the Fly screen.</p>
      <v-btn
        v-if="inPanel"
        variant="tonal"
        prepend-icon="mdi-arrow-expand"
        data-testid="compact-open-main"
        @click="openMain"
      >
        Open the full window
      </v-btn>
      <v-btn v-else variant="tonal" to="/fly">Go to the Fly screen</v-btn>
      <div v-if="openError" class="compact-line rr-bad">{{ openError }}</div>
    </div>

    <div v-else class="compact-card" :class="{ 'rr-panel': !inPanel }">
      <div class="compact-top">
        <ReadinessDial
          :states="fly.dial.states"
          :met="fly.dial.met"
          :total="fly.dial.total"
          :tone="headline.tone"
          :checking="fly.anyChecking"
          :size="96"
          data-testid="compact-dial"
        />
        <div class="compact-main">
          <v-select
            :model-value="fly.activeId"
            :items="setups"
            aria-label="Setup"
            variant="plain"
            density="compact"
            class="compact-switcher"
            :menu-props="{ minWidth: 240 }"
            hide-details
            data-testid="compact-switcher"
            @update:model-value="fly.select($event)"
          />
          <div
            class="compact-state"
            :class="toneClass"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="compact-status"
          >
            <v-progress-circular
              v-if="headline.tone === 'idle'"
              indeterminate
              size="15"
              width="2"
              aria-label="Checking"
            />
            <v-icon v-else :icon="headline.icon" size="18" />
            <span data-testid="compact-status-title">{{ headline.title }}</span>
            <span v-if="headline.count !== undefined" class="compact-count"
              >({{ headline.count }})</span
            >
          </div>
          <div class="compact-sub" data-testid="compact-status-sub">{{ headline.sub }}</div>
        </div>
        <v-btn
          v-if="inPanel"
          icon="mdi-arrow-expand"
          size="x-small"
          variant="text"
          aria-label="Open the full window"
          title="Open the full window"
          data-testid="compact-open-main"
          @click="openMain"
        />
      </div>

      <SessionBanner :session="fly.session" :kind="sessionKind" compact />

      <div v-if="line" class="compact-line" :class="line.tone" data-testid="compact-line">
        {{ line.text }}
      </div>

      <v-btn
        v-if="button"
        block
        size="large"
        class="compact-primary"
        :color="button.color"
        :variant="button.variant"
        :prepend-icon="button.icon"
        :disabled="fly.busy !== null || needsOk"
        :loading="fly.busy !== null"
        :title="needsOk ? 'A program has to be shown to you first: use the full window' : undefined"
        :aria-keyshortcuts="onEnter ? 'Enter' : undefined"
        data-testid="compact-primary"
        @click="run"
      >
        {{ button.label }}
        <kbd v-if="onEnter" class="compact-key" aria-hidden="true">Enter</kbd>
      </v-btn>

      <div class="compact-links">
        <v-btn
          v-if="asking || paused"
          variant="text"
          size="small"
          data-testid="compact-cancel"
          @click="cancel"
        >
          Cancel
        </v-btn>
        <v-btn
          variant="text"
          size="small"
          prepend-icon="mdi-refresh"
          :disabled="fly.busy !== null"
          data-testid="compact-recheck"
          @click="fly.check()"
        >
          Re-check
        </v-btn>
        <v-btn
          v-if="primary !== 'standDown'"
          variant="text"
          size="small"
          prepend-icon="mdi-power-standby"
          :disabled="fly.busy !== null"
          title="Closes the helper apps. A game that is running is left running."
          data-testid="compact-stand-down"
          @click="fly.standDown(false)"
        >
          Stand down
        </v-btn>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* As a window of its own it is all there is: it lies over the app's bar. */
.compact-panel {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 14px 16px 8px;
  background: var(--rr-bg);
}
.compact-card {
  max-width: 420px;
}
/* In its own window the setup stays at the top and the small actions at the foot, so
   neither moves when a session comes and goes in between. */
.compact-panel .compact-card {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  max-width: none;
}
.compact-panel .compact-links {
  margin-top: auto;
  padding-top: 6px;
  border-top: 1px solid var(--rr-border);
}
.compact-panel .compact-primary {
  flex: none;
  margin-bottom: 12px;
}
.compact-card.rr-panel {
  padding: 16px 18px 12px;
}
.compact-top {
  display: flex;
  align-items: center;
  gap: 14px;
}
.compact-main {
  flex: 1;
  min-width: 0;
}
.compact-switcher {
  display: inline-grid;
  max-width: 100%;
  margin-left: -6px;
}
.compact-switcher :deep(.v-field) {
  --v-field-padding-start: 6px;
  --v-field-padding-end: 2px;
  border-radius: 6px;
}
.compact-switcher :deep(.v-field:hover) {
  background: var(--rr-surface-2);
}
.compact-switcher :deep(.v-field--focused) {
  outline: 2px solid var(--rr-focus);
  outline-offset: 1px;
}
.compact-switcher :deep(.v-field__input) {
  min-height: 0;
  padding-top: 1px;
  padding-bottom: 1px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
}
.compact-switcher :deep(.v-field__append-inner) {
  padding-top: 0;
  align-items: center;
}
.compact-state {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 15px;
  font-weight: 600;
}
.compact-count {
  font-variant-numeric: tabular-nums;
}
.compact-sub {
  font-size: 12px;
  color: var(--rr-muted);
}
.compact-line {
  margin-top: 10px;
  font-size: 12.5px;
}
.compact-primary {
  margin-top: 12px;
}
.compact-key {
  margin-left: 10px;
  padding: 0 6px;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
  border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
  border-radius: 4px;
}
.compact-links {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  margin-top: 6px;
}
.compact-empty {
  padding: 18px 4px;
  font-size: 13.5px;
}
.compact-empty p {
  margin: 0 0 12px;
}
</style>
