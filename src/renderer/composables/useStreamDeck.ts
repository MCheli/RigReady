/**
 * Stream Deck Composable
 * Vue composable for managing Stream Deck backup/restore functionality
 */

import { ref, computed } from 'vue';
import type {
  StreamDeckInstallation,
  StreamDeckProfile,
  StreamDeckBackup,
  StreamDeckBackupResult,
  StreamDeckRestoreResult,
} from '../../shared/streamDeckTypes';

// Re-export types for convenience
export type {
  StreamDeckInstallation,
  StreamDeckProfile,
  StreamDeckBackup,
  StreamDeckBackupResult,
  StreamDeckRestoreResult,
};

// Get the typed API from window
function getApi() {
  return window.rigReady;
}

export function useStreamDeck() {
  // State
  const loading = ref(false);
  const error = ref<string | null>(null);
  const installation = ref<StreamDeckInstallation | null>(null);
  const profiles = ref<StreamDeckProfile[]>([]);
  const backups = ref<StreamDeckBackup[]>([]);

  // Computed
  const isInstalled = computed(() => installation.value?.installed ?? false);
  const profilesPath = computed(() => installation.value?.profilesPath ?? null);
  const softwarePath = computed(() => installation.value?.softwarePath ?? null);
  const profileCount = computed(() => profiles.value.length);
  const backupCount = computed(() => backups.value.length);

  // Methods
  async function detectInstallation(): Promise<StreamDeckInstallation> {
    loading.value = true;
    error.value = null;
    try {
      installation.value = await getApi().streamDeck.detectInstallation();
      return installation.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to detect Stream Deck installation';
      return {
        installed: false,
      };
    } finally {
      loading.value = false;
    }
  }

  async function loadProfiles(): Promise<StreamDeckProfile[]> {
    loading.value = true;
    error.value = null;
    try {
      profiles.value = await getApi().streamDeck.getProfiles();
      return profiles.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load profiles';
      return [];
    } finally {
      loading.value = false;
    }
  }

  async function loadBackups(): Promise<StreamDeckBackup[]> {
    loading.value = true;
    error.value = null;
    try {
      backups.value = await getApi().streamDeck.getBackups();
      return backups.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load backups';
      return [];
    } finally {
      loading.value = false;
    }
  }

  async function createBackup(name: string): Promise<StreamDeckBackupResult> {
    loading.value = true;
    error.value = null;
    try {
      const result = await getApi().streamDeck.createBackup(name);
      if (result.success) {
        await loadBackups();
      } else {
        error.value = result.error || 'Failed to create backup';
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create backup';
      return {
        success: false,
        error: error.value,
      };
    } finally {
      loading.value = false;
    }
  }

  async function restoreBackup(backupPath: string): Promise<StreamDeckRestoreResult> {
    loading.value = true;
    error.value = null;
    try {
      const result = await getApi().streamDeck.restoreBackup(backupPath);
      if (result.success) {
        await loadProfiles();
      } else {
        error.value = result.error || 'Failed to restore backup';
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to restore backup';
      return {
        success: false,
        message: error.value,
        restoredProfiles: 0,
        error: error.value,
      };
    } finally {
      loading.value = false;
    }
  }

  async function deleteBackup(backupPath: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const result = await getApi().streamDeck.deleteBackup(backupPath);
      if (result) {
        await loadBackups();
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete backup';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function openSoftware(): Promise<boolean> {
    try {
      return await getApi().streamDeck.openSoftware();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to open Stream Deck software';
      return false;
    }
  }

  async function openDownloadPage(): Promise<void> {
    try {
      await getApi().streamDeck.openDownloadPage();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to open download page';
    }
  }

  async function openProfilesFolder(): Promise<boolean> {
    try {
      return await getApi().streamDeck.openProfilesFolder();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to open profiles folder';
      return false;
    }
  }

  async function importBackup(sourcePath: string): Promise<StreamDeckBackupResult> {
    loading.value = true;
    error.value = null;
    try {
      const result = await getApi().streamDeck.importBackup(sourcePath);
      if (result.success) {
        await loadBackups();
      } else {
        error.value = result.error || 'Failed to import backup';
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to import backup';
      return {
        success: false,
        error: error.value,
      };
    } finally {
      loading.value = false;
    }
  }

  async function refresh(): Promise<void> {
    await detectInstallation();
    await loadProfiles();
    await loadBackups();
  }

  return {
    // State
    loading,
    error,
    installation,
    profiles,
    backups,

    // Computed
    isInstalled,
    profilesPath,
    softwarePath,
    profileCount,
    backupCount,

    // Methods
    detectInstallation,
    loadProfiles,
    loadBackups,
    createBackup,
    restoreBackup,
    deleteBackup,
    openSoftware,
    openDownloadPage,
    openProfilesFolder,
    importBackup,
    refresh,
  };
}
