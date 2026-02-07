<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import LaunchView from './views/LaunchView.vue';
import ProfilesView from './views/ProfilesView.vue';
import ChecklistView from './views/ChecklistView.vue';
import ProfileWizardView from './views/ProfileWizardView.vue';
import DevicesView from './views/DevicesView.vue';
import InputTesterView from './views/InputTesterView.vue';
import DisplaysView from './views/DisplaysView.vue';
import KeybindingsView from './views/KeybindingsView.vue';
import StreamDeckView from './views/StreamDeckView.vue';
import SettingsView from './views/SettingsView.vue';
import DebugView from './views/DebugView.vue';
import { useToast } from './composables/useToast';
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts';
import { createNavigation } from './composables/useNavigation';

const { toastState, hide: hideToast } = useToast();
const { shortcuts, showShortcutsHelp, registerShortcuts, formatShortcut, hideHelp } =
  useKeyboardShortcuts();

const currentSection = ref('profiles');

// Create navigation provider for child components
const _navigation = createNavigation((section) => {
  currentSection.value = section;
});

// Toast icon based on type
const toastIcon = computed(() => {
  switch (toastState.value.type) {
    case 'success':
      return 'mdi-check-circle';
    case 'error':
      return 'mdi-alert-circle';
    case 'warning':
      return 'mdi-alert';
    case 'info':
    default:
      return 'mdi-information';
  }
});
const appStatus = ref<'scanning' | 'ready' | 'error'>('scanning');
const appVersion = ref('v1.0.0');

const navItems = [
  { id: 'profiles', title: 'Profiles', icon: 'mdi-account-box', shortcut: '1' },
  { id: 'checklist', title: 'Checklist', icon: 'mdi-clipboard-check', shortcut: '2' },
  { id: 'launch', title: 'Launch', icon: 'mdi-rocket-launch', shortcut: '3' },
  { id: 'devices', title: 'Devices', icon: 'mdi-controller', shortcut: '4' },
  { id: 'input-test', title: 'Input Tester', icon: 'mdi-gamepad-variant', shortcut: '5' },
  { id: 'displays', title: 'Displays', icon: 'mdi-monitor', shortcut: '6' },
  { id: 'keybindings', title: 'Keybindings', icon: 'mdi-keyboard', shortcut: '7' },
  { id: 'streamdeck', title: 'Stream Deck', icon: 'mdi-grid', shortcut: '8' },
  { id: 'settings', title: 'Settings', icon: 'mdi-cog', shortcut: '9' },
  { id: 'debug', title: 'Debug', icon: 'mdi-wrench', shortcut: '0' },
];

onMounted(async () => {
  // Register keyboard shortcuts
  registerShortcuts([
    {
      key: '1',
      ctrl: true,
      description: 'Go to Profiles',
      action: () => (currentSection.value = 'profiles'),
    },
    {
      key: '2',
      ctrl: true,
      description: 'Go to Checklist',
      action: () => (currentSection.value = 'checklist'),
    },
    {
      key: '3',
      ctrl: true,
      description: 'Go to Launch',
      action: () => (currentSection.value = 'launch'),
    },
    {
      key: '4',
      ctrl: true,
      description: 'Go to Devices',
      action: () => (currentSection.value = 'devices'),
    },
    {
      key: '5',
      ctrl: true,
      description: 'Go to Input Tester',
      action: () => (currentSection.value = 'input-test'),
    },
    {
      key: '6',
      ctrl: true,
      description: 'Go to Displays',
      action: () => (currentSection.value = 'displays'),
    },
    {
      key: '7',
      ctrl: true,
      description: 'Go to Keybindings',
      action: () => (currentSection.value = 'keybindings'),
    },
    {
      key: '8',
      ctrl: true,
      description: 'Go to Stream Deck',
      action: () => (currentSection.value = 'streamdeck'),
    },
    {
      key: '9',
      ctrl: true,
      description: 'Go to Settings',
      action: () => (currentSection.value = 'settings'),
    },
    {
      key: '0',
      ctrl: true,
      description: 'Go to Debug',
      action: () => (currentSection.value = 'debug'),
    },
    {
      key: ',',
      ctrl: true,
      description: 'Go to Settings',
      action: () => (currentSection.value = 'settings'),
    },
  ]);

  // Simulate initial scan
  setTimeout(() => {
    appStatus.value = 'ready';
  }, 1000);

  // Get app version
  try {
    const version = await window.rigReady.updates.getVersion();
    appVersion.value = `v${version}`;
  } catch {
    // Keep default version if failed
  }
});
</script>

<template>
  <v-app>
    <!-- Navigation Drawer (Sidebar) -->
    <v-navigation-drawer permanent width="220">
      <v-list-item prepend-icon="mdi-airplane" title="RigReady" class="py-4" />

      <v-divider />

      <v-list density="compact" nav>
        <v-list-item
          v-for="item in navItems"
          :key="item.id"
          :prepend-icon="item.icon"
          :active="currentSection === item.id"
          @click="currentSection = item.id"
          rounded="lg"
        >
          <v-list-item-title>{{ item.title }}</v-list-item-title>
          <template #append>
            <span class="text-caption text-medium-emphasis shortcut-hint">
              Ctrl+{{ item.shortcut }}
            </span>
          </template>
        </v-list-item>
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
          <div>{{ appVersion }}</div>
          <a
            href="https://www.markcheli.com"
            target="_blank"
            class="text-decoration-none text-high-emphasis"
          >
            Mark Cheli
          </a>
          <div class="mt-1">
            <a
              href="https://rigready.io"
              target="_blank"
              class="text-decoration-none text-medium-emphasis"
            >
              rigready.io
            </a>
            <span class="mx-1">·</span>
            <a
              href="https://github.com/MCheli/rigready"
              target="_blank"
              class="text-decoration-none text-medium-emphasis"
            >
              GitHub
            </a>
          </div>
        </div>
      </template>
    </v-navigation-drawer>

    <!-- Main Content -->
    <v-main>
      <v-container fluid class="main-content pa-6">
        <transition name="fade" mode="out-in">
          <ProfilesView v-if="currentSection === 'profiles'" />
          <ChecklistView v-else-if="currentSection === 'checklist'" />
          <ProfileWizardView v-else-if="currentSection === 'profile-wizard'" />
          <LaunchView v-else-if="currentSection === 'launch'" />
          <DevicesView v-else-if="currentSection === 'devices'" />
          <InputTesterView v-else-if="currentSection === 'input-test'" />
          <DisplaysView v-else-if="currentSection === 'displays'" />
          <KeybindingsView v-else-if="currentSection === 'keybindings'" />
          <StreamDeckView v-else-if="currentSection === 'streamdeck'" />
          <SettingsView v-else-if="currentSection === 'settings'" />
          <DebugView v-else-if="currentSection === 'debug'" />
        </transition>
      </v-container>
    </v-main>

    <!-- Global Toast Notifications -->
    <v-snackbar
      v-model="toastState.visible"
      :color="toastState.type"
      :timeout="toastState.timeout"
      location="bottom right"
      rounded="lg"
    >
      <div class="d-flex align-center">
        <v-icon :icon="toastIcon" class="mr-2" />
        {{ toastState.message }}
      </div>
      <template #actions>
        <v-btn variant="text" icon="mdi-close" size="small" @click="hideToast" />
      </template>
    </v-snackbar>

    <!-- Keyboard Shortcuts Help Dialog -->
    <v-dialog v-model="showShortcutsHelp" max-width="500">
      <v-card>
        <v-card-title class="d-flex justify-space-between align-center">
          <span>Keyboard Shortcuts</span>
          <v-btn icon="mdi-close" variant="text" size="small" @click="hideHelp" />
        </v-card-title>
        <v-card-text>
          <v-list density="compact" class="bg-transparent">
            <v-list-subheader>Navigation</v-list-subheader>
            <v-list-item v-for="shortcut in shortcuts" :key="shortcut.key">
              <template #prepend>
                <v-chip size="small" variant="outlined" class="shortcut-chip font-mono">
                  {{ formatShortcut(shortcut) }}
                </v-chip>
              </template>
              <v-list-item-title>{{ shortcut.description }}</v-list-item-title>
            </v-list-item>
            <v-divider class="my-2" />
            <v-list-subheader>Help</v-list-subheader>
            <v-list-item>
              <template #prepend>
                <v-chip size="small" variant="outlined" class="shortcut-chip font-mono">?</v-chip>
              </template>
              <v-list-item-title>Show/hide this dialog</v-list-item-title>
            </v-list-item>
            <v-list-item>
              <template #prepend>
                <v-chip size="small" variant="outlined" class="shortcut-chip font-mono">ESC</v-chip>
              </template>
              <v-list-item-title>Close dialogs</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<style scoped>
.v-navigation-drawer {
  border-right: 1px solid rgb(var(--v-theme-surface-variant)) !important;
}

.main-content {
  height: 100%;
  max-height: 100vh;
  overflow-y: auto;
  align-items: flex-start;
  align-content: flex-start;
}

.main-content > * {
  width: 100%;
}

.shortcut-hint {
  font-family: 'Consolas', monospace;
  font-size: 0.65rem;
  opacity: 0.5;
}

.shortcut-chip {
  min-width: 60px;
  justify-content: center;
}

.font-mono {
  font-family: 'Consolas', monospace;
}
</style>
