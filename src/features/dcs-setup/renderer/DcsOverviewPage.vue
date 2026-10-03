<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { dcsSetupContract, type Overview } from '../contract';

const api = useClient(dcsSetupContract);
const view = ref<Overview>();
const error = ref<string>();
const message = ref<string>();
const showAllAircraft = ref(false);

async function load(): Promise<void> {
  const result = await api.overview();
  if (result.ok) {
    view.value = result.value;
    error.value = undefined;
  } else error.value = errorText(result.error);
}

async function markVerified(): Promise<void> {
  message.value = undefined;
  const result = await api.markVerified();
  if (result.ok) {
    message.value = result.value.message;
    await load();
  } else error.value = errorText(result.error);
}

let off: (() => void) | undefined;
onMounted(() => {
  off = onMachineChanged(() => {
    // Something else changed the machine: an earlier confirmation may no longer describe it.
    message.value = undefined;
    void load();
  });
  return load();
});
onBeforeUnmount(() => off?.());

const install = computed(() => view.value?.installs[0]);
const changedSinceVerified = computed(
  () =>
    view.value?.verified !== undefined &&
    install.value?.version !== undefined &&
    view.value.verified.version !== install.value.version
);
const AUTHOR = {
  rigready: 'made by RigReady',
  simapppro: 'made by SimAppPro',
  dcs: 'comes with DCS',
  other: 'made by hand or another tool',
} as const;

const aircraft = computed(() => {
  const all = view.value?.aircraft ?? [];
  // Aircraft with bindings first: those are the ones flown.
  const sorted = [...all].sort(
    (a, b) => Number(b.hasBindings) - Number(a.hasBindings) || a.label.localeCompare(b.label)
  );
  return showAllAircraft.value ? sorted : sorted.slice(0, 12);
});

const when = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
const launchLine = (launch: { exe: string; args: string[] }): string =>
  [launch.exe, ...launch.args].join(' ');
</script>

<template>
  <div data-testid="dcs-overview">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <div v-if="message" class="dcs-message rr-ok" data-testid="dcs-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

    <div v-if="!view && !error" class="rr-empty">Looking for DCS…</div>

    <div v-else-if="view && !view.found" class="rr-panel rr-empty" data-testid="dcs-not-found">
      <v-icon icon="mdi-airplane-off" size="40" class="mb-3" />
      <h2 class="rr-page-title">DCS World was not found</h2>
      <p>{{ view.problem }}</p>
      <p class="rr-row-sub">
        RigReady looks in every Steam library and for standalone installs. Once DCS is installed and
        has run once, this page fills in by itself.
      </p>
    </div>

    <template v-else-if="view">
      <v-alert
        v-if="view.dcsRunning"
        type="info"
        variant="tonal"
        class="mb-4"
        data-testid="dcs-running"
      >
        DCS is running. RigReady will not change DCS files until it closes: DCS rewrites options.lua
        when it exits.
      </v-alert>
      <v-alert
        v-if="view.managedChanged.length"
        type="warning"
        variant="tonal"
        class="mb-4"
        data-testid="dcs-managed-changed"
      >
        {{ view.managedChanged.join(' and ') }}
        {{ view.managedChanged.length === 1 ? 'was' : 'were' }} changed outside RigReady since
        RigReady set {{ view.managedChanged.length === 1 ? 'it' : 'them' }} up.
        <router-link to="/configure/dcs/simapppro">See what changed</router-link>
      </v-alert>

      <div class="dcs-grid">
        <section class="rr-panel dcs-card" data-testid="dcs-card-install">
          <header class="dcs-card-head">
            <v-icon icon="mdi-download-circle-outline" size="20" class="rr-muted" />
            <h2>Install</h2>
            <v-spacer />
            <span
              v-if="install?.updatePending"
              class="dcs-chip rr-warn"
              data-testid="dcs-update-pending"
            >
              <v-icon icon="mdi-alert" size="14" /> Update waiting in Steam
            </span>
            <span v-else-if="install?.version" class="dcs-chip rr-ok">
              <v-icon icon="mdi-check" size="14" /> Up to date
            </span>
          </header>
          <div v-if="install" class="dcs-facts">
            <div><span>Edition</span>{{ install.source === 'steam' ? 'Steam' : 'Standalone' }}</div>
            <div>
              <span>Folder</span><span class="rr-mono">{{ install.installDir }}</span>
            </div>
            <div v-if="install.version" data-testid="dcs-version">
              <span>Version</span>{{ install.version }}
            </div>
            <div v-if="view.lastRun"><span>Last run</span>{{ view.lastRun }}</div>
            <div v-if="install.launch">
              <span>Launch</span><span class="rr-mono">{{ launchLine(install.launch) }}</span>
            </div>
          </div>
          <p v-if="install?.updatePending" class="dcs-note">
            Steam will download the update before DCS starts. Launching through RigReady goes
            through Steam, so it is applied first.
          </p>
          <div v-if="view.installs.length > 1" class="dcs-note">
            Also installed:
            <span v-for="other in view.installs.slice(1)" :key="other.installDir" class="rr-mono">
              {{ other.installDir }}
            </span>
          </div>
          <div class="dcs-sub-title">Saved Games</div>
          <div v-for="folder in view.userFolders" :key="folder.path" class="dcs-folder">
            <span class="rr-mono">{{ folder.label }}</span>
            <span v-if="folder.orphaned" class="dcs-tag" data-testid="dcs-orphaned"
              >no install uses it</span
            >
          </div>
          <div class="dcs-verify">
            <div v-if="changedSinceVerified" class="rr-warn" data-testid="dcs-changed-since">
              <v-icon icon="mdi-alert" size="15" /> DCS changed since you confirmed it works ({{
                view.verified?.version
              }}
              → {{ install?.version }})
            </div>
            <div v-else-if="view.verified" class="rr-row-sub">
              Confirmed working: {{ view.verified.version }} on {{ when(view.verified.at) }}
            </div>
            <div v-else class="rr-row-sub">
              After a flight that went well, remember this version so RigReady can tell you when DCS
              changes.
            </div>
            <v-btn
              v-if="install?.version && (changedSinceVerified || !view.verified)"
              size="small"
              variant="tonal"
              data-testid="dcs-mark-verified"
              @click="markVerified"
            >
              This version works
            </v-btn>
          </div>
        </section>

        <section class="rr-panel dcs-card" data-testid="dcs-card-screens">
          <header class="dcs-card-head">
            <v-icon icon="mdi-monitor-multiple" size="20" class="rr-muted" />
            <h2>Screens</h2>
            <v-spacer />
            <span
              v-if="view.monitorSetup.problems.length"
              class="dcs-chip rr-warn"
              data-testid="dcs-screens-status"
            >
              <v-icon icon="mdi-alert" size="14" /> Does not fit the monitors
            </span>
            <span v-else class="dcs-chip rr-ok" data-testid="dcs-screens-status">
              <v-icon icon="mdi-check" size="14" /> Fits the monitors
            </span>
          </header>
          <p v-if="view.monitorSetup.file" class="dcs-lead">
            DCS uses <strong>{{ view.monitorSetup.file.name }}</strong>
            <span class="rr-muted">
              ({{ view.monitorSetup.file.stem }}.lua,
              {{ AUTHOR[view.monitorSetup.file.author] }})</span
            >
          </p>
          <p v-else-if="view.monitorSetup.option" class="dcs-lead">
            DCS is set to use "{{ view.monitorSetup.option }}", which does not exist.
          </p>
          <p v-else class="dcs-lead">DCS uses its default: one screen, no cockpit displays.</p>
          <div v-if="view.monitorSetup.file" class="dcs-chips">
            <span v-for="v in view.monitorSetup.file.exports" :key="v.name" class="dcs-tag">{{
              v.name
            }}</span>
          </div>
          <ul v-if="view.monitorSetup.problems.length" class="dcs-problems">
            <li v-for="p in view.monitorSetup.problems" :key="p">{{ p }}</li>
          </ul>
          <p v-if="view.monitorSetup.file?.author === 'simapppro'" class="dcs-note">
            This file was written by SimAppPro into the DCS install folder. RigReady can take over:
            it imports SimAppPro's screen plan and writes its own file in Saved Games.
          </p>
          <v-btn
            class="dcs-cta"
            variant="tonal"
            color="primary"
            to="/configure/dcs/screens"
            data-testid="dcs-open-screens"
          >
            {{
              view.monitorSetup.rigReady ? 'Change the screen setup' : 'Set up screens in RigReady'
            }}
          </v-btn>
        </section>

        <section class="rr-panel dcs-card" data-testid="dcs-card-export">
          <header class="dcs-card-head">
            <v-icon icon="mdi-export" size="20" class="rr-muted" />
            <h2>Export.lua</h2>
            <v-spacer />
            <span
              v-if="view.exportLua.changedOutside || view.exportLua.streamDeckNeedsExportScript"
              class="dcs-chip rr-warn"
            >
              <v-icon icon="mdi-alert" size="14" /> Needs a look
            </span>
          </header>
          <p v-if="!view.exportLua.exists" class="dcs-lead">
            There is no Export.lua yet: no tool reads data from DCS.
          </p>
          <div v-else class="dcs-tools">
            <div v-for="tool in view.exportLua.tools" :key="tool.tool" class="dcs-tool">
              <v-icon
                :icon="tool.active ? 'mdi-check-circle' : 'mdi-minus-circle-outline'"
                :class="tool.active ? 'rr-ok' : 'rr-muted'"
                size="16"
              />
              {{ tool.name }}
              <span v-if="!tool.active" class="rr-muted">(commented out)</span>
            </div>
            <div v-if="view.exportLua.unknown" class="dcs-tool rr-muted">
              <v-icon icon="mdi-help-circle-outline" size="16" />
              {{ view.exportLua.unknown }} other
              {{ view.exportLua.unknown === 1 ? 'line' : 'lines' }}
            </div>
          </div>
          <p
            v-if="view.exportLua.streamDeckNeedsExportScript"
            class="dcs-note rr-warn"
            data-testid="dcs-needs-export-script"
          >
            The Stream Deck "DCS Interface" plugin is installed, but Export.lua does not load
            DCS-ExportScript, so its keys get no data from DCS.
          </p>
          <p v-if="view.exportLua.changedOutside" class="dcs-note rr-warn">
            Changed outside RigReady since RigReady last saw it.
          </p>
          <v-btn
            class="dcs-cta"
            variant="tonal"
            to="/configure/dcs/export"
            data-testid="dcs-open-export"
          >
            Manage Export.lua
          </v-btn>
        </section>

        <section class="rr-panel dcs-card" data-testid="dcs-card-graphics">
          <header class="dcs-card-head">
            <v-icon icon="mdi-tune-variant" size="20" class="rr-muted" />
            <h2>Graphics (options.lua)</h2>
          </header>
          <p v-if="view.optionsProblem" class="dcs-lead">{{ view.optionsProblem }}</p>
          <div v-else-if="view.options" class="dcs-facts">
            <div>
              <span>Window</span>{{ view.options.width }} × {{ view.options.height }}
              {{ view.options.fullScreen ? 'full screen' : 'windowed' }}
            </div>
            <div><span>Monitor setup</span>"{{ view.options.multiMonitorSetup ?? 'default' }}"</div>
            <div><span>VR</span>{{ view.options.vr ? 'On' : 'Off' }}</div>
          </div>
          <p class="dcs-note">
            A setup can check these before you fly: capture a new setup while DCS is configured the
            way you like it.
          </p>
        </section>

        <section class="rr-panel dcs-card" data-testid="dcs-card-simapppro">
          <header class="dcs-card-head">
            <v-icon icon="mdi-lightbulb-on-outline" size="20" class="rr-muted" />
            <h2>SimAppPro</h2>
            <v-spacer />
            <span
              v-if="view.simAppPro.installed"
              class="dcs-chip"
              :class="view.simAppPro.running ? 'rr-ok' : 'rr-muted'"
            >
              {{ view.simAppPro.running ? 'Running' : 'Not running' }}
            </span>
          </header>
          <p class="dcs-lead">
            <template v-if="view.simAppPro.installed">
              Version {{ view.simAppPro.version ?? 'unknown' }} is installed. RigReady now does its
              configuration work; it is only needed while flying for WinWing lights, UFC/ICP text
              and vibration.
            </template>
            <template v-else>
              Not installed. RigReady sets up the screens and Export.lua without it.
            </template>
          </p>
          <v-btn
            class="dcs-cta"
            variant="tonal"
            to="/configure/dcs/simapppro"
            data-testid="dcs-open-simapppro"
          >
            What SimAppPro is still for
          </v-btn>
        </section>

        <section class="rr-panel dcs-card dcs-wide" data-testid="dcs-card-aircraft">
          <header class="dcs-card-head">
            <v-icon icon="mdi-airplane" size="20" class="rr-muted" />
            <h2>Aircraft</h2>
            <span class="rr-row-sub">{{ view.aircraft.length }} installed or bound</span>
          </header>
          <div v-if="view.aircraft.length === 0" class="dcs-lead">No aircraft modules found.</div>
          <div class="dcs-aircraft">
            <div
              v-for="a in aircraft"
              :key="a.unit"
              class="dcs-plane"
              data-testid="dcs-aircraft"
              :data-unit="a.unit"
            >
              <div class="rr-row-title">{{ a.label }}</div>
              <div class="rr-row-sub">
                <span class="rr-mono">{{ a.unit }}</span>
                <template v-if="a.hasBindings"> · bindings</template>
                <template v-if="!a.module"> · not installed</template>
              </div>
            </div>
          </div>
          <v-btn
            v-if="view.aircraft.length > 12"
            variant="text"
            size="small"
            class="mt-2"
            data-testid="dcs-aircraft-more"
            @click="showAllAircraft = !showAllAircraft"
          >
            {{ showAllAircraft ? 'Show fewer' : `Show all ${view.aircraft.length}` }}
          </v-btn>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dcs-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -12px 0 12px;
}
.dcs-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.dcs-wide {
  grid-column: 1 / -1;
}
.dcs-card {
  padding: 14px 18px 16px;
  display: flex;
  flex-direction: column;
}
.dcs-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.dcs-card-head h2 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}
.dcs-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 1px 9px;
}
.dcs-facts {
  display: grid;
  gap: 4px;
  font-size: 13px;
}
.dcs-facts > div {
  display: flex;
  gap: 10px;
  overflow-wrap: anywhere;
}
.dcs-facts > div > span:first-child {
  flex: 0 0 104px;
  color: var(--rr-muted);
}
.dcs-lead {
  font-size: 13.5px;
  margin: 0 0 8px;
}
.dcs-note {
  font-size: 12.5px;
  color: var(--rr-muted);
  margin: 8px 0 0;
}
.dcs-note.rr-warn {
  color: var(--rr-warn);
}
.dcs-sub-title {
  font-size: 12px;
  color: var(--rr-muted);
  margin: 12px 0 4px;
}
.dcs-folder {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.dcs-tag {
  font-size: 11.5px;
  color: var(--rr-muted);
  border: 1px solid var(--rr-border);
  border-radius: 4px;
  padding: 0 6px;
}
.dcs-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.dcs-problems {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--rr-warn);
}
.dcs-verify {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--rr-border);
  font-size: 12.5px;
}
.dcs-verify > div {
  flex: 1;
}
.dcs-cta {
  align-self: flex-start;
  margin-top: auto;
}
.dcs-card > .dcs-cta {
  margin-top: 14px;
}
.dcs-tools {
  display: grid;
  gap: 4px;
  font-size: 13.5px;
}
.dcs-tool {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dcs-aircraft {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}
.dcs-plane {
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--rr-surface-2);
}
</style>
