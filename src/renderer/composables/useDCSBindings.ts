/**
 * DCS Bindings Composable
 * Vue composable for managing DCS World keybinding visualization and restoration
 */

import { ref, computed } from 'vue';
import type {
  DCSModule,
  DCSScanResult,
  DCSDeviceBindings,
  DCSGuidMapping,
  DCSRestoreOptions,
  DCSRestoreResult,
} from '../../shared/dcsTypes';

// Re-export DCS types for convenience
export type {
  DCSModule,
  DCSScanResult,
  DCSDeviceBindings,
  DCSGuidMapping,
  DCSRestoreOptions,
  DCSRestoreResult,
  DCSAxisBinding,
  DCSKeyBinding,
  DCSAxisFilter,
  DCSBindingComparison,
  DCSBindingDifference,
} from '../../shared/dcsTypes';

// Get the typed API from window
function getApi() {
  return window.rigReady;
}

export interface DCSBackup {
  name: string;
  path: string;
  timestamp: number;
}

export function useDCSBindings() {
  // State
  const loading = ref(false);
  const error = ref<string | null>(null);
  const savedGamesPath = ref<string | null>(null);
  const modules = ref<DCSModule[]>([]);
  const selectedModuleId = ref<string | null>(null);
  const currentBindings = ref<DCSDeviceBindings[]>([]);
  const backupBindings = ref<DCSDeviceBindings[]>([]);
  const guidMappings = ref<DCSGuidMapping[]>([]);
  const availableBackups = ref<DCSBackup[]>([]);
  const selectedBackupPath = ref<string | null>(null);

  // Computed
  const selectedModule = computed(() => {
    if (!selectedModuleId.value) return null;
    return modules.value.find((m) => m.id === selectedModuleId.value) || null;
  });

  const hasBackupSelected = computed(() => !!selectedBackupPath.value);

  const unmappedDevices = computed(() => {
    return guidMappings.value.filter((m) => !m.currentGuid);
  });

  const mappedDevices = computed(() => {
    return guidMappings.value.filter((m) => m.currentGuid);
  });

  // Methods
  async function scanModules(): Promise<DCSScanResult> {
    loading.value = true;
    error.value = null;
    try {
      const result = await getApi().dcs.scanModules();
      modules.value = result.modules;
      savedGamesPath.value = result.savedGamesPath;
      if (result.errors.length > 0) {
        error.value = result.errors.join('; ');
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to scan DCS modules';
      return {
        savedGamesPath: '',
        modules: [],
        errors: [error.value],
      };
    } finally {
      loading.value = false;
    }
  }

  async function loadModuleBindings(moduleId: string): Promise<DCSDeviceBindings[]> {
    loading.value = true;
    error.value = null;
    try {
      selectedModuleId.value = moduleId;
      currentBindings.value = await getApi().dcs.getModuleBindings(moduleId);
      return currentBindings.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load bindings';
      return [];
    } finally {
      loading.value = false;
    }
  }

  async function loadBackupBindings(
    backupPath: string,
    moduleId: string
  ): Promise<DCSDeviceBindings[]> {
    loading.value = true;
    error.value = null;
    try {
      selectedBackupPath.value = backupPath;
      backupBindings.value = await getApi().dcs.getBackupBindings(backupPath, moduleId);

      // Automatically compute GUID mappings
      if (currentBindings.value.length > 0 && backupBindings.value.length > 0) {
        await computeGuidMappings();
      }

      return backupBindings.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load backup bindings';
      return [];
    } finally {
      loading.value = false;
    }
  }

  async function computeGuidMappings(): Promise<DCSGuidMapping[]> {
    try {
      guidMappings.value = await getApi().dcs.getGuidMappings(
        currentBindings.value,
        backupBindings.value
      );
      return guidMappings.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to compute GUID mappings';
      return [];
    }
  }

  function updateGuidMapping(backupGuid: string, currentGuid: string): void {
    const mapping = guidMappings.value.find((m) => m.backupGuid === backupGuid);
    if (mapping) {
      mapping.currentGuid = currentGuid;
      mapping.confidence = 'manual';
    }
  }

  async function restoreDeviceBindings(deviceGuid: string): Promise<DCSRestoreResult> {
    if (!selectedBackupPath.value || !selectedModuleId.value) {
      return {
        success: false,
        message: 'No backup or module selected',
        restoredDevices: [],
        errors: ['No backup or module selected'],
      };
    }

    loading.value = true;
    error.value = null;
    try {
      const options: DCSRestoreOptions = {
        guidMappings: guidMappings.value,
        createBackup: true,
        module: selectedModuleId.value,
        deviceGuid,
      };

      const result = await getApi().dcs.restoreBindings(selectedBackupPath.value, options);

      if (!result.success) {
        error.value = result.message;
      }

      // Refresh current bindings after restore
      if (result.success && selectedModuleId.value) {
        await loadModuleBindings(selectedModuleId.value);
      }

      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to restore bindings';
      return {
        success: false,
        message: error.value,
        restoredDevices: [],
        errors: [error.value],
      };
    } finally {
      loading.value = false;
    }
  }

  async function restoreAllBindings(): Promise<DCSRestoreResult> {
    if (!selectedBackupPath.value || !selectedModuleId.value) {
      return {
        success: false,
        message: 'No backup or module selected',
        restoredDevices: [],
        errors: ['No backup or module selected'],
      };
    }

    loading.value = true;
    error.value = null;
    try {
      const options: DCSRestoreOptions = {
        guidMappings: guidMappings.value,
        createBackup: true,
        module: selectedModuleId.value,
      };

      const result = await getApi().dcs.restoreBindings(selectedBackupPath.value, options);

      if (!result.success) {
        error.value = result.message;
      }

      // Refresh current bindings after restore
      if (result.success && selectedModuleId.value) {
        await loadModuleBindings(selectedModuleId.value);
      }

      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to restore bindings';
      return {
        success: false,
        message: error.value,
        restoredDevices: [],
        errors: [error.value],
      };
    } finally {
      loading.value = false;
    }
  }

  async function loadAvailableBackups(): Promise<DCSBackup[]> {
    try {
      availableBackups.value = await getApi().dcs.getAvailableBackups();
      return availableBackups.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load backups';
      return [];
    }
  }

  async function createBackup(name: string): Promise<string | null> {
    loading.value = true;
    error.value = null;
    try {
      const backupPath = await getApi().dcs.createBackup(name);
      if (backupPath) {
        await loadAvailableBackups();
      }
      return backupPath;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create backup';
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function deleteBackup(backupPath: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const result = await getApi().dcs.deleteBackup(backupPath);
      if (result) {
        await loadAvailableBackups();
        if (selectedBackupPath.value === backupPath) {
          selectedBackupPath.value = null;
          backupBindings.value = [];
          guidMappings.value = [];
        }
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete backup';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function getSavedGamesPath(): Promise<string | null> {
    try {
      savedGamesPath.value = await getApi().dcs.getSavedGamesPath();
      return savedGamesPath.value;
    } catch {
      return null;
    }
  }

  async function setSavedGamesPath(customPath: string): Promise<boolean> {
    try {
      const result = await getApi().dcs.setSavedGamesPath(customPath);
      if (result) {
        savedGamesPath.value = customPath;
        // Re-scan modules with new path
        await scanModules();
      }
      return result;
    } catch {
      return false;
    }
  }

  function clearSelection(): void {
    selectedModuleId.value = null;
    selectedBackupPath.value = null;
    currentBindings.value = [];
    backupBindings.value = [];
    guidMappings.value = [];
  }

  return {
    // State
    loading,
    error,
    savedGamesPath,
    modules,
    selectedModuleId,
    selectedModule,
    currentBindings,
    backupBindings,
    guidMappings,
    availableBackups,
    selectedBackupPath,

    // Computed
    hasBackupSelected,
    unmappedDevices,
    mappedDevices,

    // Methods
    scanModules,
    loadModuleBindings,
    loadBackupBindings,
    computeGuidMappings,
    updateGuidMapping,
    restoreDeviceBindings,
    restoreAllBindings,
    loadAvailableBackups,
    createBackup,
    deleteBackup,
    getSavedGamesPath,
    setSavedGamesPath,
    clearSelection,
  };
}
