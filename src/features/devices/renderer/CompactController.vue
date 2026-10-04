<script setup lang="ts">
import { computed } from 'vue';
import type { InputDevice } from '../../../shared/models';
import { hatDirection, hatLabel } from '../core/input';
import ControllerStrip from './ControllerStrip.vue';
import { useInputStore } from './store';

/**
 * One controller in the all-controllers view: its name, a strip that shows every axis and
 * button live, and in words what is held right now. The card lights up when it is used.
 */
const props = defineProps<{ device: InputDevice; name: string; recent: boolean }>();
const emit = defineEmits<{ open: [] }>();
const input = useInputStore();

/** How many held buttons are named before the rest are counted. */
const NAMED = 4;

const view = computed(() => {
  void input.versions[props.device.index];
  const state = input.states.get(props.device.index);
  const pressed = state ? state.buttons.flatMap((b, i) => (b ? [i + 1] : [])) : [];
  return {
    has: state !== undefined,
    pressed,
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
    <div class="compact-head">
      <div class="rr-row-title compact-name" :title="name">{{ name }}</div>
      <div class="rr-row-sub compact-counts">{{ counts }}</div>
    </div>
    <div class="compact-live">
      <ControllerStrip :device="device" />
      <div class="compact-state" data-testid="compact-state">
        <template v-if="!view.has"><span class="rr-muted">No input yet</span></template>
        <template v-else>
          <span v-if="view.pressed.length" class="compact-pressed">
            Button{{ view.pressed.length > 1 ? 's' : '' }}
            {{ view.pressed.slice(0, NAMED).join(', ')
            }}{{ view.pressed.length > NAMED ? ` +${view.pressed.length - NAMED}` : '' }}
          </span>
          <span v-for="h in view.hats" :key="h.label" class="compact-pressed"
            >{{ h.label }} {{ h.direction }}</span
          >
          <span v-if="!view.pressed.length && !view.hats.length" class="rr-muted"
            >Nothing pressed</span
          >
        </template>
      </div>
    </div>
  </button>
</template>

<style scoped>
.compact {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 11px 14px 12px;
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius);
  background: var(--rr-surface);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.18s ease-out,
    border-color 0.18s ease-out;
}
.compact:hover {
  background: var(--rr-surface-2);
}
.compact.recent {
  background: color-mix(in srgb, var(--rr-accent) 9%, var(--rr-surface));
  border-color: color-mix(in srgb, var(--rr-accent) 70%, var(--rr-border));
}
.compact-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.compact-name {
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* The counts give way first: the name is what tells the controllers apart. */
.compact-counts {
  flex: 1 100 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.compact-live {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  min-height: 26px;
}
.compact-state {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: flex-end;
  gap: 2px 10px;
  flex-wrap: wrap;
  font-size: 12.5px;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.compact-pressed {
  color: var(--rr-accent);
  font-weight: 500;
}
@media (prefers-reduced-motion: reduce) {
  .compact {
    transition: none;
  }
}
</style>
