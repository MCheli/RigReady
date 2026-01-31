/**
 * Game launch service for managing game/simulator launches
 * Supports launching games with optional pre-launch checks and software startup
 */

import * as fs from 'fs';
import * as path from 'path';
import { processService } from './processService';

export interface GameProfile {
  id: string;
  name: string;
  executablePath: string;
  arguments: string[];
  workingDirectory?: string;
  icon?: string;
  // Pre-launch configuration
  preLaunchProcesses: string[]; // Process names that should be running
  autoStartProcesses: AutoStartProcess[]; // Processes to auto-start before game
}

export interface AutoStartProcess {
  name: string;
  executablePath: string;
  arguments: string[];
  waitSeconds: number; // Wait time after starting before next process
}

export interface LaunchResult {
  success: boolean;
  message: string;
  missingProcesses?: string[];
  startedProcesses?: string[];
}

// Common game paths (Steam, standalone, etc.)
const COMMON_GAME_PATHS: Record<string, string[]> = {
  'DCS World': [
    'C:\\Program Files\\Eagle Dynamics\\DCS World\\bin\\DCS.exe',
    'C:\\Program Files\\Eagle Dynamics\\DCS World OpenBeta\\bin\\DCS.exe',
    'D:\\Games\\DCS World\\bin\\DCS.exe',
  ],
  'Microsoft Flight Simulator': [
    'C:\\Program Files\\WindowsApps\\Microsoft.FlightSimulator_*\\FlightSimulator.exe',
  ],
  'X-Plane 12': ['C:\\X-Plane 12\\X-Plane.exe', 'D:\\X-Plane 12\\X-Plane.exe'],
  iRacing: ['C:\\Program Files (x86)\\iRacing\\iRacingUI.exe'],
  'Assetto Corsa Competizione': [
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Assetto Corsa Competizione\\AC2\\Binaries\\Win64\\AC2-Win64-Shipping.exe',
  ],
  'IL-2 Sturmovik': ['C:\\Program Files\\IL-2 Sturmovik Great Battles\\bin\\game\\Il-2.exe'],
};

export class GameLaunchService {
  private configPath: string;
  private profiles: GameProfile[] = [];

  constructor() {
    this.configPath = path.join(
      process.env.USERPROFILE || '',
      '.sim-manager',
      'game-profiles.json'
    );
    this.loadProfiles();
  }

  private loadProfiles(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        this.profiles = JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load game profiles:', error);
      this.profiles = [];
    }
  }

  private saveProfiles(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.profiles, null, 2));
    } catch (error) {
      console.error('Failed to save game profiles:', error);
    }
  }

  /**
   * Get all game profiles
   */
  getProfiles(): GameProfile[] {
    return this.profiles;
  }

  /**
   * Get a specific profile by ID
   */
  getProfile(id: string): GameProfile | undefined {
    return this.profiles.find((p) => p.id === id);
  }

  /**
   * Add or update a game profile
   */
  saveProfile(profile: GameProfile): void {
    const index = this.profiles.findIndex((p) => p.id === profile.id);
    if (index >= 0) {
      this.profiles[index] = profile;
    } else {
      this.profiles.push(profile);
    }
    this.saveProfiles();
  }

  /**
   * Delete a game profile
   */
  deleteProfile(id: string): boolean {
    const index = this.profiles.findIndex((p) => p.id === id);
    if (index >= 0) {
      this.profiles.splice(index, 1);
      this.saveProfiles();
      return true;
    }
    return false;
  }

  /**
   * Detect installed games by checking common paths
   */
  async detectGames(): Promise<Array<{ name: string; path: string }>> {
    const detected: Array<{ name: string; path: string }> = [];

    for (const [gameName, paths] of Object.entries(COMMON_GAME_PATHS)) {
      for (const gamePath of paths) {
        // Handle wildcards for Windows Store apps
        if (gamePath.includes('*')) {
          // Skip wildcards for now - would need glob
          continue;
        }
        if (fs.existsSync(gamePath)) {
          detected.push({ name: gameName, path: gamePath });
          break; // Found this game, move to next
        }
      }
    }

    return detected;
  }

  /**
   * Launch a game with pre-flight checks
   */
  async launchGame(profileId: string): Promise<LaunchResult> {
    const profile = this.getProfile(profileId);
    if (!profile) {
      return { success: false, message: `Profile not found: ${profileId}` };
    }

    // Check if executable exists
    if (!fs.existsSync(profile.executablePath)) {
      return {
        success: false,
        message: `Game executable not found: ${profile.executablePath}`,
      };
    }

    // Check pre-launch processes
    const missingProcesses: string[] = [];
    if (profile.preLaunchProcesses.length > 0) {
      const results = await processService.checkProcesses(profile.preLaunchProcesses);
      for (const result of results) {
        if (!result.running) {
          missingProcesses.push(result.displayName);
        }
      }
    }

    // Start auto-start processes
    const startedProcesses: string[] = [];
    for (const autoStart of profile.autoStartProcesses) {
      const isRunning = await processService.isProcessRunning(
        path.basename(autoStart.executablePath)
      );

      if (!isRunning.running) {
        const started = await processService.launchProcess(
          autoStart.executablePath,
          autoStart.arguments
        );
        if (started) {
          startedProcesses.push(autoStart.name);
          // Wait before starting next process
          if (autoStart.waitSeconds > 0) {
            await new Promise((resolve) => setTimeout(resolve, autoStart.waitSeconds * 1000));
          }
        }
      }
    }

    // Launch the game
    const launched = await processService.launchProcess(profile.executablePath, profile.arguments);

    if (launched) {
      return {
        success: true,
        message: `Launched ${profile.name}`,
        missingProcesses: missingProcesses.length > 0 ? missingProcesses : undefined,
        startedProcesses: startedProcesses.length > 0 ? startedProcesses : undefined,
      };
    } else {
      return {
        success: false,
        message: `Failed to launch ${profile.name}`,
      };
    }
  }

  /**
   * Quick launch a game by path (without profile)
   */
  async quickLaunch(executablePath: string, args: string[] = []): Promise<LaunchResult> {
    if (!fs.existsSync(executablePath)) {
      return {
        success: false,
        message: `Executable not found: ${executablePath}`,
      };
    }

    const launched = await processService.launchProcess(executablePath, args);
    return {
      success: launched,
      message: launched
        ? `Launched ${path.basename(executablePath)}`
        : `Failed to launch ${path.basename(executablePath)}`,
    };
  }
}

// Singleton instance
export const gameLaunchService = new GameLaunchService();
