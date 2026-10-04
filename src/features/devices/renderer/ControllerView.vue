<script setup lang="ts">
import { computed } from 'vue';
import type { InputDevice } from '../../../shared/models';
import {
  axisGameName,
  axisLabel,
  axisPercent,
  axisRaw,
  buttonGameName,
  buttonLabel,
  hatDirection,
  hatLabel,
  rangeShortfall,
} from '../core/input';
import { HAT_POINTS } from '../core/trace';
import AxisTrace from './AxisTrace.vue';
import { useReducedMotion } from './canvas';
import HatRose from './HatRose.vue';
import StickPlot from './StickPlot.vue';
import { useInputStore } from './store';

/**
 * One controller in full, as a game sees it: each axis as a live trace with the range it
 * has reached, two axes against each other as a stick plot, hats as compass roses, and
 * every button lit while it is down and marked once it has been pressed.
 */
const props = defineProps<{ device: InputDevice; raw: boolean }>();
const input = useInputStore();
const reduced = useReducedMotion();

const state = computed(() => {
  void input.versions[props.device.index];
  return input.states.get(props.device.index);
});

const buttons = computed(() => {
  void input.versions[props.device.index];
  const tried = input.tried.get(props.device.index);
  return Array.from(
    { length: Math.max(props.device.numButtons, state.value?.buttons.length ?? 0) },
    (_, i) => ({
      i,
      pressed: state.value?.buttons[i] ?? false,
      tried: tried?.has(i) ?? false,
    })
  );
});

/** A range is worth showing in numbers once the axis has moved more than a wobble. */
const MOVED = 0.04;

const axes = computed(() => {
  void input.versions[props.device.index];
  const count = Math.max(props.device.numAxes, state.value?.axes.length ?? 0);
  return Array.from({ length: count }, (_, i) => {
    const value = state.value?.axes[i];
    const range = input.ranges.get(`${props.device.index}:${i}`);
    const moved = range !== undefined && range.max - range.min > MOVED;
    return {
      i,
      label: axisLabel(props.device, i),
      game: axisGameName(props.device, i),
      percent: value === undefined ? undefined : axisPercent(value),
      raw: value === undefined ? undefined : axisRaw(value),
      reach: !moved
        ? undefined
        : props.raw
          ? `${axisRaw(range.min)} to ${axisRaw(range.max)}`
          : `${Math.round(axisPercent(range.min))} to ${Math.round(axisPercent(range.max))}%`,
      shortfall: rangeShortfall(range),
    };
  });
});

const hats = computed(() =>
  Array.from({ length: Math.max(props.device.numHats, state.value?.hats.length ?? 0) }, (_, i) => {
    const direction = hatDirection(state.value?.hats[i]);
    return {
      i,
      label: hatLabel(i),
      direction,
      code: HAT_POINTS.find((p) => p.direction === direction)?.code,
    };
  })
);

const pressedCount = computed(() => buttons.value.filter((b) => b.pressed).length);
const triedCount = computed(() => buttons.value.filter((b) => b.tried).length);

// ---- two axes against each other ----
const pair = computed(() => input.pairFor(props.device));
const axisItems = computed(() =>
  axes.value.map((a) => ({ title: props.raw ? a.game : a.label, value: a.i }))
);
function choose(which: 'x' | 'y', axis: number): void {
  if (!pair.value) return;
  input.choosePair(props.device.index, { ...pair.value, [which]: axis });
}
const position = computed(() => {
  if (!pair.value) return undefined;
  const x = axes.value[pair.value.x];
  const y = axes.value[pair.value.y];
  if (x?.percent === undefined || y?.percent === undefined) return undefined;
  return props.raw ? `${x.raw}, ${y.raw}` : `${Math.round(x.percent)}%, ${Math.round(y.percent)}%`;
});
</script>

<template>
  <div
    class="controller"
    :class="{ 'raw-wide': raw }"
    data-testid="controller-view"
    :data-index="device.index"
    :data-motion="reduced ? 'reduced' : 'full'"
  >
    <div v-if="!state" class="rr-muted controller-waiting">
      Waiting for input from this controller. Press a button or move an axis.
    </div>

    <div v-if="axes.length" class="controller-top" :class="{ 'with-plot': pair }">
      <section v-if="pair" class="controller-section" data-testid="plot-section">
        <h3 class="rr-section-title">Two axes together</h3>
        <StickPlot :index="device.index" :x="pair.x" :y="pair.y" :reduced="reduced" />
        <div class="plot-readout rr-mono" data-testid="plot-position">
          {{ position ?? '–' }}
        </div>
        <div class="plot-pick">
          <v-select
            label="Across"
            :items="axisItems"
            :model-value="pair.x"
            density="compact"
            variant="outlined"
            hide-details
            data-testid="plot-x"
            @update:model-value="choose('x', Number($event))"
          />
          <v-select
            label="Up and down"
            :items="axisItems"
            :model-value="pair.y"
            density="compact"
            variant="outlined"
            hide-details
            data-testid="plot-y"
            @update:model-value="choose('y', Number($event))"
          />
        </div>
      </section>

      <section class="controller-section">
        <h3 class="rr-section-title">Axes</h3>
        <div v-for="a in axes" :key="a.i" class="axis" data-testid="axis" :data-axis="a.label">
          <div class="axis-name">
            {{ raw ? a.game : a.label }}
          </div>
          <AxisTrace :index="device.index" :axis="a.i" :reduced="reduced" />
          <div class="axis-numbers">
            <div class="axis-value rr-mono" data-testid="axis-value">
              <template v-if="a.percent === undefined">–</template>
              <template v-else-if="raw"
                >{{ a.raw }} <span class="rr-muted">· {{ a.percent.toFixed(1) }}%</span></template
              >
              <template v-else>{{ Math.round(a.percent) }}%</template>
            </div>
            <div v-if="a.reach" class="axis-reach rr-muted" data-testid="axis-reach">
              {{ a.reach }}
            </div>
          </div>
          <div v-if="a.shortfall" class="axis-note rr-warn" data-testid="axis-shortfall">
            {{ a.shortfall }}
          </div>
        </div>
      </section>
    </div>

    <section v-if="hats.length" class="controller-section">
      <h3 class="rr-section-title">Hats</h3>
      <div class="hats">
        <div
          v-for="h in hats"
          :key="h.i"
          class="hat"
          data-testid="hat"
          :data-direction="h.direction"
        >
          <HatRose :direction="h.direction" />
          <div>
            <div>{{ raw ? `POV${h.i + 1}` : h.label }}</div>
            <div :class="h.direction === 'centred' ? 'rr-muted' : 'hat-on'">
              {{ raw && h.code ? `${h.direction} · ${h.code}` : h.direction }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <section v-if="buttons.length" class="controller-section">
      <h3 class="rr-section-title">
        Buttons · {{ buttons.length
        }}<template v-if="pressedCount"> · {{ pressedCount }} pressed</template>
        <span class="buttons-tried" data-testid="buttons-tried"
          >{{ triedCount }} of {{ buttons.length }} tried</span
        >
      </h3>
      <div class="buttons">
        <div
          v-for="b in buttons"
          :key="b.i"
          class="button"
          :class="{ pressed: b.pressed, tried: b.tried, raw }"
          :title="`${buttonLabel(b.i)} (${buttonGameName(b.i)})`"
          data-testid="button"
          :data-button="b.i + 1"
          :data-pressed="b.pressed"
          :data-tried="b.tried"
        >
          {{ raw ? buttonGameName(b.i).replace('JOY_', '') : b.i + 1 }}
        </div>
      </div>
    </section>

    <p v-if="!axes.length && !hats.length && !buttons.length" class="rr-muted">
      This controller reports no inputs.
    </p>
    <p v-else class="rr-muted controller-hint">
      <template v-if="axes.length">
        The shaded band on an axis is the range it has reached since you opened the tester: sweep it
        end to end to check it gets to both ends.
      </template>
      <template v-if="buttons.length">
        A button keeps its outline once it has been pressed, so the ones you have not tried stand
        out.
      </template>
      <a href="#" data-testid="tester-start-again" @click.prevent="input.startAgain(device.index)"
        >Start again</a
      >
    </p>
  </div>
</template>

<style scoped>
.controller-waiting {
  font-size: 13px;
  margin-bottom: 12px;
}
.controller-section {
  margin-bottom: 20px;
  min-width: 0;
}
.controller-top.with-plot {
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr);
  gap: 0 28px;
  align-items: start;
}
.plot-readout {
  margin-top: 6px;
  text-align: center;
  color: var(--rr-muted);
  font-variant-numeric: tabular-nums;
}
.plot-pick {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}
.plot-pick :deep(.v-field) {
  font-size: 13px;
}
.axis {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr) 76px;
  align-items: center;
  gap: 2px 12px;
  padding: 4px 0;
  font-size: 13px;
}
.raw-wide .axis {
  grid-template-columns: 84px minmax(0, 1fr) 118px;
}
.axis-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.axis-numbers {
  text-align: right;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}
.axis-value {
  font-size: 12.5px;
}
.axis-reach {
  font-size: 11px;
  white-space: nowrap;
}
.axis-note {
  grid-column: 2 / 4;
  font-size: 12px;
}
.controller-hint {
  font-size: 12px;
  margin: 0;
}
.controller-hint a {
  color: var(--rr-accent);
}
.hats {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
}
.hat {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 13px;
}
.hat-on {
  color: var(--rr-accent);
  font-weight: 500;
}
.buttons-tried {
  float: right;
  font-weight: 500;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}
.buttons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px;
}
.button {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid var(--rr-border);
  background: var(--rr-surface-2);
  color: var(--rr-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  /* Letting go fades; pressing does not wait. */
  transition:
    background-color 0.18s ease-out,
    border-color 0.18s ease-out,
    color 0.18s ease-out;
}
.button.raw {
  font-size: 10.5px;
}
.button.tried {
  border-color: color-mix(in srgb, var(--rr-accent) 62%, transparent);
  background: color-mix(in srgb, var(--rr-accent) 9%, var(--rr-surface-2));
  color: var(--rr-text);
}
.button.pressed {
  background: var(--rr-accent);
  border-color: var(--rr-accent);
  color: var(--rr-bg);
  font-weight: 600;
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .button {
    transition: none;
  }
}
</style>
