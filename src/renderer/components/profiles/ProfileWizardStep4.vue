<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { ChecklistItem, TrackedConfiguration } from '../../../shared/profileTypes';
import type { DisplayConfiguration } from '../../../shared/types';

defineProps<{
  displayItems: ChecklistItem[];
  trackedConfigs: TrackedConfiguration[];
}>();

const emit = defineEmits<{
  'update:displayItems': [value: ChecklistItem[]];
  'update:trackedConfigs': [value: TrackedConfiguration[]];
}>();

const displayConfigs = ref<DisplayConfiguration[]>([]);
const selectedDisplayConfig = ref<string | null>(null);
const trackedPath = ref('');
const trackedName = ref('');
const localTracked = ref<TrackedConfiguration[]>([]);
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    displayConfigs.value = await window.rigReady.displays.getSavedConfigurations();
  } catch {
    // Ignore
  } finally {
    loading.value = false;
  }
});

function selectDisplayConfig(name: string | null) {
  selectedDisplayConfig.value = name;
  if (name) {
    const items: ChecklistItem[] = [
      {
        id: `wiz-display-${name}`,
        type: 'display',
        name: `Display: ${name}`,
        isRequired: false,
        category: 'display',
        config: { configurationName: name },
      },
    ];
    emit('update:displayItems', items);
  } else {
    emit('update:displayItems', []);
  }
}

function addTrackedConfig() {
  if (!trackedPath.value.trim() || !trackedName.value.trim()) return;
  localTracked.value.push({
    name: trackedName.value.trim(),
    path: trackedPath.value.trim(),
  });
  emit('update:trackedConfigs', [...localTracked.value]);
  trackedName.value = '';
  trackedPath.value = '';
}

function removeTrackedConfig(index: number) {
  localTracked.value.splice(index, 1);
  emit('update:trackedConfigs', [...localTracked.value]);
}
</script>

<template>
  <div>
    <h3 class="text-h6 mb-4">Displays & Configurations</h3>

    <!-- Display configuration -->
    <p class="text-body-2 text-medium-emphasis mb-4">
      Optionally select a saved display configuration to check before launch.
    </p>

    <v-select
      :model-value="selectedDisplayConfig"
      :items="displayConfigs.map((c) => ({ title: c.name, value: c.name }))"
      item-title="title"
      item-value="value"
      label="Display Configuration (optional)"
      clearable
      class="mb-6"
      :loading="loading"
      @update:model-value="selectDisplayConfig"
    />

    <!-- Tracked configurations -->
    <h4 class="text-subtitle-1 mb-2">Tracked Config Files</h4>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Track config files that you want to snapshot and restore.
    </p>

    <v-list v-if="localTracked.length > 0" density="compact" class="mb-4">
      <v-list-item v-for="(tc, index) in localTracked" :key="index">
        <v-list-item-title>{{ tc.name }}</v-list-item-title>
        <v-list-item-subtitle>{{ tc.path }}</v-list-item-subtitle>
        <template #append>
          <v-btn icon variant="text" size="small" @click="removeTrackedConfig(index)">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </template>
      </v-list-item>
    </v-list>

    <v-row>
      <v-col cols="5">
        <v-text-field
          v-model="trackedName"
          label="Name"
          placeholder="DCS Input Config"
          density="compact"
        />
      </v-col>
      <v-col cols="5">
        <v-text-field
          v-model="trackedPath"
          label="Path"
          placeholder="C:\Users\..."
          density="compact"
        />
      </v-col>
      <v-col cols="2" class="d-flex align-center">
        <v-btn icon variant="tonal" size="small" @click="addTrackedConfig">
          <v-icon>mdi-plus</v-icon>
        </v-btn>
      </v-col>
    </v-row>
  </div>
</template>
