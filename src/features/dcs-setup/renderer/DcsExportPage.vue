<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { dcsSetupContract, type ExportAction, type ExportState } from '../contract';
import { TOOL_INFO, toolOf, type ExportTool } from '../core/exportLua';
import DiffView from './DiffView.vue';

const api = useClient(dcsSetupContract);
const view = ref<ExportState>();
const error = ref<string>();
const message = ref<string>();
const pending = ref<{
  action: ExportAction;
  title: string;
  diff: { kind: 'same' | 'added' | 'removed'; text: string }[];
}>();
const busy = ref(false);

async function load(): Promise<void> {
  const result = await api.exportLua();
  if (result.ok) view.value = result.value;
  else error.value = errorText(result.error);
}

let off: (() => void) | undefined;
onMounted(() => {
  off = onMachineChanged(() => void load());
  return load();
});
onBeforeUnmount(() => off?.());

const TITLES = {
  add: (t: ExportTool) => `Add ${TOOL_INFO[t].name}`,
  remove: (t: ExportTool) => `Remove ${TOOL_INFO[t].name}`,
  dedupe: (t: ExportTool) => `Remove duplicate ${TOOL_INFO[t].name} lines`,
};

/** Shows what the change does to the file before anything is written. */
async function ask(action: ExportAction): Promise<void> {
  error.value = undefined;
  message.value = undefined;
  const result = await api.previewExport(action);
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  pending.value = {
    action,
    title:
      action.kind === 'restore' ? "Put back RigReady's lines" : TITLES[action.kind](action.tool),
    diff: result.value.diff,
  };
}

async function confirm(): Promise<void> {
  if (!pending.value) return;
  busy.value = true;
  const result = await api.applyExport(pending.value.action);
  busy.value = false;
  pending.value = undefined;
  if (result.ok) {
    message.value = result.value.message;
    notifyMachineChanged();
  } else error.value = errorText(result.error);
  await load();
}

async function keep(): Promise<void> {
  const result = await api.acceptExport();
  if (result.ok) message.value = result.value.message;
  else error.value = errorText(result.error);
  await load();
}

/** A tool line went missing: putting RigReady's lines back is possible. */
const restorable = computed(
  () => view.value?.changedOutside?.removed.some((l) => toolOf(l)) ?? false
);
const exportScript = computed(() => view.value?.tools.find((t) => t.tool === 'export-script'));
const streamDeckNeeds = computed(
  () => view.value?.streamDeckDcsPlugin === true && (exportScript.value?.active ?? 0) === 0
);
const EOL = { '\r\n': 'CRLF', '\n': 'LF', '': '' } as const;
const toolName = (tool?: string): string =>
  tool && tool in TOOL_INFO
    ? TOOL_INFO[tool as ExportTool].name
    : tool === 'unknown'
      ? 'Unknown'
      : '';
</script>

<template>
  <div data-testid="dcs-export">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="export-error">{{
      error
    }}</v-alert>
    <div v-if="message" class="exp-message rr-ok" data-testid="export-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>
    <div v-if="!view && !error" class="rr-empty">Reading Export.lua…</div>
    <NotOnThisPc
      v-else-if="view?.dcsFound === false"
      name="DCS World"
      :looked="['every Steam library', 'the standalone install folders', 'Saved Games\\DCS']"
      game-page="/configure/games/dcs"
      data-testid="dcs-not-found"
    />
    <div v-else-if="view?.problem" class="rr-panel rr-empty">{{ view.problem }}</div>

    <template v-else-if="view">
      <p class="exp-intro">
        Each tool that reads data out of DCS adds a line to
        <span class="rr-mono">{{ view.path }}</span
        >. RigReady adds or removes one tool's line and leaves every other line exactly as it was,
        line endings included.
      </p>

      <v-alert v-if="view.dcsRunning" type="info" variant="tonal" class="mb-4">
        DCS is running. Close it before changing Export.lua; DCS reads it when a mission starts.
      </v-alert>

      <div v-if="view.changedOutside" class="rr-panel exp-changed" data-testid="export-changed">
        <div class="exp-changed-head">
          <v-icon icon="mdi-alert" class="rr-warn" />
          <div class="rr-row-main">
            <div class="rr-row-title">Changed outside RigReady</div>
            <div class="rr-row-sub">
              Since RigReady last wrote or accepted it on
              {{ new Date(view.changedOutside.at).toLocaleString() }}.
              <template v-if="view.simAppProRunning">
                SimAppPro rewrites this file every time it starts.</template
              >
            </div>
          </div>
        </div>
        <pre
          class="exp-diff rr-mono"
        ><span v-for="line in view.changedOutside.removed" :key="`r${line}`" class="rr-bad">− {{ line }}
</span><span v-for="line in view.changedOutside.added" :key="`a${line}`" class="rr-ok">+ {{ line }}
</span></pre>
        <div class="exp-actions">
          <v-btn
            v-if="restorable"
            size="small"
            color="primary"
            variant="tonal"
            :disabled="view.dcsRunning"
            data-testid="export-restore"
            @click="ask({ kind: 'restore' })"
          >
            Put back RigReady's lines
          </v-btn>
          <v-btn size="small" variant="text" data-testid="export-keep" @click="keep">
            Keep it as it is
          </v-btn>
        </div>
      </div>

      <div v-if="streamDeckNeeds" class="rr-panel exp-callout" data-testid="export-streamdeck">
        <v-icon icon="mdi-view-grid-outline" class="rr-warn" />
        <div class="rr-row-main">
          <div class="rr-row-title">Your Stream Deck DCS keys get no data</div>
          <div class="rr-row-sub">
            The Stream Deck "DCS Interface" plugin is installed. It needs DCS-ExportScript, and
            Export.lua does not load it, so lamps and displays on those keys stay dark.
            <template v-if="!exportScript?.installed">
              Install DCS-ExportScript first: copy its
              <span class="rr-mono">DCS-ExportScript</span> folder into
              <span class="rr-mono">Saved Games\DCS\Scripts</span> (an earlier backup of Saved Games
              may still have it). Then add its line here.
            </template>
          </div>
        </div>
        <v-btn
          v-if="exportScript?.installed"
          color="primary"
          size="small"
          :disabled="view.dcsRunning"
          data-testid="export-streamdeck-add"
          @click="ask({ kind: 'add', tool: 'export-script' })"
        >
          Add its line
        </v-btn>
      </div>

      <h2 class="rr-section-title">Tools</h2>
      <div class="rr-panel exp-tools" data-testid="export-tools">
        <div
          v-for="tool in view.tools"
          :key="tool.tool"
          class="rr-row"
          data-testid="export-tool"
          :data-tool="tool.tool"
          :data-active="tool.active > 0"
        >
          <v-icon
            :icon="
              tool.active
                ? 'mdi-check-circle'
                : tool.disabled
                  ? 'mdi-minus-circle-outline'
                  : 'mdi-circle-outline'
            "
            :class="tool.active ? 'rr-ok' : 'rr-muted'"
            size="20"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">
              {{ tool.name }}
              <span v-if="tool.active > 1" class="exp-tag rr-warn"
                >loaded {{ tool.active }} times</span
              >
              <span v-else-if="!tool.active && tool.disabled" class="exp-tag">commented out</span>
            </div>
            <div class="rr-row-sub">
              {{ tool.purpose }}
              <template v-if="!tool.installed"> Not installed in Saved Games.</template>
            </div>
          </div>
          <v-btn
            v-if="tool.active > 1"
            size="small"
            variant="text"
            :disabled="view.dcsRunning"
            :data-testid="`export-dedupe-${tool.tool}`"
            @click="ask({ kind: 'dedupe', tool: tool.tool })"
          >
            Remove duplicates
          </v-btn>
          <v-btn
            v-if="tool.active || tool.disabled"
            size="small"
            variant="text"
            :disabled="view.dcsRunning"
            :data-testid="`export-remove-${tool.tool}`"
            @click="ask({ kind: 'remove', tool: tool.tool })"
          >
            Remove
          </v-btn>
          <v-btn
            v-if="!tool.active && tool.installed"
            size="small"
            variant="tonal"
            :disabled="view.dcsRunning"
            :data-testid="`export-add-${tool.tool}`"
            @click="ask({ kind: 'add', tool: tool.tool })"
          >
            Add
          </v-btn>
        </div>
      </div>

      <h2 class="rr-section-title exp-file-title">The file</h2>
      <div class="rr-panel exp-file" data-testid="export-file">
        <div v-if="!view.exists" class="rr-row rr-muted">
          Export.lua does not exist. Adding a tool creates it.
        </div>
        <div
          v-for="line in view.lines"
          :key="line.index"
          class="exp-line"
          :class="{ disabled: line.disabled }"
          data-testid="export-line"
        >
          <span class="exp-num">{{ line.index + 1 }}</span>
          <span class="exp-text rr-mono">{{ line.text || ' ' }}</span>
          <span v-if="line.tool" class="exp-tag" :class="{ 'rr-warn': line.tool === 'unknown' }">{{
            toolName(line.tool)
          }}</span>
          <span class="exp-eol">{{ EOL[line.eol] }}</span>
        </div>
      </div>
    </template>

    <v-dialog
      :model-value="pending !== undefined"
      max-width="720"
      @update:model-value="pending = undefined"
    >
      <v-card v-if="pending" data-testid="export-confirm">
        <v-card-title>{{ pending.title }}?</v-card-title>
        <v-card-text>
          <p class="mb-3">
            Export.lua before and after. Nothing else changes; the current file is backed up first.
          </p>
          <DiffView :lines="pending.diff" :context="-1" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="export-cancel" @click="pending = undefined"
            >Cancel</v-btn
          >
          <v-btn
            color="primary"
            :loading="busy"
            data-testid="export-confirm-apply"
            @click="confirm"
          >
            Change Export.lua
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.exp-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -12px 0 12px;
}
.exp-intro {
  font-size: 13.5px;
  color: var(--rr-muted);
  margin: 0 0 18px;
}
.exp-changed,
.exp-callout {
  padding: 12px 16px;
  margin-bottom: 18px;
}
.exp-changed-head,
.exp-callout {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.exp-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.exp-diff {
  margin: 10px 0 0;
  padding: 10px 12px;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  white-space: pre;
  overflow: auto;
  max-height: 360px;
}
.exp-tools {
  margin-bottom: 24px;
}
.exp-tag {
  margin-left: 8px;
  font-size: 11px;
  color: var(--rr-muted);
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 0 5px;
  white-space: nowrap;
}
.exp-file {
  padding: 8px 0;
}
.exp-line {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 2px 16px;
}
.exp-line.disabled .exp-text {
  color: var(--rr-muted);
}
.exp-num {
  flex: 0 0 22px;
  text-align: right;
  font-size: 11.5px;
  color: var(--rr-muted);
}
.exp-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.exp-eol {
  flex: 0 0 36px;
  font-size: 10.5px;
  color: var(--rr-muted);
  text-align: right;
}
</style>
