<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import {
  useDCSBindings,
  type DCSDeviceBindings,
  type DCSGuidMapping,
} from '../../composables/useDCSBindings';
import { useToast } from '../../composables/useToast';
import ConfirmDialog from '../ConfirmDialog.vue';

const toast = useToast();
const dcs = useDCSBindings();

// UI State
const selectedDeviceIndex = ref(0);
const searchQuery = ref('');
const showCreateBackupDialog = ref(false);
const showRestoreConfirmDialog = ref(false);
const showGuidMappingDialog = ref(false);
const newBackupName = ref('');
const restoreTarget = ref<'all' | 'device'>('all');
const restoreDeviceGuid = ref<string | null>(null);
const showDeleteBackupConfirm = ref(false);
const pendingDeleteBackupPath = ref('');
const pendingDeleteBackupName = ref('');

// Computed
const selectedDevice = computed((): DCSDeviceBindings | null => {
  if (dcs.currentBindings.value.length === 0) return null;
  return dcs.currentBindings.value[selectedDeviceIndex.value] || null;
});

const filteredAxisBindings = computed(() => {
  if (!selectedDevice.value) return [];
  const query = searchQuery.value.toLowerCase();
  if (!query) return selectedDevice.value.axisBindings;
  return selectedDevice.value.axisBindings.filter(
    (b) => b.name.toLowerCase().includes(query) || b.key.toLowerCase().includes(query)
  );
});

const filteredKeyBindings = computed(() => {
  if (!selectedDevice.value) return [];
  const query = searchQuery.value.toLowerCase();
  if (!query) return selectedDevice.value.keyBindings;
  return selectedDevice.value.keyBindings.filter(
    (b) => b.name.toLowerCase().includes(query) || b.key.toLowerCase().includes(query)
  );
});

const totalBindings = computed(() => {
  if (!selectedDevice.value) return 0;
  return selectedDevice.value.axisBindings.length + selectedDevice.value.keyBindings.length;
});

const canRestore = computed(() => {
  return (
    dcs.hasBackupSelected.value && dcs.mappedDevices.value.length > 0 && dcs.selectedModuleId.value
  );
});

// Methods
async function handleModuleSelect(moduleId: string) {
  selectedDeviceIndex.value = 0;
  await dcs.loadModuleBindings(moduleId);
}

async function handleBackupSelect(backupPath: string) {
  if (!dcs.selectedModuleId.value) {
    toast.error('Please select a module first');
    return;
  }
  await dcs.loadBackupBindings(backupPath, dcs.selectedModuleId.value);
}

async function handleCreateBackup() {
  if (!newBackupName.value.trim()) {
    toast.error('Please enter a backup name');
    return;
  }

  const result = await dcs.createBackup(newBackupName.value.trim());
  if (result) {
    toast.success('Backup created successfully');
    showCreateBackupDialog.value = false;
    newBackupName.value = '';
  } else {
    toast.error('Failed to create backup');
  }
}

function handleDeleteBackup(backupPath: string, backupName: string) {
  pendingDeleteBackupPath.value = backupPath;
  pendingDeleteBackupName.value = backupName;
  showDeleteBackupConfirm.value = true;
}

async function confirmDeleteBackup() {
  const result = await dcs.deleteBackup(pendingDeleteBackupPath.value);
  if (result) {
    toast.success('Backup deleted');
  } else {
    toast.error('Failed to delete backup');
  }
}

function openRestoreDialog(target: 'all' | 'device', deviceGuid?: string) {
  restoreTarget.value = target;
  restoreDeviceGuid.value = deviceGuid || null;

  // Check if there are unmapped devices
  if (dcs.unmappedDevices.value.length > 0) {
    showGuidMappingDialog.value = true;
  } else {
    showRestoreConfirmDialog.value = true;
  }
}

async function handleRestore() {
  showRestoreConfirmDialog.value = false;

  let result;
  if (restoreTarget.value === 'device' && restoreDeviceGuid.value) {
    result = await dcs.restoreDeviceBindings(restoreDeviceGuid.value);
  } else {
    result = await dcs.restoreAllBindings();
  }

  if (result.success) {
    toast.success(result.message);
  } else {
    toast.error(result.message);
  }
}

function handleGuidMappingUpdate(mapping: DCSGuidMapping, newGuid: string) {
  dcs.updateGuidMapping(mapping.backupGuid, newGuid);
}

function proceedWithRestore() {
  showGuidMappingDialog.value = false;
  showRestoreConfirmDialog.value = true;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Watch for module changes to refresh backup bindings if needed
watch(
  () => dcs.selectedModuleId.value,
  async (newModuleId) => {
    if (newModuleId && dcs.selectedBackupPath.value) {
      await dcs.loadBackupBindings(dcs.selectedBackupPath.value, newModuleId);
    }
  }
);

// Initialize
onMounted(async () => {
  await dcs.scanModules();
  await dcs.loadAvailableBackups();
});
</script>

<template>
  <div class="dcs-bindings-panel">
    <!-- Header Controls -->
    <div class="d-flex align-center gap-4 mb-6">
      <!-- Module Selector -->
      <v-select
        v-model="dcs.selectedModuleId.value"
        :items="dcs.modules.value"
        item-title="name"
        item-value="id"
        label="Select Module"
        density="compact"
        hide-details
        style="max-width: 300px"
        @update:model-value="handleModuleSelect"
      >
        <template #item="{ item, props }">
          <v-list-item v-bind="props">
            <template #subtitle> {{ item.raw.deviceCount }} device(s) </template>
          </v-list-item>
        </template>
      </v-select>

      <!-- Backup Selector -->
      <v-select
        v-model="dcs.selectedBackupPath.value"
        :items="dcs.availableBackups.value"
        item-title="name"
        item-value="path"
        label="Compare with Backup"
        density="compact"
        hide-details
        clearable
        style="max-width: 300px"
        :disabled="!dcs.selectedModuleId.value"
        @update:model-value="(v) => v && handleBackupSelect(v)"
      >
        <template #item="{ item, props }">
          <v-list-item v-bind="props">
            <template #subtitle>
              {{ formatDate(item.raw.timestamp) }}
            </template>
          </v-list-item>
        </template>
      </v-select>

      <v-spacer />

      <!-- Actions -->
      <v-btn
        size="small"
        variant="outlined"
        prepend-icon="mdi-content-save"
        @click="showCreateBackupDialog = true"
      >
        Create Backup
      </v-btn>

      <v-btn
        v-if="canRestore"
        size="small"
        color="primary"
        prepend-icon="mdi-restore"
        @click="openRestoreDialog('all')"
      >
        Restore All
      </v-btn>
    </div>

    <!-- Loading State -->
    <v-progress-linear v-if="dcs.loading.value" indeterminate class="mb-4" />

    <!-- Error State -->
    <v-alert
      v-if="dcs.error.value"
      type="error"
      class="mb-4"
      closable
      @click:close="dcs.error.value = null"
    >
      {{ dcs.error.value }}
    </v-alert>

    <!-- No DCS Found State -->
    <v-card v-if="!dcs.savedGamesPath.value && !dcs.loading.value" color="surface-variant">
      <v-card-text class="text-center py-10">
        <v-icon size="64" class="mb-4 text-medium-emphasis">mdi-airplane-off</v-icon>
        <div class="text-h6 mb-2">DCS World Not Found</div>
        <div class="text-body-2 text-medium-emphasis mb-4">
          Could not detect DCS World Saved Games folder.
        </div>
        <v-text-field
          label="Custom DCS Saved Games Path"
          placeholder="C:\Users\...\Saved Games\DCS"
          density="compact"
          hide-details
          class="mb-4"
          style="max-width: 500px; margin: 0 auto"
        />
      </v-card-text>
    </v-card>

    <!-- No Module Selected State -->
    <v-card v-else-if="!dcs.selectedModuleId.value && !dcs.loading.value" color="surface-variant">
      <v-card-text class="text-center py-10">
        <v-icon size="64" class="mb-4 text-medium-emphasis">mdi-airplane</v-icon>
        <div class="text-h6 mb-2">Select a Module</div>
        <div class="text-body-2 text-medium-emphasis">
          Choose a DCS module from the dropdown above to view its keybindings.
        </div>
        <div class="text-caption text-medium-emphasis mt-4">
          Found {{ dcs.modules.value.length }} modules in {{ dcs.savedGamesPath.value }}
        </div>
      </v-card-text>
    </v-card>

    <!-- Module Bindings View -->
    <template v-else-if="dcs.currentBindings.value.length > 0">
      <!-- Device Tabs -->
      <v-tabs v-model="selectedDeviceIndex" class="mb-4" show-arrows>
        <v-tab
          v-for="(device, index) in dcs.currentBindings.value"
          :key="device.deviceGuid"
          :value="index"
        >
          <span class="text-truncate" style="max-width: 200px">{{ device.deviceName }}</span>
          <v-chip size="x-small" class="ml-2" variant="tonal">
            {{ device.axisBindings.length + device.keyBindings.length }}
          </v-chip>
        </v-tab>
      </v-tabs>

      <!-- Search and Actions -->
      <div class="d-flex align-center gap-4 mb-4" v-if="selectedDevice">
        <v-text-field
          v-model="searchQuery"
          prepend-inner-icon="mdi-magnify"
          label="Search bindings..."
          density="compact"
          hide-details
          clearable
          style="max-width: 300px"
        />

        <v-chip variant="tonal"> {{ totalBindings }} bindings </v-chip>

        <v-spacer />

        <v-btn
          v-if="canRestore"
          size="small"
          variant="outlined"
          prepend-icon="mdi-restore"
          @click="openRestoreDialog('device', selectedDevice?.deviceGuid)"
        >
          Restore This Device
        </v-btn>
      </div>

      <!-- Bindings Table -->
      <v-card v-if="selectedDevice">
        <v-card-text class="pa-0">
          <!-- Axes Section -->
          <div v-if="filteredAxisBindings.length > 0">
            <div class="pa-3 bg-surface-variant">
              <v-icon size="small" class="mr-2">mdi-axis-arrow</v-icon>
              <span class="font-weight-medium">Axes ({{ filteredAxisBindings.length }})</span>
            </div>
            <v-table density="compact">
              <thead>
                <tr>
                  <th style="width: 40%">Action</th>
                  <th style="width: 30%">Input</th>
                  <th style="width: 30%">Settings</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="binding in filteredAxisBindings"
                  :key="`axis-${binding.id}`"
                  :class="{ 'text-error': binding.isRemoved }"
                >
                  <td>
                    <div class="font-weight-medium">{{ binding.name }}</div>
                    <div class="text-caption text-medium-emphasis">{{ binding.id }}</div>
                  </td>
                  <td>
                    <v-chip size="small" variant="outlined">{{ binding.key }}</v-chip>
                    <v-chip v-if="binding.isRemoved" size="x-small" color="error" class="ml-1">
                      Removed
                    </v-chip>
                  </td>
                  <td>
                    <template v-if="binding.filter">
                      <v-chip v-if="binding.filter.curvature" size="x-small" class="mr-1">
                        Curve: {{ binding.filter.curvature.join(', ') }}
                      </v-chip>
                      <v-chip v-if="binding.filter.deadzone" size="x-small" class="mr-1">
                        DZ: {{ binding.filter.deadzone }}
                      </v-chip>
                      <v-chip v-if="binding.filter.invert" size="x-small" color="warning">
                        Inverted
                      </v-chip>
                    </template>
                    <span v-else class="text-medium-emphasis">Default</span>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <!-- Buttons Section -->
          <div v-if="filteredKeyBindings.length > 0">
            <div class="pa-3 bg-surface-variant">
              <v-icon size="small" class="mr-2">mdi-gesture-tap-button</v-icon>
              <span class="font-weight-medium">Buttons ({{ filteredKeyBindings.length }})</span>
            </div>
            <v-table density="compact">
              <thead>
                <tr>
                  <th style="width: 50%">Action</th>
                  <th style="width: 30%">Input</th>
                  <th style="width: 20%">Modifiers</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="binding in filteredKeyBindings"
                  :key="`key-${binding.id}`"
                  :class="{ 'text-error': binding.isRemoved }"
                >
                  <td>
                    <div class="font-weight-medium">{{ binding.name }}</div>
                    <div class="text-caption text-medium-emphasis">{{ binding.id }}</div>
                  </td>
                  <td>
                    <v-chip size="small" variant="outlined">{{ binding.key }}</v-chip>
                    <v-chip v-if="binding.isRemoved" size="x-small" color="error" class="ml-1">
                      Removed
                    </v-chip>
                  </td>
                  <td>
                    <template v-if="binding.reformers && binding.reformers.length > 0">
                      <v-chip
                        v-for="reformer in binding.reformers"
                        :key="reformer"
                        size="x-small"
                        class="mr-1"
                      >
                        {{ reformer }}
                      </v-chip>
                    </template>
                    <span v-else class="text-medium-emphasis">None</span>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <!-- Empty State -->
          <div
            v-if="filteredAxisBindings.length === 0 && filteredKeyBindings.length === 0"
            class="text-center py-8 text-medium-emphasis"
          >
            <v-icon size="48" class="mb-4">mdi-keyboard-off-outline</v-icon>
            <div v-if="searchQuery">No bindings match "{{ searchQuery }}"</div>
            <div v-else>No bindings configured for this device</div>
          </div>
        </v-card-text>
      </v-card>
    </template>

    <!-- No Bindings State -->
    <v-card v-else-if="dcs.selectedModuleId.value && !dcs.loading.value" color="surface-variant">
      <v-card-text class="text-center py-10">
        <v-icon size="64" class="mb-4 text-medium-emphasis">mdi-keyboard-off-outline</v-icon>
        <div class="text-h6 mb-2">No Device Bindings Found</div>
        <div class="text-body-2 text-medium-emphasis">
          This module has no joystick bindings configured yet.
        </div>
      </v-card-text>
    </v-card>

    <!-- Backup List Section -->
    <div v-if="dcs.availableBackups.value.length > 0" class="mt-6">
      <h3 class="text-subtitle-1 font-weight-medium mb-3">Available Backups</h3>
      <v-row>
        <v-col v-for="backup in dcs.availableBackups.value" :key="backup.path" cols="12" md="4">
          <v-card
            :class="{ 'border-primary': dcs.selectedBackupPath.value === backup.path }"
            @click="handleBackupSelect(backup.path)"
            style="cursor: pointer"
          >
            <v-card-text>
              <div class="d-flex justify-space-between align-start">
                <div>
                  <div class="font-weight-medium">{{ backup.name }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ formatDate(backup.timestamp) }}
                  </div>
                </div>
                <v-btn
                  icon
                  variant="text"
                  size="small"
                  color="error"
                  @click.stop="handleDeleteBackup(backup.path, backup.name)"
                >
                  <v-icon>mdi-delete</v-icon>
                </v-btn>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <!-- Create Backup Dialog -->
    <v-dialog v-model="showCreateBackupDialog" max-width="400">
      <v-card>
        <v-card-title>Create DCS Backup</v-card-title>
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-4">
            This will create a backup of all your current DCS input configurations.
          </p>
          <v-text-field
            v-model="newBackupName"
            label="Backup Name"
            placeholder="e.g., Before VR Setup"
            autofocus
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showCreateBackupDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="handleCreateBackup">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- GUID Mapping Dialog -->
    <v-dialog v-model="showGuidMappingDialog" max-width="600">
      <v-card>
        <v-card-title>Device Mapping Required</v-card-title>
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-4">
            Some devices in the backup don't match your current devices. Please map them manually or
            they will be skipped during restore.
          </p>

          <v-list density="compact">
            <v-list-item v-for="mapping in dcs.unmappedDevices.value" :key="mapping.backupGuid">
              <template #prepend>
                <v-icon color="warning">mdi-link-off</v-icon>
              </template>
              <v-list-item-title>{{ mapping.deviceName }}</v-list-item-title>
              <v-list-item-subtitle>{{ mapping.backupGuid }}</v-list-item-subtitle>
              <template #append>
                <v-select
                  :model-value="mapping.currentGuid"
                  :items="[
                    { title: '-- Skip this device --', value: '' },
                    ...dcs.currentBindings.value.map((d) => ({
                      title: d.deviceName,
                      value: d.deviceGuid,
                    })),
                  ]"
                  item-title="title"
                  item-value="value"
                  density="compact"
                  hide-details
                  style="width: 200px"
                  @update:model-value="(v) => handleGuidMappingUpdate(mapping, v)"
                />
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showGuidMappingDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="proceedWithRestore"> Continue </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ConfirmDialog
      v-model="showDeleteBackupConfirm"
      title="Delete Backup"
      :message="`Delete backup &quot;${pendingDeleteBackupName}&quot;?`"
      @confirm="confirmDeleteBackup"
    />

    <!-- Restore Confirmation Dialog -->
    <v-dialog v-model="showRestoreConfirmDialog" max-width="400">
      <v-card>
        <v-card-title>Confirm Restore</v-card-title>
        <v-card-text>
          <v-alert type="warning" variant="tonal" class="mb-4">
            This will overwrite your current DCS bindings for the selected
            {{ restoreTarget === 'all' ? 'devices' : 'device' }}.
          </v-alert>
          <p class="text-body-2">
            A backup of your current settings will be created automatically before restoring.
          </p>
          <div class="mt-4">
            <div class="font-weight-medium mb-2">Devices to restore:</div>
            <v-chip
              v-for="mapping in dcs.mappedDevices.value"
              :key="mapping.backupGuid"
              size="small"
              class="mr-1 mb-1"
            >
              {{ mapping.deviceName }}
            </v-chip>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showRestoreConfirmDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="handleRestore"> Restore </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.border-primary {
  border: 2px solid rgb(var(--v-theme-primary)) !important;
}

.v-table th {
  font-weight: 600 !important;
}
</style>
