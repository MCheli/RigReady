import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to the renderer
contextBridge.exposeInMainWorld('simManager', {
  // Device management
  devices: {
    getAll: () => ipcRenderer.invoke('devices:getAll'),
    getExpected: () => ipcRenderer.invoke('devices:getExpected'),
    saveExpected: () => ipcRenderer.invoke('devices:saveExpected'),
    checkStatus: () => ipcRenderer.invoke('devices:checkStatus'),
    startGamepadPolling: () => ipcRenderer.invoke('devices:startGamepadPolling'),
    stopGamepadPolling: () => ipcRenderer.invoke('devices:stopGamepadPolling'),
    onGamepadState: (callback: (state: any) => void) => {
      ipcRenderer.on('devices:gamepadState', (_event, state) => callback(state));
    },
  },

  // System info
  system: {
    getPlatform: () => process.platform,
  },
});
