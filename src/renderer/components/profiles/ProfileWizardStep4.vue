<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { ChecklistItem } from '../../../shared/profileTypes';
import type { DisplayConfiguration } from '../../../shared/types';

defineProps<{
  displayItems: ChecklistItem[];
}>();

const emit = defineEmits<{
  'update:displayItems': [value: ChecklistItem[]];
}>();

const displayConfigs = ref<DisplayConfiguration[]>([]);
const selectedDisplayConfig = ref<string | null>(null);
const loading = ref(false);
const saving = ref(false);
const newConfigName = ref('');

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

async function saveCurrentDisplayConfig() {
  if (!newConfigName.value.trim()) return;
  const savedName = newConfigName.value.trim();
  saving.value = true;
  try {
    await window.rigReady.displays.saveConfiguration(savedName);
    displayConfigs.value = await window.rigReady.displays.getSavedConfigurations();
    newConfigName.value = '';
    selectDisplayConfig(savedName);
  } catch {
    // Ignore
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <h3 class="text-h6 mb-4">Display Configuration</h3>

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
      class="mb-4"
      :loading="loading"
      @update:model-value="selectDisplayConfig"
    />

    <v-row align="center">
      <v-col cols="8">
        <v-text-field
          v-model="newConfigName"
          label="Configuration name"
          placeholder="e.g. Triple Monitor Setup"
          density="compact"
          hide-details
          @keyup.enter="saveCurrentDisplayConfig"
        />
      </v-col>
      <v-col cols="4">
        <v-btn
          variant="tonal"
          size="small"
          prepend-icon="mdi-monitor-screenshot"
          :loading="saving"
          :disabled="!newConfigName.trim()"
          @click="saveCurrentDisplayConfig"
        >
          Save Current
        </v-btn>
      </v-col>
    </v-row>
  </div>
</template>
