<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import {
  useGames,
  useProcess,
  type GameProfile,
  type ProcessCheckResult,
  type LaunchResult,
} from '../composables/useRigReady';
import PageHeader from '../components/PageHeader.vue';

const games = useGames();
const process = useProcess();

// State
const showProfileDialog = ref(false);
const editingProfile = ref<GameProfile | null>(null);
const launchStatus = ref<LaunchResult | null>(null);
const showLaunchDialog = ref(false);
const runningProcesses = ref<ProcessCheckResult[]>([]);
const isChecking = ref(false);
const isDetecting = ref(false);
const showDetectedDialog = ref(false);

// Form data for profile editing
const profileForm = ref({
  name: '',
  executablePath: '',
  arguments: [] as string[],
  argumentsText: '',
  workingDirectory: '',
  preLaunchProcesses: [] as string[],
});

// Known processes for pre-launch selection
const knownProcesses = [
  { name: 'TrackIR5.exe', displayName: 'TrackIR 5' },
  { name: 'SimAppPro.exe', displayName: 'WinWing SimAppPro' },
  { name: 'VPC_Joystick_Tester.exe', displayName: 'Virpil Software' },
  { name: 'VJoyConf.exe', displayName: 'vJoy' },
  { name: 'JoystickGremlin.exe', displayName: 'Joystick Gremlin' },
  { name: 'voiceattack.exe', displayName: 'VoiceAttack' },
  { name: 'SRS-AutoUpdater.exe', displayName: 'DCS-SRS' },
];

// Computed
const isEditing = computed(() => editingProfile.value !== null);
const dialogTitle = computed(() => (isEditing.value ? 'Edit Game Profile' : 'New Game Profile'));

// Load data on mount
onMounted(async () => {
  await games.loadProfiles();
  await refreshStatus();
});

// Refresh running processes
async function refreshStatus() {
  isChecking.value = true;
  try {
    runningProcesses.value = await process.getRunningKnown();
  } finally {
    isChecking.value = false;
  }
}

// Profile management
function openNewProfile() {
  editingProfile.value = null;
  profileForm.value = {
    name: '',
    executablePath: '',
    arguments: [],
    argumentsText: '',
    workingDirectory: '',
    preLaunchProcesses: [],
  };
  showProfileDialog.value = true;
}

function openEditProfile(profile: GameProfile) {
  editingProfile.value = profile;
  profileForm.value = {
    name: profile.name,
    executablePath: profile.executablePath,
    arguments: [...profile.arguments],
    argumentsText: profile.arguments.join(' '),
    workingDirectory: profile.workingDirectory || '',
    preLaunchProcesses: [...profile.preLaunchProcesses],
  };
  showProfileDialog.value = true;
}

async function saveProfile() {
  const profile: GameProfile = {
    id: editingProfile.value?.id || crypto.randomUUID(),
    name: profileForm.value.name,
    executablePath: profileForm.value.executablePath,
    arguments: profileForm.value.argumentsText.split(' ').filter((a) => a.trim()),
    workingDirectory: profileForm.value.workingDirectory || undefined,
    preLaunchProcesses: profileForm.value.preLaunchProcesses,
    autoStartProcesses: editingProfile.value?.autoStartProcesses || [],
  };

  await games.saveProfile(profile);
  showProfileDialog.value = false;
}

async function deleteProfile(id: string) {
  if (confirm('Are you sure you want to delete this profile?')) {
    await games.deleteProfile(id);
  }
}

// Launch functionality
async function launchGame(profileId: string) {
  // First run pre-flight checks
  const profile = await games.getProfile(profileId);
  if (!profile) return;

  // Check if required processes are running
  const missingProcesses: string[] = [];
  for (const processName of profile.preLaunchProcesses) {
    const result = await process.checkProcess(processName);
    if (!result.running) {
      missingProcesses.push(result.displayName || processName);
    }
  }

  if (missingProcesses.length > 0) {
    launchStatus.value = {
      success: false,
      message: 'Pre-flight checks failed',
      missingProcesses,
    };
    showLaunchDialog.value = true;
    return;
  }

  // Launch the game
  const result = await games.launchGame(profileId);
  launchStatus.value = result;
  showLaunchDialog.value = true;
}

// Get icon for game
function getGameIcon(path: string): string {
  const lowerPath = path.toLowerCase();
  if (lowerPath.includes('dcs')) return 'mdi-airplane';
  if (lowerPath.includes('flight') || lowerPath.includes('msfs')) return 'mdi-airplane-takeoff';
  if (lowerPath.includes('il2') || lowerPath.includes('il-2')) return 'mdi-airplane-marker';
  if (lowerPath.includes('xplane') || lowerPath.includes('x-plane')) return 'mdi-airport';
  if (lowerPath.includes('iracing') || lowerPath.includes('assetto')) return 'mdi-car-sports';
  return 'mdi-gamepad-variant';
}

// Check if process is running
function isProcessRunning(processName: string): boolean {
  return runningProcesses.value.some(
    (p) => p.processName.toLowerCase() === processName.toLowerCase() && p.running
  );
}

// Auto-detect installed games
async function autoDetectGames() {
  isDetecting.value = true;
  try {
    await games.detectGames();
    if (games.detectedGames.value.length > 0) {
      showDetectedDialog.value = true;
    } else {
      alert('No supported games were detected on this system.');
    }
  } finally {
    isDetecting.value = false;
  }
}

// Create profile from detected game
async function createFromDetected(detected: { name: string; path: string }) {
  const profile: GameProfile = {
    id: crypto.randomUUID(),
    name: detected.name,
    executablePath: detected.path,
    arguments: [],
    preLaunchProcesses: [],
    autoStartProcesses: [],
  };
  await games.saveProfile(profile);
  showDetectedDialog.value = false;
}
</script>

<template>
  <div class="launch-view">
    <PageHeader title="Launch Center">
      <template #actions>
        <v-btn variant="outlined" :loading="isChecking" @click="refreshStatus">
          <v-icon start>mdi-refresh</v-icon>
          Refresh Status
        </v-btn>
        <v-btn variant="outlined" :loading="isDetecting" @click="autoDetectGames">
          <v-icon start>mdi-magnify</v-icon>
          Auto Detect
        </v-btn>
        <v-btn color="primary" @click="openNewProfile">
          <v-icon start>mdi-plus</v-icon>
          New Profile
        </v-btn>
      </template>
    </PageHeader>

    <!-- Running Processes Status -->
    <v-card class="mb-8">
      <v-card-title class="d-flex justify-space-between align-center">
        <span>Running Support Software</span>
        <v-chip :color="runningProcesses.length > 0 ? 'success' : 'warning'" size="small">
          {{ runningProcesses.length }} active
        </v-chip>
      </v-card-title>
      <v-card-text>
        <div v-if="runningProcesses.length === 0" class="text-medium-emphasis">
          No known sim-related processes are currently running.
        </div>
        <div v-else class="d-flex flex-wrap gap-2">
          <v-chip
            v-for="proc in runningProcesses"
            :key="proc.processName"
            color="success"
            variant="tonal"
            size="small"
          >
            <v-icon start size="small">mdi-check-circle</v-icon>
            {{ proc.displayName }}
          </v-chip>
        </div>
      </v-card-text>
    </v-card>

    <!-- Game Profiles -->
    <v-row v-if="games.profiles.value.length > 0">
      <v-col v-for="profile in games.profiles.value" :key="profile.id" cols="12" md="6" lg="4">
        <v-card class="profile-card h-100">
          <v-card-title class="d-flex align-center">
            <v-icon :icon="getGameIcon(profile.executablePath)" class="mr-2" />
            {{ profile.name }}
          </v-card-title>
          <v-card-subtitle class="text-truncate">
            {{ profile.executablePath }}
          </v-card-subtitle>
          <v-card-text>
            <!-- Pre-launch requirements -->
            <div v-if="profile.preLaunchProcesses.length > 0" class="mb-3">
              <div class="text-caption text-medium-emphasis mb-1">Pre-launch Requirements</div>
              <div class="d-flex flex-wrap gap-1">
                <v-chip
                  v-for="proc in profile.preLaunchProcesses"
                  :key="proc"
                  :color="isProcessRunning(proc) ? 'success' : 'error'"
                  size="x-small"
                  variant="tonal"
                >
                  <v-icon start size="x-small">
                    {{ isProcessRunning(proc) ? 'mdi-check' : 'mdi-close' }}
                  </v-icon>
                  {{ knownProcesses.find((p) => p.name === proc)?.displayName || proc }}
                </v-chip>
              </div>
            </div>

            <!-- Launch arguments -->
            <div v-if="profile.arguments.length > 0" class="mb-3">
              <div class="text-caption text-medium-emphasis mb-1">Launch Arguments</div>
              <code class="text-caption">{{ profile.arguments.join(' ') }}</code>
            </div>
          </v-card-text>
          <v-card-actions>
            <v-btn variant="text" size="small" @click="openEditProfile(profile)"> Edit </v-btn>
            <v-btn variant="text" size="small" color="error" @click="deleteProfile(profile.id)">
              Delete
            </v-btn>
            <v-spacer />
            <v-btn color="primary" variant="flat" @click="launchGame(profile.id)">
              <v-icon start>mdi-rocket-launch</v-icon>
              Launch
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <!-- Empty State -->
    <v-card v-else color="surface-variant">
      <v-card-text class="text-center py-10">
        <v-icon size="48" class="mb-4">mdi-rocket-launch-outline</v-icon>
        <div class="text-body-1 mb-4">No game profiles configured yet.</div>
        <v-btn color="primary" @click="openNewProfile">
          <v-icon start>mdi-plus</v-icon>
          Create Your First Profile
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- Profile Edit Dialog -->
    <v-dialog v-model="showProfileDialog" max-width="600">
      <v-card>
        <v-card-title>{{ dialogTitle }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="profileForm.name"
            label="Profile Name"
            placeholder="e.g., DCS World VR"
            class="mb-4"
          />

          <v-text-field
            v-model="profileForm.executablePath"
            label="Executable Path"
            placeholder="C:\Games\DCS World\bin\DCS.exe"
            class="mb-4"
          />

          <v-text-field
            v-model="profileForm.argumentsText"
            label="Launch Arguments (optional)"
            placeholder="-w 1920 -h 1080"
            class="mb-4"
          />

          <v-text-field
            v-model="profileForm.workingDirectory"
            label="Working Directory (optional)"
            placeholder="Leave empty to use executable directory"
            class="mb-4"
          />

          <v-select
            v-model="profileForm.preLaunchProcesses"
            :items="knownProcesses"
            item-title="displayName"
            item-value="name"
            label="Required Processes (Pre-flight Checks)"
            multiple
            chips
            closable-chips
            hint="Select processes that must be running before launch"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showProfileDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="saveProfile">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Launch Result Dialog -->
    <v-dialog v-model="showLaunchDialog" max-width="400">
      <v-card v-if="launchStatus">
        <v-card-title class="d-flex align-center">
          <v-icon :color="launchStatus.success ? 'success' : 'error'" class="mr-2">
            {{ launchStatus.success ? 'mdi-check-circle' : 'mdi-alert-circle' }}
          </v-icon>
          {{ launchStatus.success ? 'Launch Successful' : 'Launch Failed' }}
        </v-card-title>
        <v-card-text>
          <p>{{ launchStatus.message }}</p>

          <div v-if="launchStatus.missingProcesses?.length" class="mt-3">
            <div class="text-caption text-medium-emphasis mb-2">Missing Processes:</div>
            <v-chip
              v-for="proc in launchStatus.missingProcesses"
              :key="proc"
              color="error"
              size="small"
              variant="tonal"
              class="mr-1 mb-1"
            >
              {{ proc }}
            </v-chip>
          </div>

          <div v-if="launchStatus.startedProcesses?.length" class="mt-3">
            <div class="text-caption text-medium-emphasis mb-2">Started Processes:</div>
            <v-chip
              v-for="proc in launchStatus.startedProcesses"
              :key="proc"
              color="success"
              size="small"
              variant="tonal"
              class="mr-1 mb-1"
            >
              {{ proc }}
            </v-chip>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showLaunchDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Detected Games Dialog -->
    <v-dialog v-model="showDetectedDialog" max-width="500">
      <v-card>
        <v-card-title>Detected Games</v-card-title>
        <v-card-text>
          <p class="mb-4">
            Found {{ games.detectedGames.value.length }} installed game(s). Click "Add" to create a
            profile.
          </p>
          <v-list>
            <v-list-item
              v-for="game in games.detectedGames.value"
              :key="game.path"
              class="mb-2 rounded"
              :class="{
                'bg-surface-variant': games.profiles.value.some(
                  (p) => p.executablePath === game.path
                ),
              }"
            >
              <template #prepend>
                <v-icon :icon="getGameIcon(game.path)" class="mr-3" />
              </template>
              <v-list-item-title>{{ game.name }}</v-list-item-title>
              <v-list-item-subtitle class="text-truncate" style="max-width: 300px">
                {{ game.path }}
              </v-list-item-subtitle>
              <template #append>
                <v-btn
                  v-if="!games.profiles.value.some((p) => p.executablePath === game.path)"
                  size="small"
                  color="primary"
                  variant="tonal"
                  @click="createFromDetected(game)"
                >
                  Add
                </v-btn>
                <v-chip v-else size="small" color="success" variant="tonal"> Added </v-chip>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showDetectedDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.profile-card {
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.profile-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

code {
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
