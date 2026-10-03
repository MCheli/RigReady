<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { displaysContract, type ApplyPreview } from '../contract';
import { joinNames } from '../core/plan';

/**
 * "What would change" before a saved layout is applied. Monitors the layout needs that
 * are not connected are named, and the layout is then only applied when the user says
 * to go without them.
 */
const props = defineProps<{ layoutId: string | undefined }>();
const emit = defineEmits<{ close: []; applied: [message: string] }>();

const api = useClient(displaysContract);
const preview = ref<ApplyPreview>();
const error = ref<string>();
const loading = ref(false);
const applying = ref(false);
const seconds = ref(15);

watch(
  () => props.layoutId,
  async (id) => {
    preview.value = undefined;
    error.value = undefined;
    if (!id) return;
    loading.value = true;
    const [result, pending] = await Promise.all([api.preview({ id }), api.pending()]);
    loading.value = false;
    if (pending.ok) seconds.value = pending.value.seconds;
    if (result.ok) preview.value = result.value;
    else error.value = errorText(result.error);
  },
  { immediate: true }
);

const nothingToDo = computed(
  () =>
    preview.value !== undefined &&
    preview.value.changes.length === 0 &&
    preview.value.missing.length === 0
);
const canApply = computed(
  () => preview.value !== undefined && preview.value.problems.length === 0 && !nothingToDo.value
);
const applyLabel = computed(() =>
  preview.value?.missing.length ? `Apply without ${joinNames(preview.value.missing)}` : 'Apply'
);

async function apply(): Promise<void> {
  if (!preview.value) return;
  applying.value = true;
  error.value = undefined;
  const result = await api.applyLayout({
    id: preview.value.layoutId,
    withoutMissing: preview.value.missing.length > 0,
  });
  applying.value = false;
  notifyMachineChanged();
  if (result.ok) emit('applied', result.value.message);
  else error.value = errorText(result.error);
}
</script>

<template>
  <v-dialog
    :model-value="layoutId !== undefined"
    max-width="560"
    @update:model-value="emit('close')"
  >
    <v-card data-testid="apply-dialog">
      <v-card-title>
        {{ preview ? `Apply "${preview.name}"?` : 'Apply layout' }}
      </v-card-title>
      <v-card-text>
        <div v-if="loading" class="rr-muted">Comparing with the monitors as they are…</div>
        <template v-if="preview">
          <v-alert
            v-if="preview.problems.length"
            type="error"
            variant="tonal"
            class="mb-3"
            data-testid="apply-problems"
          >
            This layout cannot be applied:
            <ul class="apply-list">
              <li v-for="line in preview.problems" :key="line">{{ line }}</li>
            </ul>
          </v-alert>
          <v-alert
            v-if="preview.missing.length"
            type="warning"
            variant="tonal"
            class="mb-3"
            data-testid="apply-missing"
          >
            {{ joinNames(preview.missing) }}
            {{ preview.missing.length === 1 ? 'is' : 'are' }} not connected.
            <template v-if="preview.primaryMissing">
              {{ preview.primaryMissing }} is this layout's main display, so
              {{ preview.primaryLabel }} becomes the main display instead.
            </template>
            You can apply the rest of the layout without
            {{ preview.missing.length === 1 ? 'it' : 'them' }}.
          </v-alert>
          <div v-if="nothingToDo" class="apply-same" data-testid="apply-nothing">
            <v-icon icon="mdi-check" class="rr-ok" /> The monitors already match this layout.
          </div>
          <template v-else-if="preview.changes.length">
            <div class="rr-section-title">What is different now</div>
            <ul class="apply-list" data-testid="apply-changes">
              <li v-for="line in preview.changes" :key="line">{{ line }}</li>
            </ul>
          </template>
          <p v-if="canApply" class="rr-muted apply-note">
            The screens may flicker. You then have {{ seconds }} seconds to keep the new layout; if
            you do nothing, the monitors go back to how they are now.
          </p>
        </template>
        <v-alert v-if="error" type="error" variant="tonal" class="mt-3" data-testid="apply-error">
          {{ error }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="apply-cancel" @click="emit('close')">
          {{ canApply ? 'Cancel' : 'Close' }}
        </v-btn>
        <v-btn
          v-if="canApply"
          color="primary"
          variant="flat"
          :loading="applying"
          data-testid="apply-confirm"
          @click="apply"
        >
          {{ applyLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.apply-list {
  margin: 4px 0 8px;
  padding-left: 20px;
  font-size: 13.5px;
}
.apply-note {
  font-size: 13px;
  margin: 12px 0 0;
}
.apply-same {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
