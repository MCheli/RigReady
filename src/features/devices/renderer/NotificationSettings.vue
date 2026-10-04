<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { NotificationMode } from '../core/model';
import { useDevicesStore } from './store';

/**
 * Which plug and unplug notifications the tray shows. One choice, shown on the Devices
 * page and (through the manifest's `settings`) on the Settings page.
 */
const store = useDevicesStore();
const error = ref<string>();

const options: { value: NotificationMode; title: string; sub: string }[] = [
  {
    value: 'controllers',
    title: 'Game controllers',
    sub: 'Sticks, throttles, pedals, panels, wheels, and anything a setup needs',
  },
  {
    value: 'required',
    title: 'Only what the current setup needs',
    sub: 'The devices on the checklist of the setup you used last',
  },
  { value: 'all', title: 'Every USB device', sub: 'Keyboards, mice, headsets and the rest too' },
  { value: 'off', title: 'Off', sub: 'No notifications about devices' },
];

async function setMode(mode: NotificationMode | null): Promise<void> {
  if (!mode) return;
  error.value = await store.setNotifications(mode);
}

onMounted(() => {
  if (!store.overview) void store.load();
});
</script>

<template>
  <div class="notify" data-testid="devices-notifications">
    <p class="mb-2">
      While RigReady is in the tray, tell me when these are plugged in or unplugged:
    </p>
    <v-radio-group
      v-if="store.overview"
      :model-value="store.overview.notifications"
      density="compact"
      hide-details
      data-testid="notify-mode"
      :data-mode="store.overview.notifications"
      @update:model-value="setMode"
    >
      <v-radio
        v-for="o in options"
        :key="o.value"
        :value="o.value"
        :data-testid="`notify-${o.value}`"
      >
        <template #label>
          <div>
            <div>{{ o.title }}</div>
            <div class="rr-row-sub">{{ o.sub }}</div>
          </div>
        </template>
      </v-radio>
    </v-radio-group>
    <p v-else-if="store.error" class="rr-bad">{{ store.error }}</p>
    <p v-else class="rr-muted">Reading the current choice…</p>
    <p v-if="error" class="rr-bad" data-testid="notify-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.notify {
  padding: 14px 16px;
  font-size: 13.5px;
}
.notify p {
  margin: 0 0 8px;
}
</style>
