<script setup lang="ts">
import { computed } from 'vue';
import { DIAL, dialSegments, type SegmentState } from './dial';

/**
 * The readiness dial: a ring with one segment per checklist item, lit as its result
 * arrives, and the number of checks met in the middle. It is a picture of what the words
 * beside it say; a segment that is not met also stands out of the ring, so the picture
 * reads without colour.
 */
const props = withDefaults(
  defineProps<{
    /** One state per checklist item, in checklist order. */
    states: SegmentState[];
    /** Checks met, and how many count (items switched off do not). */
    met: number;
    total: number;
    tone: 'ok' | 'warn' | 'bad' | 'idle';
    /** Results are still arriving. */
    checking: boolean;
    /** Side of the dial in pixels. */
    size?: number;
  }>(),
  { size: DIAL.size }
);

const segments = computed(() => dialSegments(props.states));
const centre = DIAL.size / 2;

const label = computed(() => {
  if (props.total === 0) return 'This setup has no checks';
  const base = `${props.met} of ${props.total} checks met`;
  return props.checking ? `${base}, still checking` : base;
});
</script>

<template>
  <div
    class="dial"
    :class="[`dial-${tone}`, { 'dial-checking': checking }]"
    :style="{ width: `${size}px`, height: `${size}px`, '--dial-size': `${size}px` }"
    role="img"
    :aria-label="label"
    :data-met="met"
    :data-total="total"
    :data-tone="tone"
  >
    <svg :viewBox="`0 0 ${DIAL.size} ${DIAL.size}`" aria-hidden="true" focusable="false">
      <circle class="dial-bezel" :cx="centre" :cy="centre" :r="DIAL.radius - 9" />
      <path
        v-for="segment in segments"
        :key="segment.index"
        :d="segment.d"
        class="dial-seg"
        :class="`dial-seg-${segment.state}`"
        :style="{ '--i': segment.index, '--s': segment.scale }"
      />
    </svg>
    <div class="dial-centre" aria-hidden="true">
      <template v-if="total > 0">
        <span class="dial-count" data-testid="dial-count">{{ met }}</span>
        <span class="dial-total">of {{ total }}</span>
      </template>
      <template v-else>
        <span class="dial-count">–</span>
        <span class="dial-total">no checks</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dial {
  position: relative;
  flex: none;
}
/* A faint light behind the instrument once everything is in place. */
.dial::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--rr-ok) 20%, transparent) 0%,
    color-mix(in srgb, var(--rr-ok) 7%, transparent) 55%,
    transparent 72%
  );
  opacity: 0;
  transition: opacity 200ms ease-out;
}
.dial-ok::before {
  opacity: 1;
}
.dial svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.dial-bezel {
  fill: none;
  stroke: var(--rr-border);
  stroke-width: 1;
  transition: stroke 200ms ease-out;
}
.dial-ok .dial-bezel {
  stroke: color-mix(in srgb, var(--rr-ok) 45%, var(--rr-border));
}
.dial-warn .dial-bezel {
  stroke: color-mix(in srgb, var(--rr-warn) 40%, var(--rr-border));
}
.dial-bad .dial-bezel {
  stroke: color-mix(in srgb, var(--rr-bad) 40%, var(--rr-border));
}
.dial-seg {
  fill: none;
  stroke-width: 4;
  stroke: color-mix(in srgb, var(--rr-muted) 34%, transparent);
  transform-box: view-box;
  transform-origin: 50% 50%;
  transform: scale(var(--s, 1));
  transition:
    stroke 180ms ease-out,
    transform 180ms ease-out;
}
.dial-seg-pass {
  stroke: var(--rr-ok);
}
.dial-seg-warn {
  stroke: var(--rr-warn);
}
.dial-seg-fail {
  stroke: var(--rr-bad);
}
/* Switched off in the setup: part of the list, not part of readiness. */
.dial-seg-off {
  stroke: var(--rr-border);
  stroke-dasharray: 2 3;
}
/* While results arrive, the segments still waiting breathe one after another round the ring. */
.dial-checking .dial-seg-pending {
  animation: dial-wait 1100ms ease-in-out infinite alternate;
  animation-delay: calc(var(--i) * 45ms);
}
@keyframes dial-wait {
  from {
    stroke: color-mix(in srgb, var(--rr-muted) 22%, transparent);
  }
  to {
    stroke: color-mix(in srgb, var(--rr-accent) 75%, transparent);
  }
}
.dial-centre {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.dial-count {
  font-size: calc(var(--dial-size) * 0.25);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--rr-text);
}
.dial-total {
  margin-top: calc(var(--dial-size) * 0.035);
  font-size: max(11px, calc(var(--dial-size) * 0.092));
  color: var(--rr-muted);
}
@media (prefers-reduced-motion: reduce) {
  .dial::before,
  .dial-bezel,
  .dial-seg {
    transition: none;
  }
  .dial-checking .dial-seg-pending {
    animation: none;
  }
}
</style>
