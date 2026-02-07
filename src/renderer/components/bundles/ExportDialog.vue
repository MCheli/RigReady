<script setup lang="ts">
import { ref, watch } from 'vue';
import { useBundles } from '../../composables/useBundles';
import { useToast } from '../../composables/useToast';

const props = defineProps<{
  modelValue: boolean;
  profileId: string;
  profileName: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { exporting, reviewing, exportBundle, reviewPrivacy } = useBundles();
const toast = useToast();

const includeConfigs = ref(true);
const description = ref('');
const privacyFindings = ref<
  { file: string; pattern: string; description: string; severity: string }[]
>([]);
const privacyChecked = ref(false);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      description.value = '';
      privacyFindings.value = [];
      privacyChecked.value = false;
    }
  }
);

async function checkPrivacy() {
  const result = await reviewPrivacy(props.profileId);
  privacyFindings.value = result.findings;
  privacyChecked.value = true;
}

async function handleExport() {
  const result = await exportBundle({
    profileId: props.profileId,
    includeConfigSnapshots: includeConfigs.value,
    description: description.value.trim() || undefined,
  });

  if (result.success) {
    toast.success(`Exported to ${result.bundlePath}`);
    emit('update:modelValue', false);
  } else {
    toast.error(result.error || 'Export failed');
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
      <v-card-title>Export Profile</v-card-title>
      <v-card-subtitle>Export "{{ profileName }}" as a .rigready bundle</v-card-subtitle>
      <v-card-text>
        <v-textarea
          v-model="description"
          label="Description (optional)"
          placeholder="Notes about this profile bundle..."
          rows="2"
          class="mb-3"
        />

        <v-checkbox
          v-model="includeConfigs"
          label="Include config file snapshots"
          hide-details
          class="mb-3"
        />

        <v-btn
          variant="outlined"
          size="small"
          :loading="reviewing"
          class="mb-3"
          @click="checkPrivacy"
        >
          Check for Private Data
        </v-btn>

        <div v-if="privacyChecked">
          <v-alert
            v-if="privacyFindings.length === 0"
            type="success"
            density="compact"
            class="mb-3"
          >
            No privacy issues found.
          </v-alert>
          <div v-else>
            <v-alert type="warning" density="compact" class="mb-2">
              Found {{ privacyFindings.length }} potential privacy issue(s):
            </v-alert>
            <div v-for="(finding, i) in privacyFindings" :key="i" class="text-caption mb-1">
              <v-icon size="x-small" color="warning" class="mr-1">mdi-alert</v-icon>
              <strong>{{ finding.pattern }}</strong
              >: {{ finding.description }}
            </div>
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :loading="exporting" @click="handleExport">
          Export
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
