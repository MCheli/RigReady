<script setup lang="ts">
import { ref } from 'vue';

/** A web page opened in the user's browser only after they confirm where it goes. */
const props = withDefaults(
  defineProps<{
    url: string;
    label: string;
    testid?: string;
    variant?: 'tonal' | 'text' | 'flat';
    icon?: string;
  }>(),
  { testid: 'external-link', variant: 'tonal', icon: 'mdi-open-in-new' }
);

const asking = ref(false);
const host = (): string => {
  try {
    return new URL(props.url).host;
  } catch {
    return props.url;
  }
};

function open(): void {
  asking.value = false;
  window.open(props.url, '_blank');
}
</script>

<template>
  <v-btn
    size="small"
    :variant="variant"
    :append-icon="icon"
    :data-testid="testid"
    @click="asking = true"
  >
    {{ label }}
  </v-btn>
  <v-dialog v-model="asking" max-width="480">
    <v-card data-testid="external-confirm">
      <v-card-title>Open {{ host() }}?</v-card-title>
      <v-card-text>
        RigReady will open this page in your web browser:
        <div class="rr-mono external-url">{{ url }}</div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="external-cancel" @click="asking = false">Cancel</v-btn>
        <v-btn color="primary" data-testid="external-open" @click="open">Open in browser</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.external-url {
  margin-top: 8px;
  overflow-wrap: anywhere;
  color: var(--rr-muted);
}
</style>
