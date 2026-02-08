<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useProfiles } from '../composables/useProfiles';
import { useToast } from '../composables/useToast';
import PageHeader from '../components/PageHeader.vue';
import ProfileCard from '../components/profiles/ProfileCard.vue';
import ProfileForm from '../components/profiles/ProfileForm.vue';
import ChecklistItemEditor from '../components/profiles/ChecklistItemEditor.vue';
import RemediationEditor from '../components/profiles/RemediationEditor.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import PromptDialog from '../components/PromptDialog.vue';
import type { Profile, ChecklistItem, Remediation } from '../../shared/profileTypes';
import type { Simulator } from '../../shared/types';
import { useNavigation } from '../composables/useNavigation';

const toast = useToast();
const nav = useNavigation();
const {
  profiles,
  currentProfile,
  loading,
  loadProfiles,
  getProfile,
  createProfile,
  saveProfile,
  deleteProfile,
  cloneProfile,
  setActiveProfile,
} = useProfiles();

const showCreateDialog = ref(false);
const showChecklistEditor = ref(false);
const showRemediationEditor = ref(false);
const _editingProfile = ref<Profile | null>(null);
const editingCheckItem = ref<ChecklistItem | null>(null);
const remediationTarget = ref<{ itemIndex: number; remediation: Remediation | null } | null>(null);
const selectedProfileId = ref<string | null>(null);

// Dialog state
const showDeleteProfileConfirm = ref(false);
const pendingDeleteProfileId = ref<string | null>(null);
const pendingDeleteProfileName = ref('');

const showClonePrompt = ref(false);
const pendingCloneId = ref<string | null>(null);

const showDeleteCheckConfirm = ref(false);
const pendingDeleteCheckId = ref<string | null>(null);

onMounted(async () => {
  await loadProfiles();
  if (profiles.value.length > 0 && !selectedProfileId.value) {
    selectedProfileId.value = profiles.value[0].id;
    await getProfile(profiles.value[0].id);
  }
});

async function handleCreate(data: { name: string; game: Simulator }) {
  const profile = await createProfile(data);
  selectedProfileId.value = profile.id;
  await getProfile(profile.id);
  toast.success(`Created profile "${data.name}"`);
}

async function handleSelect(id: string) {
  selectedProfileId.value = id;
  await getProfile(id);
}

function handleDelete(id: string) {
  const profile = profiles.value.find((p) => p.id === id);
  pendingDeleteProfileId.value = id;
  pendingDeleteProfileName.value = profile?.name || '';
  showDeleteProfileConfirm.value = true;
}

async function confirmDeleteProfile() {
  const id = pendingDeleteProfileId.value;
  if (!id) return;
  await deleteProfile(id);
  if (selectedProfileId.value === id) {
    selectedProfileId.value = profiles.value[0]?.id || null;
    if (selectedProfileId.value) {
      await getProfile(selectedProfileId.value);
    } else {
      currentProfile.value = null;
    }
  }
  toast.success('Profile deleted');
}

function handleClone(id: string) {
  pendingCloneId.value = id;
  showClonePrompt.value = true;
}

async function confirmClone(name: string) {
  const id = pendingCloneId.value;
  if (!id) return;
  const cloned = await cloneProfile(id, name);
  if (cloned) {
    selectedProfileId.value = cloned.id;
    await getProfile(cloned.id);
    toast.success(`Cloned as "${name}"`);
  }
}

async function handleSetActive(id: string) {
  await setActiveProfile(id);
  toast.success('Active profile updated');
}

// Checklist item management
function openAddCheck() {
  editingCheckItem.value = null;
  showChecklistEditor.value = true;
}

function openEditCheck(item: ChecklistItem) {
  editingCheckItem.value = item;
  showChecklistEditor.value = true;
}

async function handleSaveCheckItem(item: ChecklistItem) {
  if (!currentProfile.value) return;
  const profile = { ...currentProfile.value };
  const idx = profile.checklistItems.findIndex((c) => c.id === item.id);
  if (idx >= 0) {
    profile.checklistItems[idx] = item;
  } else {
    profile.checklistItems.push(item);
  }
  await saveProfile(profile);
  await getProfile(profile.id);
}

function handleDeleteCheck(id: string) {
  if (!currentProfile.value) return;
  pendingDeleteCheckId.value = id;
  showDeleteCheckConfirm.value = true;
}

async function confirmDeleteCheck() {
  if (!currentProfile.value || !pendingDeleteCheckId.value) return;
  try {
    const profile = JSON.parse(JSON.stringify(currentProfile.value));
    profile.checklistItems = profile.checklistItems.filter(
      (c: ChecklistItem) => c.id !== pendingDeleteCheckId.value
    );
    await saveProfile(profile);
    await getProfile(profile.id);
  } catch {
    toast.error('Failed to delete check');
  }
}

function openRemediationEditor(itemIndex: number) {
  if (!currentProfile.value) return;
  const item = currentProfile.value.checklistItems[itemIndex];
  remediationTarget.value = {
    itemIndex,
    remediation: item.remediation || null,
  };
  showRemediationEditor.value = true;
}

async function handleSaveRemediation(remediation: Remediation) {
  if (!currentProfile.value || remediationTarget.value === null) return;
  const profile = { ...currentProfile.value };
  profile.checklistItems = [...profile.checklistItems];
  profile.checklistItems[remediationTarget.value.itemIndex] = {
    ...profile.checklistItems[remediationTarget.value.itemIndex],
    remediation,
  };
  await saveProfile(profile);
  await getProfile(profile.id);
}

function navigateToHome() {
  nav.navigateTo('home');
}

function navigateToWizard() {
  nav.navigateTo('profile-wizard');
}
</script>

<template>
  <div>
    <PageHeader title="Profiles">
      <template #actions>
        <v-btn variant="outlined" prepend-icon="mdi-auto-fix" @click="navigateToWizard">
          Wizard
        </v-btn>
        <v-btn color="primary" prepend-icon="mdi-plus" @click="showCreateDialog = true">
          New Profile
        </v-btn>
      </template>
    </PageHeader>

    <v-row>
      <!-- Profile List -->
      <v-col cols="12" md="4">
        <div v-if="loading" class="text-center py-8">
          <v-progress-circular indeterminate />
        </div>
        <div v-else-if="profiles.length === 0" class="text-center py-8 text-medium-emphasis">
          <div class="mb-4">No profiles yet. Create one to get started.</div>
          <v-btn color="primary" prepend-icon="mdi-auto-fix" @click="navigateToWizard">
            Start Wizard
          </v-btn>
        </div>
        <div v-else class="d-flex flex-column gap-3">
          <ProfileCard
            v-for="p in profiles"
            :key="p.id"
            :profile="p"
            :selected="selectedProfileId === p.id"
            @select="handleSelect(p.id)"
            @edit="handleSelect(p.id)"
            @clone="handleClone(p.id)"
            @delete="handleDelete(p.id)"
            @set-active="handleSetActive(p.id)"
          />
        </div>
      </v-col>

      <!-- Profile Detail -->
      <v-col cols="12" md="8">
        <template v-if="currentProfile">
          <v-card class="mb-4">
            <v-card-title class="d-flex justify-space-between align-center">
              <span>{{ currentProfile.name }} - Checklist</span>
              <div>
                <v-btn
                  size="small"
                  variant="outlined"
                  prepend-icon="mdi-play"
                  class="mr-2"
                  @click="navigateToHome"
                >
                  Run Checks
                </v-btn>
                <v-btn size="small" color="primary" prepend-icon="mdi-plus" @click="openAddCheck">
                  Add Check
                </v-btn>
              </div>
            </v-card-title>
            <v-card-text>
              <v-list v-if="currentProfile.checklistItems.length > 0" density="compact">
                <v-list-item v-for="(item, index) in currentProfile.checklistItems" :key="item.id">
                  <template #prepend>
                    <v-icon :color="item.isRequired ? 'primary' : 'grey'">
                      {{
                        item.type === 'process'
                          ? 'mdi-application'
                          : item.type === 'device'
                            ? 'mdi-usb'
                            : item.type === 'display'
                              ? 'mdi-monitor'
                              : item.type === 'config'
                                ? 'mdi-file-cog'
                                : 'mdi-script'
                      }}
                    </v-icon>
                  </template>
                  <v-list-item-title>{{ item.name }}</v-list-item-title>
                  <v-list-item-subtitle>
                    {{ item.type }} · {{ item.isRequired ? 'Required' : 'Optional' }}
                    {{ item.remediation ? ' · Has remediation' : '' }}
                  </v-list-item-subtitle>
                  <template #append>
                    <v-btn icon variant="text" size="small" @click="openRemediationEditor(index)">
                      <v-icon>mdi-wrench</v-icon>
                      <v-tooltip activator="parent">Set Remediation</v-tooltip>
                    </v-btn>
                    <v-btn icon variant="text" size="small" @click="openEditCheck(item)">
                      <v-icon>mdi-pencil</v-icon>
                    </v-btn>
                    <v-btn
                      icon
                      variant="text"
                      size="small"
                      color="error"
                      @click="handleDeleteCheck(item.id)"
                    >
                      <v-icon>mdi-delete</v-icon>
                    </v-btn>
                  </template>
                </v-list-item>
              </v-list>
              <div v-else class="text-center text-medium-emphasis py-6">
                No checklist items yet. Add checks to verify your rig is ready before launch.
              </div>
            </v-card-text>
          </v-card>

          <!-- Launch Target -->
          <v-card v-if="currentProfile.launchTarget">
            <v-card-title>Launch Target</v-card-title>
            <v-card-text>
              <div class="text-body-2">
                <strong>Executable:</strong> {{ currentProfile.launchTarget.executablePath }}
              </div>
              <div v-if="currentProfile.launchTarget.arguments.length > 0" class="text-body-2">
                <strong>Arguments:</strong> {{ currentProfile.launchTarget.arguments.join(' ') }}
              </div>
            </v-card-text>
          </v-card>
        </template>
        <v-card v-else color="surface-variant">
          <v-card-text class="text-center py-10">
            <v-icon size="48" class="mb-4">mdi-account-box-outline</v-icon>
            <div class="text-body-1">Select a profile to view and edit its configuration.</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Dialogs -->
    <ProfileForm v-model="showCreateDialog" @save="handleCreate" />
    <ChecklistItemEditor
      v-model="showChecklistEditor"
      :item="editingCheckItem"
      @save="handleSaveCheckItem"
    />
    <RemediationEditor
      v-model="showRemediationEditor"
      :remediation="remediationTarget?.remediation"
      @save="handleSaveRemediation"
    />
    <ConfirmDialog
      v-model="showDeleteProfileConfirm"
      title="Delete Profile"
      :message="`Delete profile &quot;${pendingDeleteProfileName}&quot;?`"
      @confirm="confirmDeleteProfile"
    />
    <ConfirmDialog
      v-model="showDeleteCheckConfirm"
      title="Delete Check"
      message="Delete this check?"
      @confirm="confirmDeleteCheck"
    />
    <PromptDialog
      v-model="showClonePrompt"
      title="Clone Profile"
      label="Profile Name"
      placeholder="Enter a name for the cloned profile"
      @submit="confirmClone"
    />
  </div>
</template>
