<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useClient } from '../../../renderer/ipc';
import { appContract, type CommandRun } from '../../../shared/appContract';

/**
 * What RigReady was started to do, on every screen: a desktop shortcut, a Jump List task,
 * the hotkey or `RigReady.exe --fly "<setup>"` asks the shell to check, make ready and
 * launch. The shell does it; this strip shows how far it has got, lets the user keep the
 * game from launching while there is still time, and says why when it stopped.
 */
const shell = useClient(appContract);
const route = useRoute();
const router = useRouter();

const run = ref<CommandRun | null>(null);
/** The id of the run the user (or time) put away. */
const dismissed = ref(0);
const hovered = ref(false);
const stopping = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

const LOOK = {
  ok: { icon: 'mdi-check-circle', tone: 'rr-ok' },
  warn: { icon: 'mdi-alert', tone: 'rr-warn' },
  bad: { icon: 'mdi-close-circle', tone: 'rr-bad' },
  idle: { icon: 'mdi-information-outline', tone: 'rr-muted' },
} as const;

const shown = computed(() => (run.value && run.value.id !== dismissed.value ? run.value : null));
const going = computed(() => shown.value !== null && shown.value.outcome === undefined);
const look = computed(() => LOOK[shown.value?.tone ?? 'idle']);
const onFly = computed(() => route.path === '/fly' || route.path === '/');

const finished = (state: string): boolean => state !== 'pending' && state !== 'running';
const progress = computed(() => {
  const steps = shown.value?.steps ?? [];
  if (steps.length === 0) return undefined;
  const done = steps.filter((s) => finished(s.state)).length;
  return { done, total: steps.length, percent: Math.round((done / steps.length) * 100) };
});
/** The step being worked on, or the one that finished last. */
const step = computed(() => {
  const steps = shown.value?.steps ?? [];
  return (
    steps.find((s) => s.state === 'running') ?? [...steps].reverse().find((s) => finished(s.state))
  );
});
const stepLine = computed(() => {
  if (!step.value) return undefined;
  if (step.value.state === 'running') return step.value.title;
  return step.value.message ? `${step.value.title}: ${step.value.message}` : step.value.title;
});

const MOST_REASONS = 4;
const reasons = computed(() => (shown.value?.reasons ?? []).slice(0, MOST_REASONS));
const moreReasons = computed(() => (shown.value?.reasons.length ?? 0) - reasons.value.length);

/** How long a result stays on screen by itself. One that stopped stays until it is put away. */
function lingerMs(next: CommandRun): number {
  if (next.outcome === 'stopped') return 0;
  if (next.outcome === 'selected') return 5000;
  return next.outcome === 'cancelled' ? 8000 : 15_000;
}

function arm(next: CommandRun | null): void {
  clearTimeout(timer);
  if (!next?.outcome) return;
  const ms = lingerMs(next);
  if (ms === 0) return;
  timer = setTimeout(() => {
    // Not while it is being read.
    if (hovered.value) arm(next);
    else dismissed.value = next.id;
  }, ms);
}

watch(run, (next) => {
  stopping.value = false;
  arm(next);
});

function dismiss(): void {
  if (shown.value) dismissed.value = shown.value.id;
}

async function doNotLaunch(): Promise<void> {
  stopping.value = true;
  const answer = await shell.cancelCommand();
  // Too late (the launch began) or already over: the strip shows what happened instead.
  if (!answer.ok || !answer.value.cancelled) stopping.value = false;
}

/** A result that needs nothing more goes away with the window (after a launch, to the tray). */
function onVisibility(): void {
  const current = run.value;
  if (document.visibilityState === 'hidden' && current?.outcome && current.outcome !== 'stopped') {
    dismissed.value = current.id;
  }
}

const off = shell.on('command', (next) => {
  run.value = next;
});

// The shell tells the main window where a command has got to, and once more when this page
// has loaded: a command of this start may have begun before the window was there.
onMounted(() => document.addEventListener('visibilitychange', onVisibility));
onBeforeUnmount(() => {
  off();
  clearTimeout(timer);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <Transition name="strip">
    <section
      v-if="shown"
      class="strip rr-panel"
      :class="`strip-${shown.tone}`"
      role="status"
      aria-live="polite"
      data-testid="command-strip"
      :data-phase="shown.phase"
      :data-outcome="shown.outcome ?? ''"
      :data-tone="shown.tone"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
    >
      <div class="strip-row">
        <div class="strip-mark">
          <v-progress-circular
            v-if="going"
            indeterminate
            size="20"
            width="2"
            aria-label="Working"
          />
          <v-icon v-else :icon="look.icon" :class="look.tone" size="22" />
        </div>
        <div class="strip-main">
          <div class="strip-headline" data-testid="command-headline">{{ shown.headline }}</div>
          <div v-if="going && stepLine" class="rr-row-sub" data-testid="command-step">
            {{ stepLine }}
            <span v-if="progress" class="strip-count">
              · {{ progress.done }} of {{ progress.total }}
            </span>
          </div>
          <ul v-if="reasons.length > 0" class="strip-reasons" data-testid="command-reasons">
            <li v-for="reason in reasons" :key="reason">{{ reason }}</li>
            <li v-if="moreReasons > 0">and {{ moreReasons }} more on the Fly screen</li>
          </ul>
        </div>
        <div class="strip-actions">
          <v-btn
            v-if="shown.canCancel"
            size="small"
            variant="tonal"
            :loading="stopping"
            data-testid="command-cancel"
            @click="doNotLaunch"
          >
            Do not launch
          </v-btn>
          <v-btn
            v-if="!going && !onFly"
            size="small"
            variant="text"
            data-testid="command-open-fly"
            @click="router.push('/fly')"
          >
            Open the Fly screen
          </v-btn>
          <v-btn
            v-if="!going"
            icon="mdi-close"
            size="small"
            variant="text"
            density="comfortable"
            aria-label="Dismiss"
            data-testid="command-dismiss"
            @click="dismiss"
          />
        </div>
      </div>
      <v-progress-linear
        v-if="going"
        class="strip-bar"
        height="2"
        :indeterminate="!progress"
        :model-value="progress?.percent ?? 0"
        aria-label="Progress"
      />
    </section>
  </Transition>
</template>

<style scoped>
.strip {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  width: min(680px, calc(100vw - 48px));
  z-index: 1000;
  overflow: hidden;
  background: var(--rr-surface-2);
  border-left-width: 3px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}
/* The edge repeats what the icon and the words already say. */
.strip-ok {
  border-left-color: var(--rr-ok);
}
.strip-warn {
  border-left-color: var(--rr-warn);
}
.strip-bad {
  border-left-color: var(--rr-bad);
}
.strip-idle {
  border-left-color: var(--rr-accent);
}
.strip-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 12px 12px 14px;
}
.strip-mark {
  flex: none;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.strip-main {
  flex: 1;
  min-width: 0;
}
.strip-headline {
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
  overflow-wrap: anywhere;
}
.strip-count {
  white-space: nowrap;
}
.strip-reasons {
  margin: 4px 0 0;
  padding: 0 0 0 16px;
  font-size: 12.5px;
  color: var(--rr-text);
  overflow-wrap: anywhere;
}
.strip-reasons li {
  padding: 1px 0;
}
.strip-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}
.strip-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}
.strip-enter-active,
.strip-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.strip-enter-from,
.strip-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
@media (prefers-reduced-motion: reduce) {
  .strip-enter-active,
  .strip-leave-active {
    transition: none;
  }
}
</style>
