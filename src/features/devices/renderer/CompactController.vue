<script setup lang="ts">
import { computed } from 'vue';
import type { InputDevice } from '../../../shared/models';
import { axisLabel, axisPercent, hatDirection, hatLabel } from '../core/input';
import { useInputStore } from './store';

/** One line per controller in the all-devices view: lights up when it is used. */
const props = defineProps<{ device: InputDevice; name: string; recent: boolean }>();
const emit = defineEmits<{ open: [] }>();
const input = useInputStore();

const view = computed(() => {
  void input.versions[props.device.index];
  const state = input.states.get(props.device.index);
  const pressed = state ? state.buttons.flatMap((b, i) => (b ? [i + 1] : [])) : [];
  return {
    has: state !== undefined,
    pressed,
    axes: (state?.axes ?? []).map((v, i) => ({
      i,
      label: axisLabel(props.device, i),
      percent: axisPercent(v),
    })),
    hats: (state?.hats ?? [])
      .map((h, i) => ({ label: hatLabel(i), direction: hatDirection(h) }))
      .filter((h) => h.direction !== 'centred'),
  };
});
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const counts = computed(() =>
  [
    plural(props.device.numAxes, 'axis', 'axes'),
    plural(props.device.numButtons, 'button', 'buttons'),
    ...(props.device.numHats ? [plural(props.device.numHats, 'hat', 'hats')] : []),
  ].join(' · ')
);
</script>

<template>
  <button
    type="button"
    class="compact"
    :class="{ recent }"
    data-testid="compact-controller"
    :data-index="device.index"
    :data-name="name"
    :data-active="recent"
    @click="emit('open')"
  >
    <div class="compact-name">
      <div class="rr-row-title">{{ name }}</div>
      <div class="rr-row-sub">
        {{ counts }}
      </div>
    </div>
    <div class="compact-axes">
      <div
        v-for="a in view.axes"
        :key="a.i"
        class="compact-axis"
        :title="`${a.label} ${Math.round(a.percent)}%`"
      >
        <div class="compact-axis-fill" :style="{ height: `${a.percent}%` }" />
      </div>
    </div>
    <div class="compact-state" data-testid="compact-state">
      <template v-if="!view.has"><span class="rr-muted">No input yet</span></template>
      <template v-else>
        <span v-if="view.pressed.length" class="compact-pressed">
          Button{{ view.pressed.length > 1 ? 's' : '' }} {{ view.pressed.slice(0, 8).join(', ')
          }}{{ view.pressed.length > 8 ? ` +${view.pressed.length - 8}` : '' }}
        </span>
        <span v-for="h in view.hats" :key="h.label" class="compact-pressed"
          >{{ h.label }} {{ h.direction }}</span
        >
        <span v-if="!view.pressed.length && !view.hats.length" class="rr-muted"
          >Nothing pressed</span
        >
      </template>
    </div>
    <v-icon icon="mdi-chevron-right" class="rr-muted" size="18" />
  </button>
</template>

<style scoped>
.compact {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 9px 16px;
  border: none;
  border-top: 1px solid var(--rr-border);
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.25s,
    box-shadow 0.25s;
}
.compact:first-child {
  border-top: none;
}
.compact:hover {
  background: var(--rr-surface-2);
}
.compact.recent {
  background: color-mix(in srgb, var(--rr-accent) 13%, var(--rr-surface));
  box-shadow: inset 3px 0 0 var(--rr-accent);
}
.compact-name {
  width: 300px;
  flex-shrink: 0;
  min-width: 0;
}
.compact-name .rr-row-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.compact-axes {
  display: flex;
  gap: 3px;
  width: 92px;
  height: 26px;
  flex-shrink: 0;
}
.compact-axis {
  position: relative;
  width: 8px;
  height: 100%;
  border-radius: 2px;
  background: var(--rr-surface-2);
  overflow: hidden;
}
.compact-axis-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--rr-accent);
  opacity: 0.85;
}
.compact-state {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
}
.compact-pressed {
  color: var(--rr-accent);
  font-weight: 500;
}
</style>
