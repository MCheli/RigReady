<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import type { CheckResult } from '../../../core/checks/engine';
import type { CommandPreview } from '../../../core/checks/registry';
import { CHECK_GROUPS, GROUP_TITLES } from '../../../core/profile/schema';
import { onMachineChanged } from '../../../renderer/machine';
import CheckRow from './CheckRow.vue';
import ReadinessDial from './ReadinessDial.vue';
import SafeMarkdown from './SafeMarkdown.vue';
import WelcomePanel from './WelcomePanel.vue';
import { useFlyStore } from './store';

const fly = useFlyStore();

/** Groups opened or closed by hand; otherwise a group is open only while something in it needs attention. */
const toggled = ref<Record<string, boolean>>({});
const toast = ref<string>();

// ---- dialogs ----
interface Confirmation {
  title: string;
  command: CommandPreview;
  resolve: (ok: boolean) => void;
}
const confirmation = ref<Confirmation>();
function askToRun(title: string, command: CommandPreview): Promise<boolean> {
  return new Promise((resolve) => (confirmation.value = { title, command, resolve }));
}
function answer(ok: boolean): void {
  confirmation.value?.resolve(ok);
  confirmation.value = undefined;
}

const launchWarning = ref(false);
const paused = ref<{ at: number; message: string; output?: string; approved: string[] }>();
const gameRunning = ref<string>();

const groups = computed(() =>
  CHECK_GROUPS.map((group) => {
    const items = fly.items.filter((i) => i.group === group);
    const results = items.map((i) => fly.results[i.itemId]).filter(Boolean) as CheckResult[];
    const checking = items.some((i) => fly.checking[i.itemId] || !fly.results[i.itemId]);
    // Items switched off in the setup are not checked: they are neither passed nor counted.
    const off = results.filter((r) => r.disabled).length;
    const passed = results.filter((r) => r.status === 'pass' && !r.disabled).length;
    const attention = results.some((r) => r.status !== 'pass');
    // A required item not met is red, an optional one yellow: as on the rows.
    const bad = results.some((r) => r.status !== 'pass' && r.required);
    return {
      group,
      title: GROUP_TITLES[group],
      items,
      off,
      total: items.length - off,
      passed,
      checking,
      attention,
      bad,
      open: toggled.value[group] ?? attention,
    };
  }).filter((g) => g.items.length > 0)
);

function toggle(group: string, open: boolean): void {
  toggled.value = { ...toggled.value, [group]: !open };
}

const headline = computed(() => {
  const counts = fly.counts;
  if (fly.readiness === 'notReady') {
    return {
      tone: 'bad' as const,
      icon: 'mdi-close-circle',
      title: 'Not ready',
      count: counts.failed,
      sub: `${counts.failed} required ${counts.failed === 1 ? 'item is' : 'items are'} not met${
        counts.warnings > 0 ? ` · ${counts.warnings} optional` : ''
      }${fly.anyChecking ? ' · still checking' : ''}`,
    };
  }
  if (fly.readiness === 'warnings') {
    return {
      tone: 'warn' as const,
      icon: 'mdi-check-circle',
      title: 'Ready with warnings',
      count: counts.warnings,
      sub: `${counts.warnings} optional ${counts.warnings === 1 ? 'item needs' : 'items need'} attention`,
    };
  }
  if (fly.readiness === 'ready') {
    return {
      tone: 'ok' as const,
      icon: 'mdi-check-circle',
      title: 'Ready',
      count: undefined,
      sub:
        fly.items.length === 0
          ? 'This setup has nothing to check'
          : 'Everything this setup needs is in place',
    };
  }
  return {
    tone: 'idle' as const,
    icon: 'mdi-timer-sand',
    title: 'Checking…',
    count: undefined,
    sub: `${counts.checked} of ${fly.items.length} checked`,
  };
});

const locked = computed(() => fly.busy === 'makeReady' || fly.busy === 'standDown');

const switcherItems = computed(() => [
  ...fly.profiles.map((p) => ({
    value: p.id,
    title: p.name,
    subtitle: [
      p.gameName ?? 'No game',
      p.lastUsed ? `used ${when(p.lastUsed)}` : 'not used yet',
    ].join(' · '),
    disabled: false,
    reason: '',
  })),
  ...fly.invalid.map((p) => ({
    value: `invalid:${p.id}`,
    title: p.id,
    subtitle: 'Cannot be opened',
    disabled: true,
    reason: p.detail ? `${p.message} ${p.detail}` : p.message,
  })),
]);

function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Under the setup's name: the game it is for, and when it was last in use. */
const context = computed(() => {
  const setup = fly.active;
  if (!setup) return [];
  return [
    setup.gameName ?? 'No game chosen',
    setup.lastUsed ? `Last used ${when(setup.lastUsed)}` : 'Not used yet',
  ];
});

// ---- actions ----

async function fixOne(itemId: string): Promise<void> {
  const result = fly.results[itemId];
  if (!result) return;
  if (result.confirm) {
    if (!(await askToRun(result.title, result.confirm))) return;
    await fly.fix(itemId, true);
  } else {
    await fly.fix(itemId);
  }
}

/** Fixes that run a program are asked about first, one by one, showing exactly what runs. */
async function fixApprovals(): Promise<string[]> {
  const approved: string[] = [];
  for (const item of fly.items) {
    const result = fly.results[item.itemId];
    if (!result || result.status === 'pass' || result.fixKind !== 'action' || !result.confirm)
      continue;
    if (await askToRun(result.title, result.confirm)) approved.push(item.itemId);
  }
  return approved;
}

async function makeReady(): Promise<void> {
  await fly.makeReady(await fixApprovals());
}

async function approvals(phase: 'preLaunch' | 'postLaunch'): Promise<string[]> {
  const approved: string[] = [];
  for (const action of fly.view?.actions ?? []) {
    if (action.phase !== phase || !action.confirm) continue;
    if (await askToRun(action.title, action.confirm)) approved.push(action.id);
  }
  return approved;
}

function onLaunch(): void {
  if (fly.readiness === 'notReady') launchWarning.value = true;
  else void doLaunch();
}

async function doLaunch(resumeAfter?: number, approvedBefore?: string[]): Promise<void> {
  launchWarning.value = false;
  const approved = approvedBefore ?? [
    ...(await approvals('preLaunch')),
    ...(await approvals('postLaunch')),
  ];
  if (resumeAfter === undefined && fly.readiness === 'warnings') {
    const names = fly.counts.optional.map((r) => r.title).join(', ');
    toast.value = `Launching with ${fly.counts.warnings} optional ${
      fly.counts.warnings === 1 ? 'item' : 'items'
    } not met: ${names}`;
  }
  const outcome = await fly.launch({
    approved,
    ...(resumeAfter !== undefined ? { resumeAfter } : {}),
  });
  if (outcome.paused) paused.value = { ...outcome.paused, approved };
}

function launchAnyway(): void {
  const state = paused.value;
  paused.value = undefined;
  if (state) void doLaunch(state.at, state.approved);
}

// ---- the one action ----

type ActionId = 'readyAndLaunch' | 'makeReady' | 'launch';

/**
 * What the screen is for right now, and what Enter runs. A rig that is not ready and can
 * be fixed: fix it and launch. Otherwise: launch (with the warning while something
 * required is missing). A setup with nothing to launch: Make ready, when there is
 * something to fix.
 */
const primaryNow = computed<ActionId | undefined>(() => {
  const setup = fly.active;
  if (!setup) return undefined;
  const fixable = fly.counts.fixable > 0;
  if (!setup.canLaunch) return fixable ? 'makeReady' : undefined;
  return fly.readiness === 'notReady' && fixable ? 'readyAndLaunch' : 'launch';
});
/** The buttons do not change places while one of them is at work. */
const primary = ref<ActionId>();
watchEffect(() => {
  if (fly.busy === null) primary.value = primaryNow.value;
});

/** The buttons on the left, the primary one first. */
const actions = computed<ActionId[]>(() => {
  if (primary.value === 'readyAndLaunch') return ['readyAndLaunch', 'makeReady', 'launch'];
  if (primary.value === 'launch') return ['launch', 'makeReady'];
  return ['makeReady', 'launch'];
});

/** Launch is green once the rig is known to be ready, and never before. */
const launchLook = computed(() => {
  const ready = fly.readiness === 'ready' || fly.readiness === 'warnings';
  return {
    color: ready ? 'success' : undefined,
    variant: ready && primary.value === 'launch' ? ('flat' as const) : ('tonal' as const),
  };
});

/** Make ready and launch is running, from its first fix to the game. */
const inFlight = computed(() => fly.activity?.kind === 'flight' && fly.busy !== null);
/** The primary action is waiting for the checklist run under way to finish. */
const waiting = ref(false);
/** What the user agreed to run around the launch, for "Launch anyway" after a stop. */
const flightApproved = ref<string[]>([]);

async function flyNow(): Promise<void> {
  // Everything that needs an answer is asked first; then the run goes through by itself.
  const approvedFixes = await fixApprovals();
  const approvedActions = [...(await approvals('preLaunch')), ...(await approvals('postLaunch'))];
  flightApproved.value = approvedActions;
  const outcome = await fly.readyAndLaunch({ approvedFixes, approvedActions });
  if (outcome.paused) paused.value = { ...outcome.paused, approved: approvedActions };
}

/** "Launch anyway" after Make ready and launch stopped: what is missing is on the screen. */
async function launchHeld(): Promise<void> {
  const approved = flightApproved.value;
  const outcome = await fly.launch({ approved, keep: true });
  if (outcome.paused) paused.value = { ...outcome.paused, approved };
}

async function runPrimary(): Promise<void> {
  if (fly.busy !== null || waiting.value) return;
  // It acts on answers, not on guesses: a checklist run under way is finished first.
  waiting.value = true;
  try {
    await fly.settled();
  } finally {
    waiting.value = false;
  }
  if (fly.busy !== null) return;
  const action = primaryNow.value;
  if (action === 'readyAndLaunch') await flyNow();
  else if (action === 'makeReady') await makeReady();
  else if (action === 'launch') onLaunch();
}

function onLaunchClick(): void {
  if (primary.value === 'launch') void runPrimary();
  else onLaunch();
}

/** A focused control keeps Enter for itself. */
const KEEPS_ENTER =
  'a, button, input, select, textarea, summary, [role="button"], [role="combobox"], [role="option"], [role="menuitem"], [role="tab"], [contenteditable]';

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) return;
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(KEEPS_ENTER)) return;
  // So does an open dialog or menu: its own buttons answer.
  if (document.querySelector('.v-overlay--active.v-dialog, .v-overlay--active.v-menu')) return;
  if (!primaryNow.value) return;
  event.preventDefault();
  void runPrimary();
}

const STEP_LOOK = {
  none: { icon: 'mdi-minus', tone: 'rr-muted', says: 'nothing to fix' },
  pending: { icon: 'mdi-circle-outline', tone: 'rr-muted', says: 'waiting' },
  running: { icon: '', tone: 'rr-muted', says: 'working' },
  done: { icon: 'mdi-check-circle', tone: 'rr-ok', says: 'done' },
  failed: { icon: 'mdi-alert-circle', tone: 'rr-bad', says: 'failed' },
  skipped: { icon: 'mdi-debug-step-over', tone: 'rr-muted', says: 'skipped' },
  held: { icon: 'mdi-hand-back-right-outline', tone: 'rr-warn', says: 'not started' },
} as const;

async function onStandDown(): Promise<void> {
  const game = await fly.gameStatus();
  if (game.running) gameRunning.value = game.name ?? 'The game';
  else await fly.standDown(false);
}

async function standDownWithGame(close: boolean): Promise<void> {
  gameRunning.value = undefined;
  await fly.standDown(close);
}

const ENTRY_LOOK = {
  pending: { icon: 'mdi-circle-outline', tone: 'rr-muted' },
  running: { icon: '', tone: 'rr-muted' },
  done: { icon: 'mdi-check', tone: 'rr-ok' },
  failed: { icon: 'mdi-alert-circle', tone: 'rr-bad' },
  skipped: { icon: 'mdi-debug-step-over', tone: 'rr-muted' },
} as const;

const PHASES = { preLaunch: 'Before launch', launch: 'Game', postLaunch: 'After launch' } as const;

// ---- lifecycle ----
let timer: ReturnType<typeof setInterval> | undefined;
const offs: (() => void)[] = [];
const refresh = (): void => {
  if (!fly.anyChecking && fly.busy === null) void fly.check(true);
};

onMounted(async () => {
  await fly.load();
  // Devices get plugged in and apps get closed while this screen is open.
  timer = setInterval(refresh, 5000);
  window.addEventListener('focus', refresh);
  window.addEventListener('keydown', onKey);
  offs.push(onMachineChanged(refresh));
  // A setup edited by hand (or in Configure) shows up here without a restart.
  offs.push(await fly.watch(() => void fly.load()));
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener('focus', refresh);
  window.removeEventListener('keydown', onKey);
  for (const off of offs) off();
});
</script>

<template>
  <div class="rr-page fly" data-testid="fly-page">
    <v-alert
      v-if="fly.error"
      type="error"
      variant="tonal"
      class="mb-4"
      closable
      data-testid="fly-error"
    >
      {{ fly.error }}
    </v-alert>
    <v-alert
      v-if="fly.notice"
      type="info"
      variant="tonal"
      class="mb-4"
      closable
      data-testid="fly-notice"
    >
      {{ fly.notice }}
    </v-alert>
    <v-alert
      v-if="fly.view?.problem"
      type="warning"
      variant="tonal"
      class="mb-4"
      data-testid="fly-problem"
      title="The setup file has a problem"
    >
      RigReady keeps using the last version that worked until the file is fixed.
      <div class="rr-mono mt-1">{{ fly.view.problem }}</div>
    </v-alert>

    <div v-if="!fly.loaded" class="rr-empty">Loading…</div>

    <WelcomePanel v-else-if="fly.profiles.length === 0 && fly.invalid.length === 0" />

    <div v-else-if="!fly.activeId" class="rr-panel rr-empty" data-testid="fly-all-broken">
      <v-icon icon="mdi-file-alert-outline" size="40" class="mb-3" />
      <h2 class="rr-page-title">No setup can be opened</h2>
      <p class="mb-5">
        Every setup file has a problem. Fix them in Configure, or create a new one.
      </p>
      <v-btn color="primary" to="/configure/profiles">Go to Setups</v-btn>
    </div>

    <template v-else>
      <section class="rr-panel fly-hero" aria-label="Readiness" data-testid="fly-hero">
        <div class="fly-hero-top">
          <ReadinessDial
            :states="fly.dial.states"
            :met="fly.dial.met"
            :total="fly.dial.total"
            :tone="headline.tone"
            :checking="fly.anyChecking"
            data-testid="fly-dial"
          />
          <div class="fly-hero-main">
            <div class="fly-identity">
              <div class="fly-identity-text">
                <div class="rr-section-title fly-caption" aria-hidden="true">Setup</div>
                <v-select
                  :model-value="fly.activeId"
                  :items="switcherItems"
                  item-title="title"
                  item-value="value"
                  aria-label="Setup"
                  variant="plain"
                  density="compact"
                  class="fly-switcher"
                  :menu-props="{ minWidth: 320 }"
                  hide-details
                  data-testid="profile-switcher"
                  @update:model-value="fly.select($event)"
                >
                  <template #item="{ props: itemProps, item }">
                    <!-- A broken file cannot be chosen, but says why when pointed at. -->
                    <v-tooltip
                      v-if="item.disabled"
                      :text="item.reason"
                      location="end"
                      max-width="420"
                    >
                      <template #activator="{ props: tip }">
                        <v-list-item
                          v-bind="tip"
                          :subtitle="item.subtitle"
                          :title="item.title"
                          class="switcher-invalid"
                          aria-disabled="true"
                          data-testid="switcher-invalid"
                          @click.stop
                        >
                          <template #append>
                            <v-icon icon="mdi-file-alert-outline" class="rr-bad" size="18" />
                          </template>
                        </v-list-item>
                      </template>
                    </v-tooltip>
                    <v-list-item
                      v-else
                      v-bind="itemProps"
                      :subtitle="item.subtitle"
                      :title="item.title"
                      data-testid="switcher-item"
                    />
                  </template>
                </v-select>
                <div class="fly-context" data-testid="fly-context">
                  <span v-for="(part, i) in context" :key="i">{{ part }}</span>
                </div>
              </div>
              <v-menu location="bottom end">
                <template #activator="{ props: menu }">
                  <v-btn
                    v-bind="menu"
                    icon="mdi-dots-vertical"
                    variant="text"
                    size="small"
                    aria-label="More"
                    data-testid="fly-more"
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-pencil-outline"
                    title="Edit this setup"
                    :to="`/configure/profiles/${fly.activeId}`"
                    data-testid="fly-edit"
                  />
                  <v-list-item
                    :prepend-icon="
                      fly.minimizeOnLaunch
                        ? 'mdi-checkbox-marked-outline'
                        : 'mdi-checkbox-blank-outline'
                    "
                    title="Hide RigReady after Launch"
                    data-testid="fly-minimize-pref"
                    @click="fly.setMinimizeOnLaunch(!fly.minimizeOnLaunch)"
                  />
                </v-list>
              </v-menu>
            </div>
            <div
              class="fly-status"
              :class="`fly-status-${headline.tone}`"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid="fly-status"
              :data-ready="fly.readiness === undefined ? undefined : fly.readiness !== 'notReady'"
            >
              <v-progress-circular
                v-if="headline.tone === 'idle'"
                indeterminate
                size="20"
                width="2"
                class="fly-status-icon"
                aria-label="Checking"
              />
              <v-icon v-else :icon="headline.icon" size="24" class="fly-status-icon" />
              <div>
                <div class="fly-status-line">
                  <span class="fly-status-title" data-testid="fly-status-title">{{
                    headline.title
                  }}</span>
                  <span
                    v-if="headline.count !== undefined"
                    class="fly-status-count"
                    data-testid="fly-status-count"
                    >({{ headline.count }})</span
                  >
                </div>
                <div class="fly-status-sub" data-testid="fly-status-sub">{{ headline.sub }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="fly-actions" :data-primary="primary ?? 'none'" data-testid="fly-actions">
          <template v-for="action in actions" :key="action">
            <v-tooltip
              v-if="action === 'readyAndLaunch'"
              text="Runs every fix in order, checks again, and starts the game once everything required is met"
              location="bottom"
              max-width="380"
            >
              <template #activator="{ props: tip }">
                <v-btn
                  v-bind="tip"
                  color="primary"
                  size="large"
                  prepend-icon="mdi-rocket-launch"
                  :disabled="fly.busy !== null"
                  :loading="waiting || inFlight"
                  aria-keyshortcuts="Enter"
                  data-testid="ready-and-launch"
                  @click="runPrimary"
                >
                  Make ready and launch
                  <kbd class="fly-key" aria-hidden="true">Enter</kbd>
                </v-btn>
              </template>
            </v-tooltip>
            <v-btn
              v-else-if="action === 'makeReady'"
              color="primary"
              :size="primary === 'makeReady' ? 'large' : 'default'"
              :variant="primary === 'makeReady' ? 'flat' : 'tonal'"
              prepend-icon="mdi-wrench-check"
              :disabled="fly.counts.fixable === 0 || fly.busy !== null"
              :loading="fly.busy === 'makeReady' && !inFlight"
              :title="
                fly.counts.fixable === 0 ? 'Nothing for Make ready to fix right now' : undefined
              "
              :aria-keyshortcuts="primary === 'makeReady' ? 'Enter' : undefined"
              data-testid="make-ready"
              @click="makeReady"
            >
              Make ready
              <kbd v-if="primary === 'makeReady'" class="fly-key" aria-hidden="true">Enter</kbd>
            </v-btn>
            <v-tooltip
              v-else-if="fly.active?.canLaunch"
              :text="fly.view?.launchLabel ? `Starts ${fly.view.launchLabel}` : 'Starts the game'"
              location="bottom"
            >
              <template #activator="{ props: tip }">
                <v-btn
                  v-bind="tip"
                  :color="launchLook.color"
                  :variant="launchLook.variant"
                  :size="primary === 'launch' ? 'large' : 'default'"
                  prepend-icon="mdi-rocket-launch"
                  :disabled="fly.busy !== null"
                  :loading="
                    (fly.busy === 'launch' && !inFlight) || (waiting && primary === 'launch')
                  "
                  :aria-keyshortcuts="primary === 'launch' ? 'Enter' : undefined"
                  data-testid="launch"
                  @click="onLaunchClick"
                >
                  Launch
                  <kbd v-if="primary === 'launch'" class="fly-key" aria-hidden="true">Enter</kbd>
                </v-btn>
              </template>
            </v-tooltip>
            <v-btn
              v-else
              variant="text"
              prepend-icon="mdi-rocket-launch-outline"
              :to="`/configure/profiles/${fly.activeId}`"
              data-testid="launch-setup"
            >
              Choose what Launch starts
            </v-btn>
          </template>
          <v-spacer />
          <v-btn
            variant="text"
            prepend-icon="mdi-refresh"
            :disabled="fly.busy !== null"
            :loading="fly.anyChecking && fly.busy === null"
            data-testid="recheck"
            @click="fly.check()"
          >
            Re-check all
          </v-btn>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-power-standby"
            :disabled="fly.busy !== null"
            :loading="fly.busy === 'standDown'"
            data-testid="stand-down"
            @click="onStandDown"
          >
            Stand down
          </v-btn>
        </div>
      </section>

      <div
        v-if="fly.activity"
        class="rr-panel fly-activity"
        role="log"
        aria-live="polite"
        :aria-label="fly.activity.title"
        data-testid="fly-activity"
      >
        <div class="fly-activity-head">
          <span class="rr-section-title">{{ fly.activity.title }}</span>
          <span
            v-if="fly.activity.headline"
            class="fly-activity-headline"
            data-testid="fly-activity-headline"
          >
            {{ fly.activity.headline }}
          </span>
          <v-spacer />
          <v-btn
            icon="mdi-close"
            size="x-small"
            variant="text"
            aria-label="Dismiss"
            :disabled="fly.activity.running && fly.busy !== null"
            @click="fly.activity = undefined"
          />
        </div>
        <ol v-if="fly.steps.length" class="fly-steps" aria-label="Steps" data-testid="fly-steps">
          <li
            v-for="step in fly.steps"
            :key="step.id"
            class="fly-step"
            :class="`fly-step-${step.state}`"
            :aria-label="`${step.label}: ${STEP_LOOK[step.state].says}`"
            :data-state="step.state"
            :data-testid="`fly-step-${step.id}`"
          >
            <v-progress-circular
              v-if="step.state === 'running'"
              indeterminate
              size="14"
              width="2"
              aria-label="Working"
            />
            <v-icon
              v-else
              :icon="STEP_LOOK[step.state].icon"
              :class="STEP_LOOK[step.state].tone"
              size="16"
            />
            <span class="fly-step-label">{{ step.label }}</span>
            <span v-if="step.total > 1" class="fly-step-count"
              >{{ step.finished }}/{{ step.total }}</span
            >
          </li>
        </ol>
        <div
          v-if="fly.activity.entries.length === 0 && !fly.activity.running"
          class="rr-row rr-muted"
        >
          There was nothing to do.
        </div>
        <div
          v-for="entry in fly.activity.entries"
          :key="entry.id"
          class="rr-row fly-entry"
          :data-testid="`step-${entry.state === 'done' ? 'ok' : entry.state}`"
          :data-state="entry.state"
        >
          <v-progress-circular
            v-if="entry.state === 'running'"
            indeterminate
            size="18"
            width="2"
            aria-label="Working"
          />
          <v-icon
            v-else
            :icon="ENTRY_LOOK[entry.state].icon"
            :class="ENTRY_LOOK[entry.state].tone"
            size="20"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">
              {{ entry.message ?? (entry.state === 'pending' ? 'Waiting' : 'Working…') }}
            </div>
            <div class="rr-row-sub">
              <span v-if="entry.phase" class="fly-phase">{{ PHASES[entry.phase] }} · </span
              >{{ entry.title }}
            </div>
            <pre v-if="entry.output" class="fly-output rr-mono">{{ entry.output }}</pre>
          </div>
        </div>
        <div
          v-if="fly.activity.stage === 'held' && fly.readiness === 'notReady'"
          class="rr-row fly-held"
          data-testid="flight-held"
        >
          <v-icon icon="mdi-hand-back-right-outline" class="rr-warn" size="20" />
          <div class="rr-row-main">
            <div class="rr-row-title" data-testid="flight-held-title">
              Not launched: {{ fly.counts.failed }} required
              {{ fly.counts.failed === 1 ? 'item still needs' : 'items still need' }} you
            </div>
            <ul class="fly-held-list">
              <li v-for="r in fly.counts.failing" :key="r.itemId" data-testid="flight-held-item">
                <strong>{{ r.title }}</strong> — {{ r.summary }}
              </li>
            </ul>
          </div>
          <v-btn
            color="warning"
            variant="tonal"
            :disabled="fly.busy !== null"
            data-testid="flight-launch-anyway"
            @click="launchHeld"
          >
            Launch anyway
          </v-btn>
        </div>
        <template v-if="fly.activity.needsYou.length">
          <div class="rr-row fly-needs-head"><span class="rr-section-title">Needs you</span></div>
          <div
            v-for="need in fly.activity.needsYou"
            :key="need.itemId"
            class="rr-row fly-entry"
            data-testid="needs-you"
          >
            <v-icon icon="mdi-hand-back-right-outline" class="rr-warn" size="20" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ need.title }}</div>
              <div class="rr-row-sub">{{ need.summary }}</div>
              <div v-if="need.instructions" class="fly-need-text">
                <SafeMarkdown :source="need.instructions" />
              </div>
            </div>
            <v-btn
              v-if="need.open"
              size="small"
              variant="tonal"
              data-testid="needs-you-open"
              @click="fly.fix(need.itemId)"
            >
              {{ need.open }}
            </v-btn>
          </div>
        </template>
      </div>

      <div v-if="fly.items.length === 0" class="rr-panel rr-empty" data-testid="fly-no-checks">
        This setup has no checks yet.
        <div class="mt-3">
          <v-btn variant="tonal" :to="`/configure/profiles/${fly.activeId}`">Add checks</v-btn>
        </div>
      </div>

      <section
        v-for="group in groups"
        :key="group.group"
        class="fly-group"
        :data-testid="`group-${group.group}`"
      >
        <button
          type="button"
          class="fly-group-head"
          :aria-expanded="group.open"
          :data-testid="`group-toggle-${group.group}`"
          @click="toggle(group.group, group.open)"
        >
          <v-icon :icon="group.open ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="18" />
          <h2 class="rr-section-title">{{ group.title }}</h2>
          <span
            class="fly-group-count"
            :class="{
              'rr-ok': !group.checking && group.total > 0 && group.passed === group.total,
              'rr-bad': group.attention && group.bad,
              'rr-warn': group.attention && !group.bad,
            }"
          >
            <template v-if="group.checking && group.passed + (group.attention ? 1 : 0) === 0"
              >Checking…</template
            >
            <template v-else-if="group.total === 0">{{ group.off }} off</template>
            <template v-else
              >{{ group.passed }} of {{ group.total }} OK<template v-if="group.off">
                · {{ group.off }} off</template
              ></template
            >
          </span>
        </button>
        <div v-if="group.open" class="rr-panel">
          <CheckRow
            v-for="(item, index) in group.items"
            :key="item.itemId"
            :index="index"
            :item="item"
            :result="fly.results[item.itemId]"
            :checking="fly.checking[item.itemId] === true"
            :fixing="fly.fixing[item.itemId] === true"
            :fix-message="fly.fixMessages[item.itemId]"
            :locked="locked"
            :profile-id="fly.activeId"
            @recheck="fly.checkOne(item.itemId)"
            @fix="fixOne(item.itemId)"
            @acknowledge="fly.acknowledge(item.itemId)"
          />
        </div>
      </section>
    </template>

    <v-dialog v-model="launchWarning" max-width="500">
      <v-card data-testid="launch-warning">
        <v-card-title>Launch anyway?</v-card-title>
        <v-card-text>
          {{ fly.view?.name }} is not ready: {{ fly.counts.failed }}
          {{ fly.counts.failed === 1 ? 'required check is' : 'required checks are' }} not met.
          <ul class="fly-failing">
            <li v-for="r in fly.counts.failing" :key="r.itemId" data-testid="launch-warning-item">
              <strong>{{ r.title }}</strong> — {{ r.summary }}
            </li>
          </ul>
          You can still launch.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="launch-cancel" @click="launchWarning = false"
            >Cancel</v-btn
          >
          <v-btn color="warning" data-testid="launch-anyway" @click="doLaunch()"
            >Launch anyway</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="paused !== undefined" max-width="540" persistent>
      <v-card data-testid="launch-paused">
        <v-card-title>A step before launch failed</v-card-title>
        <v-card-text>
          <p class="mb-2">{{ paused?.message }}</p>
          <pre v-if="paused?.output" class="fly-output rr-mono">{{ paused.output }}</pre>
          <p class="mt-2">
            This step is set to stop the launch when it fails. Launch the game anyway?
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="paused-cancel" @click="paused = undefined"
            >Cancel</v-btn
          >
          <v-btn color="warning" data-testid="paused-launch" @click="launchAnyway"
            >Launch anyway</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="confirmation !== undefined" max-width="560" persistent>
      <v-card data-testid="confirm-run">
        <v-card-title>Run this program?</v-card-title>
        <v-card-text>
          <p class="mb-3">“{{ confirmation?.title }}” wants to run:</p>
          <div class="fly-command rr-mono" data-testid="confirm-run-exe">
            {{ confirmation?.command.exe }}
          </div>
          <div v-if="confirmation?.command.args.length" class="mt-2">
            <div class="rr-row-sub">Arguments, each passed as it is:</div>
            <div
              v-for="(arg, i) in confirmation.command.args"
              :key="i"
              class="fly-command rr-mono"
              data-testid="confirm-run-arg"
            >
              {{ arg }}
            </div>
          </div>
          <div v-if="confirmation?.command.cwd" class="mt-2 rr-row-sub">
            In folder <span class="rr-mono">{{ confirmation.command.cwd }}</span>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="confirm-run-skip" @click="answer(false)">Skip</v-btn>
          <v-btn color="primary" data-testid="confirm-run-ok" @click="answer(true)">Run it</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="gameRunning !== undefined" max-width="480">
      <v-card data-testid="game-running">
        <v-card-title>{{ gameRunning }} is still running</v-card-title>
        <v-card-text>Stand down closes the helper apps. Should it close the game too?</v-card-text>
        <v-card-actions>
          <v-btn variant="text" @click="gameRunning = undefined">Cancel</v-btn>
          <v-spacer />
          <v-btn variant="tonal" data-testid="game-leave" @click="standDownWithGame(false)"
            >Leave it running</v-btn
          >
          <v-btn color="warning" data-testid="game-close" @click="standDownWithGame(true)"
            >Close it too</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar
      :model-value="toast !== undefined"
      timeout="6000"
      color="warning"
      data-testid="fly-toast"
      @update:model-value="toast = undefined"
    >
      {{ toast }}
    </v-snackbar>
  </div>
</template>

<style scoped>
.fly-hero {
  padding: 22px 24px 16px;
  margin-bottom: 20px;
}
.fly-hero-top {
  display: flex;
  align-items: center;
  gap: 28px;
}
.fly-hero-main {
  flex: 1;
  min-width: 0;
}
.fly-identity {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.fly-identity-text {
  flex: 1;
  min-width: 0;
}
.fly-caption {
  margin: 0;
}
.switcher-invalid {
  opacity: 0.6;
  cursor: not-allowed;
}
/* The setup's name is the title of the screen, and the way to switch to another. */
.fly-switcher {
  display: inline-grid;
  max-width: 100%;
  margin: -2px 0 0 -8px;
}
.fly-switcher :deep(.v-field) {
  --v-field-padding-start: 8px;
  --v-field-padding-end: 4px;
  border-radius: 8px;
  transition: background-color 150ms ease-out;
}
.fly-switcher :deep(.v-field:hover) {
  background: var(--rr-surface-2);
}
.fly-switcher :deep(.v-field--focused) {
  outline: 2px solid var(--rr-focus);
  outline-offset: 1px;
}
.fly-switcher :deep(.v-field__input) {
  min-height: 0;
  padding-top: 2px;
  padding-bottom: 2px;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.005em;
}
.fly-switcher :deep(.v-field__append-inner) {
  padding-top: 0;
  align-items: center;
}
.fly-context {
  margin-top: 1px;
  font-size: 13px;
  color: var(--rr-muted);
}
.fly-context span + span::before {
  content: '·';
  margin: 0 7px;
}
.fly-status {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 14px;
}
.fly-status-icon {
  margin-top: 2px;
  flex: none;
}
.fly-status-ok {
  color: var(--rr-ok);
}
.fly-status-warn {
  color: var(--rr-warn);
}
.fly-status-bad {
  color: var(--rr-bad);
}
.fly-status-idle {
  color: var(--rr-muted);
}
.fly-status-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.fly-status-title,
.fly-status-count {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.25;
}
.fly-status-count {
  font-variant-numeric: tabular-nums;
}
.fly-status-sub {
  font-size: 13px;
  color: var(--rr-muted);
}
.fly-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--rr-border);
}
/* The key that runs the primary action, on the button itself. */
.fly-key {
  margin-left: 12px;
  padding: 0 6px;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
  letter-spacing: 0.02em;
  border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
  border-radius: 4px;
}
.fly-activity {
  margin-bottom: 24px;
}
/* Make ready, phase by phase: where the run is, in one line. */
.fly-steps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 0;
  list-style: none;
  margin: 0;
  padding: 10px 16px 12px;
}
.fly-step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
}
.fly-step + .fly-step::before {
  content: '';
  width: 20px;
  height: 1px;
  margin: 0 6px 0 4px;
  background: var(--rr-border);
}
.fly-step-none,
.fly-step-pending {
  color: var(--rr-muted);
  font-weight: 400;
}
.fly-step-count {
  color: var(--rr-muted);
  font-size: 11.5px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.fly-held {
  align-items: flex-start;
}
.fly-held-list {
  margin: 3px 0 0;
  padding-left: 16px;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.fly-activity-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 8px 0 16px;
}
.fly-activity-head .rr-section-title {
  margin: 0;
}
.fly-activity-headline {
  font-size: 13px;
  color: var(--rr-text);
}
.fly-entry {
  align-items: flex-start;
}
.fly-phase {
  color: var(--rr-muted);
}
.fly-needs-head {
  padding-bottom: 0;
}
.fly-needs-head .rr-section-title {
  margin: 0;
}
.fly-need-text {
  margin-top: 4px;
}
.fly-output {
  margin: 6px 0 0;
  padding: 8px 10px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 6px;
}
.fly-group {
  margin-bottom: 22px;
}
.fly-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 0;
  margin-bottom: 4px;
  color: var(--rr-muted);
  cursor: pointer;
  background: none;
  border: none;
  text-align: left;
}
.fly-group-head .rr-section-title {
  margin: 0;
}
.fly-group-count {
  margin-left: auto;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.fly-failing {
  margin: 10px 0 10px 18px;
}
.fly-command {
  padding: 6px 10px;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 6px;
  word-break: break-all;
}
</style>
