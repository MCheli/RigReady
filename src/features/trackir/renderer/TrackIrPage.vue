<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { trackIrContract, type TrackIrOverview } from '../contract';
import ExternalLink from './ExternalLink.vue';

const api = useClient(trackIrContract);
const view = ref<TrackIrOverview>();
const error = ref<string>();
const message = ref<string>();
const starting = ref(false);
const openMap = ref(new Set<string>());

async function load(): Promise<void> {
  const result = await api.overview();
  if (result.ok) {
    view.value = result.value;
    error.value = undefined;
  } else {
    error.value = errorText(result.error);
  }
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());

async function start(): Promise<void> {
  starting.value = true;
  error.value = undefined;
  const result = await api.start();
  starting.value = false;
  if (result.ok) message.value = result.value.message;
  else error.value = errorText(result.error);
  notifyMachineChanged();
}

function toggle(file: string): void {
  const next = new Set(openMap.value);
  if (next.has(file)) next.delete(file);
  else next.add(file);
  openMap.value = next;
}

const status = computed(() => view.value?.status);
const profiles = computed(() => view.value?.profiles);
const profileName = (file: string | undefined): string | undefined =>
  file
    ? (profiles.value?.profiles.find((p) => p.file.toLowerCase() === file.toLowerCase())?.name ??
      file)
    : undefined;
const shortVersion = (v: string | undefined): string | undefined =>
  v?.split('.').slice(0, 3).join('.');
const games = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'game' : 'games'}`;
</script>

<template>
  <div class="rr-page" data-testid="trackir-page">
    <h1 class="rr-page-title">TrackIR</h1>
    <p class="rr-page-sub">
      Head tracking: whether TrackIR is running and visible to games, and which profile each game
      gets.
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="tir-error">{{
      error
    }}</v-alert>
    <div v-if="message" class="tir-message rr-ok" data-testid="tir-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

    <template v-if="view && status && profiles">
      <div v-if="!status.installed" class="rr-panel tir-guide" data-testid="tir-install-guide">
        <div class="rr-row-title">Install TrackIR</div>
        <ol>
          <li>Download the TrackIR 5 software for Windows from NaturalPoint.</li>
          <li>Run the installer, then plug in the TrackIR camera.</li>
          <li>Start TrackIR once: it registers itself so games can find it.</li>
        </ol>
        <ExternalLink
          :url="view.downloadUrl"
          label="Open the TrackIR downloads page"
          variant="flat"
          testid="tir-download"
        />
      </div>

      <div class="tir-tiles">
        <div class="rr-panel tir-tile" data-testid="tir-tile-software">
          <div class="rr-section-title">Software</div>
          <template v-if="status.installed">
            <div
              class="tir-tile-main"
              :class="status.running ? 'rr-ok' : 'rr-warn'"
              data-testid="tir-running"
            >
              {{ status.running ? 'Running' : 'Not running' }}
            </div>
            <div class="rr-row-sub">
              TrackIR {{ shortVersion(status.version) ?? '(version unknown)' }}
            </div>
            <v-btn
              v-if="!status.running"
              size="small"
              color="primary"
              prepend-icon="mdi-play"
              class="tir-tile-btn"
              :loading="starting"
              data-testid="tir-start"
              @click="start"
            >
              Start TrackIR
            </v-btn>
          </template>
          <div v-else class="tir-tile-main rr-bad" data-testid="tir-running">Not installed</div>
        </div>
        <div class="rr-panel tir-tile" data-testid="tir-tile-camera">
          <div class="rr-section-title">Camera</div>
          <div
            class="tir-tile-main"
            :class="status.devices.length ? 'rr-ok' : 'rr-warn'"
            data-testid="tir-camera"
          >
            {{ status.devices.length ? 'Connected' : 'Not connected' }}
          </div>
          <div class="rr-row-sub">
            {{
              status.devices.length
                ? status.devices.map((d) => d.name).join(', ')
                : 'Plug in the TrackIR camera.'
            }}
          </div>
        </div>
        <div class="rr-panel tir-tile" data-testid="tir-tile-games">
          <div class="rr-section-title">Games can find it</div>
          <div
            class="tir-tile-main"
            :class="status.npClient.ok ? 'rr-ok' : 'rr-warn'"
            data-testid="tir-npclient"
          >
            {{ status.npClient.ok ? 'Yes' : 'No' }}
          </div>
          <div class="rr-row-sub">
            {{
              status.npClient.ok ? `Registered in ${status.npClient.path}` : status.npClient.problem
            }}
          </div>
        </div>
      </div>

      <h2 class="rr-section-title">Profiles</h2>
      <div
        v-if="profiles.profiles.length === 0"
        class="rr-panel rr-empty"
        data-testid="tir-profiles-empty"
      >
        No TrackIR profiles found.
        <div class="rr-row-sub">
          TrackIR creates them in <span class="rr-mono">{{ status.dataFolder }}</span> when it first
          runs.
        </div>
      </div>
      <div v-else class="rr-panel tir-block">
        <div
          v-for="p in profiles.profiles"
          :key="p.file"
          class="rr-row"
          data-testid="tir-profile"
          :data-file="p.file"
        >
          <v-icon icon="mdi-tune-variant" class="rr-muted" />
          <div class="rr-row-main">
            <div class="rr-row-title">{{ p.name }}</div>
            <div class="rr-row-sub">
              <span class="rr-mono">{{ p.file }}</span>
              <template v-if="p.description"> · {{ p.description }}</template>
            </div>
          </div>
          <span
            v-if="
              profiles.exclusiveProfile &&
              profiles.exclusiveProfile.toLowerCase() === p.file.toLowerCase()
            "
            class="tir-badge"
            data-testid="tir-exclusive"
            >Used for every game</span
          >
          <span
            v-else-if="
              profiles.lastProfile && profiles.lastProfile.toLowerCase() === p.file.toLowerCase()
            "
            class="tir-badge"
            data-testid="tir-last"
            >Last used</span
          >
        </div>
      </div>
      <div
        v-if="profiles.settingsFound"
        class="rr-row-sub tir-note-line"
        data-testid="tir-settings-note"
      >
        As last saved by TrackIR:
        <template v-if="profiles.exclusiveProfile">
          every game uses {{ profileName(profiles.exclusiveProfile) }} (exclusive profile).
        </template>
        <template v-else>
          {{ profileName(profiles.lastProfile) ?? 'no profile' }} when no game is running; games get
          the profile mapped below.
        </template>
        TrackIR may save this only when it quits, so it can lag behind what its window shows.
      </div>

      <h2 class="rr-section-title tir-section">Which profile each game gets</h2>
      <div v-if="!profiles.map.found" class="rr-panel rr-empty" data-testid="tir-map-empty">
        TrackIR has not saved a game-to-profile map on this PC yet.
      </div>
      <div v-else class="rr-panel tir-block" data-testid="tir-map">
        <div class="rr-row tir-map-sum">
          <div class="rr-row-main rr-row-sub">
            {{ games(profiles.map.games) }} in TrackIR's list, mapped to
            {{ profiles.map.byProfile.length }}
            {{ profiles.map.byProfile.length === 1 ? 'profile' : 'profiles' }}. Read-only here:
            TrackIR names games only in its own encrypted list, so they are shown by NaturalPoint
            game id.
          </div>
        </div>
        <div
          v-for="group in profiles.map.byProfile"
          :key="group.file"
          class="tir-map-group"
          data-testid="tir-map-group"
          :data-file="group.file"
        >
          <div class="rr-row">
            <v-btn
              :icon="openMap.has(group.file) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
              variant="text"
              size="small"
              density="comfortable"
              :aria-label="openMap.has(group.file) ? 'Hide the game ids' : 'Show the game ids'"
              data-testid="tir-map-toggle"
              @click="toggle(group.file)"
            />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ group.name ?? group.file }}</div>
              <div class="rr-row-sub">
                <span class="rr-mono">{{ group.file }}</span>
                <span v-if="!group.exists" class="rr-warn">
                  · this profile file is missing; TrackIR falls back to its default</span
                >
              </div>
            </div>
            <div class="rr-row-title">{{ games(group.gameIds.length) }}</div>
          </div>
          <div v-if="openMap.has(group.file)" class="tir-ids rr-mono" data-testid="tir-map-ids">
            {{ group.gameIds.join(', ') }}
          </div>
        </div>
      </div>

      <h2 class="rr-section-title tir-section">Switching profiles</h2>
      <div class="rr-panel tir-note" data-testid="tir-switch-note">
        TrackIR has no way for another program to switch its active profile, so RigReady does not
        offer one. Pick the profile in the TrackIR window, or map a game to a profile in TrackIR's
        Profiles window (the Titles tab): TrackIR then switches by itself when that game starts.
      </div>
    </template>
    <div v-else-if="!error" class="rr-panel rr-empty">Checking TrackIR…</div>
  </div>
</template>

<style scoped>
.tir-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -12px 0 12px;
}
.tir-guide {
  padding: 16px 20px;
  margin-bottom: 20px;
}
.tir-guide ol {
  padding-left: 20px;
  margin: 8px 0 12px;
  font-size: 13.5px;
  line-height: 1.7;
}
.tir-tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.tir-tile {
  padding: 14px 16px;
}
.tir-tile-main {
  font-size: 18px;
  font-weight: 600;
  margin: 2px 0;
}
.tir-tile-btn {
  margin-top: 10px;
}
.tir-block {
  margin-bottom: 8px;
}
.tir-badge {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--rr-surface-2);
  color: var(--rr-text);
}
.tir-note-line {
  margin-bottom: 8px;
}
.tir-section {
  margin-top: 24px;
}
.tir-map-group {
  border-top: 1px solid var(--rr-border);
}
.tir-map-group .rr-row {
  border-top: none;
}
.tir-map-sum {
  border-top: none;
}
.tir-ids {
  padding: 0 16px 12px 56px;
  color: var(--rr-muted);
  line-height: 1.6;
}
.tir-note {
  padding: 14px 16px;
  font-size: 13px;
  color: var(--rr-muted);
  line-height: 1.55;
}
</style>
