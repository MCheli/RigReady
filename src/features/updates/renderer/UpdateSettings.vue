<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useUpdatesStore } from './store';

/** Settings > Updates: the automatic switch, the channel, and what the updater is doing. */
const store = useUpdatesStore();
onMounted(() => void store.load());

const status = computed(() => store.status);
const channelName = computed(() => (status.value?.channel === 'beta' ? 'beta' : 'stable'));
const channels = [
  { title: 'Stable: released versions', value: 'stable' },
  { title: 'Beta: new versions earlier, rougher', value: 'beta' },
];

const checkedAt = computed(() => {
  const at = status.value?.checkedAt;
  if (!at) return '';
  const time = new Date(at);
  return ` Checked ${time.toLocaleDateString()} ${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
});

/** One line that says where things are, with an icon so it never rests on colour. */
const line = computed((): { icon: string; tone: string; text: string } => {
  const s = status.value;
  if (!s) return { icon: 'mdi-dots-horizontal', tone: 'rr-muted', text: 'Reading…' };
  switch (s.phase) {
    case 'unsupported':
      return {
        icon: 'mdi-information-outline',
        tone: 'rr-muted',
        text: s.message ?? 'Updates are not available in this run.',
      };
    case 'checking':
      return { icon: 'mdi-cloud-search-outline', tone: 'rr-muted', text: 'Checking for updates…' };
    case 'upToDate':
      return {
        icon: 'mdi-check-circle-outline',
        tone: 'rr-ok',
        text: `RigReady ${s.currentVersion} is the newest version on the ${channelName.value} channel.${checkedAt.value}`,
      };
    case 'noRelease':
      return {
        icon: 'mdi-information-outline',
        tone: 'rr-muted',
        text: `Nothing has been published on the ${channelName.value} channel yet.${checkedAt.value}`,
      };
    case 'downloading':
      return {
        icon: 'mdi-download-outline',
        tone: 'rr-muted',
        text: `Version ${s.version} is being downloaded in the background… ${s.percent ?? 0}%`,
      };
    case 'ready':
      if (s.blockedBy) {
        return {
          icon: 'mdi-alert-outline',
          tone: 'rr-warn',
          text: `${s.blockedBy} is running, so version ${s.version} was not installed. Nothing is installed while a game is running. Quit the game first.`,
        };
      }
      return {
        icon: 'mdi-download-circle-outline',
        tone: 'rr-ok',
        text: s.installsOnQuit
          ? `Version ${s.version} is downloaded. It is installed when you restart RigReady here, or the next time you quit it.`
          : `Version ${s.version} is downloaded. It is installed when you restart RigReady here.`,
      };
    case 'installing':
      return {
        icon: 'mdi-restart',
        tone: 'rr-muted',
        text: `Restarting to install version ${s.version}…`,
      };
    case 'error':
      return {
        icon: 'mdi-alert-circle-outline',
        tone: 'rr-warn',
        text: `${s.message ?? 'Could not check for updates.'}${checkedAt.value}`,
      };
    default:
      return {
        icon: 'mdi-update',
        tone: 'rr-muted',
        text: s.automatic ? 'Not checked yet in this session.' : 'Automatic checks are off.',
      };
  }
});

const busy = computed(
  () => status.value?.phase === 'checking' || status.value?.phase === 'downloading'
);
</script>

<template>
  <div data-testid="updates-section" :data-phase="status?.phase ?? 'loading'">
    <div class="rr-row">
      <div class="rr-row-main">
        <div class="rr-row-title">Check for updates automatically</div>
        <div class="rr-row-sub">
          At start and once a day. A new version downloads in the background and is installed when
          you say so or when you quit RigReady, never in the middle of a session and never while a
          game is running.
        </div>
      </div>
      <v-switch
        :model-value="status?.automatic ?? true"
        :disabled="!status"
        data-testid="update-automatic"
        aria-label="Check for updates automatically"
        @update:model-value="store.setAutomatic($event === true)"
      />
    </div>
    <div class="rr-row">
      <div class="rr-row-main">
        <div class="rr-row-title">Channel</div>
        <div class="rr-row-sub">Which versions this PC is offered.</div>
      </div>
      <v-select
        class="update-channel"
        :items="channels"
        :model-value="status?.channel ?? 'stable'"
        :disabled="!status"
        data-testid="update-channel"
        aria-label="Update channel"
        @update:model-value="store.setChannel($event === 'beta' ? 'beta' : 'stable')"
      />
    </div>
    <div class="rr-row">
      <v-icon :icon="line.icon" :class="line.tone" />
      <div class="rr-row-main">
        <div class="rr-row-title" data-testid="update-status">{{ line.text }}</div>
        <div v-if="status?.notes && status.phase === 'ready'" class="rr-row-sub">
          {{ status.notes }}
        </div>
        <div v-if="store.error" class="rr-row-sub rr-bad" data-testid="update-error">
          <v-icon icon="mdi-alert-circle-outline" size="14" /> {{ store.error }}
        </div>
      </div>
      <v-btn
        v-if="status?.phase === 'ready'"
        color="primary"
        data-testid="update-install"
        @click="store.install()"
      >
        Restart to install
      </v-btn>
      <v-btn
        v-else-if="status && status.phase !== 'unsupported' && status.phase !== 'installing'"
        variant="text"
        :disabled="busy"
        data-testid="update-check"
        @click="store.check()"
      >
        Check now
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.update-channel {
  max-width: 360px;
}
</style>
