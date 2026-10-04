<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteLocationNormalizedLoaded } from 'vue-router';
import { appContract } from '../shared/appContract';
import { MODE_NAMES } from '../shared/feature';
import AboutDialog from './components/AboutDialog.vue';
import BrandMark from './components/BrandMark.vue';
import CommandPalette from './components/CommandPalette.vue';
import ShortcutsOverlay from './components/ShortcutsOverlay.vue';
import ToastHost from './components/ToastHost.vue';
import { manifests } from './features';
import { useClient } from './ipc';
import { notifyMachineChanged } from './machine';
import {
  aboutOpen,
  followRigKind,
  pageEpoch,
  paletteOpen,
  rigKind,
  shortcutsOpen,
} from './shell/shell';
import {
  isPanelWindow,
  isTyping,
  shortcut,
  shortcutFor,
  type FocusTarget,
} from './shell/shortcuts';

const route = useRoute();
const router = useRouter();
const mode = computed(() => (route.path.startsWith('/configure') ? 'configure' : 'fly'));
const scenario = ref<string>();
const version = ref('');
const dataRoot = ref<string>();
const overlays = manifests.flatMap((m) => m.overlays ?? []);
const notices = ref<string[]>([]);
const shell = useClient(appContract);
// The tray and live scenario changes act outside the renderer; screens refresh when told.
const off = shell.on('machineChanged', () => notifyMachineChanged());
let stopFollowing: () => void = () => undefined;

/**
 * The page shown, keyed so that a command can open it afresh (pageEpoch). The Configure
 * layout stays as it is: its own view is keyed the same way one level down.
 */
function viewKey(shown: RouteLocationNormalizedLoaded): string {
  const top = shown.matched[0]?.path ?? '';
  return shown.meta.mode === 'configure' ? top : `${top}:${pageEpoch.value}`;
}

/** A dialog of a feature is open and waiting for an answer: it keeps the keyboard. */
const dialogWaiting = (): boolean =>
  document.querySelector('.v-dialog.v-overlay--active:not(.rr-shell-dialog)') !== null;

function closePanels(): void {
  paletteOpen.value = false;
  shortcutsOpen.value = false;
  aboutOpen.value = false;
}

function onKey(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  if (event.key === 'Escape') {
    // The shell's own panels close on Escape from the first moment they are open. (A dialog
    // answers Escape itself too, but only once it has finished opening.)
    if (!dialogWaiting()) closePanels();
    return;
  }
  const wanted = shortcutFor(event, isTyping(event.target as FocusTarget | null));
  // A pop-out panel (the quick look) is one tool in a small window: these keys are not for it.
  if (!wanted || isPanelWindow(window.outerWidth, route.query)) return;
  if (dialogWaiting()) return;
  event.preventDefault();
  if (wanted === 'palette') {
    shortcutsOpen.value = false;
    aboutOpen.value = false;
    paletteOpen.value = !paletteOpen.value;
    return;
  }
  if (wanted === 'help') {
    aboutOpen.value = false;
    shortcutsOpen.value = !shortcutsOpen.value;
    return;
  }
  closePanels();
  if (wanted !== mode.value) void router.push(wanted === 'fly' ? '/' : '/configure');
}

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  const info = await shell.info();
  if (info.ok) {
    scenario.value = info.value.scenario;
    version.value = info.value.version;
    dataRoot.value = info.value.dataRoot;
    notices.value = info.value.notices;
  }
  // What the features offer the shell is not needed to draw the first screen: fetched once
  // it is up, for the palette and for the accent that follows the setup's kind of game.
  stopFollowing = await followRigKind(router);
});
onBeforeUnmount(() => {
  off();
  stopFollowing();
  window.removeEventListener('keydown', onKey);
});

// On the document itself, so that dialogs and menus, which are drawn outside the app's own
// element, carry the accent too.
watch(
  rigKind,
  (kind) => {
    if (kind) document.documentElement.dataset['rigKind'] = kind;
    else delete document.documentElement.dataset['rigKind'];
  },
  { immediate: true }
);
</script>

<template>
  <v-app>
    <v-app-bar flat density="comfortable" class="shell-bar">
      <div class="shell-brand" :data-kind="rigKind ?? 'none'" data-testid="shell-brand">
        <BrandMark :size="22" :kind="rigKind ?? 'flight'" />
        <span>RigReady</span>
      </div>
      <nav class="shell-modes" aria-label="Mode">
        <router-link
          to="/"
          class="shell-mode"
          :class="{ active: mode === 'fly' }"
          :aria-keyshortcuts="shortcut('fly').aria"
          :title="`${MODE_NAMES.fly} (Ctrl+1)`"
          data-testid="mode-fly"
        >
          {{ MODE_NAMES.fly }}
        </router-link>
        <router-link
          to="/configure"
          class="shell-mode"
          :class="{ active: mode === 'configure' }"
          :aria-keyshortcuts="shortcut('configure').aria"
          :title="`${MODE_NAMES.configure} (Ctrl+2)`"
          data-testid="mode-configure"
        >
          {{ MODE_NAMES.configure }}
        </router-link>
      </nav>
      <v-spacer />
      <button
        type="button"
        class="shell-find"
        aria-haspopup="dialog"
        :aria-keyshortcuts="shortcut('palette').aria"
        aria-label="Find a page or run a command"
        data-testid="palette-open"
        @click="paletteOpen = true"
      >
        <v-icon icon="mdi-magnify" size="17" />
        <span class="shell-find-text">Find or run</span>
        <span class="shell-find-keys"
          ><kbd class="rr-kbd">Ctrl</kbd><kbd class="rr-kbd">K</kbd></span
        >
      </button>
      <span v-if="scenario" class="shell-scenario" data-testid="scenario-banner" :title="scenario">
        <v-icon icon="mdi-flask-outline" size="16" /> Scenario: {{ scenario }}
      </span>
      <button
        type="button"
        class="shell-version"
        aria-haspopup="dialog"
        :aria-label="`About RigReady, version ${version}`"
        title="About RigReady"
        data-testid="about-open"
        @click="aboutOpen = true"
      >
        {{ version }}
      </button>
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
      <router-view v-slot="{ Component, route: shown }">
        <component :is="Component" :key="viewKey(shown)" />
      </router-view>
    </v-main>
    <component :is="overlay" v-for="(overlay, index) in overlays" :key="index" />
    <CommandPalette />
    <ShortcutsOverlay />
    <AboutDialog :version="version" :data-root="dataRoot" :kind="rigKind ?? 'flight'" />
    <ToastHost />
  </v-app>
</template>

<style scoped>
.shell-bar {
  background: var(--rr-surface) !important;
  border-bottom: 1px solid var(--rr-border);
  padding: 0 8px 0 16px;
}
/*
 * The one instrument detail of the shell: a heading tape along the bottom edge of the
 * header (a short tick every 8 px, a longer one every 40), fading out towards both ends,
 * with an index mark at its centre. Drawn, not content: nothing reads it or clicks it.
 */
.shell-bar::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 5px;
  pointer-events: none;
  background:
    linear-gradient(90deg, var(--rr-border-strong) 1px, transparent 1px) center bottom / 40px 5px
      repeat-x,
    linear-gradient(90deg, var(--rr-border-strong) 1px, transparent 1px) center bottom / 8px 2px
      repeat-x;
  mask-image: linear-gradient(90deg, transparent 4%, #000 30%, #000 70%, transparent 96%);
}
.shell-bar::before {
  content: '';
  position: absolute;
  left: calc(50% - 3.5px);
  bottom: 6px;
  width: 7px;
  height: 4px;
  pointer-events: none;
  background: var(--rr-kind, var(--rr-accent));
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  z-index: 1;
}
.shell-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.01em;
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
  transition:
    color var(--rr-motion-fast) var(--rr-ease),
    background-color var(--rr-motion-fast) var(--rr-ease);
}
.shell-mode:hover {
  color: var(--rr-text);
}
.shell-mode.active {
  background: var(--rr-surface-2);
  color: var(--rr-text);
}
.shell-find {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 6px 0 10px;
  /* Left too: at a large text size nothing else keeps it off the mode switch. */
  margin: 0 12px;
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  background: var(--rr-bg);
  color: var(--rr-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    color var(--rr-motion-fast) var(--rr-ease),
    border-color var(--rr-motion-fast) var(--rr-ease);
}
.shell-find:hover {
  color: var(--rr-text);
  border-color: var(--rr-border-strong);
}
.shell-find-text {
  margin-right: 14px;
}
.shell-find-keys {
  display: inline-flex;
  gap: 3px;
}
.shell-scenario {
  display: inline-block;
  min-width: 0;
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
.shell-scenario .v-icon {
  margin-right: 4px;
  vertical-align: -2px;
}
.shell-notice {
  margin: 12px 16px 0;
}
.shell-version {
  flex: none;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--rr-muted);
  cursor: pointer;
  transition: color var(--rr-motion-fast) var(--rr-ease);
}
.shell-version:hover {
  color: var(--rr-text);
}
/* A narrow window keeps the keys and drops the words. */
@media (max-width: 1120px) {
  .shell-find-text {
    display: none;
  }
}
</style>
