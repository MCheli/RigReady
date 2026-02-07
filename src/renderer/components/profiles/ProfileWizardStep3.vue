<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { ChecklistItem } from '../../../shared/profileTypes';
import type { ProcessCheckResult } from '../../../shared/types';

defineProps<{
  items: ChecklistItem[];
}>();

const emit = defineEmits<{
  'update:items': [value: ChecklistItem[]];
}>();

const processes = ref<ProcessCheckResult[]>([]);
const selected = ref<string[]>([]);
const customProcess = ref('');
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    processes.value = await window.rigReady.process.findKnown();
  } catch {
    // Ignore
  } finally {
    loading.value = false;
  }
});

function updateSelection(names: string[]) {
  selected.value = names;
  emitItems();
}

function addCustom() {
  if (!customProcess.value.trim()) return;
  const name = customProcess.value.trim();
  if (!selected.value.includes(name)) {
    selected.value.push(name);
    // Also add to the processes list
    if (!processes.value.find((p) => p.processName === name)) {
      processes.value.push({
        processName: name,
        displayName: name.replace('.exe', ''),
        running: false,
      });
    }
    emitItems();
  }
  customProcess.value = '';
}

function emitItems() {
  const items: ChecklistItem[] = selected.value.map((procName) => {
    const proc = processes.value.find((p) => p.processName === procName);
    return {
      id: `wiz-proc-${procName}`,
      type: 'process' as const,
      name: proc?.displayName || procName.replace('.exe', ''),
      isRequired: false,
      category: 'software' as const,
      config: {
        processName: procName,
        displayName: proc?.displayName,
      },
    };
  });
  emit('update:items', items);
}
</script>

<template>
  <div>
    <h3 class="text-h6 mb-4">Software Checks</h3>
    <p class="text-body-2 text-medium-emphasis mb-6">
      Select software that should be running before you start your session.
    </p>

    <v-progress-linear v-if="loading" indeterminate class="mb-4" />

    <v-list
      v-if="processes.length > 0"
      density="compact"
      class="mb-4"
      style="max-height: 300px; overflow-y: auto"
    >
      <v-list-item v-for="proc in processes" :key="proc.processName">
        <template #prepend>
          <v-checkbox
            :model-value="selected.includes(proc.processName)"
            hide-details
            @update:model-value="
              $event
                ? updateSelection([...selected, proc.processName])
                : updateSelection(selected.filter((s) => s !== proc.processName))
            "
          />
        </template>
        <v-list-item-title>{{ proc.displayName }}</v-list-item-title>
        <v-list-item-subtitle>{{ proc.processName }}</v-list-item-subtitle>
        <template #append>
          <v-chip :color="proc.running ? 'success' : 'grey'" size="x-small" variant="tonal">
            {{ proc.running ? 'Running' : 'Stopped' }}
          </v-chip>
        </template>
      </v-list-item>
    </v-list>

    <v-text-field
      v-model="customProcess"
      label="Add custom process"
      placeholder="e.g., MyApp.exe"
      append-inner-icon="mdi-plus"
      @keydown.enter="addCustom"
      @click:append-inner="addCustom"
    />
  </div>
</template>
