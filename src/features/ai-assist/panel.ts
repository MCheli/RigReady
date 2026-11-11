import { ref } from 'vue';

/**
 * Whether the assistant panel is open: one flag for the app-bar button, the panel itself, the
 * binding guide's link and the command palette, which has no page of its own to hold it.
 */
export const assistantOpen = ref(false);
