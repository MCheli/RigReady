/**
 * DCS World Keybinding Types
 * Types for parsing and managing DCS keybinding files
 */

// =============================================================================
// DCS Axis Binding Types
// =============================================================================

/**
 * Axis filter configuration (curvature, deadzone, etc.)
 */
export interface DCSAxisFilter {
  curvature?: number[];
  deadzone?: number;
  invert?: boolean;
  saturationX?: number;
  saturationY?: number;
  slider?: boolean;
}

/**
 * Single axis binding in DCS
 */
export interface DCSAxisBinding {
  id: string;
  name: string;
  key: string;
  filter?: DCSAxisFilter;
  isRemoved?: boolean;
}

// =============================================================================
// DCS Key Binding Types
// =============================================================================

/**
 * Single key/button binding in DCS
 */
export interface DCSKeyBinding {
  id: string;
  name: string;
  key: string;
  reformers?: string[];
  isRemoved?: boolean;
}

// =============================================================================
// DCS Device Binding Types
// =============================================================================

/**
 * Complete bindings for a single device in a module
 */
export interface DCSDeviceBindings {
  deviceName: string;
  deviceGuid: string;
  filePath: string;
  module: string;
  axisBindings: DCSAxisBinding[];
  keyBindings: DCSKeyBinding[];
}

/**
 * GUID mapping between backup and current device
 */
export interface DCSGuidMapping {
  backupGuid: string;
  currentGuid: string;
  deviceName: string;
  confidence: 'exact' | 'name-match' | 'manual';
}

// =============================================================================
// DCS Module Types
// =============================================================================

/**
 * Detected DCS module with input files
 */
export interface DCSModule {
  id: string;
  name: string;
  path: string;
  deviceCount: number;
}

/**
 * Result of scanning DCS Saved Games folder
 */
export interface DCSScanResult {
  savedGamesPath: string;
  modules: DCSModule[];
  errors: string[];
}

// =============================================================================
// DCS Restore Types
// =============================================================================

/**
 * Options for restoring bindings
 */
export interface DCSRestoreOptions {
  guidMappings: DCSGuidMapping[];
  createBackup?: boolean;
  module: string;
  deviceGuid?: string;
}

/**
 * Result of restore operation
 */
export interface DCSRestoreResult {
  success: boolean;
  message: string;
  backupPath?: string;
  restoredDevices: string[];
  errors: string[];
}

// =============================================================================
// Parsed Lua Types
// =============================================================================

/**
 * Parsed axisDiffs structure from DCS Lua file
 */
export interface DCSAxisDiff {
  [actionId: string]: {
    added?: {
      [keyIndex: string]: {
        key: string;
        filter?: DCSAxisFilter;
      };
    };
    removed?: {
      [keyIndex: string]: {
        key: string;
      };
    };
    name?: string;
  };
}

/**
 * Parsed keyDiffs structure from DCS Lua file
 */
export interface DCSKeyDiff {
  [actionId: string]: {
    added?: {
      [keyIndex: string]: {
        key: string;
        reformers?: string[];
      };
    };
    removed?: {
      [keyIndex: string]: {
        key: string;
      };
    };
    name?: string;
  };
}

/**
 * Complete parsed DCS binding file
 */
export interface DCSBindingFile {
  axisDiffs: DCSAxisDiff;
  keyDiffs: DCSKeyDiff;
  forceFeedback?: Record<string, unknown>;
  raw?: string;
}

// =============================================================================
// Compare Types
// =============================================================================

/**
 * Comparison between two binding sets
 */
export interface DCSBindingComparison {
  deviceName: string;
  deviceGuid: string;
  currentBindings: DCSDeviceBindings | null;
  backupBindings: DCSDeviceBindings | null;
  differences: DCSBindingDifference[];
}

/**
 * Single difference between current and backup binding
 */
export interface DCSBindingDifference {
  type: 'added' | 'removed' | 'modified';
  bindingType: 'axis' | 'key';
  actionId: string;
  actionName: string;
  currentValue?: string;
  backupValue?: string;
}
