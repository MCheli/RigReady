<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useDevices, type USBDevice, type UnifiedDevice } from '../composables/useRigReady';
import { useNavigation } from '../composables/useNavigation';
import PageHeader from '../components/PageHeader.vue';

const { devices, loading, error, loadDevices, getUnifiedDevices } = useDevices();
const { navigateToInputTester } = useNavigation();

// Unified input devices for the Input Tester
const unifiedDevices = ref<UnifiedDevice[]>([]);

// Table sorting
const sortBy = ref<{ key: string; order: 'asc' | 'desc' }[]>([{ key: 'status', order: 'asc' }]);

// Table headers
const headers = [
  { title: 'Device', key: 'productName', sortable: true },
  { title: 'Vendor', key: 'vendorName', sortable: true },
  { title: 'Type', key: 'type', sortable: true },
  { title: 'ID', key: 'deviceId', sortable: false },
  { title: 'Status', key: 'status', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' as const },
];

// Devices with computed device ID for display
const devicesWithId = computed(() =>
  devices.value.map((d) => ({
    ...d,
    deviceId: `${d.vendorId}:${d.productId}`,
  }))
);

// Get icon for device based on type
function getDeviceIcon(device: USBDevice): string {
  switch (device.type) {
    case 'joystick':
      return 'mdi-gamepad-variant';
    case 'throttle':
      return 'mdi-speedometer';
    case 'pedals':
      return 'mdi-foot-print';
    case 'panel':
      return 'mdi-view-dashboard-variant';
    case 'headtracker':
      return 'mdi-head';
    case 'streamdeck':
      return 'mdi-grid';
    default:
      return 'mdi-usb';
  }
}

// Get icon color based on vendor
function getVendorColor(device: USBDevice): string {
  const vendorColors: Record<string, string> = {
    WinWing: 'blue',
    Thrustmaster: 'orange',
    Virpil: 'purple',
    VKB: 'green',
    Logitech: 'cyan',
    Elgato: 'pink',
    NaturalPoint: 'amber',
    SteelSeries: 'red',
  };
  return vendorColors[device.vendorName] || 'grey';
}

// Get type display name
function getTypeDisplayName(type: string): string {
  const typeNames: Record<string, string> = {
    joystick: 'Joystick',
    throttle: 'Throttle',
    pedals: 'Pedals',
    panel: 'Panel',
    headtracker: 'Head Tracker',
    streamdeck: 'Stream Deck',
    other: 'Other',
  };
  return typeNames[type] || type;
}

// Find a matching unified device for testing
function getUnifiedDeviceId(device: USBDevice): string | null {
  // Try to find a matching unified device by name (case-insensitive partial match)
  const productNameLower = device.productName.toLowerCase();

  for (const unified of unifiedDevices.value) {
    const unifiedNameLower = unified.displayName.toLowerCase();
    // Check if names overlap significantly
    if (
      unifiedNameLower.includes(productNameLower) ||
      productNameLower.includes(unifiedNameLower) ||
      // Also try matching individual words
      productNameLower
        .split(/\s+/)
        .some((word) => word.length > 3 && unifiedNameLower.includes(word))
    ) {
      return unified.id;
    }
  }
  return null;
}

// Check if device can be tested (has a matching input device)
function canTestDevice(device: USBDevice): boolean {
  return device.status === 'connected' && getUnifiedDeviceId(device) !== null;
}

// Navigate to input tester with device
function testDevice(device: USBDevice) {
  const deviceId = getUnifiedDeviceId(device);
  if (deviceId) {
    navigateToInputTester(deviceId);
  }
}

onMounted(async () => {
  loadDevices();
  // Load unified devices for input testing capability
  try {
    unifiedDevices.value = await getUnifiedDevices();
  } catch (e) {
    console.error('Failed to load unified devices:', e);
  }
});
</script>

<template>
  <div class="devices-view">
    <PageHeader title="Connected Devices">
      <template #actions>
        <v-btn prepend-icon="mdi-refresh" :loading="loading" @click="loadDevices"> Refresh </v-btn>
      </template>
    </PageHeader>

    <!-- Status Summary -->
    <v-row class="mb-8">
      <v-col cols="12" md="4">
        <v-card color="surface-variant">
          <v-card-text class="text-center">
            <div class="text-h3 font-weight-bold text-success">
              {{ devices.filter((d) => d.status === 'connected').length }}
            </div>
            <div class="text-caption text-medium-emphasis">Connected</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card color="surface-variant">
          <v-card-text class="text-center">
            <div class="text-h3 font-weight-bold text-error">
              {{ devices.filter((d) => d.status === 'disconnected').length }}
            </div>
            <div class="text-caption text-medium-emphasis">Missing</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card color="surface-variant">
          <v-card-text class="text-center">
            <div class="text-h3 font-weight-bold">
              {{ devices.length }}
            </div>
            <div class="text-caption text-medium-emphasis">Total</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Error Alert -->
    <v-alert v-if="error" type="error" class="mb-4" closable>
      {{ error }}
    </v-alert>

    <!-- Device Table -->
    <v-card v-if="devices.length > 0">
      <v-data-table
        v-model:sort-by="sortBy"
        :headers="headers"
        :items="devicesWithId"
        :items-per-page="-1"
        class="device-table"
        hover
      >
        <template #item.productName="{ item }">
          <div class="d-flex align-center py-2">
            <v-avatar
              :color="getVendorColor(item)"
              size="36"
              rounded="lg"
              variant="tonal"
              class="mr-3"
            >
              <v-icon :icon="getDeviceIcon(item)" size="20" />
            </v-avatar>
            <span class="font-weight-medium">{{ item.productName }}</span>
          </div>
        </template>

        <template #item.type="{ item }">
          <v-chip size="small" variant="tonal" :color="getVendorColor(item)">
            {{ getTypeDisplayName(item.type) }}
          </v-chip>
        </template>

        <template #item.deviceId="{ item }">
          <code class="text-caption">{{ item.deviceId }}</code>
        </template>

        <template #item.status="{ item }">
          <v-chip
            :color="item.status === 'connected' ? 'success' : 'error'"
            size="small"
            variant="tonal"
          >
            <v-icon start size="small">
              {{ item.status === 'connected' ? 'mdi-check-circle' : 'mdi-alert-circle' }}
            </v-icon>
            {{ item.status === 'connected' ? 'Connected' : 'Missing' }}
          </v-chip>
        </template>

        <template #item.actions="{ item }">
          <v-btn
            v-if="canTestDevice(item)"
            size="small"
            color="primary"
            variant="tonal"
            prepend-icon="mdi-gamepad-variant"
            @click="testDevice(item)"
          >
            Test
          </v-btn>
        </template>

        <template #bottom />
      </v-data-table>
    </v-card>

    <!-- Empty State -->
    <v-card v-else-if="!loading" color="surface-variant">
      <v-card-text class="text-center py-10">
        <v-icon size="48" class="mb-4">mdi-controller-off</v-icon>
        <div class="text-body-1">No devices detected. Click Refresh to scan.</div>
      </v-card-text>
    </v-card>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-10">
      <v-progress-circular indeterminate size="48" />
    </div>
  </div>
</template>

<style scoped>
.device-table :deep(.v-data-table__tr:hover) {
  background: rgba(255, 255, 255, 0.05) !important;
}

.device-table :deep(th) {
  font-weight: 600 !important;
  white-space: nowrap;
}

.device-table :deep(code) {
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Consolas', monospace;
}
</style>
