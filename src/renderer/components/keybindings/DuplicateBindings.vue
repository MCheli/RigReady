<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface DuplicateEntry {
  actionName: string;
  actionId: string;
  bindingType: 'key' | 'axis';
  key: string;
  modules: string[];
}

interface DuplicateAnalysis {
  deviceGuid: string;
  deviceName: string;
  module: string;
  duplicates: DuplicateEntry[];
}

const selectedModule = ref('');
const modules = ref<{ id: string; name: string }[]>([]);
const duplicates = ref<DuplicateAnalysis[]>([]);
const loading = ref(false);

async function loadModules() {
  loading.value = true;
  try {
    const scanResult = await window.rigReady.dcs.scanModules();
    modules.value = scanResult.modules.map((m) => ({ id: m.id, name: m.name }));
    if (modules.value.length > 0) {
      selectedModule.value = modules.value[0].id;
      await scanDuplicates();
    }
  } finally {
    loading.value = false;
  }
}

async function scanDuplicates() {
  if (!selectedModule.value) return;
  loading.value = true;
  duplicates.value = [];

  try {
    const bindings = await window.rigReady.dcs.getModuleBindings(selectedModule.value);

    // Client-side duplicate detection
    for (const device of bindings) {
      const keyUsage = new Map<string, { actionName: string; actionId: string }[]>();

      for (const binding of device.keyBindings) {
        if (binding.isRemoved) continue;
        const existing = keyUsage.get(binding.key) || [];
        existing.push({ actionName: binding.name, actionId: binding.id });
        keyUsage.set(binding.key, existing);
      }

      const dups: DuplicateEntry[] = [];
      for (const [key, actions] of keyUsage) {
        if (actions.length > 1) {
          for (const action of actions) {
            dups.push({
              actionName: action.actionName,
              actionId: action.actionId,
              bindingType: 'key',
              key,
              modules: [selectedModule.value],
            });
          }
        }
      }

      if (dups.length > 0) {
        duplicates.value.push({
          deviceGuid: device.deviceGuid,
          deviceName: device.deviceName,
          module: selectedModule.value,
          duplicates: dups,
        });
      }
    }
  } finally {
    loading.value = false;
  }
}

onMounted(loadModules);
</script>

<template>
  <v-card>
    <v-card-title>Duplicate Binding Detection</v-card-title>
    <v-card-subtitle>
      Find buttons/keys assigned to multiple actions within a module
    </v-card-subtitle>
    <v-card-text>
      <v-select
        v-model="selectedModule"
        :items="modules"
        item-title="name"
        item-value="id"
        label="Select Module"
        density="compact"
        class="mb-4"
        @update:model-value="scanDuplicates"
      />

      <v-progress-linear v-if="loading" indeterminate class="mb-4" />

      <div v-if="!loading && duplicates.length === 0 && selectedModule" class="text-center py-4">
        <v-icon size="48" color="success" class="mb-2">mdi-check-circle</v-icon>
        <div class="text-body-1">No duplicate bindings found in this module.</div>
      </div>

      <div v-for="analysis in duplicates" :key="analysis.deviceGuid" class="mb-4">
        <div class="text-subtitle-2 mb-2">
          <v-icon size="small" class="mr-1">mdi-gamepad-variant</v-icon>
          {{ analysis.deviceName }}
          <v-chip size="x-small" color="warning" class="ml-2">
            {{ analysis.duplicates.length }} duplicates
          </v-chip>
        </div>

        <v-table density="compact">
          <thead>
            <tr>
              <th>Key/Button</th>
              <th>Action</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="dup in analysis.duplicates" :key="`${dup.actionId}-${dup.key}`">
              <td>
                <v-chip size="x-small" variant="outlined">{{ dup.key }}</v-chip>
              </td>
              <td>{{ dup.actionName }}</td>
              <td>
                <v-chip
                  size="x-small"
                  :color="dup.bindingType === 'axis' ? 'info' : 'default'"
                  variant="tonal"
                >
                  {{ dup.bindingType }}
                </v-chip>
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </v-card-text>
  </v-card>
</template>
