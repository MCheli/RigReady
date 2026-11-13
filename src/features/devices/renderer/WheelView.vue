<script setup lang="ts">
import { computed } from 'vue';
import type { InputDevice } from '../../../shared/models';
import { axisRaw, axisWindowsLabel } from '../core/input';
import {
  clutchAxis,
  pedalTravel,
  steering,
  type WheelAxis,
  type WheelAxisRole,
} from '../core/wheelAxes';
import { useInputStore } from './store';

/**
 * A wheel base the way it is used: the steering as a wheel that turns, the pedals as bars
 * that fill while they are pressed. Shown in place of the stick plot for a base whose axes
 * RigReady has a source for (../core/wheelAxes.ts).
 *
 * The picture turns a quarter turn each way at the ends of the travel. Windows reports the
 * share of the travel, not degrees: how far the rim really turns is set on the base and is
 * not read, so no angle is written.
 */
const props = defineProps<{ device: InputDevice; axes: WheelAxis[]; raw: boolean }>();
const input = useInputStore();

/** How far the picture turns at the end of the travel, in degrees. */
const PICTURE_TURN = 90;
/** Left to right, as the pedals stand under the feet. */
const PEDALS: WheelAxisRole[] = ['clutch', 'brake', 'accelerator'];

const state = computed(() => {
  void input.versions[props.device.index];
  return input.states.get(props.device.index);
});

const wheel = computed(() => {
  const axis = props.axes.find((a) => a.role === 'steering');
  const value = axis ? state.value?.axes[axis.index] : undefined;
  if (value === undefined) return undefined;
  const turn = steering(value);
  return {
    ...turn,
    angle: Math.max(-1, Math.min(1, value)) * PICTURE_TURN,
    raw: axisRaw(value),
  };
});

/** The clutch can be on two axes, by the base's pedal mode; the bar follows the one that moves. */
const clutchOnTwo = computed(
  () =>
    props.axes.some((a) => a.role === 'clutch') &&
    props.axes.some((a) => a.role === 'clutchOrCombined')
);

const pedals = computed(() => {
  void input.versions[props.device.index];
  const key = (index: number): string => `${props.device.index}:${index}`;
  return PEDALS.flatMap((role) => {
    const axis =
      role === 'clutch'
        ? clutchAxis(props.axes, (index) => ({
            rest: input.rests.get(key(index)),
            range: input.ranges.get(key(index)),
          }))
        : props.axes.find((a) => a.role === role);
    if (!axis) return [];
    const value = state.value?.axes[axis.index];
    const rest = input.rests.get(key(axis.index));
    const percent = value === undefined ? undefined : Math.round(pedalTravel(value, rest) * 100);
    return [
      {
        role,
        // Y keeps its axis name ("Clutch or combined pedals") below; as the bar it is the clutch.
        name: role === 'clutch' ? 'Clutch' : axis.name,
        /** What Windows calls the axis the bar reads: "Y axis", "Slider 1". */
        from: axisWindowsLabel(props.device, axis.index),
        axis: props.device.axisNames[axis.index],
        percent,
        raw: value === undefined ? undefined : axisRaw(value),
      },
    ];
  });
});
</script>

<template>
  <section class="controller-section" data-testid="tester-wheel">
    <h3 class="rr-section-title">Wheel and pedals</h3>
    <svg
      class="wheel"
      viewBox="-50 -50 100 100"
      role="img"
      :aria-label="wheel ? `Steering: ${wheel.text}` : 'Steering: no reading yet'"
      data-testid="tester-wheel-rim"
      :data-side="wheel?.side"
    >
      <!-- Stays put: where the top of the rim is when the wheel is straight. -->
      <path class="wheel-straight" d="M 0 -49 L 0 -43" />
      <g :transform="`rotate(${wheel?.angle ?? 0})`">
        <circle r="36" class="wheel-rim" />
        <path class="wheel-spoke" d="M -32 0 L -9 0 M 9 0 L 32 0 M 0 9 L 0 32" />
        <circle r="9" class="wheel-hub" />
        <!-- Turns with the rim: the mark at its top. -->
        <path class="wheel-top" d="M 0 -40 L 0 -32" />
      </g>
    </svg>
    <div class="wheel-readout rr-mono" data-testid="tester-wheel-steering">
      <template v-if="!wheel">–</template>
      <template v-else-if="raw"
        >{{ wheel.raw }} <span class="rr-muted">· {{ wheel.text }}</span></template
      >
      <template v-else>{{ wheel.text }}</template>
    </div>

    <div v-if="pedals.length" class="pedals">
      <div
        v-for="p in pedals"
        :key="p.role"
        class="pedal"
        data-testid="tester-pedal"
        :data-pedal="p.name"
        :data-axis="p.axis"
        :data-percent="p.percent"
      >
        <div class="pedal-bar">
          <div class="pedal-fill" :style="{ height: `${p.percent ?? 0}%` }" />
        </div>
        <div class="pedal-value rr-mono">
          <template v-if="p.percent === undefined">–</template>
          <template v-else-if="raw">{{ p.raw }}</template>
          <template v-else>{{ p.percent }}%</template>
        </div>
        <div class="pedal-name">{{ p.name }}</div>
        <div class="pedal-from rr-muted" data-testid="tester-pedal-from">{{ p.from }}</div>
      </div>
    </div>

    <p class="rr-muted wheel-note" data-testid="tester-wheel-note">
      Steering is the share of the travel to one side, not degrees. RigReady does not read the
      rotation set on the base.
      <template v-if="pedals.length">
        Each bar counts from where its pedal was at the first reading. If a bar looks the wrong way
        round, let go of the pedals and choose Start again.
      </template>
      <template v-if="clutchOnTwo">
        The clutch is on the Y axis or on Slider 1, depending on the base's pedal mode, which
        Windows does not report. The Clutch bar reads the one that moves.
      </template>
    </p>
  </section>
</template>

<style scoped>
.wheel {
  display: block;
  width: 148px;
  height: 148px;
  margin: 0 auto;
}
.wheel-straight {
  stroke: var(--rr-muted);
  stroke-width: 2;
  stroke-linecap: round;
}
.wheel-rim {
  fill: none;
  stroke: var(--rr-text);
  stroke-width: 7;
}
.wheel-spoke {
  stroke: var(--rr-text);
  stroke-width: 5;
  stroke-linecap: round;
  fill: none;
}
.wheel-hub {
  fill: var(--rr-surface-2);
  stroke: var(--rr-text);
  stroke-width: 3;
}
.wheel-top {
  stroke: var(--rr-accent);
  stroke-width: 4;
}
.wheel-readout {
  margin-top: 6px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.pedals {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 8px;
  margin-top: 16px;
}
.pedal {
  display: grid;
  justify-items: center;
  gap: 4px;
  font-size: 12px;
  min-width: 0;
}
.pedal-bar {
  position: relative;
  width: 26px;
  height: 96px;
  border-radius: 6px;
  border: 1px solid var(--rr-border);
  background: var(--rr-surface-2);
  overflow: hidden;
}
.pedal-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--rr-accent);
}
.pedal-value {
  font-variant-numeric: tabular-nums;
}
.pedal-name {
  text-align: center;
  overflow-wrap: anywhere;
}
.pedal-from {
  font-size: var(--rr-text-xs);
  text-align: center;
  overflow-wrap: anywhere;
}
.wheel-note {
  font-size: 12px;
  margin: 14px 0 0;
}
</style>
