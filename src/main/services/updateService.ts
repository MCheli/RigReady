import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import type { UpdateStatus } from '../../shared/types';

class UpdateService {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = {
    state: 'idle',
    version: app.getVersion(),
  };

  constructor() {
    // Configure auto updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;

    this.setupEventHandlers();
    this.setupIpcHandlers();
  }

  private setupEventHandlers(): void {
    autoUpdater.on('checking-for-update', () => {
      this.updateStatus({ state: 'checking' });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.updateStatus({
        state: 'available',
        availableVersion: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      });
    });

    autoUpdater.on('update-not-available', (_info: UpdateInfo) => {
      this.updateStatus({ state: 'not-available' });
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.updateStatus({
        state: 'downloading',
        downloadProgress: {
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        },
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.updateStatus({
        state: 'downloaded',
        availableVersion: info.version,
      });
    });

    autoUpdater.on('error', (error: Error) => {
      console.error('Auto-update error:', error.message);
      this.updateStatus({
        state: 'error',
        error: error.message,
      });
    });
  }

  private setupIpcHandlers(): void {
    ipcMain.handle('update:check', async () => {
      try {
        const result = await autoUpdater.checkForUpdates();
        return result !== null;
      } catch (error) {
        console.error('Check for updates failed:', error);
        return false;
      }
    });

    ipcMain.handle('update:download', async () => {
      try {
        await autoUpdater.downloadUpdate();
        return true;
      } catch (error) {
        console.error('Download update failed:', error);
        return false;
      }
    });

    ipcMain.handle('update:install', () => {
      autoUpdater.quitAndInstall(false, true);
    });

    ipcMain.handle('update:getStatus', () => {
      return this.status;
    });

    ipcMain.handle('update:getVersion', () => {
      return app.getVersion();
    });
  }

  private updateStatus(updates: Partial<UpdateStatus>): void {
    this.status = {
      ...this.status,
      ...updates,
      version: app.getVersion(),
    };
    this.sendStatusToRenderer();
  }

  private sendStatusToRenderer(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update:status', this.status);
    }
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  async checkForUpdates(): Promise<void> {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      console.error('Failed to check for updates:', error);
    }
  }
}

export const updateService = new UpdateService();
