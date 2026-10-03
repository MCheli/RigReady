<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useClient } from '../../../renderer/ipc';
import { devicesContract } from '../contract';

/**
 * Tells main whether the window is on screen. Plug and unplug notifications are shown
 * only while RigReady is in the tray: with the window open, the screens update themselves.
 */
const api = useClient(devicesContract);
const report = (): void => {
  void api.windowVisible({ visible: document.visibilityState === 'visible' });
};

onMounted(() => {
  document.addEventListener('visibilitychange', report);
  report();
});
onBeforeUnmount(() => document.removeEventListener('visibilitychange', report));
</script>

<template>
  <span hidden />
</template>
