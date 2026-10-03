<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PlannedFile } from '../core/model';
import { useBindingsStore } from './store';

/** Shows exactly what a change will write, file by file, before it is written. */
const store = useBindingsStore();
const open = ref(new Set<number>());
const review = computed(() => store.review);
const plan = computed(() => review.value?.plan);

watch(
  () => review.value?.request,
  () => (open.value = new Set())
);

const ACTION: Record<PlannedFile['action'], string> = {
  create: 'New file',
  change: 'Changed',
  delete: 'Deleted',
  rename: 'Renamed',
};

const PREFIX = { add: '+ ', del: '− ', gap: '  ⋯ ', same: '  ' } as const;

function toggle(index: number): void {
  const next = new Set(open.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  open.value = next;
}

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
const folder = (path: string): string => path.split(/[\\/]/).slice(0, -1).join('\\');
const canApply = computed(
  () => plan.value !== undefined && !plan.value.blocked && plan.value.files.length > 0
);
</script>

<template>
  <v-dialog
    :model-value="review !== undefined"
    max-width="820"
    scrollable
    persistent
    @keydown.esc="store.review = undefined"
  >
    <v-card v-if="review" data-testid="plan-dialog">
      <v-card-title class="plan-title">
        {{ plan?.summary ?? 'Preparing the preview…' }}
      </v-card-title>
      <v-card-text class="plan-body">
        <v-alert
          v-if="review.error"
          type="error"
          variant="tonal"
          class="mb-3"
          data-testid="plan-error"
        >
          {{ review.error }}
        </v-alert>
        <v-alert
          v-if="plan?.blocked"
          type="warning"
          variant="tonal"
          class="mb-3"
          data-testid="plan-blocked"
        >
          {{ plan.blocked }}
        </v-alert>
        <div v-if="review.busy && !plan" class="rr-muted">Working out what would change…</div>

        <template v-if="plan">
          <p class="plan-lead">
            <template v-if="plan.files.length > 0">
              This is everything RigReady will write. Each file is backed up first, and the whole
              change can be undone from here or from the Safety page.
            </template>
            <template v-else>Nothing would change: the files already look like this.</template>
          </p>
          <div
            v-for="(note, index) in plan.notes"
            :key="index"
            class="plan-note"
            data-testid="plan-note"
          >
            <v-icon icon="mdi-information-outline" size="16" /> {{ note }}
          </div>

          <div
            v-for="(file, index) in plan.files"
            :key="index"
            class="rr-panel plan-file"
            data-testid="plan-file"
            :data-action="file.action"
          >
            <div class="plan-file-head">
              <span class="plan-chip">{{ ACTION[file.action] }}</span>
              <span class="rr-row-title">{{ file.title }}</span>
            </div>
            <div class="rr-mono rr-muted plan-path">
              {{ fileName(file.path) }}
              <template v-if="file.to"> → {{ fileName(file.to) }}</template>
            </div>
            <div class="rr-mono rr-muted plan-path">in {{ folder(file.path) }}</div>
            <ul class="plan-lines">
              <li v-for="(line, n) in file.lines.slice(0, 8)" :key="n">{{ line }}</li>
              <li v-if="file.lines.length > 8 && !open.has(index)" class="rr-muted">
                and {{ file.lines.length - 8 }} more
              </li>
              <template v-if="open.has(index)">
                <li v-for="(line, n) in file.lines.slice(8)" :key="`more-${n}`">{{ line }}</li>
              </template>
            </ul>
            <v-btn
              v-if="file.diff.length > 0 || file.lines.length > 8"
              size="x-small"
              variant="text"
              :prepend-icon="open.has(index) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
              data-testid="plan-toggle-diff"
              @click="toggle(index)"
            >
              {{ open.has(index) ? 'Hide the exact text' : 'Show the exact text' }}
            </v-btn>
            <div
              v-if="open.has(index) && file.diff.length > 0"
              class="plan-diff rr-mono"
              data-testid="plan-diff"
            >
              <div v-for="(line, n) in file.diff" :key="n" :class="`plan-diff-${line.type}`">
                {{ PREFIX[line.type] }}{{ line.text }}
              </div>
            </div>
          </div>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="plan-cancel" @click="store.review = undefined">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!canApply"
          :loading="review.busy && plan !== undefined"
          data-testid="plan-apply"
          @click="store.applyReview()"
        >
          {{
            plan && plan.files.length > 1 ? `Write ${plan.files.length} files` : 'Write the change'
          }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.plan-title {
  white-space: normal;
  font-size: 17px;
  line-height: 1.35;
  padding-bottom: 4px;
}
.plan-body {
  max-height: 68vh;
}
.plan-lead {
  color: var(--rr-muted);
  font-size: 13.5px;
  margin: 0 0 12px;
}
.plan-note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 13px;
  color: var(--rr-warn);
  margin-bottom: 10px;
}
.plan-file {
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--rr-surface-2);
}
.plan-file-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 2px;
}
.plan-chip {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--rr-accent);
  border: 1px solid var(--rr-border);
  border-radius: 6px;
  padding: 1px 7px;
  white-space: nowrap;
}
.plan-path {
  overflow-wrap: anywhere;
}
.plan-lines {
  margin: 8px 0 4px;
  padding-left: 18px;
  font-size: 13.5px;
}
.plan-diff {
  margin: 8px 0 0;
  padding: 10px 12px;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  overflow-x: auto;
  max-height: 320px;
  tab-size: 2;
  line-height: 1.45;
}
.plan-diff > div {
  white-space: pre;
}
.plan-diff-add {
  color: var(--rr-text);
  background: rgba(90, 169, 230, 0.14);
}
.plan-diff-del {
  color: var(--rr-muted);
  background: rgba(139, 149, 163, 0.1);
}
.plan-diff-same,
.plan-diff-gap {
  color: var(--rr-muted);
}
</style>
