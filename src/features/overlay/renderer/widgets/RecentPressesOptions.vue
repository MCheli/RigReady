<script setup lang="ts">
/**
 * The options of the recent presses on the Overlay page. Every change is sent as the whole
 * set of options; what comes back from the overlay is what the controls then show.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { recentPresses, type RecentPressesOptions } from '../../core/widgets';

const props = defineProps<{
  /** The options in effect, as overlay:state gives them. */
  options: Record<string, unknown>;
}>();
const emit = defineEmits<{ change: [options: Record<string, unknown>] }>();

const current = computed(() => recentPresses.read(props.options));
const LINES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function set(change: Partial<RecentPressesOptions>): void {
  emit('change', { ...current.value, ...change });
}

/** What the slider shows while it is moved; the option follows once it rests. */
const seconds = ref(current.value.lifetimeSeconds);
watch(
  () => current.value.lifetimeSeconds,
  (value) => {
    seconds.value = value;
  }
);

let resting: ReturnType<typeof setTimeout> | undefined;

function sendSeconds(): void {
  if (resting !== undefined) clearTimeout(resting);
  resting = undefined;
  if (seconds.value !== current.value.lifetimeSeconds) set({ lifetimeSeconds: seconds.value });
}

/** A slider moves in many small steps: the time is set when it has rested for a moment. */
function setSeconds(value: number): void {
  seconds.value = value;
  if (resting !== undefined) clearTimeout(resting);
  resting = setTimeout(sendSeconds, 300);
}

function setLines(value: unknown): void {
  const rows = Number(value);
  if (Number.isInteger(rows)) set({ rows });
}

function setSize(value: unknown): void {
  if (value === 'small' || value === 'medium' || value === 'large') set({ size: value });
}

function setUnbound(value: boolean | null): void {
  set({ showUnbound: value === true });
}

// Leaving the page while the slider has not rested yet: what it says is still set.
onBeforeUnmount(sendSeconds);
</script>

<template>
  <div data-testid="overlay-presses-options">
    <div class="rr-row">
      <div class="rr-row-main">
        <div class="rr-row-title">Shown for</div>
        <div class="rr-row-sub">
          How long a press stays. It is clear for the first part of that time and fades out over the
          rest.
        </div>
      </div>
      <v-slider
        class="rpo-slider"
        :model-value="seconds"
        :min="1"
        :max="30"
        :step="1"
        density="compact"
        hide-details
        aria-label="How long a press is shown, in seconds"
        data-testid="overlay-lifetime"
        @update:model-value="setSeconds"
      />
      <div class="rpo-value" data-testid="overlay-lifetime-value">
        {{ seconds }} {{ seconds === 1 ? 'second' : 'seconds' }}
      </div>
    </div>

    <div class="rr-row">
      <div class="rr-row-main">
        <div class="rr-row-title">Lines</div>
        <div class="rr-row-sub">
          The most presses shown at once. The oldest makes room for a new one.
        </div>
      </div>
      <v-select
        class="rpo-lines"
        :items="LINES"
        :model-value="current.rows"
        density="compact"
        variant="outlined"
        hide-details
        aria-label="The most presses shown at once"
        data-testid="overlay-lines"
        @update:model-value="setLines"
      />
    </div>

    <div class="rr-row">
      <div class="rr-row-main">
        <div class="rr-row-title">Size</div>
        <div class="rr-row-sub">Of the text, and with it of the room the list takes.</div>
      </div>
      <v-btn-toggle
        :model-value="current.size"
        mandatory
        density="compact"
        variant="outlined"
        divided
        data-testid="overlay-size"
        @update:model-value="setSize"
      >
        <v-btn value="small" size="small" data-testid="overlay-size-small">Small</v-btn>
        <v-btn value="medium" size="small" data-testid="overlay-size-medium">Medium</v-btn>
        <v-btn value="large" size="small" data-testid="overlay-size-large">Large</v-btn>
      </v-btn-toggle>
    </div>

    <div class="rr-row">
      <div class="rr-row-main">
        <div class="rr-row-title">Presses the game has nothing on</div>
        <div class="rr-row-sub">
          Listed dimmed as “Not bound”, so you see that the press arrived and the game does nothing
          with it. Turned off, such a press is left out.
        </div>
      </div>
      <v-switch
        :model-value="current.showUnbound"
        hide-details
        class="flex-grow-0"
        aria-label="List presses the game has nothing on"
        data-testid="overlay-show-unbound"
        @update:model-value="setUnbound"
      />
    </div>
  </div>
</template>

<style scoped>
.rpo-slider {
  flex: none;
  width: 220px;
}
.rpo-value {
  flex: none;
  width: 84px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--rr-text-2);
  font-size: var(--rr-text-sm);
}
.rpo-lines {
  flex: none;
  width: 96px;
}
</style>
