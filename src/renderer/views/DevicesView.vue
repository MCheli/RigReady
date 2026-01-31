<script setup lang="ts">
import { onMounted } from 'vue';
import { useDevices } from '../composables/useSimManager';

const { devices, loading, error, loadDevices } = useDevices();

onMounted(() => {
  loadDevices();
});
</script>

<template>
  <div class="devices-view">
    <div class="d-flex justify-space-between align-center mb-6">
      <h1 class="text-h4 font-weight-bold">Connected Devices</h1>
      <v-btn prepend-icon="mdi-refresh" :loading="loading" @click="loadDevices"> Refresh </v-btn>
    </div>

    <!-- Status Summary -->
    <v-row class="mb-6">
      <v-col cols="12" md="4">
        <v-card color="surface-variant">
          <v-card-text class="text-center">
            <div class="text-h3 font-weight-bold text-success">
              {{ devices.filter((d) => d.status === 'connected').length }}
            </div>
            <div class="text-caption text-medium-emphasis">Connected</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card color="surface-variant">
          <v-card-text class="text-center">
            <div class="text-h3 font-weight-bold text-error">
              {{ devices.filter((d) => d.status === 'disconnected').length }}
            </div>
            <div class="text-caption text-medium-emphasis">Missing</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card color="surface-variant">
          <v-card-text class="text-center">
            <div class="text-h3 font-weight-bold">
              {{ devices.length }}
            </div>
            <div class="text-caption text-medium-emphasis">Total</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Error Alert -->
    <v-alert v-if="error" type="error" class="mb-4" closable>
      {{ error }}
    </v-alert>

    <!-- Device Grid -->
    <v-row v-if="devices.length > 0">
      <v-col
        v-for="device in devices"
        :key="`${device.vendorId}:${device.productId}`"
        cols="12"
        md="6"
        lg="4"
      >
        <v-card :class="{ 'border-error': device.status === 'disconnected' }" class="device-card">
          <v-card-text>
            <div class="d-flex justify-space-between align-start mb-2">
              <div>
                <div class="text-subtitle-1 font-weight-bold">
                  {{ device.productName }}
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ device.vendorName }}
                </div>
              </div>
              <v-chip
                :color="device.status === 'connected' ? 'success' : 'error'"
                size="small"
                variant="tonal"
              >
                {{ device.status === 'connected' ? 'Connected' : 'Missing' }}
              </v-chip>
            </div>
            <div class="text-caption font-mono text-medium-emphasis">
              {{ device.vendorId }}:{{ device.productId }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Empty State -->
    <v-card v-else-if="!loading" color="surface-variant">
      <v-card-text class="text-center py-10">
        <v-icon size="48" class="mb-4 text-medium-emphasis">mdi-controller-off</v-icon>
        <div class="text-body-1 text-medium-emphasis">
          No devices detected. Click Refresh to scan.
        </div>
      </v-card-text>
    </v-card>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-10">
      <v-progress-circular indeterminate size="48" />
    </div>
  </div>
</template>

<style scoped>
.device-card {
  transition:
    transform 0.2s,
    border-color 0.2s;
}

.device-card:hover {
  transform: translateY(-2px);
}

.border-error {
  border: 1px solid rgb(var(--v-theme-error)) !important;
  opacity: 0.7;
}

.font-mono {
  font-family: 'Consolas', monospace;
}
</style>
