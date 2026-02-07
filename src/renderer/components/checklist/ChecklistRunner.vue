<script setup lang="ts">
import { useChecklist } from '../../composables/useChecklist';
import CheckResultItem from './CheckResultItem.vue';
import ChecklistSummary from './ChecklistSummary.vue';
import type { Profile, Remediation } from '../../../shared/profileTypes';
import { useToast } from '../../composables/useToast';

const props = defineProps<{
  profile: Profile;
}>();

const { lastResult, running, runChecklist, remediate } = useChecklist();
const toast = useToast();

async function run() {
  await runChecklist(props.profile.id);
}

async function handleRemediate(remediation: Remediation) {
  const result = await remediate(remediation);
  if (result.success) {
    toast.success(result.message);
    // Re-run checklist after remediation
    await run();
  } else {
    toast.error(result.message);
  }
}

function getRemediationForItem(checklistItemId: string): Remediation | undefined {
  const item = props.profile.checklistItems.find((i) => i.id === checklistItemId);
  return item?.remediation;
}
</script>

<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-4">
      <h3 class="text-h6">Pre-Flight Checklist</h3>
      <v-btn color="primary" :loading="running" prepend-icon="mdi-play" @click="run">
        Run Checks
      </v-btn>
    </div>

    <template v-if="lastResult">
      <ChecklistSummary :result="lastResult" class="mb-4" />
      <v-card>
        <v-list density="compact">
          <CheckResultItem
            v-for="result in lastResult.results"
            :key="result.checklistItemId"
            :result="result"
            :remediation="getRemediationForItem(result.checklistItemId)"
            @remediate="
              getRemediationForItem(result.checklistItemId) &&
              handleRemediate(getRemediationForItem(result.checklistItemId)!)
            "
          />
        </v-list>
      </v-card>
    </template>
    <v-card v-else color="surface-variant">
      <v-card-text class="text-center py-8">
        <v-icon size="48" class="mb-4">mdi-clipboard-check-outline</v-icon>
        <div class="text-body-1">Click "Run Checks" to verify your rig is ready.</div>
        <div class="text-caption text-medium-emphasis mt-2">
          {{ profile.checklistItems.length }} checks configured
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>
