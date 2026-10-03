/**
 * Stream Deck Integration Types
 * Types for managing Stream Deck backup/restore functionality
 */

// =============================================================================
// Installation Types
// =============================================================================

/**
 * Stream Deck software installation status
 */
export interface StreamDeckInstallation {
  installed: boolean;
  softwarePath?: string;
  profilesPath?: string;
  version?: string;
}

// =============================================================================
// Profile Types
// =============================================================================

/**
 * A Stream Deck profile/page
 */
export interface StreamDeckProfile {
  id: string;
  name: string;
  deviceModel: string;
  modifiedTime: number;
}

// =============================================================================
// Backup Types
// =============================================================================

/**
 * A Stream Deck backup
 */
export interface StreamDeckBackup {
  name: string;
  path: string;
  timestamp: number;
  size: number;
  profileCount: number;
}

/**
 * Result of a backup operation
 */
export interface StreamDeckBackupResult {
  success: boolean;
  path?: string;
  error?: string;
}

/**
 * Result of a restore operation
 */
export interface StreamDeckRestoreResult {
  success: boolean;
  message: string;
  restoredProfiles: number;
  error?: string;
}
