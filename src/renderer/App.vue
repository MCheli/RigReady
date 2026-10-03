<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { appContract } from '../shared/appContract';
import { manifests } from './features';
import { useClient } from './ipc';
import { notifyMachineChanged } from './machine';

const route = useRoute();
const mode = computed(() => (route.path.startsWith('/configure') ? 'configure' : 'fly'));
const scenario = ref<string>();
const version = ref('');
const overlays = manifests.flatMap((m) => m.overlays ?? []);
const notices = ref<string[]>([]);
const shell = useClient(appContract);
// The tray and live scenario changes act outside the renderer; screens refresh when told.
const off = shell.on('machineChanged', () => notifyMachineChanged());
onBeforeUnmount(off);

onMounted(async () => {
  const info = await shell.info();
  if (info.ok) {
    scenario.value = info.value.scenario;
    version.value = info.value.version;
    notices.value = info.value.notices;
  }
});
</script>

<template>
  <v-app>
    <v-app-bar flat density="comfortable" class="shell-bar">
      <div class="shell-brand">
        <v-icon icon="mdi-check-decagram" color="primary" size="22" />
        <span>RigReady</span>
      </div>
      <nav class="shell-modes" aria-label="Mode">
        <router-link
          to="/"
          class="shell-mode"
          :class="{ active: mode === 'fly' }"
          data-testid="mode-fly"
        >
          Fly
        </router-link>
        <router-link
          to="/configure"
          class="shell-mode"
          :class="{ active: mode === 'configure' }"
          data-testid="mode-configure"
        >
          Configure
        </router-link>
      </nav>
      <v-spacer />
      <span v-if="scenario" class="shell-scenario" data-testid="scenario-banner" :title="scenario">
        <v-icon icon="mdi-flask-outline" size="16" /> Scenario: {{ scenario }}
      </span>
      <span class="shell-version">{{ version }}</span>
    </v-app-bar>
    <v-main>
      <v-alert
        v-for="notice in notices"
        :key="notice"
        type="warning"
        variant="tonal"
        closable
        class="shell-notice"
        data-testid="app-notice"
      >
        {{ notice }}
      </v-alert>
      <router-view />
    </v-main>
    <component :is="overlay" v-for="(overlay, index) in overlays" :key="index" />
  </v-app>
</template>

<style scoped>
.shell-bar {
  background: var(--rr-surface) !important;
  border-bottom: 1px solid var(--rr-border);
  padding: 0 16px;
}
.shell-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 15px;
  margin-right: 28px;
}
.shell-modes {
  display: flex;
  gap: 4px;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  padding: 3px;
}
.shell-mode {
  padding: 5px 18px;
  border-radius: 6px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--rr-muted);
  text-decoration: none;
}
.shell-mode.active {
  background: var(--rr-surface-2);
  color: var(--rr-text);
}
.shell-scenario {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 420px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12.5px;
  color: var(--rr-warn);
  border: 1px solid color-mix(in srgb, var(--rr-warn) 40%, transparent);
  border-radius: 6px;
  padding: 3px 10px;
  margin-right: 12px;
}
.shell-notice {
  margin: 12px 16px 0;
}
.shell-version {
  font-size: 12px;
  color: var(--rr-muted);
}
</style>
