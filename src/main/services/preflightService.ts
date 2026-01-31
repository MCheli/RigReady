/**
 * Pre-Flight Checklist Service
 * Manages configurable pre-flight checks for sim sessions
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

export type PreflightCheckType = 'devices' | 'displays' | 'process';

export interface DeviceCheckConfig {
  deviceIds: string[]; // VID:PID format or device names
}

export interface DisplayCheckConfig {
  profileName: string; // Name of saved display profile to match
}

export interface ProcessCheckConfig {
  processName: string; // Process name (e.g., "TrackIR5.exe")
  displayName: string; // User-friendly name
}

export interface PreflightCheck {
  id: string;
  type: PreflightCheckType;
  name: string;
  enabled: boolean;
  config: DeviceCheckConfig | DisplayCheckConfig | ProcessCheckConfig;
}

export interface GameLaunchConfig {
  id: string;
  name: string;
  executablePath: string;
  arguments?: string;
  workingDirectory?: string;
}

export interface PreflightConfig {
  checks: PreflightCheck[];
  games: GameLaunchConfig[];
  autoRunOnStartup: boolean;
  lastUpdated: number;
}

export interface PreflightResult {
  checkId: string;
  checkName: string;
  passed: boolean;
  message: string;
  timestamp: number;
}

// =============================================================================
// Service
// =============================================================================

export class PreflightService {
  private configDir: string;
  private configPath: string;
  private config: PreflightConfig;

  constructor() {
    this.configDir = path.join(process.env.USERPROFILE || '', '.sim-manager');
    this.configPath = path.join(this.configDir, 'preflight-config.json');
    this.config = this.loadConfig();
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  private loadConfig(): PreflightConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load preflight config:', error);
    }

    // Return default config
    return {
      checks: [],
      games: [],
      autoRunOnStartup: false,
      lastUpdated: Date.now(),
    };
  }

  private saveConfig(): void {
    try {
      this.ensureConfigDir();
      this.config.lastUpdated = Date.now();
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save preflight config:', error);
    }
  }

  // =============================================================================
  // Check Management
  // =============================================================================

  getChecks(): PreflightCheck[] {
    return this.config.checks;
  }

  getCheck(id: string): PreflightCheck | undefined {
    return this.config.checks.find((c) => c.id === id);
  }

  addCheck(check: Omit<PreflightCheck, 'id'>): PreflightCheck {
    const newCheck: PreflightCheck = {
      ...check,
      id: this.generateId(),
    };
    this.config.checks.push(newCheck);
    this.saveConfig();
    return newCheck;
  }

  updateCheck(id: string, updates: Partial<PreflightCheck>): boolean {
    const index = this.config.checks.findIndex((c) => c.id === id);
    if (index === -1) return false;

    this.config.checks[index] = {
      ...this.config.checks[index],
      ...updates,
      id, // Prevent ID from being changed
    };
    this.saveConfig();
    return true;
  }

  deleteCheck(id: string): boolean {
    const index = this.config.checks.findIndex((c) => c.id === id);
    if (index === -1) return false;

    this.config.checks.splice(index, 1);
    this.saveConfig();
    return true;
  }

  toggleCheck(id: string): boolean {
    const check = this.getCheck(id);
    if (!check) return false;

    check.enabled = !check.enabled;
    this.saveConfig();
    return true;
  }

  // =============================================================================
  // Game Management
  // =============================================================================

  getGames(): GameLaunchConfig[] {
    return this.config.games;
  }

  addGame(game: Omit<GameLaunchConfig, 'id'>): GameLaunchConfig {
    const newGame: GameLaunchConfig = {
      ...game,
      id: this.generateId(),
    };
    this.config.games.push(newGame);
    this.saveConfig();
    return newGame;
  }

  updateGame(id: string, updates: Partial<GameLaunchConfig>): boolean {
    const index = this.config.games.findIndex((g) => g.id === id);
    if (index === -1) return false;

    this.config.games[index] = {
      ...this.config.games[index],
      ...updates,
      id,
    };
    this.saveConfig();
    return true;
  }

  deleteGame(id: string): boolean {
    const index = this.config.games.findIndex((g) => g.id === id);
    if (index === -1) return false;

    this.config.games.splice(index, 1);
    this.saveConfig();
    return true;
  }

  // =============================================================================
  // Config
  // =============================================================================

  getConfig(): PreflightConfig {
    return this.config;
  }

  setAutoRunOnStartup(enabled: boolean): void {
    this.config.autoRunOnStartup = enabled;
    this.saveConfig();
  }

  // =============================================================================
  // Helpers
  // =============================================================================

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
}
