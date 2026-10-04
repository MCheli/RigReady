<script setup lang="ts">
/**
 * RigReady's mark: a simplified flight path marker, the small winged circle a head-up
 * display draws where the aircraft is going. For a racing setup the same circle is read as
 * a steering wheel: the fin turns into the lower spoke and the wings move inside the rim.
 * Decorative: the name "RigReady" stands beside it.
 */
withDefaults(defineProps<{ size?: number; kind?: 'flight' | 'racing' }>(), {
  size: 22,
  kind: 'flight',
});
</script>

<template>
  <svg
    class="rr-mark"
    :class="`rr-mark-${kind}`"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="kind === 'racing'">
      <circle cx="12" cy="12" r="8.25" />
      <circle cx="12" cy="12" r="1.9" />
      <path d="M4 12h6.1M13.9 12H20M12 13.9V20" />
    </template>
    <template v-else>
      <circle cx="12" cy="13" r="4.25" />
      <path d="M2.5 13h5.25M16.25 13h5.25M12 8.75V4" />
    </template>
  </svg>
</template>

<style>
.rr-mark {
  display: block;
  flex: none;
  color: var(--rr-kind, var(--rr-accent));
}
</style>
