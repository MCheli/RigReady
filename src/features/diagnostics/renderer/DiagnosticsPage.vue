<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { diagnosticsContract, type LogEntryView, type LogView, type Overview } from '../contract';

const api = useClient(diagnosticsContract);
const overview = ref<Overview>();
const log = ref<LogView>();
const error = ref<string>();
const logError = ref<string>();
const message = ref<string>();
const busy = ref<'copy' | 'export' | 'open'>();

type Filter = 'all' | 'info' | 'warn' | 'error';
const filter = ref<Filter>('all');
const FILTERS: { value: Filter; id: string; label: string }[] = [
  { value: 'all', id: 'everything', label: 'Everything' },
  { value: 'info', id: 'info', label: 'Info and above' },
  { value: 'warn', id: 'warnings', label: 'Warnings and errors' },
  { value: 'error', id: 'errors', label: 'Errors only' },
];
const RANK = { debug: 10, info: 20, warn: 30, error: 40 } as const;
const LEVEL_LABEL = { debug: 'Debug', info: 'Info', warn: 'Warning', error: 'Error' } as const;

/** Newest first: what just happened is what is being looked for. */
const shown = computed<LogEntryView[]>(() => {
  const entries = log.value?.entries ?? [];
  const minimum = filter.value === 'all' ? 0 : RANK[filter.value];
  return entries.filter((entry) => RANK[entry.level] >= minimum).reverse();
});

async function loadOverview(): Promise<void> {
  const result = await api.overview();
  if (result.ok) overview.value = result.value;
  else error.value = errorText(result.error);
}

async function loadLog(): Promise<void> {
  const result = await api.log();
  if (result.ok) {
    log.value = result.value;
    logError.value = undefined;
  } else {
    logError.value = errorText(result.error);
  }
}

let off: (() => void) | undefined;
onMounted(() => {
  void loadOverview();
  void loadLog();
  off = onMachineChanged(() => {
    void loadOverview();
    void loadLog();
  });
});
onBeforeUnmount(() => off?.());

async function act<T>(
  kind: 'copy' | 'export' | 'open',
  call: () => Promise<
    | { ok: true; value: T }
    | { ok: false; error: { message: string; detail?: string; code: string } }
  >,
  done: (value: T) => string | undefined
): Promise<void> {
  busy.value = kind;
  error.value = undefined;
  message.value = undefined;
  const result = await call();
  busy.value = undefined;
  if (result.ok) message.value = done(result.value);
  else error.value = errorText(result.error);
}

const number = (n: number): string => n.toLocaleString('en-US');

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const copy = (): Promise<void> =>
  act(
    'copy',
    () => api.copy(),
    (value) =>
      `Copied ${number(value.characters)} characters. Your folders, Windows user name, PC name and serial numbers are replaced.`
  );

const exportZip = (): Promise<void> =>
  act(
    'export',
    () => api.export(),
    (value) =>
      value.saved
        ? `Saved ${value.path} (${value.files.length} files, ${size(value.bytes)}). Your folders, Windows user name, PC name and serial numbers are replaced.`
        : undefined
  );

const openFolder = (): Promise<void> =>
  act(
    'open',
    () => api.openLogFolder(),
    () => 'Opened the log folder.'
  );

async function setDetailed(detailed: boolean | null): Promise<void> {
  error.value = undefined;
  const result = await api.setLogLevel({ level: detailed ? 'debug' : 'info' });
  if (!result.ok) error.value = errorText(result.error);
  await loadOverview();
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}
</script>

<template>
  <div class="rr-page" data-testid="diagnostics-page">
    <h1 class="rr-page-title">Diagnostics</h1>
    <p class="rr-page-sub">
      What RigReady knows about this PC and what it wrote to its log. Nothing here leaves the PC
      unless you copy or export it.
    </p>

    <div class="diag-actions">
      <v-btn
        color="primary"
        prepend-icon="mdi-content-copy"
        :loading="busy === 'copy'"
        data-testid="diagnostics-copy"
        @click="copy"
      >
        Copy diagnostics
      </v-btn>
      <v-btn
        variant="tonal"
        prepend-icon="mdi-folder-zip-outline"
        :loading="busy === 'export'"
        data-testid="diagnostics-export"
        @click="exportZip"
      >
        Export diagnostics…
      </v-btn>
      <v-btn
        variant="tonal"
        prepend-icon="mdi-folder-open-outline"
        :loading="busy === 'open'"
        data-testid="diagnostics-open-logs"
        @click="openFolder"
      >
        Open log folder
      </v-btn>
    </div>
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="diagnostics-error">
      {{ error }}
    </v-alert>
    <div v-if="message" class="diag-message rr-ok" data-testid="diagnostics-message">
      <v-icon icon="mdi-check" size="16" /> <span>{{ message }}</span>
    </div>

    <template v-if="overview">
      <h2 class="rr-section-title">This PC</h2>
      <div class="rr-panel diag-panel" data-testid="diagnostics-app">
        <div class="rr-row">
          <div class="diag-key">RigReady</div>
          <div class="rr-row-main" data-testid="diagnostics-version">
            {{ overview.app.version }}
          </div>
        </div>
        <div class="rr-row">
          <div class="diag-key">Built on</div>
          <div class="rr-row-main">
            <template v-if="overview.app.electron">
              Electron {{ overview.app.electron }} · Chromium {{ overview.app.chrome }} ·
            </template>
            Node {{ overview.app.node }}
          </div>
        </div>
        <div class="rr-row">
          <div class="diag-key">Windows</div>
          <div class="rr-row-main" data-testid="diagnostics-os">{{ overview.app.os }}</div>
        </div>
        <div class="rr-row">
          <div class="diag-key">Data folder</div>
          <div class="rr-row-main rr-mono" data-testid="diagnostics-data-root">
            {{ overview.dataRoot }}
          </div>
        </div>
        <div class="rr-row">
          <div class="diag-key">Log folder</div>
          <div class="rr-row-main rr-mono">{{ overview.logFolder }}</div>
        </div>
      </div>

      <h2 class="rr-section-title">Games</h2>
      <div class="rr-panel diag-panel" data-testid="diagnostics-games">
        <div v-if="overview.games.found.length === 0" class="rr-row">
          <div class="rr-row-main rr-muted">
            None of the games RigReady knows were found on this PC.
          </div>
        </div>
        <div v-for="game in overview.games.found" :key="game.id" class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">{{ game.name }}</div>
            <div v-if="game.error" class="rr-row-sub rr-bad">
              <v-icon icon="mdi-alert-circle-outline" size="14" /> Could not be looked for:
              {{ game.error }}
            </div>
            <div v-for="install in game.installs" :key="install.installDir" class="rr-row-sub">
              {{ install.source }} · <span class="rr-mono">{{ install.installDir }}</span>
            </div>
          </div>
        </div>
        <div v-if="overview.games.notFound.length > 0" class="rr-row">
          <div class="rr-row-main rr-row-sub">
            Not found: {{ overview.games.notFound.join(', ') }}
          </div>
        </div>
      </div>

      <h2 class="rr-section-title">Devices and monitors</h2>
      <div class="rr-panel diag-panel" data-testid="diagnostics-devices">
        <div v-if="overview.devices.error" class="rr-row" data-testid="diagnostics-devices-problem">
          <v-icon icon="mdi-alert-circle-outline" size="18" class="rr-bad" />
          <div class="rr-row-main">
            <div class="rr-row-title">The devices could not be read</div>
            <div class="rr-row-sub">{{ overview.devices.error }}</div>
          </div>
        </div>
        <template v-else>
          <div v-if="overview.devices.controllers.length === 0" class="rr-row">
            <div class="rr-row-main rr-muted">No game controller or input device is connected.</div>
          </div>
          <div
            v-for="(device, index) in overview.devices.controllers"
            :key="index"
            class="rr-row diag-compact"
          >
            <div class="rr-row-main">{{ device.name }}</div>
            <div class="rr-mono rr-muted">{{ device.vendorId }}:{{ device.productId }}</div>
          </div>
          <div class="rr-row diag-compact">
            <div class="rr-row-main rr-row-sub">
              {{ overview.devices.usbDevices }} USB devices in all, {{ overview.devices.hubs }} of
              them hubs
            </div>
          </div>
        </template>
        <div
          v-if="overview.monitors.error"
          class="rr-row"
          data-testid="diagnostics-monitors-problem"
        >
          <v-icon icon="mdi-alert-circle-outline" size="18" class="rr-bad" />
          <div class="rr-row-main">
            <div class="rr-row-title">The monitors could not be read</div>
            <div class="rr-row-sub">{{ overview.monitors.error }}</div>
          </div>
        </div>
        <div v-for="monitor in overview.monitors.list" :key="monitor" class="rr-row diag-compact">
          <v-icon icon="mdi-monitor" size="16" class="rr-muted" />
          <div class="rr-row-main">{{ monitor }}</div>
        </div>
      </div>

      <h2 class="rr-section-title">RigReady's own files</h2>
      <div class="rr-panel diag-panel" data-testid="diagnostics-files">
        <div
          v-for="file in overview.dataFiles"
          :key="file.id"
          class="rr-row"
          data-testid="diagnostics-file"
          :data-id="file.id"
          :data-ok="file.ok"
        >
          <v-icon
            :icon="file.ok ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'"
            size="18"
            :class="file.ok ? 'rr-ok' : 'rr-bad'"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">{{ file.label }}<span v-if="!file.ok"> · problem</span></div>
            <div class="rr-row-sub">{{ file.summary }}</div>
            <div class="rr-row-sub rr-mono">{{ file.file }}</div>
          </div>
        </div>
      </div>
    </template>

    <div class="diag-log-head">
      <h2 class="rr-section-title">Recent log</h2>
      <v-spacer />
      <v-switch
        v-if="overview"
        :model-value="overview.log.level === 'debug'"
        :disabled="overview.log.fixedByEnvironment"
        label="Detailed log"
        class="diag-detailed"
        data-testid="diagnostics-detailed"
        @update:model-value="setDetailed"
      />
    </div>
    <div v-if="overview?.log.fixedByEnvironment" class="rr-row-sub diag-fixed">
      The level ({{ overview.log.level }}) is set by the RIGREADY_LOG_LEVEL environment variable for
      this run.
    </div>
    <div class="diag-log-tools">
      <v-btn-toggle
        v-model="filter"
        mandatory
        density="compact"
        variant="outlined"
        divided
        data-testid="diagnostics-filter"
      >
        <v-btn
          v-for="option in FILTERS"
          :key="option.value"
          :value="option.value"
          size="small"
          :data-testid="`diagnostics-show-${option.id}`"
        >
          {{ option.label }}
        </v-btn>
      </v-btn-toggle>
      <v-spacer />
      <v-btn
        size="small"
        variant="text"
        prepend-icon="mdi-refresh"
        data-testid="diagnostics-refresh"
        @click="loadLog"
      >
        Refresh
      </v-btn>
    </div>
    <div v-if="logError" class="rr-panel rr-row" data-testid="diagnostics-log-problem">
      <v-icon icon="mdi-alert-circle-outline" size="18" class="rr-bad" />
      <div class="rr-row-main">
        <div class="rr-row-title">The log could not be read</div>
        <div class="rr-row-sub">{{ logError }}</div>
      </div>
    </div>
    <template v-else-if="log">
      <div
        v-if="log.entries.length === 0"
        class="rr-panel rr-empty"
        data-testid="diagnostics-log-empty"
      >
        Nothing has been logged yet.
      </div>
      <div
        v-else-if="shown.length === 0"
        class="rr-panel rr-empty"
        data-testid="diagnostics-log-empty"
      >
        {{
          filter === 'error'
            ? 'No errors in the recent log.'
            : 'No warnings or errors in the recent log.'
        }}
      </div>
      <div v-else class="rr-panel diag-log" data-testid="diagnostics-log">
        <div
          v-for="(entry, index) in shown"
          :key="index"
          class="diag-entry"
          data-testid="log-entry"
          :data-level="entry.level"
        >
          <span class="diag-time">{{ when(entry.time) }}</span>
          <span
            class="diag-level"
            :class="{ 'rr-bad': entry.level === 'error', 'rr-warn': entry.level === 'warn' }"
          >
            {{ LEVEL_LABEL[entry.level] }}
          </span>
          <span class="diag-scope">{{ entry.scope }}</span>
          <span class="diag-text">{{ entry.text }}</span>
        </div>
      </div>
      <div
        v-if="log.entries.length > 0"
        class="rr-row-sub diag-count"
        data-testid="diagnostics-log-count"
      >
        {{ shown.length }} of the newest {{ log.entries.length }} entries, newest first<span
          v-if="log.older > 0"
          >; {{ number(log.older) }} older ones are in the log folder</span
        >.
      </div>
    </template>
  </div>
</template>

<style scoped>
.diag-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}
.diag-message {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 13px;
  margin: -4px 0 16px;
  overflow-wrap: anywhere;
}
.diag-panel {
  margin-bottom: 24px;
}
.diag-key {
  flex: 0 0 120px;
  color: var(--rr-muted);
  font-size: 13px;
}
.diag-compact {
  padding-top: 6px;
  padding-bottom: 6px;
  font-size: 13.5px;
}
.diag-log-head {
  display: flex;
  align-items: center;
}
.diag-log-head .rr-section-title {
  margin: 0;
}
.diag-detailed {
  flex: 0 0 auto;
}
.diag-fixed {
  margin-bottom: 8px;
}
.diag-log-tools {
  display: flex;
  align-items: center;
  margin: 8px 0 10px;
}
.diag-log {
  max-height: 520px;
  overflow-y: auto;
  padding: 8px 0;
}
.diag-entry {
  display: grid;
  grid-template-columns: 150px 64px 110px 1fr;
  gap: 10px;
  padding: 3px 16px;
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}
.diag-time,
.diag-scope {
  color: var(--rr-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.diag-level {
  font-weight: 600;
}
.diag-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
}
.diag-count {
  margin-top: 8px;
}
</style>
