/**
 * Le Mans Ultimate (LMU) Integration Service
 * Handles detection, config path resolution, and backup/restore for LMU.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LMUInstallation {
  installed: boolean;
  installPath?: string;
  configPath?: string;
}

class LMUIntegrationService {
  private readonly possibleInstallPaths = [
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Le Mans Ultimate',
    'D:\\SteamLibrary\\steamapps\\common\\Le Mans Ultimate',
    'E:\\SteamLibrary\\steamapps\\common\\Le Mans Ultimate',
    'D:\\Steam\\steamapps\\common\\Le Mans Ultimate',
  ];

  private readonly configBase = path.join(os.homedir(), 'Documents', 'Le Mans Ultimate');

  /**
   * Detect LMU installation.
   */
  detect(): LMUInstallation {
    const result: LMUInstallation = {
      installed: false,
    };

    // Find install path
    for (const p of this.possibleInstallPaths) {
      if (fs.existsSync(p)) {
        result.installPath = p;
        result.installed = true;
        break;
      }
    }

    // Check config path
    if (fs.existsSync(this.configBase)) {
      result.configPath = this.configBase;
      if (!result.installed) result.installed = true;
    }

    return result;
  }

  /**
   * Get the controller config directory.
   */
  getControllerConfigPath(): string | null {
    const controllerPath = path.join(this.configBase, 'UserData', 'Controller');
    return fs.existsSync(controllerPath) ? controllerPath : null;
  }

  /**
   * Get the player JSON config path.
   */
  getPlayerConfigPath(): string | null {
    const playerPath = path.join(this.configBase, 'UserData', 'player.JSON');
    return fs.existsSync(playerPath) ? playerPath : null;
  }

  /**
   * Backup controller configuration files.
   */
  backupControllerConfigs(backupName: string): string | null {
    const controllerPath = this.getControllerConfigPath();
    if (!controllerPath) return null;

    const backupDir = path.join(os.homedir(), '.rigready', 'lmu-backups', backupName);

    try {
      fs.mkdirSync(backupDir, { recursive: true });
      this.copyDirectory(controllerPath, backupDir);
      return backupDir;
    } catch (error) {
      console.error('Failed to backup LMU configs:', error);
      return null;
    }
  }

  /**
   * Restore controller configuration files from backup.
   */
  restoreControllerConfigs(backupPath: string): boolean {
    const controllerPath = this.getControllerConfigPath();
    if (!controllerPath || !fs.existsSync(backupPath)) return false;

    try {
      this.copyDirectory(backupPath, controllerPath);
      return true;
    } catch (error) {
      console.error('Failed to restore LMU configs:', error);
      return false;
    }
  }

  private copyDirectory(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

export const lmuIntegration = new LMUIntegrationService();
