<script setup lang="ts">
import { computed, ref } from 'vue';
import { parseMarkdown, type Inline } from './markdown';

const props = defineProps<{ source: string }>();
const blocks = computed(() => parseMarkdown(props.source));
const pending = ref<string>();

function open(): void {
  const url = pending.value;
  pending.value = undefined;
  // The main process opens https links in the default browser, never inside the app.
  if (url) window.open(url, '_blank', 'noopener');
}

const key = (part: Inline, index: number): string => `${index}-${part.kind}`;
</script>

<template>
  <div class="md" data-testid="instructions">
    <template v-for="(block, b) in blocks" :key="b">
      <p v-if="block.kind === 'paragraph'">
        <template v-for="(part, i) in block.content" :key="key(part, i)">
          <strong v-if="part.kind === 'bold'">{{ part.text }}</strong>
          <code v-else-if="part.kind === 'code'">{{ part.text }}</code>
          <a
            v-else-if="part.kind === 'link'"
            href="#"
            :title="part.url"
            @click.prevent="pending = part.url"
            >{{ part.text }}</a
          >
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
      <component :is="block.ordered ? 'ol' : 'ul'" v-else>
        <li v-for="(item, l) in block.items" :key="l">
          <template v-for="(part, i) in item" :key="key(part, i)">
            <strong v-if="part.kind === 'bold'">{{ part.text }}</strong>
            <code v-else-if="part.kind === 'code'">{{ part.text }}</code>
            <a
              v-else-if="part.kind === 'link'"
              href="#"
              :title="part.url"
              @click.prevent="pending = part.url"
              >{{ part.text }}</a
            >
            <template v-else>{{ part.text }}</template>
          </template>
        </li>
      </component>
    </template>

    <v-dialog
      :model-value="pending !== undefined"
      max-width="480"
      @update:model-value="pending = undefined"
    >
      <v-card data-testid="open-link">
        <v-card-title>Open this link in your browser?</v-card-title>
        <v-card-text class="rr-mono">{{ pending }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="pending = undefined">Cancel</v-btn>
          <v-btn color="primary" data-testid="open-link-confirm" @click="open">Open</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.md {
  font-size: 13px;
  line-height: 1.55;
}
.md p {
  margin: 0 0 8px;
}
.md ul,
.md ol {
  margin: 0 0 8px;
  padding-left: 20px;
}
.md code {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
  background: var(--rr-surface-2);
  padding: 1px 4px;
  border-radius: 4px;
}
.md a {
  color: var(--rr-accent);
}
</style>
