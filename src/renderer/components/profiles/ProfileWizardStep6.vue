<script setup lang="ts">
import { ref, watch } from 'vue';
import type { LaunchTarget } from '../../../shared/profileTypes';
import type { Simulator } from '../../../shared/types';

const props = defineProps<{
  launchTarget: LaunchTarget | null;
  game: Simulator;
}>();

const emit = defineEmits<{
  'update:launchTarget': [value: LaunchTarget | null];
}>();

const executablePath = ref(props.launchTarget?.executablePath ?? '');
const args = ref(props.launchTarget?.arguments.join(' ') ?? '');
const workingDirectory = ref(props.launchTarget?.workingDirectory ?? '');
const autoDetecting = ref(false);

watch(
  () => props.launchTarget,
  (val) => {
    executablePath.value = val?.executablePath ?? '';
    args.value = val?.arguments.join(' ') ?? '';
    workingDirectory.value = val?.workingDirectory ?? '';
  }
);

function emitUpdate() {
  if (!executablePath.value.trim()) {
    emit('update:launchTarget', null);
    return;
  }
  const target: LaunchTarget = {
    executablePath: executablePath.value.trim(),
    arguments: args.value.trim() ? args.value.trim().split(/\s+/) : [],
    workingDirectory: workingDirectory.value.trim() || undefined,
    preScripts: props.launchTarget?.preScripts ?? [],
    postScripts: props.launchTarget?.postScripts ?? [],
  };
  emit('update:launchTarget', target);
}

async function autoDetect() {
  autoDetecting.value = true;
  try {
    const result = await window.rigReady.settings.autoScanSimulator(props.game);
    if (result?.executablePath) {
      executablePath.value = result.executablePath;
      emitUpdate();
    }
  } finally {
    autoDetecting.value = false;
  }
}
</script>

<template>
  <div>
    <h3 class="text-h6 mb-4">Launch Target</h3>

    <p class="text-body-2 text-medium-emphasis mb-4">
      Configure the executable to launch when you click the Launch button. This step is optional.
    </p>

    <v-text-field
      v-model="executablePath"
      label="Executable Path"
      placeholder="C:\Program Files\..."
      class="mb-2"
      @update:model-value="emitUpdate"
    />

    <v-text-field
      v-model="args"
      label="Arguments"
      placeholder="--fullscreen --vr"
      hint="Space-separated arguments (optional)"
      persistent-hint
      class="mb-2"
      @update:model-value="emitUpdate"
    />

    <v-text-field
      v-model="workingDirectory"
      label="Working Directory"
      placeholder="Leave blank to use executable's directory"
      class="mb-4"
      @update:model-value="emitUpdate"
    />

    <v-btn
      variant="outlined"
      prepend-icon="mdi-magnify"
      :loading="autoDetecting"
      :disabled="game === 'other'"
      @click="autoDetect"
    >
      Auto-Detect
    </v-btn>
    <span v-if="game === 'other'" class="text-caption text-medium-emphasis ml-2">
      Auto-detect not available for "Other" simulator
    </span>
  </div>
</template>
