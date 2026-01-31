import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { DeviceManager } from './devices/deviceManager';
import { HIDManager } from './devices/hidManager';
import { PygameManager } from './devices/pygameManager';
import { DisplayManager } from './devices/displayManager';
import { KeybindingManager } from './devices/keybindingManager';
import { processService } from './services/processService';
import { gameLaunchService, type GameProfile } from './services/gameLaunchService';
import { keybindingProfileService } from './services/keybindingProfileService';
import { simulatorConfigService } from './services/simulatorConfigService';
import { settingsService, type SimulatorPath } from './services/settingsService';
import { updateService } from './services/updateService';
import type {
  CommonAction,
  VehicleBinding,
  KeybindingProfile,
  Simulator,
  AppSettings,
} from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let deviceManager: DeviceManager;
let hidManager: HIDManager;
let pygameManager: PygameManager;
let displayManager: DisplayManager;
let keybindingManager: KeybindingManager;

// Logging setup
const logDir = path.join(process.env.USERPROFILE || '', '.rigready');
const logFile = path.join(logDir, 'app.log');

// Keep original console methods FIRST
const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);

// Flag to prevent recursion
let isLogging = false;

function ensureLogDir(): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function writeLog(message: string): void {
  if (isLogging) return;
  isLogging = true;
  try {
    ensureLogDir();
    const logLine = message.startsWith('[')
      ? message
      : `[${new Date().toISOString()}] [main] ${message}`;
    fs.appendFileSync(logFile, logLine + '\n');
    originalLog(logLine);
  } finally {
    isLogging = false;
  }
}

function clearLog(): void {
  ensureLogDir();
  fs.writeFileSync(logFile, `[${new Date().toISOString()}] [main] === App Started ===\n`);
}

// Override console methods
console.log = (...args: unknown[]) => {
  if (isLogging) return;
  isLogging = true;
  try {
    const message = args
      .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
      .join(' ');
    const logLine = `[${new Date().toISOString()}] [LOG] [main] ${message}`;
    ensureLogDir();
    fs.appendFileSync(logFile, logLine + '\n');
    originalLog(logLine);
  } finally {
    isLogging = false;
  }
};

console.error = (...args: unknown[]) => {
  if (isLogging) return;
  isLogging = true;
  try {
    const message = args
      .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
      .join(' ');
    const logLine = `[${new Date().toISOString()}] [ERROR] [main] ${message}`;
    ensureLogDir();
    fs.appendFileSync(logFile, logLine + '\n');
    originalError(logLine);
  } finally {
    isLogging = false;
  }
};

function createWindow(): void {
  // Remove default menu bar
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'RigReady',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
    backgroundColor: '#0a0a0a',
  });

  // Load the renderer
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIPC(): void {
  // Logging from renderer
  ipcMain.on('log', (_event, message: string) => {
    writeLog(message);
  });

  // Get all connected devices
  ipcMain.handle('devices:getAll', async () => {
    return deviceManager.getAllDevices();
  });

  // Get pygame devices for the Devices page
  ipcMain.handle('devices:getPygameDevices', async () => {
    return pygameManager.getDevices();
  });

  // Get expected device configuration
  ipcMain.handle('devices:getExpected', async () => {
    return deviceManager.getExpectedDevices();
  });

  // Save current devices as expected configuration
  ipcMain.handle('devices:saveExpected', async () => {
    return deviceManager.saveCurrentAsExpected();
  });

  // Check device status (connected vs expected)
  ipcMain.handle('devices:checkStatus', async () => {
    return deviceManager.checkDeviceStatus();
  });

  // HID device management
  ipcMain.handle('hid:getDevices', async () => {
    return hidManager.getAllDevices(false);
  });

  ipcMain.handle('hid:getSimDevices', async () => {
    return hidManager.getSimDevices();
  });

  // Get HID devices that pygame doesn't see
  ipcMain.handle('hid:getMissingDevices', async () => {
    const hidDevices = hidManager.getSimDevices();
    const pygameDevices = pygameManager.getDevices();
    const pygameNames = new Set(pygameDevices.map((d) => d.name.toLowerCase()));

    // Filter to joystick-type devices (usagePage 1, usage 4 or 5) not in pygame
    return hidDevices.filter((d) => {
      const isJoystick = d.usagePage === 1 && (d.usage === 4 || d.usage === 5);
      const inPygame = pygameNames.has((d.product || '').toLowerCase());
      return isJoystick && !inPygame;
    });
  });

  ipcMain.handle('hid:startMonitoring', async () => {
    hidManager.startMonitoring((states) => {
      mainWindow?.webContents.send('hid:inputStates', states);
    });
  });

  ipcMain.handle('hid:stopMonitoring', async () => {
    hidManager.stopMonitoring();
  });

  ipcMain.handle('hid:openDevice', async (_event, path: string) => {
    return hidManager.openDevice(path);
  });

  ipcMain.handle('hid:closeDevice', async (_event, path: string) => {
    hidManager.closeDevice(path);
  });

  ipcMain.handle('hid:getCurrentStates', async () => {
    return hidManager.getCurrentStates();
  });

  // Pygame (DirectInput) device management
  ipcMain.handle('pygame:isAvailable', async () => {
    return pygameManager.isAvailable();
  });

  ipcMain.handle('pygame:start', async () => {
    return await pygameManager.start();
  });

  ipcMain.handle('pygame:stop', async () => {
    pygameManager.stop();
  });

  ipcMain.handle('pygame:getDevices', async () => {
    return pygameManager.getDevices();
  });

  ipcMain.handle('pygame:startMonitoring', async () => {
    pygameManager.startMonitoring((states) => {
      mainWindow?.webContents.send('pygame:inputStates', states);
    });
  });

  ipcMain.handle('pygame:stopMonitoring', async () => {
    pygameManager.stopMonitoring();
  });

  ipcMain.handle('pygame:enumerate', async () => {
    pygameManager.enumerate();
  });

  // Unified device list for input tester (combines pygame and HID devices)
  ipcMain.handle('devices:getUnifiedInputDevices', async () => {
    const unifiedDevices: Array<{
      type: 'pygame' | 'hid';
      id: string;
      displayName: string;
      pygameIndex?: number;
      numAxes?: number;
      numButtons?: number;
      numHats?: number;
      hidPath?: string;
      vendorId?: number;
      productId?: number;
    }> = [];

    // Add pygame/DirectInput devices
    const pygameDevices = pygameManager.getDevices();
    for (const device of pygameDevices) {
      unifiedDevices.push({
        type: 'pygame',
        id: `pygame:${device.index}`,
        displayName: device.name,
        pygameIndex: device.index,
        numAxes: device.numAxes,
        numButtons: device.numButtons,
        numHats: device.numHats,
      });
    }

    // Add HID devices that pygame doesn't see (joystick-type only)
    const hidDevices = hidManager.getSimDevices();
    const pygameNames = new Set(pygameDevices.map((d) => d.name.toLowerCase()));

    for (const device of hidDevices) {
      const isJoystick = device.usagePage === 1 && (device.usage === 4 || device.usage === 5);
      const inPygame = pygameNames.has((device.product || '').toLowerCase());

      if (isJoystick && !inPygame && device.path) {
        unifiedDevices.push({
          type: 'hid',
          id: `hid:${device.path}`,
          displayName: device.product || `HID ${device.productId.toString(16).toUpperCase()}`,
          hidPath: device.path,
          vendorId: device.vendorId,
          productId: device.productId,
        });
      }
    }

    return unifiedDevices;
  });

  // Display management
  ipcMain.handle('displays:getAll', async () => {
    return displayManager.getDisplays();
  });

  ipcMain.handle('displays:saveConfiguration', async (_event, name: string) => {
    return displayManager.saveCurrentConfiguration(name);
  });

  ipcMain.handle('displays:getSavedConfigurations', async () => {
    return displayManager.getSavedConfigurations();
  });

  ipcMain.handle('displays:deleteConfiguration', async (_event, name: string) => {
    return displayManager.deleteConfiguration(name);
  });

  ipcMain.handle('displays:checkConfiguration', async (_event, name: string) => {
    return displayManager.checkConfiguration(name);
  });

  // Keybinding management
  ipcMain.handle('keybindings:scanSimulators', async () => {
    return keybindingManager.scanSimulators();
  });

  ipcMain.handle('keybindings:createBackup', async (_event, simulator: string, name: string) => {
    return keybindingManager.createBackup(simulator, name);
  });

  ipcMain.handle('keybindings:restoreBackup', async (_event, name: string) => {
    return keybindingManager.restoreBackup(name);
  });

  ipcMain.handle('keybindings:getBackups', async () => {
    return keybindingManager.getBackups();
  });

  ipcMain.handle('keybindings:deleteBackup', async (_event, name: string) => {
    return keybindingManager.deleteBackup(name);
  });

  // Debug handlers
  ipcMain.handle('debug:getSystemInfo', async () => {
    return {
      platform: process.platform,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
      v8Version: process.versions.v8,
    };
  });

  ipcMain.handle('debug:getDeviceStatus', async () => {
    const pygameAvailable = pygameManager.isAvailable();
    const pygameDevices = pygameManager.getDevices();
    const hidDevices = hidManager.getSimDevices();
    const usbDevices = await deviceManager.getAllDevices();

    return {
      pygameAvailable,
      pygameDeviceCount: pygameDevices.length,
      hidDeviceCount: hidDevices.length,
      usbDeviceCount: usbDevices.length,
    };
  });

  ipcMain.handle('debug:getPaths', async () => {
    return {
      configPath: logDir,
      logsPath: logFile,
    };
  });

  ipcMain.handle('debug:getRecentLogs', async (_event, lineCount = 50) => {
    try {
      if (!fs.existsSync(logFile)) {
        return [];
      }
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      return lines.slice(-lineCount);
    } catch {
      return [];
    }
  });

  ipcMain.handle('debug:exportLogs', async () => {
    try {
      if (!fs.existsSync(logFile)) {
        return { success: false, error: 'No log file found' };
      }
      const content = fs.readFileSync(logFile, 'utf-8');
      const exportPath = path.join(
        process.env.USERPROFILE || '',
        'Desktop',
        `rigready-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
      );
      fs.writeFileSync(exportPath, content);
      return { success: true, path: exportPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  // Process detection
  ipcMain.handle('process:isRunning', async (_event, processName: string) => {
    return processService.isProcessRunning(processName);
  });

  ipcMain.handle('process:checkMultiple', async (_event, processNames: string[]) => {
    return processService.checkProcesses(processNames);
  });

  ipcMain.handle('process:findKnown', async () => {
    return processService.findKnownProcesses();
  });

  ipcMain.handle('process:getRunningKnown', async () => {
    return processService.getRunningKnownProcesses();
  });

  ipcMain.handle('process:launch', async (_event, executablePath: string, args?: string[]) => {
    return processService.launchProcess(executablePath, args || []);
  });

  // Game launch management
  ipcMain.handle('games:getProfiles', async () => {
    return gameLaunchService.getProfiles();
  });

  ipcMain.handle('games:getProfile', async (_event, id: string) => {
    return gameLaunchService.getProfile(id);
  });

  ipcMain.handle('games:saveProfile', async (_event, profile: GameProfile) => {
    gameLaunchService.saveProfile(profile);
  });

  ipcMain.handle('games:deleteProfile', async (_event, id: string) => {
    return gameLaunchService.deleteProfile(id);
  });

  ipcMain.handle('games:detectGames', async () => {
    return gameLaunchService.detectGames();
  });

  ipcMain.handle('games:launch', async (_event, profileId: string) => {
    return gameLaunchService.launchGame(profileId);
  });

  ipcMain.handle('games:quickLaunch', async (_event, executablePath: string, args?: string[]) => {
    return gameLaunchService.quickLaunch(executablePath, args || []);
  });

  // Keybinding profile management
  ipcMain.handle('keybindingProfiles:getAll', async () => {
    return keybindingProfileService.getProfiles();
  });

  ipcMain.handle('keybindingProfiles:get', async (_event, id: string) => {
    return keybindingProfileService.getProfile(id);
  });

  ipcMain.handle('keybindingProfiles:save', async (_event, profile: KeybindingProfile) => {
    keybindingProfileService.updateProfile(profile);
  });

  ipcMain.handle('keybindingProfiles:delete', async (_event, id: string) => {
    return keybindingProfileService.deleteProfile(id);
  });

  ipcMain.handle('keybindingProfiles:duplicate', async (_event, id: string, newName: string) => {
    return keybindingProfileService.duplicateProfile(id, newName);
  });

  ipcMain.handle(
    'keybindingProfiles:addAction',
    async (_event, profileId: string, action: CommonAction) => {
      return keybindingProfileService.addAction(profileId, action);
    }
  );

  ipcMain.handle(
    'keybindingProfiles:updateAction',
    async (_event, profileId: string, actionId: string, updates: Partial<CommonAction>) => {
      return keybindingProfileService.updateAction(profileId, actionId, updates);
    }
  );

  ipcMain.handle(
    'keybindingProfiles:removeAction',
    async (_event, profileId: string, actionId: string) => {
      return keybindingProfileService.removeAction(profileId, actionId);
    }
  );

  ipcMain.handle(
    'keybindingProfiles:addBinding',
    async (_event, profileId: string, binding: VehicleBinding) => {
      return keybindingProfileService.addBinding(profileId, binding);
    }
  );

  ipcMain.handle(
    'keybindingProfiles:removeBinding',
    async (_event, profileId: string, vehicleId: string, commonActionId: string) => {
      return keybindingProfileService.removeBinding(profileId, vehicleId, commonActionId);
    }
  );

  ipcMain.handle('keybindingProfiles:export', async (_event, id: string) => {
    return keybindingProfileService.exportProfile(id);
  });

  ipcMain.handle(
    'keybindingProfiles:import',
    async (_event, jsonData: string, newName?: string) => {
      return keybindingProfileService.importProfile(jsonData, newName);
    }
  );

  // Simulator config service
  ipcMain.handle('simulatorConfig:detectSimulators', async () => {
    return simulatorConfigService.detectSimulators();
  });

  ipcMain.handle('simulatorConfig:getInstallation', async (_event, simulator: Simulator) => {
    return simulatorConfigService.getInstallation(simulator);
  });

  ipcMain.handle(
    'simulatorConfig:scanSimulator',
    async (_event, simulator: Simulator, forceRefresh?: boolean) => {
      return simulatorConfigService.scanSimulator(simulator, forceRefresh);
    }
  );

  ipcMain.handle('simulatorConfig:scanAllSimulators', async (_event, forceRefresh?: boolean) => {
    return simulatorConfigService.scanAllSimulators(forceRefresh);
  });

  // Settings service
  ipcMain.handle('settings:get', async () => {
    return settingsService.getSettings();
  });

  ipcMain.handle('settings:update', async (_event, updates: Partial<AppSettings>) => {
    settingsService.updateSettings(updates);
  });

  ipcMain.handle('settings:getSimulatorPath', async (_event, simulator: Simulator) => {
    return settingsService.getSimulatorPath(simulator);
  });

  ipcMain.handle('settings:setSimulatorPath', async (_event, simulatorPath: SimulatorPath) => {
    settingsService.setSimulatorPath(simulatorPath);
  });

  ipcMain.handle('settings:removeSimulatorPath', async (_event, simulator: Simulator) => {
    settingsService.removeSimulatorPath(simulator);
  });

  ipcMain.handle('settings:autoScanSimulator', async (_event, simulator: Simulator) => {
    return settingsService.autoScanSimulator(simulator);
  });

  ipcMain.handle('settings:autoScanAllSimulators', async () => {
    return settingsService.autoScanAllSimulators();
  });

  ipcMain.handle('settings:verifySimulatorPath', async (_event, simulator: Simulator) => {
    return settingsService.verifySimulatorPath(simulator);
  });
}

app.whenReady().then(() => {
  clearLog();
  console.log('Initializing RigReady...');

  deviceManager = new DeviceManager();
  console.log('Device manager initialized');

  hidManager = new HIDManager();
  const simDevices = hidManager.getSimDevices();
  console.log(`HID Manager initialized - found ${simDevices.length} sim devices`);

  displayManager = new DisplayManager();
  console.log('Display manager initialized');

  keybindingManager = new KeybindingManager();
  console.log('Keybinding manager initialized');

  pygameManager = new PygameManager();
  if (pygameManager.isAvailable()) {
    console.log('Pygame Manager initialized - DirectInput available');
    // Start pygame manager automatically
    pygameManager.start().then((started) => {
      if (started) {
        const devices = pygameManager.getDevices();
        console.log(`Pygame started - found ${devices.length} DirectInput devices`);
      } else {
        console.log('Pygame failed to start');
      }
    });
  } else {
    console.log('Pygame Manager not available - run: npm run setup:python');
  }

  // Set up device change listener for pygame
  pygameManager.onDeviceChange((devices) => {
    mainWindow?.webContents.send('pygame:devicesChanged', devices);
  });

  setupIPC();
  console.log('IPC handlers registered');

  createWindow();
  console.log('Main window created');

  // Set up update service with main window
  if (mainWindow) {
    updateService.setMainWindow(mainWindow);
  }

  // Check for updates on startup (after 5 second delay)
  const settings = settingsService.getSettings();
  if (settings.checkForUpdates) {
    setTimeout(() => {
      console.log('Checking for updates...');
      updateService.checkForUpdates();
    }, 5000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Stop pygame manager
  if (pygameManager) {
    pygameManager.stop();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
