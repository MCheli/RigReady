<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import type { DisplayInfo } from '../../../shared/models';
import { displaysContract } from '../contract';
import { displayLabels } from '../core/layoutCheck';

const api = useClient(displaysContract);
const displays = ref<DisplayInfo[]>([]);
const error = ref<string>();
const loaded = ref(false);

async function load(): Promise<void> {
  const result = await api.read();
  if (result.ok) {
    displays.value = result.value.displays;
    error.value = undefined;
  } else {
    error.value = errorText(result.error);
  }
  loaded.value = true;
}

const labels = computed(() => displayLabels(displays.value));
const enabled = computed(() => displays.value.filter((d) => d.enabled));

/** The desktop drawn to scale inside a 100%-wide box. */
const map = computed(() => {
  const on = enabled.value;
  if (on.length === 0) return { ratio: 0.2, boxes: [] };
  const minX = Math.min(...on.map((d) => d.x));
  const minY = Math.min(...on.map((d) => d.y));
  const width = Math.max(...on.map((d) => d.x + d.width)) - minX;
  const height = Math.max(...on.map((d) => d.y + d.height)) - minY;
  return {
    ratio: height / width,
    boxes: on.map((d) => ({
      id: d.id,
      label: labels.value.get(d.id) ?? d.name,
      primary: d.primary,
      size: `${d.width}x${d.height}`,
      style: {
        left: `${((d.x - minX) / width) * 100}%`,
        top: `${((d.y - minY) / height) * 100}%`,
        width: `${(d.width / width) * 100}%`,
        height: `${(d.height / height) * 100}%`,
      },
    })),
  };
});

let stop: (() => void) | undefined;
onMounted(() => {
  stop = onMachineChanged(load);
  return load();
});
onBeforeUnmount(() => stop?.());
</script>

<template>
  <div class="rr-page" data-testid="displays-page">
    <div class="d-flex align-start">
      <div>
        <h1 class="rr-page-title">Monitors</h1>
        <p class="rr-page-sub">
          How Windows has the monitors arranged right now. A setup remembers this arrangement and
          can put it back.
        </p>
      </div>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="mdi-refresh" @click="load">Refresh</v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <div v-if="loaded && map.boxes.length" class="rr-panel displays-map-wrap">
      <div
        class="displays-map"
        :style="{ paddingBottom: `${map.ratio * 100}%` }"
        data-testid="displays-map"
      >
        <div
          v-for="box in map.boxes"
          :key="box.id"
          class="displays-box"
          :class="{ primary: box.primary }"
          :style="box.style"
        >
          <span>{{ box.label }}</span>
          <small>{{ box.size }}</small>
        </div>
      </div>
    </div>

    <div v-if="loaded" class="rr-panel">
      <div v-for="display in displays" :key="display.id" class="rr-row" data-testid="display-row">
        <v-icon :icon="display.enabled ? 'mdi-monitor' : 'mdi-monitor-off'" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title">
            {{ labels.get(display.id) }}
            <span v-if="display.primary" class="rr-muted"> · main display</span>
          </div>
          <div v-if="display.enabled" class="rr-row-sub">
            {{ display.width }}x{{ display.height }} at {{ display.x }},{{ display.y }} · rotation
            {{ display.rotation }}°<template v-if="display.refreshHz">
              · {{ display.refreshHz }} Hz</template
            >
          </div>
          <div v-else class="rr-row-sub">Connected, turned off</div>
          <div class="rr-row-sub rr-mono">{{ display.id }}</div>
        </div>
      </div>
      <div v-if="displays.length === 0" class="rr-row rr-muted">No monitors found.</div>
    </div>
  </div>
</template>

<style scoped>
.displays-map-wrap {
  padding: 16px;
  margin-bottom: 20px;
}
.displays-map {
  position: relative;
  width: 100%;
}
.displays-box {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--rr-border);
  outline: 2px solid var(--rr-surface);
  outline-offset: -3px;
  background: var(--rr-surface-2);
  font-size: 12px;
  overflow: hidden;
  text-align: center;
}
.displays-box.primary {
  border-color: var(--rr-accent);
}
.displays-box small {
  color: var(--rr-muted);
}
</style>
