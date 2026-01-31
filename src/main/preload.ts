import { contextBridge, ipcRenderer } from 'electron';
import type { SimManagerApi } from '../shared/ipc';
import type {
  HIDInputState,
  PygameInputState,
  PygameDevice,
  KeybindingProfile,
  CommonAction,
  VehicleBinding,
  Simulator,
  SimulatorPath,
  AppSettings,
} from '../shared/types';

// Type-safe API exposed to renderer
const api: SimManagerApi = {
  // Logging
  log: (message: string) => ipcRenderer.send('log', message),

  // Device management
  devices: {
    getAll: () => ipcRenderer.invoke('devices:getAll'),
    getPygameDevices: () => ipcRenderer.invoke('devices:getPygameDevices'),
    getExpected: () => ipcRenderer.invoke('devices:getExpected'),
    saveExpected: () => ipcRenderer.invoke('devices:saveExpected'),
    checkStatus: () => ipcRenderer.invoke('devices:checkStatus'),
    getUnifiedInputDevices: () => ipcRenderer.invoke('devices:getUnifiedInputDevices'),
  },

  // HID device management (node-hid) - for devices pygame doesn't see
  hid: {
    getDevices: () => ipcRenderer.invoke('hid:getDevices'),
    getSimDevices: () => ipcRenderer.invoke('hid:getSimDevices'),
    getMissingDevices: () => ipcRenderer.invoke('hid:getMissingDevices'),
    openDevice: (path: string) => ipcRenderer.invoke('hid:openDevice', path),
    closeDevice: (path: string) => ipcRenderer.invoke('hid:closeDevice', path),
    startMonitoring: () => ipcRenderer.invoke('hid:startMonitoring'),
    stopMonitoring: () => ipcRenderer.invoke('hid:stopMonitoring'),
    getCurrentStates: () => ipcRenderer.invoke('hid:getCurrentStates'),
    onInputStates: (callback: (states: HIDInputState[]) => void) => {
      ipcRenderer.on('hid:inputStates', (_event, states) => callback(states));
    },
  },

  // Pygame/DirectInput device management
  pygame: {
    isAvailable: () => ipcRenderer.invoke('pygame:isAvailable'),
    start: () => ipcRenderer.invoke('pygame:start'),
    stop: () => ipcRenderer.invoke('pygame:stop'),
    getDevices: () => ipcRenderer.invoke('pygame:getDevices'),
    startMonitoring: () => ipcRenderer.invoke('pygame:startMonitoring'),
    stopMonitoring: () => ipcRenderer.invoke('pygame:stopMonitoring'),
    enumerate: () => ipcRenderer.invoke('pygame:enumerate'),
    onInputStates: (callback: (states: PygameInputState[]) => void) => {
      ipcRenderer.on('pygame:inputStates', (_event, states) => callback(states));
    },
    onDevicesChanged: (callback: (devices: PygameDevice[]) => void) => {
      ipcRenderer.on('pygame:devicesChanged', (_event, devices) => callback(devices));
    },
  },

  // Display management
  displays: {
    getAll: () => ipcRenderer.invoke('displays:getAll'),
    saveConfiguration: (name: string) => ipcRenderer.invoke('displays:saveConfiguration', name),
    getSavedConfigurations: () => ipcRenderer.invoke('displays:getSavedConfigurations'),
    deleteConfiguration: (name: string) => ipcRenderer.invoke('displays:deleteConfiguration', name),
    checkConfiguration: (name: string) => ipcRenderer.invoke('displays:checkConfiguration', name),
  },

  // Keybinding management
  keybindings: {
    scanSimulators: () => ipcRenderer.invoke('keybindings:scanSimulators'),
    createBackup: (simulator: string, name: string) =>
      ipcRenderer.invoke('keybindings:createBackup', simulator, name),
    restoreBackup: (name: string) => ipcRenderer.invoke('keybindings:restoreBackup', name),
    getBackups: () => ipcRenderer.invoke('keybindings:getBackups'),
    deleteBackup: (name: string) => ipcRenderer.invoke('keybindings:deleteBackup', name),
  },

  // System info
  system: {
    getPlatform: () => process.platform,
  },

  // Debug
  debug: {
    getSystemInfo: () => ipcRenderer.invoke('debug:getSystemInfo'),
    getDeviceStatus: () => ipcRenderer.invoke('debug:getDeviceStatus'),
    getPaths: () => ipcRenderer.invoke('debug:getPaths'),
    getRecentLogs: (lineCount?: number) => ipcRenderer.invoke('debug:getRecentLogs', lineCount),
    exportLogs: () => ipcRenderer.invoke('debug:exportLogs'),
  },

  // Process detection
  process: {
    isRunning: (processName: string) => ipcRenderer.invoke('process:isRunning', processName),
    checkMultiple: (processNames: string[]) =>
      ipcRenderer.invoke('process:checkMultiple', processNames),
    findKnown: () => ipcRenderer.invoke('process:findKnown'),
    getRunningKnown: () => ipcRenderer.invoke('process:getRunningKnown'),
    launch: (executablePath: string, args?: string[]) =>
      ipcRenderer.invoke('process:launch', executablePath, args),
  },

  // Game launch
  games: {
    getProfiles: () => ipcRenderer.invoke('games:getProfiles'),
    getProfile: (id: string) => ipcRenderer.invoke('games:getProfile', id),
    saveProfile: (profile: any) => ipcRenderer.invoke('games:saveProfile', profile),
    deleteProfile: (id: string) => ipcRenderer.invoke('games:deleteProfile', id),
    detectGames: () => ipcRenderer.invoke('games:detectGames'),
    launch: (profileId: string) => ipcRenderer.invoke('games:launch', profileId),
    quickLaunch: (executablePath: string, args?: string[]) =>
      ipcRenderer.invoke('games:quickLaunch', executablePath, args),
  },

  // Keybinding profiles (unified system)
  keybindingProfiles: {
    getAll: () => ipcRenderer.invoke('keybindingProfiles:getAll'),
    get: (id: string) => ipcRenderer.invoke('keybindingProfiles:get', id),
    save: (profile: KeybindingProfile) => ipcRenderer.invoke('keybindingProfiles:save', profile),
    delete: (id: string) => ipcRenderer.invoke('keybindingProfiles:delete', id),
    duplicate: (id: string, newName: string) =>
      ipcRenderer.invoke('keybindingProfiles:duplicate', id, newName),
    addAction: (profileId: string, action: CommonAction) =>
      ipcRenderer.invoke('keybindingProfiles:addAction', profileId, action),
    updateAction: (profileId: string, actionId: string, updates: Partial<CommonAction>) =>
      ipcRenderer.invoke('keybindingProfiles:updateAction', profileId, actionId, updates),
    removeAction: (profileId: string, actionId: string) =>
      ipcRenderer.invoke('keybindingProfiles:removeAction', profileId, actionId),
    addBinding: (profileId: string, binding: VehicleBinding) =>
      ipcRenderer.invoke('keybindingProfiles:addBinding', profileId, binding),
    removeBinding: (profileId: string, vehicleId: string, commonActionId: string) =>
      ipcRenderer.invoke('keybindingProfiles:removeBinding', profileId, vehicleId, commonActionId),
    exportProfile: (id: string) => ipcRenderer.invoke('keybindingProfiles:export', id),
    importProfile: (jsonData: string, newName?: string) =>
      ipcRenderer.invoke('keybindingProfiles:import', jsonData, newName),
  },

  // Simulator config service
  simulatorConfig: {
    detectSimulators: () => ipcRenderer.invoke('simulatorConfig:detectSimulators'),
    getInstallation: (simulator: Simulator) =>
      ipcRenderer.invoke('simulatorConfig:getInstallation', simulator),
    scanSimulator: (simulator: Simulator, forceRefresh?: boolean) =>
      ipcRenderer.invoke('simulatorConfig:scanSimulator', simulator, forceRefresh),
    scanAllSimulators: (forceRefresh?: boolean) =>
      ipcRenderer.invoke('simulatorConfig:scanAllSimulators', forceRefresh),
  },

  // Settings service
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (updates: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', updates),
    getSimulatorPath: (simulator: Simulator) =>
      ipcRenderer.invoke('settings:getSimulatorPath', simulator),
    setSimulatorPath: (simulatorPath: SimulatorPath) =>
      ipcRenderer.invoke('settings:setSimulatorPath', simulatorPath),
    removeSimulatorPath: (simulator: Simulator) =>
      ipcRenderer.invoke('settings:removeSimulatorPath', simulator),
    autoScanSimulator: (simulator: Simulator) =>
      ipcRenderer.invoke('settings:autoScanSimulator', simulator),
    autoScanAllSimulators: () => ipcRenderer.invoke('settings:autoScanAllSimulators'),
    verifySimulatorPath: (simulator: Simulator) =>
      ipcRenderer.invoke('settings:verifySimulatorPath', simulator),
  },
};

// Expose the typed API to renderer
contextBridge.exposeInMainWorld('simManager', api);
