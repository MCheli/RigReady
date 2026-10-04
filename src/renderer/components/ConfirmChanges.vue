<script setup lang="ts">
import type { ChangePreview as Preview } from '../../shared/changePreview';
import ChangePreview from './ChangePreview.vue';

/**
 * The confirmation every file-writing action asks for: what is about to happen in words
 * (default slot), then the list of files that will change, then Cancel and the action.
 * The action stays disabled until the list is there, so nothing is written unseen.
 *
 *   <ConfirmChanges :open="asking" title="Point iRacing at the new id?" confirm-text="Update iRacing"
 *     :preview="preview" :error="previewError" :busy="busy" testid="iracing-repair"
 *     @cancel="asking = false" @confirm="apply">…what it does…</ConfirmChanges>
 *
 * Test ids: `<testid>-confirm` (the card), `<testid>-go`, `<testid>-cancel`.
 */
withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    confirmText: string;
    preview?: Preview | undefined;
    error?: string | undefined;
    busy?: boolean;
    testid?: string;
    maxWidth?: number | string;
    /** The action is refused for another reason (a program is running, say). */
    blocked?: boolean;
  }>(),
  {
    preview: undefined,
    error: undefined,
    busy: false,
    testid: 'changes',
    maxWidth: 580,
    blocked: false,
  }
);
const emit = defineEmits<{ cancel: []; confirm: [] }>();
</script>

<template>
  <v-dialog
    :model-value="open"
    :max-width="maxWidth"
    scrollable
    persistent
    @keydown.esc="emit('cancel')"
  >
    <v-card v-if="open" :data-testid="`${testid}-confirm`">
      <v-card-title class="confirm-changes-title">{{ title }}</v-card-title>
      <v-card-text>
        <div class="mb-3"><slot /></div>
        <ChangePreview :preview="preview" :error="error" />
        <p class="confirm-changes-safety rr-muted">
          Each file is backed up first; Undo is on the Safety page.
        </p>
        <slot name="after" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :data-testid="`${testid}-cancel`" @click="emit('cancel')">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :loading="busy"
          :disabled="!preview || blocked"
          :data-testid="`${testid}-go`"
          @click="emit('confirm')"
        >
          {{ confirmText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.confirm-changes-title {
  white-space: normal;
  line-height: 1.35;
}
.confirm-changes-safety {
  font-size: 12.5px;
  margin: 10px 0 0;
}
</style>
