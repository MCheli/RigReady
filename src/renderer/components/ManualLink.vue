<script setup lang="ts">
import { computed } from 'vue';
import { manualUrl, TROUBLESHOOTING, type TroubleshootingTopic } from '../../shared/manualLinks';

/**
 * A link to a page of the manual, for an error notice or an empty state: "What to do" next
 * to the reason. Opens in the browser (an https address; the window never navigates).
 * `topic` is one of the troubleshooting pages; `page` any page of the manual.
 */
const props = defineProps<{ topic?: TroubleshootingTopic; page?: string; anchor?: string }>();

const url = computed(() =>
  manualUrl(props.topic ? TROUBLESHOOTING[props.topic] : props.page, props.anchor)
);
</script>

<template>
  <a
    :href="url"
    target="_blank"
    rel="noopener noreferrer"
    class="rr-manual-link"
    :data-testid="`manual-link-${topic ?? 'page'}`"
    ><slot>What to do</slot
    ><v-icon icon="mdi-open-in-new" size="13" class="rr-manual-link-icon" aria-hidden="true"
  /></a>
</template>

<style scoped>
.rr-manual-link {
  color: inherit;
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 2px;
  white-space: nowrap;
}
.rr-manual-link:hover {
  color: var(--rr-text);
}
.rr-manual-link-icon {
  margin-left: 3px;
  vertical-align: -1px;
}
</style>
