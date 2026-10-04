<script setup lang="ts">
import { computed } from 'vue';

/** A line diff: changed lines with a little unchanged context around them, the rest folded. */
const props = withDefaults(
  defineProps<{
    lines: { kind: 'same' | 'added' | 'removed'; text: string }[];
    /** Unchanged lines kept around each change; -1 shows everything. */
    context?: number;
  }>(),
  { context: 2 }
);

const rows = computed(() => {
  const { lines, context } = props;
  if (context < 0) return lines.map((line) => ({ ...line, fold: false }));
  const near = lines.map((_, i) =>
    lines.some((l, j) => l.kind !== 'same' && Math.abs(i - j) <= context)
  );
  const out: { kind: string; text: string; fold: boolean }[] = [];
  lines.forEach((line, i) => {
    if (near[i]) out.push({ ...line, fold: false });
    else if (out.length === 0 || !out[out.length - 1]!.fold) {
      out.push({ kind: 'same', text: '', fold: true });
    }
  });
  return out;
});

const SIGN = { added: '+ ', removed: '− ', same: '  ' } as const;
</script>

<template>
  <pre
    class="diff rr-mono"
    data-testid="diff-view"
  ><template v-for="(row, i) in rows" :key="i"><span v-if="row.fold" class="diff-fold">  …
</span><span v-else class="rr-no-icon" :class="row.kind === 'added' ? 'rr-ok' : row.kind === 'removed' ? 'rr-bad' : 'diff-same'">{{ SIGN[row.kind as 'same'] }}{{ row.text }}
</span></template></pre>
</template>

<style scoped>
.diff {
  margin: 0;
  padding: 10px 12px;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  white-space: pre;
  overflow: auto;
  max-height: 360px;
}
.diff-same,
.diff-fold {
  color: var(--rr-muted);
}
</style>
