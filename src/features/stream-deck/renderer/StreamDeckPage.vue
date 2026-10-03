<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorText } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import BackupsView from './BackupsView.vue';
import FindingList from './FindingList.vue';
import InstallGuide from './InstallGuide.vue';
import InventoryView from './InventoryView.vue';
import { formatDate, plural, shortVersion, useStreamDeckStore } from './store';

const store = useStreamDeckStore();
const { overview, error, loading } = storeToRefs(store);
const route = useRoute();
const router = useRouter();

type Tab = 'overview' | 'profiles' | 'backups';
const tab = ref<Tab>(
  (['overview', 'profiles', 'backups'] as const).find((t) => t === route.query['tab']) ?? 'overview'
);
watch(tab, (value) => void router.replace({ query: value === 'overview' ? {} : { tab: value } }));

const backupsView = ref<InstanceType<typeof BackupsView>>();
const startError = ref<string>();
const starting = ref(false);

let off: (() => void) | undefined;
onMounted(() => {
  void store.load();
  off = onMachineChanged(() => void store.load());
});
onBeforeUnmount(() => off?.());

const status = computed(() => overview.value?.status);
const newestBackup = computed(() => overview.value?.backups.find((b) => b.kind === 'manual'));
const problems = computed(
  () =>
    overview.value?.findings.filter((f) => f.severity === 'bad' && f.id !== 'missing-plugins')
      .length ?? 0
);

async function startApp(): Promise<void> {
  starting.value = true;
  startError.value = undefined;
  const result = await store.api.startApp();
  starting.value = false;
  if (!result.ok) startError.value = errorText(result.error);
  notifyMachineChanged();
}

async function backupNow(): Promise<void> {
  tab.value = 'backups';
  await nextTick();
  backupsView.value?.openBackup();
}
</script>

<template>
  <div class="rr-page" data-testid="stream-deck-page">
    <div class="sd-title-row">
      <div>
        <h1 class="rr-page-title">Stream Deck</h1>
        <p class="rr-page-sub">
          Your Stream Deck profiles, the plugins they need, and backups of both.
        </p>
      </div>
      <v-spacer />
      <v-btn
        variant="tonal"
        prepend-icon="mdi-laptop"
        to="/configure/stream-deck/setup"
        data-testid="sd-setup-link"
      >
        Set up on a new PC
      </v-btn>
      <v-btn
        variant="text"
        icon="mdi-refresh"
        aria-label="Refresh"
        :loading="loading"
        data-testid="sd-refresh"
        @click="store.load()"
      />
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="sd-load-error">{{
      error
    }}</v-alert>

    <template v-if="overview && status">
      <div class="sd-tiles">
        <div class="rr-panel sd-tile" data-testid="sd-tile-app">
          <div class="rr-section-title">App</div>
          <template v-if="status.installed">
            <div class="sd-tile-main">
              <span :class="status.running ? 'rr-ok' : 'rr-warn'" data-testid="sd-app-state">
                {{ status.running ? 'Running' : 'Not running' }}
              </span>
            </div>
            <div class="rr-row-sub">
              Stream Deck {{ shortVersion(status.version) ?? '(version unknown)' }}
            </div>
            <v-btn
              v-if="!status.running"
              size="small"
              color="primary"
              class="sd-tile-btn"
              prepend-icon="mdi-play"
              :loading="starting"
              data-testid="sd-start"
              @click="startApp"
            >
              Start Stream Deck
            </v-btn>
          </template>
          <template v-else>
            <div class="sd-tile-main rr-bad" data-testid="sd-app-state">Not installed</div>
            <div class="rr-row-sub">See below for how to install it.</div>
          </template>
        </div>
        <div class="rr-panel sd-tile" data-testid="sd-tile-device">
          <div class="rr-section-title">Hardware</div>
          <div class="sd-tile-main" :class="status.devices.length ? 'rr-ok' : 'rr-warn'">
            {{ status.devices.length ? 'Connected' : 'Not connected' }}
          </div>
          <div class="rr-row-sub">
            <template v-if="status.devices.length">
              {{ status.devices.map((d) => d.name).join(', ') }}
            </template>
            <template v-else>Plug in your Stream Deck.</template>
          </div>
        </div>
        <div class="rr-panel sd-tile" data-testid="sd-tile-profiles">
          <div class="rr-section-title">Profiles</div>
          <div class="sd-tile-main">{{ overview.inventory.profiles.length }}</div>
          <div class="rr-row-sub">
            {{ plural(overview.inventory.totalActions, 'action') }} ·
            <span :class="problems ? 'rr-bad' : ''">{{
              problems ? plural(problems, 'problem') : 'no problems'
            }}</span>
          </div>
        </div>
        <div class="rr-panel sd-tile" data-testid="sd-tile-backup">
          <div class="rr-section-title">Last backup</div>
          <div class="sd-tile-main" :class="newestBackup ? '' : 'rr-warn'">
            {{ newestBackup ? formatDate(newestBackup.createdAt) : 'None yet' }}
          </div>
          <div class="rr-row-sub">{{ plural(overview.backups.length, 'backup') }} in RigReady</div>
        </div>
      </div>
      <v-alert
        v-if="startError"
        type="error"
        variant="tonal"
        class="mb-4"
        data-testid="sd-start-error"
        >{{ startError }}</v-alert
      >

      <v-tabs v-model="tab" class="sd-tabs" density="comfortable" color="primary">
        <v-tab value="overview" data-testid="sd-tab-overview">Health</v-tab>
        <v-tab value="profiles" data-testid="sd-tab-profiles">Profiles and plugins</v-tab>
        <v-tab value="backups" data-testid="sd-tab-backups">Backups</v-tab>
      </v-tabs>

      <div v-if="tab === 'overview'" data-testid="sd-panel-overview">
        <InstallGuide v-if="!status.installed" :download-url="overview.downloadUrl" />
        <h2 class="rr-section-title">Health</h2>
        <FindingList :findings="overview.findings" @backup="backupNow" />
      </div>
      <div v-else-if="tab === 'profiles'" data-testid="sd-panel-profiles">
        <InventoryView :inventory="overview.inventory" :profiles-folder="status.profilesFolder" />
      </div>
      <div v-else data-testid="sd-panel-backups">
        <BackupsView ref="backupsView" :overview="overview" />
      </div>
    </template>
    <div v-else-if="!error" class="rr-panel rr-empty">Reading your Stream Deck setup…</div>
  </div>
</template>

<style scoped>
.sd-title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.sd-tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.sd-tile {
  padding: 14px 16px;
}
.sd-tile-main {
  font-size: 18px;
  font-weight: 600;
  margin: 2px 0;
}
.sd-tile-btn {
  margin-top: 10px;
}
.sd-tabs {
  margin-bottom: 20px;
  border-bottom: 1px solid var(--rr-border);
}
</style>
