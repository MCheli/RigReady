<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useDisplays, type DisplayInfo } from '../composables/useRigReady';
import PageHeader from '../components/PageHeader.vue';

const { displays, savedConfigs, loading, loadDisplays, saveConfiguration, deleteConfiguration } =
  useDisplays();

// Calculate bounds and scale for the visual diagram
const diagramData = computed(() => {
  if (displays.value.length === 0) {
    return { monitors: [], containerWidth: 600, containerHeight: 200, scale: 1 };
  }

  // Find bounds of all displays
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const d of displays.value) {
    minX = Math.min(minX, d.x);
    minY = Math.min(minY, d.y);
    maxX = Math.max(maxX, d.x + d.width);
    maxY = Math.max(maxY, d.y + d.height);
  }

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;

  // Scale to fit within container (max 600px wide, proportional height)
  const maxContainerWidth = 600;
  const scale = Math.min(maxContainerWidth / totalWidth, 1);
  const containerWidth = totalWidth * scale;
  const containerHeight = totalHeight * scale;

  // Map displays to scaled positions
  const monitors = displays.value.map((d: DisplayInfo, index: number) => ({
    ...d,
    index,
    scaledX: (d.x - minX) * scale,
    scaledY: (d.y - minY) * scale,
    scaledWidth: d.width * scale,
    scaledHeight: d.height * scale,
  }));

  return { monitors, containerWidth, containerHeight, scale };
});

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
    <PageHeader title="Display Configuration">
      <template #actions>
        <v-btn prepend-icon="mdi-content-save" @click="handleSave"> Save Current </v-btn>
        <v-btn
          variant="outlined"
          prepend-icon="mdi-refresh"
          :loading="loading"
          @click="loadDisplays"
        >
          Detect
        </v-btn>
      </template>
    </PageHeader>

    <!-- Status Summary -->
    <v-row class="mb-8">
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

    <!-- Display Arrangement Diagram -->
    <v-card class="mb-8">
      <v-card-title>Display Arrangement</v-card-title>
      <v-card-text>
        <div
          v-if="displays.length > 0"
          class="diagram-container"
          :style="{
            width: diagramData.containerWidth + 'px',
            height: diagramData.containerHeight + 'px',
          }"
        >
          <div
            v-for="monitor in diagramData.monitors"
            :key="monitor.index"
            class="monitor-box"
            :class="{ 'monitor-primary': monitor.isPrimary }"
            :style="{
              left: monitor.scaledX + 'px',
              top: monitor.scaledY + 'px',
              width: monitor.scaledWidth + 'px',
              height: monitor.scaledHeight + 'px',
            }"
          >
            <div class="monitor-content">
              <div class="monitor-number">{{ monitor.index + 1 }}</div>
              <div class="monitor-resolution">{{ monitor.width }}x{{ monitor.height }}</div>
            </div>
          </div>
        </div>
        <div v-else class="text-center py-6">No displays detected. Click "Detect" to scan.</div>
      </v-card-text>
    </v-card>

    <!-- Current Displays -->
    <h2 class="text-h6 mb-4">Current Displays</h2>
    <v-row class="mb-8">
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
        <div class="text-body-1">
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

.diagram-container {
  position: relative;
  margin: 0 auto;
  background: rgba(var(--v-theme-surface-variant), 0.3);
  border-radius: 8px;
  min-height: 100px;
}

.monitor-box {
  position: absolute;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.monitor-box:hover {
  border-color: rgb(var(--v-theme-primary));
  z-index: 1;
}

.monitor-primary {
  border-color: rgb(var(--v-theme-success));
  border-width: 3px;
}

.monitor-content {
  text-align: center;
  padding: 4px;
  overflow: hidden;
}

.monitor-number {
  font-size: 1.5rem;
  font-weight: bold;
  color: rgb(var(--v-theme-on-surface));
  line-height: 1;
}

.monitor-resolution {
  font-size: 0.65rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-family: 'Consolas', monospace;
  white-space: nowrap;
}
</style>
