<script setup lang="ts">
import { ref, onMounted } from 'vue';
import LaunchView from './views/LaunchView.vue';
import DevicesView from './views/DevicesView.vue';
import InputTesterView from './views/InputTesterView.vue';
import DisplaysView from './views/DisplaysView.vue';
import KeybindingsView from './views/KeybindingsView.vue';
import SettingsView from './views/SettingsView.vue';
import DebugView from './views/DebugView.vue';

const currentSection = ref('launch');
const appStatus = ref<'scanning' | 'ready' | 'error'>('scanning');

const navItems = [
  { id: 'launch', title: 'Launch', icon: 'mdi-rocket-launch' },
  { id: 'devices', title: 'Devices', icon: 'mdi-controller' },
  { id: 'input-test', title: 'Input Tester', icon: 'mdi-gamepad-variant' },
  { id: 'displays', title: 'Displays', icon: 'mdi-monitor' },
  { id: 'keybindings', title: 'Keybindings', icon: 'mdi-keyboard' },
  { id: 'settings', title: 'Settings', icon: 'mdi-cog' },
  { id: 'debug', title: 'Debug', icon: 'mdi-wrench' },
];

onMounted(async () => {
  // Simulate initial scan
  setTimeout(() => {
    appStatus.value = 'ready';
  }, 1000);
});
</script>

<template>
  <v-app>
    <!-- Navigation Drawer (Sidebar) -->
    <v-navigation-drawer permanent width="220">
      <v-list-item prepend-icon="mdi-airplane" title="Sim Manager" class="py-4" />

      <v-divider />

      <v-list density="compact" nav>
        <v-list-item
          v-for="item in navItems"
          :key="item.id"
          :prepend-icon="item.icon"
          :title="item.title"
          :active="currentSection === item.id"
          @click="currentSection = item.id"
          rounded="lg"
        />
      </v-list>

      <template #append>
        <v-divider />

        <!-- Status Indicator -->
        <v-list-item density="compact" class="py-2">
          <template #prepend>
            <v-icon
              :color="
                appStatus === 'ready' ? 'success' : appStatus === 'error' ? 'error' : 'warning'
              "
              size="small"
            >
              mdi-circle
            </v-icon>
          </template>
          <v-list-item-title class="text-caption">
            {{ appStatus === 'ready' ? 'Ready' : appStatus === 'error' ? 'Error' : 'Scanning...' }}
          </v-list-item-title>
        </v-list-item>

        <v-divider />

        <!-- Footer -->
        <div class="pa-3 text-center text-caption text-medium-emphasis">
          <div>v1.0.0</div>
          <a
            href="https://www.markcheli.com"
            target="_blank"
            class="text-decoration-none text-high-emphasis"
          >
            Mark Cheli
          </a>
          <div class="mt-1">
            <a
              href="https://github.com/MCheli/sim-manager"
              target="_blank"
              class="text-decoration-none text-medium-emphasis"
            >
              GitHub
            </a>
            <span class="mx-1">·</span>
            <a
              href="https://github.com/MCheli/sim-manager/blob/main/LICENSE"
              target="_blank"
              class="text-decoration-none text-medium-emphasis"
            >
              MIT
            </a>
          </div>
        </div>
      </template>
    </v-navigation-drawer>

    <!-- Main Content -->
    <v-main>
      <v-container fluid class="fill-height pa-6">
        <transition name="fade" mode="out-in">
          <LaunchView v-if="currentSection === 'launch'" />
          <DevicesView v-else-if="currentSection === 'devices'" />
          <InputTesterView v-else-if="currentSection === 'input-test'" />
          <DisplaysView v-else-if="currentSection === 'displays'" />
          <KeybindingsView v-else-if="currentSection === 'keybindings'" />
          <SettingsView v-else-if="currentSection === 'settings'" />
          <DebugView v-else-if="currentSection === 'debug'" />
        </transition>
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.v-navigation-drawer {
  border-right: 1px solid rgb(var(--v-theme-surface-variant)) !important;
}

.fill-height {
  height: 100%;
  overflow-y: auto;
}
</style>
