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
import { useInputStore } from './store';

/** One controller in full: every button, axis and hat as the game sees it. */
const props = defineProps<{ device: InputDevice; raw: boolean }>();
const input = useInputStore();

const state = computed(() => {
  void input.versions[props.device.index];
  return input.states.get(props.device.index);
});

const buttons = computed(() =>
  Array.from(
    { length: Math.max(props.device.numButtons, state.value?.buttons.length ?? 0) },
    (_, i) => ({
      i,
      pressed: state.value?.buttons[i] ?? false,
    })
  )
);

const axes = computed(() => {
  void input.versions[props.device.index];
  const count = Math.max(props.device.numAxes, state.value?.axes.length ?? 0);
  return Array.from({ length: count }, (_, i) => {
    const value = state.value?.axes[i];
    const range = input.ranges.get(`${props.device.index}:${i}`);
    return {
      i,
      label: axisLabel(props.device, i),
      game: axisGameName(props.device, i),
      value,
      percent: value === undefined ? undefined : axisPercent(value),
      raw: value === undefined ? undefined : axisRaw(value),
      min: range ? axisPercent(range.min) : undefined,
      max: range ? axisPercent(range.max) : undefined,
      shortfall: rangeShortfall(range),
    };
  });
});

const hats = computed(() =>
  Array.from({ length: Math.max(props.device.numHats, state.value?.hats.length ?? 0) }, (_, i) => {
    const hat = state.value?.hats[i];
    return {
      i,
      label: hatLabel(i),
      direction: hatDirection(hat),
      x: hat?.[0] ?? 0,
      y: hat?.[1] ?? 0,
    };
  })
);

const pressedCount = computed(() => buttons.value.filter((b) => b.pressed).length);
</script>

<template>
  <div class="controller" data-testid="controller-view" :data-index="device.index">
    <div v-if="!state" class="rr-muted controller-waiting">
      Waiting for input from this controller. Press a button or move an axis.
    </div>

    <section v-if="axes.length" class="controller-section">
      <h3 class="rr-section-title">Axes</h3>
      <div v-for="a in axes" :key="a.i" class="axis" data-testid="axis" :data-axis="a.label">
        <div class="axis-name">
          {{ raw ? a.game : a.label }}
        </div>
        <div class="axis-track">
          <div
            v-if="a.min !== undefined && a.max !== undefined"
            class="axis-range"
            :style="{ left: `${a.min}%`, width: `${Math.max(0.5, a.max - a.min)}%` }"
          />
          <div class="axis-centre" />
          <div
            v-if="a.percent !== undefined"
            class="axis-fill"
            :style="{ width: `${a.percent}%` }"
          />
        </div>
        <div class="axis-value rr-mono" data-testid="axis-value">
          <template v-if="a.percent === undefined">–</template>
          <template v-else-if="raw"
            >{{ a.raw }} <span class="rr-muted">· {{ a.percent.toFixed(1) }}%</span></template
          >
          <template v-else>{{ Math.round(a.percent) }}%</template>
        </div>
        <div v-if="a.shortfall" class="axis-note rr-warn" data-testid="axis-shortfall">
          {{ a.shortfall }}
        </div>
      </div>
      <p class="rr-muted controller-hint">
        The shaded band is the range seen since you opened the tester. Sweep an axis end to end to
        check it reaches both ends.
        <a href="#" @click.prevent="input.resetRanges(device.index)">Start the sweep again</a>
      </p>
    </section>

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
          <div class="hat-pad">
            <span
              class="hat-dot"
              :style="{ transform: `translate(${h.x * 14}px, ${-h.y * 14}px)` }"
              :class="{ on: h.direction !== 'centred' }"
            />
          </div>
          <div>
            <div>{{ raw ? `POV${h.i + 1}` : h.label }}</div>
            <div class="rr-muted">{{ h.direction }}</div>
          </div>
        </div>
      </div>
    </section>

    <section v-if="buttons.length" class="controller-section">
      <h3 class="rr-section-title">
        Buttons · {{ buttons.length
        }}<template v-if="pressedCount"> · {{ pressedCount }} pressed</template>
      </h3>
      <div class="buttons">
        <div
          v-for="b in buttons"
          :key="b.i"
          class="button"
          :class="{ pressed: b.pressed, raw }"
          :title="`${buttonLabel(b.i)} (${buttonGameName(b.i)})`"
          data-testid="button"
          :data-button="b.i + 1"
          :data-pressed="b.pressed"
        >
          {{ raw ? buttonGameName(b.i).replace('JOY_', '') : b.i + 1 }}
        </div>
      </div>
    </section>
    <p v-if="!axes.length && !hats.length && !buttons.length" class="rr-muted">
      This controller reports no inputs.
    </p>
  </div>
</template>

<style scoped>
.controller-waiting {
  font-size: 13px;
  margin-bottom: 12px;
}
.controller-section {
  margin-bottom: 18px;
}
.axis {
  display: grid;
  grid-template-columns: 120px 1fr 120px;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  font-size: 13px;
}
.axis-track {
  position: relative;
  height: 12px;
  border-radius: 6px;
  background: var(--rr-surface-2);
  overflow: hidden;
}
.axis-range {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--rr-accent) 22%, transparent);
}
.axis-fill {
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  border-radius: 3px;
  background: var(--rr-accent);
}
.axis-centre {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--rr-border);
}
.axis-value {
  text-align: right;
}
.axis-note {
  grid-column: 2 / 4;
  font-size: 12px;
}
.controller-hint {
  font-size: 12px;
  margin: 6px 0 0;
}
.controller-hint a {
  color: var(--rr-accent);
}
.hats {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}
.hat {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
.hat-pad {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--rr-border);
  background: var(--rr-surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hat-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--rr-muted);
}
.hat-dot.on {
  background: var(--rr-accent);
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
}
.button.raw {
  font-size: 10.5px;
}
.button.pressed {
  background: var(--rr-accent);
  border-color: var(--rr-accent);
  color: #0f1317;
  font-weight: 600;
}
</style>
