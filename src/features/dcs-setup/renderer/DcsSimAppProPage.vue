<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import type { ChangePreview } from '../../../shared/changePreview';
import { dcsSetupContract, type SimAppProState } from '../contract';
import {
  RUNTIME_FEATURE_LABELS,
  RUNTIME_FEATURES,
  type RuntimeFeature,
} from '../core/simAppProShared';

const api = useClient(dcsSetupContract);
const view = ref<SimAppProState>();
const error = ref<string>();
const message = ref<string>();
/** profile id -> features ticked on screen (saved when the user presses Save). */
const ticked = reactive<Record<string, RuntimeFeature[]>>({});

async function load(): Promise<void> {
  const result = await api.simAppPro();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  view.value = result.value;
  for (const p of result.value.profiles) ticked[p.id] = [...p.features];
}

let off: (() => void) | undefined;
onMounted(() => {
  off = onMachineChanged(() => void load());
  return load();
});
onBeforeUnmount(() => off?.());

const same = (a: RuntimeFeature[], b: RuntimeFeature[]): boolean =>
  a.length === b.length && a.every((f) => b.includes(f));

async function save(profileId: string): Promise<void> {
  error.value = undefined;
  const result = await api.setRuntimeFeatures({ profileId, features: ticked[profileId] ?? [] });
  if (result.ok) message.value = result.value.message;
  else error.value = errorText(result.error);
  await load();
}

/** The restore waiting for a yes, with the files it would write. */
const restoring = ref(false);
const restoreBusy = ref(false);
const restorePreview = ref<ChangePreview>();
const restorePreviewError = ref<string>();

async function askRestore(): Promise<void> {
  restorePreview.value = undefined;
  restorePreviewError.value = undefined;
  restoring.value = true;
  const result = await api.restoreManagedPreview();
  if (result.ok) restorePreview.value = result.value;
  else restorePreviewError.value = errorText(result.error);
}

async function restore(): Promise<void> {
  error.value = undefined;
  restoreBusy.value = true;
  const result = await api.restoreManaged();
  restoreBusy.value = false;
  restoring.value = false;
  if (result.ok) {
    message.value = result.value.message;
    notifyMachineChanged();
  } else error.value = errorText(result.error);
  await load();
}

const REPLACED = [
  {
    what: 'MFD screen layout',
    before: 'Writes wwtMonitor.lua into the DCS install folder, where a DCS repair can delete it.',
    now: "Writes RigReady.lua in Saved Games from your monitor layout, per aircraft, with bezel crop. It can start from SimAppPro's plan.",
    to: '/configure/dcs/screens',
    link: 'Screens',
  },
  {
    what: 'Resolution and monitor setup in options.lua',
    before: 'Rewrites the graphics keys whenever its wizard is applied.',
    now: 'Changes only the keys needed, with a backup and the change spelled out, and never while DCS runs.',
    to: '/configure/dcs/screens',
    link: 'Screens',
  },
  {
    what: 'Export.lua',
    before: 'Adds its own line on every start and moves it to the top.',
    now: "Adds or removes any tool's line (WinWing, DCS-BIOS, DCS-ExportScript, SRS, Tacview, Helios) and notices when another program changes the file.",
    to: '/configure/dcs/export',
    link: 'Export.lua',
  },
  {
    what: 'Turning the MFD screens portrait and placing them',
    before: 'Part of its MFD wizard.',
    now: 'A setup remembers the whole monitor layout, and Make ready puts it back before you fly.',
    to: '/configure/displays',
    link: 'Monitors',
  },
];
const STATUS = {
  unchanged: { icon: 'mdi-check-circle', tone: 'rr-ok', text: 'As RigReady left it' },
  changed: { icon: 'mdi-alert', tone: 'rr-warn', text: 'Changed outside RigReady' },
  missing: { icon: 'mdi-alert', tone: 'rr-warn', text: 'Deleted' },
  notManaged: { icon: 'mdi-circle-outline', tone: 'rr-muted', text: '' },
} as const;
</script>

<template>
  <div data-testid="dcs-simapppro">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="sap-error">{{
      error
    }}</v-alert>
    <div v-if="message" class="sap-message rr-ok" data-testid="sap-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>
    <PageSkeleton v-if="!view && !error" label="Looking for SimAppPro…" />

    <template v-else-if="view && view.dcsFound === false">
      <NotOnThisPc
        name="DCS World"
        :looked="['every Steam library', 'the standalone install folders', 'Saved Games\\DCS']"
        game-page="/configure/games/dcs"
        data-testid="dcs-not-found"
      />
      <p class="rr-row-sub sap-without-dcs" data-testid="sap-without-dcs">
        This tab lists what RigReady does for DCS in place of SimAppPro, and which setups still need
        SimAppPro running. It has nothing to show until DCS is here.
        {{
          view.installed
            ? `SimAppPro ${view.version ?? ''} is installed on this PC.`
            : 'SimAppPro is not installed on this PC either.'
        }}
      </p>
    </template>

    <template v-else-if="view">
      <div class="rr-panel sap-status" data-testid="sap-status">
        <v-icon icon="mdi-lightbulb-on-outline" size="26" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title">
            <template v-if="view.installed"
              >SimAppPro {{ view.version ?? '' }} is installed</template
            >
            <template v-else>SimAppPro is not installed</template>
          </div>
          <div class="rr-row-sub">
            <template v-if="view.installed">
              {{ view.running ? 'Running now.' : 'Not running now.' }}
              RigReady reads only its MFD screen plan. Its settings file, which holds your WinWing
              account password, is never read or backed up.
            </template>
            <template v-else>RigReady configures DCS without it.</template>
          </div>
        </div>
      </div>

      <h2 class="rr-section-title">What RigReady does instead</h2>
      <div class="rr-panel sap-table" data-testid="sap-replaced">
        <div v-for="row in REPLACED" :key="row.what" class="sap-row">
          <div class="sap-what rr-row-title">{{ row.what }}</div>
          <div class="sap-before rr-row-sub">{{ row.before }}</div>
          <div class="sap-now">
            {{ row.now }}
            <router-link :to="row.to" class="sap-link">{{ row.link }}</router-link>
          </div>
        </div>
      </div>

      <h2 class="rr-section-title">What still needs SimAppPro running</h2>
      <div class="rr-panel sap-needs">
        <p>
          These talk to the WinWing hardware with WinWing's own protocol while you fly. Until
          RigReady can do that itself, a setup that uses them checks that SimAppPro is running and
          starts it with Make ready. Setups that use none never ask for it.
        </p>
        <div v-if="view.profiles.length === 0" class="rr-muted" data-testid="sap-no-profiles">
          There are no DCS setups yet.
          <router-link to="/configure/profiles/capture">Create one from this rig</router-link>.
        </div>
        <div
          v-for="profile in view.profiles"
          :key="profile.id"
          class="sap-profile"
          data-testid="sap-profile"
          :data-profile="profile.id"
        >
          <div class="sap-profile-name">
            <div class="rr-row-title">{{ profile.name }}</div>
            <div class="rr-row-sub">
              {{
                profile.features.length
                  ? 'Checks that SimAppPro is running'
                  : 'Does not need SimAppPro'
              }}
            </div>
          </div>
          <v-checkbox
            v-for="feature in RUNTIME_FEATURES"
            :key="feature"
            v-model="ticked[profile.id]"
            :value="feature"
            :label="RUNTIME_FEATURE_LABELS[feature]"
            density="compact"
            hide-details
            :data-testid="`sap-feature-${profile.id}-${feature}`"
          />
          <v-btn
            size="small"
            variant="tonal"
            :disabled="same(ticked[profile.id] ?? [], profile.features)"
            :data-testid="`sap-save-${profile.id}`"
            @click="save(profile.id)"
          >
            Save
          </v-btn>
        </div>
      </div>

      <h2 class="rr-section-title">DCS files RigReady manages</h2>
      <div class="rr-panel" data-testid="sap-managed">
        <template v-for="file in view.managed" :key="file.label">
          <div v-if="file.status === 'notManaged'" class="rr-row rr-muted">
            RigReady has not set up any DCS file yet. Once it has, it watches them here and on the
            Play screen, so you notice when SimAppPro or an installer changes them.
          </div>
          <div
            v-else
            class="rr-row sap-file"
            data-testid="sap-managed-file"
            :data-status="file.status"
          >
            <v-icon :icon="STATUS[file.status].icon" :class="STATUS[file.status].tone" size="20" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ file.label }}</div>
              <div class="rr-row-sub" :class="file.status === 'unchanged' ? '' : 'rr-warn'">
                {{ STATUS[file.status].text }}
              </div>
              <ul v-if="file.details.length" class="sap-details">
                <li v-for="d in file.details" :key="d">{{ d }}</li>
              </ul>
            </div>
          </div>
        </template>
        <div
          v-if="view.managed.some((m) => m.status === 'changed' || m.status === 'missing')"
          class="sap-restore"
        >
          <span class="rr-row-sub">
            SimAppPro rewrites Export.lua when it starts, and options.lua when its MFD wizard is
            applied.
          </span>
          <v-btn color="primary" size="small" data-testid="sap-restore" @click="askRestore">
            Restore RigReady's version…
          </v-btn>
        </div>
      </div>
    </template>

    <ConfirmChanges
      :open="restoring"
      title="Restore RigReady's version of these DCS files?"
      confirm-text="Restore"
      :preview="restorePreview"
      :error="restorePreviewError"
      :busy="restoreBusy"
      testid="sap-restore"
      @cancel="restoring = false"
      @confirm="restore"
    >
      RigReady puts back what it last set: its screen setup file, the options.lua keys that select
      it, and the Export.lua lines of the tools it added. Lines other tools added to Export.lua
      stay.
    </ConfirmChanges>
  </div>
</template>

<style scoped>
.sap-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -12px 0 12px;
}
.sap-without-dcs {
  margin-top: 12px;
  text-align: center;
}
.sap-status {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  margin-bottom: 24px;
}
.sap-table {
  margin-bottom: 24px;
}
.sap-row {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) minmax(0, 1.3fr);
  gap: 16px;
  padding: 12px 16px;
  border-top: 1px solid var(--rr-border);
  font-size: 13px;
}
.sap-row:first-child {
  border-top: none;
}
.sap-link {
  margin-left: 4px;
  white-space: nowrap;
}
.sap-needs {
  padding: 14px 16px;
  margin-bottom: 24px;
  font-size: 13.5px;
}
.sap-needs p {
  margin: 0 0 12px;
  color: var(--rr-muted);
}
.sap-profile {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 0;
  border-top: 1px solid var(--rr-border);
  flex-wrap: wrap;
}
.sap-profile-name {
  flex: 1 1 200px;
}
.sap-file {
  align-items: flex-start;
}
.sap-details {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.sap-restore {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--rr-border);
}
</style>
