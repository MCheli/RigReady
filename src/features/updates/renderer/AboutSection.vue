<script setup lang="ts">
import { onMounted } from 'vue';
import { useUpdatesStore } from './store';

/** Settings > About: which version this is and which channel it follows. */
const store = useUpdatesStore();
onMounted(() => {
  if (!store.status) void store.load();
});
</script>

<template>
  <div data-testid="about-section">
    <div class="rr-row">
      <v-icon icon="mdi-information-outline" class="rr-muted" />
      <div class="rr-row-main">
        <div class="rr-row-title">
          RigReady
          <span data-testid="about-version">{{ store.status?.currentVersion ?? '…' }}</span>
        </div>
        <div class="rr-row-sub">
          Update channel:
          <span data-testid="about-channel">{{
            store.status?.channel === 'beta' ? 'Beta' : 'Stable'
          }}</span>
          · Open source under the MIT licence
        </div>
      </div>
    </div>
  </div>
</template>
