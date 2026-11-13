<script setup lang="ts">
import { computed } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import { useAiStore } from './store';

/**
 * iRacing, in the walkthrough: the binding the user just pressed, as the iRacing bindings
 * feature works it out (what the action has now and would have, what else the same button or
 * key does, the file), before anything is written. "Save in iRacing’s file" writes it through
 * that feature, with a backup first and Undo on the Safety page.
 */
const store = useAiStore();
const current = computed(() => store.iracingBinding);
const review = computed(() => current.value?.review);

/** "A", "A and B", "A, B and C". */
const listed = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

const alsoDriving = computed(() =>
  (review.value?.conflicts ?? []).filter((c) => !c.cameraEditor).map((c) => c.name)
);
const alsoCamera = computed(() =>
  (review.value?.conflicts ?? []).filter((c) => c.cameraEditor).map((c) => c.name)
);
</script>

<template>
  <ConfirmChanges
    :open="review !== undefined"
    :title="review ? `Bind ${review.label} to ${review.after}?` : ''"
    confirm-text="Save in iRacing’s file"
    :preview="review?.preview"
    :busy="current?.busy ?? false"
    :blocked="!!review?.blocked || !!review?.same"
    :max-width="640"
    testid="ai-iracing-save"
    @cancel="store.cancelIracing()"
    @confirm="store.saveIracing()"
  >
    <template v-if="review">
      <dl class="air-change">
        <dt>Now</dt>
        <dd data-testid="ai-iracing-before">{{ review.before }}</dd>
        <dt>After saving</dt>
        <dd data-testid="ai-iracing-after">{{ review.after }}</dd>
        <dt>For</dt>
        <dd data-testid="ai-iracing-set">{{ review.forCars }}</dd>
      </dl>
      <v-alert
        v-if="review.blocked"
        type="warning"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-testid="ai-iracing-blocked"
        >{{ review.blocked }}</v-alert
      >
      <div v-if="review.same" class="air-note mt-3" data-testid="ai-iracing-same">
        <v-icon icon="mdi-information-outline" size="16" class="rr-muted" />
        <span>{{ review.label }} already has this. There is nothing to save.</span>
      </div>
      <template v-else>
        <v-alert
          v-if="alsoDriving.length"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="ai-iracing-conflict"
        >
          {{ review.after }} already does {{ listed(alsoDriving) }}. After saving, one press does
          {{ alsoDriving.length === 1 ? 'both' : 'all of them' }}. RigReady leaves the other
          {{ alsoDriving.length === 1 ? 'binding as it is' : 'bindings as they are' }}.
        </v-alert>
        <div v-if="alsoCamera.length" class="air-note mt-3" data-testid="ai-iracing-camera">
          <v-icon icon="mdi-video-outline" size="16" class="rr-muted" />
          <span>
            In iRacing’s camera editor the same key is {{ listed(alsoCamera) }}. iRacing’s own
            default keys are shared like this.
          </span>
        </div>
      </template>
    </template>
    <template #after>
      <p class="air-undo">
        RigReady changes this one binding and leaves the rest of the file as it was.
      </p>
      <v-alert
        v-if="current?.error"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-testid="ai-iracing-error"
        >{{ current.error }}</v-alert
      >
    </template>
  </ConfirmChanges>
</template>

<style scoped>
.air-change {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
  font-size: 13.5px;
}
.air-change dt {
  color: var(--rr-muted);
}
.air-change dd {
  margin: 0;
  font-weight: 600;
}
.air-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
}
.air-undo {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: var(--rr-muted);
}
</style>
