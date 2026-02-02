/**
 * Stream Deck Service
 * Manages Stream Deck backup/restore functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { shell } from 'electron';
import type {
  StreamDeckInstallation,
  StreamDeckProfile,
  StreamDeckBackup,
  StreamDeckBackupResult,
  StreamDeckRestoreResult,
} from '../../shared/streamDeckTypes';

// Use dynamic import for archiver (ESM module)
let archiver: typeof import('archiver') | null = null;

async function getArchiver() {
  if (!archiver) {
    archiver = (await import('archiver')).default;
  }
  return archiver;
}

class StreamDeckService {
  private readonly DOWNLOAD_URL = 'https://www.elgato.com/downloads';
  private readonly BACKUP_DIR = path.join(
    process.env.USERPROFILE || os.homedir(),
    '.rigready',
    'streamdeck-backups'
  );
  private readonly BACKUP_EXTENSION = '.streamDeckProfilesBackup';

  constructor() {
    this.ensureBackupDir();
  }

  /**
   * Ensure backup directory exists
   */
  private ensureBackupDir(): void {
    if (!fs.existsSync(this.BACKUP_DIR)) {
      fs.mkdirSync(this.BACKUP_DIR, { recursive: true });
    }
  }

  /**
   * Detect Stream Deck software installation
   */
  detectInstallation(): StreamDeckInstallation {
    const result: StreamDeckInstallation = {
      installed: false,
    };

    // Check common installation paths
    const possiblePaths = [
      path.join(process.env['ProgramFiles'] || '', 'Elgato', 'StreamDeck'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Elgato', 'StreamDeck'),
      path.join(process.env.LOCALAPPDATA || '', 'Elgato', 'StreamDeck'),
    ];

    for (const p of possiblePaths) {
      const exePath = path.join(p, 'StreamDeck.exe');
      if (fs.existsSync(exePath)) {
        result.installed = true;
        result.softwarePath = exePath;
        break;
      }
    }

    // Get profiles path
    const profilesPath = this.getProfilesPath();
    if (profilesPath && fs.existsSync(profilesPath)) {
      result.profilesPath = profilesPath;
    }

    // Try to get version from software path
    if (result.softwarePath) {
      try {
        const versionPath = path.join(path.dirname(result.softwarePath), 'version.txt');
        if (fs.existsSync(versionPath)) {
          result.version = fs.readFileSync(versionPath, 'utf-8').trim();
        }
      } catch {
        // Version detection failed, not critical
      }
    }

    return result;
  }

  /**
   * Get Stream Deck profiles directory path
   */
  getProfilesPath(): string | null {
    const appData = process.env.APPDATA;
    if (!appData) return null;

    // Stream Deck stores profiles in AppData/Roaming/Elgato/StreamDeck/ProfilesV2
    const profilesPath = path.join(appData, 'Elgato', 'StreamDeck', 'ProfilesV2');

    if (fs.existsSync(profilesPath)) {
      return profilesPath;
    }

    // Fallback to older ProfilesV3 path
    const profilesV3Path = path.join(appData, 'Elgato', 'StreamDeck', 'ProfilesV3');
    if (fs.existsSync(profilesV3Path)) {
      return profilesV3Path;
    }

    return null;
  }

  /**
   * Get list of current Stream Deck profiles
   */
  getProfiles(): StreamDeckProfile[] {
    const profilesPath = this.getProfilesPath();
    if (!profilesPath) return [];

    const profiles: StreamDeckProfile[] = [];

    try {
      const entries = fs.readdirSync(profilesPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.endsWith('.sdProfile')) {
          const profilePath = path.join(profilesPath, entry.name);
          const manifestPath = path.join(profilePath, 'manifest.json');

          let name = entry.name.replace('.sdProfile', '');
          let deviceModel = 'Unknown';
          let modifiedTime = 0;

          // Try to read manifest for profile info
          try {
            if (fs.existsSync(manifestPath)) {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
              name = manifest.Name || name;
              deviceModel = manifest.DeviceModel || manifest.DeviceUUID || deviceModel;
            }
            const stats = fs.statSync(profilePath);
            modifiedTime = stats.mtimeMs;
          } catch {
            // Use defaults if manifest read fails
          }

          profiles.push({
            id: entry.name,
            name,
            deviceModel,
            modifiedTime,
          });
        }
      }

      // Sort by modified time descending
      profiles.sort((a, b) => b.modifiedTime - a.modifiedTime);
    } catch (error) {
      console.error('Failed to read Stream Deck profiles:', error);
    }

    return profiles;
  }

  /**
   * Create a backup of Stream Deck profiles
   */
  async createBackup(name: string): Promise<StreamDeckBackupResult> {
    const profilesPath = this.getProfilesPath();
    if (!profilesPath) {
      return {
        success: false,
        error: 'Stream Deck profiles path not found',
      };
    }

    const sanitizedName = name.replace(/[^a-zA-Z0-9-_]/g, '_');
    const timestamp = new Date().toISOString().split('T')[0];
    const backupFileName = `${sanitizedName}-${timestamp}${this.BACKUP_EXTENSION}`;
    const backupPath = path.join(this.BACKUP_DIR, backupFileName);

    try {
      const arch = await getArchiver();
      const output = fs.createWriteStream(backupPath);
      const archive = arch('zip', { zlib: { level: 9 } });

      return new Promise((resolve) => {
        output.on('close', () => {
          console.log(`Stream Deck backup created: ${backupPath} (${archive.pointer()} bytes)`);
          resolve({
            success: true,
            path: backupPath,
          });
        });

        archive.on('error', (err: Error) => {
          console.error('Stream Deck backup error:', err);
          resolve({
            success: false,
            error: err.message,
          });
        });

        archive.pipe(output);
        archive.directory(profilesPath, false);
        archive.finalize();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to create Stream Deck backup:', error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Restore a Stream Deck backup
   */
  async restoreBackup(backupPath: string): Promise<StreamDeckRestoreResult> {
    const profilesPath = this.getProfilesPath();
    if (!profilesPath) {
      return {
        success: false,
        message: 'Stream Deck profiles path not found',
        restoredProfiles: 0,
        error: 'Profiles path not found',
      };
    }

    if (!fs.existsSync(backupPath)) {
      return {
        success: false,
        message: 'Backup file not found',
        restoredProfiles: 0,
        error: 'Backup file does not exist',
      };
    }

    try {
      // Dynamic import for extract-zip
      const extractZip = (await import('extract-zip')).default;

      // Create a pre-restore backup
      const preRestoreBackup = await this.createBackup('pre-restore');
      if (!preRestoreBackup.success) {
        console.warn('Failed to create pre-restore backup:', preRestoreBackup.error);
      }

      // Extract backup to profiles directory
      await extractZip(backupPath, { dir: profilesPath });

      // Count restored profiles
      const profiles = this.getProfiles();

      return {
        success: true,
        message: `Restored ${profiles.length} profile(s)`,
        restoredProfiles: profiles.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to restore Stream Deck backup:', error);
      return {
        success: false,
        message: `Restore failed: ${message}`,
        restoredProfiles: 0,
        error: message,
      };
    }
  }

  /**
   * Get list of available backups
   */
  getBackups(): StreamDeckBackup[] {
    this.ensureBackupDir();
    const backups: StreamDeckBackup[] = [];

    try {
      const files = fs.readdirSync(this.BACKUP_DIR);

      for (const file of files) {
        if (file.endsWith(this.BACKUP_EXTENSION)) {
          const filePath = path.join(this.BACKUP_DIR, file);
          const stats = fs.statSync(filePath);

          // Extract name from filename (remove timestamp and extension)
          const name = file.replace(this.BACKUP_EXTENSION, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');

          backups.push({
            name,
            path: filePath,
            timestamp: stats.mtimeMs,
            size: stats.size,
            profileCount: 0, // Would need to read ZIP to get actual count
          });
        }
      }

      // Sort by timestamp descending
      backups.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Failed to read Stream Deck backups:', error);
    }

    return backups;
  }

  /**
   * Delete a backup
   */
  deleteBackup(backupPath: string): boolean {
    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        return true;
      }
    } catch (error) {
      console.error('Failed to delete Stream Deck backup:', error);
    }
    return false;
  }

  /**
   * Open Stream Deck software
   */
  openSoftware(): boolean {
    const installation = this.detectInstallation();
    if (installation.softwarePath && fs.existsSync(installation.softwarePath)) {
      shell.openPath(installation.softwarePath);
      return true;
    }
    return false;
  }

  /**
   * Open Stream Deck download page
   */
  openDownloadPage(): void {
    shell.openExternal(this.DOWNLOAD_URL);
  }

  /**
   * Open profiles folder in explorer
   */
  openProfilesFolder(): boolean {
    const profilesPath = this.getProfilesPath();
    if (profilesPath && fs.existsSync(profilesPath)) {
      shell.openPath(profilesPath);
      return true;
    }
    return false;
  }

  /**
   * Import an external backup file
   */
  async importBackup(sourcePath: string): Promise<StreamDeckBackupResult> {
    if (!fs.existsSync(sourcePath)) {
      return {
        success: false,
        error: 'Source file not found',
      };
    }

    const fileName = path.basename(sourcePath);
    const destPath = path.join(this.BACKUP_DIR, fileName);

    try {
      fs.copyFileSync(sourcePath, destPath);
      return {
        success: true,
        path: destPath,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }
}

export const streamDeckService = new StreamDeckService();
