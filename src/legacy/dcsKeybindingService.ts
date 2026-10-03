/**
 * DCS Keybinding Service
 * Manages DCS World keybinding files - scanning, reading, and restoring
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  DCSModule,
  DCSScanResult,
  DCSDeviceBindings,
  DCSGuidMapping,
  DCSRestoreOptions,
  DCSRestoreResult,
  DCSAxisBinding,
  DCSKeyBinding,
} from '../../shared/dcsTypes';
import {
  parseDCSBindingFile,
  extractAxisBindings,
  extractKeyBindings,
  extractDeviceGuidFromPath,
} from './dcsLuaParser';

export class DCSKeybindingService {
  private savedGamesPath: string | null = null;
  private moduleCache: Map<string, DCSModule> = new Map();

  constructor() {
    this.detectSavedGamesPath();
  }

  /**
   * Detect DCS Saved Games path
   */
  private detectSavedGamesPath(): void {
    const userProfile = os.homedir();
    const possiblePaths = [
      path.join(userProfile, 'Saved Games', 'DCS.openbeta'),
      path.join(userProfile, 'Saved Games', 'DCS'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        this.savedGamesPath = p;
        console.log(`DCS Saved Games path detected: ${p}`);
        return;
      }
    }

    console.log('DCS Saved Games path not found');
  }

  /**
   * Get the current DCS Saved Games path
   */
  getSavedGamesPath(): string | null {
    return this.savedGamesPath;
  }

  /**
   * Set a custom DCS Saved Games path
   */
  setSavedGamesPath(customPath: string): boolean {
    if (fs.existsSync(customPath)) {
      this.savedGamesPath = customPath;
      this.moduleCache.clear();
      return true;
    }
    return false;
  }

  /**
   * Scan for DCS modules with input configurations
   */
  scanModules(): DCSScanResult {
    const result: DCSScanResult = {
      savedGamesPath: this.savedGamesPath || '',
      modules: [],
      errors: [],
    };

    if (!this.savedGamesPath) {
      result.errors.push('DCS Saved Games path not found');
      return result;
    }

    const inputPath = path.join(this.savedGamesPath, 'Config', 'Input');
    if (!fs.existsSync(inputPath)) {
      result.errors.push(`Input config path not found: ${inputPath}`);
      return result;
    }

    try {
      const entries = fs.readdirSync(inputPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const modulePath = path.join(inputPath, entry.name);
          const deviceCount = this.countDevicesInModule(modulePath);

          if (deviceCount > 0) {
            const module: DCSModule = {
              id: entry.name,
              name: this.formatModuleName(entry.name),
              path: modulePath,
              deviceCount,
            };
            result.modules.push(module);
            this.moduleCache.set(entry.name, module);
          }
        }
      }

      // Sort by name
      result.modules.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to scan modules: ${message}`);
    }

    return result;
  }

  /**
   * Count devices with bindings in a module folder
   */
  private countDevicesInModule(modulePath: string): number {
    try {
      const joystickPath = path.join(modulePath, 'joystick');
      if (!fs.existsSync(joystickPath)) {
        return 0;
      }

      const files = fs.readdirSync(joystickPath);
      return files.filter((f) => f.endsWith('.diff.lua')).length;
    } catch {
      return 0;
    }
  }

  /**
   * Format module ID to display name
   */
  private formatModuleName(moduleId: string): string {
    // Common module name mappings
    const nameMap: Record<string, string> = {
      'FA-18C_hornet': 'F/A-18C Hornet',
      'F-16C_50': 'F-16C Viper',
      'A-10C': 'A-10C Warthog',
      'A-10C_2': 'A-10C II Tank Killer',
      'F-14B': 'F-14B Tomcat',
      'F-15E': 'F-15E Strike Eagle',
      'AH-64D_BLK_II': 'AH-64D Apache',
      'Ka-50': 'Ka-50 Black Shark',
      'Ka-50_3': 'Ka-50 Black Shark III',
      'Mi-24P': 'Mi-24P Hind',
      'UH-1H': 'UH-1H Huey',
      'Mi-8MT': 'Mi-8MTV2 Hip',
      AV8BNA: 'AV-8B Harrier',
      'M-2000C': 'Mirage 2000C',
      'JF-17': 'JF-17 Thunder',
      'F-5E-3': 'F-5E Tiger II',
      'P-51D': 'P-51D Mustang',
      Spitfire_IX: 'Spitfire LF Mk IX',
      'Bf-109K-4': 'Bf-109 K-4',
      'FW-190A8': 'Fw-190 A-8',
      'FW-190D9': 'Fw-190 D-9',
      'P-47D-30': 'P-47D Thunderbolt',
      'I-16': 'I-16',
      MosquitoFBMkVI: 'Mosquito FB Mk VI',
      'Su-25': 'Su-25 Frogfoot',
      'Su-25T': 'Su-25T Frogfoot',
      'Su-27': 'Su-27 Flanker',
      'Su-33': 'Su-33 Flanker-D',
      'MiG-21Bis': 'MiG-21bis',
      'MiG-29': 'MiG-29 Fulcrum',
      'F-15C': 'F-15C Eagle',
      FC3: 'Flaming Cliffs 3',
    };

    return nameMap[moduleId] || moduleId.replace(/_/g, ' ');
  }

  /**
   * Get bindings for a specific module
   */
  getModuleBindings(moduleId: string): DCSDeviceBindings[] {
    if (!this.savedGamesPath) {
      return [];
    }

    const modulePath = path.join(this.savedGamesPath, 'Config', 'Input', moduleId, 'joystick');
    if (!fs.existsSync(modulePath)) {
      return [];
    }

    const bindings: DCSDeviceBindings[] = [];

    try {
      const files = fs.readdirSync(modulePath).filter((f) => f.endsWith('.diff.lua'));

      for (const file of files) {
        const filePath = path.join(modulePath, file);
        const deviceBinding = this.parseBindingFile(filePath, moduleId);
        if (deviceBinding) {
          bindings.push(deviceBinding);
        }
      }
    } catch (error) {
      console.error(`Failed to read module bindings for ${moduleId}:`, error);
    }

    return bindings;
  }

  /**
   * Parse a single binding file
   */
  private parseBindingFile(filePath: string, module: string): DCSDeviceBindings | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseDCSBindingFile(content);

      const deviceGuid = extractDeviceGuidFromPath(filePath);
      const deviceName = this.extractDeviceNameFromGuid(deviceGuid);

      const axisBindings: DCSAxisBinding[] = extractAxisBindings(parsed.axisDiffs).map((b) => ({
        id: b.id,
        name: b.name,
        key: b.key,
        filter: b.filter,
        isRemoved: b.isRemoved,
      }));

      const keyBindings: DCSKeyBinding[] = extractKeyBindings(parsed.keyDiffs).map((b) => ({
        id: b.id,
        name: b.name,
        key: b.key,
        reformers: b.reformers,
        isRemoved: b.isRemoved,
      }));

      return {
        deviceName,
        deviceGuid,
        filePath,
        module,
        axisBindings,
        keyBindings,
      };
    } catch (error) {
      console.error(`Failed to parse binding file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Extract device name from GUID
   * Format: {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX} or {DeviceName}
   */
  private extractDeviceNameFromGuid(guid: string): string {
    // Remove braces
    const inner = guid.replace(/[{}]/g, '');

    // Check if it's a standard GUID format
    if (
      /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(inner)
    ) {
      return `Device ${inner.slice(0, 8)}`;
    }

    // Otherwise, the GUID might contain the device name
    return inner;
  }

  /**
   * Get bindings from a backup path
   */
  getBackupBindings(backupPath: string, moduleId: string): DCSDeviceBindings[] {
    const modulePath = path.join(backupPath, 'Config', 'Input', moduleId, 'joystick');
    if (!fs.existsSync(modulePath)) {
      return [];
    }

    const bindings: DCSDeviceBindings[] = [];

    try {
      const files = fs.readdirSync(modulePath).filter((f) => f.endsWith('.diff.lua'));

      for (const file of files) {
        const filePath = path.join(modulePath, file);
        const deviceBinding = this.parseBindingFile(filePath, moduleId);
        if (deviceBinding) {
          bindings.push(deviceBinding);
        }
      }
    } catch (error) {
      console.error(`Failed to read backup bindings for ${moduleId}:`, error);
    }

    return bindings;
  }

  /**
   * Compute GUID mappings between backup and current devices
   */
  computeGuidMappings(
    currentBindings: DCSDeviceBindings[],
    backupBindings: DCSDeviceBindings[]
  ): DCSGuidMapping[] {
    const mappings: DCSGuidMapping[] = [];
    const usedCurrentGuids = new Set<string>();

    for (const backup of backupBindings) {
      // First, try exact GUID match
      const exactMatch = currentBindings.find(
        (c) => c.deviceGuid === backup.deviceGuid && !usedCurrentGuids.has(c.deviceGuid)
      );

      if (exactMatch) {
        mappings.push({
          backupGuid: backup.deviceGuid,
          currentGuid: exactMatch.deviceGuid,
          deviceName: backup.deviceName,
          confidence: 'exact',
        });
        usedCurrentGuids.add(exactMatch.deviceGuid);
        continue;
      }

      // Try name match
      const nameMatch = currentBindings.find(
        (c) =>
          c.deviceName.toLowerCase() === backup.deviceName.toLowerCase() &&
          !usedCurrentGuids.has(c.deviceGuid)
      );

      if (nameMatch) {
        mappings.push({
          backupGuid: backup.deviceGuid,
          currentGuid: nameMatch.deviceGuid,
          deviceName: backup.deviceName,
          confidence: 'name-match',
        });
        usedCurrentGuids.add(nameMatch.deviceGuid);
        continue;
      }

      // No match found - need manual mapping
      mappings.push({
        backupGuid: backup.deviceGuid,
        currentGuid: '',
        deviceName: backup.deviceName,
        confidence: 'manual',
      });
    }

    return mappings;
  }

  /**
   * Restore bindings from backup
   */
  restoreBindings(backupPath: string, options: DCSRestoreOptions): DCSRestoreResult {
    const result: DCSRestoreResult = {
      success: false,
      message: '',
      restoredDevices: [],
      errors: [],
    };

    if (!this.savedGamesPath) {
      result.message = 'DCS Saved Games path not configured';
      return result;
    }

    const { guidMappings, createBackup = true, module, deviceGuid } = options;

    try {
      // Create backup if requested
      if (createBackup) {
        const backupDir = this.createPreRestoreBackup(module);
        if (backupDir) {
          result.backupPath = backupDir;
        }
      }

      // Determine which devices to restore
      const devicesToRestore = deviceGuid
        ? guidMappings.filter((m) => m.backupGuid === deviceGuid)
        : guidMappings.filter((m) => m.currentGuid);

      for (const mapping of devicesToRestore) {
        if (!mapping.currentGuid) {
          result.errors.push(`No current device mapping for ${mapping.deviceName}`);
          continue;
        }

        try {
          this.restoreDeviceBinding(backupPath, module, mapping);
          result.restoredDevices.push(mapping.deviceName);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.errors.push(`Failed to restore ${mapping.deviceName}: ${message}`);
        }
      }

      result.success = result.restoredDevices.length > 0;
      result.message =
        result.restoredDevices.length > 0
          ? `Restored ${result.restoredDevices.length} device(s)`
          : 'No devices were restored';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.message = `Restore failed: ${message}`;
    }

    return result;
  }

  /**
   * Create a backup before restore
   */
  private createPreRestoreBackup(module: string): string | null {
    if (!this.savedGamesPath) return null;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(
      process.env.USERPROFILE || os.homedir(),
      '.rigready',
      'dcs-backups',
      `pre-restore-${timestamp}`
    );

    try {
      const sourcePath = path.join(this.savedGamesPath, 'Config', 'Input', module);
      const destPath = path.join(backupDir, 'Config', 'Input', module);

      if (fs.existsSync(sourcePath)) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyDirectory(sourcePath, destPath);
        return backupDir;
      }
    } catch (error) {
      console.error('Failed to create pre-restore backup:', error);
    }

    return null;
  }

  /**
   * Copy a directory recursively
   */
  private copyDirectory(src: string, dest: string): void {
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Restore a single device's bindings
   */
  private restoreDeviceBinding(backupPath: string, module: string, mapping: DCSGuidMapping): void {
    if (!this.savedGamesPath) {
      throw new Error('DCS path not configured');
    }

    const backupFile = path.join(
      backupPath,
      'Config',
      'Input',
      module,
      'joystick',
      `${mapping.backupGuid}.diff.lua`
    );

    if (!fs.existsSync(backupFile)) {
      throw new Error(`Backup file not found: ${backupFile}`);
    }

    const destDir = path.join(this.savedGamesPath, 'Config', 'Input', module, 'joystick');
    fs.mkdirSync(destDir, { recursive: true });

    // If GUID is different, we need to rename the file
    const destFile = path.join(destDir, `${mapping.currentGuid}.diff.lua`);

    // Read and copy content (no GUID replacement needed in content for DCS)
    const content = fs.readFileSync(backupFile, 'utf-8');
    fs.writeFileSync(destFile, content);
  }

  /**
   * Get available backup paths from RigReady's backup storage
   */
  getAvailableBackups(): { name: string; path: string; timestamp: number }[] {
    const backupsDir = path.join(
      process.env.USERPROFILE || os.homedir(),
      '.rigready',
      'dcs-backups'
    );

    if (!fs.existsSync(backupsDir)) {
      return [];
    }

    const backups: { name: string; path: string; timestamp: number }[] = [];

    try {
      const entries = fs.readdirSync(backupsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const backupPath = path.join(backupsDir, entry.name);
          const stats = fs.statSync(backupPath);
          backups.push({
            name: entry.name,
            path: backupPath,
            timestamp: stats.mtimeMs,
          });
        }
      }

      // Sort by timestamp descending
      backups.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Failed to read backups:', error);
    }

    return backups;
  }

  /**
   * Create a manual backup of current bindings
   */
  createBackup(name: string): string | null {
    if (!this.savedGamesPath) return null;

    const backupsDir = path.join(
      process.env.USERPROFILE || os.homedir(),
      '.rigready',
      'dcs-backups'
    );

    const sanitizedName = name.replace(/[^a-zA-Z0-9-_]/g, '_');
    const timestamp = new Date().toISOString().split('T')[0];
    const backupDir = path.join(backupsDir, `${sanitizedName}-${timestamp}`);

    try {
      const sourcePath = path.join(this.savedGamesPath, 'Config', 'Input');
      const destPath = path.join(backupDir, 'Config', 'Input');

      if (fs.existsSync(sourcePath)) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyDirectory(sourcePath, destPath);
        return backupDir;
      }
    } catch (error) {
      console.error('Failed to create backup:', error);
    }

    return null;
  }

  /**
   * Delete a backup
   */
  deleteBackup(backupPath: string): boolean {
    try {
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { recursive: true });
        return true;
      }
    } catch (error) {
      console.error('Failed to delete backup:', error);
    }
    return false;
  }
}

export const dcsKeybindingService = new DCSKeybindingService();
