/**
 * Checklist Service
 * Orchestrates running all checks for a profile and executing remediations.
 */

import * as fs from 'fs';
import { processService } from './processService';
import type { HIDManager } from '../devices/hidManager';
import type { DisplayManager } from '../devices/displayManager';
import type {
  Profile,
  ChecklistItem,
  CheckResult,
  ChecklistResult,
  CheckStatus,
  Remediation,
} from '../../shared/profileTypes';

class ChecklistService {
  private hidManager: HIDManager | null = null;
  private displayManager: DisplayManager | null = null;

  setHidManager(hm: HIDManager): void {
    this.hidManager = hm;
  }

  setDisplayManager(dm: DisplayManager): void {
    this.displayManager = dm;
  }
  /**
   * Run all checks for a profile.
   */
  async runChecklist(profile: Profile): Promise<ChecklistResult> {
    const results: CheckResult[] = [];
    let overallStatus: CheckStatus = 'pass';
    let allRequiredPassed = true;

    for (const item of profile.checklistItems) {
      const result = await this.runSingleCheck(item);
      results.push(result);

      if (result.status === 'fail') {
        overallStatus = 'fail';
        if (item.isRequired) {
          allRequiredPassed = false;
        }
      } else if (result.status === 'warn' && overallStatus === 'pass') {
        overallStatus = 'warn';
      }
    }

    return {
      profileId: profile.id,
      profileName: profile.name,
      overallStatus,
      results,
      allRequiredPassed,
      timestamp: Date.now(),
    };
  }

  /**
   * Run a single checklist item check.
   */
  async runSingleCheck(item: ChecklistItem): Promise<CheckResult> {
    const base = {
      checklistItemId: item.id,
      checklistItemName: item.name,
      timestamp: Date.now(),
    };

    try {
      switch (item.type) {
        case 'process':
          return await this.checkProcess(item, base);
        case 'device':
          return this.checkDevice(item, base);
        case 'display':
          return await this.checkDisplay(item, base);
        case 'config':
          return this.checkConfig(item, base);
        case 'script':
          return await this.checkScript(item, base);
        default:
          return {
            ...base,
            status: 'skip',
            message: 'Unknown check type',
            canRemediate: false,
          };
      }
    } catch (error) {
      return {
        ...base,
        status: 'fail',
        message: `Check error: ${error instanceof Error ? error.message : String(error)}`,
        canRemediate: false,
      };
    }
  }

  private async checkProcess(
    item: Extract<ChecklistItem, { type: 'process' }>,
    base: Omit<CheckResult, 'status' | 'message' | 'canRemediate'>
  ): Promise<CheckResult> {
    const result = await processService.isProcessRunning(item.config.processName);
    const displayName = item.config.displayName || item.config.processName;

    if (result.running) {
      return {
        ...base,
        status: 'pass',
        message: `${displayName} is running (PID: ${result.pid})`,
        canRemediate: false,
      };
    }

    return {
      ...base,
      status: 'fail',
      message: `${displayName} is not running`,
      canRemediate: item.remediation?.type === 'launchProcess',
    };
  }

  private checkDevice(
    item: Extract<ChecklistItem, { type: 'device' }>,
    base: Omit<CheckResult, 'status' | 'message' | 'canRemediate'>
  ): CheckResult {
    const deviceName = item.config.deviceName || 'Unknown';

    if (!this.hidManager) {
      return {
        ...base,
        status: 'warn',
        message: `Device check for "${deviceName}" - HID manager not available`,
        canRemediate: false,
      };
    }

    const allDevices = this.hidManager.getAllDevices();
    const match = allDevices.find((d) => {
      if (item.config.vendorId && item.config.productId) {
        return d.vendorId === item.config.vendorId && d.productId === item.config.productId;
      }
      if (item.config.vendorId) {
        return d.vendorId === item.config.vendorId;
      }
      if (item.config.deviceName) {
        return d.product.toLowerCase().includes(item.config.deviceName.toLowerCase());
      }
      return false;
    });

    if (match) {
      return {
        ...base,
        status: 'pass',
        message: `${deviceName} is connected (${match.manufacturer} ${match.product})`,
        canRemediate: false,
      };
    }

    return {
      ...base,
      status: 'fail',
      message: `${deviceName} is not connected`,
      canRemediate: false,
    };
  }

  private async checkDisplay(
    item: Extract<ChecklistItem, { type: 'display' }>,
    base: Omit<CheckResult, 'status' | 'message' | 'canRemediate'>
  ): Promise<CheckResult> {
    if (!this.displayManager) {
      return {
        ...base,
        status: 'warn',
        message: `Display configuration "${item.config.configurationName}" - display manager not available`,
        canRemediate: false,
      };
    }

    const result = await this.displayManager.checkConfiguration(item.config.configurationName);

    if (result.matches) {
      return {
        ...base,
        status: 'pass',
        message: `Display configuration "${item.config.configurationName}" matches`,
        canRemediate: false,
      };
    }

    return {
      ...base,
      status: 'fail',
      message: `Display mismatch: ${result.differences.join('; ')}`,
      canRemediate: item.remediation?.type === 'autoFixDisplay',
    };
  }

  private checkConfig(
    item: Extract<ChecklistItem, { type: 'config' }>,
    base: Omit<CheckResult, 'status' | 'message' | 'canRemediate'>
  ): CheckResult {
    const exists = fs.existsSync(item.config.filePath);

    if (!exists) {
      return {
        ...base,
        status: 'fail',
        message: `Config file not found: ${item.config.filePath}`,
        canRemediate: item.remediation?.type === 'restoreConfig',
      };
    }

    if (item.config.contentRegex) {
      try {
        const content = fs.readFileSync(item.config.filePath, 'utf-8');
        const regex = new RegExp(item.config.contentRegex);
        if (!regex.test(content)) {
          return {
            ...base,
            status: 'fail',
            message: `Config file does not match expected pattern`,
            canRemediate: item.remediation?.type === 'restoreConfig',
          };
        }
      } catch (err) {
        return {
          ...base,
          status: 'warn',
          message: `Could not verify config content: ${err instanceof Error ? err.message : String(err)}`,
          canRemediate: false,
        };
      }
    }

    return {
      ...base,
      status: 'pass',
      message: `Config file exists: ${item.config.filePath}`,
      canRemediate: false,
    };
  }

  private async checkScript(
    item: Extract<ChecklistItem, { type: 'script' }>,
    base: Omit<CheckResult, 'status' | 'message' | 'canRemediate'>
  ): Promise<CheckResult> {
    // Script checks delegate to scriptService which will be wired in Step 9
    // For now, check that the script file exists
    if (!fs.existsSync(item.config.scriptPath)) {
      return {
        ...base,
        status: 'fail',
        message: `Script not found: ${item.config.scriptPath}`,
        canRemediate: false,
      };
    }

    return {
      ...base,
      status: 'warn',
      message: `Script exists but execution requires ScriptService`,
      canRemediate: false,
    };
  }

  // =========================================================================
  // Remediation
  // =========================================================================

  async executeRemediation(
    remediation: Remediation
  ): Promise<{ success: boolean; message: string }> {
    try {
      switch (remediation.type) {
        case 'launchProcess':
          return await this.remediateLaunchProcess(remediation);
        case 'autoFixDisplay':
          return this.remediateAutoFixDisplay(remediation);
        case 'restoreConfig':
          return this.remediateRestoreConfig(remediation);
        case 'notifyUser':
          return {
            success: true,
            message: remediation.config.message,
          };
        case 'script':
          return {
            success: false,
            message: 'Script remediation requires ScriptService',
          };
        default:
          return { success: false, message: 'Unknown remediation type' };
      }
    } catch (error) {
      return {
        success: false,
        message: `Remediation error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async remediateLaunchProcess(
    remediation: Extract<Remediation, { type: 'launchProcess' }>
  ): Promise<{ success: boolean; message: string }> {
    const launched = await processService.launchProcess(
      remediation.config.executablePath,
      remediation.config.arguments || []
    );

    if (!launched) {
      return {
        success: false,
        message: `Failed to launch ${remediation.config.executablePath}`,
      };
    }

    if (remediation.config.waitAfterLaunch) {
      await new Promise((resolve) => setTimeout(resolve, remediation.config.waitAfterLaunch));
    }

    return {
      success: true,
      message: `Launched ${remediation.config.executablePath}`,
    };
  }

  private remediateAutoFixDisplay(remediation: Extract<Remediation, { type: 'autoFixDisplay' }>): {
    success: boolean;
    message: string;
  } {
    // Will be wired to displayWriteService in Step 10
    return {
      success: false,
      message: `Display auto-fix for "${remediation.config.configurationName}" requires DisplayWriteService`,
    };
  }

  private remediateRestoreConfig(remediation: Extract<Remediation, { type: 'restoreConfig' }>): {
    success: boolean;
    message: string;
  } {
    const { sourcePath, targetPath } = remediation.config;

    if (!fs.existsSync(sourcePath)) {
      return { success: false, message: `Source file not found: ${sourcePath}` };
    }

    try {
      // Create backup of current target
      if (fs.existsSync(targetPath)) {
        const backupPath = targetPath + '.bak';
        fs.copyFileSync(targetPath, backupPath);
      }

      fs.copyFileSync(sourcePath, targetPath);
      return { success: true, message: `Restored config to ${targetPath}` };
    } catch (error) {
      return {
        success: false,
        message: `Failed to restore config: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export const checklistService = new ChecklistService();
