<script setup lang="ts">
import DeviceTabs from './DeviceTabs.vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { devicesContract } from '../contract';
import type { Finding, HealthReport } from '../core/health';

/** "Hands off": RigReady listens while nobody touches anything and reports what moved anyway. */
const SECONDS = 10;
const api = useClient(devicesContract);
const running = ref(false);
const remaining = ref(SECONDS);
const report = ref<HealthReport>();
const error = ref<string>();
const marking = ref<string>();
let ticker: ReturnType<typeof setInterval> | undefined;

async function run(): Promise<void> {
  error.value = undefined;
  report.value = undefined;
  running.value = true;
  remaining.value = SECONDS;
  const started = Date.now();
  ticker = setInterval(() => {
    remaining.value = Math.max(0, SECONDS - Math.floor((Date.now() - started) / 1000));
  }, 200);
  const result = await api.healthScan({ seconds: SECONDS });
  clearInterval(ticker);
  running.value = false;
  if (result.ok) report.value = result.value;
  else error.value = errorText(result.error);
}

onBeforeUnmount(() => clearInterval(ticker));

const groups = computed(() => {
  const findings = report.value?.findings ?? [];
  const of = (kind: Finding['kind']): Finding[] => findings.filter((f) => f.kind === kind);
  return {
    stuck: of('stuck'),
    rogue: of('rogue'),
    noisy: of('noisy'),
    switch: of('switch'),
    expected: of('expected'),
  };
});
const problems = computed(
  () =>
    groups.value.stuck.length +
    groups.value.rogue.length +
    groups.value.noisy.length +
    groups.value.switch.length
);

const keyOf = (f: Finding): string => `${f.inputKey}/${f.button}`;

async function mark(finding: Finding, expected: boolean): Promise<void> {
  if (finding.button === undefined || !report.value) return;
  marking.value = keyOf(finding);
  const result = await api.markSwitch({
    inputKey: finding.inputKey,
    button: finding.button,
    expected,
  });
  marking.value = undefined;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  // Move it between the lists without scanning again.
  report.value = {
    ...report.value,
    findings: report.value.findings.map((f) =>
      keyOf(f) === keyOf(finding) &&
      (f.kind === 'switch' || f.kind === 'stuck' || f.kind === 'expected')
        ? { ...f, kind: expected ? 'expected' : 'switch' }
        : f
    ),
  };
}

const sections = computed(() => [
  {
    id: 'stuck',
    title: 'Stuck buttons',
    help: 'Held down the whole time on a stick, throttle or wheel. A stuck or dirty switch, or something resting on it.',
    status: 'rr-bad',
    icon: 'mdi-alert-circle-outline',
    items: groups.value.stuck,
  },
  {
    id: 'rogue',
    title: 'Rogue inputs',
    help: 'Fired with nobody touching anything. In a game these trigger actions by themselves.',
    status: 'rr-warn',
    icon: 'mdi-flash-alert-outline',
    items: groups.value.rogue,
  },
  {
    id: 'noisy',
    title: 'Noisy axes',
    help: 'Wandered while untouched. Usually a worn or dirty sensor; a dead zone in the game hides small noise.',
    status: 'rr-warn',
    icon: 'mdi-sine-wave',
    items: groups.value.noisy,
  },
  {
    id: 'switch',
    title: 'Held (switch?)',
    help: 'Held down on a panel. A toggle switch that is on reads as a held button. If that is what it is, mark it so it is not reported again.',
    status: 'rr-warn',
    icon: 'mdi-toggle-switch-outline',
    items: groups.value.switch,
  },
]);
</script>

<template>
  <div data-testid="health-page">
    <h1 class="rr-page-title">Health check</h1>
    <p class="rr-page-sub">
      Finds stuck buttons, noisy axes and inputs that fire by themselves. RigReady listens to every
      game controller for
      {{ SECONDS }} seconds while nobody touches anything.
    </p>
    <DeviceTabs />

    <div v-if="running" class="rr-panel health-running" data-testid="health-running">
      <div class="health-count">
        <svg viewBox="0 0 64 64" class="health-ring">
          <circle cx="32" cy="32" r="28" class="ring-bg" />
          <circle
            cx="32"
            cy="32"
            r="28"
            class="ring-fg"
            :style="{ strokeDashoffset: `${(1 - remaining / SECONDS) * 176}` }"
          />
        </svg>
        <span>{{ remaining }}</span>
      </div>
      <div>
        <div class="health-big">Hands off</div>
        <div class="rr-muted">
          Don't touch the sticks, pedals, wheel or panels until the count reaches zero.
        </div>
      </div>
    </div>

    <div v-else-if="!report" class="rr-panel health-intro">
      <v-icon icon="mdi-hand-back-left-off-outline" size="36" class="rr-muted" />
      <div class="rr-row-main">
        <div class="rr-row-title">Let go of everything, then start</div>
        <div class="rr-row-sub">
          Switches on panels that are legitimately on are listed separately, and you can mark them
          as normal.
        </div>
      </div>
      <v-btn color="primary" size="large" data-testid="health-start" @click="run"
        >Start the {{ SECONDS }}-second check</v-btn
      >
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mt-4" data-testid="health-error">{{
      error
    }}</v-alert>

    <template v-if="report && !running">
      <div class="rr-panel health-summary" data-testid="health-summary">
        <v-icon
          :icon="problems === 0 ? 'mdi-check-circle-outline' : 'mdi-alert-outline'"
          :class="problems === 0 ? 'rr-ok' : groups.stuck.length ? 'rr-bad' : 'rr-warn'"
          size="28"
        />
        <div class="rr-row-main">
          <div class="rr-row-title" data-testid="health-title">
            {{
              problems === 0
                ? 'All quiet: nothing moved'
                : `${problems} ${problems === 1 ? 'thing needs' : 'things need'} a look`
            }}
          </div>
          <div class="rr-row-sub">
            {{ report.devicesChecked }} game controllers checked for {{ report.seconds }} seconds.
            <template v-if="groups.expected.length">
              {{ groups.expected.length }}
              {{ groups.expected.length === 1 ? 'switch' : 'switches' }} you marked as normally on
              {{ groups.expected.length === 1 ? 'was' : 'were' }} on.
            </template>
          </div>
        </div>
        <v-btn variant="tonal" prepend-icon="mdi-refresh" data-testid="health-again" @click="run"
          >Check again</v-btn
        >
      </div>

      <section
        v-for="s in sections.filter((x) => x.items.length)"
        :key="s.id"
        class="mt-5"
        :data-testid="`health-${s.id}`"
      >
        <h2 class="rr-section-title">{{ s.title }} · {{ s.items.length }}</h2>
        <p class="rr-muted health-help">{{ s.help }}</p>
        <div class="rr-panel">
          <div
            v-for="f in s.items"
            :key="`${f.inputKey}-${f.input}-${f.kind}`"
            class="rr-row"
            data-testid="health-finding"
            :data-kind="f.kind"
          >
            <v-icon :icon="s.icon" :class="s.status" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ f.device }} · {{ f.input }}</div>
              <div class="rr-row-sub">{{ f.detail }}</div>
            </div>
            <v-btn
              v-if="f.button !== undefined && (f.kind === 'switch' || f.kind === 'stuck')"
              size="small"
              variant="tonal"
              :loading="marking === keyOf(f)"
              data-testid="health-mark-switch"
              @click="mark(f, true)"
              >It's a switch that is on</v-btn
            >
          </div>
        </div>
      </section>

      <section v-if="groups.expected.length" class="mt-5" data-testid="health-expected">
        <h2 class="rr-section-title">
          Switches marked as normally on · {{ groups.expected.length }}
        </h2>
        <div class="rr-panel">
          <div v-for="f in groups.expected" :key="`${f.inputKey}-${f.input}`" class="rr-row">
            <v-icon icon="mdi-toggle-switch" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ f.device }} · {{ f.input }}</div>
              <div class="rr-row-sub">Not reported as a problem.</div>
            </div>
            <v-btn
              size="small"
              variant="text"
              :loading="marking === keyOf(f)"
              @click="mark(f, false)"
              >Report it again</v-btn
            >
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.health-intro,
.health-summary,
.health-running {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 20px;
}
.health-running {
  border-color: color-mix(in srgb, var(--rr-accent) 55%, transparent);
}
.health-count {
  position: relative;
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.health-ring {
  position: absolute;
  inset: 0;
  transform: rotate(-90deg);
}
.ring-bg,
.ring-fg {
  fill: none;
  stroke-width: 5;
}
.ring-bg {
  stroke: var(--rr-surface-2);
}
.ring-fg {
  stroke: var(--rr-accent);
  stroke-dasharray: 176;
  transition: stroke-dashoffset 0.2s linear;
}
.health-big {
  font-size: 20px;
  font-weight: 600;
}
.health-help {
  font-size: 12.5px;
  margin: -2px 0 8px;
}
</style>
