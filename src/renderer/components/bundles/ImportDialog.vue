<script setup lang="ts">
import { ref, watch } from 'vue';
import { useBundles } from '../../composables/useBundles';
import { useToast } from '../../composables/useToast';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  imported: [profileId: string];
}>();

const { importing, importBundle } = useBundles();
const toast = useToast();

const bundlePath = ref('');
const newName = ref('');
const restoreConfigs = ref(false);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      bundlePath.value = '';
      newName.value = '';
      restoreConfigs.value = false;
    }
  }
);

async function handleImport() {
  if (!bundlePath.value.trim()) return;

  const result = await importBundle({
    bundlePath: bundlePath.value.trim(),
    newProfileName: newName.value.trim() || undefined,
    restoreConfigs: restoreConfigs.value,
  });

  if (result.success) {
    toast.success(`Imported profile "${result.profileName}"`);
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        toast.warning(warning);
      }
    }
    if (result.profileId) {
      emit('imported', result.profileId);
    }
    emit('update:modelValue', false);
  } else {
    toast.error(result.error || 'Import failed');
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="500"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Import Profile Bundle</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="bundlePath"
          label="Bundle File Path"
          placeholder="C:\path\to\profile.rigready"
          class="mb-3"
        />

        <v-text-field
          v-model="newName"
          label="Profile Name (optional)"
          placeholder="Leave blank to use original name"
          class="mb-3"
        />

        <v-checkbox
          v-model="restoreConfigs"
          label="Restore config file snapshots to original locations"
          hide-details
        />

        <v-alert v-if="restoreConfigs" type="warning" density="compact" class="mt-3">
          This will overwrite existing config files at their original locations.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!bundlePath.trim()"
          :loading="importing"
          @click="handleImport"
        >
          Import
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
