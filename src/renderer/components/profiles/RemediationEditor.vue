<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { Remediation, RemediationType } from '../../../shared/profileTypes';

const props = defineProps<{
  modelValue: boolean;
  remediation?: Remediation | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [remediation: Remediation];
}>();

const type = ref<RemediationType>('launchProcess');
const executablePath = ref('');
const execArgs = ref('');
const waitAfterLaunch = ref(2);
const message = ref('');
const instructions = ref('');
const configurationName = ref('');
const sourcePath = ref('');
const targetPath = ref('');
const scriptPath = ref('');
const scriptArgs = ref('');
const scriptTimeout = ref(30);

const typeOptions = [
  { title: 'Launch Process', value: 'launchProcess' },
  { title: 'Auto-Fix Display', value: 'autoFixDisplay' },
  { title: 'Restore Config', value: 'restoreConfig' },
  { title: 'Notify User', value: 'notifyUser' },
  { title: 'Run Script', value: 'script' },
];

const isLaunchProcess = computed(() => type.value === 'launchProcess');
const isAutoFixDisplay = computed(() => type.value === 'autoFixDisplay');
const isRestoreConfig = computed(() => type.value === 'restoreConfig');
const isNotifyUser = computed(() => type.value === 'notifyUser');
const isScript = computed(() => type.value === 'script');

watch(
  () => props.remediation,
  (r) => {
    if (r) {
      type.value = r.type;
      if (r.type === 'launchProcess') {
        executablePath.value = r.config.executablePath;
        execArgs.value = (r.config.arguments || []).join(' ');
        waitAfterLaunch.value = (r.config.waitAfterLaunch || 2000) / 1000;
      } else if (r.type === 'autoFixDisplay') {
        configurationName.value = r.config.configurationName;
      } else if (r.type === 'restoreConfig') {
        sourcePath.value = r.config.sourcePath;
        targetPath.value = r.config.targetPath;
      } else if (r.type === 'notifyUser') {
        message.value = r.config.message;
        instructions.value = r.config.instructions || '';
      } else if (r.type === 'script') {
        scriptPath.value = r.config.scriptPath;
        scriptArgs.value = r.config.arguments.join(' ');
        scriptTimeout.value = r.config.timeout;
      }
    }
  },
  { immediate: true }
);

function handleSave() {
  let remediation: Remediation;

  switch (type.value) {
    case 'launchProcess':
      remediation = {
        type: 'launchProcess',
        config: {
          executablePath: executablePath.value.trim(),
          arguments: execArgs.value.trim() ? execArgs.value.trim().split(' ') : undefined,
          waitAfterLaunch: waitAfterLaunch.value * 1000,
        },
      };
      break;
    case 'autoFixDisplay':
      remediation = {
        type: 'autoFixDisplay',
        config: { configurationName: configurationName.value.trim() },
      };
      break;
    case 'restoreConfig':
      remediation = {
        type: 'restoreConfig',
        config: {
          sourcePath: sourcePath.value.trim(),
          targetPath: targetPath.value.trim(),
        },
      };
      break;
    case 'notifyUser':
      remediation = {
        type: 'notifyUser',
        config: {
          message: message.value.trim(),
          instructions: instructions.value.trim() || undefined,
        },
      };
      break;
    case 'script':
      remediation = {
        type: 'script',
        config: {
          scriptPath: scriptPath.value.trim(),
          arguments: scriptArgs.value.trim() ? scriptArgs.value.trim().split(' ') : [],
          timeout: scriptTimeout.value,
        },
      };
      break;
    default:
      return;
  }

  emit('save', remediation);
  emit('update:modelValue', false);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="500"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Configure Remediation</v-card-title>
      <v-card-text>
        <v-select
          v-model="type"
          :items="typeOptions"
          item-title="title"
          item-value="value"
          label="Remediation Type"
          class="mb-3"
        />

        <template v-if="isLaunchProcess">
          <v-text-field v-model="executablePath" label="Executable Path" class="mb-3" />
          <v-text-field v-model="execArgs" label="Arguments (optional)" class="mb-3" />
          <v-text-field
            v-model.number="waitAfterLaunch"
            label="Wait After Launch (seconds)"
            type="number"
          />
        </template>

        <template v-if="isAutoFixDisplay">
          <v-text-field v-model="configurationName" label="Display Configuration Name" />
        </template>

        <template v-if="isRestoreConfig">
          <v-text-field v-model="sourcePath" label="Source (backup) Path" class="mb-3" />
          <v-text-field v-model="targetPath" label="Target Path" />
        </template>

        <template v-if="isNotifyUser">
          <v-text-field v-model="message" label="Message" class="mb-3" />
          <v-textarea v-model="instructions" label="Instructions (optional)" rows="3" />
        </template>

        <template v-if="isScript">
          <v-text-field v-model="scriptPath" label="Script Path" class="mb-3" />
          <v-text-field v-model="scriptArgs" label="Arguments" class="mb-3" />
          <v-text-field v-model.number="scriptTimeout" label="Timeout (seconds)" type="number" />
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="handleSave">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
