/**
 * Composable for bundle export/import operations.
 */

import { ref } from 'vue';
import type {
  ExportOptions,
  ImportOptions,
  ExportResult,
  ImportResult,
  PrivacyReviewResult,
} from '../../shared/bundleTypes';

function getApi() {
  return window.rigReady;
}

export function useBundles() {
  const exporting = ref(false);
  const importing = ref(false);
  const reviewing = ref(false);

  async function exportBundle(options: ExportOptions): Promise<ExportResult> {
    exporting.value = true;
    try {
      return await getApi().bundles.export(options);
    } finally {
      exporting.value = false;
    }
  }

  async function importBundle(options: ImportOptions): Promise<ImportResult> {
    importing.value = true;
    try {
      return await getApi().bundles.import(options);
    } finally {
      importing.value = false;
    }
  }

  async function reviewPrivacy(profileId: string): Promise<PrivacyReviewResult> {
    reviewing.value = true;
    try {
      return await getApi().bundles.reviewPrivacy(profileId);
    } finally {
      reviewing.value = false;
    }
  }

  return {
    exporting,
    importing,
    reviewing,
    exportBundle,
    importBundle,
    reviewPrivacy,
  };
}
