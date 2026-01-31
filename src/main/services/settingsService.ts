/**
 * Settings Service
 * Handles persistent application settings including simulator paths
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Simulator } from '../../shared/types';

// =============================================================================
// Types
// =============================================================================

export interface SimulatorPath {
  simulator: Simulator;
  installPath?: string; // Game installation directory
  configPath?: string; // Config/keybindings directory
  isAutoDetected: boolean;
  lastVerified?: number;
}

export interface AppSettings {
  version: number;
  simulatorPaths: SimulatorPath[];
  autoScanOnStartup: boolean;
  theme: 'dark' | 'light';
  minimizeToTray: boolean;
  startWithWindows: boolean;
  checkForUpdates: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  simulatorPaths: [],
  autoScanOnStartup: true,
  theme: 'dark',
  minimizeToTray: false,
  startWithWindows: false,
  checkForUpdates: false,
};

// =============================================================================
// Common Paths for Simulators
// =============================================================================

interface SimulatorPathConfig {
  name: string;
  possibleInstallPaths: string[];
  configPathFromInstall?: (installPath: string) => string;
  standaloneConfigPath?: string;
  executableName?: string;
}

export const SIMULATOR_PATH_CONFIG: Record<Simulator, SimulatorPathConfig | null> = {
  dcs: {
    name: 'DCS World',
    possibleInstallPaths: [
      'C:\\Program Files\\Eagle Dynamics\\DCS World',
      'C:\\Program Files\\Eagle Dynamics\\DCS World OpenBeta',
      'D:\\DCS World',
      'D:\\DCS World OpenBeta',
      'E:\\DCS World',
      'D:\\Games\\DCS World',
      'E:\\Games\\DCS World',
    ],
    standaloneConfigPath: path.join(os.homedir(), 'Saved Games', 'DCS', 'Config', 'Input'),
    executableName: 'DCS.exe',
  },
  msfs: {
    name: 'Microsoft Flight Simulator',
    possibleInstallPaths: [
      path.join(
        os.homedir(),
        'AppData',
        'Local',
        'Packages',
        'Microsoft.FlightSimulator_8wekyb3d8bbwe'
      ),
      path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft Flight Simulator'),
      'C:\\Program Files\\WindowsApps\\Microsoft.FlightSimulator_*',
      'C:\\XboxGames\\Microsoft Flight Simulator',
      'D:\\XboxGames\\Microsoft Flight Simulator',
    ],
    configPathFromInstall: (installPath: string) => {
      if (installPath.includes('Packages')) {
        return path.join(installPath, 'LocalState', 'inputprofile');
      }
      return path.join(installPath, 'inputprofile');
    },
    executableName: 'FlightSimulator.exe',
  },
  xplane: {
    name: 'X-Plane',
    possibleInstallPaths: [
      'C:\\X-Plane 12',
      'D:\\X-Plane 12',
      'E:\\X-Plane 12',
      'C:\\X-Plane 11',
      'D:\\X-Plane 11',
      path.join(os.homedir(), 'Desktop', 'X-Plane 12'),
      path.join(os.homedir(), 'Desktop', 'X-Plane 11'),
      'C:\\Games\\X-Plane 12',
      'D:\\Games\\X-Plane 12',
    ],
    configPathFromInstall: (installPath: string) =>
      path.join(installPath, 'Resources', 'joystick configs'),
    executableName: 'X-Plane.exe',
  },
  il2: {
    name: 'IL-2 Sturmovik',
    possibleInstallPaths: [
      'C:\\Program Files\\1C Game Studios\\IL-2 Sturmovik Great Battles',
      'D:\\IL-2 Sturmovik Great Battles',
      'C:\\Games\\IL-2 Sturmovik Great Battles',
      'D:\\Games\\IL-2 Sturmovik Great Battles',
      'E:\\IL-2 Sturmovik Great Battles',
    ],
    configPathFromInstall: (installPath: string) => path.join(installPath, 'data', 'input'),
    executableName: 'IL-2.exe',
  },
  iracing: {
    name: 'iRacing',
    possibleInstallPaths: [
      'C:\\Program Files (x86)\\iRacing',
      'D:\\iRacing',
      path.join(os.homedir(), 'Documents', 'iRacing'),
    ],
    standaloneConfigPath: path.join(os.homedir(), 'Documents', 'iRacing'),
    executableName: 'iRacingSim64DX11.exe',
  },
  acc: {
    name: 'Assetto Corsa Competizione',
    possibleInstallPaths: [
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Assetto Corsa Competizione',
      'D:\\SteamLibrary\\steamapps\\common\\Assetto Corsa Competizione',
      'E:\\SteamLibrary\\steamapps\\common\\Assetto Corsa Competizione',
    ],
    standaloneConfigPath: path.join(
      os.homedir(),
      'Documents',
      'Assetto Corsa Competizione',
      'Config'
    ),
    executableName: 'AC2-Win64-Shipping.exe',
  },
  other: null,
};

// =============================================================================
// Settings Service
// =============================================================================

class SettingsService {
  private settingsPath: string;
  private settings: AppSettings;

  constructor() {
    const configDir = path.join(os.homedir(), '.sim-manager');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    this.settingsPath = path.join(configDir, 'settings.json');
    this.settings = this.loadSettings();
  }

  private loadSettings(): AppSettings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf-8');
        const saved = JSON.parse(data);
        return { ...DEFAULT_SETTINGS, ...saved };
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
    return { ...DEFAULT_SETTINGS };
  }

  private saveSettings(): void {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  updateSettings(updates: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.saveSettings();
  }

  // ==========================================================================
  // Simulator Path Management
  // ==========================================================================

  getSimulatorPath(simulator: Simulator): SimulatorPath | undefined {
    return this.settings.simulatorPaths.find((p) => p.simulator === simulator);
  }

  setSimulatorPath(simulatorPath: SimulatorPath): void {
    const existing = this.settings.simulatorPaths.findIndex(
      (p) => p.simulator === simulatorPath.simulator
    );
    if (existing >= 0) {
      this.settings.simulatorPaths[existing] = simulatorPath;
    } else {
      this.settings.simulatorPaths.push(simulatorPath);
    }
    this.saveSettings();
  }

  removeSimulatorPath(simulator: Simulator): void {
    this.settings.simulatorPaths = this.settings.simulatorPaths.filter(
      (p) => p.simulator !== simulator
    );
    this.saveSettings();
  }

  // ==========================================================================
  // Auto-Scan Functionality
  // ==========================================================================

  autoScanSimulator(simulator: Simulator): SimulatorPath | null {
    const config = SIMULATOR_PATH_CONFIG[simulator];
    if (!config) return null;

    let foundInstallPath: string | undefined;
    let foundConfigPath: string | undefined;

    // Search for install path
    for (const searchPath of config.possibleInstallPaths) {
      // Handle wildcard paths (e.g., for Windows Store apps)
      if (searchPath.includes('*')) {
        const dir = path.dirname(searchPath);
        const pattern = path.basename(searchPath).replace('*', '');
        if (fs.existsSync(dir)) {
          try {
            const entries = fs.readdirSync(dir);
            const match = entries.find((e) => e.startsWith(pattern));
            if (match) {
              const fullPath = path.join(dir, match);
              if (this.verifySimulatorInstall(fullPath, config.executableName)) {
                foundInstallPath = fullPath;
                break;
              }
            }
          } catch {
            // Ignore permission errors
          }
        }
      } else if (fs.existsSync(searchPath)) {
        if (this.verifySimulatorInstall(searchPath, config.executableName)) {
          foundInstallPath = searchPath;
          break;
        }
      }
    }

    // Determine config path
    if (foundInstallPath && config.configPathFromInstall) {
      const configPath = config.configPathFromInstall(foundInstallPath);
      if (fs.existsSync(configPath)) {
        foundConfigPath = configPath;
      }
    }

    // Check standalone config path (e.g., DCS saves configs in Saved Games)
    if (!foundConfigPath && config.standaloneConfigPath) {
      if (fs.existsSync(config.standaloneConfigPath)) {
        foundConfigPath = config.standaloneConfigPath;
      }
    }

    // If we found either path, create and save the result
    if (foundInstallPath || foundConfigPath) {
      const result: SimulatorPath = {
        simulator,
        installPath: foundInstallPath,
        configPath: foundConfigPath,
        isAutoDetected: true,
        lastVerified: Date.now(),
      };
      this.setSimulatorPath(result);
      return result;
    }

    return null;
  }

  autoScanAllSimulators(): SimulatorPath[] {
    const results: SimulatorPath[] = [];
    const simulators: Simulator[] = ['dcs', 'msfs', 'xplane', 'il2', 'iracing', 'acc'];

    for (const sim of simulators) {
      const result = this.autoScanSimulator(sim);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  private verifySimulatorInstall(installPath: string, executableName?: string): boolean {
    if (!fs.existsSync(installPath)) return false;

    // If we have an executable name, check for it
    if (executableName) {
      const exePath = path.join(installPath, executableName);
      if (fs.existsSync(exePath)) return true;

      // Also check in bin directory for some games
      const binExePath = path.join(installPath, 'bin', executableName);
      if (fs.existsSync(binExePath)) return true;

      // X-Plane has different structure
      if (executableName === 'X-Plane.exe') {
        // X-Plane 12 might be X-Plane 12.exe
        const v12ExePath = path.join(installPath, 'X-Plane 12.exe');
        if (fs.existsSync(v12ExePath)) return true;
      }
    }

    // Fallback: check if directory exists and contains reasonable content
    try {
      const contents = fs.readdirSync(installPath);
      // Most games have multiple files/folders
      return contents.length > 5;
    } catch {
      return false;
    }
  }

  verifySimulatorPath(simulator: Simulator): boolean {
    const simPath = this.getSimulatorPath(simulator);
    if (!simPath) return false;

    const isValid =
      (simPath.installPath && fs.existsSync(simPath.installPath)) ||
      (simPath.configPath && fs.existsSync(simPath.configPath));

    if (isValid) {
      // Update last verified timestamp
      simPath.lastVerified = Date.now();
      this.setSimulatorPath(simPath);
    }

    return isValid;
  }
}

export const settingsService = new SettingsService();
