<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useToast } from '../../composables/useToast';

const toast = useToast();

const backups = ref<{ name: string; path: string; timestamp: number }[]>([]);
const loading = ref(false);
const newBackupName = ref('');
const showNewBackupDialog = ref(false);

async function loadBackups() {
  loading.value = true;
  try {
    backups.value = await window.rigReady.dcs.getAvailableBackups();
  } finally {
    loading.value = false;
  }
}

async function createBackup() {
  if (!newBackupName.value.trim()) return;

  const result = await window.rigReady.dcs.createBackup(newBackupName.value.trim());
  if (result) {
    toast.success('Backup created successfully');
    showNewBackupDialog.value = false;
    newBackupName.value = '';
    await loadBackups();
  } else {
    toast.error('Failed to create backup');
  }
}

async function deleteBackup(backupPath: string, name: string) {
  if (!confirm(`Delete backup "${name}"?`)) return;

  const success = await window.rigReady.dcs.deleteBackup(backupPath);
  if (success) {
    toast.success('Backup deleted');
    await loadBackups();
  } else {
    toast.error('Failed to delete backup');
  }
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

onMounted(loadBackups);
</script>

<template>
  <v-card>
    <v-card-title class="d-flex justify-space-between align-center">
      DCS Binding Snapshots
      <v-btn size="small" color="primary" @click="showNewBackupDialog = true">
        <v-icon start>mdi-plus</v-icon>
        New Snapshot
      </v-btn>
    </v-card-title>
    <v-card-subtitle>
      Create and manage snapshots of your DCS keybinding configurations
    </v-card-subtitle>
    <v-card-text>
      <v-progress-linear v-if="loading" indeterminate class="mb-4" />

      <v-list v-if="backups.length > 0" density="compact">
        <v-list-item v-for="backup in backups" :key="backup.path">
          <v-list-item-title>{{ backup.name }}</v-list-item-title>
          <v-list-item-subtitle>{{ formatDate(backup.timestamp) }}</v-list-item-subtitle>
          <template #append>
            <v-btn
              icon
              variant="text"
              size="small"
              color="error"
              @click="deleteBackup(backup.path, backup.name)"
            >
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </template>
        </v-list-item>
      </v-list>

      <div v-else-if="!loading" class="text-center py-4 text-medium-emphasis">
        No snapshots yet. Create one to save your current DCS bindings.
      </div>
    </v-card-text>
  </v-card>

  <v-dialog v-model="showNewBackupDialog" max-width="400">
    <v-card>
      <v-card-title>Create Snapshot</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="newBackupName"
          label="Snapshot Name"
          placeholder="e.g., Before-F16-Remap"
          autofocus
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="showNewBackupDialog = false">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="createBackup">Create</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
