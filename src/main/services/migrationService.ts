/**
 * Migration Service
 * Migrates existing JSON-based game profiles, preflight configs, and display configs
 * into the new unified Profile YAML format. Idempotent and non-destructive.
 */

import * as fs from 'fs';
import * as path from 'path';
import { profileService } from './profileService';
import { settingsService } from './settingsService';
import type { Profile, ChecklistItem, Remediation } from '../../shared/profileTypes';
import type { GameProfile, Simulator } from '../../shared/types';

const MIGRATION_VERSION = 1;
const CONFIG_DIR = path.join(process.env.USERPROFILE || '', '.rigready');

interface PreflightConfig {
  checks: PreflightCheckLegacy[];
}

interface PreflightCheckLegacy {
  id: string;
  type: 'devices' | 'displays' | 'process';
  name: string;
  enabled: boolean;
  config: {
    deviceIds?: string[];
    profileName?: string;
    processName?: string;
    displayName?: string;
  };
}

class MigrationService {
  /**
   * Run migration if it hasn't been done yet.
   */
  migrateIfNeeded(): void {
    const settings = settingsService.getSettings();
    const currentVersion = (settings as unknown as Record<string, unknown>)[
      'profileMigrationVersion'
    ] as number | undefined;

    if (currentVersion && currentVersion >= MIGRATION_VERSION) {
      console.log('Profile migration already completed');
      return;
    }

    console.log('Starting profile migration...');

    try {
      this.migrateGameProfiles();
      this.migratePreflightConfig();
      // Mark migration as completed
      settingsService.updateSettings({
        ...settings,
        ...({ profileMigrationVersion: MIGRATION_VERSION } as unknown as Record<string, unknown>),
      } as typeof settings);
      console.log('Profile migration completed successfully');
    } catch (error) {
      console.error('Profile migration failed:', error);
    }
  }

  private migrateGameProfiles(): void {
    const filePath = path.join(CONFIG_DIR, 'game-profiles.json');
    if (!fs.existsSync(filePath)) {
      console.log('No game-profiles.json found, skipping');
      return;
    }

    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const gameProfiles: GameProfile[] = JSON.parse(data);

      const existingProfiles = profileService.getAll();
      const existingNames = new Set(existingProfiles.map((p) => p.name));

      for (const gp of gameProfiles) {
        // Skip if a profile with the same name already exists
        if (existingNames.has(gp.name)) {
          console.log(`Skipping migration of "${gp.name}" (already exists)`);
          continue;
        }

        const checklistItems: ChecklistItem[] = [];

        // Convert pre-launch processes to checklist items
        for (const procName of gp.preLaunchProcesses) {
          checklistItems.push({
            id: `migrated-proc-${procName}`,
            type: 'process',
            name: procName.replace('.exe', ''),
            isRequired: false,
            category: 'software',
            config: {
              processName: procName,
            },
          });
        }

        // Convert auto-start processes to checklist items with remediations
        for (const autoStart of gp.autoStartProcesses) {
          const remediation: Remediation = {
            type: 'launchProcess',
            config: {
              executablePath: autoStart.executablePath,
              arguments: autoStart.arguments,
              waitAfterLaunch: autoStart.waitSeconds * 1000,
            },
          };

          checklistItems.push({
            id: `migrated-auto-${autoStart.name}`,
            type: 'process',
            name: autoStart.name,
            isRequired: false,
            category: 'software',
            config: {
              processName: path.basename(autoStart.executablePath),
              displayName: autoStart.name,
            },
            remediation,
          });
        }

        const game = this.guessSimulator(gp.executablePath, gp.name);

        const profile: Omit<Profile, 'id' | 'createdAt' | 'lastUsed'> = {
          name: gp.name,
          game,
          launchTarget: {
            executablePath: gp.executablePath,
            arguments: gp.arguments,
            workingDirectory: gp.workingDirectory,
            preScripts: [],
            postScripts: [],
          },
          checklistItems,
          trackedConfigurations: [],
        };

        profileService.create(profile);
        console.log(`Migrated game profile: ${gp.name}`);
      }
    } catch (error) {
      console.error('Failed to migrate game profiles:', error);
    }
  }

  private migratePreflightConfig(): void {
    const filePath = path.join(CONFIG_DIR, 'preflight-config.json');
    if (!fs.existsSync(filePath)) {
      console.log('No preflight-config.json found, skipping');
      return;
    }

    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const config: PreflightConfig = JSON.parse(data);

      if (!config.checks || config.checks.length === 0) return;

      // If we have preflight checks but no profile to attach them to,
      // create a "Migrated Pre-Flight" profile
      const existingProfiles = profileService.getAll();
      if (existingProfiles.length === 0) {
        const checklistItems: ChecklistItem[] = config.checks
          .filter((c) => c.enabled)
          .map((c) => this.convertPreflightCheck(c));

        if (checklistItems.length > 0) {
          profileService.create({
            name: 'Migrated Pre-Flight Checks',
            game: 'other',
            checklistItems,
            trackedConfigurations: [],
          });
          console.log('Created migration profile for pre-flight checks');
        }
      } else {
        // Attach pre-flight checks to the first existing profile
        const firstProfile = existingProfiles[0];
        const checklistItems = config.checks
          .filter((c) => c.enabled)
          .map((c) => this.convertPreflightCheck(c));

        firstProfile.checklistItems.push(...checklistItems);
        profileService.save(firstProfile);
        console.log(
          `Attached ${checklistItems.length} pre-flight checks to "${firstProfile.name}"`
        );
      }
    } catch (error) {
      console.error('Failed to migrate preflight config:', error);
    }
  }

  private convertPreflightCheck(check: PreflightCheckLegacy): ChecklistItem {
    switch (check.type) {
      case 'process':
        return {
          id: `migrated-${check.id}`,
          type: 'process',
          name: check.name,
          isRequired: true,
          category: 'software',
          config: {
            processName: check.config.processName || '',
            displayName: check.config.displayName,
          },
        };
      case 'devices':
        return {
          id: `migrated-${check.id}`,
          type: 'device',
          name: check.name,
          isRequired: true,
          category: 'hardware',
          config: {
            deviceName: check.name,
          },
        };
      case 'displays':
        return {
          id: `migrated-${check.id}`,
          type: 'display',
          name: check.name,
          isRequired: false,
          category: 'display',
          config: {
            configurationName: check.config.profileName || '',
          },
        };
    }
  }

  private guessSimulator(executablePath: string, name: string): Simulator {
    const lower = (executablePath + name).toLowerCase();
    if (lower.includes('dcs')) return 'dcs';
    if (lower.includes('flightsimulator') || lower.includes('msfs')) return 'msfs';
    if (lower.includes('x-plane') || lower.includes('xplane')) return 'xplane';
    if (lower.includes('il-2') || lower.includes('il2')) return 'il2';
    if (lower.includes('iracing')) return 'iracing';
    if (lower.includes('assetto') || lower.includes('acc')) return 'acc';
    if (lower.includes('beamng')) return 'beamng';
    if (lower.includes('le mans') || lower.includes('lmu')) return 'lmu';
    return 'other';
  }
}

export const migrationService = new MigrationService();
