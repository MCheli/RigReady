<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import type { DeviceInfo } from '../../../shared/models';
import { devicesContract } from '../contract';

const api = useClient(devicesContract);
const devices = ref<DeviceInfo[]>([]);
const error = ref<string>();
const loaded = ref(false);
const controllersOnly = ref(true);

async function load(): Promise<void> {
  const result = await api.list();
  if (result.ok) {
    devices.value = result.value;
    error.value = undefined;
  } else {
    error.value = errorText(result.error);
  }
  loaded.value = true;
}

const shown = computed(() =>
  devices.value.filter((d) => !d.isHub && (!controllersOnly.value || d.isHid))
);

const hubPath = (device: DeviceInfo): string =>
  device.hubChain
    .map((h) => h.name)
    .reverse()
    .join(' › ');

onMounted(load);
</script>

<template>
  <div class="rr-page" data-testid="devices-page">
    <div class="d-flex align-start">
      <div>
        <h1 class="rr-page-title">Devices</h1>
        <p class="rr-page-sub">
          USB devices connected right now, with the identity RigReady uses to recognise them.
        </p>
      </div>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="mdi-refresh" data-testid="devices-refresh" @click="load"
        >Refresh</v-btn
      >
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <v-switch v-model="controllersOnly" label="Input devices only" class="mb-2" />

    <div v-if="loaded" class="rr-panel">
      <div v-for="device in shown" :key="device.instanceId" class="rr-row" data-testid="device-row">
        <v-icon
          :icon="device.isHid ? 'mdi-controller-classic-outline' : 'mdi-usb-port'"
          class="rr-muted"
        />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ device.name }}</div>
          <div class="rr-row-sub">{{ hubPath(device) }}</div>
        </div>
        <div class="rr-mono rr-muted devices-id">
          {{ device.vendorId }}:{{ device.productId }}
          <div v-if="device.serial">serial {{ device.serial }}</div>
        </div>
      </div>
      <div v-if="shown.length === 0" class="rr-row rr-muted">No devices found.</div>
    </div>
  </div>
</template>

<style scoped>
.devices-id {
  text-align: right;
}
</style>
