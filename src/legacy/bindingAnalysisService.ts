/**
 * Binding Analysis Service
 * Provides duplicate detection and per-device binding aggregation for DCS bindings.
 */

import { dcsKeybindingService } from './dcsKeybindingService';
import type { DCSKeyBinding, DCSAxisBinding } from '../../shared/dcsTypes';

export interface DuplicateBinding {
  actionName: string;
  actionId: string;
  bindingType: 'key' | 'axis';
  key: string;
  modules: string[];
}

export interface DeviceBindingSummary {
  deviceGuid: string;
  deviceName: string;
  modules: string[];
  totalKeyBindings: number;
  totalAxisBindings: number;
  bindings: {
    module: string;
    keyBindings: DCSKeyBinding[];
    axisBindings: DCSAxisBinding[];
  }[];
}

export interface DuplicateAnalysis {
  deviceGuid: string;
  deviceName: string;
  module: string;
  duplicates: DuplicateBinding[];
}

class BindingAnalysisService {
  /**
   * Find duplicate key assignments within a single module+device.
   * A duplicate is when the same physical key/button is bound to multiple actions.
   */
  findDuplicatesInModule(moduleId: string): DuplicateAnalysis[] {
    const results: DuplicateAnalysis[] = [];
    const deviceBindings = dcsKeybindingService.getModuleBindings(moduleId);

    for (const device of deviceBindings) {
      const keyUsage = new Map<string, { actionName: string; actionId: string }[]>();

      // Check key bindings
      for (const binding of device.keyBindings) {
        if (binding.isRemoved) continue;
        const existing = keyUsage.get(binding.key) || [];
        existing.push({ actionName: binding.name, actionId: binding.id });
        keyUsage.set(binding.key, existing);
      }

      const duplicates: DuplicateBinding[] = [];

      for (const [key, actions] of keyUsage) {
        if (actions.length > 1) {
          for (const action of actions) {
            duplicates.push({
              actionName: action.actionName,
              actionId: action.actionId,
              bindingType: 'key',
              key,
              modules: [moduleId],
            });
          }
        }
      }

      // Check axis bindings for duplicates
      const axisUsage = new Map<string, { actionName: string; actionId: string }[]>();
      for (const binding of device.axisBindings) {
        if (binding.isRemoved) continue;
        const existing = axisUsage.get(binding.key) || [];
        existing.push({ actionName: binding.name, actionId: binding.id });
        axisUsage.set(binding.key, existing);
      }

      for (const [key, actions] of axisUsage) {
        if (actions.length > 1) {
          for (const action of actions) {
            duplicates.push({
              actionName: action.actionName,
              actionId: action.actionId,
              bindingType: 'axis',
              key,
              modules: [moduleId],
            });
          }
        }
      }

      if (duplicates.length > 0) {
        results.push({
          deviceGuid: device.deviceGuid,
          deviceName: device.deviceName,
          module: moduleId,
          duplicates,
        });
      }
    }

    return results;
  }

  /**
   * Get a per-device summary of all bindings across all modules.
   */
  getPerDeviceSummary(): DeviceBindingSummary[] {
    const scanResult = dcsKeybindingService.scanModules();
    const deviceMap = new Map<string, DeviceBindingSummary>();

    for (const module of scanResult.modules) {
      const bindings = dcsKeybindingService.getModuleBindings(module.id);

      for (const device of bindings) {
        let summary = deviceMap.get(device.deviceGuid);
        if (!summary) {
          summary = {
            deviceGuid: device.deviceGuid,
            deviceName: device.deviceName,
            modules: [],
            totalKeyBindings: 0,
            totalAxisBindings: 0,
            bindings: [],
          };
          deviceMap.set(device.deviceGuid, summary);
        }

        if (!summary.modules.includes(module.id)) {
          summary.modules.push(module.id);
        }

        const activeKeyBindings = device.keyBindings.filter((b) => !b.isRemoved);
        const activeAxisBindings = device.axisBindings.filter((b) => !b.isRemoved);

        summary.totalKeyBindings += activeKeyBindings.length;
        summary.totalAxisBindings += activeAxisBindings.length;
        summary.bindings.push({
          module: module.id,
          keyBindings: activeKeyBindings,
          axisBindings: activeAxisBindings,
        });
      }
    }

    return Array.from(deviceMap.values()).sort(
      (a, b) =>
        b.totalKeyBindings + b.totalAxisBindings - (a.totalKeyBindings + a.totalAxisBindings)
    );
  }

  /**
   * Find all duplicates across all modules for a specific device.
   */
  findAllDuplicatesForDevice(deviceGuid: string): DuplicateBinding[] {
    const scanResult = dcsKeybindingService.scanModules();
    const allDuplicates: DuplicateBinding[] = [];

    for (const module of scanResult.modules) {
      const analyses = this.findDuplicatesInModule(module.id);
      for (const analysis of analyses) {
        if (analysis.deviceGuid === deviceGuid) {
          allDuplicates.push(...analysis.duplicates);
        }
      }
    }

    return allDuplicates;
  }

  /**
   * Get binding counts grouped by module for a specific device.
   */
  getDeviceModuleBreakdown(
    deviceGuid: string
  ): { module: string; keyCount: number; axisCount: number }[] {
    const scanResult = dcsKeybindingService.scanModules();
    const breakdown: { module: string; keyCount: number; axisCount: number }[] = [];

    for (const module of scanResult.modules) {
      const bindings = dcsKeybindingService.getModuleBindings(module.id);
      const deviceBinding = bindings.find((b) => b.deviceGuid === deviceGuid);

      if (deviceBinding) {
        breakdown.push({
          module: module.id,
          keyCount: deviceBinding.keyBindings.filter((b) => !b.isRemoved).length,
          axisCount: deviceBinding.axisBindings.filter((b) => !b.isRemoved).length,
        });
      }
    }

    return breakdown.sort((a, b) => b.keyCount + b.axisCount - (a.keyCount + a.axisCount));
  }
}

export const bindingAnalysisService = new BindingAnalysisService();
