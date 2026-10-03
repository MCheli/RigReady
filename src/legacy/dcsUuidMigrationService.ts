/**
 * DCS UUID Migration Service
 * Handles renaming .diff.lua files when a device's UUID changes
 * (e.g., after USB port change or driver update).
 */

import * as fs from 'fs';
import * as path from 'path';
import { dcsKeybindingService } from './dcsKeybindingService';

export interface UuidMigrationResult {
  success: boolean;
  migratedFiles: string[];
  skippedFiles: string[];
  errors: string[];
}

export interface UuidMigrationPreview {
  oldUuid: string;
  newUuid: string;
  affectedModules: string[];
  fileCount: number;
  files: { module: string; oldPath: string; newPath: string }[];
}

class DcsUuidMigrationService {
  /**
   * Preview what files would be affected by a UUID migration.
   */
  previewMigration(oldUuid: string, newUuid: string): UuidMigrationPreview {
    const preview: UuidMigrationPreview = {
      oldUuid,
      newUuid,
      affectedModules: [],
      fileCount: 0,
      files: [],
    };

    const savedGamesPath = dcsKeybindingService.getSavedGamesPath();
    if (!savedGamesPath) return preview;

    const inputPath = path.join(savedGamesPath, 'Config', 'Input');
    if (!fs.existsSync(inputPath)) return preview;

    try {
      const modules = fs.readdirSync(inputPath, { withFileTypes: true });

      for (const moduleEntry of modules) {
        if (!moduleEntry.isDirectory()) continue;

        const joystickPath = path.join(inputPath, moduleEntry.name, 'joystick');
        if (!fs.existsSync(joystickPath)) continue;

        const oldFile = path.join(joystickPath, `${oldUuid}.diff.lua`);
        if (fs.existsSync(oldFile)) {
          const newFile = path.join(joystickPath, `${newUuid}.diff.lua`);
          preview.affectedModules.push(moduleEntry.name);
          preview.files.push({
            module: moduleEntry.name,
            oldPath: oldFile,
            newPath: newFile,
          });
          preview.fileCount++;
        }
      }
    } catch (error) {
      console.error('Failed to preview UUID migration:', error);
    }

    return preview;
  }

  /**
   * Execute UUID migration: rename all .diff.lua files from oldUuid to newUuid.
   */
  migrate(oldUuid: string, newUuid: string, createBackup = true): UuidMigrationResult {
    const result: UuidMigrationResult = {
      success: false,
      migratedFiles: [],
      skippedFiles: [],
      errors: [],
    };

    if (!oldUuid || !newUuid) {
      result.errors.push('Both old and new UUIDs must be provided');
      return result;
    }

    if (oldUuid === newUuid) {
      result.errors.push('Old and new UUIDs are identical');
      return result;
    }

    // Create a backup first
    if (createBackup) {
      const backupName = `pre-uuid-migration-${Date.now().toString(36)}`;
      const backupPath = dcsKeybindingService.createBackup(backupName);
      if (!backupPath) {
        result.errors.push('Failed to create pre-migration backup');
        return result;
      }
    }

    const preview = this.previewMigration(oldUuid, newUuid);

    for (const file of preview.files) {
      try {
        if (fs.existsSync(file.newPath)) {
          result.skippedFiles.push(
            `${file.module}: target file already exists (${path.basename(file.newPath)})`
          );
          continue;
        }

        fs.renameSync(file.oldPath, file.newPath);
        result.migratedFiles.push(
          `${file.module}: ${path.basename(file.oldPath)} -> ${path.basename(file.newPath)}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`${file.module}: ${message}`);
      }
    }

    result.success = result.migratedFiles.length > 0 && result.errors.length === 0;
    return result;
  }

  /**
   * List all unique device UUIDs found across all modules.
   */
  listDeviceUuids(): { uuid: string; moduleCount: number; modules: string[] }[] {
    const uuidMap = new Map<string, string[]>();

    const savedGamesPath = dcsKeybindingService.getSavedGamesPath();
    if (!savedGamesPath) return [];

    const inputPath = path.join(savedGamesPath, 'Config', 'Input');
    if (!fs.existsSync(inputPath)) return [];

    try {
      const modules = fs.readdirSync(inputPath, { withFileTypes: true });

      for (const moduleEntry of modules) {
        if (!moduleEntry.isDirectory()) continue;

        const joystickPath = path.join(inputPath, moduleEntry.name, 'joystick');
        if (!fs.existsSync(joystickPath)) continue;

        const files = fs.readdirSync(joystickPath).filter((f) => f.endsWith('.diff.lua'));
        for (const file of files) {
          const uuid = file.replace('.diff.lua', '');
          const existing = uuidMap.get(uuid) || [];
          existing.push(moduleEntry.name);
          uuidMap.set(uuid, existing);
        }
      }
    } catch (error) {
      console.error('Failed to list device UUIDs:', error);
    }

    return Array.from(uuidMap.entries())
      .map(([uuid, modules]) => ({
        uuid,
        moduleCount: modules.length,
        modules,
      }))
      .sort((a, b) => b.moduleCount - a.moduleCount);
  }
}

export const dcsUuidMigrationService = new DcsUuidMigrationService();
