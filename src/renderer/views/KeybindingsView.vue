<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  useKeybindings,
  useKeybindingProfiles,
  usePygame,
  useHid,
  type KeybindingProfile,
  type CommonAction,
  type ActionCategory,
} from '../composables/useRigReady';
import { useToast } from '../composables/useToast';
import { DEFAULT_ACTION_CATEGORIES } from '../../shared/types';
import PageHeader from '../components/PageHeader.vue';
import DCSBindingsPanel from '../components/dcs/DCSBindingsPanel.vue';
import DCSUuidMigration from '../components/keybindings/DCSUuidMigration.vue';
import DuplicateBindings from '../components/keybindings/DuplicateBindings.vue';
import PerDeviceView from '../components/keybindings/PerDeviceView.vue';
import SnapshotManager from '../components/keybindings/SnapshotManager.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import PromptDialog from '../components/PromptDialog.vue';

const toast = useToast();

// Legacy backup system
const {
  simulators,
  backups,
  loading: backupsLoading,
  loadKeybindings,
  createBackup,
  restoreBackup,
  deleteBackup,
} = useKeybindings();

// New unified profile system
const profilesComposable = useKeybindingProfiles();
const pygame = usePygame();
const hid = useHid();

// UI State
const activeTab = ref('profiles');
const selectedProfileId = ref<string | null>(null);
const showNewProfileDialog = ref(false);
const showActionDialog = ref(false);
const showInputCaptureDialog = ref(false);
const newProfileName = ref('');
const newProfileDescription = ref('');

// Action editing state
const editingAction = ref<CommonAction | null>(null);
const actionForm = ref({
  name: '',
  category: 'flight-controls' as ActionCategory,
  description: '',
  isAxisAction: false,
});

// Input capture state
const capturedInput = ref<{
  deviceId: string;
  deviceName: string;
  inputType: string;
  inputIndex: number;
} | null>(null);
const isCapturing = ref(false);

// Confirm/prompt dialog state
const showBackupPrompt = ref(false);
const pendingBackupSimulator = ref('');

const showRestoreConfirm = ref(false);
const pendingRestoreName = ref('');

const showDeleteBackupConfirm = ref(false);
const pendingDeleteBackupName = ref('');

const showDeleteProfileConfirm = ref(false);
const pendingDeleteProfileId = ref('');

const showImportPrompt = ref(false);
const pendingImportJson = ref('');

const showDuplicatePrompt = ref(false);
const pendingDuplicateId = ref('');

const showDeleteActionConfirm = ref(false);
const pendingDeleteActionId = ref('');

// Category filter
const selectedCategory = ref<ActionCategory | 'all'>('all');

// Computed
const selectedProfile = computed(() => {
  if (!selectedProfileId.value) return null;
  return profilesComposable.profiles.value.find((p) => p.id === selectedProfileId.value) || null;
});

const filteredActions = computed(() => {
  if (!selectedProfile.value) return [];
  if (selectedCategory.value === 'all') {
    return selectedProfile.value.commonActions;
  }
  return selectedProfile.value.commonActions.filter((a) => a.category === selectedCategory.value);
});

const categoryOptions = computed(() => {
  return [
    { title: 'All Categories', value: 'all' },
    ...Object.entries(DEFAULT_ACTION_CATEGORIES).map(([value, title]) => ({ title, value })),
  ];
});

// Methods
async function loadData() {
  await Promise.all([loadKeybindings(), profilesComposable.loadProfiles()]);

  // Select first profile if available
  if (profilesComposable.profiles.value.length > 0 && !selectedProfileId.value) {
    selectedProfileId.value = profilesComposable.profiles.value[0].id;
  }
}

// Legacy backup handlers
function handleBackup(simulator: string) {
  pendingBackupSimulator.value = simulator;
  showBackupPrompt.value = true;
}

async function confirmBackup(name: string) {
  await createBackup(pendingBackupSimulator.value, name);
  await loadKeybindings();
}

function handleRestore(name: string) {
  pendingRestoreName.value = name;
  showRestoreConfirm.value = true;
}

async function confirmRestore() {
  await restoreBackup(pendingRestoreName.value);
  toast.success('Backup restored!');
}

function handleDeleteBackup(name: string) {
  pendingDeleteBackupName.value = name;
  showDeleteBackupConfirm.value = true;
}

async function confirmDeleteBackup() {
  await deleteBackup(pendingDeleteBackupName.value);
  await loadKeybindings();
}

// Profile handlers
async function createProfile() {
  if (!newProfileName.value.trim()) return;

  const profile: KeybindingProfile = {
    id: crypto.randomUUID(),
    name: newProfileName.value.trim(),
    description: newProfileDescription.value.trim() || undefined,
    commonActions: [],
    vehicleBindings: [],
    created: Date.now(),
    modified: Date.now(),
  };

  await profilesComposable.saveProfile(profile);
  selectedProfileId.value = profile.id;
  showNewProfileDialog.value = false;
  newProfileName.value = '';
  newProfileDescription.value = '';
}

function deleteProfile(id: string) {
  pendingDeleteProfileId.value = id;
  showDeleteProfileConfirm.value = true;
}

async function confirmDeleteProfile() {
  const id = pendingDeleteProfileId.value;
  await profilesComposable.deleteProfile(id);
  if (selectedProfileId.value === id) {
    selectedProfileId.value = profilesComposable.profiles.value[0]?.id || null;
  }
}

async function exportProfileToClipboard(id: string) {
  const json = await profilesComposable.exportProfile(id);
  if (json) {
    await navigator.clipboard.writeText(json);
    toast.success('Profile copied to clipboard!');
  }
}

async function importProfileFromClipboard() {
  try {
    const json = await navigator.clipboard.readText();
    pendingImportJson.value = json;
    showImportPrompt.value = true;
  } catch {
    toast.error('Failed to read clipboard. Make sure you have copied a profile JSON.');
  }
}

async function confirmImport(newName: string) {
  const imported = await profilesComposable.importProfile(
    pendingImportJson.value,
    newName || undefined
  );
  if (imported) {
    selectedProfileId.value = imported.id;
    toast.success('Profile imported successfully!');
  } else {
    toast.error(
      'Failed to import profile. Make sure you have a valid profile JSON in your clipboard.'
    );
  }
}

function duplicateProfile(id: string) {
  pendingDuplicateId.value = id;
  showDuplicatePrompt.value = true;
}

async function confirmDuplicate(newName: string) {
  const duplicate = await profilesComposable.duplicateProfile(pendingDuplicateId.value, newName);
  if (duplicate) {
    selectedProfileId.value = duplicate.id;
  }
}

// Action handlers
function openAddAction() {
  editingAction.value = null;
  actionForm.value = {
    name: '',
    category: 'flight-controls',
    description: '',
    isAxisAction: false,
  };
  showActionDialog.value = true;
}

function openEditAction(action: CommonAction) {
  editingAction.value = action;
  actionForm.value = {
    name: action.name,
    category: action.category,
    description: action.description || '',
    isAxisAction: action.isAxisAction || false,
  };
  showActionDialog.value = true;
}

async function saveAction() {
  if (!selectedProfileId.value || !actionForm.value.name.trim()) return;

  const action: CommonAction = {
    id: editingAction.value?.id || crypto.randomUUID(),
    name: actionForm.value.name.trim(),
    category: actionForm.value.category,
    description: actionForm.value.description.trim() || undefined,
    isAxisAction: actionForm.value.isAxisAction,
    physicalInput: editingAction.value?.physicalInput || {
      deviceId: '',
      inputType: 'button',
      inputIndex: 0,
    },
  };

  if (editingAction.value) {
    await profilesComposable.updateAction(selectedProfileId.value, action.id, action);
  } else {
    await profilesComposable.addAction(selectedProfileId.value, action);
  }

  // Refresh profile
  await profilesComposable.getProfile(selectedProfileId.value);
  showActionDialog.value = false;
}

function deleteAction(actionId: string) {
  if (!selectedProfileId.value) return;
  pendingDeleteActionId.value = actionId;
  showDeleteActionConfirm.value = true;
}

async function confirmDeleteAction() {
  if (!selectedProfileId.value) return;
  await profilesComposable.removeAction(selectedProfileId.value, pendingDeleteActionId.value);
  await profilesComposable.getProfile(selectedProfileId.value);
}

// Input capture
function startInputCapture(action: CommonAction) {
  editingAction.value = action;
  capturedInput.value = null;
  isCapturing.value = true;
  showInputCaptureDialog.value = true;

  // Start listening for inputs
  pygame.startMonitoring();
  hid.startMonitoring();
}

function cancelInputCapture() {
  isCapturing.value = false;
  showInputCaptureDialog.value = false;
  pygame.stopMonitoring();
  hid.stopMonitoring();
}

async function confirmInputCapture() {
  if (!capturedInput.value || !editingAction.value || !selectedProfileId.value) return;

  const updatedAction: Partial<CommonAction> = {
    physicalInput: {
      deviceId: capturedInput.value.deviceId,
      deviceName: capturedInput.value.deviceName,
      inputType: capturedInput.value.inputType as 'button' | 'axis' | 'hat',
      inputIndex: capturedInput.value.inputIndex,
    },
  };

  await profilesComposable.updateAction(
    selectedProfileId.value,
    editingAction.value.id,
    updatedAction
  );
  await profilesComposable.getProfile(selectedProfileId.value);

  cancelInputCapture();
}

// Format physical input for display
function formatPhysicalInput(action: CommonAction): string {
  const input = action.physicalInput;
  if (!input || !input.deviceId) return 'Not assigned';

  const deviceName = input.deviceName || input.deviceId;
  const inputType = input.inputType.charAt(0).toUpperCase() + input.inputType.slice(1);
  return `${deviceName} - ${inputType} ${input.inputIndex}`;
}

// Set up input listeners
onMounted(() => {
  loadData();

  pygame.onInputStates((states) => {
    if (!isCapturing.value) return;

    for (const state of states) {
      // Check buttons
      for (let i = 0; i < state.buttons.length; i++) {
        if (state.buttons[i]) {
          capturedInput.value = {
            deviceId: `pygame:${state.index}`,
            deviceName: state.name,
            inputType: 'button',
            inputIndex: i,
          };
          return;
        }
      }

      // Check axes (threshold of 0.5)
      for (let i = 0; i < state.axes.length; i++) {
        if (Math.abs(state.axes[i]) > 0.5) {
          capturedInput.value = {
            deviceId: `pygame:${state.index}`,
            deviceName: state.name,
            inputType: 'axis',
            inputIndex: i,
          };
          return;
        }
      }
    }
  });

  hid.onInputStates((states) => {
    if (!isCapturing.value) return;

    for (const state of states) {
      // Check buttons
      for (let i = 0; i < state.buttons.length; i++) {
        if (state.buttons[i]) {
          capturedInput.value = {
            deviceId: `hid:${state.path}`,
            deviceName: state.productName,
            inputType: 'button',
            inputIndex: i,
          };
          return;
        }
      }
    }
  });
});

onUnmounted(() => {
  pygame.stopMonitoring();
  hid.stopMonitoring();
});
</script>

<template>
  <div class="keybindings-view">
    <PageHeader title="Keybinding Manager" />

    <v-tabs v-model="activeTab" class="mb-6">
      <v-tab value="profiles">Keybinding Profiles</v-tab>
      <v-tab value="backups">Sim Backups</v-tab>
      <v-tab value="dcs">DCS Bindings</v-tab>
      <v-tab value="duplicates">Duplicates</v-tab>
      <v-tab value="per-device">Per Device</v-tab>
      <v-tab value="snapshots">Snapshots</v-tab>
      <v-tab value="uuid-migration">UUID Migration</v-tab>
    </v-tabs>

    <!-- Keybinding Profiles Tab -->
    <div v-if="activeTab === 'profiles'">
      <v-row>
        <!-- Profile List -->
        <v-col cols="12" md="4">
          <v-card>
            <v-card-title class="d-flex justify-space-between align-center">
              Profiles
              <div class="d-flex align-center">
                <v-btn
                  size="small"
                  variant="outlined"
                  class="mr-4"
                  @click="importProfileFromClipboard"
                >
                  <v-icon start>mdi-import</v-icon>
                  Import
                </v-btn>
                <v-btn size="small" color="primary" @click="showNewProfileDialog = true">
                  <v-icon start>mdi-plus</v-icon>
                  New
                </v-btn>
              </div>
            </v-card-title>
            <v-card-text>
              <v-list v-if="profilesComposable.profiles.value.length > 0" density="compact">
                <v-list-item
                  v-for="profile in profilesComposable.profiles.value"
                  :key="profile.id"
                  :active="selectedProfileId === profile.id"
                  @click="selectedProfileId = profile.id"
                  rounded
                >
                  <v-list-item-title>{{ profile.name }}</v-list-item-title>
                  <v-list-item-subtitle>
                    {{ profile.commonActions.length }} actions
                  </v-list-item-subtitle>
                  <template #append>
                    <v-menu>
                      <template #activator="{ props }">
                        <v-btn v-bind="props" icon variant="text" size="small">
                          <v-icon>mdi-dots-vertical</v-icon>
                        </v-btn>
                      </template>
                      <v-list density="compact">
                        <v-list-item @click="duplicateProfile(profile.id)">
                          <v-list-item-title>Duplicate</v-list-item-title>
                        </v-list-item>
                        <v-list-item @click="exportProfileToClipboard(profile.id)">
                          <v-list-item-title>Export to Clipboard</v-list-item-title>
                        </v-list-item>
                        <v-list-item @click="deleteProfile(profile.id)">
                          <v-list-item-title class="text-error">Delete</v-list-item-title>
                        </v-list-item>
                      </v-list>
                    </v-menu>
                  </template>
                </v-list-item>
              </v-list>
              <div v-else class="text-center text-medium-emphasis py-4">
                No profiles yet. Create one to get started.
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Actions Editor -->
        <v-col cols="12" md="8">
          <v-card v-if="selectedProfile">
            <v-card-title class="d-flex justify-space-between align-center">
              <span>{{ selectedProfile.name }} - Actions</span>
              <div class="d-flex gap-2">
                <v-select
                  v-model="selectedCategory"
                  :items="categoryOptions"
                  item-title="title"
                  item-value="value"
                  density="compact"
                  hide-details
                  style="max-width: 200px"
                />
                <v-btn size="small" color="primary" @click="openAddAction">
                  <v-icon start>mdi-plus</v-icon>
                  Add Action
                </v-btn>
              </div>
            </v-card-title>
            <v-card-text>
              <v-table v-if="filteredActions.length > 0" density="compact">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Category</th>
                    <th>Physical Input</th>
                    <th style="width: 120px">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="action in filteredActions" :key="action.id">
                    <td>
                      <div class="font-weight-medium">{{ action.name }}</div>
                      <div v-if="action.description" class="text-caption text-medium-emphasis">
                        {{ action.description }}
                      </div>
                    </td>
                    <td>
                      <v-chip size="x-small" variant="tonal">
                        {{ DEFAULT_ACTION_CATEGORIES[action.category] }}
                      </v-chip>
                    </td>
                    <td>
                      <v-btn size="small" variant="outlined" @click="startInputCapture(action)">
                        {{ formatPhysicalInput(action) }}
                      </v-btn>
                    </td>
                    <td>
                      <v-btn icon variant="text" size="small" @click="openEditAction(action)">
                        <v-icon>mdi-pencil</v-icon>
                      </v-btn>
                      <v-btn
                        icon
                        variant="text"
                        size="small"
                        color="error"
                        @click="deleteAction(action.id)"
                      >
                        <v-icon>mdi-delete</v-icon>
                      </v-btn>
                    </td>
                  </tr>
                </tbody>
              </v-table>
              <div v-else class="text-center text-medium-emphasis py-8">
                <v-icon size="48" class="mb-4">mdi-keyboard-outline</v-icon>
                <div>No actions defined yet. Click "Add Action" to create your first binding.</div>
              </div>
            </v-card-text>
          </v-card>
          <v-card v-else color="surface-variant">
            <v-card-text class="text-center py-10">
              <v-icon size="48" class="mb-4">mdi-keyboard</v-icon>
              <div class="text-body-1">Select a profile to view and edit its keybindings.</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <!-- Sim Backups Tab (Legacy) -->
    <div v-else-if="activeTab === 'backups'">
      <v-btn
        variant="outlined"
        prepend-icon="mdi-refresh"
        :loading="backupsLoading"
        class="mb-6"
        @click="loadKeybindings"
      >
        Scan Simulators
      </v-btn>

      <!-- Status Summary -->
      <v-row class="mb-6">
        <v-col cols="12" md="6">
          <v-card color="surface-variant">
            <v-card-text class="text-center">
              <div class="text-h3 font-weight-bold">
                {{ simulators.filter((s) => s.installed).length }}
              </div>
              <div class="text-caption text-medium-emphasis">Simulators Found</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="6">
          <v-card color="surface-variant">
            <v-card-text class="text-center">
              <div class="text-h3 font-weight-bold">
                {{ backups.length }}
              </div>
              <div class="text-caption text-medium-emphasis">Backups</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Detected Simulators -->
      <h2 class="text-h6 mb-4">Detected Simulators</h2>
      <v-row class="mb-6">
        <v-col v-for="sim in simulators" :key="sim.name" cols="12" md="6">
          <v-card :class="{ 'opacity-50': !sim.installed }">
            <v-card-text>
              <div class="d-flex justify-space-between align-start">
                <div>
                  <div class="text-subtitle-1 font-weight-bold">{{ sim.name }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ sim.installed ? `${sim.profiles?.length || 0} profiles` : 'Not installed' }}
                  </div>
                </div>
                <v-chip :color="sim.installed ? 'success' : 'error'" size="small" variant="tonal">
                  {{ sim.installed ? 'Installed' : 'Not Found' }}
                </v-chip>
              </div>
              <v-btn
                v-if="sim.installed"
                class="mt-3"
                size="small"
                variant="outlined"
                prepend-icon="mdi-content-save"
                @click="handleBackup(sim.name)"
              >
                Backup
              </v-btn>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Backups -->
      <h2 class="text-h6 mb-4">Saved Backups</h2>
      <v-row v-if="backups.length > 0">
        <v-col v-for="backup in backups" :key="backup.name" cols="12" md="4">
          <v-card>
            <v-card-text>
              <div class="text-subtitle-1 font-weight-bold mb-1">{{ backup.name }}</div>
              <div class="text-caption text-medium-emphasis mb-3">
                {{ backup.simulator }} · {{ new Date(backup.timestamp).toLocaleDateString() }}
              </div>
              <div class="d-flex gap-2">
                <v-btn size="small" variant="outlined" @click="handleRestore(backup.name)">
                  Restore
                </v-btn>
                <v-btn
                  size="small"
                  variant="text"
                  color="error"
                  @click="handleDeleteBackup(backup.name)"
                >
                  Delete
                </v-btn>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
      <v-card v-else color="surface-variant">
        <v-card-text class="text-center py-6">
          <div class="text-body-1">
            No backups saved. Create a backup from an installed simulator above.
          </div>
        </v-card-text>
      </v-card>
    </div>

    <!-- DCS Bindings Tab -->
    <div v-else-if="activeTab === 'dcs'">
      <DCSBindingsPanel />
    </div>

    <!-- Duplicate Bindings Tab -->
    <div v-else-if="activeTab === 'duplicates'">
      <DuplicateBindings />
    </div>

    <!-- Per-Device View Tab -->
    <div v-else-if="activeTab === 'per-device'">
      <PerDeviceView />
    </div>

    <!-- Snapshots Tab -->
    <div v-else-if="activeTab === 'snapshots'">
      <SnapshotManager />
    </div>

    <!-- UUID Migration Tab -->
    <div v-else-if="activeTab === 'uuid-migration'">
      <DCSUuidMigration />
    </div>

    <!-- New Profile Dialog -->
    <v-dialog v-model="showNewProfileDialog" max-width="400">
      <v-card>
        <v-card-title>Create New Profile</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="newProfileName"
            label="Profile Name"
            placeholder="e.g., My Flight Setup"
            class="mb-4"
            autofocus
          />
          <v-textarea
            v-model="newProfileDescription"
            label="Description (optional)"
            placeholder="Describe this keybinding profile..."
            rows="3"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showNewProfileDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="createProfile">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Action Edit Dialog -->
    <v-dialog v-model="showActionDialog" max-width="500">
      <v-card>
        <v-card-title>{{ editingAction ? 'Edit Action' : 'Add Action' }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="actionForm.name"
            label="Action Name"
            placeholder="e.g., Weapon Release"
            class="mb-4"
            autofocus
          />
          <v-select
            v-model="actionForm.category"
            :items="
              Object.entries(DEFAULT_ACTION_CATEGORIES).map(([value, title]) => ({ title, value }))
            "
            item-title="title"
            item-value="value"
            label="Category"
            class="mb-4"
          />
          <v-text-field
            v-model="actionForm.description"
            label="Description (optional)"
            placeholder="Brief description of this action"
            class="mb-4"
          />
          <v-checkbox
            v-model="actionForm.isAxisAction"
            label="This is an axis action (not a button)"
            hide-details
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showActionDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="saveAction">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Input Capture Dialog -->
    <v-dialog v-model="showInputCaptureDialog" max-width="400" persistent>
      <v-card>
        <v-card-title>Capture Input</v-card-title>
        <v-card-text class="text-center py-8">
          <div v-if="!capturedInput">
            <v-progress-circular indeterminate color="primary" class="mb-4" />
            <div class="text-body-1">Press a button or move an axis...</div>
          </div>
          <div v-else>
            <v-icon size="48" color="success" class="mb-4">mdi-check-circle</v-icon>
            <div class="text-body-1 font-weight-medium mb-2">Input Detected:</div>
            <v-chip color="primary" size="large">
              {{ capturedInput.deviceName }} -
              {{
                capturedInput.inputType.charAt(0).toUpperCase() + capturedInput.inputType.slice(1)
              }}
              {{ capturedInput.inputIndex }}
            </v-chip>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cancelInputCapture">Cancel</v-btn>
          <v-btn v-if="capturedInput" color="primary" variant="flat" @click="confirmInputCapture">
            Confirm
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Confirm/Prompt Dialogs -->
    <PromptDialog
      v-model="showBackupPrompt"
      title="Create Backup"
      label="Backup Name"
      placeholder="Enter a name for this backup"
      @submit="confirmBackup"
    />
    <ConfirmDialog
      v-model="showRestoreConfirm"
      title="Restore Backup"
      :message="`Restore backup &quot;${pendingRestoreName}&quot;? This will overwrite current keybindings.`"
      confirm-text="Restore"
      confirm-color="primary"
      @confirm="confirmRestore"
    />
    <ConfirmDialog
      v-model="showDeleteBackupConfirm"
      title="Delete Backup"
      :message="`Delete backup &quot;${pendingDeleteBackupName}&quot;?`"
      @confirm="confirmDeleteBackup"
    />
    <ConfirmDialog
      v-model="showDeleteProfileConfirm"
      title="Delete Profile"
      message="Are you sure you want to delete this profile?"
      @confirm="confirmDeleteProfile"
    />
    <PromptDialog
      v-model="showImportPrompt"
      title="Import Profile"
      label="Profile Name"
      placeholder="Enter a name (leave blank to use original)"
      @submit="confirmImport"
    />
    <PromptDialog
      v-model="showDuplicatePrompt"
      title="Duplicate Profile"
      label="Profile Name"
      placeholder="Enter a name for the duplicate"
      @submit="confirmDuplicate"
    />
    <ConfirmDialog
      v-model="showDeleteActionConfirm"
      title="Delete Action"
      message="Delete this action?"
      @confirm="confirmDeleteAction"
    />
  </div>
</template>

<style scoped>
.v-table th {
  font-weight: 600 !important;
}
</style>
