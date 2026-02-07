<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { ChecklistItem } from '../../../shared/profileTypes';

defineProps<{
  items: ChecklistItem[];
}>();

const emit = defineEmits<{
  'update:items': [value: ChecklistItem[]];
}>();

const devices = ref<Array<{ name: string; id: string }>>([]);
const selected = ref<string[]>([]);
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    const pygameDevices = await window.rigReady.pygame.getDevices();
    devices.value = pygameDevices.map((d) => ({
      name: d.name,
      id: `pygame:${d.index}`,
    }));
  } catch {
    // Ignore
  } finally {
    loading.value = false;
  }
});

function updateSelection(ids: string[]) {
  selected.value = ids;
  const items: ChecklistItem[] = ids.map((id) => {
    const device = devices.value.find((d) => d.id === id);
    return {
      id: `wiz-device-${id}`,
      type: 'device' as const,
      name: device?.name || id,
      isRequired: true,
      category: 'hardware' as const,
      config: {
        deviceName: device?.name,
      },
    };
  });
  emit('update:items', items);
}
</script>

<template>
  <div>
    <h3 class="text-h6 mb-4">Hardware Devices</h3>
    <p class="text-body-2 text-medium-emphasis mb-6">
      Select which connected devices are required for this profile.
    </p>

    <v-progress-linear v-if="loading" indeterminate class="mb-4" />

    <v-list v-if="devices.length > 0" density="compact">
      <v-list-item v-for="device in devices" :key="device.id">
        <template #prepend>
          <v-checkbox
            :model-value="selected.includes(device.id)"
            hide-details
            @update:model-value="
              $event
                ? updateSelection([...selected, device.id])
                : updateSelection(selected.filter((s) => s !== device.id))
            "
          />
        </template>
        <v-list-item-title>{{ device.name }}</v-list-item-title>
      </v-list-item>
    </v-list>
    <div v-else-if="!loading" class="text-medium-emphasis text-center py-4">
      No input devices detected. You can add device checks later.
    </div>
  </div>
</template>
