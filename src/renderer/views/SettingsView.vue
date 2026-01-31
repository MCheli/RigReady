<script setup lang="ts">
import { ref, onMounted } from 'vue';

const expectedDeviceCount = ref(0);

async function clearExpectedDevices() {
  if (confirm('Clear all expected devices?')) {
    // TODO: Implement via IPC
    expectedDeviceCount.value = 0;
  }
}

onMounted(() => {
  // Load expected device count
  // TODO: Implement via IPC
});
</script>

<template>
  <div class="settings-view">
    <div class="d-flex justify-space-between align-center mb-6">
      <h1 class="text-h4 font-weight-bold">Settings</h1>
    </div>

    <v-row>
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Device Configuration</v-card-title>
          <v-card-text>
            <div class="d-flex justify-space-between align-center mb-4">
              <div>
                <div class="text-subtitle-1">Expected Devices</div>
                <div class="text-caption text-medium-emphasis">
                  Devices that should be connected
                </div>
              </div>
              <v-chip size="small" variant="tonal">
                {{ expectedDeviceCount }}
              </v-chip>
            </div>
            <v-btn
              color="error"
              variant="outlined"
              prepend-icon="mdi-delete"
              @click="clearExpectedDevices"
            >
              Clear Expected Devices
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Application</v-card-title>
          <v-card-text>
            <v-switch label="Start with Windows" color="primary" hide-details disabled />
            <v-switch label="Minimize to tray" color="primary" hide-details disabled />
            <v-switch label="Check for updates" color="primary" hide-details disabled />
            <div class="text-caption text-medium-emphasis mt-4">
              These settings will be available in a future update.
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>
