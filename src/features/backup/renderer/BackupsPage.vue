<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BackupsTab from './BackupsTab.vue';
import ChangesTab from './ChangesTab.vue';
import SnapshotsTab from './SnapshotsTab.vue';
import TrackedTab from './TrackedTab.vue';

const TABS = [
  { id: 'backups', title: 'Backups' },
  { id: 'tracked', title: 'Tracked files' },
  { id: 'snapshots', title: 'Snapshots' },
  { id: 'changes', title: 'What changed' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const route = useRoute();
const router = useRouter();
const tab = computed<TabId>({
  get: () => {
    const wanted = route.query['tab'];
    return TABS.some((t) => t.id === wanted) ? (wanted as TabId) : 'backups';
  },
  set: (value) => void router.replace({ query: { ...route.query, tab: value } }),
});
</script>

<template>
  <div class="rr-page" data-testid="backups-page">
    <h1 class="rr-page-title">Backups</h1>
    <p class="rr-page-sub">
      Your bindings, game settings and setups in one file you can keep anywhere, and put back on
      this PC or a new one.
    </p>

    <v-tabs v-model="tab" density="compact" color="primary" class="mb-5 backups-tabs">
      <v-tab v-for="t in TABS" :key="t.id" :value="t.id" :data-testid="`backups-tab-${t.id}`">
        {{ t.title }}
      </v-tab>
    </v-tabs>

    <BackupsTab v-if="tab === 'backups'" @show-tracked="tab = 'tracked'" />
    <TrackedTab v-else-if="tab === 'tracked'" />
    <SnapshotsTab v-else-if="tab === 'snapshots'" @show-tracked="tab = 'tracked'" />
    <ChangesTab v-else @show-tracked="tab = 'tracked'" />
  </div>
</template>

<style scoped>
.backups-tabs {
  border-bottom: 1px solid var(--rr-border);
}
</style>

<style>
/* Shared by the backup and sharing screens (not scoped: child components use them). */
.rr-section-title.section-gap {
  margin-top: 24px;
}
[data-testid='backups-page'] .v-checkbox-btn,
[data-testid='restore-page'] .v-checkbox-btn,
[data-testid='share-page'] .v-checkbox-btn {
  flex: 0 0 auto;
}
</style>
