/**
 * Composable for running pre-flight checklists.
 */

import { ref } from 'vue';
import type {
  ChecklistResult,
  CheckResult,
  ChecklistItem,
  Remediation,
} from '../../shared/profileTypes';

function getApi() {
  return window.rigReady;
}

export function useChecklist() {
  const lastResult = ref<ChecklistResult | null>(null);
  const running = ref(false);

  async function runChecklist(profileId: string): Promise<ChecklistResult> {
    running.value = true;
    try {
      const result = await getApi().checklist.run(profileId);
      lastResult.value = result;
      return result;
    } finally {
      running.value = false;
    }
  }

  async function runSingleCheck(item: ChecklistItem): Promise<CheckResult> {
    return getApi().checklist.runSingle(item);
  }

  async function remediate(
    remediation: Remediation
  ): Promise<{ success: boolean; message: string }> {
    return getApi().checklist.remediate(remediation);
  }

  function clearResults(): void {
    lastResult.value = null;
  }

  return {
    lastResult,
    running,
    runChecklist,
    runSingleCheck,
    remediate,
    clearResults,
  };
}
