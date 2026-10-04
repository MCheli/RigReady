<script setup lang="ts">
import { computed } from 'vue';
import { NOISE_PERCENT, type Evidence } from '../core/health';

/**
 * What was recorded of one input while nobody touched anything, over the length of the
 * check. An axis is its trace, zoomed in on where it rested, with the band it is allowed to
 * tremble in; a button or a hat is a time line with the stretches it was on.
 */
const props = defineProps<{ evidence: Evidence; seconds: number }>();

const WIDTH = 1000;
const HEIGHT = 100;
const PAD = 8;

const duration = computed(() => Math.max(0.001, props.seconds));
const x = (t: number): number =>
  (Math.max(0, Math.min(duration.value, t)) / duration.value) * WIDTH;

const axis = computed(() => {
  const e = props.evidence;
  if (e.kind !== 'axis') return undefined;
  // Zoomed in on the resting position, wide enough for the quiet band and everything seen.
  const quiet = NOISE_PERCENT / 2;
  const lowest = Math.min(e.low, e.rest - quiet);
  const highest = Math.max(e.high, e.rest + quiet);
  const margin = (highest - lowest) * 0.12;
  const bottom = lowest - margin;
  const top = highest + margin;
  const y = (percent: number): number =>
    PAD + (1 - (percent - bottom) / (top - bottom)) * (HEIGHT - 2 * PAD);
  let path = '';
  e.points.forEach(([t, percent], i) => {
    // The value holds until the next sample, then steps.
    path += i === 0 ? `M ${x(t)} ${y(percent)}` : ` H ${x(t)} V ${y(percent)}`;
  });
  if (path) path += ` H ${WIDTH}`;
  return {
    path,
    band: { y: y(e.rest + quiet), height: y(e.rest - quiet) - y(e.rest + quiet) },
    high: e.high,
    low: e.low,
  };
});

const spans = computed(() => {
  const e = props.evidence;
  if (e.kind !== 'held') return [];
  // A press too short to see is still drawn wide enough to find.
  return e.spans.map(([from, to]) => ({ x: x(from), width: Math.max(4, x(to) - x(from)) }));
});

const half = computed(() => Math.round(props.seconds * 5) / 10);
</script>

<template>
  <div class="evidence" data-testid="health-evidence" :data-kind="evidence.kind">
    <div class="evidence-plot">
      <svg
        v-if="axis"
        class="evidence-svg axis"
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          class="evidence-band"
          x="0"
          :y="axis.band.y"
          :width="WIDTH"
          :height="axis.band.height"
        />
        <path class="evidence-line" :d="axis.path" data-testid="health-trace" />
      </svg>
      <svg
        v-else
        class="evidence-svg held"
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          v-for="(s, i) in spans"
          :key="i"
          class="evidence-on"
          :x="s.x"
          y="0"
          :width="s.width"
          :height="HEIGHT"
          data-testid="health-span"
        />
      </svg>
      <div v-if="axis" class="evidence-scale rr-mono">
        <span>{{ axis.high }}%</span>
        <span>{{ axis.low }}%</span>
      </div>
    </div>
    <div class="evidence-time rr-mono">
      <span>0 s</span>
      <span>{{ half }} s</span>
      <span>{{ seconds }} s</span>
    </div>
    <div class="evidence-key">
      <template v-if="axis">
        <i class="key-band" /> The band is the {{ NOISE_PERCENT }}% an axis may tremble; the line is
        what this one did.
      </template>
      <template v-else><i class="key-on" /> Lit while it was on.</template>
    </div>
  </div>
</template>

<style scoped>
.evidence {
  min-width: 0;
}
.evidence-plot {
  position: relative;
  border: 1px solid var(--rr-border);
  border-radius: 4px;
  background: var(--rr-bg);
  overflow: hidden;
}
.evidence-svg {
  display: block;
  width: 100%;
}
.evidence-svg.axis {
  height: 64px;
}
.evidence-svg.held {
  height: 22px;
}
.evidence-band {
  fill: var(--rr-surface-2);
}
.evidence-line {
  fill: none;
  stroke: var(--rr-accent);
  stroke-width: 1.5;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.evidence-on {
  fill: var(--rr-accent);
}
.evidence-scale {
  position: absolute;
  inset: 2px 6px 2px auto;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  font-size: 10.5px;
  line-height: 1.2;
  color: var(--rr-muted);
  pointer-events: none;
}
.evidence-scale span {
  padding: 0 3px;
  background: color-mix(in srgb, var(--rr-bg) 80%, transparent);
  border-radius: 2px;
}
.evidence-time {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  font-size: 10.5px;
  color: var(--rr-muted);
}
.evidence-key {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--rr-muted);
}
.evidence-key i {
  display: inline-block;
  width: 14px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.key-band {
  background: var(--rr-surface-2);
  border: 1px solid var(--rr-border);
}
.key-on {
  background: var(--rr-accent);
}
</style>
