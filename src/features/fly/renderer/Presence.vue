<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useClient } from '../../../renderer/ipc';
import { flyContract } from '../contract';

/**
 * Tells main whether somebody is at this window of RigReady. It is mounted on every screen
 * of the app. When the game closes and nobody is at a window, "welcome back" is a Windows
 * notification instead of a line on a screen nobody is looking at.
 *
 * Two things are said: "in use" whenever the user does something here (at most once every
 * ten seconds), and "hidden" when the window goes to the tray or is minimized. A window
 * that says nothing for a minute counts as left alone.
 */
const api = useClient(flyContract);

/** Which window this is: the main one, the compact view, or another small panel. */
function windowName(): string {
  const hash = window.location.hash;
  if (hash.startsWith('#/fly/compact')) return 'compact';
  return hash.includes('popped=1') ? 'panel' : 'main';
}
const name = windowName();

const report = (visible: boolean): void => {
  void api.presence({ window: name, visible });
};

let lastSaid = 0;
/** The user moved, clicked or typed here. */
function used(): void {
  const now = Date.now();
  if (now - lastSaid < 10_000) return;
  lastSaid = now;
  report(true);
}

function visibility(): void {
  if (document.visibilityState === 'visible') return;
  // Hidden is said at once, and the next thing done here is said at once too.
  lastSaid = 0;
  report(false);
}

const INPUTS = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;

onMounted(() => {
  document.addEventListener('visibilitychange', visibility);
  for (const input of INPUTS)
    window.addEventListener(input, used, { capture: true, passive: true });
  // A window that opens in front of the user is in use; one that starts in the tray is not.
  if (document.visibilityState === 'visible' && document.hasFocus()) used();
  else report(false);
});
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', visibility);
  for (const input of INPUTS) window.removeEventListener(input, used, { capture: true });
});
</script>

<template>
  <span hidden />
</template>
