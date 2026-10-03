<script setup lang="ts">
import { ref, watch } from 'vue';
import type { LaunchTarget, ScriptAction } from '../../../shared/profileTypes';
import type { Simulator } from '../../../shared/types';

const props = defineProps<{
  modelValue: boolean;
  launchTarget: LaunchTarget | null;
  game: Simulator;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [target: LaunchTarget];
}>();

const executablePath = ref('');
const args = ref('');
const workingDirectory = ref('');
const preScripts = ref<ScriptAction[]>([]);
const postScripts = ref<ScriptAction[]>([]);
const autoDetecting = ref(false);

// New script form fields
const newScriptName = ref('');
const newScriptPath = ref('');
const newScriptArgs = ref('');
const newScriptTimeout = ref(30);

watch(
  () => props.launchTarget,
  (lt) => {
    executablePath.value = lt?.executablePath ?? '';
    args.value = lt?.arguments.join(' ') ?? '';
    workingDirectory.value = lt?.workingDirectory ?? '';
    preScripts.value = lt?.preScripts ? [...lt.preScripts] : [];
    postScripts.value = lt?.postScripts ? [...lt.postScripts] : [];
  },
  { immediate: true }
);

function addScript(list: 'pre' | 'post') {
  if (!newScriptName.value.trim() || !newScriptPath.value.trim()) return;
  const script: ScriptAction = {
    id: crypto.randomUUID(),
    name: newScriptName.value.trim(),
    scriptPath: newScriptPath.value.trim(),
    arguments: newScriptArgs.value.trim() ? newScriptArgs.value.trim().split(/\s+/) : [],
    timeout: newScriptTimeout.value,
    runHidden: false,
    successExitCodes: [0],
  };
  if (list === 'pre') {
    preScripts.value.push(script);
  } else {
    postScripts.value.push(script);
  }
  newScriptName.value = '';
  newScriptPath.value = '';
  newScriptArgs.value = '';
  newScriptTimeout.value = 30;
}

function removeScript(list: 'pre' | 'post', index: number) {
  if (list === 'pre') {
    preScripts.value.splice(index, 1);
  } else {
    postScripts.value.splice(index, 1);
  }
}

async function autoDetect() {
  autoDetecting.value = true;
  try {
    const result = await window.rigReady.settings.autoScanSimulator(props.game);
    if (result?.executablePath) {
      executablePath.value = result.executablePath;
    }
  } finally {
    autoDetecting.value = false;
  }
}

function handleSave() {
  const target: LaunchTarget = {
    executablePath: executablePath.value.trim(),
    arguments: args.value.trim() ? args.value.trim().split(/\s+/) : [],
    workingDirectory: workingDirectory.value.trim() || undefined,
    preScripts: [...preScripts.value],
    postScripts: [...postScripts.value],
  };
  emit('save', target);
  emit('update:modelValue', false);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="600"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Edit Launch Target</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="executablePath"
          label="Executable Path"
          placeholder="C:\Program Files\..."
          class="mb-2"
        />
        <v-text-field
          v-model="args"
          label="Arguments"
          placeholder="--fullscreen --vr"
          hint="Space-separated arguments (optional)"
          persistent-hint
          class="mb-2"
        />
        <v-text-field
          v-model="workingDirectory"
          label="Working Directory"
          placeholder="Leave blank to use executable's directory"
          class="mb-4"
        />
        <v-btn
          variant="outlined"
          size="small"
          prepend-icon="mdi-magnify"
          :loading="autoDetecting"
          :disabled="game === 'other'"
          class="mb-6"
          @click="autoDetect"
        >
          Auto-Detect
        </v-btn>

        <!-- Pre-Launch Scripts -->
        <h4 class="text-subtitle-1 mb-2">Pre-Launch Scripts</h4>
        <v-list v-if="preScripts.length > 0" density="compact" class="mb-2">
          <v-list-item v-for="(s, i) in preScripts" :key="s.id">
            <v-list-item-title>{{ s.name }}</v-list-item-title>
            <v-list-item-subtitle>{{ s.scriptPath }}</v-list-item-subtitle>
            <template #append>
              <v-btn icon variant="text" size="small" @click="removeScript('pre', i)">
                <v-icon>mdi-close</v-icon>
              </v-btn>
            </template>
          </v-list-item>
        </v-list>
        <v-row dense class="mb-4">
          <v-col cols="3">
            <v-text-field v-model="newScriptName" label="Name" density="compact" />
          </v-col>
          <v-col cols="4">
            <v-text-field v-model="newScriptPath" label="Script Path" density="compact" />
          </v-col>
          <v-col cols="3">
            <v-text-field v-model="newScriptArgs" label="Args" density="compact" />
          </v-col>
          <v-col cols="2" class="d-flex align-center">
            <v-btn icon variant="tonal" size="small" @click="addScript('pre')">
              <v-icon>mdi-plus</v-icon>
            </v-btn>
          </v-col>
        </v-row>

        <!-- Post-Launch Scripts -->
        <h4 class="text-subtitle-1 mb-2">Post-Launch Scripts</h4>
        <v-list v-if="postScripts.length > 0" density="compact" class="mb-2">
          <v-list-item v-for="(s, i) in postScripts" :key="s.id">
            <v-list-item-title>{{ s.name }}</v-list-item-title>
            <v-list-item-subtitle>{{ s.scriptPath }}</v-list-item-subtitle>
            <template #append>
              <v-btn icon variant="text" size="small" @click="removeScript('post', i)">
                <v-icon>mdi-close</v-icon>
              </v-btn>
            </template>
          </v-list-item>
        </v-list>
        <v-row dense>
          <v-col cols="3">
            <v-text-field v-model="newScriptName" label="Name" density="compact" />
          </v-col>
          <v-col cols="4">
            <v-text-field v-model="newScriptPath" label="Script Path" density="compact" />
          </v-col>
          <v-col cols="3">
            <v-text-field v-model="newScriptArgs" label="Args" density="compact" />
          </v-col>
          <v-col cols="2" class="d-flex align-center">
            <v-btn icon variant="tonal" size="small" @click="addScript('post')">
              <v-icon>mdi-plus</v-icon>
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!executablePath.trim()"
          @click="handleSave"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
