<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useUpdatesStore } from './store';

/**
 * The notice for a security release, on every screen. A release marked [security]
 * (docs/RELEASING.md, "Security fixes") is said more insistently than an ordinary update:
 * here, as soon as it is found, with the install one click away. It never blocks the app,
 * and Later puts it away for this run; Settings > Updates still shows it.
 */
const store = useUpdatesStore();
onMounted(() => {
  if (!store.status) void store.load();
});

const dismissed = ref(false);
const status = computed(() => store.status);
const shown = computed(() => {
  const s = status.value;
  return (
    !dismissed.value && s?.security === true && (s.phase === 'downloading' || s.phase === 'ready')
  );
});

/** The release's own words, without the marker that made it a security release. */
const notes = computed(() => status.value?.notes?.replace(/^\s*\[security\][\s:.-]*/i, '') ?? '');

const text = computed((): string => {
  const s = status.value;
  if (!s) return '';
  const version = `Version ${s.version}`;
  if (s.phase === 'downloading') {
    return `${version} fixes a security problem in RigReady. It is being downloaded (${s.percent ?? 0}%); restart RigReady to install it as soon as it is here.`;
  }
  if (s.blockedBy) {
    return `${version} fixes a security problem in RigReady. ${s.blockedBy} is running, so it was not installed: quit the game, then restart RigReady.`;
  }
  return `${version} fixes a security problem in RigReady. Restart RigReady now to install it.`;
});
</script>

<template>
  <div
    v-if="shown"
    class="security-notice rr-panel"
    role="alert"
    data-testid="security-update-notice"
  >
    <div class="security-notice-head">
      <v-icon icon="mdi-shield-alert-outline" size="20" class="rr-warn" />
      <span class="security-notice-title">Security update</span>
    </div>
    <div class="security-notice-text" data-testid="security-update-text">{{ text }}</div>
    <div v-if="notes" class="rr-row-sub" data-testid="security-update-notes">{{ notes }}</div>
    <div v-if="store.error" class="rr-row-sub rr-bad">{{ store.error }}</div>
    <div class="security-notice-actions">
      <v-btn
        v-if="status?.phase === 'ready'"
        color="primary"
        size="small"
        data-testid="security-update-install"
        @click="store.install()"
      >
        Restart to install
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        data-testid="security-update-later"
        @click="dismissed = true"
      >
        Later
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.security-notice {
  position: fixed;
  top: 68px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;
  width: min(560px, calc(100vw - 40px));
  padding: 12px 16px;
  border-color: color-mix(in srgb, var(--rr-warn) 60%, var(--rr-border));
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.security-notice-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.security-notice-title {
  font-size: 14px;
  font-weight: 600;
}
.security-notice-text {
  margin: 6px 0 4px;
  font-size: 13px;
}
.security-notice-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
</style>
