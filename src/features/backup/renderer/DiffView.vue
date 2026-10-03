<script setup lang="ts">
import { ref } from 'vue';
import type { ComparisonView } from '../contract';
import { plural } from './format';

defineProps<{ comparison: ComparisonView; emptyText: string }>();

const open = ref(new Set<string>());
function toggle(key: string): void {
  const next = new Set(open.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  open.value = next;
}

const STATUS = { added: 'Added', removed: 'Removed', changed: 'Changed' } as const;
</script>

<template>
  <div data-testid="diff-view">
    <div v-if="comparison.changes.length === 0" class="rr-panel rr-empty" data-testid="diff-none">
      {{ emptyText }}
    </div>
    <div v-else class="rr-panel">
      <div
        v-for="change in comparison.changes"
        :key="change.key"
        class="diff-file"
        data-testid="diff-file"
        :data-status="change.status"
        :data-key="change.key"
      >
        <div class="rr-row diff-head">
          <v-btn
            v-if="change.diff"
            :icon="open.has(change.key) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
            variant="text"
            size="small"
            density="comfortable"
            :aria-label="open.has(change.key) ? 'Hide the lines' : 'Show the lines'"
            data-testid="diff-toggle"
            @click="toggle(change.key)"
          />
          <span v-else class="diff-spacer" />
          <span class="diff-status" :class="`diff-status-${change.status}`">
            {{ STATUS[change.status] }}
          </span>
          <div class="rr-row-main">
            <div class="rr-mono diff-key">{{ change.key }}</div>
            <div v-if="change.diff" class="rr-row-sub" data-testid="diff-summary">
              {{ plural(change.diff.added, 'line') }} added, {{ change.diff.removed }} removed
            </div>
            <div v-else-if="change.binary" class="rr-row-sub">
              Not a text file: it {{ change.status === 'changed' ? 'is different' : 'differs' }}.
            </div>
            <div v-if="change.note" class="rr-row-sub">{{ change.note }}</div>
          </div>
        </div>
        <div v-if="change.diff && open.has(change.key)" class="diff-body" data-testid="diff-lines">
          <div v-if="change.diff.tooLarge" class="rr-row-sub diff-note">
            Too different to line up; showing the whole old and new text.
          </div>
          <div v-for="(hunk, h) in change.diff.hunks" :key="h" class="hunk">
            <div class="hunk-head rr-mono">line {{ hunk.oldStart }} → {{ hunk.newStart }}</div>
            <div
              v-for="(line, i) in hunk.lines"
              :key="i"
              class="line rr-mono"
              :class="{ add: line.kind === '+', del: line.kind === '-' }"
            >
              <span class="sign">{{ line.kind === ' ' ? '' : line.kind }}</span
              >{{ line.text }}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="comparison.unchanged > 0" class="rr-row-sub mt-2" data-testid="diff-unchanged">
      {{ plural(comparison.unchanged, 'other file') }} unchanged.
    </div>
  </div>
</template>

<style scoped>
.diff-file {
  border-top: 1px solid var(--rr-border);
}
.diff-file:first-child {
  border-top: none;
}
.diff-head {
  border-top: none;
}
.diff-spacer {
  width: 36px;
  flex-shrink: 0;
}
.diff-status {
  font-size: 12px;
  width: 64px;
  flex-shrink: 0;
  color: var(--rr-muted);
}
.diff-status-changed,
.diff-status-added {
  color: var(--rr-accent);
}
.diff-key {
  overflow-wrap: anywhere;
}
.diff-body {
  padding: 0 16px 12px 52px;
}
.diff-note {
  margin-bottom: 6px;
}
.hunk {
  border: 1px solid var(--rr-border);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
  background: var(--rr-bg);
}
.hunk-head {
  padding: 2px 8px;
  color: var(--rr-muted);
  background: var(--rr-surface-2);
  font-size: 11px;
}
.line {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 0 8px;
  font-size: 12px;
  line-height: 1.5;
}
.line.add {
  background: rgba(90, 169, 230, 0.16);
}
.line.del {
  background: rgba(139, 149, 163, 0.14);
  color: var(--rr-muted);
  text-decoration: line-through;
  text-decoration-color: rgba(139, 149, 163, 0.5);
}
.sign {
  display: inline-block;
  width: 14px;
  color: var(--rr-muted);
}
</style>
