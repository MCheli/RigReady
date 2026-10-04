<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PlanView } from '../core/model';
import { useAiStore } from './store';

/**
 * Exactly what a change will write, file by file, as the bindings feature planned it.
 * Writing goes through the bindings feature too: backup first, one undoable change.
 */
const store = useAiStore();
const open = ref(new Set<number>());
const review = computed(() => store.review);
const plan = computed(() => review.value?.plan);

watch(
  () => review.value?.source,
  () => (open.value = new Set())
);

const ACTION: Record<PlanView['files'][number]['action'], string> = {
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

const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p;
const folder = (p: string): string => p.split(/[\\/]/).slice(0, -1).join('\\');
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
    <v-card v-if="review" data-testid="ai-review-dialog">
      <v-card-title class="rv-title">{{ plan?.summary ?? 'Preparing the preview…' }}</v-card-title>
      <v-card-text class="rv-body">
        <v-alert
          v-if="review.error"
          type="error"
          variant="tonal"
          class="mb-3"
          data-testid="ai-review-error"
        >
          {{ review.error }}
        </v-alert>
        <v-alert
          v-if="plan?.blocked"
          type="warning"
          variant="tonal"
          class="mb-3"
          data-testid="ai-review-blocked"
        >
          {{ plan.blocked }}
        </v-alert>
        <div v-if="review.busy && !plan" class="rr-muted">Working out what would change…</div>
        <template v-if="plan">
          <p class="rv-lead">
            <template v-if="plan.files.length > 0">
              This is everything that will be written to DCS's binding files. Each file is backed up
              first, and the whole change can be undone from here or from the Safety page.
            </template>
            <template v-else>Nothing would change: the files already look like this.</template>
          </p>
          <div v-for="(note, i) in plan.notes" :key="`n${i}`" class="rv-note">
            <v-icon icon="mdi-information-outline" size="16" /> {{ note }}
          </div>
          <div
            v-for="(file, index) in plan.files"
            :key="index"
            class="rr-panel rv-file"
            data-testid="ai-review-file"
            :data-action="file.action"
          >
            <div class="rv-file-head">
              <span class="rv-chip">{{ ACTION[file.action] }}</span>
              <span class="rr-row-title">{{ file.title }}</span>
            </div>
            <div class="rr-mono rr-muted rv-path">{{ fileName(file.path) }}</div>
            <div class="rr-mono rr-muted rv-path">in {{ folder(file.path) }}</div>
            <ul class="rv-lines">
              <li v-for="(line, n) in file.lines" :key="n">{{ line }}</li>
            </ul>
            <v-btn
              v-if="file.diff.length > 0"
              size="x-small"
              variant="text"
              :prepend-icon="open.has(index) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
              data-testid="ai-review-toggle-diff"
              @click="toggle(index)"
            >
              {{ open.has(index) ? 'Hide the exact text' : 'Show the exact text' }}
            </v-btn>
            <div v-if="open.has(index)" class="rv-diff rr-mono" data-testid="ai-review-diff">
              <div v-for="(line, n) in file.diff" :key="n" :class="`rv-diff-${line.type}`">
                {{ PREFIX[line.type] }}{{ line.text }}
              </div>
            </div>
          </div>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="ai-review-cancel" @click="store.review = undefined"
          >Cancel</v-btn
        >
        <v-btn
          color="primary"
          :disabled="!canApply"
          :loading="review.busy && plan !== undefined"
          data-testid="ai-review-apply"
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
.rv-title {
  white-space: normal;
  font-size: 17px;
  line-height: 1.35;
}
.rv-body {
  max-height: 68vh;
}
.rv-lead {
  color: var(--rr-muted);
  font-size: 13.5px;
  margin: 0 0 12px;
}
.rv-note {
  display: flex;
  gap: 8px;
  font-size: 13px;
  color: var(--rr-warn);
  margin-bottom: 10px;
}
.rv-file {
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--rr-surface-2);
}
.rv-file-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rv-chip {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--rr-accent);
  border: 1px solid var(--rr-border);
  border-radius: 6px;
  padding: 1px 7px;
}
.rv-path {
  overflow-wrap: anywhere;
}
.rv-lines {
  margin: 8px 0 4px;
  padding-left: 18px;
  font-size: 13.5px;
}
.rv-diff {
  margin-top: 8px;
  padding: 10px 12px;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  overflow-x: auto;
  max-height: 320px;
  line-height: 1.45;
}
.rv-diff > div {
  white-space: pre;
}
.rv-diff-add {
  background: rgba(90, 169, 230, 0.14);
}
.rv-diff-del,
.rv-diff-same,
.rv-diff-gap {
  color: var(--rr-muted);
}
</style>
