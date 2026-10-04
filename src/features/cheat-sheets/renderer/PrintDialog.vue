<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText } from '../../../renderer/ipc';
import { printDocument, type PaperSize } from '../core/pages';
import { useCheatSheets } from './store';

/**
 * Print or save as PDF: one page per chosen device and a summary page. "Save as PDF"
 * renders the document in main; "Print" hands the same pages to the system's print
 * dialog (the app itself is hidden from the printout by a print style sheet).
 */
const emit = defineEmits<{ close: [] }>();
const store = useCheatSheets();

const chosen = ref<string[]>(
  (store.sheet?.devices ?? []).filter((d) => d.counts.bound > 0).map((d) => d.key)
);
const paper = ref<PaperSize>('A4');
const summary = ref(true);
const busy = ref(false);
const error = ref('');
const saved = ref<{ path: string; pages: number }>();

let style: HTMLStyleElement | undefined;
let root: HTMLDivElement | undefined;

function pages() {
  const sheet = store.sheet!;
  return printDocument(
    sheet,
    sheet.devices.filter((d) => chosen.value.includes(d.key)),
    { paper: paper.value, summary: summary.value, stamp: new Date().toISOString().slice(0, 10) }
  );
}

async function savePdf(): Promise<void> {
  busy.value = true;
  error.value = '';
  saved.value = undefined;
  const result = await store.api.savePdf({
    game: store.game,
    aircraftId: store.aircraftId,
    devices: chosen.value,
    paper: paper.value,
    summary: summary.value,
  });
  busy.value = false;
  if (!result.ok) error.value = errorText(result.error);
  else if (result.value.path) saved.value = { path: result.value.path, pages: result.value.pages };
}

async function print(): Promise<void> {
  const document_ = pages();
  // The pages go into a container that only a printout shows; everything else is hidden from it.
  style!.textContent =
    `@media print{${document_.css}body>*:not(#cs-print-root){display:none!important}` +
    `#cs-print-root{display:block!important}}` +
    `@page{size:${paper.value} portrait;margin:10mm}`;
  root!.innerHTML = document_.body;
  root!.dataset['pages'] = String(document_.pages);
  await nextTick();
  window.print();
}

onMounted(() => {
  style = document.createElement('style');
  style.dataset['cheatSheets'] = 'print';
  document.head.appendChild(style);
  root = document.createElement('div');
  root.id = 'cs-print-root';
  root.style.display = 'none';
  document.body.appendChild(root);
});
onBeforeUnmount(() => {
  style?.remove();
  root?.remove();
});
</script>

<template>
  <v-dialog :model-value="true" max-width="560" @update:model-value="emit('close')">
    <v-card data-testid="print-dialog">
      <v-card-title>Print or save as PDF</v-card-title>
      <v-card-text>
        <p class="rr-muted mb-3">
          One page per device with the aircraft and device name on top, on plain white for printing.
        </p>
        <div class="rr-section-title">Devices</div>
        <div class="print-devices">
          <v-checkbox
            v-for="d in store.sheet?.devices ?? []"
            :key="d.key"
            v-model="chosen"
            :value="d.key"
            :label="`${d.title} (${d.counts.bound} bound)`"
            density="compact"
            hide-details
            data-testid="print-device"
            :data-key="d.key"
          />
        </div>
        <v-checkbox
          v-model="summary"
          label="Add a summary page of the most important actions"
          density="compact"
          hide-details
          data-testid="print-summary"
        />
        <v-radio-group v-model="paper" inline hide-details class="mt-2" label="Paper">
          <v-radio label="A4" value="A4" data-testid="print-a4" />
          <v-radio label="US Letter" value="Letter" data-testid="print-letter" />
        </v-radio-group>
        <v-alert v-if="error" type="warning" variant="tonal" class="mt-3" data-testid="print-error">
          {{ error }}
        </v-alert>
        <v-alert
          v-if="saved"
          type="info"
          variant="tonal"
          class="mt-3"
          data-testid="print-saved"
          :data-pages="saved.pages"
        >
          Saved {{ saved.pages }} page{{ saved.pages === 1 ? '' : 's' }} to {{ saved.path }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="print-close" @click="emit('close')">Close</v-btn>
        <v-btn
          variant="text"
          prepend-icon="mdi-printer-outline"
          :disabled="chosen.length === 0 && !summary"
          data-testid="print-print"
          @click="print"
          >Print…</v-btn
        >
        <v-btn
          color="primary"
          variant="flat"
          :loading="busy"
          :disabled="chosen.length === 0 && !summary"
          data-testid="print-save"
          @click="savePdf"
          >Save as PDF…</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.print-devices {
  max-height: 260px;
  overflow-y: auto;
  margin-bottom: 6px;
}
</style>
