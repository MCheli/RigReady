/**
 * Type-safe IPC channel definitions
 * This file defines all IPC channels with their argument and return types
 */

import type {
  USBDevice,
  UnifiedDevice,
  PygameDevice,
  PygameInputState,
  HIDDeviceInfo,
  HIDInputState,
  DisplayInfo,
  DisplayConfiguration,
  SimulatorInfo,
  KeybindingBackup,
  KeybindingProfile,
  CommonAction,
  VehicleBinding,
  ProcessCheckResult,
  GameProfile,
  LaunchResult,
  DetectedGame,
  Simulator,
  SimulatorInstallation,
  SimulatorScanResult,
  SimulatorPath,
  AppSettings,
} from './types';

// =============================================================================
// Device Status Types
// =============================================================================

export interface DeviceStatus {
  connected: USBDevice[];
  missing: USBDevice[];
  unexpected: USBDevice[];
  allExpectedConnected: boolean;
}

// =============================================================================
// Debug Types
// =============================================================================

export interface SystemInfo {
  platform: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  v8Version: string;
}

export interface DebugDeviceStatus {
  pygameAvailable: boolean;
  pygameDeviceCount: number;
  hidDeviceCount: number;
  usbDeviceCount: number;
}

export interface DebugPaths {
  configPath: string;
  logsPath: string;
}

export interface ExportLogsResult {
  success: boolean;
  path?: string;
  error?: string;
}

// =============================================================================
// IPC Channel Definitions
// =============================================================================

/**
 * Maps IPC channel names to their argument types and return types
 */
export interface IpcChannels {
  // Device channels
  'devices:getAll': { args: []; return: USBDevice[] };
  'devices:getPygameDevices': { args: []; return: PygameDevice[] };
  'devices:getExpected': { args: []; return: USBDevice[] };
  'devices:saveExpected': { args: []; return: boolean };
  'devices:checkStatus': { args: []; return: DeviceStatus };
  'devices:getUnifiedInputDevices': { args: []; return: UnifiedDevice[] };

  // HID channels
  'hid:getDevices': { args: []; return: HIDDeviceInfo[] };
  'hid:getSimDevices': { args: []; return: HIDDeviceInfo[] };
  'hid:getMissingDevices': { args: []; return: HIDDeviceInfo[] };
  'hid:openDevice': { args: [path: string]; return: boolean };
  'hid:closeDevice': { args: [path: string]; return: void };
  'hid:startMonitoring': { args: []; return: void };
  'hid:stopMonitoring': { args: []; return: void };
  'hid:getCurrentStates': { args: []; return: HIDInputState[] };

  // Pygame channels
  'pygame:isAvailable': { args: []; return: boolean };
  'pygame:start': { args: []; return: boolean };
  'pygame:stop': { args: []; return: void };
  'pygame:getDevices': { args: []; return: PygameDevice[] };
  'pygame:startMonitoring': { args: []; return: void };
  'pygame:stopMonitoring': { args: []; return: void };
  'pygame:enumerate': { args: []; return: void };

  // Display channels
  'displays:getAll': { args: []; return: DisplayInfo[] };
  'displays:saveConfiguration': { args: [name: string]; return: boolean };
  'displays:getSavedConfigurations': { args: []; return: DisplayConfiguration[] };
  'displays:deleteConfiguration': { args: [name: string]; return: boolean };
  'displays:checkConfiguration': { args: [name: string]; return: boolean };

  // Keybinding channels (legacy backup system)
  'keybindings:scanSimulators': { args: []; return: SimulatorInfo[] };
  'keybindings:createBackup': { args: [simulator: string, name: string]; return: boolean };
  'keybindings:restoreBackup': { args: [name: string]; return: boolean };
  'keybindings:getBackups': { args: []; return: KeybindingBackup[] };
  'keybindings:deleteBackup': { args: [name: string]; return: boolean };

  // Keybinding profile channels (unified system)
  'keybindingProfiles:getAll': { args: []; return: KeybindingProfile[] };
  'keybindingProfiles:get': { args: [id: string]; return: KeybindingProfile | undefined };
  'keybindingProfiles:save': { args: [profile: KeybindingProfile]; return: void };
  'keybindingProfiles:delete': { args: [id: string]; return: boolean };
  'keybindingProfiles:duplicate': {
    args: [id: string, newName: string];
    return: KeybindingProfile | undefined;
  };
  'keybindingProfiles:addAction': {
    args: [profileId: string, action: CommonAction];
    return: boolean;
  };
  'keybindingProfiles:updateAction': {
    args: [profileId: string, actionId: string, updates: Partial<CommonAction>];
    return: boolean;
  };
  'keybindingProfiles:removeAction': {
    args: [profileId: string, actionId: string];
    return: boolean;
  };
  'keybindingProfiles:addBinding': {
    args: [profileId: string, binding: VehicleBinding];
    return: boolean;
  };
  'keybindingProfiles:removeBinding': {
    args: [profileId: string, vehicleId: string, commonActionId: string];
    return: boolean;
  };
  'keybindingProfiles:export': { args: [id: string]; return: string | undefined };
  'keybindingProfiles:import': {
    args: [jsonData: string, newName?: string];
    return: KeybindingProfile | undefined;
  };

  // Debug channels
  'debug:getSystemInfo': { args: []; return: SystemInfo };
  'debug:getDeviceStatus': { args: []; return: DebugDeviceStatus };
  'debug:getPaths': { args: []; return: DebugPaths };
  'debug:getRecentLogs': { args: [lineCount?: number]; return: string[] };
  'debug:exportLogs': { args: []; return: ExportLogsResult };

  // Process channels
  'process:isRunning': { args: [processName: string]; return: ProcessCheckResult };
  'process:checkMultiple': { args: [processNames: string[]]; return: ProcessCheckResult[] };
  'process:findKnown': { args: []; return: ProcessCheckResult[] };
  'process:getRunningKnown': { args: []; return: ProcessCheckResult[] };
  'process:launch': { args: [executablePath: string, args?: string[]]; return: boolean };

  // Game launch channels
  'games:getProfiles': { args: []; return: GameProfile[] };
  'games:getProfile': { args: [id: string]; return: GameProfile | undefined };
  'games:saveProfile': { args: [profile: GameProfile]; return: void };
  'games:deleteProfile': { args: [id: string]; return: boolean };
  'games:detectGames': { args: []; return: DetectedGame[] };
  'games:launch': { args: [profileId: string]; return: LaunchResult };
  'games:quickLaunch': { args: [executablePath: string, args?: string[]]; return: LaunchResult };

  // Simulator config channels
  'simulatorConfig:detectSimulators': { args: []; return: SimulatorInstallation[] };
  'simulatorConfig:getInstallation': {
    args: [simulator: Simulator];
    return: SimulatorInstallation;
  };
  'simulatorConfig:scanSimulator': {
    args: [simulator: Simulator, forceRefresh?: boolean];
    return: SimulatorScanResult;
  };
  'simulatorConfig:scanAllSimulators': {
    args: [forceRefresh?: boolean];
    return: SimulatorScanResult[];
  };

  // Settings channels
  'settings:get': { args: []; return: AppSettings };
  'settings:update': { args: [updates: Partial<AppSettings>]; return: void };
  'settings:getSimulatorPath': { args: [simulator: Simulator]; return: SimulatorPath | undefined };
  'settings:setSimulatorPath': { args: [simulatorPath: SimulatorPath]; return: void };
  'settings:removeSimulatorPath': { args: [simulator: Simulator]; return: void };
  'settings:autoScanSimulator': { args: [simulator: Simulator]; return: SimulatorPath | null };
  'settings:autoScanAllSimulators': { args: []; return: SimulatorPath[] };
  'settings:verifySimulatorPath': { args: [simulator: Simulator]; return: boolean };
}

/**
 * IPC event channels (renderer -> main, one-way)
 */
export interface IpcSendChannels {
  log: { args: [message: string] };
}

/**
 * IPC event channels (main -> renderer)
 */
export interface IpcOnChannels {
  'hid:inputStates': { data: HIDInputState[] };
  'pygame:inputStates': { data: PygameInputState[] };
  'pygame:devicesChanged': { data: PygameDevice[] };
}

// =============================================================================
// Type Helpers
// =============================================================================

/** Get the return type of an IPC channel */
export type IpcReturn<T extends keyof IpcChannels> = IpcChannels[T]['return'];

/** Get the argument types of an IPC channel */
export type IpcArgs<T extends keyof IpcChannels> = IpcChannels[T]['args'];

// =============================================================================
// Typed API Interface (for renderer)
// =============================================================================

export interface SimManagerApi {
  log: (message: string) => void;

  devices: {
    getAll: () => Promise<USBDevice[]>;
    getPygameDevices: () => Promise<PygameDevice[]>;
    getExpected: () => Promise<USBDevice[]>;
    saveExpected: () => Promise<boolean>;
    checkStatus: () => Promise<DeviceStatus>;
    getUnifiedInputDevices: () => Promise<UnifiedDevice[]>;
  };

  hid: {
    getDevices: () => Promise<HIDDeviceInfo[]>;
    getSimDevices: () => Promise<HIDDeviceInfo[]>;
    getMissingDevices: () => Promise<HIDDeviceInfo[]>;
    openDevice: (path: string) => Promise<boolean>;
    closeDevice: (path: string) => Promise<void>;
    startMonitoring: () => Promise<void>;
    stopMonitoring: () => Promise<void>;
    getCurrentStates: () => Promise<HIDInputState[]>;
    onInputStates: (callback: (states: HIDInputState[]) => void) => void;
  };

  pygame: {
    isAvailable: () => Promise<boolean>;
    start: () => Promise<boolean>;
    stop: () => Promise<void>;
    getDevices: () => Promise<PygameDevice[]>;
    startMonitoring: () => Promise<void>;
    stopMonitoring: () => Promise<void>;
    enumerate: () => Promise<void>;
    onInputStates: (callback: (states: PygameInputState[]) => void) => void;
    onDevicesChanged: (callback: (devices: PygameDevice[]) => void) => void;
  };

  displays: {
    getAll: () => Promise<DisplayInfo[]>;
    saveConfiguration: (name: string) => Promise<boolean>;
    getSavedConfigurations: () => Promise<DisplayConfiguration[]>;
    deleteConfiguration: (name: string) => Promise<boolean>;
    checkConfiguration: (name: string) => Promise<boolean>;
  };

  keybindings: {
    scanSimulators: () => Promise<SimulatorInfo[]>;
    createBackup: (simulator: string, name: string) => Promise<boolean>;
    restoreBackup: (name: string) => Promise<boolean>;
    getBackups: () => Promise<KeybindingBackup[]>;
    deleteBackup: (name: string) => Promise<boolean>;
  };

  keybindingProfiles: {
    getAll: () => Promise<KeybindingProfile[]>;
    get: (id: string) => Promise<KeybindingProfile | undefined>;
    save: (profile: KeybindingProfile) => Promise<void>;
    delete: (id: string) => Promise<boolean>;
    duplicate: (id: string, newName: string) => Promise<KeybindingProfile | undefined>;
    addAction: (profileId: string, action: CommonAction) => Promise<boolean>;
    updateAction: (
      profileId: string,
      actionId: string,
      updates: Partial<CommonAction>
    ) => Promise<boolean>;
    removeAction: (profileId: string, actionId: string) => Promise<boolean>;
    addBinding: (profileId: string, binding: VehicleBinding) => Promise<boolean>;
    removeBinding: (
      profileId: string,
      vehicleId: string,
      commonActionId: string
    ) => Promise<boolean>;
    exportProfile: (id: string) => Promise<string | undefined>;
    importProfile: (jsonData: string, newName?: string) => Promise<KeybindingProfile | undefined>;
  };

  system: {
    getPlatform: () => string;
  };

  debug: {
    getSystemInfo: () => Promise<SystemInfo>;
    getDeviceStatus: () => Promise<DebugDeviceStatus>;
    getPaths: () => Promise<DebugPaths>;
    getRecentLogs: (lineCount?: number) => Promise<string[]>;
    exportLogs: () => Promise<ExportLogsResult>;
  };

  process: {
    isRunning: (processName: string) => Promise<ProcessCheckResult>;
    checkMultiple: (processNames: string[]) => Promise<ProcessCheckResult[]>;
    findKnown: () => Promise<ProcessCheckResult[]>;
    getRunningKnown: () => Promise<ProcessCheckResult[]>;
    launch: (executablePath: string, args?: string[]) => Promise<boolean>;
  };

  games: {
    getProfiles: () => Promise<GameProfile[]>;
    getProfile: (id: string) => Promise<GameProfile | undefined>;
    saveProfile: (profile: GameProfile) => Promise<void>;
    deleteProfile: (id: string) => Promise<boolean>;
    detectGames: () => Promise<DetectedGame[]>;
    launch: (profileId: string) => Promise<LaunchResult>;
    quickLaunch: (executablePath: string, args?: string[]) => Promise<LaunchResult>;
  };

  simulatorConfig: {
    detectSimulators: () => Promise<SimulatorInstallation[]>;
    getInstallation: (simulator: Simulator) => Promise<SimulatorInstallation>;
    scanSimulator: (simulator: Simulator, forceRefresh?: boolean) => Promise<SimulatorScanResult>;
    scanAllSimulators: (forceRefresh?: boolean) => Promise<SimulatorScanResult[]>;
  };

  settings: {
    get: () => Promise<AppSettings>;
    update: (updates: Partial<AppSettings>) => Promise<void>;
    getSimulatorPath: (simulator: Simulator) => Promise<SimulatorPath | undefined>;
    setSimulatorPath: (simulatorPath: SimulatorPath) => Promise<void>;
    removeSimulatorPath: (simulator: Simulator) => Promise<void>;
    autoScanSimulator: (simulator: Simulator) => Promise<SimulatorPath | null>;
    autoScanAllSimulators: () => Promise<SimulatorPath[]>;
    verifySimulatorPath: (simulator: Simulator) => Promise<boolean>;
  };
}

// Augment the Window interface
declare global {
  interface Window {
    simManager: SimManagerApi;
  }
}
