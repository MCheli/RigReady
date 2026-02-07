/**
 * Display Write Service
 * Applies display configurations via PowerShell script using ChangeDisplaySettingsEx.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { DisplayManager } from '../devices/displayManager';

const execAsync = promisify(exec);

class DisplayWriteService {
  private displayManager: DisplayManager | null = null;

  setDisplayManager(dm: DisplayManager): void {
    this.displayManager = dm;
  }

  /**
   * Apply a saved display configuration by name.
   */
  async applyConfiguration(
    configurationName: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.displayManager) {
      return { success: false, message: 'Display manager not initialized' };
    }

    const configs = this.displayManager.getSavedConfigurations();
    const config = configs.find((c) => c.name === configurationName);
    if (!config) {
      return {
        success: false,
        message: `Configuration "${configurationName}" not found`,
      };
    }

    try {
      const scriptPath = path.join(__dirname, 'set-displays.ps1');
      if (!fs.existsSync(scriptPath)) {
        return {
          success: false,
          message:
            'Display configuration script not found. Build may need to copy set-displays.ps1.',
        };
      }

      // Pass display layout as JSON argument
      const layoutJson = JSON.stringify(
        config.displays.map((d) => ({
          Name: d.name,
          Width: d.width,
          Height: d.height,
          X: d.x,
          Y: d.y,
          IsPrimary: d.isPrimary,
          Rotation: d.orientation || 0,
        }))
      );

      // Escape JSON for PowerShell
      const escapedJson = layoutJson.replace(/"/g, '\\"');

      const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Layout "${escapedJson}"`,
        { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
      );

      if (stderr && stderr.trim()) {
        console.error('Display write stderr:', stderr);
      }

      // Verify the result by re-reading display state
      const currentDisplays = await this.displayManager.getDisplays();
      const allMatch = config.displays.every((saved) =>
        currentDisplays.some(
          (current) =>
            current.width === saved.width &&
            current.height === saved.height &&
            Math.abs(current.x - saved.x) < 2 &&
            Math.abs(current.y - saved.y) < 2
        )
      );

      if (allMatch) {
        return { success: true, message: 'Display configuration applied successfully' };
      }

      return {
        success: false,
        message: `Display configuration partially applied. Script output: ${stdout.trim()}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to apply display configuration: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export const displayWriteService = new DisplayWriteService();
