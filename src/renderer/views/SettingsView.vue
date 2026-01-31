<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import {
  useSettings,
  useDevices,
  type Simulator,
  type SimulatorPath,
} from '../composables/useRigReady';
import { useToast } from '../composables/useToast';
import { SIMULATORS, SIMULATOR_DISPLAY_NAMES } from '../../shared/types';
import PageHeader from '../components/PageHeader.vue';

const settingsComposable = useSettings();
const { devices, loadDevices } = useDevices();
const toast = useToast();

// Local state
const showPathDialog = ref(false);
const editingSimulator = ref<Simulator | null>(null);
const pathForm = ref({
  installPath: '',
  configPath: '',
});

// Update settings state
const checkForUpdates = ref(true);
const checkingUpdates = ref(false);
const updateMessage = ref('');
const updateMessageClass = ref('');

// Computed
const availableSimulators = computed(() => {
  return SIMULATORS.map((sim) => ({
    value: sim,
    title: SIMULATOR_DISPLAY_NAMES[sim],
    configured: settingsComposable.simulatorPaths.value.some((p) => p.simulator === sim),
  }));
});

const expectedDeviceCount = computed(() => devices.value.length);

// Methods
async function clearExpectedDevices() {
  if (confirm('Clear all expected devices? This will reset the device tracking.')) {
    // Clear by saving an empty expected list
    // Note: This functionality would need to be implemented in the device service
    toast.info('This feature will be available in a future update.');
  }
}

function openEditPath(simulator: Simulator) {
  editingSimulator.value = simulator;
  const existing = settingsComposable.simulatorPaths.value.find((p) => p.simulator === simulator);
  pathForm.value = {
    installPath: existing?.installPath || '',
    configPath: existing?.configPath || '',
  };
  showPathDialog.value = true;
}

async function savePath() {
  if (!editingSimulator.value) return;

  const simulatorPath: SimulatorPath = {
    simulator: editingSimulator.value,
    installPath: pathForm.value.installPath || undefined,
    configPath: pathForm.value.configPath || undefined,
    isAutoDetected: false,
    lastVerified: Date.now(),
  };

  await settingsComposable.setSimulatorPath(simulatorPath);
  showPathDialog.value = false;
}

async function removePath(simulator: Simulator) {
  if (confirm(`Remove ${SIMULATOR_DISPLAY_NAMES[simulator]} configuration?`)) {
    await settingsComposable.removeSimulatorPath(simulator);
  }
}

async function autoScan(simulator: Simulator) {
  const result = await settingsComposable.autoScanSimulator(simulator);
  if (result) {
    toast.success(`Found ${SIMULATOR_DISPLAY_NAMES[simulator]} installation!`);
  } else {
    toast.warning(`Could not find ${SIMULATOR_DISPLAY_NAMES[simulator]} installation.`);
  }
}

async function scanAll() {
  const results = await settingsComposable.autoScanAllSimulators();
  if (results.length > 0) {
    const names = results.map((r) => SIMULATOR_DISPLAY_NAMES[r.simulator]).join(', ');
    toast.success(`Found: ${names}`);
  } else {
    toast.info('No simulators were automatically detected.');
  }
}

async function verifyPath(simulator: Simulator) {
  const valid = await settingsComposable.verifySimulatorPath(simulator);
  if (valid) {
    toast.success(`${SIMULATOR_DISPLAY_NAMES[simulator]} paths are valid!`);
  } else {
    toast.error(`${SIMULATOR_DISPLAY_NAMES[simulator]} paths could not be verified.`);
  }
}

function getSimulatorIcon(simulator: Simulator): string {
  switch (simulator) {
    case 'dcs':
      return 'mdi-airplane';
    case 'msfs':
      return 'mdi-airplane-takeoff';
    case 'xplane':
      return 'mdi-airport';
    case 'il2':
      return 'mdi-airplane-marker';
    case 'iracing':
    case 'acc':
      return 'mdi-car-sports';
    default:
      return 'mdi-gamepad-variant';
  }
}

async function updateCheckForUpdates(value: boolean) {
  await window.rigReady.settings.update({ checkForUpdates: value });
}

async function checkForUpdatesNow() {
  checkingUpdates.value = true;
  updateMessage.value = '';

  try {
    const hasUpdate = await window.rigReady.updates.check();
    if (hasUpdate) {
      const status = await window.rigReady.updates.getStatus();
      if (status.availableVersion) {
        updateMessage.value = `Update available: v${status.availableVersion}`;
        updateMessageClass.value = 'text-success';
      }
    } else {
      updateMessage.value = 'You are running the latest version.';
      updateMessageClass.value = 'text-medium-emphasis';
    }
  } catch {
    updateMessage.value = 'Failed to check for updates.';
    updateMessageClass.value = 'text-error';
  } finally {
    checkingUpdates.value = false;
  }
}

onMounted(async () => {
  await settingsComposable.loadSettings();
  await loadDevices();

  // Load the checkForUpdates setting
  const settings = await window.rigReady.settings.get();
  checkForUpdates.value = settings.checkForUpdates;
});
</script>

<template>
  <div class="settings-view">
    <PageHeader title="Settings" />

    <v-row>
      <!-- Simulator Paths -->
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex justify-space-between align-center">
            Simulator Paths
            <v-btn
              size="small"
              variant="outlined"
              :loading="settingsComposable.scanning.value"
              @click="scanAll"
            >
              <v-icon start>mdi-magnify</v-icon>
              Auto-Detect All
            </v-btn>
          </v-card-title>
          <v-card-text>
            <v-table density="compact">
              <thead>
                <tr>
                  <th>Simulator</th>
                  <th>Install Path</th>
                  <th>Config Path</th>
                  <th>Status</th>
                  <th style="width: 180px">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="sim in availableSimulators" :key="sim.value">
                  <td>
                    <div class="d-flex align-center gap-2">
                      <v-icon :icon="getSimulatorIcon(sim.value)" size="small" />
                      {{ sim.title }}
                    </div>
                  </td>
                  <td class="text-caption font-mono">
                    {{
                      settingsComposable.simulatorPaths.value.find((p) => p.simulator === sim.value)
                        ?.installPath || '-'
                    }}
                  </td>
                  <td class="text-caption font-mono">
                    {{
                      settingsComposable.simulatorPaths.value.find((p) => p.simulator === sim.value)
                        ?.configPath || '-'
                    }}
                  </td>
                  <td>
                    <v-chip
                      :color="sim.configured ? 'success' : 'default'"
                      size="x-small"
                      variant="tonal"
                    >
                      {{ sim.configured ? 'Configured' : 'Not Set' }}
                    </v-chip>
                  </td>
                  <td>
                    <v-btn
                      icon
                      variant="text"
                      size="small"
                      title="Auto-detect"
                      :loading="settingsComposable.scanning.value"
                      @click="autoScan(sim.value)"
                    >
                      <v-icon>mdi-magnify</v-icon>
                    </v-btn>
                    <v-btn
                      icon
                      variant="text"
                      size="small"
                      title="Edit"
                      @click="openEditPath(sim.value)"
                    >
                      <v-icon>mdi-pencil</v-icon>
                    </v-btn>
                    <v-btn
                      v-if="sim.configured"
                      icon
                      variant="text"
                      size="small"
                      title="Verify"
                      @click="verifyPath(sim.value)"
                    >
                      <v-icon>mdi-check-circle</v-icon>
                    </v-btn>
                    <v-btn
                      v-if="sim.configured"
                      icon
                      variant="text"
                      size="small"
                      color="error"
                      title="Remove"
                      @click="removePath(sim.value)"
                    >
                      <v-icon>mdi-delete</v-icon>
                    </v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Device Configuration -->
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Device Configuration</v-card-title>
          <v-card-text>
            <div class="d-flex justify-space-between align-center mb-4">
              <div>
                <div class="text-subtitle-1">Expected Devices</div>
                <div class="text-caption text-medium-emphasis">
                  Devices that should be connected
                </div>
              </div>
              <v-chip size="small" variant="tonal">
                {{ expectedDeviceCount }}
              </v-chip>
            </div>
            <v-btn
              color="error"
              variant="outlined"
              prepend-icon="mdi-delete"
              @click="clearExpectedDevices"
            >
              Clear Expected Devices
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Application Settings -->
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Application</v-card-title>
          <v-card-text>
            <v-switch label="Start with Windows" color="primary" hide-details disabled />
            <v-switch label="Minimize to tray" color="primary" hide-details disabled />
            <v-switch
              v-model="checkForUpdates"
              label="Check for updates on startup"
              color="primary"
              hide-details
              @update:model-value="updateCheckForUpdates"
            />
            <v-btn
              class="mt-4"
              variant="outlined"
              size="small"
              :loading="checkingUpdates"
              @click="checkForUpdatesNow"
            >
              <v-icon start>mdi-update</v-icon>
              Check for Updates Now
            </v-btn>
            <div v-if="updateMessage" class="text-caption mt-2" :class="updateMessageClass">
              {{ updateMessage }}
            </div>
            <div class="text-caption text-medium-emphasis mt-4">
              Start with Windows and Minimize to tray will be available in a future update.
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Edit Path Dialog -->
    <v-dialog v-model="showPathDialog" max-width="600">
      <v-card v-if="editingSimulator">
        <v-card-title> Configure {{ SIMULATOR_DISPLAY_NAMES[editingSimulator] }} </v-card-title>
        <v-card-text>
          <v-text-field
            v-model="pathForm.installPath"
            label="Install Path"
            placeholder="C:\Program Files\..."
            hint="Path to the simulator installation directory"
            persistent-hint
            class="mb-4"
          />
          <v-text-field
            v-model="pathForm.configPath"
            label="Config Path"
            placeholder="C:\Users\...\Saved Games\..."
            hint="Path to the simulator configuration/saved games directory"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showPathDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="savePath">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'Consolas', monospace;
}
</style>
