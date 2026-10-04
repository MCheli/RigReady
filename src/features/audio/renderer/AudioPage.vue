<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { audioContract, type AudioDeviceView, type AudioView } from '../contract';
import type { DefaultRole } from '../core/audio';

const api = useClient(audioContract);
const view = ref<AudioView>();
const loadError = ref<string>();
const error = ref<string>();
const notice = ref<string>();
const busy = ref<string>();

async function load(): Promise<void> {
  const result = await api.view();
  if (result.ok) {
    view.value = result.value;
    loadError.value = undefined;
  } else {
    loadError.value = errorText(result.error);
  }
}

async function setDefault(device: AudioDeviceView, role: DefaultRole): Promise<void> {
  busy.value = `${device.id}/${role}`;
  error.value = undefined;
  notice.value = undefined;
  const result = await api.setDefault({ id: device.id, role });
  busy.value = undefined;
  if (result.ok) {
    view.value = result.value.view;
    notice.value = result.value.message;
    notifyMachineChanged();
  } else {
    error.value = errorText(result.error);
    void load();
  }
}

const sections = [
  {
    flow: 'playback' as const,
    title: 'Playback',
    icon: 'mdi-speaker',
    empty: 'No playback device is turned on in Windows.',
  },
  {
    flow: 'recording' as const,
    title: 'Recording',
    icon: 'mdi-microphone',
    empty: 'No microphone is turned on in Windows.',
  },
];

const iconFor = (device: AudioDeviceView): string => {
  const name = device.name.toLowerCase();
  if (device.flow === 'recording') return 'mdi-microphone-outline';
  if (name.includes('headphone') || name.includes('headset')) return 'mdi-headphones';
  if (name.includes('digital output') || name.includes('nvidia') || name.includes('hdmi')) {
    return 'mdi-television';
  }
  return 'mdi-speaker';
};

let stop: (() => void) | undefined;
onMounted(() => {
  stop = onMachineChanged(() => void load());
  return load();
});
onBeforeUnmount(() => stop?.());
</script>

<template>
  <div class="rr-page" data-testid="audio-page">
    <div class="d-flex align-start">
      <div>
        <h1 class="rr-page-title">Audio</h1>
        <p class="rr-page-sub">
          Which sound output and microphone Windows uses. Windows keeps two defaults per kind: one
          for everything, and one for calls (voice chat apps such as Discord or SRS). A setup can
          check both and put them right with Make ready.
        </p>
      </div>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-refresh" data-testid="audio-refresh" @click="load">
        Refresh
      </v-btn>
    </div>

    <v-alert
      v-if="loadError"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="audio-load-error"
    >
      {{ loadError }}
      <template #append>
        <v-btn variant="text" size="small" @click="load">Try again</v-btn>
      </template>
    </v-alert>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      closable
      data-testid="audio-error"
      @click:close="error = undefined"
    >
      {{ error }}
    </v-alert>
    <v-alert
      v-if="notice"
      type="success"
      variant="tonal"
      class="mb-4"
      closable
      data-testid="audio-notice"
      @click:close="notice = undefined"
    >
      {{ notice }}
    </v-alert>

    <template v-if="view">
      <div v-for="section in sections" :key="section.flow" class="audio-section">
        <div class="rr-section-title">{{ section.title }}</div>
        <div class="rr-panel" :data-testid="`audio-${section.flow}`">
          <div
            v-for="device in view[section.flow]"
            :key="device.id"
            class="rr-row"
            data-testid="audio-device"
            :data-name="device.name"
            :data-default="device.isDefault"
            :data-communications="device.isCommunications"
          >
            <v-icon
              :icon="iconFor(device)"
              :class="device.isDefault ? 'audio-active' : 'rr-muted'"
            />
            <div class="rr-row-main">
              <div class="rr-row-title">
                {{ device.name }}
                <span v-if="device.isDefault" class="audio-badge" data-testid="audio-badge-default">
                  Default
                </span>
                <span
                  v-if="device.isCommunications"
                  class="audio-badge"
                  data-testid="audio-badge-calls"
                >
                  Calls
                </span>
              </div>
              <div class="rr-row-sub">
                <template v-if="device.isDefault && device.isCommunications">
                  Used for everything, including calls
                </template>
                <template v-else-if="device.isDefault">Used for everything except calls</template>
                <template v-else-if="device.isCommunications">Used for calls only</template>
                <template v-else>Not in use</template>
              </div>
            </div>
            <v-btn
              v-if="!device.isDefault"
              size="small"
              variant="tonal"
              :loading="busy === `${device.id}/default`"
              :disabled="busy !== undefined"
              data-testid="audio-make-default"
              @click="setDefault(device, 'default')"
            >
              Make default
            </v-btn>
            <v-btn
              v-if="!device.isCommunications"
              size="small"
              variant="text"
              :loading="busy === `${device.id}/communications`"
              :disabled="busy !== undefined"
              data-testid="audio-use-for-calls"
              @click="setDefault(device, 'communications')"
            >
              Use for calls
            </v-btn>
          </div>
          <div
            v-if="view[section.flow].length === 0"
            class="rr-empty"
            :data-testid="`audio-empty-${section.flow}`"
          >
            <v-icon :icon="section.icon" size="28" class="mb-2" />
            <div>{{ section.empty }}</div>
            <div class="rr-row-sub">
              Plug the device in or turn it on in Windows' Sound settings, then refresh.
            </div>
          </div>
        </div>
      </div>
      <p class="rr-muted audio-foot">
        Devices that are unplugged or disabled in Windows are not listed. A setup that expects one
        of them says so on the Play screen instead of picking another device.
      </p>
    </template>
    <PageSkeleton v-else-if="!loadError" label="Reading the audio devices…" />
  </div>
</template>

<style scoped>
.audio-section {
  margin-bottom: 24px;
}
.audio-badge {
  display: inline-block;
  margin-left: 6px;
  font-size: 11px;
  font-weight: 500;
  padding: 0 7px;
  border-radius: 9px;
  border: 1px solid var(--rr-accent);
  color: var(--rr-accent);
  vertical-align: 1px;
}
.audio-active {
  color: var(--rr-accent);
}
.audio-foot {
  font-size: 12.5px;
}
</style>
