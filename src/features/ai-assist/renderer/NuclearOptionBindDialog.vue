<script setup lang="ts">
import { computed } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import { useAiStore } from './store';

/**
 * Nuclear Option, in the walkthrough: the button or key the user just pressed, or the axis
 * they moved, as the Nuclear Option bindings feature works it out (what the action is on now
 * and would be on, what else that control does, the saved bindings it changes), before
 * anything is written. Save writes it
 * through that feature, with a backup first and Undo on the Safety page.
 */
const store = useAiStore();
const current = computed(() => store.nuclearOptionBinding);
const review = computed(() => current.value?.review);

/** "A", "A and B", "A, B and C". */
const listed = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
</script>

<template>
  <ConfirmChanges
    :open="review !== undefined"
    :title="review ? `Bind ${review.label} to ${review.after}?` : ''"
    confirm-text="Save"
    :preview="review?.preview"
    :busy="current?.busy ?? false"
    :blocked="!!review?.blocked || !!review?.same"
    :max-width="640"
    testid="ai-nuclear-option-save"
    @cancel="store.cancelNuclearOption()"
    @confirm="store.saveNuclearOption()"
  >
    <template v-if="review">
      <dl class="nob-change">
        <dt>On</dt>
        <dd data-testid="ai-nuclear-option-device">{{ review.device }}</dd>
        <dt>Now</dt>
        <dd data-testid="ai-nuclear-option-before">{{ review.before }}</dd>
        <dt>After saving</dt>
        <dd data-testid="ai-nuclear-option-after">{{ review.after }}</dd>
      </dl>
      <v-checkbox
        v-if="current?.binding.kind === 'axis'"
        :model-value="current.binding.invert"
        label="Reversed"
        density="compact"
        hide-details
        class="mt-2"
        data-testid="ai-nuclear-option-invert"
        @update:model-value="store.reverseNuclearOption($event === true)"
      />
      <v-alert
        v-if="review.blocked"
        type="warning"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-testid="ai-nuclear-option-blocked"
        >{{ review.blocked }}</v-alert
      >
      <div v-if="review.same" class="nob-note mt-3" data-testid="ai-nuclear-option-same">
        <v-icon icon="mdi-information-outline" size="16" class="rr-muted" />
        <span>{{ review.label }} is already there. There is nothing to save.</span>
      </div>
      <v-alert
        v-else-if="review.alsoOnButton.length"
        type="warning"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-testid="ai-nuclear-option-conflict"
      >
        {{ review.after }} already does {{ listed(review.alsoOnButton) }}. After saving, one press
        does {{ review.alsoOnButton.length === 1 ? 'both' : 'all of them' }}. RigReady leaves the
        other {{ review.alsoOnButton.length === 1 ? 'binding as it is' : 'bindings as they are' }}.
      </v-alert>
    </template>
    <template #after>
      <p class="nob-undo">
        RigReady changes this one binding in what Nuclear Option saved and leaves the rest as it
        was. The game reads it the next time it starts.
      </p>
      <v-alert
        v-if="current?.error"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-testid="ai-nuclear-option-error"
        >{{ current.error }}</v-alert
      >
    </template>
  </ConfirmChanges>
</template>

<style scoped>
.nob-change {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
  font-size: 13.5px;
}
.nob-change dt {
  color: var(--rr-muted);
}
.nob-change dd {
  margin: 0;
  font-weight: 600;
}
.nob-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
}
.nob-undo {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: var(--rr-muted);
}
</style>
