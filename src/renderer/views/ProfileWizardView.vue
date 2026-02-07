<script setup lang="ts">
import { ref, computed } from 'vue';
import { useProfiles } from '../composables/useProfiles';
import { useToast } from '../composables/useToast';
import { useNavigation } from '../composables/useNavigation';
import PageHeader from '../components/PageHeader.vue';
import ProfileWizardStep1 from '../components/profiles/ProfileWizardStep1.vue';
import ProfileWizardStep2 from '../components/profiles/ProfileWizardStep2.vue';
import ProfileWizardStep3 from '../components/profiles/ProfileWizardStep3.vue';
import ProfileWizardStep4 from '../components/profiles/ProfileWizardStep4.vue';
import type { Simulator } from '../../shared/types';
import type { ChecklistItem, TrackedConfiguration } from '../../shared/profileTypes';

const toast = useToast();
const nav = useNavigation();
const { createProfile, setActiveProfile } = useProfiles();

const step = ref(1);
const totalSteps = 4;

// Step 1 state
const profileName = ref('');
const profileGame = ref<Simulator>('dcs');

// Step 2 state
const deviceItems = ref<ChecklistItem[]>([]);

// Step 3 state
const softwareItems = ref<ChecklistItem[]>([]);

// Step 4 state
const displayItems = ref<ChecklistItem[]>([]);
const trackedConfigs = ref<TrackedConfiguration[]>([]);

const canProceed = computed(() => {
  if (step.value === 1) return profileName.value.trim().length > 0;
  return true;
});

function nextStep() {
  if (step.value < totalSteps) {
    step.value++;
  }
}

function prevStep() {
  if (step.value > 1) {
    step.value--;
  }
}

async function finish() {
  const allChecklistItems = [...deviceItems.value, ...softwareItems.value, ...displayItems.value];

  const profile = await createProfile({
    name: profileName.value.trim(),
    game: profileGame.value,
    checklistItems: allChecklistItems,
  });

  // Set as active and save tracked configs
  await setActiveProfile(profile.id);

  if (trackedConfigs.value.length > 0) {
    const fullProfile = await window.rigReady.profiles.getById(profile.id);
    if (fullProfile) {
      fullProfile.trackedConfigurations = trackedConfigs.value;
      await window.rigReady.profiles.save(fullProfile);
    }
  }

  toast.success(`Profile "${profileName.value}" created!`);
  nav.navigateTo('profiles');
}
</script>

<template>
  <div>
    <PageHeader title="Profile Wizard" />

    <v-card class="mx-auto" max-width="700">
      <!-- Stepper header -->
      <v-card-text>
        <div class="d-flex justify-center mb-6">
          <v-chip
            v-for="s in totalSteps"
            :key="s"
            :color="s === step ? 'primary' : s < step ? 'success' : 'default'"
            :variant="s === step ? 'flat' : 'tonal'"
            class="mx-1"
          >
            {{ s }}
          </v-chip>
        </div>

        <!-- Step content -->
        <ProfileWizardStep1
          v-if="step === 1"
          v-model:name="profileName"
          v-model:game="profileGame"
        />
        <ProfileWizardStep2
          v-else-if="step === 2"
          :items="deviceItems"
          @update:items="deviceItems = $event"
        />
        <ProfileWizardStep3
          v-else-if="step === 3"
          :items="softwareItems"
          @update:items="softwareItems = $event"
        />
        <ProfileWizardStep4
          v-else-if="step === 4"
          :display-items="displayItems"
          :tracked-configs="trackedConfigs"
          @update:display-items="displayItems = $event"
          @update:tracked-configs="trackedConfigs = $event"
        />
      </v-card-text>

      <v-card-actions>
        <v-btn v-if="step > 1" variant="text" @click="prevStep">Back</v-btn>
        <v-btn variant="text" @click="nav.navigateTo('profiles')">Cancel</v-btn>
        <v-spacer />
        <v-btn
          v-if="step < totalSteps"
          color="primary"
          variant="flat"
          :disabled="!canProceed"
          @click="nextStep"
        >
          Next
        </v-btn>
        <v-btn v-else color="primary" variant="flat" :disabled="!canProceed" @click="finish">
          Create Profile
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>
