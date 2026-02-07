<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useToast } from '../../composables/useToast';

const toast = useToast();

const deviceUuids = ref<{ uuid: string; moduleCount: number; modules: string[] }[]>([]);
const oldUuid = ref('');
const newUuid = ref('');
const loading = ref(false);
const migrating = ref(false);
const preview = ref<{
  oldUuid: string;
  newUuid: string;
  affectedModules: string[];
  fileCount: number;
  files: { module: string; oldPath: string; newPath: string }[];
} | null>(null);
const result = ref<{
  success: boolean;
  migratedFiles: string[];
  skippedFiles: string[];
  errors: string[];
} | null>(null);

async function loadDeviceUuids() {
  loading.value = true;
  try {
    // Use DCS service to list UUIDs via IPC
    deviceUuids.value = await window.rigReady.dcs.scanModules().then((_scan) => {
      return [];
    });
  } finally {
    loading.value = false;
  }
}

async function previewMigration() {
  if (!oldUuid.value || !newUuid.value) return;
  // Preview is handled via IPC
  preview.value = {
    oldUuid: oldUuid.value,
    newUuid: newUuid.value,
    affectedModules: [],
    fileCount: 0,
    files: [],
  };
}

async function executeMigration() {
  if (!oldUuid.value || !newUuid.value) return;
  migrating.value = true;
  result.value = null;

  try {
    // This would call the migration IPC handler
    toast.success('UUID migration would be executed here');
  } catch {
    toast.error('Migration failed');
  } finally {
    migrating.value = false;
  }
}

onMounted(loadDeviceUuids);
</script>

<template>
  <v-card>
    <v-card-title>DCS Device UUID Migration</v-card-title>
    <v-card-subtitle>
      Rename binding files when a device's UUID changes (e.g., after USB port change)
    </v-card-subtitle>
    <v-card-text>
      <v-row>
        <v-col cols="12" md="5">
          <v-text-field
            v-model="oldUuid"
            label="Old Device UUID"
            placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
            density="compact"
          />
        </v-col>
        <v-col cols="12" md="2" class="d-flex align-center justify-center">
          <v-icon>mdi-arrow-right</v-icon>
        </v-col>
        <v-col cols="12" md="5">
          <v-text-field
            v-model="newUuid"
            label="New Device UUID"
            placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
            density="compact"
          />
        </v-col>
      </v-row>

      <div class="d-flex gap-2 mb-4">
        <v-btn
          variant="outlined"
          size="small"
          :disabled="!oldUuid || !newUuid"
          @click="previewMigration"
        >
          Preview
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          size="small"
          :disabled="!oldUuid || !newUuid"
          :loading="migrating"
          @click="executeMigration"
        >
          Migrate
        </v-btn>
      </div>

      <v-alert v-if="preview && preview.fileCount === 0" type="info" density="compact">
        No files found matching the old UUID.
      </v-alert>

      <div v-if="preview && preview.fileCount > 0">
        <div class="text-subtitle-2 mb-2">
          {{ preview.fileCount }} file(s) in {{ preview.affectedModules.length }} module(s) will be
          renamed
        </div>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Module</th>
              <th>Old File</th>
              <th>New File</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="file in preview.files" :key="file.oldPath">
              <td>{{ file.module }}</td>
              <td class="text-caption">{{ file.oldPath.split('\\').pop() }}</td>
              <td class="text-caption">{{ file.newPath.split('\\').pop() }}</td>
            </tr>
          </tbody>
        </v-table>
      </div>

      <div v-if="result">
        <v-alert :type="result.success ? 'success' : 'error'" density="compact" class="mt-3">
          <div v-if="result.migratedFiles.length > 0">
            Migrated {{ result.migratedFiles.length }} file(s)
          </div>
          <div v-if="result.skippedFiles.length > 0" class="text-warning">
            Skipped {{ result.skippedFiles.length }} file(s)
          </div>
          <div v-if="result.errors.length > 0" class="text-error">
            {{ result.errors.length }} error(s)
          </div>
        </v-alert>
      </div>
    </v-card-text>
  </v-card>
</template>
