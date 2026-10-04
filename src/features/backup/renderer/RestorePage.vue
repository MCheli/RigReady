<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { backupContract, type RestorePreviewView, type RestoreReportView } from '../contract';
import { plural, SCOPE_KIND_LABEL, size, when } from './format';

const props = defineProps<{ id: string }>();
const api = useClient(backupContract);

type Action = 'overwrite' | 'keepBoth';
const preview = ref<RestorePreviewView>();
const error = ref<string>();
const selected = ref<Record<string, boolean>>({});
const actions = ref<Record<string, Action>>({});
const open = ref(new Set<string>());
const restoring = ref(false);
const report = ref<RestoreReportView>();
/** Report sections longer than FOLD rows start folded. */
const FOLD = 6;
const shown = ref(new Set<string>());
/** "Close them for me": the games and tools that hold the files are asked to quit first. */
const closePrograms = ref(false);
const openRecords = ref(new Set<string>());
const rawRecords = ref(new Set<string>());

type RecordView = RestorePreviewView['records'][number];
/** A record's rows under their headings, in the order the source listed them. */
function recordGroups(record: RecordView): { group: string; rows: RecordView['rows'] }[] {
  const groups: { group: string; rows: RecordView['rows'] }[] = [];
  for (const row of record.rows) {
    const last = groups[groups.length - 1];
    if (last && last.group === row.group) last.rows.push(row);
    else groups.push({ group: row.group, rows: [row] });
  }
  return groups;
}
function toggleIn(set: Set<string>, key: string): Set<string> {
  return set.has(key) ? new Set([...set].filter((r) => r !== key)) : new Set([...set, key]);
}

interface Row {
  ref: string;
  status: 'new' | 'same' | 'different';
}

/** Looks again at which programs are running, keeping what the user ticked. */
async function recheck(): Promise<void> {
  const result = await api.previewRestore({ id: props.id });
  if (result.ok && preview.value) {
    preview.value = { ...preview.value, running: result.value.running };
  }
}

onMounted(async () => {
  const result = await api.previewRestore({ id: props.id });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  preview.value = result.value;
  const sel: Record<string, boolean> = {};
  const act: Record<string, Action> = {};
  for (const item of result.value.items) {
    for (const f of item.files) {
      // Full paths from another PC and programs are opt-in; everything else that differs is ticked.
      sel[f.ref] = item.restorable && f.status !== 'same' && !item.absolute && !f.program;
      act[f.ref] = 'overwrite';
    }
    if (item.files.length <= 6) open.value.add(item.key);
  }
  for (const own of result.value.own) {
    sel[own.ref] = own.status !== 'same';
    act[own.ref] = 'overwrite';
  }
  selected.value = sel;
  actions.value = act;
});

const allRows = computed<Row[]>(() => [
  ...(preview.value?.items ?? []).flatMap((i) => (i.restorable ? i.files : [])),
  ...(preview.value?.own ?? []),
]);
const conflicts = computed(() => allRows.value.filter((r) => r.status === 'different'));

const plan = computed(() => {
  const rows = allRows.value.filter((r) => selected.value[r.ref] && r.status !== 'same');
  return {
    total: rows.length,
    fresh: rows.filter((r) => r.status === 'new').length,
    replace: rows.filter((r) => r.status === 'different' && actions.value[r.ref] === 'overwrite')
      .length,
    both: rows.filter((r) => r.status === 'different' && actions.value[r.ref] === 'keepBoth')
      .length,
  };
});

function applyToAll(choice: Action | 'skip'): void {
  const sel = { ...selected.value };
  const act = { ...actions.value };
  for (const row of conflicts.value) {
    if (choice === 'skip') sel[row.ref] = false;
    else {
      sel[row.ref] = true;
      act[row.ref] = choice;
    }
  }
  selected.value = sel;
  actions.value = act;
}

function itemState(key: string): { all: boolean; some: boolean } {
  const item = preview.value?.items.find((i) => i.key === key);
  const rows = (item?.files ?? []).filter((f) => f.status !== 'same');
  const on = rows.filter((f) => selected.value[f.ref]).length;
  return { all: rows.length > 0 && on === rows.length, some: on > 0 && on < rows.length };
}

function setItem(key: string, value: boolean): void {
  const item = preview.value?.items.find((i) => i.key === key);
  const sel = { ...selected.value };
  for (const f of item?.files ?? []) if (f.status !== 'same') sel[f.ref] = value;
  selected.value = sel;
}

function toggle(key: string): void {
  const next = new Set(open.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  open.value = next;
}

async function restore(): Promise<void> {
  error.value = undefined;
  const choices: Record<string, Action> = {};
  for (const row of allRows.value) {
    if (selected.value[row.ref]) choices[row.ref] = actions.value[row.ref] ?? 'overwrite';
  }
  restoring.value = true;
  const result = await api.restore({
    id: props.id,
    choices,
    closePrograms: closePrograms.value,
  });
  restoring.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    // A game may have been started (or closed) since the preview: show what runs now.
    await recheck();
    return;
  }
  report.value = result.value;
  notifyMachineChanged();
  window.scrollTo({ top: 0 });
}

const STATUS = { new: 'New here', same: 'Same as now', different: 'Differs' } as const;
const ACTIONS = [
  { title: 'Replace', value: 'overwrite' },
  { title: 'Keep both', value: 'keepBoth' },
];
</script>

<template>
  <div class="rr-page" data-testid="restore-page">
    <div class="back">
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" to="/configure/backups">
        Backups
      </v-btn>
    </div>
    <h1 class="rr-page-title">{{ report ? 'Restore finished' : 'Restore a backup' }}</h1>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="restore-error">
      {{ error }}
    </v-alert>

    <!-- The result -->
    <template v-if="report">
      <div class="rr-panel result" data-testid="restore-report">
        <div
          class="result-title"
          :class="report.failed.length ? 'rr-bad' : 'rr-ok'"
          data-testid="restore-report-title"
        >
          <v-icon
            :icon="report.failed.length ? 'mdi-alert-circle-outline' : 'mdi-check-circle-outline'"
            size="20"
          />
          <template v-if="report.failed.length">
            {{ plural(report.failed.length, 'item') }} could not be restored
          </template>
          <template v-else>
            Restored {{ plural(report.restored.length + report.keptBoth.length, 'item') }}
          </template>
        </div>
        <div class="rr-row-sub">
          Every restored file was read back and matches the backup.
          <template v-if="report.safetyBackup">
            What it replaced is saved as the backup "{{ report.safetyBackup }}".
          </template>
          <template v-if="report.groupId">
            The Safety page can undo the file changes in one step.
          </template>
        </div>
        <div class="result-actions">
          <v-btn
            color="primary"
            prepend-icon="mdi-airplane-takeoff"
            data-testid="restore-run-checks"
            to="/fly"
          >
            Run checks now
          </v-btn>
          <v-btn
            v-if="report.groupId"
            variant="tonal"
            to="/configure/safety"
            data-testid="restore-safety"
          >
            Safety page
          </v-btn>
        </div>
      </div>

      <v-alert
        v-if="report.deviceIds"
        type="warning"
        variant="tonal"
        class="mb-4"
        title="Controllers have different IDs on this PC"
        data-testid="restore-device-ids"
      >
        {{ report.deviceIds.message }}
        <div v-for="f in report.deviceIds.files" :key="f" class="rr-mono mt-1">{{ f }}</div>
        <div class="mt-3">
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-swap-horizontal"
            to="/configure/dcs-bindings/device-ids"
            data-testid="restore-open-device-ids"
          >
            Open Bindings → Device IDs
          </v-btn>
        </div>
      </v-alert>

      <div v-if="report.closed.length" class="rr-panel closed" data-testid="restore-closed">
        <div v-for="program in report.closed" :key="program.name" class="rr-row-sub">
          <template v-if="program.restarted === true">
            {{ program.name }} was closed for the restore and started again.
          </template>
          <span v-else-if="program.restarted === false" class="rr-warn">
            {{ program.name }} was closed for the restore and could not be started again: start it
            yourself.
          </span>
          <template v-else>
            {{ program.name }} was closed for the restore. Start it again when you are ready.
          </template>
        </div>
      </div>

      <template
        v-for="group in [
          { key: 'failed', title: 'Failed', rows: report.failed },
          { key: 'keptBoth', title: 'Kept both', rows: report.keptBoth },
          { key: 'restored', title: 'Restored', rows: report.restored },
          { key: 'unchanged', title: 'Already the same', rows: report.unchanged },
          { key: 'skipped', title: 'Skipped', rows: report.skipped },
        ]"
        :key="group.key"
      >
        <template v-if="group.rows.length">
          <h2 class="rr-section-title section-gap">{{ group.title }} ({{ group.rows.length }})</h2>
          <div class="rr-panel" :data-testid="`restore-${group.key}`">
            <div
              v-for="row in shown.has(group.key) ? group.rows : group.rows.slice(0, FOLD)"
              :key="row.ref"
              class="rr-row report-row"
            >
              <div class="rr-row-main">
                <div class="rr-mono report-label">{{ row.label }}</div>
                <div v-if="row.detail" class="rr-row-sub">{{ row.detail }}</div>
              </div>
            </div>
            <div v-if="group.rows.length > FOLD && !shown.has(group.key)" class="rr-row">
              <v-btn
                variant="text"
                size="small"
                :data-testid="`restore-show-${group.key}`"
                @click="shown = new Set([...shown, group.key])"
              >
                Show all {{ group.rows.length }}
              </v-btn>
            </div>
          </div>
        </template>
      </template>
    </template>

    <!-- The preview -->
    <template v-else-if="preview">
      <p class="rr-page-sub">
        Nothing is written until you press Restore. Files that would be replaced are saved first,
        and the Safety page can undo the restore.
      </p>
      <div class="rr-panel manifest" data-testid="restore-manifest">
        <v-icon icon="mdi-archive-outline" size="22" />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ preview.backup.name }}</div>
          <div class="rr-row-sub">
            {{ when(preview.backup.createdAt) }} ·
            {{ SCOPE_KIND_LABEL[preview.backup.scopeKind] }} ·
            {{ plural(preview.backup.fileCount, 'file') }}, {{ size(preview.backup.totalBytes) }} ·
            made on {{ preview.backup.machine || 'an unknown PC' }} with RigReady
            {{ preview.backup.appVersion }}
          </div>
        </div>
      </div>
      <v-alert
        v-if="preview.otherMachine"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4"
        data-testid="restore-other-pc"
      >
        This backup comes from another PC or Windows user. Paths are worked out for this PC, as
        shown under each item.
      </v-alert>

      <v-alert
        v-if="preview.running.length"
        type="warning"
        variant="tonal"
        class="mb-4"
        title="Close these before restoring"
        data-testid="restore-running"
      >
        <div
          v-for="program in preview.running"
          :key="program.id"
          class="running-row"
          data-testid="restore-running-program"
        >
          <strong>{{ program.name }}</strong> is running ({{ program.processes.join(', ') }}).
          {{ program.why }}
          <span class="rr-muted">Affects: {{ program.items.join(', ') }}.</span>
        </div>
        <v-checkbox
          v-model="closePrograms"
          density="compact"
          hide-details
          data-testid="restore-close-programs"
          :label="
            preview.running.some((p) => p.restart)
              ? 'Ask them to close for me, and start the helper tools again afterwards'
              : 'Ask them to close for me'
          "
        />
        <div class="rr-row-sub">
          RigReady asks the way their own Exit does and never ends a program by force. Unsaved work
          in a game is the game's to save.
          <v-btn variant="text" size="small" data-testid="restore-recheck" @click="recheck">
            I closed them: check again
          </v-btn>
        </div>
      </v-alert>

      <div v-if="conflicts.length" class="conflicts" data-testid="restore-conflicts">
        <span
          >{{ plural(conflicts.length, 'item differs', 'items differ') }} from what is here. For all
          of them:</span
        >
        <v-btn
          size="small"
          variant="tonal"
          data-testid="restore-all-overwrite"
          @click="applyToAll('overwrite')"
        >
          Replace
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          data-testid="restore-all-skip"
          @click="applyToAll('skip')"
        >
          Skip
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          data-testid="restore-all-keepboth"
          @click="applyToAll('keepBoth')"
        >
          Keep both
        </v-btn>
      </div>

      <template v-if="preview.own.length">
        <h2 class="rr-section-title section-gap">Setups and RigReady settings</h2>
        <div class="rr-panel">
          <div
            v-for="own in preview.own"
            :key="own.ref"
            class="rr-row"
            data-testid="restore-own"
            :data-ref="own.ref"
            :data-status="own.status"
          >
            <v-checkbox-btn
              v-model="selected[own.ref]"
              :disabled="own.status === 'same'"
              density="compact"
              :aria-label="`Restore ${own.label}`"
              data-testid="restore-own-check"
            />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ own.label }}</div>
              <div v-if="own.detail" class="rr-row-sub">{{ own.detail }}</div>
            </div>
            <span class="status" :class="`status-${own.status}`">{{ STATUS[own.status] }}</span>
            <v-select
              v-if="own.status === 'different' && (own.kind === 'profile' || own.kind === 'layout')"
              v-model="actions[own.ref]"
              :items="ACTIONS"
              :disabled="!selected[own.ref]"
              density="compact"
              variant="outlined"
              hide-details
              class="action-select"
              data-testid="restore-own-action"
            />
          </div>
        </div>
      </template>

      <template v-if="preview.items.length">
        <h2 class="rr-section-title section-gap">Game and tool files</h2>
        <div
          v-for="item in preview.items"
          :key="item.key"
          class="rr-panel item"
          data-testid="restore-item"
          :data-label="item.label"
          :data-restorable="item.restorable"
        >
          <div class="rr-row item-head">
            <v-checkbox-btn
              :model-value="itemState(item.key).all"
              :indeterminate="itemState(item.key).some"
              :disabled="!item.restorable || !item.files.some((f) => f.status !== 'same')"
              density="compact"
              :aria-label="`Restore all of ${item.label}`"
              data-testid="restore-item-check"
              @update:model-value="(v: boolean | null) => setItem(item.key, !!v)"
            />
            <div class="rr-row-main">
              <div class="rr-row-title">
                {{ item.label }} <span class="rr-muted source">{{ item.sourceName }}</span>
              </div>
              <div class="rr-row-sub">
                <span class="rr-mono">{{ item.stored }}</span>
                <template v-if="item.target">
                  → <span class="rr-mono" data-testid="restore-item-target">{{ item.target }}</span>
                </template>
              </div>
              <div
                v-if="item.absolute"
                class="rr-row-sub rr-warn"
                data-testid="restore-item-absolute"
              >
                Stored as a full path, not relative to a known folder: check it is the right place
                on this PC before ticking it.
              </div>
              <div
                v-if="!item.restorable"
                class="rr-row-sub rr-warn"
                data-testid="restore-item-problem"
              >
                Cannot be restored here: {{ item.problem }}
              </div>
            </div>
            <span class="rr-row-sub">{{ plural(item.fileCount, 'file') }}</span>
            <v-btn
              v-if="item.files.length"
              :icon="open.has(item.key) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
              variant="text"
              size="small"
              :aria-label="open.has(item.key) ? 'Hide files' : 'Show files'"
              data-testid="restore-item-toggle"
              @click="toggle(item.key)"
            />
          </div>
          <div v-if="open.has(item.key) && item.restorable" class="files">
            <div
              v-for="f in item.files"
              :key="f.ref"
              class="file"
              data-testid="restore-file"
              :data-path="f.relativePath"
              :data-status="f.status"
            >
              <v-checkbox-btn
                v-model="selected[f.ref]"
                :disabled="f.status === 'same'"
                density="compact"
                :aria-label="`Restore ${f.relativePath}`"
                data-testid="restore-file-check"
              />
              <div class="rr-row-main">
                <span class="rr-mono">{{ f.relativePath }}</span>
                <span v-if="f.program" class="rr-warn program"> · program or script</span>
              </div>
              <span class="rr-muted file-size">{{ size(f.size) }}</span>
              <span class="status" :class="`status-${f.status}`">{{ STATUS[f.status] }}</span>
              <v-select
                v-if="f.status === 'different'"
                v-model="actions[f.ref]"
                :items="ACTIONS"
                :disabled="!selected[f.ref]"
                density="compact"
                variant="outlined"
                hide-details
                class="action-select"
                data-testid="restore-file-action"
              />
              <span v-else class="action-select" />
            </div>
          </div>
        </div>
      </template>

      <template v-if="preview.records.length">
        <h2 class="rr-section-title section-gap">Kept as a record</h2>
        <p class="rr-row-sub records-note">
          These settings live in the Windows registry. The backup holds a copy to read; RigReady
          does not write them back. Set them again in the tool they belong to.
        </p>
        <div
          v-for="record in preview.records"
          :key="record.label + record.from"
          class="rr-panel item"
          data-testid="restore-record"
        >
          <div class="rr-row item-head">
            <v-icon icon="mdi-file-eye-outline" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">
                {{ record.label }} <span class="rr-muted source">{{ record.source }}</span>
              </div>
              <div class="rr-row-sub rr-mono">{{ record.from }}</div>
            </div>
            <span class="rr-row-sub">
              {{ record.rows.length ? `${record.rows.length} values · ` : '' }}Not restored
            </span>
            <v-btn
              :icon="openRecords.has(record.from) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
              variant="text"
              size="small"
              :aria-label="openRecords.has(record.from) ? 'Hide values' : 'Show values'"
              data-testid="restore-record-toggle"
              @click="openRecords = toggleIn(openRecords, record.from)"
            />
          </div>
          <div v-if="openRecords.has(record.from)" class="record-body">
            <div
              v-if="record.rows.length && !rawRecords.has(record.from)"
              class="record-values"
              data-testid="restore-record-values"
            >
              <template v-for="g in recordGroups(record)" :key="g.group">
                <div v-if="g.group" class="record-group" data-testid="restore-record-group">
                  {{ g.group }}
                </div>
                <div
                  v-for="(row, n) in g.rows"
                  :key="g.group + n"
                  class="record-row"
                  data-testid="restore-record-row"
                >
                  <span class="record-label">
                    {{ row.label }}
                    <span v-if="row.name" class="rr-muted rr-mono record-name">{{ row.name }}</span>
                  </span>
                  <span class="record-value rr-mono">{{ row.value }}</span>
                </div>
              </template>
              <div v-if="record.moreRows" class="rr-row-sub record-more">
                More values than are listed here; the raw view and the backup file hold all of them.
              </div>
            </div>
            <pre v-else class="record-text rr-mono" data-testid="restore-record-text"
              >{{ record.text
              }}{{ record.truncated ? '\n… (cut off; the backup file holds all of it)' : '' }}</pre>
            <div v-if="record.rows.length" class="record-foot">
              <v-btn
                variant="text"
                size="small"
                :prepend-icon="rawRecords.has(record.from) ? 'mdi-table' : 'mdi-code-json'"
                data-testid="restore-record-raw"
                @click="rawRecords = toggleIn(rawRecords, record.from)"
              >
                {{ rawRecords.has(record.from) ? 'Show as a table' : 'Show the raw values' }}
              </v-btn>
            </div>
          </div>
        </div>
      </template>

      <div
        v-if="preview.notInBackup.length"
        class="rr-row-sub mt-4"
        data-testid="restore-not-in-backup"
      >
        Not in this backup:
        {{ preview.notInBackup.map((n) => `${n.path} (${n.reason})`).join('; ') }}
      </div>

      <div class="footer rr-panel" data-testid="restore-footer">
        <div class="rr-row-main" data-testid="restore-plan">
          <template v-if="plan.total === 0">Nothing selected.</template>
          <template v-else>
            Restores {{ plural(plan.total, 'item') }}: {{ plan.fresh }} new,
            {{ plan.replace }} replaced, {{ plan.both }} kept side by side.
          </template>
        </div>
        <v-btn variant="text" to="/configure/backups">Cancel</v-btn>
        <v-btn
          color="primary"
          prepend-icon="mdi-restore"
          :disabled="plan.total === 0 || (preview.running.length > 0 && !closePrograms)"
          :loading="restoring"
          data-testid="restore-apply"
          @click="restore"
        >
          Restore
        </v-btn>
      </div>
    </template>
    <div v-else-if="!error" class="rr-panel rr-empty">Reading the backup…</div>
  </div>
</template>

<style scoped>
.back {
  margin: -12px 0 4px -12px;
}
.manifest {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 16px;
}
.conflicts {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin: 8px 0 4px;
  flex-wrap: wrap;
}
.item {
  margin-bottom: 10px;
}
.item-head {
  border-top: none;
}
.source {
  font-weight: 400;
  font-size: 12px;
  margin-left: 6px;
}
.files {
  border-top: 1px solid var(--rr-border);
  padding: 6px 16px 8px 48px;
}
.file {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  min-height: 36px;
}
.file .rr-row-main {
  overflow-wrap: anywhere;
}
.file-size {
  font-size: 12px;
  width: 64px;
  text-align: right;
}
.program {
  font-size: 12px;
}
.status {
  font-size: 12px;
  width: 84px;
  flex-shrink: 0;
  color: var(--rr-muted);
}
.status-different {
  color: var(--rr-accent);
}
.action-select {
  width: 140px;
  flex: 0 0 140px;
}
.footer {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  margin-top: 20px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
}
.result {
  padding: 16px 20px;
  margin-bottom: 16px;
}
.result-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}
.result-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.report-label {
  overflow-wrap: anywhere;
}
.running-row {
  margin-bottom: 6px;
}
.closed {
  padding: 12px 16px;
  margin-bottom: 16px;
}
.records-note {
  margin: -4px 0 8px;
}
.record-body {
  border-top: 1px solid var(--rr-border);
}
.record-values {
  max-height: 360px;
  overflow: auto;
  padding: 6px 16px 10px;
  font-size: 13px;
}
.record-group {
  font-weight: 600;
  font-size: 12.5px;
  margin-top: 10px;
  padding: 4px 0;
  border-bottom: 1px solid var(--rr-border);
}
.record-row {
  display: grid;
  grid-template-columns: minmax(200px, 2fr) minmax(120px, 1fr);
  gap: 16px;
  padding: 3px 0;
}
.record-name {
  font-size: 11.5px;
  margin-left: 6px;
}
.record-value {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.record-more {
  margin-top: 8px;
}
.record-foot {
  border-top: 1px solid var(--rr-border);
  padding: 4px 8px;
}
.record-text {
  margin: 0;
  padding: 10px 16px;
  font-size: 12px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>

<style>
/* Shared by the backup and sharing screens (not scoped: child components use them). */
.rr-section-title.section-gap {
  margin-top: 24px;
}
[data-testid='backups-page'] .v-checkbox-btn,
[data-testid='restore-page'] .v-checkbox-btn,
[data-testid='share-page'] .v-checkbox-btn {
  flex: 0 0 auto;
}
</style>
