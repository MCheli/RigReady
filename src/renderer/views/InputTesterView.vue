<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useDevices, usePygame, useHid, type UnifiedDevice } from '../composables/useSimManager';

const { getUnifiedDevices } = useDevices();
const pygame = usePygame();
const hid = useHid();

const devices = ref<UnifiedDevice[]>([]);
const selectedDeviceId = ref<string | null>(null);
const activityLog = ref<
  Array<{ time: string; device: string; input: string; value: string; type: string }>
>([]);
const inputState = ref<{ axes: number[]; buttons: boolean[]; hats: [number, number][] } | null>(
  null
);

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

// Handle device selection
watch(selectedDeviceId, async (newId, oldId) => {
  // Close old HID device if switching
  const oldParsed = parseDeviceId(oldId);
  if (oldParsed.type === 'hid' && oldParsed.value) {
    await hid.closeDevice(oldParsed.value);
  }

  // Open new HID device if selected
  const newParsed = parseDeviceId(newId);
  if (newParsed.type === 'hid' && newParsed.value) {
    await hid.openDevice(newParsed.value);
    await hid.startMonitoring();
  }

  // Clear state
  inputState.value = null;
  activityLog.value = [];
});

// Set up input listeners
onMounted(() => {
  loadDevices();

  pygame.onInputStates((states) => {
    const parsed = parseDeviceId(selectedDeviceId.value);
    if (parsed.type !== 'pygame') return;

    const state = states.find((s: any) => s.index === parsed.value);
    if (state) {
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

    const state = states.find((s: any) => s.path === parsed.value);
    if (state) {
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
</script>

<template>
  <div class="input-tester-view">
    <div class="d-flex justify-space-between align-center mb-6">
      <h1 class="text-h4 font-weight-bold">Input Tester</h1>
      <div class="d-flex gap-2">
        <v-select
          v-model="selectedDeviceId"
          :items="devices"
          item-title="displayName"
          item-value="id"
          label="Select Device"
          density="compact"
          style="min-width: 300px"
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
        <v-btn variant="outlined" @click="clearLog"> Clear Log </v-btn>
      </div>
    </div>

    <v-row v-if="selectedDeviceId && inputState">
      <!-- Input Visualization -->
      <v-col cols="12" lg="8">
        <v-card>
          <v-card-title>Input State</v-card-title>
          <v-card-text>
            <!-- Axes -->
            <div v-if="inputState.axes.length > 0" class="mb-4">
              <div class="text-subtitle-2 mb-2">Axes</div>
              <v-row>
                <v-col
                  v-for="(value, index) in inputState.axes"
                  :key="'axis-' + index"
                  cols="6"
                  md="3"
                >
                  <div class="text-caption text-medium-emphasis mb-1">Axis {{ index }}</div>
                  <v-progress-linear
                    :model-value="(value + 1) * 50"
                    color="primary"
                    height="20"
                    rounded
                  >
                    <template #default>
                      <span class="text-caption">{{ formatAxisValue(value) }}</span>
                    </template>
                  </v-progress-linear>
                </v-col>
              </v-row>
            </div>

            <!-- Buttons -->
            <div v-if="inputState.buttons.length > 0" class="mb-4">
              <div class="text-subtitle-2 mb-2">Buttons</div>
              <div class="d-flex flex-wrap gap-2">
                <v-chip
                  v-for="(pressed, index) in inputState.buttons"
                  :key="'btn-' + index"
                  :color="pressed ? 'success' : 'surface-variant'"
                  :variant="pressed ? 'flat' : 'outlined'"
                  size="small"
                >
                  {{ index }}
                </v-chip>
              </div>
            </div>

            <!-- Hats -->
            <div v-if="inputState.hats.length > 0">
              <div class="text-subtitle-2 mb-2">Hat Switches</div>
              <v-row>
                <v-col
                  v-for="(hat, index) in inputState.hats"
                  :key="'hat-' + index"
                  cols="6"
                  md="3"
                >
                  <div class="hat-display">
                    <div class="text-caption text-center mb-1">Hat {{ index }}</div>
                    <div class="hat-grid">
                      <div :class="{ active: hat[1] === 1 }">↑</div>
                      <div :class="{ active: hat[0] === -1 }">←</div>
                      <div class="center">●</div>
                      <div :class="{ active: hat[0] === 1 }">→</div>
                      <div :class="{ active: hat[1] === -1 }">↓</div>
                    </div>
                  </div>
                </v-col>
              </v-row>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Activity Log -->
      <v-col cols="12" lg="4">
        <v-card class="activity-log-card">
          <v-card-title class="d-flex justify-space-between align-center">
            Activity Log
            <v-chip size="small" variant="tonal"> {{ activityLog.length }} events </v-chip>
          </v-card-title>
          <v-card-text class="activity-log">
            <div v-if="activityLog.length === 0" class="text-center text-medium-emphasis py-4">
              Press buttons or move axes to see activity...
            </div>
            <div v-for="(event, index) in activityLog" :key="index" class="activity-item">
              <span class="text-caption text-medium-emphasis">{{ event.time }}</span>
              <span class="mx-2">{{ event.input }}</span>
              <span
                :class="event.type === 'button-press' ? 'text-success' : 'text-medium-emphasis'"
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
        <v-icon size="48" class="mb-4 text-medium-emphasis">mdi-gamepad-variant-outline</v-icon>
        <div class="text-body-1 text-medium-emphasis">
          Select a device from the dropdown to test inputs.
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.activity-log-card {
  height: 400px;
  display: flex;
  flex-direction: column;
}

.activity-log {
  flex: 1;
  overflow-y: auto;
}

.activity-item {
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 0.8rem;
}

.hat-display {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 8px;
}

.hat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  text-align: center;
}

.hat-grid div {
  padding: 4px;
  opacity: 0.3;
}

.hat-grid div.active {
  opacity: 1;
  color: rgb(var(--v-theme-success));
}

.hat-grid .center {
  opacity: 0.5;
}
</style>
