<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  modelValue: boolean;
  title?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submit: [value: string];
}>();

const inputValue = ref('');

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      inputValue.value = props.defaultValue || '';
    }
  },
  { immediate: true }
);

function handleSubmit() {
  if (!inputValue.value.trim()) return;
  emit('submit', inputValue.value.trim());
  emit('update:modelValue', false);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="420"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ title || 'Enter Value' }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="inputValue"
          :label="label"
          :placeholder="placeholder"
          autofocus
          @keyup.enter="handleSubmit"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!inputValue.trim()" @click="handleSubmit">
          OK
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
