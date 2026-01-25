import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { DeviceManager } from './devices/deviceManager';

let mainWindow: BrowserWindow | null = null;
let deviceManager: DeviceManager;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Sim Manager',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#1a1a2e',
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
  // Get all connected devices
  ipcMain.handle('devices:getAll', async () => {
    return deviceManager.getAllDevices();
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

  // Start gamepad polling
  ipcMain.handle('devices:startGamepadPolling', async () => {
    deviceManager.startGamepadPolling((state) => {
      mainWindow?.webContents.send('devices:gamepadState', state);
    });
  });

  // Stop gamepad polling
  ipcMain.handle('devices:stopGamepadPolling', async () => {
    deviceManager.stopGamepadPolling();
  });
}

app.whenReady().then(() => {
  deviceManager = new DeviceManager();
  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
