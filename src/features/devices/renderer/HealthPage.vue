<script setup lang="ts">
import DeviceTabs from './DeviceTabs.vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { devicesContract } from '../contract';
import {
  NOISE_FULL_PERCENT,
  NOISE_PERCENT,
  remark,
  type Finding,
  type HealthReport,
} from '../core/health';
import ControllerStrip from './ControllerStrip.vue';
import HealthEvidence from './HealthEvidence.vue';
import { useDevicesStore, useInputStore } from './store';

/** "Hands off": RigReady listens while nobody touches anything and reports what moved anyway. */
const SECONDS = 10;
const api = useClient(devicesContract);
const input = useInputStore();
const devicesStore = useDevicesStore();
const running = ref(false);
const remaining = ref(SECONDS);
const report = ref<HealthReport>();
const error = ref<string>();
const marking = ref<string>();
const copied = ref(false);
const copying = ref(false);
let ticker: ReturnType<typeof setInterval> | undefined;
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function run(): Promise<void> {
  error.value = undefined;
  report.value = undefined;
  copied.value = false;
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

// The controllers are shown live while the check listens, so a button that is down or an
// axis that trembles can be seen while it happens.
onMounted(() => {
  if (!devicesStore.overview) void devicesStore.load();
  void input.acquire();
});
onBeforeUnmount(() => {
  clearInterval(ticker);
  clearTimeout(copiedTimer);
  void input.release();
});

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
  copied.value = false;
  report.value = {
    ...report.value,
    findings: report.value.findings.map((f) =>
      keyOf(f) === keyOf(finding) &&
      (f.kind === 'switch' || f.kind === 'stuck' || f.kind === 'expected')
        ? remark(f, expected)
        : f
    ),
  };
}

/** The findings as text on the clipboard, for a forum post or a support request. */
async function copy(): Promise<void> {
  if (!report.value) return;
  copying.value = true;
  error.value = undefined;
  const result = await api.copyHealth({ report: report.value });
  copying.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), 4000);
}

/** Where the 1% limit sits on the bar of a noisy axis. */
const NOISE_LIMIT_AT = (NOISE_PERCENT / NOISE_FULL_PERCENT) * 100;

const sections = computed(() => [
  {
    id: 'stuck',
    title: 'Stuck buttons',
    help: 'Held down the whole time on a stick, throttle or wheel. A stuck or dirty switch, or something resting on it.',
    status: 'rr-bad',
    tone: 'bad',
    icon: 'mdi-alert-circle-outline',
    items: groups.value.stuck,
  },
  {
    id: 'rogue',
    title: 'Rogue inputs',
    help: 'Fired with nobody touching anything. In a game these trigger actions by themselves.',
    status: 'rr-warn',
    tone: 'warn',
    icon: 'mdi-flash-alert-outline',
    items: groups.value.rogue,
  },
  {
    id: 'noisy',
    title: 'Noisy axes',
    help: 'Wandered while untouched. Usually a worn or dirty sensor; a dead zone in the game hides small noise.',
    status: 'rr-warn',
    tone: 'warn',
    icon: 'mdi-sine-wave',
    items: groups.value.noisy,
  },
  {
    id: 'switch',
    title: 'Held (switch?)',
    help: 'Held down on a panel. A toggle switch that is on reads as a held button. If that is what it is, mark it so it is not reported again.',
    status: 'rr-warn',
    tone: 'warn',
    icon: 'mdi-toggle-switch-outline',
    items: groups.value.switch,
  },
]);

const controllerName = (index: number): string => {
  const device = input.deviceFor(index);
  return device ? devicesStore.controllerName(device) : `Controller ${index + 1}`;
};
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

    <template v-if="running">
      <div class="rr-panel health-running" data-testid="health-running">
        <div class="health-count">
          <svg viewBox="0 0 64 64" class="health-ring" aria-hidden="true">
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
      <div
        v-if="input.devices.length"
        class="rr-panel health-live"
        data-testid="health-live"
        aria-hidden="true"
      >
        <div v-for="d in input.devices" :key="d.index" class="health-live-row">
          <div class="health-live-name">{{ controllerName(d.index) }}</div>
          <ControllerStrip :device="d" />
        </div>
      </div>
      <p v-if="input.devices.length" class="rr-muted health-live-note">
        What every controller reports right now. Anything that lights up or moves here while your
        hands are off is what the check is listening for.
      </p>
    </template>

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
        <v-btn
          variant="text"
          :prepend-icon="copied ? 'mdi-check' : 'mdi-content-copy'"
          :loading="copying"
          data-testid="health-copy"
          :data-copied="copied"
          @click="copy"
          >{{ copied ? 'Copied' : 'Copy as text' }}</v-btn
        >
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
            class="finding"
            data-testid="health-finding"
            :data-kind="f.kind"
          >
            <div class="rr-row finding-head">
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
            <div class="finding-body">
              <HealthEvidence v-if="f.evidence" :evidence="f.evidence" :seconds="report.seconds" />
              <div class="finding-measure" data-testid="health-measure">
                <div class="measure-number">{{ f.measure }}</div>
                <div
                  class="measure-bar"
                  :class="s.tone"
                  role="img"
                  :aria-label="`${f.measure} ${f.measureOf}`"
                  data-testid="health-bar"
                  :data-severity="f.severity"
                >
                  <div class="measure-fill" :style="{ width: `${Math.max(2, f.severity)}%` }" />
                  <div
                    v-if="f.kind === 'noisy'"
                    class="measure-limit"
                    :style="{ left: `${NOISE_LIMIT_AT}%` }"
                  />
                </div>
                <div class="measure-of rr-muted">{{ f.measureOf }}</div>
              </div>
            </div>
            <dl class="finding-say">
              <div v-if="f.meaning" data-testid="health-meaning">
                <dt>In a game</dt>
                <dd>{{ f.meaning }}</dd>
              </div>
              <div v-if="f.advice" data-testid="health-advice">
                <dt>What to do</dt>
                <dd>{{ f.advice }}</dd>
              </div>
            </dl>
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
.health-summary {
  gap: 12px;
}
.health-summary .rr-row-main {
  margin-left: 6px;
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
.health-live {
  margin-top: 12px;
  padding: 14px 18px 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 14px 28px;
}
.health-live-row {
  min-width: 0;
}
.health-live-name {
  margin-bottom: 5px;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.health-live-note {
  font-size: 12.5px;
  margin: 8px 2px 0;
}
.finding {
  border-top: 1px solid var(--rr-border);
  padding-bottom: 14px;
}
.finding:first-child {
  border-top: none;
}
.finding-head {
  border-top: none;
}
.finding-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 190px;
  gap: 20px;
  align-items: start;
  padding: 2px 16px 0 52px;
}
.finding-measure {
  min-width: 0;
}
.measure-number {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.measure-bar {
  position: relative;
  height: 6px;
  margin: 7px 0 5px;
  border-radius: 3px;
  background: var(--rr-surface-2);
}
.measure-fill {
  height: 100%;
  border-radius: 3px;
}
.measure-bar.bad .measure-fill {
  background: var(--rr-bad);
}
.measure-bar.warn .measure-fill {
  background: var(--rr-warn);
}
/* Where "fine" ends on the bar of a noisy axis. */
.measure-limit {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  background: var(--rr-text);
  border-radius: 1px;
}
.measure-of {
  font-size: 12px;
  line-height: 1.3;
}
.finding-say {
  margin: 10px 16px 0 52px;
  font-size: 13px;
}
.finding-say > div {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 10px;
  padding: 2px 0;
}
.finding-say dt {
  color: var(--rr-muted);
}
.finding-say dd {
  margin: 0;
}
@media (prefers-reduced-motion: reduce) {
  .ring-fg {
    transition: none;
  }
}
</style>
