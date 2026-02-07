/**
 * Unified Profile Types
 * Core types for the unified profile system that consolidates
 * game profiles, preflight checks, display configs, and keybindings.
 */

import type { Simulator } from './types';

// =============================================================================
// Profile
// =============================================================================

export interface Profile {
  id: string;
  name: string;
  game: Simulator;
  createdAt: number;
  lastUsed: number;
  launchTarget?: LaunchTarget;
  checklistItems: ChecklistItem[];
  trackedConfigurations: TrackedConfiguration[];
}

export interface ProfileSummary {
  id: string;
  name: string;
  game: Simulator;
  lastUsed: number;
  checklistItemCount: number;
  isActive: boolean;
}

// =============================================================================
// Launch Target
// =============================================================================

export interface LaunchTarget {
  executablePath: string;
  arguments: string[];
  workingDirectory?: string;
  preScripts: ScriptAction[];
  postScripts: ScriptAction[];
}

export interface ScriptAction {
  id: string;
  name: string;
  scriptPath: string;
  arguments: string[];
  timeout: number;
  runHidden: boolean;
  successExitCodes: number[];
}

// =============================================================================
// Checklist Items (Discriminated Union)
// =============================================================================

export type ChecklistItemType = 'process' | 'device' | 'display' | 'config' | 'script';
export type ChecklistItemCategory =
  | 'software'
  | 'hardware'
  | 'display'
  | 'configuration'
  | 'custom';

export type ChecklistItem =
  | ProcessChecklistItem
  | DeviceChecklistItem
  | DisplayChecklistItem
  | ConfigChecklistItem
  | ScriptChecklistItem;

interface BaseChecklistItem {
  id: string;
  name: string;
  isRequired: boolean;
  category: ChecklistItemCategory;
  remediation?: Remediation;
}

export interface ProcessChecklistItem extends BaseChecklistItem {
  type: 'process';
  config: {
    processName: string;
    displayName?: string;
  };
}

export interface DeviceChecklistItem extends BaseChecklistItem {
  type: 'device';
  config: {
    vendorId?: number;
    productId?: number;
    deviceName?: string;
  };
}

export interface DisplayChecklistItem extends BaseChecklistItem {
  type: 'display';
  config: {
    configurationName: string;
  };
}

export interface ConfigChecklistItem extends BaseChecklistItem {
  type: 'config';
  config: {
    filePath: string;
    contentRegex?: string;
  };
}

export interface ScriptChecklistItem extends BaseChecklistItem {
  type: 'script';
  config: {
    scriptPath: string;
    arguments: string[];
    successExitCodes: number[];
    timeout: number;
  };
}

// =============================================================================
// Remediation (Discriminated Union)
// =============================================================================

export type RemediationType =
  | 'launchProcess'
  | 'autoFixDisplay'
  | 'restoreConfig'
  | 'notifyUser'
  | 'script';

export type Remediation =
  | LaunchProcessRemediation
  | AutoFixDisplayRemediation
  | RestoreConfigRemediation
  | NotifyUserRemediation
  | ScriptRemediation;

export interface LaunchProcessRemediation {
  type: 'launchProcess';
  config: {
    executablePath: string;
    arguments?: string[];
    waitAfterLaunch?: number;
  };
}

export interface AutoFixDisplayRemediation {
  type: 'autoFixDisplay';
  config: {
    configurationName: string;
  };
}

export interface RestoreConfigRemediation {
  type: 'restoreConfig';
  config: {
    sourcePath: string;
    targetPath: string;
  };
}

export interface NotifyUserRemediation {
  type: 'notifyUser';
  config: {
    message: string;
    instructions?: string;
  };
}

export interface ScriptRemediation {
  type: 'script';
  config: {
    scriptPath: string;
    arguments: string[];
    timeout: number;
  };
}

// =============================================================================
// Check Results
// =============================================================================

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip' | 'running';

export interface CheckResult {
  checklistItemId: string;
  checklistItemName: string;
  status: CheckStatus;
  message: string;
  canRemediate: boolean;
  timestamp: number;
}

export interface ChecklistResult {
  profileId: string;
  profileName: string;
  overallStatus: CheckStatus;
  results: CheckResult[];
  allRequiredPassed: boolean;
  timestamp: number;
}

// =============================================================================
// Tracked Configuration
// =============================================================================

export interface TrackedConfiguration {
  name: string;
  path: string;
  snapshotPath?: string;
  lastSnapshot?: number;
}
