<script setup lang="ts">
import { onMounted } from 'vue';
import { useDebug } from '../composables/useSimManager';

const { systemInfo, deviceStatus, paths, logs, loadDebugInfo, exportLogs } = useDebug();

async function handleExport() {
  const result = await exportLogs();
  if (result.success) {
    alert(`Logs exported to: ${result.path}`);
  } else {
    alert(`Failed to export logs: ${result.error}`);
  }
}

onMounted(() => {
  loadDebugInfo();
});
</script>

<template>
  <div class="debug-view">
    <div class="d-flex justify-space-between align-center mb-6">
      <h1 class="text-h4 font-weight-bold">Debug</h1>
      <div class="d-flex gap-2">
        <v-btn prepend-icon="mdi-export" @click="handleExport"> Export Logs </v-btn>
        <v-btn variant="outlined" prepend-icon="mdi-refresh" @click="loadDebugInfo">
          Refresh
        </v-btn>
      </div>
    </div>

    <v-row>
      <!-- System Info -->
      <v-col cols="12" md="4">
        <v-card>
          <v-card-title>System Information</v-card-title>
          <v-card-text>
            <v-list density="compact" class="bg-transparent">
              <v-list-item>
                <template #prepend>
                  <span class="text-medium-emphasis">Platform:</span>
                </template>
                <v-list-item-title class="font-mono text-right">
                  {{ systemInfo?.platform || '-' }}
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template #prepend>
                  <span class="text-medium-emphasis">Electron:</span>
                </template>
                <v-list-item-title class="font-mono text-right">
                  {{ systemInfo?.electronVersion || '-' }}
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template #prepend>
                  <span class="text-medium-emphasis">Node:</span>
                </template>
                <v-list-item-title class="font-mono text-right">
                  {{ systemInfo?.nodeVersion || '-' }}
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template #prepend>
                  <span class="text-medium-emphasis">Chrome:</span>
                </template>
                <v-list-item-title class="font-mono text-right">
                  {{ systemInfo?.chromeVersion || '-' }}
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Device Status -->
      <v-col cols="12" md="4">
        <v-card>
          <v-card-title>Device Status</v-card-title>
          <v-card-text>
            <v-list density="compact" class="bg-transparent">
              <v-list-item>
                <template #prepend>
                  <span class="text-medium-emphasis">DirectInput:</span>
                </template>
                <v-list-item-title class="text-right">
                  <v-chip
                    :color="deviceStatus?.pygameAvailable ? 'success' : 'error'"
                    size="x-small"
                    variant="tonal"
                  >
                    {{ deviceStatus?.pygameAvailable ? 'Yes' : 'No' }}
                  </v-chip>
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template #prepend>
                  <span class="text-medium-emphasis">DirectInput Devices:</span>
                </template>
                <v-list-item-title class="font-mono text-right">
                  {{ deviceStatus?.pygameDeviceCount ?? '-' }}
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template #prepend>
                  <span class="text-medium-emphasis">HID Devices:</span>
                </template>
                <v-list-item-title class="font-mono text-right">
                  {{ deviceStatus?.hidDeviceCount ?? '-' }}
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template #prepend>
                  <span class="text-medium-emphasis">USB Devices:</span>
                </template>
                <v-list-item-title class="font-mono text-right">
                  {{ deviceStatus?.usbDeviceCount ?? '-' }}
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Paths -->
      <v-col cols="12" md="4">
        <v-card>
          <v-card-title>File Paths</v-card-title>
          <v-card-text>
            <v-list density="compact" class="bg-transparent">
              <v-list-item>
                <template #prepend>
                  <span class="text-medium-emphasis">Config:</span>
                </template>
                <v-list-item-title class="font-mono text-caption text-truncate">
                  {{ paths?.configPath || '-' }}
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <template #prepend>
                  <span class="text-medium-emphasis">Logs:</span>
                </template>
                <v-list-item-title class="font-mono text-caption text-truncate">
                  {{ paths?.logsPath || '-' }}
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Recent Logs -->
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex justify-space-between align-center">
            Recent Log Entries
            <v-chip size="small" variant="tonal"> {{ logs.length }} entries </v-chip>
          </v-card-title>
          <v-card-text>
            <div class="log-container">
              <div
                v-for="(log, index) in logs"
                :key="index"
                class="log-entry"
                :class="{
                  'text-error': log.includes('[ERROR]'),
                  'text-warning': log.includes('[WARN]'),
                }"
              >
                {{ log }}
              </div>
              <div v-if="logs.length === 0" class="text-center text-medium-emphasis py-4">
                No logs available.
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'Consolas', monospace;
}

.log-container {
  background: rgb(var(--v-theme-background));
  border-radius: 8px;
  padding: 16px;
  max-height: 300px;
  overflow-y: auto;
}

.log-entry {
  font-family: 'Consolas', monospace;
  font-size: 0.75rem;
  padding: 2px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
</style>
