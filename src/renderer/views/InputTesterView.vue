<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useDevices, usePygame, useHid, type UnifiedDevice } from '../composables/useRigReady';
import { useNavigation } from '../composables/useNavigation';
import PageHeader from '../components/PageHeader.vue';

const { getUnifiedDevices } = useDevices();
const pygame = usePygame();
const hid = useHid();
const navigation = useNavigation();

const devices = ref<UnifiedDevice[]>([]);
const selectedDeviceId = ref<string | null>(null);
const activityLog = ref<
  Array<{ time: string; device: string; input: string; value: string; type: string }>
>([]);
const inputState = ref<{ axes: number[]; buttons: boolean[]; hats: [number, number][] } | null>(
  null
);
const previousButtons = ref<boolean[]>([]);
const previousAxes = ref<number[]>([]);
const maxLogEntries = 50;
const captureMode = ref(false);
const lastCapturedInput = ref<{ input: string; value: string; type: string } | null>(null);

// Selected device info
const selectedDevice = computed(() => {
  if (!selectedDeviceId.value) return null;
  return devices.value.find((d) => d.id === selectedDeviceId.value) || null;
});

// Joystick crosshair position (using first two axes)
const crosshairPosition = computed(() => {
  if (!inputState.value || inputState.value.axes.length < 2) {
    return { x: 50, y: 50 };
  }
  return {
    x: ((inputState.value.axes[0] + 1) / 2) * 100,
    y: ((inputState.value.axes[1] + 1) / 2) * 100,
  };
});

// Throttle position (using third axis if available)
const throttlePosition = computed(() => {
  if (!inputState.value || inputState.value.axes.length < 3) {
    return null;
  }
  return ((inputState.value.axes[2] + 1) / 2) * 100;
});

// Load devices
async function loadDevices() {
  const available = await pygame.checkAvailable();
  if (available) {
    await pygame.start();
    await pygame.startMonitoring();
  }
  devices.value = await getUnifiedDevices();
}

// Parse device ID
function parseDeviceId(id: string | null) {
  if (!id) return { type: null, value: null };
  if (id.startsWith('pygame:')) {
    return { type: 'pygame', value: parseInt(id.slice(7), 10) };
  } else if (id.startsWith('hid:')) {
    return { type: 'hid', value: id.slice(4) };
  }
  return { type: null, value: null };
}

// Log an input event
function logEvent(input: string, value: string, type: string) {
  // Update capture mode with last input
  if (captureMode.value) {
    lastCapturedInput.value = { input, value, type };
  }

  const now = new Date();
  const time =
    now.toLocaleTimeString('en-US', { hour12: false }) +
    '.' +
    now.getMilliseconds().toString().padStart(3, '0');
  activityLog.value.unshift({
    time,
    device: selectedDevice.value?.displayName || 'Unknown',
    input,
    value,
    type,
  });
  // Keep log size reasonable
  if (activityLog.value.length > maxLogEntries) {
    activityLog.value.pop();
  }
}

function toggleCaptureMode() {
  captureMode.value = !captureMode.value;
  if (!captureMode.value) {
    lastCapturedInput.value = null;
  }
}

// Handle device selection
watch(selectedDeviceId, async (newId, oldId) => {
  // Close old HID device if switching
  const oldParsed = parseDeviceId(oldId);
  if (oldParsed.type === 'hid' && oldParsed.value) {
    await hid.closeDevice(oldParsed.value);
  }

  // Clear previous tracking state
  activityLog.value = [];
  previousButtons.value = [];
  previousAxes.value = [];

  // Initialize input state based on device type
  const newParsed = parseDeviceId(newId);
  const device = devices.value.find((d) => d.id === newId);

  if (newParsed.type === 'pygame' && device) {
    // Initialize pygame device with known capabilities
    const numAxes = device.numAxes || 0;
    const numButtons = device.numButtons || 0;
    const numHats = device.numHats || 0;
    inputState.value = {
      axes: Array(numAxes).fill(0),
      buttons: Array(numButtons).fill(false),
      hats: Array(numHats).fill([0, 0]) as [number, number][],
    };
  } else if (newParsed.type === 'hid' && newParsed.value) {
    // Open HID device and initialize with empty state (will populate on first input)
    await hid.openDevice(newParsed.value);
    await hid.startMonitoring();
    // Initialize with placeholder - HID devices don't report capabilities upfront
    inputState.value = {
      axes: [],
      buttons: Array(32).fill(false), // Default to 32 buttons for HID
      hats: [],
    };
  } else {
    inputState.value = null;
  }
});

// Set up input listeners
onMounted(async () => {
  await loadDevices();

  // Check if we were navigated here with a specific device to test
  if (navigation.state.value.targetDeviceId) {
    const targetId = navigation.state.value.targetDeviceId;
    // Verify the device exists in our loaded devices
    const targetDevice = devices.value.find((d) => d.id === targetId);
    if (targetDevice) {
      selectedDeviceId.value = targetId;
    }
    // Clear the navigation state so it doesn't persist
    navigation.clearNavigationState();
  }

  pygame.onInputStates((states) => {
    const parsed = parseDeviceId(selectedDeviceId.value);
    if (parsed.type !== 'pygame') return;

    const state = states.find((s) => s.index === parsed.value);
    if (state) {
      // Log button changes
      state.buttons.forEach((pressed, index) => {
        if (previousButtons.value[index] !== pressed) {
          logEvent(
            `Button ${index}`,
            pressed ? 'Pressed' : 'Released',
            pressed ? 'button-press' : 'button-release'
          );
        }
      });
      previousButtons.value = [...state.buttons];

      // Log significant axis changes (threshold 0.05)
      state.axes.forEach((value, index) => {
        if (previousAxes.value[index] !== undefined) {
          const delta = Math.abs(value - previousAxes.value[index]);
          if (delta > 0.1) {
            logEvent(`Axis ${index}`, value.toFixed(2), 'axis');
          }
        }
      });
      previousAxes.value = [...state.axes];

      inputState.value = {
        axes: state.axes,
        buttons: state.buttons,
        hats: state.hats,
      };
    }
  });

  hid.onInputStates((states) => {
    const parsed = parseDeviceId(selectedDeviceId.value);
    if (parsed.type !== 'hid') return;

    const state = states.find((s) => s.path === parsed.value);
    if (state) {
      // Log button changes
      state.buttons.forEach((pressed, index) => {
        if (previousButtons.value[index] !== pressed) {
          logEvent(
            `Button ${index}`,
            pressed ? 'Pressed' : 'Released',
            pressed ? 'button-press' : 'button-release'
          );
        }
      });
      previousButtons.value = [...state.buttons];

      inputState.value = {
        axes: [],
        buttons: state.buttons,
        hats: [],
      };
    }
  });
});

function clearLog() {
  activityLog.value = [];
}

function formatAxisValue(value: number): string {
  return value.toFixed(2);
}

function getAxisLabel(index: number): string {
  const labels = ['X', 'Y', 'Z', 'Rx', 'Ry', 'Rz', 'Slider 1', 'Slider 2'];
  return labels[index] || `Axis ${index}`;
}
</script>

<template>
  <div class="input-tester-view">
    <PageHeader title="Input Tester">
      <template #actions>
        <v-select
          v-model="selectedDeviceId"
          :items="devices"
          item-title="displayName"
          item-value="id"
          label="Select Device"
          density="compact"
          style="min-width: 280px"
          hide-details
        >
          <template #item="{ item, props }">
            <v-list-item v-bind="props">
              <template #prepend>
                <v-icon :color="item.raw.type === 'pygame' ? 'success' : 'info'" size="small">
                  {{ item.raw.type === 'pygame' ? 'mdi-gamepad' : 'mdi-usb' }}
                </v-icon>
              </template>
            </v-list-item>
          </template>
        </v-select>
        <v-btn
          :variant="captureMode ? 'flat' : 'outlined'"
          :color="captureMode ? 'warning' : undefined"
          @click="toggleCaptureMode"
        >
          {{ captureMode ? 'Stop Capture' : 'Press Any Button' }}
        </v-btn>
        <v-btn variant="outlined" @click="clearLog"> Clear Log </v-btn>
      </template>
    </PageHeader>

    <!-- Capture Mode Overlay -->
    <v-card v-if="captureMode && selectedDeviceId" color="warning" variant="tonal" class="mb-4">
      <v-card-text class="text-center py-6">
        <v-icon size="48" class="mb-2">mdi-gesture-tap-button</v-icon>
        <div class="text-h5 mb-2">Press Any Button</div>
        <div v-if="lastCapturedInput" class="text-h4 font-weight-bold">
          {{ lastCapturedInput.input }}: {{ lastCapturedInput.value }}
        </div>
        <div v-else class="text-body-1 text-medium-emphasis">Waiting for input...</div>
      </v-card-text>
    </v-card>

    <v-row v-if="selectedDeviceId && inputState">
      <!-- Device Info & Visual Controllers -->
      <v-col cols="12" md="4">
        <!-- Device Info Card -->
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2" :color="selectedDevice?.type === 'pygame' ? 'success' : 'info'">
              {{ selectedDevice?.type === 'pygame' ? 'mdi-gamepad' : 'mdi-usb' }}
            </v-icon>
            Device Info
          </v-card-title>
          <v-card-text>
            <div class="text-subtitle-2 mb-2">{{ selectedDevice?.displayName }}</div>
            <v-chip-group>
              <v-chip size="small" variant="tonal" color="primary">
                {{ inputState.axes.length }} Axes
              </v-chip>
              <v-chip size="small" variant="tonal" color="success">
                {{ inputState.buttons.length }} Buttons
              </v-chip>
              <v-chip size="small" variant="tonal" color="warning">
                {{ inputState.hats.length }} Hats
              </v-chip>
            </v-chip-group>
          </v-card-text>
        </v-card>

        <!-- Joystick Crosshair Visualization -->
        <v-card v-if="inputState.axes.length >= 2" class="mb-4">
          <v-card-title>Joystick Position</v-card-title>
          <v-card-text>
            <div class="crosshair-container">
              <div class="crosshair-grid">
                <div class="crosshair-h"></div>
                <div class="crosshair-v"></div>
                <div
                  class="crosshair-dot"
                  :style="{
                    left: crosshairPosition.x + '%',
                    top: crosshairPosition.y + '%',
                  }"
                ></div>
              </div>
              <div class="crosshair-labels">
                <span class="label-x">X: {{ formatAxisValue(inputState.axes[0]) }}</span>
                <span class="label-y">Y: {{ formatAxisValue(inputState.axes[1]) }}</span>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <!-- Throttle Visualization -->
        <v-card v-if="throttlePosition !== null">
          <v-card-title>Throttle</v-card-title>
          <v-card-text>
            <div class="throttle-container">
              <v-progress-linear
                :model-value="throttlePosition"
                color="warning"
                height="30"
                rounded
              >
                <template #default>
                  <span class="text-body-2 font-weight-bold">
                    {{ Math.round(throttlePosition) }}%
                  </span>
                </template>
              </v-progress-linear>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Input State Details -->
      <v-col cols="12" md="5">
        <v-card>
          <v-card-title>Input State</v-card-title>
          <v-card-text>
            <!-- Axes -->
            <div v-if="inputState.axes.length > 0" class="mb-4">
              <div class="text-subtitle-2 mb-2">Axes</div>
              <v-row dense>
                <v-col v-for="(value, index) in inputState.axes" :key="'axis-' + index" cols="6">
                  <div class="axis-item">
                    <div class="d-flex justify-space-between mb-1">
                      <span class="text-caption text-medium-emphasis">{{
                        getAxisLabel(index)
                      }}</span>
                      <span class="text-caption font-mono">{{ formatAxisValue(value) }}</span>
                    </div>
                    <v-progress-linear
                      :model-value="(value + 1) * 50"
                      :color="Math.abs(value) > 0.1 ? 'primary' : 'grey'"
                      height="8"
                      rounded
                    />
                  </div>
                </v-col>
              </v-row>
            </div>

            <!-- Buttons -->
            <div v-if="inputState.buttons.length > 0" class="mb-4">
              <div class="text-subtitle-2 mb-2">
                Buttons
                <v-chip size="x-small" variant="tonal" class="ml-2">
                  {{ inputState.buttons.filter((b) => b).length }} active
                </v-chip>
              </div>
              <div class="button-grid">
                <div
                  v-for="(pressed, index) in inputState.buttons"
                  :key="'btn-' + index"
                  class="button-cell"
                  :class="{ pressed }"
                >
                  {{ index }}
                </div>
              </div>
            </div>

            <!-- Hats -->
            <div v-if="inputState.hats.length > 0">
              <div class="text-subtitle-2 mb-2">Hat Switches</div>
              <v-row dense>
                <v-col
                  v-for="(hat, index) in inputState.hats"
                  :key="'hat-' + index"
                  cols="6"
                  md="4"
                >
                  <div class="hat-display">
                    <div class="text-caption text-center mb-1">Hat {{ index }}</div>
                    <div class="hat-grid">
                      <div class="hat-cell"></div>
                      <div class="hat-cell" :class="{ active: hat[1] === 1 }">↑</div>
                      <div class="hat-cell"></div>
                      <div class="hat-cell" :class="{ active: hat[0] === -1 }">←</div>
                      <div class="hat-cell center">●</div>
                      <div class="hat-cell" :class="{ active: hat[0] === 1 }">→</div>
                      <div class="hat-cell"></div>
                      <div class="hat-cell" :class="{ active: hat[1] === -1 }">↓</div>
                      <div class="hat-cell"></div>
                    </div>
                  </div>
                </v-col>
              </v-row>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Activity Log -->
      <v-col cols="12" md="3">
        <v-card class="activity-log-card">
          <v-card-title class="d-flex justify-space-between align-center">
            Activity
            <v-chip size="x-small" variant="tonal"> {{ activityLog.length }} </v-chip>
          </v-card-title>
          <v-card-text class="activity-log">
            <div v-if="activityLog.length === 0" class="text-center text-medium-emphasis py-4">
              <v-icon size="24" class="mb-2">mdi-gesture-tap</v-icon>
              <div class="text-caption">Press buttons or move axes</div>
            </div>
            <div v-for="(event, index) in activityLog" :key="index" class="activity-item">
              <span class="activity-time">{{ event.time.split('.')[1] }}</span>
              <span class="activity-input">{{ event.input }}</span>
              <span
                class="activity-value"
                :class="{
                  'text-success': event.type === 'button-press',
                  'text-error': event.type === 'button-release',
                  'text-info': event.type === 'axis',
                }"
              >
                {{ event.value }}
              </span>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Empty State -->
    <v-card v-else color="surface-variant">
      <v-card-text class="text-center py-10">
        <v-icon size="48" class="mb-4">mdi-gamepad-variant-outline</v-icon>
        <div class="text-body-1">Select a device from the dropdown to test inputs.</div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
/* Activity Log */
.activity-log-card {
  height: 500px;
  display: flex;
  flex-direction: column;
}

.activity-log {
  flex: 1;
  overflow-y: auto;
}

.activity-item {
  display: flex;
  align-items: center;
  padding: 3px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 0.75rem;
  font-family: 'Consolas', monospace;
}

.activity-time {
  color: rgba(var(--v-theme-on-surface), 0.4);
  width: 32px;
  flex-shrink: 0;
}

.activity-input {
  flex: 1;
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.activity-value {
  font-weight: 600;
  min-width: 60px;
  text-align: right;
}

/* Crosshair Joystick Visualization */
.crosshair-container {
  position: relative;
  width: 100%;
  padding-bottom: 100%;
}

.crosshair-grid {
  position: absolute;
  inset: 0;
  background: rgba(var(--v-theme-surface-variant), 0.3);
  border-radius: 50%;
  border: 2px solid rgba(var(--v-theme-outline), 0.5);
}

.crosshair-h,
.crosshair-v {
  position: absolute;
  background: rgba(var(--v-theme-outline), 0.3);
}

.crosshair-h {
  left: 10%;
  right: 10%;
  top: 50%;
  height: 1px;
  transform: translateY(-50%);
}

.crosshair-v {
  top: 10%;
  bottom: 10%;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
}

.crosshair-dot {
  position: absolute;
  width: 16px;
  height: 16px;
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 10px rgb(var(--v-theme-primary));
  transition:
    left 0.05s,
    top 0.05s;
}

.crosshair-labels {
  position: absolute;
  bottom: -24px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  font-family: 'Consolas', monospace;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* Button Grid */
.button-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));
  gap: 4px;
}

.button-cell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--v-theme-surface-variant), 0.5);
  border: 1px solid rgba(var(--v-theme-outline), 0.3);
  border-radius: 4px;
  font-size: 0.7rem;
  font-family: 'Consolas', monospace;
  color: rgba(var(--v-theme-on-surface), 0.5);
  transition: all 0.1s;
}

.button-cell.pressed {
  background: rgb(var(--v-theme-success));
  color: rgb(var(--v-theme-on-success));
  border-color: rgb(var(--v-theme-success));
  box-shadow: 0 0 8px rgba(var(--v-theme-success), 0.5);
  transform: scale(1.1);
}

/* Axis Items */
.axis-item {
  margin-bottom: 8px;
}

.font-mono {
  font-family: 'Consolas', monospace;
}

/* Hat Switch Display */
.hat-display {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 8px;
}

.hat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  text-align: center;
}

.hat-cell {
  padding: 4px;
  opacity: 0.2;
  font-size: 0.9rem;
}

.hat-cell.active {
  opacity: 1;
  color: rgb(var(--v-theme-success));
  font-weight: bold;
}

.hat-cell.center {
  opacity: 0.4;
}

/* Throttle */
.throttle-container {
  padding: 8px 0;
}
</style>
