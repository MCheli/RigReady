<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { CHECK_GROUPS, GROUP_TITLES } from '../../../core/profile/schema';
import { onMachineChanged } from '../../../renderer/machine';
import { useFlyStore } from './store';

const fly = useFlyStore();
const confirmLaunch = ref(false);
/** Groups opened or closed by hand; otherwise a group is open only while something in it needs attention. */
const toggled = ref<Record<string, boolean>>({});

const groups = computed(() => {
  const results = fly.report?.results ?? [];
  return CHECK_GROUPS.map((group) => {
    const own = results.filter((r) => r.group === group);
    const passed = own.filter((r) => r.status === 'pass').length;
    return {
      group,
      title: GROUP_TITLES[group],
      results: own,
      passed,
      open: toggled.value[group] ?? passed < own.length,
    };
  }).filter((g) => g.results.length > 0);
});

function toggle(group: string, open: boolean): void {
  toggled.value = { ...toggled.value, [group]: !open };
}

const headline = computed(() => {
  const report = fly.report;
  if (!report) return { tone: 'idle', icon: 'mdi-timer-sand', title: 'Checking…', sub: '' };
  if (report.ready) {
    return {
      tone: 'ok',
      icon: 'mdi-check-circle',
      title: 'Ready',
      sub:
        report.warnings > 0
          ? `${report.warnings} optional ${report.warnings === 1 ? 'item needs' : 'items need'} attention`
          : 'Everything this setup needs is in place',
    };
  }
  return {
    tone: 'bad',
    icon: 'mdi-close-circle',
    title: 'Not ready',
    sub: `${report.failed} ${report.failed === 1 ? 'problem' : 'problems'}${
      report.warnings > 0 ? ` · ${report.warnings} optional` : ''
    }`,
  };
});

const ICONS = { pass: 'mdi-check-circle', fail: 'mdi-close-circle', warn: 'mdi-alert' } as const;
const TONES = { pass: 'rr-ok', fail: 'rr-bad', warn: 'rr-warn' } as const;

function onLaunch(): void {
  if (fly.report && !fly.report.ready) confirmLaunch.value = true;
  else void fly.launch();
}

function launchAnyway(): void {
  confirmLaunch.value = false;
  void fly.launch();
}

let timer: ReturnType<typeof setInterval> | undefined;
let stopListening: (() => void) | undefined;
const refresh = (): void => void fly.check(true);

onMounted(async () => {
  await fly.load();
  // Devices get plugged in and apps get closed while this screen is open.
  timer = setInterval(refresh, 5000);
  window.addEventListener('focus', refresh);
  stopListening = onMachineChanged(refresh);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener('focus', refresh);
  stopListening?.();
});
</script>

<template>
  <div class="rr-page fly" data-testid="fly-page">
    <v-alert v-if="fly.error" type="error" variant="tonal" class="mb-4" data-testid="fly-error">
      {{ fly.error }}
    </v-alert>

    <div v-if="fly.busy === 'loading'" class="rr-empty">Loading…</div>

    <div v-else-if="fly.profiles.length === 0" class="rr-panel rr-empty" data-testid="fly-empty">
      <v-icon icon="mdi-airplane-takeoff" size="40" class="mb-3" />
      <h2 class="rr-page-title">No setups yet</h2>
      <p class="mb-5">
        Get the rig the way you fly or race — devices plugged in, helper apps running, monitors
        arranged — then capture it.
      </p>
      <v-btn color="primary" to="/configure/profiles/capture" data-testid="fly-create">
        Create a setup from this rig
      </v-btn>
    </div>

    <template v-else>
      <div class="fly-head">
        <v-select
          :model-value="fly.activeId"
          :items="fly.profiles"
          item-title="name"
          item-value="id"
          label="Setup"
          class="fly-switcher"
          data-testid="profile-switcher"
          @update:model-value="fly.select($event)"
        />
        <div
          class="fly-status"
          :class="`fly-status-${headline.tone}`"
          data-testid="fly-status"
          :data-ready="fly.report?.ready"
        >
          <v-icon :icon="headline.icon" size="34" />
          <div>
            <div class="fly-status-title" data-testid="fly-status-title">{{ headline.title }}</div>
            <div class="fly-status-sub" data-testid="fly-status-sub">{{ headline.sub }}</div>
          </div>
        </div>
      </div>

      <div class="fly-actions">
        <v-btn
          color="primary"
          :variant="fly.report && fly.report.fixable > 0 ? 'flat' : 'tonal'"
          prepend-icon="mdi-wrench-check"
          :disabled="!fly.report || fly.report.fixable === 0 || fly.busy !== null"
          :loading="fly.busy === 'makeReady'"
          data-testid="make-ready"
          @click="fly.makeReady()"
        >
          Make ready
        </v-btn>
        <v-btn
          v-if="fly.active?.canLaunch"
          :color="fly.report?.ready ? 'success' : undefined"
          :variant="fly.report?.ready ? 'flat' : 'tonal'"
          prepend-icon="mdi-rocket-launch"
          :disabled="fly.busy !== null"
          :loading="fly.busy === 'launch'"
          data-testid="launch"
          @click="onLaunch"
        >
          Launch
        </v-btn>
        <v-spacer />
        <v-btn
          variant="text"
          prepend-icon="mdi-refresh"
          :disabled="fly.busy !== null"
          data-testid="recheck"
          @click="fly.check()"
        >
          Check again
        </v-btn>
        <v-btn
          variant="tonal"
          prepend-icon="mdi-power-standby"
          :disabled="fly.busy !== null"
          :loading="fly.busy === 'standDown'"
          data-testid="stand-down"
          @click="fly.standDown()"
        >
          Stand down
        </v-btn>
      </div>

      <div v-if="fly.activity" class="rr-panel fly-activity" data-testid="fly-activity">
        <div class="fly-activity-head">
          <span class="rr-section-title">{{ fly.activity.title }}</span>
          <v-btn
            icon="mdi-close"
            size="x-small"
            variant="text"
            aria-label="Dismiss"
            @click="fly.activity = undefined"
          />
        </div>
        <div v-if="fly.activity.steps.length === 0" class="rr-row rr-muted">
          There was nothing to do.
        </div>
        <div
          v-for="step in fly.activity.steps"
          :key="step.itemId"
          class="rr-row"
          :data-testid="`step-${step.ok ? 'ok' : 'failed'}`"
        >
          <v-icon
            :icon="step.ok ? 'mdi-check' : 'mdi-alert-circle'"
            :class="step.ok ? 'rr-ok' : 'rr-bad'"
            size="20"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">{{ step.message }}</div>
            <div class="rr-row-sub">{{ step.title }}</div>
          </div>
        </div>
      </div>

      <div v-if="fly.report && fly.report.results.length === 0" class="rr-panel rr-empty">
        This setup has no checks yet. Add some in Configure.
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
          <span class="fly-group-count" :class="{ 'rr-ok': group.passed === group.results.length }">
            {{ group.passed }} of {{ group.results.length }} OK
          </span>
        </button>
        <div v-if="group.open" class="rr-panel">
          <div
            v-for="result in group.results"
            :key="result.itemId"
            class="rr-row"
            data-testid="check-row"
            :data-status="result.status"
            :data-title="result.title"
          >
            <v-icon :icon="ICONS[result.status]" :class="TONES[result.status]" size="22" />
            <div class="rr-row-main">
              <div class="rr-row-title">
                {{ result.title }}
                <span v-if="!result.required" class="fly-optional">optional</span>
              </div>
              <div class="rr-row-sub" :class="result.status === 'pass' ? '' : TONES[result.status]">
                {{ result.summary }}
              </div>
              <ul v-if="result.details.length" class="fly-details">
                <li v-for="line in result.details" :key="line">{{ line }}</li>
              </ul>
            </div>
            <div v-if="result.fix" class="fly-fix" data-testid="check-fix">
              <v-icon icon="mdi-wrench-outline" size="15" /> {{ result.fix }}
            </div>
          </div>
        </div>
      </section>
    </template>

    <v-dialog v-model="confirmLaunch" max-width="460">
      <v-card data-testid="launch-warning">
        <v-card-title>Launch anyway?</v-card-title>
        <v-card-text>
          {{ fly.active?.name }} is not ready: {{ fly.report?.failed }}
          {{ fly.report?.failed === 1 ? 'required check is' : 'required checks are' }} not met. You
          can still launch.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="launch-cancel" @click="confirmLaunch = false"
            >Cancel</v-btn
          >
          <v-btn color="warning" data-testid="launch-anyway" @click="launchAnyway"
            >Launch anyway</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.fly-head {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 16px;
}
.fly-switcher {
  max-width: 320px;
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
}
.fly-status-ok {
  border-color: color-mix(in srgb, var(--rr-ok) 45%, transparent);
  color: var(--rr-ok);
}
.fly-status-bad {
  border-color: color-mix(in srgb, var(--rr-bad) 45%, transparent);
  color: var(--rr-bad);
}
.fly-status-title {
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
  justify-content: space-between;
  align-items: center;
  padding: 10px 8px 0 16px;
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
.fly-group .rr-row {
  align-items: flex-start;
}
.fly-group .rr-row > .v-icon {
  margin-top: 2px;
}
.fly-fix {
  margin-top: 2px;
}
.fly-optional {
  margin-left: 8px;
  font-size: 11px;
  color: var(--rr-muted);
  border: 1px solid var(--rr-border);
  border-radius: 4px;
  padding: 0 5px;
}
.fly-details {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.fly-fix {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--rr-accent);
  white-space: nowrap;
}
</style>
