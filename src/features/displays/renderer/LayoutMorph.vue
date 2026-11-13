<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { frameWidth as widthOfFrame, mapKey } from '../core/mapKey';
import { morphOf, type MorphBox, type PreviewMonitor } from '../core/previewMap';
import { useWidth } from './measure';
import { useReducedMotion } from './motion';

/**
 * What applying a layout would do, as one map of the monitors that changes from how they
 * are to how they would be: monitors slide to their new place, turn, and switch on or off.
 * Before and After flip it by hand. With less motion asked for, the two are side by side.
 *
 * A name is always written the right way round and never left out. A box too narrow for
 * its name, before or after, shows a letter in both, and the key under the picture says
 * which screen that is.
 */
const props = withDefaults(
  defineProps<{
    before: PreviewMonitor[];
    after: PreviewMonitor[];
    /** The layout's name, for the caption. */
    name: string;
    /** The drawing never gets taller than this. */
    maxHeight?: number;
  }>(),
  { maxHeight: 190 }
);

type State = 'before' | 'after';
const reduced = useReducedMotion();
const morph = computed(() => morphOf({ before: props.before, after: props.after }));
const showing = ref<State>('before');

// Open on how things are, then show the change once by itself.
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => [props.before, props.after],
  () => {
    clearTimeout(timer);
    showing.value = 'before';
    timer = setTimeout(() => (showing.value = 'after'), 650);
  },
  { immediate: true }
);
onBeforeUnmount(() => clearTimeout(timer));

function show(state: State | undefined): void {
  if (!state) return;
  clearTimeout(timer);
  showing.value = state;
}

/** The frames to draw: one that changes, or both when nothing may move. */
const frames = computed<State[]>(() => (reduced.value ? ['before', 'after'] : [showing.value]));
const frameWidth = computed(() => `${Math.round(props.maxHeight / morph.value.ratio)}px`);

const root = ref<HTMLElement>();
const room = useWidth(root);
/** The gap between the two frames when they are side by side (.morph-frames.pair). */
const PAIR_GAP = 16;
/** The text size in a box (.morph-text). */
const FONT = 11.5;

/**
 * The marks for the boxes whose name does not fit. A box is measured at its narrowest,
 * before or after, so what is written on it does not change while it moves.
 */
const key = computed(() => {
  const whole = room.value;
  const each = whole !== undefined && reduced.value ? (whole - PAIR_GAP) / 2 : whole;
  const drawn = widthOfFrame(each, props.maxHeight, morph.value.ratio);
  return mapKey(
    morph.value.boxes.map((box) => {
      const places = [box.before, box.after].filter((p) => p !== undefined);
      const where = box.after ?? box.before;
      return {
        id: box.id,
        label: box.label,
        left: where?.left ?? 0,
        top: where?.top ?? 0,
        width: (Math.min(...places.map((p) => p.width)) / 100) * drawn,
      };
    }),
    FONT
  );
});
const letters = computed(() => new Map(key.value.map((entry) => [entry.id, entry.mark])));

function boxStyle(box: MorphBox, state: State): Record<string, string> {
  // A monitor that is off in this state stays where it is in the other one, and fades.
  const rect = box[state] ?? box[state === 'before' ? 'after' : 'before'];
  if (!rect) return { display: 'none' };
  return {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  };
}

const caption = (state: State): string =>
  state === 'before' ? 'As the monitors are now' : `With "${props.name}" applied`;
const off = (state: State): string[] =>
  state === 'before' ? morph.value.offBefore : morph.value.offAfter;

/** The whole change in words, for a screen reader and for a test. */
const summary = computed(() =>
  morph.value.boxes
    .filter((b) => b.changes.length > 0)
    .map((b) => `${b.label} ${b.changes.join(' and ')}`)
    .join('; ')
);
</script>

<template>
  <div
    ref="root"
    class="morph"
    data-testid="layout-morph"
    :data-showing="reduced ? 'both' : showing"
    :data-motion="reduced ? 'reduced' : 'full'"
  >
    <div v-if="!reduced" class="morph-head">
      <div class="rr-section-title mb-0" data-testid="morph-caption">{{ caption(showing) }}</div>
      <v-spacer />
      <v-btn-toggle
        :model-value="showing"
        mandatory
        density="compact"
        variant="outlined"
        divided
        aria-label="Show the monitors before or after"
        @update:model-value="show"
      >
        <v-btn value="before" size="small" data-testid="morph-before">Before</v-btn>
        <v-btn value="after" size="small" data-testid="morph-after">After</v-btn>
      </v-btn-toggle>
    </div>
    <div class="morph-frames" :class="{ pair: reduced }">
      <div v-for="state in frames" :key="reduced ? state : 'one'" class="morph-side">
        <div v-if="reduced" class="rr-section-title" :data-testid="`morph-caption-${state}`">
          {{ caption(state) }}
        </div>
        <div class="morph-frame" :style="{ maxWidth: frameWidth }">
          <div
            class="morph-canvas"
            role="img"
            :aria-label="`${caption(state)}. ${summary || 'Nothing changes'}.`"
            :style="{ paddingBottom: `${morph.ratio * 100}%` }"
            :data-testid="`morph-frame-${state}`"
          >
            <div
              v-for="box in morph.boxes"
              :key="box.id"
              class="morph-box"
              :class="{
                primary: state === 'before' ? box.primaryBefore : box.primaryAfter,
                absent: !box.connected,
                gone: box[state] === undefined,
              }"
              :style="boxStyle(box, state)"
              :title="`${box.label}${box.changes.length ? ': ' + box.changes.join(', ') : ''}`"
              data-testid="morph-monitor"
              :data-label="box.label"
              :data-on="box[state] !== undefined"
              :data-rotation="state === 'before' ? box.rotationBefore : box.rotationAfter"
              :data-changes="box.changes.join(', ')"
              :data-mark="letters.get(box.id)"
            >
              <!-- Too narrow for its name: a letter stands for it, and the key names it. -->
              <div v-if="letters.has(box.id)" class="morph-text">
                <span class="morph-letter" data-testid="morph-letter">{{
                  letters.get(box.id)
                }}</span>
              </div>
              <template v-else>
                <v-icon
                  v-if="state === 'before' ? box.primaryBefore : box.primaryAfter"
                  icon="mdi-star"
                  size="12"
                  class="morph-star"
                />
                <div class="morph-text">
                  <span class="morph-label">{{ box.label }}</span>
                  <small>{{ state === 'before' ? box.sizeBefore : box.sizeAfter }}</small>
                  <small v-if="!box.connected" class="rr-warn">not connected</small>
                </div>
              </template>
            </div>
          </div>
        </div>
        <div class="morph-off" :data-testid="`morph-off-${state}`">
          <span v-for="label in off(state)" :key="label" class="morph-off-item">
            <v-icon icon="mdi-monitor-off" size="14" />
            {{ label }} · off
          </span>
          <span v-if="off(state).length === 0" class="morph-off-item none">
            Every connected monitor is on
          </span>
        </div>
      </div>
    </div>
    <div v-if="key.length" class="morph-key" data-testid="morph-key">
      <span
        v-for="entry in key"
        :key="entry.id"
        class="morph-key-item"
        data-testid="morph-key-item"
        :data-label="entry.label"
      >
        <span class="morph-key-mark">{{ entry.mark }}</span>
        {{ entry.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.morph-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.morph-frames.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.morph-frame {
  margin: 0 auto;
}
.morph-canvas {
  position: relative;
  width: 100%;
}
.morph-box {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid var(--rr-border);
  outline: 3px solid var(--rr-bg);
  outline-offset: -4px;
  background: var(--rr-surface-2);
  overflow: hidden;
  border-radius: 3px;
  /* What is written on a monitor depends on how much room its box has. */
  container-type: size;
  transition:
    left 0.2s ease-out,
    top 0.2s ease-out,
    width 0.2s ease-out,
    height 0.2s ease-out,
    opacity 0.2s ease-out,
    transform 0.2s ease-out,
    border-color 0.2s ease-out;
}
.morph-box.primary {
  border: 2px solid var(--rr-accent);
}
.morph-box.absent {
  border: 1px dashed var(--rr-muted);
  background: transparent;
}
/* Off in this state: gone from the picture, at the place it has in the other. */
.morph-box.gone {
  opacity: 0;
  transform: scale(0.92);
}
.morph-text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 2px 4px;
  text-align: center;
  font-size: 11.5px;
  line-height: 1.25;
}
.morph-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.morph-text small {
  color: var(--rr-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.morph-star {
  position: absolute;
  top: 5px;
  right: 5px;
  color: var(--rr-accent);
  z-index: 1;
}
/* A narrow box: the name only, and no star (the border marks the main display). */
@container (max-width: 84px) {
  .morph-text small:not(.rr-warn) {
    display: none;
  }
  .morph-text {
    font-size: 10.5px;
    padding: 2px;
  }
  .morph-star {
    display: none;
  }
}
.morph-letter {
  font-weight: 700;
}
/* What the letters stand for. One key for both states, so it does not jump. */
.morph-key {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 14px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--rr-muted);
}
.morph-key-item {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  white-space: nowrap;
}
.morph-key-mark {
  font-weight: 700;
  color: var(--rr-text);
}
.morph-off {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 14px;
  margin-top: 10px;
  min-height: 18px;
  font-size: 12px;
  color: var(--rr-muted);
}
.morph-off-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.morph-off-item.none {
  opacity: 0.75;
}
@media (prefers-reduced-motion: reduce) {
  .morph-box {
    transition: none;
  }
}
</style>
