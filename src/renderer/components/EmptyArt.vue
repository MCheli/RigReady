<script setup lang="ts">
/**
 * The small line drawings of the empty states: one thin-lined object inside four corner
 * marks, the way a head-up display boxes what it is looking at. Decorative: the words
 * beside it say everything, so it is hidden from a screen reader.
 */
export type EmptyArtName =
  | 'nothing'
  | 'search'
  | 'backup'
  | 'snapshot'
  | 'shield'
  | 'monitor'
  | 'device'
  | 'file'
  | 'setup'
  | 'game';

withDefaults(defineProps<{ name?: EmptyArtName; size?: number }>(), {
  name: 'nothing',
  size: 76,
});
</script>

<template>
  <svg
    class="rr-art"
    :width="size"
    :height="Math.round((size * 56) / 72)"
    viewBox="0 0 72 56"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    :data-art="name"
  >
    <!-- The corner marks. -->
    <path class="rr-art-frame" d="M3 13V3h10M59 3h10v10M69 43v10H59M13 53H3V43" />

    <g v-if="name === 'search'">
      <circle cx="33" cy="26" r="9" />
      <path d="M40 33l8 8" />
      <path class="rr-art-mark" d="M29.5 26h7" />
    </g>
    <g v-else-if="name === 'backup'">
      <path d="M22 20h28v5H22z" />
      <path d="M24.5 25v13a2 2 0 0 0 2 2h19a2 2 0 0 0 2-2V25" />
      <path class="rr-art-mark" d="M32 31h8" />
    </g>
    <g v-else-if="name === 'snapshot'">
      <path
        d="M22 22a2 2 0 0 1 2-2h5l2.5-3.5h9L43 20h5a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H24a2 2 0 0 1-2-2z"
      />
      <circle class="rr-art-mark" cx="36" cy="29" r="5" />
    </g>
    <g v-else-if="name === 'shield'">
      <path d="M36 15l11 4v8.5c0 6.5-4.4 11.2-11 13.5-6.6-2.3-11-7-11-13.5V19z" />
      <path class="rr-art-mark" d="M31 28l3.5 3.5 6.5-7" />
    </g>
    <g v-else-if="name === 'monitor'">
      <rect x="20" y="16" width="32" height="20" rx="2" />
      <path d="M36 36v5M29 41h14" />
      <path class="rr-art-mark" d="M32 26h8" />
    </g>
    <g v-else-if="name === 'device'">
      <path d="M24 41h24M27 41v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4" />
      <path d="M36 35V22" />
      <circle class="rr-art-mark" cx="36" cy="18.5" r="3.5" />
    </g>
    <g v-else-if="name === 'file'">
      <path d="M27 15h12l7 7v17a2 2 0 0 1-2 2H27a2 2 0 0 1-2-2V17a2 2 0 0 1 2-2z" />
      <path d="M39 15v7h7" />
      <path class="rr-art-mark" d="M30 30h11M30 35h7" />
    </g>
    <g v-else-if="name === 'setup'">
      <rect x="25" y="17" width="22" height="25" rx="2" />
      <path d="M32 17v-2.5h8V17" />
      <path class="rr-art-mark" d="M30 28l2.5 2.5L37 26" />
      <path d="M30 36h12M40 28h2" />
    </g>
    <g v-else-if="name === 'game'">
      <path
        d="M26 22h20a6 6 0 0 1 6 6v6a4 4 0 0 1-7.2 2.4L43 34H29l-1.8 2.4A4 4 0 0 1 20 34v-6a6 6 0 0 1 6-6z"
      />
      <path class="rr-art-mark" d="M28 26v5M25.5 28.5h5" />
      <path d="M43 27h.01M46 30h.01" />
    </g>
    <g v-else>
      <!-- Nothing here: where the thing would be, only its outline. -->
      <rect x="22" y="17" width="28" height="22" rx="2" stroke-dasharray="3 4" />
      <path class="rr-art-mark" d="M32 28h8" />
    </g>
  </svg>
</template>

<style>
.rr-art {
  display: block;
  flex: none;
  color: var(--rr-muted);
}
.rr-art-frame {
  stroke: var(--rr-border-strong);
}
.rr-art-mark {
  stroke: var(--rr-kind, var(--rr-accent));
}
</style>
