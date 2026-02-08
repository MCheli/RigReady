<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  confirmColor?: string;
}>();

defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [];
}>();
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="420"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ title || 'Confirm' }}</v-card-title>
      <v-card-text>{{ message }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          :color="confirmColor || 'error'"
          variant="flat"
          @click="
            $emit('confirm');
            $emit('update:modelValue', false);
          "
        >
          {{ confirmText || 'Delete' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
