<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
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
const showLaunchWarning = ref(false);

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
  // Auto-run checklist on mount
  if (selectedProfileId.value) {
    await run();
  }
});

// Auto-run when profile changes
watch(selectedProfileId, async (newId) => {
  if (newId) {
    await run();
  }
});

const profileOptions = computed(() =>
  profiles.value.map((p) => ({
    title: `${p.name}${p.isActive ? ' (Active)' : ''}`,
    value: p.id,
  }))
);

const allRequiredPassed = computed(() => lastResult.value?.allRequiredPassed ?? false);

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

function handleLaunch() {
  if (!allRequiredPassed.value) {
    showLaunchWarning.value = true;
    return;
  }
  launchGame();
}

async function launchGame() {
  showLaunchWarning.value = false;
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
    <PageHeader title="Home">
      <template #actions>
        <v-btn variant="text" prepend-icon="mdi-pencil" @click="nav.navigateTo('profiles')">
          Edit Profile
        </v-btn>
        <v-btn icon variant="text" :loading="running" @click="run">
          <v-icon>mdi-refresh</v-icon>
          <v-tooltip activator="parent">Re-run Checks</v-tooltip>
        </v-btn>
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
      <!-- Loading state while checks run -->
      <div v-if="running && !lastResult" class="text-center py-10">
        <v-progress-circular indeterminate size="64" class="mb-4" />
        <div class="text-h6">Running Pre-Flight Checks...</div>
        <div class="text-body-2 text-medium-emphasis">
          Checking {{ selectedProfile.checklistItems.length }} items for "{{
            selectedProfile.name
          }}"
        </div>
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
      </template>

      <!-- No checklist items configured -->
      <v-card
        v-else-if="!running && selectedProfile.checklistItems.length === 0"
        color="surface-variant"
      >
        <v-card-text class="text-center py-10">
          <v-icon size="64" class="mb-4">mdi-clipboard-plus-outline</v-icon>
          <div class="text-h6 mb-2">No Checks Configured</div>
          <div class="text-body-1 text-medium-emphasis mb-4">
            Add checklist items to "{{ selectedProfile.name }}" to verify your rig before launch.
          </div>
          <v-btn color="primary" prepend-icon="mdi-pencil" @click="nav.navigateTo('profiles')">
            Edit Profile
          </v-btn>
        </v-card-text>
      </v-card>

      <!-- Always-visible Launch button -->
      <div v-if="selectedProfile.launchTarget" class="text-center mt-6">
        <v-btn
          size="x-large"
          :color="allRequiredPassed ? 'success' : 'warning'"
          prepend-icon="mdi-rocket-launch"
          :loading="running"
          @click="handleLaunch"
        >
          Launch {{ selectedProfile.name }}
        </v-btn>
        <div v-if="lastResult && !allRequiredPassed" class="text-caption text-warning mt-2">
          Some required checks have not passed
        </div>
      </div>
    </template>

    <!-- No profiles exist -->
    <v-card v-else-if="!profilesLoading && profiles.length === 0" color="surface-variant">
      <v-card-text class="text-center py-10">
        <v-icon size="64" class="mb-4">mdi-hand-wave-outline</v-icon>
        <div class="text-h5 mb-2">Welcome to RigReady</div>
        <div class="text-body-1 text-medium-emphasis mb-6">
          Set up your first profile to start verifying your sim rig before each session.
        </div>
        <v-btn
          color="primary"
          size="large"
          prepend-icon="mdi-auto-fix"
          @click="nav.navigateTo('profile-wizard')"
        >
          Start Setup Wizard
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- Profiles exist but none selected (shouldn't normally happen) -->
    <v-card v-else-if="!profilesLoading" color="surface-variant">
      <v-card-text class="text-center py-10">
        <v-icon size="48" class="mb-4">mdi-account-box-outline</v-icon>
        <div class="text-body-1">Select a profile to run pre-flight checks.</div>
      </v-card-text>
    </v-card>

    <!-- Launch warning dialog -->
    <v-dialog v-model="showLaunchWarning" max-width="450">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon color="warning" class="mr-2">mdi-alert</v-icon>
          Checks Not Passed
        </v-card-title>
        <v-card-text>
          Some required pre-flight checks have not passed. Are you sure you want to launch anyway?
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showLaunchWarning = false">Cancel</v-btn>
          <v-btn color="warning" variant="flat" @click="launchGame">Launch Anyway</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
