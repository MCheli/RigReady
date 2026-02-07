/**
 * Composable for display write operations.
 */

import { ref } from 'vue';

function getApi() {
  return window.rigReady;
}

export function useDisplayWrite() {
  const applying = ref(false);

  async function applyLayout(
    configurationName: string
  ): Promise<{ success: boolean; message: string }> {
    applying.value = true;
    try {
      return await getApi().displays.applyLayout(configurationName);
    } finally {
      applying.value = false;
    }
  }

  return { applying, applyLayout };
}
