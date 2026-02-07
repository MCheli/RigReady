<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type {
  ChecklistItem,
  ChecklistItemType,
  ChecklistItemCategory,
} from '../../../shared/profileTypes';

const props = defineProps<{
  modelValue: boolean;
  item?: ChecklistItem | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [item: ChecklistItem];
}>();

const name = ref('');
const type = ref<ChecklistItemType>('process');
const isRequired = ref(true);
const category = ref<ChecklistItemCategory>('software');

// Type-specific configs
const processName = ref('');
const processDisplayName = ref('');
const deviceName = ref('');
const configurationName = ref('');
const filePath = ref('');
const contentRegex = ref('');
const scriptPath = ref('');
const scriptArgs = ref('');
const scriptTimeout = ref(30);

const typeOptions = [
  { title: 'Process Running', value: 'process' },
  { title: 'Device Connected', value: 'device' },
  { title: 'Display Configuration', value: 'display' },
  { title: 'Config File', value: 'config' },
  { title: 'Script', value: 'script' },
];

const categoryOptions = [
  { title: 'Software', value: 'software' },
  { title: 'Hardware', value: 'hardware' },
  { title: 'Display', value: 'display' },
  { title: 'Configuration', value: 'configuration' },
  { title: 'Custom', value: 'custom' },
];

const isProcess = computed(() => type.value === 'process');
const isDevice = computed(() => type.value === 'device');
const isDisplay = computed(() => type.value === 'display');
const isConfig = computed(() => type.value === 'config');
const isScript = computed(() => type.value === 'script');

watch(
  () => props.item,
  (item) => {
    if (item) {
      name.value = item.name;
      type.value = item.type;
      isRequired.value = item.isRequired;
      category.value = item.category;
      if (item.type === 'process') {
        processName.value = item.config.processName;
        processDisplayName.value = item.config.displayName || '';
      } else if (item.type === 'device') {
        deviceName.value = item.config.deviceName || '';
      } else if (item.type === 'display') {
        configurationName.value = item.config.configurationName;
      } else if (item.type === 'config') {
        filePath.value = item.config.filePath;
        contentRegex.value = item.config.contentRegex || '';
      } else if (item.type === 'script') {
        scriptPath.value = item.config.scriptPath;
        scriptArgs.value = item.config.arguments.join(' ');
        scriptTimeout.value = item.config.timeout;
      }
    } else {
      name.value = '';
      type.value = 'process';
      isRequired.value = true;
      category.value = 'software';
      processName.value = '';
      processDisplayName.value = '';
      deviceName.value = '';
      configurationName.value = '';
      filePath.value = '';
      contentRegex.value = '';
      scriptPath.value = '';
      scriptArgs.value = '';
      scriptTimeout.value = 30;
    }
  },
  { immediate: true }
);

function handleSave() {
  if (!name.value.trim()) return;

  const id = props.item?.id || `chk-${Date.now().toString(36)}`;
  let item: ChecklistItem;

  switch (type.value) {
    case 'process':
      item = {
        id,
        type: 'process',
        name: name.value.trim(),
        isRequired: isRequired.value,
        category: category.value,
        config: {
          processName: processName.value.trim(),
          displayName: processDisplayName.value.trim() || undefined,
        },
      };
      break;
    case 'device':
      item = {
        id,
        type: 'device',
        name: name.value.trim(),
        isRequired: isRequired.value,
        category: category.value,
        config: {
          deviceName: deviceName.value.trim() || undefined,
        },
      };
      break;
    case 'display':
      item = {
        id,
        type: 'display',
        name: name.value.trim(),
        isRequired: isRequired.value,
        category: category.value,
        config: {
          configurationName: configurationName.value.trim(),
        },
      };
      break;
    case 'config':
      item = {
        id,
        type: 'config',
        name: name.value.trim(),
        isRequired: isRequired.value,
        category: category.value,
        config: {
          filePath: filePath.value.trim(),
          contentRegex: contentRegex.value.trim() || undefined,
        },
      };
      break;
    case 'script':
      item = {
        id,
        type: 'script',
        name: name.value.trim(),
        isRequired: isRequired.value,
        category: category.value,
        config: {
          scriptPath: scriptPath.value.trim(),
          arguments: scriptArgs.value.trim() ? scriptArgs.value.trim().split(' ') : [],
          successExitCodes: [0],
          timeout: scriptTimeout.value,
        },
      };
      break;
    default:
      return;
  }

  emit('save', item);
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
      <v-card-title>{{ item ? 'Edit Check' : 'Add Check' }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="name"
          label="Check Name"
          placeholder="e.g., TrackIR Running"
          class="mb-3"
          autofocus
        />
        <v-select
          v-model="type"
          :items="typeOptions"
          item-title="title"
          item-value="value"
          label="Check Type"
          class="mb-3"
        />
        <v-row class="mb-3">
          <v-col cols="6">
            <v-select
              v-model="category"
              :items="categoryOptions"
              item-title="title"
              item-value="value"
              label="Category"
            />
          </v-col>
          <v-col cols="6" class="d-flex align-center">
            <v-checkbox v-model="isRequired" label="Required" hide-details />
          </v-col>
        </v-row>

        <!-- Process config -->
        <template v-if="isProcess">
          <v-text-field
            v-model="processName"
            label="Process Name"
            placeholder="e.g., TrackIR5.exe"
            class="mb-3"
          />
          <v-text-field
            v-model="processDisplayName"
            label="Display Name (optional)"
            placeholder="e.g., TrackIR 5"
          />
        </template>

        <!-- Device config -->
        <template v-if="isDevice">
          <v-text-field
            v-model="deviceName"
            label="Device Name"
            placeholder="e.g., WinWing Orion2"
          />
        </template>

        <!-- Display config -->
        <template v-if="isDisplay">
          <v-text-field
            v-model="configurationName"
            label="Saved Configuration Name"
            placeholder="e.g., Triple Monitor Sim"
          />
        </template>

        <!-- Config file check -->
        <template v-if="isConfig">
          <v-text-field
            v-model="filePath"
            label="File Path"
            placeholder="e.g., C:\Users\...\options.lua"
            class="mb-3"
          />
          <v-text-field
            v-model="contentRegex"
            label="Content Pattern (optional regex)"
            placeholder="e.g., fullScreen = true"
          />
        </template>

        <!-- Script config -->
        <template v-if="isScript">
          <v-text-field
            v-model="scriptPath"
            label="Script Path"
            placeholder="e.g., C:\Scripts\check.ps1"
            class="mb-3"
          />
          <v-text-field v-model="scriptArgs" label="Arguments (space separated)" class="mb-3" />
          <v-text-field v-model.number="scriptTimeout" label="Timeout (seconds)" type="number" />
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!name.trim()" @click="handleSave">
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
