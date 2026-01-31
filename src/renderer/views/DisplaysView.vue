<script setup lang="ts">
import { onMounted } from 'vue';
import { useDisplays } from '../composables/useSimManager';

const { displays, savedConfigs, loading, loadDisplays, saveConfiguration, deleteConfiguration } =
  useDisplays();

async function handleSave() {
  const name = prompt('Enter a name for this configuration:');
  if (name) {
    await saveConfiguration(name);
    await loadDisplays();
  }
}

async function handleDelete(name: string) {
  if (confirm(`Delete configuration "${name}"?`)) {
    await deleteConfiguration(name);
    await loadDisplays();
  }
}

onMounted(() => {
  loadDisplays();
});
</script>

<template>
  <div class="displays-view">
    <div class="d-flex justify-space-between align-center mb-6">
      <h1 class="text-h4 font-weight-bold">Display Configuration</h1>
      <div class="d-flex gap-2">
        <v-btn prepend-icon="mdi-content-save" @click="handleSave"> Save Current </v-btn>
        <v-btn
          variant="outlined"
          prepend-icon="mdi-refresh"
          :loading="loading"
          @click="loadDisplays"
        >
          Detect
        </v-btn>
      </div>
    </div>

    <!-- Status Summary -->
    <v-row class="mb-6">
      <v-col cols="12" md="6">
        <v-card color="surface-variant">
          <v-card-text class="text-center">
            <div class="text-h3 font-weight-bold text-success">
              {{ displays.length }}
            </div>
            <div class="text-caption text-medium-emphasis">Monitors</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card color="surface-variant">
          <v-card-text class="text-center">
            <div class="text-h3 font-weight-bold">
              {{ savedConfigs.length }}
            </div>
            <div class="text-caption text-medium-emphasis">Saved Configs</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Current Displays -->
    <h2 class="text-h6 mb-4">Current Displays</h2>
    <v-row class="mb-6">
      <v-col v-for="(display, index) in displays" :key="index" cols="12" md="4">
        <v-card>
          <v-card-text>
            <div class="d-flex justify-space-between align-start mb-2">
              <div>
                <div class="text-subtitle-1 font-weight-bold">
                  {{ display.name || 'Display ' + (index + 1) }}
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ display.width }} x {{ display.height }}
                </div>
              </div>
              <v-chip v-if="display.isPrimary" color="success" size="small" variant="tonal">
                Primary
              </v-chip>
            </div>
            <div class="text-caption font-mono text-medium-emphasis">
              Position: ({{ display.x }}, {{ display.y }})
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Saved Configurations -->
    <h2 class="text-h6 mb-4">Saved Configurations</h2>
    <v-row v-if="savedConfigs.length > 0">
      <v-col v-for="config in savedConfigs" :key="config.name" cols="12" md="4">
        <v-card>
          <v-card-text>
            <div class="d-flex justify-space-between align-start">
              <div>
                <div class="text-subtitle-1 font-weight-bold">{{ config.name }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ config.displays?.length || 0 }} displays
                </div>
              </div>
              <v-btn
                icon="mdi-delete"
                size="small"
                variant="text"
                color="error"
                @click="handleDelete(config.name)"
              />
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    <v-card v-else color="surface-variant">
      <v-card-text class="text-center py-6">
        <div class="text-body-1 text-medium-emphasis">
          No saved configurations. Save your current setup using the button above.
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'Consolas', monospace;
}
</style>
