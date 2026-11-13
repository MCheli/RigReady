<script setup lang="ts">
import { computed } from 'vue';
import type { PadReport, VirtualPadKind } from '../../../shared/models';
import { padView, shortLabel } from '../core/padView';
import type { ButtonName } from '../core/profile';

/**
 * A live picture of the virtual controller: two sticks, two triggers and the buttons, lit
 * while they are down. Drawn here from plain shapes; it is the picture of no real product.
 * The words beside it say the same, so a lit colour is never the only sign.
 */
const props = withDefaults(defineProps<{ report?: PadReport; kind?: VirtualPadKind }>(), {
  report: undefined,
  kind: 'xbox360',
});

const view = computed(() => padView(props.report, props.kind));
const on = (name: ButtonName): boolean => view.value.pressed.includes(name);

/** How far a stick's dot travels from the middle of its well, in drawing units. */
const TRAVEL = 9;
const TRIGGER_WIDTH = 46;
const FACE: { name: ButtonName; x: number; y: number }[] = [
  { name: 'y', x: 212, y: 52 },
  { name: 'a', x: 212, y: 82 },
  { name: 'x', x: 197, y: 67 },
  { name: 'b', x: 227, y: 67 },
];
const DPAD: { name: ButtonName; x: number; y: number }[] = [
  { name: 'up', x: 101, y: 86 },
  { name: 'down', x: 101, y: 106 },
  { name: 'left', x: 91, y: 96 },
  { name: 'right', x: 111, y: 96 },
];
/** One letter in a face button; a DualShock 4 has shapes, said in the words beside. */
const letter = (name: ButtonName): string =>
  props.kind === 'ds4'
    ? ({ a: '×', b: '○', x: '□', y: '△' }[name as 'a' | 'b' | 'x' | 'y'] ?? '')
    : shortLabel(name, 'xbox360');
</script>

<template>
  <div class="vc-pad" data-testid="vc-pad">
    <svg
      class="vc-pad-svg"
      viewBox="0 0 280 132"
      role="img"
      :aria-label="`The virtual controller now. ${view.valuesText}. ${view.pressedText}.`"
    >
      <!-- triggers: the bar fills as the trigger is pressed -->
      <g v-for="side in ['lt', 'rt'] as const" :key="side">
        <rect
          class="vc-pad-part"
          :x="side === 'lt' ? 40 : 194"
          y="4"
          :width="TRIGGER_WIDTH"
          height="9"
          rx="3"
        />
        <rect
          class="vc-pad-lit"
          :x="side === 'lt' ? 40 : 194"
          y="4"
          :width="view[side] * TRIGGER_WIDTH"
          height="9"
          rx="3"
        />
        <text class="vc-pad-text" :x="side === 'lt' ? 22 : 258" y="12" text-anchor="middle">
          {{ shortLabel(side, kind) }}
        </text>
      </g>
      <!-- bumpers -->
      <rect
        class="vc-pad-part"
        :class="{ on: on('lb') }"
        x="40"
        y="17"
        width="46"
        height="8"
        rx="4"
      />
      <rect
        class="vc-pad-part"
        :class="{ on: on('rb') }"
        x="194"
        y="17"
        width="46"
        height="8"
        rx="4"
      />
      <!-- body -->
      <rect class="vc-pad-body" x="18" y="29" width="244" height="98" rx="34" />
      <!-- sticks: the dot moves with the stick; the well lights when the stick is pressed in -->
      <circle class="vc-pad-part" :class="{ on: on('ls') }" cx="68" cy="67" r="18" />
      <circle
        class="vc-pad-dot"
        :cx="68 + view.left.x * TRAVEL"
        :cy="67 - view.left.y * TRAVEL"
        r="8"
      />
      <circle class="vc-pad-part" :class="{ on: on('rs') }" cx="172" cy="101" r="18" />
      <circle
        class="vc-pad-dot"
        :cx="172 + view.right.x * TRAVEL"
        :cy="101 - view.right.y * TRAVEL"
        r="8"
      />
      <!-- d-pad -->
      <rect class="vc-pad-part" x="101" y="96" width="10" height="10" />
      <rect
        v-for="d in DPAD"
        :key="d.name"
        class="vc-pad-part"
        :class="{ on: on(d.name) }"
        :x="d.x"
        :y="d.y"
        width="10"
        height="10"
        rx="2"
      />
      <!-- back, guide, start -->
      <rect
        class="vc-pad-part"
        :class="{ on: on('back') }"
        x="116"
        y="63"
        width="14"
        height="7"
        rx="3.5"
      />
      <circle class="vc-pad-part" :class="{ on: on('guide') }" cx="140" cy="48" r="6" />
      <rect
        class="vc-pad-part"
        :class="{ on: on('start') }"
        x="150"
        y="63"
        width="14"
        height="7"
        rx="3.5"
      />
      <!-- face buttons -->
      <g v-for="f in FACE" :key="f.name">
        <circle class="vc-pad-part" :class="{ on: on(f.name) }" :cx="f.x" :cy="f.y" r="8" />
        <text
          class="vc-pad-text"
          :class="{ on: on(f.name) }"
          :x="f.x"
          :y="f.y + 3"
          text-anchor="middle"
        >
          {{ letter(f.name) }}
        </text>
      </g>
    </svg>
    <!-- The same in words; the picture's own name already says it to a screen reader. -->
    <div class="vc-pad-words" aria-hidden="true">
      <!-- A line each on screen; the dots between keep the text one sentence when read as text. -->
      <div class="rr-num" data-testid="vc-pad-values">
        <template v-for="(line, at) in view.valueLines" :key="at">
          <span v-if="at > 0" class="vc-pad-sep"> · </span>
          <span class="vc-pad-line">{{ line }}</span>
        </template>
      </div>
      <div data-testid="vc-pad-pressed">
        <v-icon :icon="view.pressed.length > 0 ? 'mdi-circle' : 'mdi-circle-outline'" size="11" />
        {{ view.pressedText }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.vc-pad {
  /* The picture and its words keep their width; the text beside them gives way. */
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
}
.vc-pad-svg {
  flex: none;
  width: 220px;
  height: auto;
}
.vc-pad-body {
  fill: var(--rr-surface-2);
  stroke: var(--rr-border-strong);
  stroke-width: 1.5;
}
.vc-pad-part {
  fill: var(--rr-bg);
  stroke: var(--rr-border-strong);
  stroke-width: 1;
}
.vc-pad-part.on,
.vc-pad-lit {
  fill: var(--rr-accent);
  stroke: var(--rr-accent);
}
.vc-pad-dot {
  fill: var(--rr-text-2);
}
.vc-pad-text {
  fill: var(--rr-text-2);
  font-size: 8px;
  font-weight: 600;
}
.vc-pad-text.on {
  fill: var(--rr-bg);
}
.vc-pad-words {
  flex: none;
  font-size: var(--rr-text-sm);
  color: var(--rr-text-2);
  line-height: 1.6;
}
.vc-pad-line {
  display: block;
  white-space: nowrap;
}
.vc-pad-sep {
  display: none;
}
</style>
