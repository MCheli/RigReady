import * as fs from 'fs';
import * as path from 'path';

export interface SimulatorProfile {
  name: string;
  simulator: string;
  path: string;
  lastModified: number;
  size: number;
}

export interface SimulatorInfo {
  name: string;
  installed: boolean;
  keybindingsPath: string;
  profiles: SimulatorProfile[];
}

export interface KeybindingBackup {
  name: string;
  timestamp: number;
  simulator: string;
  sourcePath: string;
  backupPath: string;
}

// Known simulator paths
const SIMULATOR_PATHS: Record<string, { name: string; paths: string[] }> = {
  dcs: {
    name: 'DCS World',
    paths: [
      path.join(process.env.USERPROFILE || '', 'Saved Games', 'DCS', 'Config', 'Input'),
      path.join(process.env.USERPROFILE || '', 'Saved Games', 'DCS.openbeta', 'Config', 'Input'),
    ],
  },
  msfs: {
    name: 'Microsoft Flight Simulator',
    paths: [
      path.join(process.env.APPDATA || '', 'Microsoft Flight Simulator'),
      path.join(
        process.env.LOCALAPPDATA || '',
        'Packages',
        'Microsoft.FlightSimulator_8wekyb3d8bbwe',
        'LocalState'
      ),
    ],
  },
  xplane: {
    name: 'X-Plane',
    paths: ['C:\\X-Plane 12\\Output\\preferences', 'C:\\X-Plane 11\\Output\\preferences'],
  },
  il2: {
    name: 'IL-2 Sturmovik',
    paths: [path.join(process.env.USERPROFILE || '', 'Documents', 'IL-2 Sturmovik Great Battles')],
  },
};

export class KeybindingManager {
  private backupDir: string;
  private backups: KeybindingBackup[] = [];
  private backupConfigPath: string;

  constructor() {
    this.backupDir = path.join(process.env.USERPROFILE || '', '.rigready', 'keybinding-backups');
    this.backupConfigPath = path.join(
      process.env.USERPROFILE || '',
      '.rigready',
      'keybinding-backups.json'
    );
    this.loadBackups();
  }

  private loadBackups(): void {
    try {
      if (fs.existsSync(this.backupConfigPath)) {
        const data = fs.readFileSync(this.backupConfigPath, 'utf-8');
        this.backups = JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load keybinding backups:', error);
      this.backups = [];
    }
  }

  private saveBackups(): void {
    try {
      const dir = path.dirname(this.backupConfigPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.backupConfigPath, JSON.stringify(this.backups, null, 2));
    } catch (error) {
      console.error('Failed to save keybinding backups:', error);
    }
  }

  async scanSimulators(): Promise<SimulatorInfo[]> {
    const results: SimulatorInfo[] = [];

    for (const [_key, config] of Object.entries(SIMULATOR_PATHS)) {
      let foundPath = '';
      let profiles: SimulatorProfile[] = [];

      for (const simPath of config.paths) {
        if (fs.existsSync(simPath)) {
          foundPath = simPath;
          profiles = await this.scanProfilesInPath(simPath, config.name);
          break;
        }
      }

      results.push({
        name: config.name,
        installed: !!foundPath,
        keybindingsPath: foundPath,
        profiles,
      });
    }

    return results;
  }

  private async scanProfilesInPath(
    basePath: string,
    simulator: string
  ): Promise<SimulatorProfile[]> {
    const profiles: SimulatorProfile[] = [];

    try {
      const entries = fs.readdirSync(basePath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(basePath, entry.name);

        if (entry.isDirectory()) {
          // For DCS, each aircraft/module has its own folder
          const subProfiles = await this.scanProfilesInPath(fullPath, simulator);
          profiles.push(...subProfiles);
        } else if (entry.isFile()) {
          // Check for keybinding files
          const ext = path.extname(entry.name).toLowerCase();
          if (
            ['.lua', '.diff.lua', '.json', '.xml', '.cfg'].includes(ext) ||
            ext.includes('.diff')
          ) {
            const stats = fs.statSync(fullPath);
            profiles.push({
              name: entry.name,
              simulator,
              path: fullPath,
              lastModified: stats.mtimeMs,
              size: stats.size,
            });
          }
        }
      }
    } catch (error) {
      console.error(`Failed to scan profiles in ${basePath}:`, error);
    }

    return profiles;
  }

  async createBackup(simulatorName: string, backupName: string): Promise<boolean> {
    try {
      const simulators = await this.scanSimulators();
      const simulator = simulators.find((s) => s.name === simulatorName);

      if (!simulator || !simulator.installed) {
        console.error('Simulator not found or not installed:', simulatorName);
        return false;
      }

      // Create backup directory
      const timestamp = Date.now();
      const safeName = backupName.replace(/[^a-z0-9]/gi, '_');
      const backupPath = path.join(this.backupDir, `${safeName}_${timestamp}`);

      if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true });
      }

      // Copy all profiles
      await this.copyDirectory(simulator.keybindingsPath, backupPath);

      // Record backup
      const backup: KeybindingBackup = {
        name: backupName,
        timestamp,
        simulator: simulatorName,
        sourcePath: simulator.keybindingsPath,
        backupPath,
      };

      this.backups.push(backup);
      this.saveBackups();

      console.log(`Created backup: ${backupName} for ${simulatorName}`);
      return true;
    } catch (error) {
      console.error('Failed to create backup:', error);
      return false;
    }
  }

  private async copyDirectory(src: string, dest: string): Promise<void> {
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        await this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  async restoreBackup(backupName: string): Promise<boolean> {
    try {
      const backup = this.backups.find((b) => b.name === backupName);

      if (!backup) {
        console.error('Backup not found:', backupName);
        return false;
      }

      if (!fs.existsSync(backup.backupPath)) {
        console.error('Backup files not found:', backup.backupPath);
        return false;
      }

      // Copy backup back to source
      await this.copyDirectory(backup.backupPath, backup.sourcePath);

      console.log(`Restored backup: ${backupName}`);
      return true;
    } catch (error) {
      console.error('Failed to restore backup:', error);
      return false;
    }
  }

  getBackups(): KeybindingBackup[] {
    return this.backups;
  }

  deleteBackup(backupName: string): boolean {
    const index = this.backups.findIndex((b) => b.name === backupName);

    if (index >= 0) {
      const backup = this.backups[index];

      // Delete backup files
      try {
        if (fs.existsSync(backup.backupPath)) {
          fs.rmSync(backup.backupPath, { recursive: true });
        }
      } catch (error) {
        console.error('Failed to delete backup files:', error);
      }

      this.backups.splice(index, 1);
      this.saveBackups();
      return true;
    }

    return false;
  }
}
