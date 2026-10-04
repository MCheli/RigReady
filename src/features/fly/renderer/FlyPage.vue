<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { CheckResult } from '../../../core/checks/engine';
import type { CommandPreview } from '../../../core/checks/registry';
import { CHECK_GROUPS, GROUP_TITLES } from '../../../core/profile/schema';
import { onMachineChanged } from '../../../renderer/machine';
import CheckRow from './CheckRow.vue';
import SafeMarkdown from './SafeMarkdown.vue';
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
    return {
      group,
      title: GROUP_TITLES[group],
      items,
      off,
      total: items.length - off,
      passed,
      checking,
      attention,
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
      tone: 'bad',
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
      tone: 'warn',
      icon: 'mdi-check-circle',
      title: 'Ready with warnings',
      count: counts.warnings,
      sub: `${counts.warnings} optional ${counts.warnings === 1 ? 'item needs' : 'items need'} attention`,
    };
  }
  if (fly.readiness === 'ready') {
    return {
      tone: 'ok',
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
    tone: 'idle',
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

async function makeReady(): Promise<void> {
  // Fixes that run a program are asked about first, one by one, showing exactly what runs.
  const approved: string[] = [];
  for (const item of fly.items) {
    const result = fly.results[item.itemId];
    if (!result || result.status === 'pass' || result.fixKind !== 'action' || !result.confirm)
      continue;
    if (await askToRun(result.title, result.confirm)) approved.push(item.itemId);
  }
  await fly.makeReady(approved);
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
  offs.push(onMachineChanged(refresh));
  // A setup edited by hand (or in Configure) shows up here without a restart.
  offs.push(await fly.watch(() => void fly.load()));
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener('focus', refresh);
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

    <div
      v-else-if="fly.profiles.length === 0 && fly.invalid.length === 0"
      class="rr-panel rr-empty"
      data-testid="fly-empty"
    >
      <v-icon icon="mdi-airplane-takeoff" size="40" class="mb-3" />
      <h2 class="rr-page-title">No setups yet</h2>
      <p class="mb-5">
        Get the rig the way you fly or race — devices plugged in, helper apps running, monitors
        arranged — then capture it.
      </p>
      <v-btn color="primary" to="/configure/profiles/capture" data-testid="fly-create">
        New setup from this rig
      </v-btn>
    </div>

    <div v-else-if="!fly.activeId" class="rr-panel rr-empty" data-testid="fly-all-broken">
      <v-icon icon="mdi-file-alert-outline" size="40" class="mb-3" />
      <h2 class="rr-page-title">No setup can be opened</h2>
      <p class="mb-5">
        Every setup file has a problem. Fix them in Configure, or create a new one.
      </p>
      <v-btn color="primary" to="/configure/profiles">Go to Setups</v-btn>
    </div>

    <template v-else>
      <div class="fly-head">
        <v-select
          :model-value="fly.activeId"
          :items="switcherItems"
          item-title="title"
          item-value="value"
          label="Setup"
          class="fly-switcher"
          hide-details
          data-testid="profile-switcher"
          @update:model-value="fly.select($event)"
        >
          <template #item="{ props: itemProps, item }">
            <!-- A broken file cannot be chosen, but says why when pointed at. -->
            <v-tooltip v-if="item.disabled" :text="item.reason" location="end" max-width="420">
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
        <div
          class="fly-status"
          :class="`fly-status-${headline.tone}`"
          data-testid="fly-status"
          :data-ready="fly.readiness === undefined ? undefined : fly.readiness !== 'notReady'"
        >
          <v-progress-circular v-if="headline.tone === 'idle'" indeterminate size="30" width="3" />
          <v-icon v-else :icon="headline.icon" size="34" />
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
        <v-menu location="bottom end">
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              icon="mdi-dots-vertical"
              variant="text"
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
                fly.minimizeOnLaunch ? 'mdi-checkbox-marked-outline' : 'mdi-checkbox-blank-outline'
              "
              title="Hide RigReady after Launch"
              data-testid="fly-minimize-pref"
              @click="fly.setMinimizeOnLaunch(!fly.minimizeOnLaunch)"
            />
          </v-list>
        </v-menu>
      </div>

      <div class="fly-actions">
        <v-btn
          color="primary"
          :variant="fly.counts.fixable > 0 ? 'flat' : 'tonal'"
          prepend-icon="mdi-wrench-check"
          :disabled="fly.counts.fixable === 0 || fly.busy !== null"
          :loading="fly.busy === 'makeReady'"
          data-testid="make-ready"
          @click="makeReady"
        >
          Make ready
        </v-btn>
        <v-tooltip
          v-if="fly.active?.canLaunch"
          :text="fly.view?.launchLabel ? `Starts ${fly.view.launchLabel}` : 'Starts the game'"
          location="bottom"
        >
          <template #activator="{ props: tip }">
            <v-btn
              v-bind="tip"
              :color="fly.readiness === 'notReady' ? undefined : 'success'"
              :variant="fly.readiness === 'notReady' ? 'tonal' : 'flat'"
              prepend-icon="mdi-rocket-launch"
              :disabled="fly.busy !== null"
              :loading="fly.busy === 'launch'"
              data-testid="launch"
              @click="onLaunch"
            >
              Launch
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

      <div v-if="fly.activity" class="rr-panel fly-activity" data-testid="fly-activity">
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
          <v-progress-circular v-if="entry.state === 'running'" indeterminate size="18" width="2" />
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
            v-for="item in group.items"
            :key="item.itemId"
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
.fly-head {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 16px;
}
.switcher-invalid {
  opacity: 0.6;
  cursor: not-allowed;
}
.fly-switcher {
  max-width: 320px;
  flex: none;
  width: 320px;
}
.fly-status {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  padding: 10px 16px;
  border-radius: var(--rr-radius);
  border: 1px solid var(--rr-border);
  background: var(--rr-surface);
  min-height: 64px;
}
.fly-status-ok {
  border-color: color-mix(in srgb, var(--rr-ok) 45%, transparent);
  color: var(--rr-ok);
}
.fly-status-warn {
  border-color: color-mix(in srgb, var(--rr-warn) 45%, transparent);
  color: var(--rr-warn);
}
.fly-status-bad {
  border-color: color-mix(in srgb, var(--rr-bad) 45%, transparent);
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
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
}
.fly-status-sub {
  font-size: 13px;
  color: var(--rr-muted);
}
.fly-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
}
.fly-activity {
  margin-bottom: 24px;
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
