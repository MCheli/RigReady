<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useProfiles } from '../composables/useProfiles';
import { useChecklist } from '../composables/useChecklist';
import { useToast } from '../composables/useToast';
import { useNavigation } from '../composables/useNavigation';
import PageHeader from '../components/PageHeader.vue';
import CheckResultItem from '../components/checklist/CheckResultItem.vue';
import ChecklistSummary from '../components/checklist/ChecklistSummary.vue';
import type { Profile, Remediation } from '../../shared/profileTypes';

const toast = useToast();
const nav = useNavigation();
const { profiles, loading: profilesLoading, loadProfiles, getProfile } = useProfiles();
const { lastResult, running, runChecklist, remediate } = useChecklist();

const selectedProfileId = ref<string | null>(null);
const selectedProfile = ref<Profile | null>(null);

onMounted(async () => {
  await loadProfiles();
  // Auto-select active profile
  const active = profiles.value.find((p) => p.isActive);
  if (active) {
    selectedProfileId.value = active.id;
    selectedProfile.value = (await getProfile(active.id)) || null;
  } else if (profiles.value.length > 0) {
    selectedProfileId.value = profiles.value[0].id;
    selectedProfile.value = (await getProfile(profiles.value[0].id)) || null;
  }
});

const profileOptions = computed(() =>
  profiles.value.map((p) => ({
    title: `${p.name}${p.isActive ? ' (Active)' : ''}`,
    value: p.id,
  }))
);

async function onProfileChange(id: string) {
  selectedProfileId.value = id;
  selectedProfile.value = (await getProfile(id)) || null;
  lastResult.value = null;
}

async function run() {
  if (!selectedProfileId.value) return;
  await runChecklist(selectedProfileId.value);
}

async function handleRemediate(remediation: Remediation) {
  const result = await remediate(remediation);
  if (result.success) {
    toast.success(result.message);
    await run();
  } else {
    toast.error(result.message);
  }
}

function getRemediationForItem(checklistItemId: string): Remediation | undefined {
  return selectedProfile.value?.checklistItems.find((i) => i.id === checklistItemId)?.remediation;
}

async function launchGame() {
  if (!selectedProfile.value?.launchTarget) return;
  const target = selectedProfile.value.launchTarget;

  try {
    // Run pre-launch scripts
    for (const script of target.preScripts) {
      toast.info(`Running pre-launch: ${script.name}...`);
      const result = await window.rigReady.scripts.execute({
        id: script.id,
        name: script.name,
        scriptPath: script.scriptPath,
        arguments: script.arguments,
        timeout: script.timeout,
        runHidden: script.runHidden,
        successExitCodes: script.successExitCodes,
        environmentVariables: {},
      });
      if (!result.success) {
        toast.error(
          `Pre-launch script "${script.name}" failed: ${result.stderr || 'Unknown error'}`
        );
        return; // Abort launch
      }
    }

    // Launch the game
    await window.rigReady.process.launch(target.executablePath, target.arguments);
    toast.success(`Launching ${selectedProfile.value.name}...`);

    // Run post-launch scripts (don't block on failure)
    for (const script of target.postScripts) {
      toast.info(`Running post-launch: ${script.name}...`);
      const result = await window.rigReady.scripts.execute({
        id: script.id,
        name: script.name,
        scriptPath: script.scriptPath,
        arguments: script.arguments,
        timeout: script.timeout,
        runHidden: script.runHidden,
        successExitCodes: script.successExitCodes,
        environmentVariables: {},
      });
      if (!result.success) {
        toast.error(
          `Post-launch script "${script.name}" failed: ${result.stderr || 'Unknown error'}`
        );
      }
    }
  } catch {
    toast.error('Failed to launch');
  }
}
</script>

<template>
  <div>
    <PageHeader title="Pre-Flight Checklist">
      <template #actions>
        <v-select
          v-model="selectedProfileId"
          :items="profileOptions"
          item-title="title"
          item-value="value"
          label="Profile"
          density="compact"
          hide-details
          style="min-width: 250px"
          :loading="profilesLoading"
          @update:model-value="onProfileChange"
        />
      </template>
    </PageHeader>

    <template v-if="selectedProfile">
      <!-- Run button -->
      <div class="d-flex justify-center mb-6">
        <v-btn
          size="x-large"
          color="primary"
          :loading="running"
          prepend-icon="mdi-clipboard-check"
          @click="run"
        >
          Run Pre-Flight Checks
        </v-btn>
      </div>

      <!-- Results -->
      <template v-if="lastResult">
        <ChecklistSummary :result="lastResult" class="mb-6" />

        <v-card class="mb-6">
          <v-card-title>Check Results</v-card-title>
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

        <!-- Launch button -->
        <div
          v-if="selectedProfile.launchTarget && lastResult.allRequiredPassed"
          class="text-center"
        >
          <v-btn
            size="x-large"
            color="success"
            prepend-icon="mdi-rocket-launch"
            @click="launchGame"
          >
            Launch {{ selectedProfile.name }}
          </v-btn>
        </div>
      </template>

      <!-- No results yet -->
      <v-card v-else color="surface-variant">
        <v-card-text class="text-center py-10">
          <v-icon size="64" class="mb-4">mdi-clipboard-check-outline</v-icon>
          <div class="text-h6 mb-2">Ready to Check</div>
          <div class="text-body-1 text-medium-emphasis">
            {{ selectedProfile.checklistItems.length }} checks configured for "{{
              selectedProfile.name
            }}"
          </div>
        </v-card-text>
      </v-card>
    </template>

    <v-card v-else color="surface-variant">
      <v-card-text class="text-center py-10">
        <v-icon size="48" class="mb-4">mdi-account-box-outline</v-icon>
        <div class="text-body-1 mb-4">
          {{
            profiles.length === 0
              ? 'Create a profile to get started with pre-flight checks.'
              : 'Select a profile to run pre-flight checks.'
          }}
        </div>
        <v-btn
          v-if="profiles.length === 0"
          color="primary"
          prepend-icon="mdi-plus"
          @click="nav.navigateTo('profile-wizard')"
        >
          Create Profile
        </v-btn>
      </v-card-text>
    </v-card>
  </div>
</template>
