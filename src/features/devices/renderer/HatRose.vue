<script setup lang="ts">
import { computed } from 'vue';
import { HAT_POINTS } from '../core/trace';

/**
 * A hat as a compass rose: eight points, the one it is pushed towards lit, and the hub
 * marked while it rests in the middle. The direction is also written beside it.
 */
const props = defineProps<{ direction: string }>();

/** The four main directions reach further out than the four in between. */
const points = computed(() =>
  HAT_POINTS.map((point, i) => {
    const long = i % 2 === 0;
    const tip = long ? 25 : 18;
    const base = 7.5;
    const half = long ? 5.2 : 3.6;
    return {
      ...point,
      path: `M ${-half} ${-base} L 0 ${-tip} L ${half} ${-base} Z`,
      on: props.direction === point.direction,
    };
  })
);
</script>

<template>
  <svg class="rose" viewBox="-30 -30 60 60" aria-hidden="true">
    <circle r="28.5" class="rose-ring" />
    <path
      v-for="p in points"
      :key="p.direction"
      :d="p.path"
      :transform="`rotate(${p.angle})`"
      class="rose-point"
      :class="{ on: p.on }"
      :data-point="p.code"
      :data-on="p.on"
    />
    <circle r="4" class="rose-hub" :class="{ rest: direction === 'centred' }" />
  </svg>
</template>

<style scoped>
.rose {
  width: 60px;
  height: 60px;
  flex-shrink: 0;
}
.rose-ring {
  fill: var(--rr-bg);
  stroke: var(--rr-border);
  stroke-width: 1;
}
.rose-point {
  fill: var(--rr-surface-2);
  stroke: var(--rr-border);
  stroke-width: 1;
  stroke-linejoin: round;
  transition:
    fill 0.12s ease-out,
    stroke 0.12s ease-out;
}
.rose-point.on {
  fill: var(--rr-accent);
  stroke: var(--rr-accent);
}
.rose-hub {
  fill: none;
  stroke: var(--rr-border);
  stroke-width: 1;
}
.rose-hub.rest {
  fill: var(--rr-muted);
  stroke: var(--rr-muted);
}
@media (prefers-reduced-motion: reduce) {
  .rose-point {
    transition: none;
  }
}
</style>
