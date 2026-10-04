<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ChangeKind, ChangePreview } from '../../shared/changePreview';

/**
 * "This is what will change": the files a write outside RigReady's folder will create,
 * modify, rename or delete, shown before anything is written. Every feature that writes
 * game or tool files shows its plan with this list (main builds it with `changePreview()`
 * from src/core/files/preview.ts). Each kind of change has its own icon and word, so the
 * list reads without colour.
 */
const props = withDefaults(
  defineProps<{
    /** Undefined while main is still working it out. */
    preview?: ChangePreview | undefined;
    /** Set when the preview could not be made; the caller must then not offer the write. */
    error?: string | undefined;
    /** Shown while `preview` is undefined. */
    loadingText?: string;
    /** Files left as they are are listed too (default), or only counted in the summary. */
    showUnchanged?: boolean;
    /** More files than this are folded behind "Show all". */
    limit?: number;
  }>(),
  {
    preview: undefined,
    error: undefined,
    loadingText: 'Comparing with the files on disk…',
    showUnchanged: true,
    limit: 12,
  }
);

const LOOK: Record<ChangeKind, { icon: string; word: string }> = {
  created: { icon: 'mdi-file-plus-outline', word: 'New' },
  modified: { icon: 'mdi-file-edit-outline', word: 'Changed' },
  renamed: { icon: 'mdi-file-move-outline', word: 'Renamed' },
  deleted: { icon: 'mdi-file-remove-outline', word: 'Deleted' },
  unchanged: { icon: 'mdi-file-check-outline', word: 'Same as now' },
};

const all = ref(false);
const rows = computed(() =>
  (props.preview?.files ?? []).filter((f) => props.showUnchanged || f.change !== 'unchanged')
);
const shown = computed(() => (all.value ? rows.value : rows.value.slice(0, props.limit)));
</script>

<template>
  <div class="change-preview" data-testid="change-preview">
    <div v-if="error" class="rr-bad" role="alert" data-testid="change-preview-error">
      <v-icon icon="mdi-alert-circle" size="16" />
      What it would change could not be worked out: {{ error }}
    </div>
    <div v-else-if="!preview" class="rr-muted" data-testid="change-preview-loading">
      {{ loadingText }}
    </div>
    <template v-else>
      <div class="change-preview-summary" data-testid="change-preview-summary">
        {{ preview.summary }}
      </div>
      <ul class="change-preview-list">
        <li
          v-for="file in shown"
          :key="`${file.change}|${file.path}`"
          class="change-preview-file"
          :class="`is-${file.change}`"
          data-testid="change-preview-file"
          :data-change="file.change"
        >
          <v-icon :icon="LOOK[file.change].icon" size="17" class="change-preview-icon" />
          <div class="change-preview-main">
            <div>
              <span class="change-preview-label">{{ file.label }}</span>
              <span class="change-preview-word">{{ LOOK[file.change].word }}</span>
            </div>
            <div class="rr-row-sub">{{ file.detail }}</div>
            <div class="rr-row-sub rr-mono">{{ file.path }}</div>
          </div>
        </li>
      </ul>
      <button
        v-if="rows.length > limit"
        type="button"
        class="change-preview-more"
        data-testid="change-preview-more"
        :aria-expanded="all"
        @click="all = !all"
      >
        <v-icon :icon="all ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
        {{ all ? 'Show fewer' : `Show all ${rows.length} files` }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.change-preview-summary {
  font-weight: 600;
  margin-bottom: 6px;
}
.change-preview-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.change-preview-file {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  padding: 4px 0;
}
.change-preview-icon {
  margin-top: 1px;
  color: var(--rr-accent);
  flex: none;
}
.is-unchanged .change-preview-icon {
  color: var(--rr-muted);
}
.change-preview-main {
  min-width: 0;
}
.change-preview-label {
  overflow-wrap: anywhere;
}
.change-preview-word {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--rr-accent);
  border: 1px solid var(--rr-border);
  border-radius: 6px;
  padding: 0 6px;
  white-space: nowrap;
}
.is-unchanged .change-preview-word {
  color: var(--rr-muted);
}
.change-preview-more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: 4px;
  padding: 2px 0;
  font-size: 12.5px;
  color: var(--rr-accent);
  background: none;
  border: none;
  cursor: pointer;
}
</style>
