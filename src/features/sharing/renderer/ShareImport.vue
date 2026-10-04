<script setup lang="ts">
import { computed, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { sharingContract, type ImportReportView, type ImportResultView } from '../contract';

const api = useClient(sharingContract);
const report = ref<ImportReportView>();
const chosen = ref<string[]>([]);
const conflict = ref<'overwrite' | 'keepBoth'>('overwrite');
const error = ref<string>();
const opening = ref(false);
const importing = ref(false);
const result = ref<ImportResultView>();
/** Undoing the import just made: what happened, or the question when files changed since. */
const undone = ref<{ files: number; setupRemoved: boolean }>();
const undoing = ref(false);
const undoQuestion = ref<string>();

async function undo(force = false): Promise<void> {
  const groupId = result.value?.groupId;
  if (!groupId) return;
  error.value = undefined;
  undoing.value = true;
  const done = await api.undoImport({ groupId, force });
  undoing.value = false;
  if (!done.ok) {
    if (done.error.code === 'journal.changed' && !force) {
      undoQuestion.value = errorText(done.error);
      return;
    }
    error.value = errorText(done.error);
    return;
  }
  undoQuestion.value = undefined;
  undone.value = done.value;
  notifyMachineChanged();
}

async function open(): Promise<void> {
  error.value = undefined;
  result.value = undefined;
  undone.value = undefined;
  undoQuestion.value = undefined;
  opening.value = true;
  const opened = await api.openImport();
  opening.value = false;
  if (!opened.ok) {
    report.value = undefined;
    error.value = `This file cannot be imported. ${errorText(opened.error)}`;
    return;
  }
  if (!opened.value) return;
  report.value = opened.value;
  chosen.value = opened.value.parts.filter((p) => p.importable).map((p) => p.id);
}

const differing = computed(
  () =>
    (report.value?.parts ?? [])
      .filter((p) => chosen.value.includes(p.id))
      .flatMap((p) => p.files ?? [])
      .filter((f) => f.status === 'different').length
);

async function runImport(): Promise<void> {
  if (!report.value) return;
  error.value = undefined;
  importing.value = true;
  const done = await api.import({
    importId: report.value.importId,
    parts: chosen.value,
    conflict: conflict.value,
  });
  importing.value = false;
  if (!done.ok) {
    error.value = errorText(done.error);
    return;
  }
  result.value = done.value;
  undone.value = undefined;
  notifyMachineChanged();
}

const STATUS = { new: 'New here', same: 'Same as yours', different: 'Differs from yours' } as const;
const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
};
</script>

<template>
  <div data-testid="share-import">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="import-error">
      {{ error }}
    </v-alert>

    <div v-if="!report" class="rr-panel rr-empty">
      <div class="mb-3">
        Pick a .rigready file. It is checked completely before anything is shown, and nothing is
        written until you choose what to import.
      </div>
      <v-btn
        color="primary"
        prepend-icon="mdi-folder-open-outline"
        :loading="opening"
        data-testid="import-open"
        @click="open"
      >
        Open .rigready file
      </v-btn>
    </div>

    <template v-else-if="result">
      <div class="rr-panel done" data-testid="import-result">
        <div class="done-title" :class="result.failed.length ? 'rr-warn' : 'rr-ok'">
          <v-icon
            :icon="result.failed.length ? 'mdi-alert-outline' : 'mdi-check-circle-outline'"
            size="20"
          />
          Imported "{{ result.name }}"
        </div>
        <div class="rr-row-sub" data-testid="import-result-summary">
          <template v-if="result.profileName"
            >Added the setup "{{ result.profileName }}".
          </template>
          <template v-if="result.layoutName"
            >Saved the monitor layout "{{ result.layoutName }}".
          </template>
          Wrote {{ result.written.length }} config
          {{ result.written.length === 1 ? 'file' : 'files'
          }}<template v-if="result.unchanged.length">
            ({{ result.unchanged.length }} were already the same)</template
          >.
          <template v-if="result.groupId"
            >Undo takes all of it back in one step: the files and the setup.</template
          >
        </div>
        <div v-if="result.switchedOff.length" class="rr-row-sub" data-testid="import-switched-off">
          {{ result.switchedOff.length }}
          {{ result.switchedOff.length === 1 ? 'check is' : 'checks are' }} for devices not found on
          this PC. They were imported switched off, so they do not count until you turn them on in
          the setup editor: {{ result.switchedOff.join(', ') }}.
        </div>
        <div v-if="undone" class="rr-row-sub rr-ok" data-testid="import-undone">
          <v-icon icon="mdi-undo" size="14" /> Import undone:
          {{ undone.setupRemoved ? 'the setup was removed' : 'no setup was removed' }}
          <template v-if="undone.files">
            and {{ undone.files }} {{ undone.files === 1 ? 'file was' : 'files were' }} put back the
            way {{ undone.files === 1 ? 'it was' : 'they were' }}</template
          >.
        </div>
        <v-alert
          v-if="undoQuestion"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="import-undo-question"
        >
          {{ undoQuestion }}
          <div class="mt-2">
            <v-btn size="small" variant="tonal" data-testid="import-undo-force" @click="undo(true)">
              Undo anyway
            </v-btn>
            <v-btn size="small" variant="text" @click="undoQuestion = undefined">Leave it</v-btn>
          </div>
        </v-alert>
        <div v-for="f in result.failed" :key="f.label" class="rr-row-sub rr-bad">
          Not imported: {{ f.label }} — {{ f.reason }}
        </div>
        <div class="done-actions">
          <v-btn
            v-if="result.profileId && !undone"
            color="primary"
            to="/configure/profiles"
            data-testid="import-go-setups"
          >
            Go to setups
          </v-btn>
          <v-btn
            v-if="result.groupId && !undone"
            variant="tonal"
            prepend-icon="mdi-undo"
            :loading="undoing"
            data-testid="import-undo"
            @click="undo()"
          >
            Undo this import
          </v-btn>
          <v-btn v-if="result.groupId" variant="text" to="/configure/safety">Safety page</v-btn>
          <v-btn variant="text" data-testid="import-another" @click="report = undefined">
            Import another
          </v-btn>
        </div>
      </div>
      <v-alert
        v-if="result.deviceIds && !undone"
        type="warning"
        variant="tonal"
        title="Controllers have different IDs on this PC"
        data-testid="import-device-ids"
      >
        {{ result.deviceIds.message }}
        <div class="mt-3">
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-swap-horizontal"
            to="/configure/dcs-bindings/device-ids"
            data-testid="import-open-device-ids"
          >
            Open Bindings → Device IDs
          </v-btn>
        </div>
      </v-alert>
    </template>

    <template v-else>
      <div class="rr-panel head" data-testid="import-head">
        <v-icon icon="mdi-package-variant-closed" size="24" />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ report.name }}</div>
          <div class="rr-row-sub">
            {{ report.fileName }} · shared {{ when(report.createdAt) }} with RigReady
            {{ report.appVersion }}
          </div>
        </div>
        <v-btn variant="text" size="small" data-testid="import-close" @click="report = undefined">
          Close
        </v-btn>
      </div>

      <v-alert
        v-if="report.wantedToRun.length"
        type="warning"
        variant="tonal"
        class="mb-4"
        data-testid="import-wanted"
      >
        <div class="wanted-title">
          This setup wanted to run programs. None of them will be imported.
        </div>
        <div
          v-for="w in report.wantedToRun"
          :key="w.kind + w.name + w.description"
          class="wanted"
          data-testid="import-wanted-item"
        >
          <span class="rr-mono">{{ w.name }}</span> — {{ w.description }}
          <span v-if="w.inFile"> (was still in the file, removed now)</span>
        </div>
        <div class="mt-2">
          If you need any of them, set them up yourself from a source you trust.
        </div>
      </v-alert>
      <div v-else class="rr-row-sub mb-4 rr-ok" data-testid="import-nothing-runs">
        <v-icon icon="mdi-check" size="14" /> Nothing in this setup runs a program.
      </div>

      <h2 class="rr-section-title section-gap">How it fits this PC</h2>
      <div class="rr-panel" data-testid="import-compat">
        <div
          v-for="d in report.compatibility.devices"
          :key="d.vendorId + d.productId"
          class="rr-row"
          data-testid="import-device"
          :data-present="d.present"
        >
          <v-icon
            :icon="
              d.present
                ? 'mdi-check-circle'
                : d.required
                  ? 'mdi-close-circle'
                  : 'mdi-minus-circle-outline'
            "
            :class="d.present ? 'rr-ok' : d.required ? 'rr-bad' : 'rr-warn'"
            size="18"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">{{ d.name }}</div>
            <div class="rr-row-sub">
              {{ d.vendorId }}:{{ d.productId }} ·
              {{
                d.present
                  ? 'Connected'
                  : d.required
                    ? 'Not connected (needed)'
                    : 'Not connected (optional)'
              }}
            </div>
          </div>
        </div>
        <div
          v-for="s in report.compatibility.software"
          :key="s.kind + s.name"
          class="rr-row"
          data-testid="import-software"
          :data-found="s.found"
        >
          <v-icon
            :icon="
              s.found
                ? 'mdi-check-circle'
                : s.required
                  ? 'mdi-close-circle'
                  : 'mdi-minus-circle-outline'
            "
            :class="s.found ? 'rr-ok' : s.required ? 'rr-bad' : 'rr-warn'"
            size="18"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">{{ s.name }}</div>
            <div class="rr-row-sub">
              {{ s.kind === 'game' ? 'Game' : 'Helper app' }} · {{ s.detail }}
            </div>
          </div>
        </div>
        <div v-if="report.compatibility.displays" class="rr-row" data-testid="import-displays">
          <v-icon
            :icon="
              report.compatibility.displays.here >= report.compatibility.displays.needed
                ? 'mdi-check-circle'
                : 'mdi-alert-circle-outline'
            "
            :class="
              report.compatibility.displays.here >= report.compatibility.displays.needed
                ? 'rr-ok'
                : 'rr-warn'
            "
            size="18"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">Monitors</div>
            <div class="rr-row-sub">
              The setup uses {{ report.compatibility.displays.summary }}; this PC has
              {{ report.compatibility.displays.here }}.
            </div>
          </div>
        </div>
      </div>

      <template v-if="report.notes">
        <h2 class="rr-section-title section-gap">Notes from whoever shared it</h2>
        <div class="rr-panel notes" data-testid="import-notes" v-text="report.notes" />
      </template>

      <h2 class="rr-section-title section-gap">What to import</h2>
      <div class="rr-panel">
        <div
          v-for="part in report.parts"
          :key="part.id"
          class="part"
          data-testid="import-part"
          :data-part="part.id"
          :data-importable="part.importable"
        >
          <div class="rr-row part-head">
            <v-checkbox-btn
              v-model="chosen"
              :value="part.id"
              :disabled="!part.importable"
              density="compact"
              :aria-label="`Import ${part.label}`"
              data-testid="import-part-check"
            />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ part.label }}</div>
              <div class="rr-row-sub">{{ part.detail }}</div>
              <div v-if="part.target" class="rr-row-sub">
                <span class="rr-mono">{{ part.stored }}</span> →
                <span class="rr-mono">{{ part.target }}</span>
              </div>
              <div v-if="part.problem" class="rr-row-sub rr-warn" data-testid="import-part-problem">
                Cannot be imported: {{ part.problem }}
              </div>
            </div>
          </div>
          <div v-if="part.files && part.files.length && part.importable" class="files">
            <div v-for="f in part.files" :key="f.path" class="file">
              <span class="rr-mono">{{ f.path }}</span>
              <span class="rr-muted">{{ STATUS[f.status] }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="differing" class="conflict" data-testid="import-conflict">
        <div class="rr-row-sub mb-1">
          {{ differing }} {{ differing === 1 ? 'file differs' : 'files differ' }} from yours:
        </div>
        <v-radio-group v-model="conflict" density="compact" hide-details inline>
          <v-radio
            value="overwrite"
            label="Replace mine (each is backed up first)"
            data-testid="import-conflict-overwrite"
          />
          <v-radio
            value="keepBoth"
            label="Keep mine and add theirs as (shared) copies"
            data-testid="import-conflict-keepboth"
          />
        </v-radio-group>
      </div>

      <div class="rr-panel footer">
        <div class="rr-row-main rr-row-sub">
          Everything is written through RigReady's safety journal as one action you can undo.
        </div>
        <v-btn variant="text" @click="report = undefined">Cancel</v-btn>
        <v-btn
          color="primary"
          prepend-icon="mdi-import"
          :disabled="chosen.length === 0"
          :loading="importing"
          data-testid="import-apply"
          @click="runImport"
        >
          Import
        </v-btn>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.wanted-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.wanted {
  font-size: 13px;
}
.notes {
  max-height: 180px;
  overflow-y: auto;
  white-space: pre-wrap;
  padding: 12px 16px;
  font-size: 13px;
  color: var(--rr-muted);
}
.part {
  border-top: 1px solid var(--rr-border);
}
.part:first-child {
  border-top: none;
}
.part-head {
  border-top: none;
}
.files {
  padding: 0 16px 10px 52px;
  max-height: 220px;
  overflow-y: auto;
}
.file {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
}
.file > :last-child {
  white-space: nowrap;
}
.conflict {
  margin-top: 14px;
}
.footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  margin-top: 20px;
}
.done {
  padding: 16px 20px;
  margin-bottom: 16px;
}
.done-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}
.done-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
