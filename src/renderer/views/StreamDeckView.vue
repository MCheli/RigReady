<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useStreamDeck } from '../composables/useStreamDeck';
import { useToast } from '../composables/useToast';
import PageHeader from '../components/PageHeader.vue';
import StreamDeckSetupGuide from '../components/streamdeck/StreamDeckSetupGuide.vue';

const {
  loading,
  profiles,
  backups,
  isInstalled,
  profilesPath,
  profileCount,
  backupCount,
  refresh,
  createBackup,
  restoreBackup,
  deleteBackup,
  openSoftware,
  openDownloadPage,
  openProfilesFolder,
} = useStreamDeck();

const { show: showToast } = useToast();

// Dialog state
const showCreateBackupDialog = ref(false);
const showRestoreDialog = ref(false);
const showDeleteDialog = ref(false);
const backupName = ref('');
const selectedBackup = ref<{ name: string; path: string } | null>(null);

// Format file size
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Format timestamp
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Format device model for display
function formatDeviceModel(model: string): string {
  const modelMap: Record<string, string> = {
    'com.elgato.StreamDeck.xl': 'Stream Deck XL',
    'com.elgato.StreamDeck.mini': 'Stream Deck Mini',
    'com.elgato.StreamDeck.mk2': 'Stream Deck MK.2',
    'com.elgato.StreamDeck.mobile': 'Stream Deck Mobile',
    'com.elgato.StreamDeck.pedal': 'Stream Deck Pedal',
    'com.elgato.StreamDeck.plus': 'Stream Deck +',
  };
  return modelMap[model] || model;
}

// Computed for status display
const statusColor = computed(() => {
  if (!isInstalled.value) return 'warning';
  if (profileCount.value === 0) return 'info';
  return 'success';
});

const statusText = computed(() => {
  if (!isInstalled.value) return 'Not Installed';
  if (profileCount.value === 0) return 'No Profiles';
  return 'Ready';
});

// Actions
async function handleCreateBackup() {
  if (!backupName.value.trim()) {
    showToast('Please enter a backup name', 'warning');
    return;
  }

  const result = await createBackup(backupName.value.trim());
  if (result.success) {
    showToast('Backup created successfully', 'success');
    showCreateBackupDialog.value = false;
    backupName.value = '';
  } else {
    showToast(result.error || 'Failed to create backup', 'error');
  }
}

async function handleRestoreBackup() {
  if (!selectedBackup.value) return;

  const result = await restoreBackup(selectedBackup.value.path);
  if (result.success) {
    showToast(result.message, 'success');
    showRestoreDialog.value = false;
    selectedBackup.value = null;
  } else {
    showToast(result.error || 'Failed to restore backup', 'error');
  }
}

async function handleDeleteBackup() {
  if (!selectedBackup.value) return;

  const result = await deleteBackup(selectedBackup.value.path);
  if (result) {
    showToast('Backup deleted', 'success');
    showDeleteDialog.value = false;
    selectedBackup.value = null;
  } else {
    showToast('Failed to delete backup', 'error');
  }
}

function openRestoreDialogForBackup(backup: { name: string; path: string }) {
  selectedBackup.value = backup;
  showRestoreDialog.value = true;
}

function openDeleteDialogForBackup(backup: { name: string; path: string }) {
  selectedBackup.value = backup;
  showDeleteDialog.value = true;
}

async function handleOpenSoftware() {
  const result = await openSoftware();
  if (!result) {
    showToast('Failed to open Stream Deck software', 'warning');
  }
}

async function handleOpenProfilesFolder() {
  const result = await openProfilesFolder();
  if (!result) {
    showToast('Could not open profiles folder', 'warning');
  }
}

function handleSetupRestoreBackup() {
  if (backups.value.length > 0) {
    showRestoreDialog.value = true;
  } else {
    showToast('No backups available to restore', 'info');
  }
}

onMounted(() => {
  refresh();
});
</script>

<template>
  <div class="streamdeck-view">
    <PageHeader title="Stream Deck Manager">
      <template #actions>
        <v-btn
          prepend-icon="mdi-plus"
          :disabled="!isInstalled || profileCount === 0"
          @click="showCreateBackupDialog = true"
        >
          Create Backup
        </v-btn>
        <v-btn variant="outlined" prepend-icon="mdi-refresh" :loading="loading" @click="refresh">
          Refresh
        </v-btn>
      </template>
    </PageHeader>

    <!-- Status Summary -->
    <v-row class="mb-6">
      <v-col cols="12" md="4">
        <v-card color="surface-variant">
          <v-card-text class="text-center">
            <v-icon :color="statusColor" size="32" class="mb-2">
              {{ isInstalled ? 'mdi-check-circle' : 'mdi-alert-circle' }}
            </v-icon>
            <div class="text-h5 font-weight-bold" :class="`text-${statusColor}`">
              {{ statusText }}
            </div>
            <div class="text-caption text-medium-emphasis">Installation Status</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card color="surface-variant">
          <v-card-text class="text-center">
            <div class="text-h3 font-weight-bold">{{ profileCount }}</div>
            <div class="text-caption text-medium-emphasis">Profiles</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card color="surface-variant">
          <v-card-text class="text-center">
            <div class="text-h3 font-weight-bold">{{ backupCount }}</div>
            <div class="text-caption text-medium-emphasis">Backups</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Setup Guide (collapsed by default if installed) -->
    <StreamDeckSetupGuide
      :is-installed="isInstalled"
      :profiles-path="profilesPath"
      @open-download="openDownloadPage"
      @open-software="handleOpenSoftware"
      @restore-backup="handleSetupRestoreBackup"
    />

    <!-- Current Profiles -->
    <v-card class="mb-6">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-grid</v-icon>
        Current Profiles
        <v-spacer />
        <v-btn
          variant="text"
          size="small"
          prepend-icon="mdi-folder-open"
          :disabled="!profilesPath"
          @click="handleOpenProfilesFolder"
        >
          Open Folder
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text v-if="profiles.length > 0">
        <v-row>
          <v-col v-for="profile in profiles" :key="profile.id" cols="12" sm="6" md="4">
            <v-card variant="outlined">
              <v-card-text>
                <div class="d-flex align-start">
                  <v-icon class="mr-3 mt-1" color="primary">mdi-view-grid</v-icon>
                  <div class="flex-grow-1">
                    <div class="text-subtitle-1 font-weight-medium">{{ profile.name }}</div>
                    <div class="text-caption text-medium-emphasis">
                      {{ formatDeviceModel(profile.deviceModel) }}
                    </div>
                    <div class="text-caption text-medium-emphasis">
                      Modified: {{ formatDate(profile.modifiedTime) }}
                    </div>
                  </div>
                </div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-text v-else class="text-center py-8">
        <v-icon size="48" color="grey" class="mb-2">mdi-grid-off</v-icon>
        <div class="text-body-1 text-medium-emphasis">
          {{ isInstalled ? 'No profiles found' : 'Install Stream Deck software to see profiles' }}
        </div>
      </v-card-text>
    </v-card>

    <!-- Backup Management -->
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-backup-restore</v-icon>
        Backup Management
      </v-card-title>
      <v-divider />
      <v-card-text v-if="backups.length > 0">
        <v-table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Date</th>
              <th>Size</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="backup in backups" :key="backup.path">
              <td>
                <div class="d-flex align-center">
                  <v-icon class="mr-2" size="small">mdi-package-variant</v-icon>
                  {{ backup.name }}
                </div>
              </td>
              <td class="text-medium-emphasis">{{ formatDate(backup.timestamp) }}</td>
              <td class="text-medium-emphasis">{{ formatSize(backup.size) }}</td>
              <td class="text-right">
                <v-btn
                  variant="text"
                  size="small"
                  color="primary"
                  icon="mdi-restore"
                  title="Restore"
                  @click="openRestoreDialogForBackup(backup)"
                />
                <v-btn
                  variant="text"
                  size="small"
                  color="error"
                  icon="mdi-delete"
                  title="Delete"
                  @click="openDeleteDialogForBackup(backup)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-text v-else class="text-center py-8">
        <v-icon size="48" color="grey" class="mb-2">mdi-package-variant</v-icon>
        <div class="text-body-1 text-medium-emphasis mb-4">No backups yet</div>
        <v-btn
          variant="tonal"
          prepend-icon="mdi-plus"
          :disabled="!isInstalled || profileCount === 0"
          @click="showCreateBackupDialog = true"
        >
          Create Your First Backup
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- Quick Actions -->
    <v-card class="mt-6">
      <v-card-title>
        <v-icon class="mr-2">mdi-lightning-bolt</v-icon>
        Quick Actions
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-row>
          <v-col cols="12" sm="6" md="3">
            <v-btn
              variant="outlined"
              block
              prepend-icon="mdi-open-in-new"
              :disabled="!isInstalled"
              @click="handleOpenSoftware"
            >
              Open Stream Deck
            </v-btn>
          </v-col>
          <v-col cols="12" sm="6" md="3">
            <v-btn
              variant="outlined"
              block
              prepend-icon="mdi-folder-open"
              :disabled="!profilesPath"
              @click="handleOpenProfilesFolder"
            >
              Open Profiles Folder
            </v-btn>
          </v-col>
          <v-col cols="12" sm="6" md="3">
            <v-btn variant="outlined" block prepend-icon="mdi-download" @click="openDownloadPage">
              Download Software
            </v-btn>
          </v-col>
          <v-col cols="12" sm="6" md="3">
            <v-btn
              variant="outlined"
              block
              prepend-icon="mdi-backup-restore"
              :disabled="backups.length === 0"
              @click="showRestoreDialog = true"
            >
              Restore Backup
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Create Backup Dialog -->
    <v-dialog v-model="showCreateBackupDialog" max-width="450">
      <v-card>
        <v-card-title>Create Backup</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="backupName"
            label="Backup Name"
            placeholder="e.g., My DCS Setup"
            hint="A descriptive name for this backup"
            persistent-hint
            autofocus
            @keyup.enter="handleCreateBackup"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showCreateBackupDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            :loading="loading"
            :disabled="!backupName.trim()"
            @click="handleCreateBackup"
          >
            Create Backup
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Restore Backup Dialog -->
    <v-dialog v-model="showRestoreDialog" max-width="500">
      <v-card>
        <v-card-title>Restore Backup</v-card-title>
        <v-card-text>
          <v-alert type="warning" variant="tonal" class="mb-4">
            <template #text>
              This will replace your current Stream Deck profiles. A backup of your current profiles
              will be created automatically before restoring.
            </template>
          </v-alert>

          <v-select
            v-if="!selectedBackup"
            v-model="selectedBackup"
            :items="backups"
            item-title="name"
            item-value="path"
            label="Select Backup"
            return-object
          >
            <template #item="{ item, props }">
              <v-list-item v-bind="props">
                <template #subtitle>
                  {{ formatDate(item.raw.timestamp) }} - {{ formatSize(item.raw.size) }}
                </template>
              </v-list-item>
            </template>
          </v-select>

          <div v-else class="text-body-1">
            Restore backup: <strong>{{ selectedBackup.name }}</strong>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="
              showRestoreDialog = false;
              selectedBackup = null;
            "
          >
            Cancel
          </v-btn>
          <v-btn
            color="warning"
            :loading="loading"
            :disabled="!selectedBackup"
            @click="handleRestoreBackup"
          >
            Restore
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Backup Dialog -->
    <v-dialog v-model="showDeleteDialog" max-width="400">
      <v-card>
        <v-card-title>Delete Backup</v-card-title>
        <v-card-text>
          Are you sure you want to delete the backup
          <strong>{{ selectedBackup?.name }}</strong
          >? This action cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="
              showDeleteDialog = false;
              selectedBackup = null;
            "
          >
            Cancel
          </v-btn>
          <v-btn color="error" :loading="loading" @click="handleDeleteBackup"> Delete </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.streamdeck-view {
  max-width: 1200px;
}
</style>
