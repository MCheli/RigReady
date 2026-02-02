/**
 * Composables for accessing the RigReady IPC API
 * Provides type-safe access to the preload-exposed API
 */

import { ref } from 'vue';
import type {
  USBDevice,
  UnifiedDevice,
  PygameDevice,
  PygameInputState,
  HIDInputState,
  DisplayInfo,
  DisplayConfiguration,
  SimulatorInfo,
  KeybindingBackup,
  KeybindingProfile,
  CommonAction,
  VehicleBinding,
  ActionCategory,
  ProcessCheckResult,
  GameProfile,
  LaunchResult,
  DetectedGame,
  Simulator,
  SimulatorPath,
  AppSettings,
} from '../../shared/types';
import type {
  DeviceStatus,
  SystemInfo,
  DebugDeviceStatus,
  DebugPaths,
  ExportLogsResult,
  RigReadyApi,
} from '../../shared/ipc';

// Re-export types for convenience
export type {
  USBDevice,
  UnifiedDevice,
  PygameDevice,
  PygameInputState,
  HIDInputState,
  DisplayInfo,
  DisplayConfiguration,
  SimulatorInfo,
  KeybindingBackup,
  KeybindingProfile,
  CommonAction,
  VehicleBinding,
  ActionCategory,
  ProcessCheckResult,
  GameProfile,
  LaunchResult,
  DetectedGame,
  DeviceStatus,
  SystemInfo,
  DebugDeviceStatus,
  DebugPaths,
  ExportLogsResult,
  Simulator,
  SimulatorPath,
  AppSettings,
};

// Get the typed API from window
function getApi(): RigReadyApi {
  return window.rigReady;
}

// =============================================================================
// Device Composables
// =============================================================================

export function useDevices() {
  const devices = ref<USBDevice[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadDevices() {
    loading.value = true;
    error.value = null;
    try {
      const status = await getApi().devices.checkStatus();
      devices.value = [...status.connected, ...status.missing];
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading.value = false;
    }
  }

  async function getUnifiedDevices(): Promise<UnifiedDevice[]> {
    return getApi().devices.getUnifiedInputDevices();
  }

  async function saveExpected(): Promise<boolean> {
    return getApi().devices.saveExpected();
  }

  return { devices, loading, error, loadDevices, getUnifiedDevices, saveExpected };
}

// =============================================================================
// Pygame Composables
// =============================================================================

export function usePygame() {
  const available = ref(false);
  const devices = ref<PygameDevice[]>([]);

  async function checkAvailable(): Promise<boolean> {
    available.value = await getApi().pygame.isAvailable();
    return available.value;
  }

  async function start(): Promise<boolean> {
    return getApi().pygame.start();
  }

  async function stop(): Promise<void> {
    return getApi().pygame.stop();
  }

  async function getDevices(): Promise<PygameDevice[]> {
    devices.value = await getApi().pygame.getDevices();
    return devices.value;
  }

  async function startMonitoring(): Promise<void> {
    return getApi().pygame.startMonitoring();
  }

  async function stopMonitoring(): Promise<void> {
    return getApi().pygame.stopMonitoring();
  }

  function onInputStates(callback: (states: PygameInputState[]) => void): void {
    getApi().pygame.onInputStates(callback);
  }

  function onDevicesChanged(callback: (devices: PygameDevice[]) => void): void {
    getApi().pygame.onDevicesChanged(callback);
  }

  return {
    available,
    devices,
    checkAvailable,
    start,
    stop,
    getDevices,
    startMonitoring,
    stopMonitoring,
    onInputStates,
    onDevicesChanged,
  };
}

// =============================================================================
// HID Composables
// =============================================================================

export function useHid() {
  async function openDevice(path: string): Promise<boolean> {
    return getApi().hid.openDevice(path);
  }

  async function closeDevice(path: string): Promise<void> {
    return getApi().hid.closeDevice(path);
  }

  async function startMonitoring(): Promise<void> {
    return getApi().hid.startMonitoring();
  }

  async function stopMonitoring(): Promise<void> {
    return getApi().hid.stopMonitoring();
  }

  function onInputStates(callback: (states: HIDInputState[]) => void): void {
    getApi().hid.onInputStates(callback);
  }

  return { openDevice, closeDevice, startMonitoring, stopMonitoring, onInputStates };
}

// =============================================================================
// Display Composables
// =============================================================================

export function useDisplays() {
  const displays = ref<DisplayInfo[]>([]);
  const savedConfigs = ref<DisplayConfiguration[]>([]);
  const loading = ref(false);

  async function loadDisplays(): Promise<void> {
    loading.value = true;
    try {
      displays.value = await getApi().displays.getAll();
      savedConfigs.value = await getApi().displays.getSavedConfigurations();
    } finally {
      loading.value = false;
    }
  }

  async function saveConfiguration(name: string): Promise<boolean> {
    return getApi().displays.saveConfiguration(name);
  }

  async function deleteConfiguration(name: string): Promise<boolean> {
    return getApi().displays.deleteConfiguration(name);
  }

  async function checkConfiguration(name: string): Promise<boolean> {
    return getApi().displays.checkConfiguration(name);
  }

  return {
    displays,
    savedConfigs,
    loading,
    loadDisplays,
    saveConfiguration,
    deleteConfiguration,
    checkConfiguration,
  };
}

// =============================================================================
// Keybindings Composables
// =============================================================================

export function useKeybindings() {
  const simulators = ref<SimulatorInfo[]>([]);
  const backups = ref<KeybindingBackup[]>([]);
  const loading = ref(false);

  async function loadKeybindings(): Promise<void> {
    loading.value = true;
    try {
      simulators.value = await getApi().keybindings.scanSimulators();
      backups.value = await getApi().keybindings.getBackups();
    } finally {
      loading.value = false;
    }
  }

  async function createBackup(simulator: string, name: string): Promise<boolean> {
    return getApi().keybindings.createBackup(simulator, name);
  }

  async function restoreBackup(name: string): Promise<boolean> {
    return getApi().keybindings.restoreBackup(name);
  }

  async function deleteBackup(name: string): Promise<boolean> {
    return getApi().keybindings.deleteBackup(name);
  }

  return {
    simulators,
    backups,
    loading,
    loadKeybindings,
    createBackup,
    restoreBackup,
    deleteBackup,
  };
}

// =============================================================================
// Debug Composables
// =============================================================================

export function useDebug() {
  const systemInfo = ref<SystemInfo | null>(null);
  const deviceStatus = ref<DebugDeviceStatus | null>(null);
  const paths = ref<DebugPaths | null>(null);
  const logs = ref<string[]>([]);

  async function loadDebugInfo(): Promise<void> {
    systemInfo.value = await getApi().debug.getSystemInfo();
    deviceStatus.value = await getApi().debug.getDeviceStatus();
    paths.value = await getApi().debug.getPaths();
    logs.value = await getApi().debug.getRecentLogs(50);
  }

  async function exportLogs(): Promise<ExportLogsResult> {
    return getApi().debug.exportLogs();
  }

  return { systemInfo, deviceStatus, paths, logs, loadDebugInfo, exportLogs };
}

// =============================================================================
// System Composables
// =============================================================================

export function useSystem() {
  function getPlatform(): string {
    return getApi().system.getPlatform();
  }

  function log(message: string): void {
    getApi().log(message);
  }

  return { getPlatform, log };
}

// =============================================================================
// Process Composables
// =============================================================================

export function useProcess() {
  const knownProcesses = ref<ProcessCheckResult[]>([]);
  const runningProcesses = ref<ProcessCheckResult[]>([]);
  const loading = ref(false);

  async function checkProcess(processName: string): Promise<ProcessCheckResult> {
    return getApi().process.isRunning(processName);
  }

  async function checkMultiple(processNames: string[]): Promise<ProcessCheckResult[]> {
    return getApi().process.checkMultiple(processNames);
  }

  async function loadKnownProcesses(): Promise<void> {
    loading.value = true;
    try {
      knownProcesses.value = await getApi().process.findKnown();
      runningProcesses.value = knownProcesses.value.filter((p) => p.running);
    } finally {
      loading.value = false;
    }
  }

  async function getRunningKnown(): Promise<ProcessCheckResult[]> {
    return getApi().process.getRunningKnown();
  }

  async function launchProcess(executablePath: string, args?: string[]): Promise<boolean> {
    return getApi().process.launch(executablePath, args);
  }

  return {
    knownProcesses,
    runningProcesses,
    loading,
    checkProcess,
    checkMultiple,
    loadKnownProcesses,
    getRunningKnown,
    launchProcess,
  };
}

// =============================================================================
// Game Launch Composables
// =============================================================================

export function useGames() {
  const profiles = ref<GameProfile[]>([]);
  const detectedGames = ref<DetectedGame[]>([]);
  const loading = ref(false);
  const lastLaunchResult = ref<LaunchResult | null>(null);

  async function loadProfiles(): Promise<void> {
    loading.value = true;
    try {
      profiles.value = await getApi().games.getProfiles();
    } finally {
      loading.value = false;
    }
  }

  async function getProfile(id: string): Promise<GameProfile | undefined> {
    return getApi().games.getProfile(id);
  }

  async function saveProfile(profile: GameProfile): Promise<void> {
    await getApi().games.saveProfile(profile);
    await loadProfiles();
  }

  async function deleteProfile(id: string): Promise<boolean> {
    const result = await getApi().games.deleteProfile(id);
    if (result) {
      await loadProfiles();
    }
    return result;
  }

  async function detectGames(): Promise<void> {
    loading.value = true;
    try {
      detectedGames.value = await getApi().games.detectGames();
    } finally {
      loading.value = false;
    }
  }

  async function launchGame(profileId: string): Promise<LaunchResult> {
    const result = await getApi().games.launch(profileId);
    lastLaunchResult.value = result;
    return result;
  }

  async function quickLaunch(executablePath: string, args?: string[]): Promise<LaunchResult> {
    const result = await getApi().games.quickLaunch(executablePath, args);
    lastLaunchResult.value = result;
    return result;
  }

  return {
    profiles,
    detectedGames,
    loading,
    lastLaunchResult,
    loadProfiles,
    getProfile,
    saveProfile,
    deleteProfile,
    detectGames,
    launchGame,
    quickLaunch,
  };
}

// =============================================================================
// Keybinding Profile Composables
// =============================================================================

export function useKeybindingProfiles() {
  const profiles = ref<KeybindingProfile[]>([]);
  const currentProfile = ref<KeybindingProfile | null>(null);
  const loading = ref(false);

  async function loadProfiles(): Promise<void> {
    loading.value = true;
    try {
      profiles.value = await getApi().keybindingProfiles.getAll();
    } finally {
      loading.value = false;
    }
  }

  async function getProfile(id: string): Promise<KeybindingProfile | undefined> {
    const profile = await getApi().keybindingProfiles.get(id);
    if (profile) {
      currentProfile.value = profile;
    }
    return profile;
  }

  async function saveProfile(profile: KeybindingProfile): Promise<void> {
    await getApi().keybindingProfiles.save(profile);
    await loadProfiles();
  }

  async function deleteProfile(id: string): Promise<boolean> {
    const result = await getApi().keybindingProfiles.delete(id);
    if (result) {
      await loadProfiles();
      if (currentProfile.value?.id === id) {
        currentProfile.value = null;
      }
    }
    return result;
  }

  async function duplicateProfile(
    id: string,
    newName: string
  ): Promise<KeybindingProfile | undefined> {
    const result = await getApi().keybindingProfiles.duplicate(id, newName);
    if (result) {
      await loadProfiles();
    }
    return result;
  }

  async function addAction(profileId: string, action: CommonAction): Promise<boolean> {
    const result = await getApi().keybindingProfiles.addAction(profileId, action);
    if (result && currentProfile.value?.id === profileId) {
      await getProfile(profileId);
    }
    return result;
  }

  async function updateAction(
    profileId: string,
    actionId: string,
    updates: Partial<CommonAction>
  ): Promise<boolean> {
    const result = await getApi().keybindingProfiles.updateAction(profileId, actionId, updates);
    if (result && currentProfile.value?.id === profileId) {
      await getProfile(profileId);
    }
    return result;
  }

  async function removeAction(profileId: string, actionId: string): Promise<boolean> {
    const result = await getApi().keybindingProfiles.removeAction(profileId, actionId);
    if (result && currentProfile.value?.id === profileId) {
      await getProfile(profileId);
    }
    return result;
  }

  async function addBinding(profileId: string, binding: VehicleBinding): Promise<boolean> {
    const result = await getApi().keybindingProfiles.addBinding(profileId, binding);
    if (result && currentProfile.value?.id === profileId) {
      await getProfile(profileId);
    }
    return result;
  }

  async function removeBinding(
    profileId: string,
    vehicleId: string,
    commonActionId: string
  ): Promise<boolean> {
    const result = await getApi().keybindingProfiles.removeBinding(
      profileId,
      vehicleId,
      commonActionId
    );
    if (result && currentProfile.value?.id === profileId) {
      await getProfile(profileId);
    }
    return result;
  }

  async function exportProfile(id: string): Promise<string | undefined> {
    return getApi().keybindingProfiles.exportProfile(id);
  }

  async function importProfile(
    jsonData: string,
    newName?: string
  ): Promise<KeybindingProfile | undefined> {
    const result = await getApi().keybindingProfiles.importProfile(jsonData, newName);
    if (result) {
      await loadProfiles();
    }
    return result;
  }

  return {
    profiles,
    currentProfile,
    loading,
    loadProfiles,
    getProfile,
    saveProfile,
    deleteProfile,
    duplicateProfile,
    addAction,
    updateAction,
    removeAction,
    addBinding,
    removeBinding,
    exportProfile,
    importProfile,
  };
}

// =============================================================================
// Settings Composables
// =============================================================================

export function useSettings() {
  const settings = ref<AppSettings | null>(null);
  const simulatorPaths = ref<SimulatorPath[]>([]);
  const loading = ref(false);
  const scanning = ref(false);

  async function loadSettings(): Promise<void> {
    loading.value = true;
    try {
      settings.value = await getApi().settings.get();
      simulatorPaths.value = settings.value?.simulatorPaths || [];
    } finally {
      loading.value = false;
    }
  }

  async function updateSettings(updates: Partial<AppSettings>): Promise<void> {
    await getApi().settings.update(updates);
    await loadSettings();
  }

  async function getSimulatorPath(simulator: Simulator): Promise<SimulatorPath | undefined> {
    return getApi().settings.getSimulatorPath(simulator);
  }

  async function setSimulatorPath(simulatorPath: SimulatorPath): Promise<void> {
    await getApi().settings.setSimulatorPath(simulatorPath);
    await loadSettings();
  }

  async function removeSimulatorPath(simulator: Simulator): Promise<void> {
    await getApi().settings.removeSimulatorPath(simulator);
    await loadSettings();
  }

  async function autoScanSimulator(simulator: Simulator): Promise<SimulatorPath | null> {
    scanning.value = true;
    try {
      const result = await getApi().settings.autoScanSimulator(simulator);
      if (result) {
        await loadSettings();
      }
      return result;
    } finally {
      scanning.value = false;
    }
  }

  async function autoScanAllSimulators(): Promise<SimulatorPath[]> {
    scanning.value = true;
    try {
      const results = await getApi().settings.autoScanAllSimulators();
      await loadSettings();
      return results;
    } finally {
      scanning.value = false;
    }
  }

  async function verifySimulatorPath(simulator: Simulator): Promise<boolean> {
    return getApi().settings.verifySimulatorPath(simulator);
  }

  return {
    settings,
    simulatorPaths,
    loading,
    scanning,
    loadSettings,
    updateSettings,
    getSimulatorPath,
    setSimulatorPath,
    removeSimulatorPath,
    autoScanSimulator,
    autoScanAllSimulators,
    verifySimulatorPath,
  };
}

// =============================================================================
// Re-export DCS Bindings Composable
// =============================================================================

export { useDCSBindings } from './useDCSBindings';
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
  DCSBackup,
} from './useDCSBindings';

// =============================================================================
// Re-export Stream Deck Composable
// =============================================================================

export { useStreamDeck } from './useStreamDeck';
export type {
  StreamDeckInstallation,
  StreamDeckProfile,
  StreamDeckBackup,
  StreamDeckBackupResult,
  StreamDeckRestoreResult,
} from './useStreamDeck';
