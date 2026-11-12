<script setup lang="ts">
/**
 * The recent presses, as drawn over the game and in the preview on the Overlay page: the
 * newest at the edge the list hangs from, each line fading out over its time.
 *
 * It is kept light on purpose. Nothing is drawn per frame by this code: a line fades by a
 * CSS animation that starts where the line is in its life, and one timer runs to the moment
 * the oldest line is over. With nothing pressed there is no timer and nothing on the screen.
 *
 * The colours are its own and do not follow the app: it is read over a game, not on a page.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useClient } from '../../../../renderer/ipc';
import { overlayContract, type PressRow } from '../../contract';
import type { At } from '../../core/settings';
import { alive, anchorOf, nextEnd, rowWords, takeRows, type ShownRow } from '../../core/shown';
import {
  RECENT_PRESSES_GAP,
  RECENT_PRESSES_PAD,
  RECENT_PRESSES_SIZES,
  recentPresses,
} from '../../core/widgets';

const props = defineProps<{
  /** The options of the widget, as overlay:state gives them. */
  options: Record<string, unknown>;
  /** Where its window is on the screen: the list hangs from the nearest edge. */
  at: At;
}>();

const api = useClient(overlayContract);
const options = computed(() => recentPresses.read(props.options));
const lifetimeMs = computed(() => options.value.lifetimeSeconds * 1000);
const anchor = computed(() => anchorOf(props.at));
const measures = computed(() => {
  const measure = RECENT_PRESSES_SIZES[options.value.size];
  return {
    '--rp-row': `${measure.row}px`,
    '--rp-text': `${measure.text}px`,
    '--rp-sub': `${measure.sub}px`,
    '--rp-gap': `${RECENT_PRESSES_GAP}px`,
    '--rp-pad': `${RECENT_PRESSES_PAD}px`,
  };
});

const shown = ref<ShownRow[]>([]);
const lines = computed(() => shown.value.map((line) => ({ ...line, words: rowWords(line.row) })));

let timer: ReturnType<typeof setTimeout> | undefined;

/** One timer, to the moment the oldest line is over. None while nothing is shown. */
function waitForNextEnd(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  const wait = nextEnd(shown.value, lifetimeMs.value, performance.now());
  if (wait === undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    keepAlive();
  }, wait + 16);
}

/** Drops the lines whose time is over or that the options leave no room for. */
function keepAlive(): void {
  const kept = alive(shown.value, lifetimeMs.value, performance.now()).slice(0, options.value.rows);
  if (kept.length !== shown.value.length) shown.value = kept;
  waitForNextEnd();
}

function take(rows: PressRow[]): void {
  shown.value = takeRows(shown.value, rows, performance.now());
  keepAlive();
}

/** Where in its fading a line starts: as far as it was into its life when it came. */
function fading(line: ShownRow): Record<string, string> {
  return {
    animationDuration: `${lifetimeMs.value}ms`,
    animationDelay: `${-line.startAgeMs}ms`,
  };
}

// A shorter time or fewer lines set on the page apply to what is shown now.
watch([lifetimeMs, () => options.value.rows], keepAlive);

let off: (() => void) | undefined;
onMounted(async () => {
  let told = false;
  off = api.on('presses', ({ rows }) => {
    told = true;
    take(rows);
  });
  // What was pressed before this window opened. A press that came in the meantime is newer.
  const recent = await api.recent();
  // When this cannot be read the list starts empty and fills with the next press.
  if (recent.ok && !told) take(recent.value.rows);
});
onBeforeUnmount(() => {
  off?.();
  if (timer !== undefined) clearTimeout(timer);
});
</script>

<template>
  <div
    class="rp"
    :class="[`rp-${anchor.edge}`, `rp-${anchor.side}`]"
    :style="measures"
    data-testid="overlay-presses"
    :data-edge="anchor.edge"
    :data-side="anchor.side"
  >
    <TransitionGroup name="rp-line">
      <div
        v-for="line in lines"
        :key="line.row.id"
        class="rp-line"
        data-testid="overlay-press"
        :data-control="line.row.control"
        :data-device="line.row.device"
        :data-count="line.row.count"
        :data-bound="!line.words.quiet"
      >
        <!-- Keyed by the press: pressed again, the pill is a new one and its fading starts over. -->
        <div
          :key="line.key"
          class="rp-pill"
          :class="{ 'rp-quiet': line.words.quiet }"
          :style="fading(line)"
        >
          <div class="rp-main">
            <span v-if="line.words.held.length > 0" class="rp-held">
              {{ line.words.held.join(' + ') }} +
            </span>
            <span class="rp-action" data-testid="overlay-press-action">{{ line.words.main }}</span>
            <span
              v-if="line.words.more > 0"
              class="rp-tag"
              :title="`${line.words.more} more on this control`"
              data-testid="overlay-press-more"
            >
              +{{ line.words.more }}
            </span>
            <span v-if="line.row.count > 1" class="rp-tag" data-testid="overlay-press-count">
              ×{{ line.row.count }}
            </span>
          </div>
          <div class="rp-sub" data-testid="overlay-press-control">{{ line.words.sub }}</div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.rp {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: var(--rp-pad);
  display: flex;
  gap: var(--rp-gap);
  overflow: hidden;
  font-family: var(--rr-font);
  font-variant-numeric: tabular-nums;
  user-select: none;
  pointer-events: none;
}
/* The newest line is first: at the top of a list that hangs from the top, at the bottom of
   one that stands on the bottom. */
.rp-top {
  flex-direction: column;
}
.rp-bottom {
  flex-direction: column-reverse;
}
.rp-left {
  align-items: flex-start;
}
.rp-middle {
  align-items: center;
}
.rp-right {
  align-items: flex-end;
}

.rp-line {
  flex: none;
  display: flex;
  height: var(--rp-row);
  max-width: 100%;
  min-width: 0;
}
.rp-pill {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 0 calc(var(--rp-text) * 0.8);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: calc(var(--rp-row) * 0.2);
  background: rgba(10, 13, 17, 0.82);
  color: #f4f6f8;
}
.rp-main {
  display: flex;
  align-items: baseline;
  gap: 0.4em;
  min-width: 0;
  font-size: var(--rp-text);
  font-weight: 600;
  line-height: 1.25;
}
.rp-action {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-held {
  flex: none;
  font-weight: 500;
  color: #a8d1f5;
}
.rp-tag {
  flex: none;
  padding: 0 0.45em;
  border-radius: 0.7em;
  background: rgba(255, 255, 255, 0.18);
  font-size: 0.75em;
}
.rp-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--rp-sub);
  line-height: 1.3;
  color: #c9d0d9;
}
.rp-middle .rp-main {
  justify-content: center;
}
.rp-middle .rp-sub {
  text-align: center;
}
.rp-right .rp-main {
  justify-content: flex-end;
}
.rp-right .rp-sub {
  text-align: right;
}

/* A press the game has nothing on: there, but it does not ask to be read. Its plate lets
   more of the game through, though not so much that the grey words fall below 4.5 to 1
   over a white sky (0.72 gives 4.9 to 1; 0.6 gave under 4). */
.rp-quiet {
  background: rgba(10, 13, 17, 0.72);
  border-color: rgba(255, 255, 255, 0.1);
}
.rp-quiet .rp-action {
  font-weight: 500;
  color: #c9d0d9;
}

@keyframes rp-fade {
  0%,
  60% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

/*
 * Fading and sliding only where Windows is not asked for less motion. There the app sets
 * every animation to no time at all, which would hide a line the moment it appears, so a
 * line has no animation then: it stays as it is and goes when its time is over.
 */
@media (prefers-reduced-motion: no-preference) {
  .rp-pill {
    animation-name: rp-fade;
    animation-timing-function: linear;
    animation-fill-mode: both;
  }
  .rp-line-enter-active {
    transition:
      opacity var(--rr-motion-fast) var(--rr-ease),
      transform var(--rr-motion-fast) var(--rr-ease);
  }
  .rp-line-move {
    transition: transform var(--rr-motion-base) var(--rr-ease);
  }
  .rp-top .rp-line-enter-from {
    opacity: 0;
    transform: translateY(-8px);
  }
  .rp-bottom .rp-line-enter-from {
    opacity: 0;
    transform: translateY(8px);
  }
}
</style>
