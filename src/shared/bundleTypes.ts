/**
 * Bundle Export/Import Types
 * Types for .rigready profile bundle files.
 */

export interface BundleManifest {
  version: number;
  createdAt: number;
  createdBy: string;
  appVersion: string;
  profileName: string;
  game: string;
  description?: string;
  compatibility: BundleCompatibility;
  files: BundleFileEntry[];
}

export interface BundleCompatibility {
  minAppVersion: string;
  platform: string;
  requiredDevices?: string[];
}

export interface BundleFileEntry {
  path: string;
  type: 'profile' | 'config-snapshot' | 'metadata';
  originalPath?: string;
  size: number;
}

export interface ExportOptions {
  profileId: string;
  includeConfigSnapshots: boolean;
  description?: string;
  outputPath?: string;
}

export interface ImportOptions {
  bundlePath: string;
  newProfileName?: string;
  restoreConfigs: boolean;
}

export interface ExportResult {
  success: boolean;
  bundlePath?: string;
  error?: string;
}

export interface ImportResult {
  success: boolean;
  profileId?: string;
  profileName?: string;
  warnings: string[];
  error?: string;
}

export interface PrivacyReviewResult {
  hasIssues: boolean;
  findings: PrivacyFinding[];
}

export interface PrivacyFinding {
  file: string;
  line?: number;
  pattern: string;
  description: string;
  severity: 'warning' | 'info';
}
