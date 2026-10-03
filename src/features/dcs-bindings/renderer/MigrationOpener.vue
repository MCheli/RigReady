<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useClient } from '../../../renderer/ipc';
import { dcsBindingsContract } from '../contract';

/**
 * Mounted on every screen: when the Fly check's fix asks for it, shows the Device IDs
 * tab, where the move is previewed before anything is renamed.
 */
const router = useRouter();
const api = useClient(dcsBindingsContract);
let off: (() => void) | undefined;
onMounted(() => {
  off = api.on('openMigration', () => void router.push('/configure/dcs-bindings/device-ids'));
});
onBeforeUnmount(() => off?.());
</script>

<template>
  <span hidden data-testid="dcs-bindings-opener" />
</template>
