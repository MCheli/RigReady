/**
 * Composable for script execution.
 */

import { ref } from 'vue';
import type { ScriptConfig, ScriptResult, ScriptExecutionOptions } from '../../shared/scriptTypes';

function getApi() {
  return window.rigReady;
}

export function useScripts() {
  const lastResult = ref<ScriptResult | null>(null);
  const executing = ref(false);

  async function execute(
    config: ScriptConfig,
    options?: ScriptExecutionOptions
  ): Promise<ScriptResult> {
    executing.value = true;
    try {
      const result = await getApi().scripts.execute(config, options);
      lastResult.value = result;
      return result;
    } finally {
      executing.value = false;
    }
  }

  return { lastResult, executing, execute };
}
