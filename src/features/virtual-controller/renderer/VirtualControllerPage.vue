<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import EmptyState from '../../../renderer/components/EmptyState.vue';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { virtualControllerContract, type ProfileSummary, type VcState } from '../contract';
import { PART_LABELS } from '../core/profile';
import ExternalLink from './ExternalLink.vue';

const api = useClient(virtualControllerContract);
const router = useRouter();
const view = ref<VcState>();
const error = ref<string>();
const message = ref<string>();
const busy = ref<string>();
const hide = ref(false);
const deleting = ref<ProfileSummary>();

async function load(): Promise<void> {
  const result = await api.state();
  if (result.ok) {
    view.value = result.value;
    error.value = undefined;
  } else {
    error.value = errorText(result.error);
  }
}

let offMachine: (() => void) | undefined;
let offChanged: (() => void) | undefined;
onMounted(() => {
  void load();
  offMachine = onMachineChanged(() => void load());
  offChanged = api.on('changed', () => void load());
});
onBeforeUnmount(() => {
  offMachine?.();
  offChanged?.();
});

const driverReady = computed(() => view.value?.driver.installed && view.value.driver.running);
const kindName = (kind: string): string => (kind === 'ds4' ? 'DualShock 4' : 'Xbox 360 controller');
const parts = (list: string[]): string => list.map((p) => PART_LABELS[p] ?? p).join(', ');

async function start(profile: ProfileSummary): Promise<void> {
  busy.value = `start:${profile.id}`;
  error.value = undefined;
  message.value = undefined;
  const result = await api.start({ id: profile.id, hide: hide.value });
  busy.value = undefined;
  if (result.ok) message.value = `Virtual controller on: ${result.value.profileName}`;
  else error.value = errorText(result.error);
  notifyMachineChanged();
  await load();
}

async function stop(): Promise<void> {
  busy.value = 'stop';
  error.value = undefined;
  message.value = undefined;
  const result = await api.stop();
  busy.value = undefined;
  if (result.ok) message.value = result.value.message ?? 'No virtual controller was running';
  else error.value = errorText(result.error);
  notifyMachineChanged();
  await load();
}

async function copy(profile: ProfileSummary): Promise<void> {
  busy.value = `copy:${profile.id}`;
  error.value = undefined;
  const name = profile.name.replace(/\s*\(.*\)\s*$/, '') || profile.name;
  const result = await api.copy({ from: profile.id, name: `My ${name.toLowerCase()}` });
  busy.value = undefined;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  await router.push(`/configure/virtual-controller/edit?id=${encodeURIComponent(result.value.id)}`);
}

async function remove(): Promise<void> {
  const profile = deleting.value;
  if (!profile) return;
  busy.value = `remove:${profile.id}`;
  const result = await api.remove({ id: profile.id });
  busy.value = undefined;
  deleting.value = undefined;
  if (result.ok) message.value = `Deleted ${profile.name}`;
  else error.value = errorText(result.error);
  await load();
}

function edit(profile: ProfileSummary): void {
  void router.push(`/configure/virtual-controller/edit?id=${encodeURIComponent(profile.id)}`);
}

/** Why Start cannot be pressed for a profile, or undefined when it can. */
function cannotStart(profile: ProfileSummary): string | undefined {
  if (!view.value?.driver.installed) return 'Install the ViGEmBus driver first.';
  if (view.value.running?.profileId === profile.id) return 'It is running now.';
  if (!view.value.driver.running) return 'The ViGEmBus driver is not running.';
  if (profile.mapped === 0) return 'Nothing is mapped yet: edit it first.';
  if (profile.missing.length >= profile.mapped) return 'None of its controllers is connected.';
  return undefined;
}
</script>

<template>
  <div class="rr-page" data-testid="vc-page">
    <h1 class="rr-page-title">Virtual controller</h1>
    <p class="rr-page-sub">
      For games and emulators that read only a gamepad: RigReady plugs in a virtual Xbox 360
      controller or DualShock 4 and drives it from your stick, wheel, pedals or throttle.
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="vc-error">{{
      error
    }}</v-alert>
    <div v-if="message" class="vc-message rr-ok" data-testid="vc-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

    <template v-if="view">
      <div class="vc-tiles">
        <div class="rr-panel vc-tile" data-testid="vc-driver">
          <div class="rr-section-title">Driver (ViGEmBus)</div>
          <div
            class="vc-tile-main"
            :class="driverReady ? 'rr-ok' : 'rr-bad'"
            data-testid="vc-driver-state"
          >
            <v-icon :icon="driverReady ? 'mdi-check-circle' : 'mdi-close-circle'" size="18" />
            {{
              driverReady ? 'Installed' : view.driver.installed ? 'Not running' : 'Not installed'
            }}
          </div>
          <div class="rr-row-sub">
            {{
              driverReady
                ? 'Games can be given a virtual controller.'
                : 'Needed for a virtual controller. You install it; RigReady never installs drivers.'
            }}
          </div>
        </div>
        <div class="rr-panel vc-tile" data-testid="vc-hidhide">
          <div class="rr-section-title">Hiding the real controllers (HidHide)</div>
          <div
            class="vc-tile-main"
            :class="view.hidHide.installed ? 'rr-ok' : 'rr-muted'"
            data-testid="vc-hidhide-state"
          >
            <v-icon
              :icon="view.hidHide.installed ? 'mdi-check-circle' : 'mdi-minus-circle-outline'"
              size="18"
            />
            {{ view.hidHide.installed ? 'Installed' : 'Not installed' }}
          </div>
          <div class="rr-row-sub">
            {{
              view.hidHide.installed
                ? 'A game that reads every controller can be kept from seeing them twice.'
                : 'Optional. Without it, the real controllers stay visible to games as well.'
            }}
          </div>
        </div>
      </div>

      <div v-if="!view.driver.installed" class="rr-panel vc-guide" data-testid="vc-install-guide">
        <div class="rr-row-title">Install the ViGEmBus driver</div>
        <ol>
          <li>
            Open the ViGEmBus releases page and download the setup of the newest release (1.22.0, by
            Nefarius Software Solutions). The project is retired but its signed driver still
            installs and works on Windows 10 and 11.
          </li>
          <li>Run it. Windows asks for administrator rights; that is the setup, not RigReady.</li>
          <li>Restart Windows if it asks you to, then come back to this page.</li>
        </ol>
        <ExternalLink
          :url="view.driver.downloadUrl"
          label="Open the ViGEmBus releases page"
          variant="flat"
          testid="vc-download"
        />
      </div>

      <div v-if="view.running" class="rr-panel vc-running" data-testid="vc-running">
        <div class="rr-row">
          <v-icon icon="mdi-controller" class="rr-ok" />
          <div class="rr-row-main">
            <div class="rr-row-title rr-ok" data-testid="vc-running-title">
              On: {{ view.running.profileName }} ({{ kindName(view.running.kind) }})
            </div>
            <div class="rr-row-sub" data-testid="vc-running-from">
              Driven by {{ view.running.controllers.join(', ') || 'no controller' }}.
              {{
                view.running.by === 'setup'
                  ? `Started by the setup ${view.running.setup ?? ''}; Stand down stops it.`
                  : 'Started by hand; it runs until you stop it or quit RigReady.'
              }}
            </div>
            <div
              v-if="view.running.hidden.length"
              class="rr-row-sub"
              data-testid="vc-running-hidden"
            >
              Hidden from games: {{ view.running.hidden.join(', ') }}.
            </div>
            <div
              v-if="view.running.notHidden.length"
              class="rr-row-sub rr-warn"
              data-testid="vc-running-not-hidden"
            >
              <v-icon icon="mdi-alert" size="14" /> HidHide does not list
              {{ view.running.notHidden.join(', ') }}, so games still see
              {{ view.running.notHidden.length === 1 ? 'it' : 'them' }}.
            </div>
            <div
              v-if="view.running.missing.length"
              class="rr-row-sub rr-warn"
              data-testid="vc-running-missing"
            >
              <v-icon icon="mdi-alert" size="14" /> Not connected:
              {{ parts(view.running.missing) }}.
            </div>
          </div>
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-stop"
            :loading="busy === 'stop'"
            data-testid="vc-stop"
            @click="stop"
            >Stop</v-btn
          >
        </div>
      </div>

      <h2 class="rr-section-title">Your profiles</h2>
      <EmptyState
        v-if="view.profiles.mine.length === 0"
        art="device"
        title="No profiles of your own yet"
        data-testid="vc-mine-empty"
      >
        Make a copy of a starting point below, then press or move your own control for each part.
      </EmptyState>
      <div v-else class="rr-panel">
        <v-checkbox
          v-model="hide"
          density="compact"
          hide-details
          class="vc-hide"
          :disabled="!view.hidHide.installed"
          label="Hide the real controllers from games while it runs (HidHide)"
          data-testid="vc-hide"
        />
        <div v-if="!view.hidHide.installed" class="rr-row-sub vc-hide-why">
          Needs HidHide, which is not installed.
          <ExternalLink
            :url="view.hidHide.downloadUrl"
            label="HidHide releases"
            variant="text"
            testid="vc-hidhide-download"
          />
        </div>
        <div
          v-for="p in view.profiles.mine"
          :key="p.id"
          class="rr-row"
          data-testid="vc-profile"
          :data-id="p.id"
        >
          <v-icon icon="mdi-tune-variant" class="rr-muted" />
          <div class="rr-row-main">
            <div class="rr-row-title">{{ p.name }}</div>
            <div class="rr-row-sub">
              {{ kindName(p.kind) }} · {{ p.mapped }} {{ p.mapped === 1 ? 'part' : 'parts' }} mapped
              <span v-if="p.missing.length" class="rr-warn" data-testid="vc-profile-missing">
                · <v-icon icon="mdi-alert" size="13" /> not connected: {{ parts(p.missing) }}</span
              >
            </div>
            <div v-if="cannotStart(p)" class="rr-row-sub" data-testid="vc-profile-why">
              {{ cannotStart(p) }}
            </div>
          </div>
          <v-btn
            size="small"
            color="primary"
            prepend-icon="mdi-play"
            :disabled="cannotStart(p) !== undefined"
            :loading="busy === `start:${p.id}`"
            data-testid="vc-start"
            @click="start(p)"
            >Start</v-btn
          >
          <v-btn size="small" variant="tonal" data-testid="vc-edit" @click="edit(p)">Edit</v-btn>
          <v-btn
            size="small"
            variant="text"
            icon="mdi-delete-outline"
            :aria-label="`Delete ${p.name}`"
            data-testid="vc-delete"
            @click="deleting = p"
          />
        </div>
      </div>

      <h2 class="rr-section-title vc-section">Starting points</h2>
      <div class="rr-panel">
        <div
          v-for="p in view.profiles.builtin"
          :key="p.id"
          class="rr-row"
          data-testid="vc-builtin"
          :data-id="p.id"
        >
          <v-icon icon="mdi-star-four-points-outline" class="rr-muted" />
          <div class="rr-row-main">
            <div class="rr-row-title">{{ p.name }}</div>
            <div class="rr-row-sub">{{ p.description }}</div>
          </div>
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-content-copy"
            :loading="busy === `copy:${p.id}`"
            data-testid="vc-copy"
            @click="copy(p)"
            >Make a copy</v-btn
          >
        </div>
      </div>

      <h2 class="rr-section-title vc-section">Using it</h2>
      <div class="rr-panel vc-note" data-testid="vc-using">
        A profile belongs to no game. Start one here, from the tray or the command palette for any
        program that reads a standard controller, or add the step "Start a virtual controller" to a
        setup's steps before launch: Stand down then stops it. In an emulator, choose the "Xbox 360
        controller" (XInput) or "DualShock 4" as the pad and map it once in the emulator.
      </div>

      <div
        v-if="view.inputError"
        class="rr-row-sub rr-warn vc-section"
        data-testid="vc-input-error"
      >
        <v-icon icon="mdi-alert" size="14" /> The controllers could not be read:
        {{ view.inputError }}
      </div>
    </template>
    <PageSkeleton v-else-if="!error" label="Checking the virtual controller…" />

    <v-dialog
      :model-value="deleting !== undefined"
      max-width="440"
      @update:model-value="deleting = undefined"
    >
      <v-card data-testid="vc-delete-confirm">
        <v-card-title>Delete {{ deleting?.name }}?</v-card-title>
        <v-card-text
          >The profile is removed from RigReady. Setups that start it will fail.</v-card-text
        >
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="vc-delete-cancel" @click="deleting = undefined"
            >Cancel</v-btn
          >
          <v-btn color="error" data-testid="vc-delete-go" @click="remove">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.vc-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -12px 0 12px;
}
.vc-tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.vc-tile {
  padding: 14px 16px;
}
.vc-tile-main {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 18px;
  font-weight: 600;
  margin: 2px 0;
}
.vc-guide {
  padding: 16px 20px;
  margin-bottom: 20px;
}
.vc-guide ol {
  padding-left: 20px;
  margin: 8px 0 12px;
  font-size: 13.5px;
  line-height: 1.7;
}
.vc-running {
  margin-bottom: 20px;
}
.vc-hide {
  padding: 6px 12px 0;
}
.vc-hide-why {
  padding: 0 16px 8px;
}
.vc-section {
  margin-top: 24px;
}
.vc-note {
  padding: 14px 16px;
  font-size: 13.5px;
  line-height: 1.6;
}
</style>
