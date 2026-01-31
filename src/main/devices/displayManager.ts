import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// Raw data structure from PowerShell display query
interface RawDisplayData {
  Name?: string;
  Width?: number;
  Height?: number;
  X?: number;
  Y?: number;
  IsPrimary?: boolean;
}

export interface DisplayInfo {
  name: string;
  devicePath: string;
  width: number;
  height: number;
  x: number;
  y: number;
  isPrimary: boolean;
  refreshRate: number;
  orientation: number;
  scaling: number;
}

export interface DisplayConfiguration {
  name: string;
  timestamp: number;
  displays: DisplayInfo[];
}

export class DisplayManager {
  private configPath: string;
  private savedConfigurations: DisplayConfiguration[] = [];

  constructor() {
    this.configPath = path.join(process.env.USERPROFILE || '', '.rigready', 'display-configs.json');
    this.loadConfigurations();
  }

  private loadConfigurations(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        this.savedConfigurations = JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load display configurations:', error);
      this.savedConfigurations = [];
    }
  }

  private saveConfigurations(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.savedConfigurations, null, 2));
    } catch (error) {
      console.error('Failed to save display configurations:', error);
    }
  }

  async getDisplays(): Promise<DisplayInfo[]> {
    try {
      // Use PowerShell script file to get display information
      const scriptPath = path.join(__dirname, 'get-displays.ps1');
      const { stdout } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
        { maxBuffer: 10 * 1024 * 1024 }
      );

      if (!stdout.trim()) {
        return [];
      }

      const rawDisplays = JSON.parse(stdout) as RawDisplayData | RawDisplayData[];
      const displays: DisplayInfo[] = (
        Array.isArray(rawDisplays) ? rawDisplays : [rawDisplays]
      ).map((d, index) => ({
        name: d.Name || `Display ${index + 1}`,
        devicePath: d.Name || '',
        width: d.Width || 0,
        height: d.Height || 0,
        x: d.X || 0,
        y: d.Y || 0,
        isPrimary: d.IsPrimary || false,
        refreshRate: 60, // Default, could be enhanced
        orientation: 0,
        scaling: 100,
      }));

      return displays;
    } catch (error) {
      console.error('Failed to get displays:', error);
      return [];
    }
  }

  async saveCurrentConfiguration(name: string): Promise<boolean> {
    try {
      const displays = await this.getDisplays();
      const config: DisplayConfiguration = {
        name,
        timestamp: Date.now(),
        displays,
      };

      // Replace existing config with same name, or add new
      const existingIndex = this.savedConfigurations.findIndex((c) => c.name === name);
      if (existingIndex >= 0) {
        this.savedConfigurations[existingIndex] = config;
      } else {
        this.savedConfigurations.push(config);
      }

      this.saveConfigurations();
      return true;
    } catch (error) {
      console.error('Failed to save display configuration:', error);
      return false;
    }
  }

  getSavedConfigurations(): DisplayConfiguration[] {
    return this.savedConfigurations;
  }

  deleteConfiguration(name: string): boolean {
    const index = this.savedConfigurations.findIndex((c) => c.name === name);
    if (index >= 0) {
      this.savedConfigurations.splice(index, 1);
      this.saveConfigurations();
      return true;
    }
    return false;
  }

  async applyConfiguration(name: string): Promise<boolean> {
    const config = this.savedConfigurations.find((c) => c.name === name);
    if (!config) {
      return false;
    }

    // Note: Actually changing display settings requires more complex Windows API calls
    // For now, we just verify the configuration matches
    const currentDisplays = await this.getDisplays();
    const matches = this.compareConfigurations(currentDisplays, config.displays);

    if (!matches) {
      console.log('Display configuration does not match saved configuration');
      // In the future, this could use DisplaySwitch.exe or SetRes to change settings
    }

    return matches;
  }

  private compareConfigurations(current: DisplayInfo[], saved: DisplayInfo[]): boolean {
    if (current.length !== saved.length) {
      return false;
    }

    for (const savedDisplay of saved) {
      const matching = current.find(
        (c) =>
          c.width === savedDisplay.width &&
          c.height === savedDisplay.height &&
          c.x === savedDisplay.x &&
          c.y === savedDisplay.y
      );
      if (!matching) {
        return false;
      }
    }

    return true;
  }

  async checkConfiguration(name: string): Promise<{ matches: boolean; differences: string[] }> {
    const config = this.savedConfigurations.find((c) => c.name === name);
    if (!config) {
      return { matches: false, differences: ['Configuration not found'] };
    }

    const currentDisplays = await this.getDisplays();
    const differences: string[] = [];

    if (currentDisplays.length !== config.displays.length) {
      differences.push(
        `Display count: ${currentDisplays.length} (expected ${config.displays.length})`
      );
    }

    for (const savedDisplay of config.displays) {
      const matching = currentDisplays.find((c) => c.name === savedDisplay.name);
      if (!matching) {
        differences.push(`Missing display: ${savedDisplay.name}`);
      } else {
        if (matching.width !== savedDisplay.width || matching.height !== savedDisplay.height) {
          differences.push(
            `${savedDisplay.name}: Resolution ${matching.width}x${matching.height} (expected ${savedDisplay.width}x${savedDisplay.height})`
          );
        }
        if (matching.x !== savedDisplay.x || matching.y !== savedDisplay.y) {
          differences.push(
            `${savedDisplay.name}: Position (${matching.x},${matching.y}) (expected (${savedDisplay.x},${savedDisplay.y}))`
          );
        }
      }
    }

    return {
      matches: differences.length === 0,
      differences,
    };
  }
}
