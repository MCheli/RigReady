/**
 * BeamNG.drive Integration Service
 * Handles detection, config path resolution, and backup/restore for BeamNG.drive.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface BeamNGInstallation {
  installed: boolean;
  installPath?: string;
  configPath?: string;
  versions: string[];
}

class BeamNGIntegrationService {
  private readonly possibleInstallPaths = [
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\BeamNG.drive',
    'D:\\SteamLibrary\\steamapps\\common\\BeamNG.drive',
    'E:\\SteamLibrary\\steamapps\\common\\BeamNG.drive',
    'D:\\Steam\\steamapps\\common\\BeamNG.drive',
  ];

  private readonly configBase = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'BeamNG.drive'
  );

  /**
   * Detect BeamNG.drive installation and config paths.
   */
  detect(): BeamNGInstallation {
    const result: BeamNGInstallation = {
      installed: false,
      versions: [],
    };

    // Find install path
    for (const p of this.possibleInstallPaths) {
      if (fs.existsSync(p)) {
        result.installPath = p;
        result.installed = true;
        break;
      }
    }

    // Find config path and versions
    if (fs.existsSync(this.configBase)) {
      result.configPath = this.configBase;
      if (!result.installed) result.installed = true;

      try {
        const entries = fs.readdirSync(this.configBase, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && /^\d+\.\d+/.test(entry.name)) {
            result.versions.push(entry.name);
          }
        }
        result.versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      } catch {
        // Ignore read errors
      }
    }

    return result;
  }

  /**
   * Get the input settings path for a specific version.
   */
  getInputSettingsPath(version?: string): string | null {
    if (!fs.existsSync(this.configBase)) return null;

    const ver = version || this.getLatestVersion();
    if (!ver) return null;

    const settingsPath = path.join(this.configBase, ver, 'settings', 'inputmaps');
    return fs.existsSync(settingsPath) ? settingsPath : null;
  }

  /**
   * Get the latest version directory.
   */
  private getLatestVersion(): string | null {
    const detection = this.detect();
    return detection.versions[0] || null;
  }

  /**
   * Backup input configuration files.
   */
  backupInputConfigs(backupName: string, version?: string): string | null {
    const inputPath = this.getInputSettingsPath(version);
    if (!inputPath) return null;

    const backupDir = path.join(os.homedir(), '.rigready', 'beamng-backups', backupName);

    try {
      fs.mkdirSync(backupDir, { recursive: true });
      this.copyDirectory(inputPath, backupDir);
      return backupDir;
    } catch (error) {
      console.error('Failed to backup BeamNG configs:', error);
      return null;
    }
  }

  /**
   * Restore input configuration files from backup.
   */
  restoreInputConfigs(backupPath: string, version?: string): boolean {
    const inputPath = this.getInputSettingsPath(version);
    if (!inputPath || !fs.existsSync(backupPath)) return false;

    try {
      this.copyDirectory(backupPath, inputPath);
      return true;
    } catch (error) {
      console.error('Failed to restore BeamNG configs:', error);
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

export const beamngIntegration = new BeamNGIntegrationService();
