<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import ExternalLink from './ExternalLink.vue';
import FindingList from './FindingList.vue';
import {
  dcsFindings as dcs,
  expectedPlugins as expected,
  missingPlugins as missing,
  setupSteps,
} from '../core/setup';
import { plural, useStreamDeckStore } from './store';

const store = useStreamDeckStore();
const { overview, error } = storeToRefs(store);
const actionError = ref<string>();
const actionMessage = ref<string>();
const busy = ref(false);

let off: (() => void) | undefined;
onMounted(() => {
  void store.load();
  off = onMachineChanged(() => void store.load());
});
onBeforeUnmount(() => off?.());

const missingPlugins = computed(() => (overview.value ? missing(overview.value) : []));
const expectedPlugins = computed(() => (overview.value ? expected(overview.value) : []));
const dcsFindings = computed(() => (overview.value ? dcs(overview.value) : []));
const steps = computed(() => (overview.value ? setupSteps(overview.value) : []));

const doneCount = computed(() => steps.value.filter((s) => s.done).length);

async function startApp(): Promise<void> {
  busy.value = true;
  actionError.value = undefined;
  const result = await store.api.startApp();
  busy.value = false;
  if (!result.ok) actionError.value = errorText(result.error);
  notifyMachineChanged();
}

async function importFile(): Promise<void> {
  busy.value = true;
  actionError.value = undefined;
  const result = await store.api.importFile();
  busy.value = false;
  if (!result.ok) actionError.value = errorText(result.error);
  else if (result.value.backup) {
    actionMessage.value = `Imported "${result.value.backup.name}" with ${plural(result.value.backup.profiles.length, 'profile')}. Restore it from Backups.`;
  }
  await store.load();
}
</script>

<template>
  <div class="rr-page" data-testid="sd-setup-page">
    <router-link to="/configure/stream-deck" class="setup-back" data-testid="sd-setup-back">
      <v-icon icon="mdi-arrow-left" size="16" /> Stream Deck
    </router-link>
    <h1 class="rr-page-title">Set up Stream Deck on a new PC</h1>
    <p class="rr-page-sub">
      Work down the list. Each step checks this PC, so you can come back at any time and see where
      you are.
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <v-alert
      v-if="actionError"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="sd-setup-error"
      >{{ actionError }}</v-alert
    >

    <div v-if="actionMessage" class="setup-message rr-ok" data-testid="sd-setup-message">
      <v-icon icon="mdi-check" size="16" /> {{ actionMessage }}
    </div>

    <template v-if="overview">
      <div class="setup-progress rr-row-sub" data-testid="sd-setup-progress">
        {{ doneCount }} of {{ steps.length }} done
      </div>
      <div class="rr-panel">
        <div
          v-for="(step, index) in steps"
          :key="step.id"
          class="setup-step"
          data-testid="sd-step"
          :data-step="step.id"
          :data-done="step.done"
        >
          <div class="setup-mark" :class="step.done ? 'setup-mark-done' : ''">
            <v-icon v-if="step.done" icon="mdi-check" size="16" />
            <span v-else>{{ index + 1 }}</span>
          </div>
          <div class="rr-row-main">
            <div class="rr-row-title">{{ step.title }}</div>
            <div class="rr-row-sub" :class="step.done ? 'rr-ok' : ''">{{ step.state }}</div>

            <div v-if="!step.done" class="setup-body">
              <template v-if="step.id === 'install'">
                <p>
                  Download "Stream Deck" for Windows from Elgato and run the installer. Install it
                  before restoring anything: it creates the folders your profiles go in.
                </p>
                <ExternalLink
                  :url="overview.downloadUrl"
                  label="Open Elgato's downloads page"
                  testid="sd-setup-download"
                  variant="flat"
                />
              </template>
              <template v-else-if="step.id === 'connect'">
                <p>
                  Plug the Stream Deck into a USB port on the PC itself or a powered hub. This step
                  ticks itself off when Windows sees it.
                </p>
              </template>
              <template v-else-if="step.id === 'profiles'">
                <p>
                  Copy your backup to this PC first: a
                  <span class="rr-mono">.streamDeckProfilesBackup</span>
                  file exported from RigReady or made by Stream Deck. Import it, then restore it
                  from the Backups tab. RigReady shows which profiles will be added before anything
                  changes.
                </p>
                <div class="setup-actions">
                  <v-btn
                    color="primary"
                    prepend-icon="mdi-file-import-outline"
                    :loading="busy"
                    data-testid="sd-setup-import"
                    @click="importFile"
                  >
                    Import a backup file
                  </v-btn>
                  <v-btn
                    variant="tonal"
                    to="/configure/stream-deck?tab=backups"
                    data-testid="sd-setup-backups"
                  >
                    Go to Backups{{
                      overview.backups.length ? ` (${overview.backups.length})` : ''
                    }}
                  </v-btn>
                </div>
              </template>
              <template v-else-if="step.id === 'plugins'">
                <template v-if="missingPlugins.length === 0">
                  <template v-if="expectedPlugins.length">
                    <p data-testid="sd-setup-expected">
                      "{{ overview.backups[0]!.name }}" uses these plugins. Plugins are never part
                      of a backup, so plan to install them once the profiles are back:
                    </p>
                    <div
                      v-for="use in expectedPlugins"
                      :key="use.pluginId"
                      class="setup-plugin"
                      data-testid="sd-setup-expected-plugin"
                    >
                      <div class="rr-row-main">
                        <div>{{ use.name }}</div>
                        <div class="rr-row-sub">
                          {{ plural(use.actions, 'action') }} ·
                          <span class="rr-mono">{{ use.pluginId }}</span>
                        </div>
                      </div>
                    </div>
                  </template>
                  <p v-else>Nothing to install yet.</p>
                </template>
                <template v-else>
                  <p>
                    Plugins are never part of a backup. Install these, then restart Stream Deck:
                  </p>
                  <div
                    v-for="plugin in missingPlugins"
                    :key="plugin.id"
                    class="setup-plugin"
                    data-testid="sd-setup-plugin"
                  >
                    <div class="rr-row-main">
                      <div>{{ plugin.name }}</div>
                      <div class="rr-row-sub">
                        {{ plural(plugin.actions, 'action') }} ·
                        <span class="rr-mono">{{ plugin.id }}</span>
                      </div>
                    </div>
                    <ExternalLink
                      v-if="plugin.source"
                      :url="plugin.source.url"
                      label="Get it"
                      variant="tonal"
                      testid="sd-setup-plugin-get"
                    />
                  </div>
                </template>
              </template>
              <template v-else-if="step.id === 'dcs'">
                <FindingList :findings="dcsFindings" />
              </template>
              <template v-else-if="step.id === 'start'">
                <v-btn
                  v-if="overview.status.installed"
                  color="primary"
                  prepend-icon="mdi-play"
                  :loading="busy"
                  data-testid="sd-setup-start"
                  @click="startApp"
                >
                  Start Stream Deck
                </v-btn>
                <p v-else>Install the app first.</p>
              </template>
              <template v-else-if="step.id === 'backup'">
                <p>Once everything works, make a backup so the next PC is quicker still.</p>
                <v-btn
                  variant="tonal"
                  to="/configure/stream-deck?tab=backups"
                  data-testid="sd-setup-backup"
                  >Go to Backups</v-btn
                >
              </template>
            </div>
          </div>
        </div>
      </div>
    </template>
    <PageSkeleton v-else-if="!error" label="Checking this PC…" :rows="5" />
  </div>
</template>

<style scoped>
.setup-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--rr-muted);
  text-decoration: none;
  margin-bottom: 8px;
}
.setup-back:hover {
  color: var(--rr-text);
}
.setup-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -12px 0 12px;
}
.setup-progress {
  margin-bottom: 8px;
}
.setup-step {
  display: flex;
  gap: 14px;
  padding: 16px;
  border-top: 1px solid var(--rr-border);
}
.setup-step:first-child {
  border-top: none;
}
.setup-mark {
  flex: 0 0 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid var(--rr-border);
  color: var(--rr-muted);
}
.setup-mark-done {
  border-color: var(--rr-ok);
  color: var(--rr-ok);
}
.setup-body {
  margin-top: 10px;
  font-size: 13.5px;
  line-height: 1.55;
}
.setup-body p {
  margin-bottom: 10px;
}
.setup-actions {
  display: flex;
  gap: 8px;
}
.setup-plugin {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}
</style>
