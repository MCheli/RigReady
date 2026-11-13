<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAiStore } from './store';

/**
 * The guide file of the user's own for the aircraft shown: import one, start one by hand,
 * open the one that is kept, read it again after an edit, delete it. Shown for every aircraft
 * RigReady ships no guide for. None of it needs an AI key.
 */
defineProps<{ centered?: boolean }>();

const store = useAiStore();
const guide = computed(() => store.guide);
const kept = computed(() => guide.value?.stored ?? null);

/** Deleting asks first: the file is in the data folder, where nothing keeps a copy of it. */
const deleting = ref(false);
watch(
  () => store.aircraftId,
  () => (deleting.value = false)
);

async function remove(): Promise<void> {
  deleting.value = false;
  await store.deleteDraft();
}
</script>

<template>
  <div
    v-if="guide && guide.guide?.kind !== 'shipped'"
    class="guide-file"
    :class="{ centered }"
    data-testid="ai-guide-file"
  >
    <v-alert
      v-if="kept?.problem"
      type="warning"
      variant="tonal"
      density="compact"
      class="guide-file-line"
      data-testid="ai-guide-problem"
    >
      The guide file kept for the {{ guide.aircraftName }} cannot be used as it is.
      {{ kept.problem }}
    </v-alert>
    <p v-else-if="guide.guide?.kind === 'own'" class="guide-file-line" data-testid="ai-guide-own">
      This is a guide of your own: a file in RigReady's data folder. Open it to change it, save,
      then read it again.
    </p>
    <div class="guide-file-actions">
      <template v-if="kept">
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-file-document-edit-outline"
          data-testid="ai-guide-open"
          @click="store.openGuideFile()"
        >
          Open the file
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-refresh"
          data-testid="ai-guide-reload"
          @click="store.reloadGuide()"
        >
          Read it again
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-delete-outline"
          data-testid="ai-guide-delete"
          @click="deleting = true"
        >
          Delete this guide
        </v-btn>
      </template>
      <template v-else>
        <v-btn
          size="small"
          color="primary"
          variant="tonal"
          prepend-icon="mdi-file-import-outline"
          data-testid="ai-guide-import"
          @click="store.importGuide()"
        >
          Import a guide file
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-pencil-outline"
          data-testid="ai-guide-start"
          @click="store.startOwnGuide()"
        >
          Write your own
        </v-btn>
      </template>
    </div>
    <p v-if="store.guideNote" class="guide-file-line rr-ok" data-testid="ai-guide-note">
      {{ store.guideNote }}
    </p>

    <v-dialog v-model="deleting" max-width="460">
      <v-card data-testid="ai-guide-delete-dialog">
        <v-card-title>Delete this guide?</v-card-title>
        <v-card-text>
          The guide file for the {{ guide.aircraftName }} is removed from RigReady's data folder. A
          file you imported it from stays where it is, and your bindings are not touched. This
          cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="ai-guide-delete-no" @click="deleting = false">
            Keep it
          </v-btn>
          <v-btn color="primary" data-testid="ai-guide-delete-yes" @click="remove">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.guide-file {
  margin-top: 12px;
  font-size: 13.5px;
}
.guide-file-line {
  margin: 0 0 10px;
  text-align: left;
}
.guide-file-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.guide-file-actions + .guide-file-line {
  margin: 10px 0 0;
}
.centered .guide-file-actions {
  justify-content: center;
}
.centered .guide-file-line {
  text-align: center;
}
</style>
