<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { toasts, type Toast, type ToastTone } from '../shell/toast';

/**
 * Where the shell's toasts are shown: bottom centre, above everything, newest at the
 * bottom. Each says its tone with an icon of its own shape and with words, never by colour
 * alone, and is announced politely to a screen reader.
 */
const router = useRouter();

/**
 * Something else may be reporting in the same place: the strip of a command RigReady was
 * started with (a desktop shortcut, the hotkey) is docked at the bottom of the window.
 * Toasts then stand above it, not over it. Measured when a toast comes or goes, which is
 * when it matters; 0 while nothing is docked there.
 */
const DOCKED = '[data-testid="command-strip"]';
const GAP = 8;
const above = ref(0);
watch(
  () => toasts.list.value.length,
  (shown) => {
    const docked = shown > 0 ? document.querySelector(DOCKED) : null;
    above.value = docked
      ? Math.max(0, Math.round(window.innerHeight - docked.getBoundingClientRect().top) + GAP)
      : 0;
  },
  // Before the toast is drawn, so it never appears in one place and moves to another.
  { flush: 'pre' }
);

const LOOK: Record<ToastTone, { icon: string; tone: string; word: string }> = {
  ok: { icon: 'mdi-check-circle', tone: 'rr-ok', word: 'Done' },
  warn: { icon: 'mdi-alert', tone: 'rr-warn', word: 'Attention' },
  bad: { icon: 'mdi-close-circle', tone: 'rr-bad', word: 'Not done' },
  info: { icon: 'mdi-information-outline', tone: 'rr-toast-info', word: 'Note' },
  busy: { icon: '', tone: '', word: 'Working' },
};

function follow(toast: Toast): void {
  if (!toast.action) return;
  void router.push(toast.action.to);
  toasts.dismiss(toast.id);
}
</script>

<template>
  <div
    class="rr-toasts"
    data-testid="toasts"
    :style="above > 0 ? { bottom: `${above}px` } : undefined"
  >
    <transition-group name="rr-toast">
      <div
        v-for="toast in toasts.list.value"
        :key="toast.id"
        class="rr-toast"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        :data-tone="toast.tone"
        data-testid="toast"
        @mouseenter="toasts.hold(toast.id)"
        @mouseleave="toasts.release(toast.id)"
        @focusin="toasts.hold(toast.id)"
        @focusout="toasts.release(toast.id)"
      >
        <v-progress-circular
          v-if="toast.tone === 'busy'"
          indeterminate
          size="18"
          width="2"
          class="rr-toast-icon"
          aria-label="Working"
        />
        <v-icon
          v-else
          :icon="LOOK[toast.tone].icon"
          :class="['rr-toast-icon', LOOK[toast.tone].tone]"
          size="20"
          :aria-label="LOOK[toast.tone].word"
        />
        <div class="rr-toast-main">
          <!-- The icon's meaning in words, for a screen reader: the icon itself is not read. -->
          <span class="rr-sr-only">{{ LOOK[toast.tone].word }}:</span>
          <div class="rr-toast-text" data-testid="toast-text">{{ toast.text }}</div>
          <div v-if="toast.detail" class="rr-toast-detail" data-testid="toast-detail">
            {{ toast.detail }}
          </div>
        </div>
        <v-btn
          v-if="toast.action"
          size="small"
          variant="tonal"
          color="primary"
          class="rr-toast-action"
          data-testid="toast-action"
          @click="follow(toast)"
        >
          {{ toast.action.label }}
        </v-btn>
        <v-btn
          v-if="toast.tone !== 'busy'"
          icon="mdi-close"
          size="x-small"
          variant="text"
          aria-label="Dismiss"
          class="rr-toast-close"
          data-testid="toast-close"
          @click="toasts.dismiss(toast.id)"
        />
      </div>
    </transition-group>
  </div>
</template>

<style>
.rr-toasts {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 22px;
  /* Above dialogs and their scrims: an outcome is never hidden behind what it is about. */
  z-index: 3000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.rr-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: max-content;
  min-width: 280px;
  max-width: min(640px, calc(100vw - 48px));
  padding: 10px 10px 10px 14px;
  background: var(--rr-surface-2);
  border-radius: var(--rr-radius);
  box-shadow: var(--rr-elev-2);
  font-size: 14px;
}
.rr-toast-icon {
  flex: none;
  margin-top: 1px;
}
.rr-toast-info {
  color: var(--rr-accent);
}
.rr-toast-main {
  flex: 1;
  min-width: 0;
}
.rr-toast-text {
  color: var(--rr-text);
  font-weight: 500;
  overflow-wrap: anywhere;
}
.rr-toast-detail {
  margin-top: 2px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--rr-muted);
  overflow-wrap: anywhere;
}
.rr-toast-action {
  flex: none;
  align-self: center;
}
.rr-toast-close {
  flex: none;
  margin: -2px -2px 0 0;
}
.rr-toast-enter-active {
  transition:
    opacity var(--rr-motion-base) var(--rr-ease),
    transform var(--rr-motion-base) var(--rr-ease);
}
.rr-toast-leave-active {
  transition: opacity var(--rr-motion-fast) var(--rr-ease);
}
.rr-toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.rr-toast-leave-to {
  opacity: 0;
}
</style>
