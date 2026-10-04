<script setup lang="ts">
/**
 * What a page shows while it is still reading: the outline of what will be there, instead
 * of a line of text in an empty space. The words are still on the page for a screen reader
 * ("Reading the monitors…"), and the whole-app tests see it as "still loading" the same way
 * they see a progress indicator.
 *
 *   <PageSkeleton v-if="!view && !error" label="Reading the monitors…" />
 *
 * It appears only after a moment, so a page that answers at once never flashes it.
 */
withDefaults(
  defineProps<{
    /** What is being read, ending in an ellipsis: "Reading the audio devices…". */
    label: string;
    /** How many rows the outline has. */
    rows?: number;
    /** rows: a panel of rows (most pages). cards: a grid of cards. text: a few lines in a panel. */
    shape?: 'rows' | 'cards' | 'text';
  }>(),
  { rows: 4, shape: 'rows' }
);

/** Line lengths that look like names and details rather than a ladder. */
const TITLE = [34, 46, 28, 40, 37, 31];
const DETAIL = [58, 44, 66, 51, 61, 47];
</script>

<template>
  <div
    class="rr-skeleton v-skeleton-loader"
    :class="`rr-skeleton-${shape}`"
    role="status"
    aria-busy="true"
    data-testid="page-skeleton"
  >
    <p class="rr-sr-only">{{ label }}</p>
    <div v-if="shape === 'cards'" class="rr-skeleton-grid" aria-hidden="true">
      <div v-for="n in rows" :key="n" class="rr-panel rr-skeleton-card">
        <span
          class="rr-skeleton-bar"
          :style="{ width: `${TITLE[(n - 1) % TITLE.length]! + 10}%` }"
        />
        <span class="rr-skeleton-block" />
        <span
          class="rr-skeleton-bar thin"
          :style="{ width: `${DETAIL[(n - 1) % DETAIL.length]}%` }"
        />
      </div>
    </div>
    <div v-else-if="shape === 'text'" class="rr-panel rr-skeleton-text" aria-hidden="true">
      <span
        v-for="n in rows"
        :key="n"
        class="rr-skeleton-bar thin"
        :style="{ width: `${DETAIL[(n - 1) % DETAIL.length]! + 20}%` }"
      />
    </div>
    <div v-else class="rr-panel" aria-hidden="true">
      <div v-for="n in rows" :key="n" class="rr-row">
        <span class="rr-skeleton-dot" />
        <span class="rr-row-main rr-skeleton-lines">
          <span class="rr-skeleton-bar" :style="{ width: `${TITLE[(n - 1) % TITLE.length]}%` }" />
          <span
            class="rr-skeleton-bar thin"
            :style="{ width: `${DETAIL[(n - 1) % DETAIL.length]}%` }"
          />
        </span>
      </div>
    </div>
  </div>
</template>

<style>
.rr-skeleton {
  display: block;
  background: none;
  /* It waits a moment before it fades in: a page that answers at once never shows it. */
  animation: rr-skeleton-in var(--rr-motion-base) var(--rr-ease) var(--rr-motion-fast) both;
}
@keyframes rr-skeleton-in {
  from {
    opacity: 0;
  }
}
.rr-skeleton-dot,
.rr-skeleton-bar,
.rr-skeleton-block {
  display: block;
  border-radius: 5px;
  background: linear-gradient(
    90deg,
    var(--rr-surface-2) 0%,
    var(--rr-border-strong) 50%,
    var(--rr-surface-2) 100%
  );
  background-size: 300% 100%;
  animation: rr-skeleton-sweep 1.8s linear infinite;
}
@keyframes rr-skeleton-sweep {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -50% 0;
  }
}
.rr-skeleton-dot {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
}
.rr-skeleton-lines {
  display: grid;
  gap: 7px;
  padding: 4px 0;
}
.rr-skeleton-bar {
  height: 11px;
}
.rr-skeleton-bar.thin {
  height: 8px;
  opacity: 0.7;
}
.rr-skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}
.rr-skeleton-card {
  display: grid;
  gap: 12px;
  padding: 16px;
}
.rr-skeleton-block {
  height: 72px;
  border-radius: 7px;
  opacity: 0.6;
}
.rr-skeleton-text {
  display: grid;
  gap: 10px;
  padding: 18px 16px;
}
/* Asked for less motion: the outline holds still. */
@media (prefers-reduced-motion: reduce) {
  .rr-skeleton-dot,
  .rr-skeleton-bar,
  .rr-skeleton-block {
    animation: none;
    background: var(--rr-surface-2);
  }
}
</style>
