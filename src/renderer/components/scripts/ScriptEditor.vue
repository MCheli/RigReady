<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ScriptConfig } from '../../../shared/scriptTypes';

const props = defineProps<{
  modelValue: boolean;
  config?: ScriptConfig | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [config: ScriptConfig];
}>();

const name = ref('');
const scriptPath = ref('');
const args = ref('');
const workingDir = ref('');
const timeout = ref(30);
const runHidden = ref(false);
const successCodes = ref('0');

watch(
  () => props.config,
  (c) => {
    if (c) {
      name.value = c.name;
      scriptPath.value = c.scriptPath;
      args.value = c.arguments.join(' ');
      workingDir.value = c.workingDirectory || '';
      timeout.value = c.timeout;
      runHidden.value = c.runHidden;
      successCodes.value = c.successExitCodes.join(',');
    } else {
      name.value = '';
      scriptPath.value = '';
      args.value = '';
      workingDir.value = '';
      timeout.value = 30;
      runHidden.value = false;
      successCodes.value = '0';
    }
  },
  { immediate: true }
);

function handleSave() {
  if (!name.value.trim() || !scriptPath.value.trim()) return;

  const config: ScriptConfig = {
    id: props.config?.id || `script-${Date.now().toString(36)}`,
    name: name.value.trim(),
    scriptPath: scriptPath.value.trim(),
    arguments: args.value.trim() ? args.value.trim().split(' ') : [],
    workingDirectory: workingDir.value.trim() || undefined,
    timeout: timeout.value,
    runHidden: runHidden.value,
    successExitCodes: successCodes.value
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n)),
  };

  emit('save', config);
  emit('update:modelValue', false);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="550"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ config ? 'Edit Script' : 'Add Script' }}</v-card-title>
      <v-card-text>
        <v-text-field v-model="name" label="Script Name" class="mb-3" />
        <v-text-field v-model="scriptPath" label="Script Path" class="mb-3" />
        <v-text-field v-model="args" label="Arguments" class="mb-3" />
        <v-text-field v-model="workingDir" label="Working Directory (optional)" class="mb-3" />
        <v-row>
          <v-col cols="6">
            <v-text-field v-model.number="timeout" label="Timeout (sec)" type="number" />
          </v-col>
          <v-col cols="6">
            <v-text-field v-model="successCodes" label="Success Exit Codes" placeholder="0" />
          </v-col>
        </v-row>
        <v-checkbox v-model="runHidden" label="Run Hidden" hide-details />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="handleSave">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
