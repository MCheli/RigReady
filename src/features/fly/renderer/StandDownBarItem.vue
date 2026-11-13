<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { countdownShort } from '../core/sessionText';
import {
  cancelStandDown,
  counting,
  followStandDown,
  inMainWindow,
  putAway,
  secondsLeft,
} from './standDownCountdown';

/**
 * The countdown to a Stand down by itself, in the app bar: where it goes when the notice
 * is put away. The bar is on every page and lies over nothing, so the countdown and its
 * Cancel stay in reach while the corner of the page is free again. Pressing the countdown
 * brings the notice back.
 *
 * The bar has little room, so the time is a clock ("Stand down in 4:05") and is never cut
 * short: what gives way in a narrow window is the rest of the bar.
 */
const mainWindow = inMainWindow();
const shown = computed(() => mainWindow && counting.value && putAway.value);

let unfollow: (() => void) | undefined;
onMounted(() => {
  if (mainWindow) unfollow = followStandDown();
});
onBeforeUnmount(() => unfollow?.());
</script>

<template>
  <div
    v-if="shown"
    class="sd-bar"
    role="group"
    aria-label="Stand down"
    data-testid="stand-down-bar"
  >
    <button
      type="button"
      class="sd-bar-show"
      aria-label="Show what Stand down will do"
      title="Show what Stand down will do"
      data-testid="stand-down-bar-show"
      @click="putAway = false"
    >
      <v-icon icon="mdi-power" size="16" class="sd-bar-icon" />
      <!-- A line that ticks is not read out every second. -->
      <span class="sd-bar-text" role="timer" aria-live="off" data-testid="stand-down-bar-title">
        {{ countdownShort(secondsLeft ?? 0) }}
      </span>
    </button>
    <button
      type="button"
      class="sd-bar-cancel"
      aria-label="Cancel Stand down"
      data-testid="stand-down-bar-cancel"
      @click="cancelStandDown"
    >
      Cancel
    </button>
  </div>
</template>

<style scoped>
.sd-bar {
  display: inline-flex;
  align-items: stretch;
  flex: none;
  height: 32px;
  border: 1px solid var(--rr-accent);
  border-radius: 8px;
  background: var(--rr-bg);
  overflow: hidden;
}
.sd-bar button {
  border: 0;
  background: none;
  color: var(--rr-text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.sd-bar button:hover {
  background: var(--rr-surface-2);
}
/* Inside the edge, which would cut a ring drawn outside it. */
.sd-bar button:focus-visible {
  outline-offset: -2px;
}
.sd-bar-show {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
}
.sd-bar-icon {
  flex: none;
  color: var(--rr-accent);
}
.sd-bar-text {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.sd-bar .sd-bar-cancel {
  flex: none;
  padding: 0 12px;
  border-left: 1px solid var(--rr-border-strong);
  font-weight: 600;
}
</style>
