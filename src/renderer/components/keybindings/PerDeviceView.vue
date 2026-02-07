<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { DCSDeviceBindings } from '../../../shared/dcsTypes';

const devices = ref<
  {
    deviceGuid: string;
    deviceName: string;
    modules: string[];
    totalKeyBindings: number;
    totalAxisBindings: number;
  }[]
>([]);
const selectedDevice = ref<string | null>(null);
const deviceBindings = ref<{ module: string; bindings: DCSDeviceBindings }[]>([]);
const loading = ref(false);

async function loadDeviceSummary() {
  loading.value = true;
  try {
    const scanResult = await window.rigReady.dcs.scanModules();
    const deviceMap = new Map<
      string,
      {
        deviceGuid: string;
        deviceName: string;
        modules: Set<string>;
        totalKeyBindings: number;
        totalAxisBindings: number;
      }
    >();

    for (const module of scanResult.modules) {
      const bindings = await window.rigReady.dcs.getModuleBindings(module.id);
      for (const device of bindings) {
        let entry = deviceMap.get(device.deviceGuid);
        if (!entry) {
          entry = {
            deviceGuid: device.deviceGuid,
            deviceName: device.deviceName,
            modules: new Set(),
            totalKeyBindings: 0,
            totalAxisBindings: 0,
          };
          deviceMap.set(device.deviceGuid, entry);
        }
        entry.modules.add(module.id);
        entry.totalKeyBindings += device.keyBindings.filter((b) => !b.isRemoved).length;
        entry.totalAxisBindings += device.axisBindings.filter((b) => !b.isRemoved).length;
      }
    }

    devices.value = Array.from(deviceMap.values())
      .map((d) => ({
        ...d,
        modules: Array.from(d.modules),
      }))
      .sort(
        (a, b) =>
          b.totalKeyBindings + b.totalAxisBindings - (a.totalKeyBindings + a.totalAxisBindings)
      );

    if (devices.value.length > 0) {
      selectedDevice.value = devices.value[0].deviceGuid;
      await loadDeviceBindings(devices.value[0].deviceGuid);
    }
  } finally {
    loading.value = false;
  }
}

async function loadDeviceBindings(deviceGuid: string) {
  selectedDevice.value = deviceGuid;
  deviceBindings.value = [];

  const scanResult = await window.rigReady.dcs.scanModules();
  for (const module of scanResult.modules) {
    const bindings = await window.rigReady.dcs.getModuleBindings(module.id);
    const deviceBinding = bindings.find((b) => b.deviceGuid === deviceGuid);
    if (deviceBinding) {
      deviceBindings.value.push({ module: module.id, bindings: deviceBinding });
    }
  }
}

onMounted(loadDeviceSummary);
</script>

<template>
  <v-card>
    <v-card-title>Per-Device Binding View</v-card-title>
    <v-card-subtitle> See all bindings across modules grouped by device </v-card-subtitle>
    <v-card-text>
      <v-progress-linear v-if="loading" indeterminate class="mb-4" />

      <v-row v-if="!loading">
        <v-col cols="12" md="4">
          <v-list density="compact">
            <v-list-item
              v-for="device in devices"
              :key="device.deviceGuid"
              :active="selectedDevice === device.deviceGuid"
              @click="loadDeviceBindings(device.deviceGuid)"
              rounded
            >
              <v-list-item-title>{{ device.deviceName }}</v-list-item-title>
              <v-list-item-subtitle>
                {{ device.modules.length }} modules · {{ device.totalKeyBindings }} keys ·
                {{ device.totalAxisBindings }} axes
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>

          <div v-if="devices.length === 0" class="text-center py-4 text-medium-emphasis">
            No DCS devices found.
          </div>
        </v-col>

        <v-col cols="12" md="8">
          <div v-if="selectedDevice">
            <div v-for="entry in deviceBindings" :key="entry.module" class="mb-4">
              <div class="text-subtitle-2 mb-2">{{ entry.module }}</div>

              <div
                v-if="entry.bindings.keyBindings.filter((b) => !b.isRemoved).length > 0"
                class="mb-2"
              >
                <div class="text-caption text-medium-emphasis mb-1">Key Bindings</div>
                <v-chip
                  v-for="binding in entry.bindings.keyBindings
                    .filter((b) => !b.isRemoved)
                    .slice(0, 20)"
                  :key="binding.id"
                  size="x-small"
                  class="mr-1 mb-1"
                  variant="tonal"
                >
                  {{ binding.key }}: {{ binding.name }}
                </v-chip>
                <v-chip
                  v-if="entry.bindings.keyBindings.filter((b) => !b.isRemoved).length > 20"
                  size="x-small"
                  class="mr-1 mb-1"
                  variant="outlined"
                >
                  +{{ entry.bindings.keyBindings.filter((b) => !b.isRemoved).length - 20 }} more
                </v-chip>
              </div>

              <div v-if="entry.bindings.axisBindings.filter((b) => !b.isRemoved).length > 0">
                <div class="text-caption text-medium-emphasis mb-1">Axis Bindings</div>
                <v-chip
                  v-for="binding in entry.bindings.axisBindings.filter((b) => !b.isRemoved)"
                  :key="binding.id"
                  size="x-small"
                  class="mr-1 mb-1"
                  color="info"
                  variant="tonal"
                >
                  {{ binding.key }}: {{ binding.name }}
                </v-chip>
              </div>

              <v-divider class="mt-2" />
            </div>
          </div>
          <div v-else class="text-center py-8 text-medium-emphasis">
            Select a device to view its bindings.
          </div>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>
