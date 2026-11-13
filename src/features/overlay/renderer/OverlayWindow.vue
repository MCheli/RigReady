<script setup lang="ts">
/**
 * What one window of the overlay shows: one widget and nothing else, on nothing (the window
 * is see-through and lets the mouse through to the game).
 *
 * While the user is placing it ("move it" on the Overlay page) the window takes the mouse
 * instead, and shows where it is and how big: a frame the user drags, with the button that
 * locks it there.
 *
 * This is a bare window: there is no app shell around it, so it is plain HTML with its own
 * colours, and it does nothing until it is told something.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { errorText, useClient } from '../../../renderer/ipc';
import { overlayContract, type OverlayState } from '../contract';
import { WIDGET_PARTS } from './widgets';

const route = useRoute();
const api = useClient(overlayContract);
const id = computed(() => String(route.params['widget'] ?? ''));
const state = ref<OverlayState>();
const widget = computed(() => state.value?.widgets.find((w) => w.id === id.value));
const parts = computed(() => WIDGET_PARTS[id.value]);
/** Too low for more than one line of words: the smallest list is one line high. */
const low = computed(() => (widget.value?.height ?? 0) < 120);
const lockError = ref<string>();

async function lock(): Promise<void> {
  lockError.value = undefined;
  const result = await api.move({ widget: id.value, moving: false });
  if (result.ok) state.value = result.value;
  else lockError.value = errorText(result.error);
}

let off: (() => void) | undefined;
onMounted(async () => {
  off = api.on('changed', (next) => {
    state.value = next;
  });
  // As the overlay stands, with nothing read again for it: this opens over the game.
  const current = await api.current();
  // Nothing can be said over a game when this fails. The window stays empty until the
  // overlay next says how it stands, and the Overlay page, which reads the same, says why.
  if (current.ok) state.value = current.value;
});
onBeforeUnmount(() => off?.());
</script>

<template>
  <div
    v-if="widget && parts"
    class="ow"
    data-testid="overlay-window"
    :data-widget="widget.id"
    :data-moving="widget.moving"
  >
    <component :is="parts.view" :options="widget.options" :at="widget.place.at" />
    <div
      v-if="widget.moving"
      class="ow-frame"
      :class="{ 'ow-low': low }"
      data-testid="overlay-move-frame"
    >
      <div class="ow-words">
        <strong>{{ widget.title }}</strong>
        <span v-if="!low">Drag this to where it should be.</span>
        <span v-if="lockError" role="alert">{{ lockError }}</span>
      </div>
      <button type="button" class="ow-lock" data-testid="overlay-lock-here" @click="lock">
        Lock here
      </button>
    </div>
  </div>
</template>

<style scoped>
.ow {
  position: fixed;
  inset: 0;
  overflow: hidden;
  font-family: var(--rr-font);
}

/* The whole frame is the handle: Windows moves the window when it is dragged. */
.ow-frame {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px 12px;
  border: 2px dashed #a8d1f5;
  border-radius: 10px;
  background: rgba(23, 28, 34, 0.9);
  color: #e6e9ed;
  font-size: 14px;
  text-align: center;
  cursor: move;
  user-select: none;
  -webkit-app-region: drag;
}
.ow-low {
  flex-direction: row;
  gap: 12px;
}
.ow-words {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ow-words strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The one thing in the frame that is clicked, not dragged. */
.ow-lock {
  flex: none;
  padding: 5px 14px;
  border: 1px solid #a8d1f5;
  border-radius: 6px;
  background: #5aa9e6;
  color: #0f1317;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.ow-lock:hover {
  background: #a8d1f5;
}
.ow-lock:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}
</style>
