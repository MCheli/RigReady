/**
 * Keybinding Profile Service
 * Manages unified keybinding profiles with common actions and vehicle bindings
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  KeybindingProfile,
  CommonAction,
  VehicleBinding,
  ActionCategory,
} from '../../shared/types';

// =============================================================================
// Default Common Actions
// =============================================================================

const DEFAULT_COMMON_ACTIONS: Omit<CommonAction, 'physicalInput'>[] = [
  // Flight Controls
  { id: 'pitch-axis', name: 'Pitch Axis', category: 'flight-controls', isAxisAction: true },
  { id: 'roll-axis', name: 'Roll Axis', category: 'flight-controls', isAxisAction: true },
  { id: 'yaw-axis', name: 'Yaw/Rudder Axis', category: 'flight-controls', isAxisAction: true },
  { id: 'throttle-axis', name: 'Throttle Axis', category: 'flight-controls', isAxisAction: true },
  { id: 'flaps-up', name: 'Flaps Up', category: 'flight-controls' },
  { id: 'flaps-down', name: 'Flaps Down', category: 'flight-controls' },
  { id: 'gear-toggle', name: 'Landing Gear Toggle', category: 'flight-controls' },
  { id: 'wheel-brake', name: 'Wheel Brake', category: 'flight-controls' },
  { id: 'parking-brake', name: 'Parking Brake', category: 'flight-controls' },
  { id: 'speed-brake', name: 'Speed Brake', category: 'flight-controls' },
  { id: 'trim-up', name: 'Trim Up', category: 'flight-controls' },
  { id: 'trim-down', name: 'Trim Down', category: 'flight-controls' },
  { id: 'trim-left', name: 'Trim Left', category: 'flight-controls' },
  { id: 'trim-right', name: 'Trim Right', category: 'flight-controls' },

  // Weapons
  {
    id: 'trigger',
    name: 'Weapon Trigger',
    category: 'weapons',
    description: 'Primary weapon fire',
  },
  {
    id: 'pickle',
    name: 'Weapon Release (Pickle)',
    category: 'weapons',
    description: 'Release bombs/missiles',
  },
  { id: 'master-arm', name: 'Master Arm Toggle', category: 'weapons' },
  { id: 'weapon-select-next', name: 'Weapon Select Next', category: 'weapons' },
  { id: 'weapon-select-prev', name: 'Weapon Select Previous', category: 'weapons' },
  { id: 'cage-uncage', name: 'Cage/Uncage', category: 'weapons' },

  // Countermeasures
  { id: 'chaff', name: 'Chaff Dispense', category: 'countermeasures' },
  { id: 'flare', name: 'Flare Dispense', category: 'countermeasures' },
  { id: 'cm-dispense', name: 'Countermeasures Dispense', category: 'countermeasures' },

  // Systems
  { id: 'radar-mode', name: 'Radar Mode', category: 'systems' },
  { id: 'tdc-up', name: 'TDC Up', category: 'systems' },
  { id: 'tdc-down', name: 'TDC Down', category: 'systems' },
  { id: 'tdc-left', name: 'TDC Left', category: 'systems' },
  { id: 'tdc-right', name: 'TDC Right', category: 'systems' },
  { id: 'tdc-depress', name: 'TDC Depress', category: 'systems' },
  { id: 'sensor-select', name: 'Sensor Select', category: 'systems' },

  // Autopilot
  { id: 'ap-engage', name: 'Autopilot Engage', category: 'autopilot' },
  { id: 'ap-disengage', name: 'Autopilot Disengage', category: 'autopilot' },
  { id: 'ap-att-hold', name: 'Attitude Hold', category: 'autopilot' },
  { id: 'ap-alt-hold', name: 'Altitude Hold', category: 'autopilot' },

  // Views
  { id: 'look-up', name: 'Look Up', category: 'views' },
  { id: 'look-down', name: 'Look Down', category: 'views' },
  { id: 'look-left', name: 'Look Left', category: 'views' },
  { id: 'look-right', name: 'Look Right', category: 'views' },
  { id: 'zoom-in', name: 'Zoom In', category: 'views' },
  { id: 'zoom-out', name: 'Zoom Out', category: 'views' },
  { id: 'recenter-view', name: 'Recenter VR/TrackIR', category: 'views' },

  // Communications
  { id: 'ptt-radio1', name: 'PTT Radio 1', category: 'communications' },
  { id: 'ptt-radio2', name: 'PTT Radio 2', category: 'communications' },
  { id: 'ptt-intercom', name: 'PTT Intercom', category: 'communications' },

  // Lights
  { id: 'nav-lights', name: 'Navigation Lights', category: 'lights' },
  { id: 'landing-lights', name: 'Landing Lights', category: 'lights' },
  { id: 'strobe-lights', name: 'Strobe Lights', category: 'lights' },

  // Engine
  { id: 'engine-start', name: 'Engine Start', category: 'engine' },
  { id: 'engine-stop', name: 'Engine Stop', category: 'engine' },
  { id: 'afterburner', name: 'Afterburner', category: 'engine' },
];

// =============================================================================
// Service
// =============================================================================

export class KeybindingProfileService {
  private configDir: string;
  private profilesDir: string;
  private profiles: Map<string, KeybindingProfile> = new Map();

  constructor() {
    this.configDir = path.join(process.env.USERPROFILE || '', '.rigready');
    this.profilesDir = path.join(this.configDir, 'keybinding-profiles');
    this.ensureDirectories();
    this.loadProfiles();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    if (!fs.existsSync(this.profilesDir)) {
      fs.mkdirSync(this.profilesDir, { recursive: true });
    }
  }

  private loadProfiles(): void {
    try {
      const files = fs.readdirSync(this.profilesDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.profilesDir, file);
          const data = fs.readFileSync(filePath, 'utf-8');
          const profile = JSON.parse(data) as KeybindingProfile;
          this.profiles.set(profile.id, profile);
        }
      }
      console.log(`Loaded ${this.profiles.size} keybinding profiles`);
    } catch (error) {
      console.error('Failed to load keybinding profiles:', error);
    }
  }

  private saveProfile(profile: KeybindingProfile): void {
    try {
      const filePath = path.join(this.profilesDir, `${profile.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
      this.profiles.set(profile.id, profile);
    } catch (error) {
      console.error('Failed to save keybinding profile:', error);
      throw error;
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  }

  // =============================================================================
  // Profile Management
  // =============================================================================

  getProfiles(): KeybindingProfile[] {
    return Array.from(this.profiles.values());
  }

  getProfile(id: string): KeybindingProfile | undefined {
    return this.profiles.get(id);
  }

  createProfile(name: string, description?: string): KeybindingProfile {
    const profile: KeybindingProfile = {
      id: this.generateId(),
      name,
      description,
      commonActions: [],
      vehicleBindings: [],
      created: Date.now(),
      modified: Date.now(),
    };
    this.saveProfile(profile);
    return profile;
  }

  updateProfile(profile: KeybindingProfile): void {
    profile.modified = Date.now();
    this.saveProfile(profile);
  }

  deleteProfile(id: string): boolean {
    if (!this.profiles.has(id)) {
      return false;
    }
    try {
      const filePath = path.join(this.profilesDir, `${id}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this.profiles.delete(id);
      return true;
    } catch (error) {
      console.error('Failed to delete keybinding profile:', error);
      return false;
    }
  }

  duplicateProfile(id: string, newName: string): KeybindingProfile | undefined {
    const original = this.profiles.get(id);
    if (!original) {
      return undefined;
    }

    const duplicate: KeybindingProfile = {
      ...JSON.parse(JSON.stringify(original)),
      id: this.generateId(),
      name: newName,
      created: Date.now(),
      modified: Date.now(),
    };
    this.saveProfile(duplicate);
    return duplicate;
  }

  // =============================================================================
  // Common Action Management
  // =============================================================================

  addAction(profileId: string, action: CommonAction): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return false;
    }

    // Check for duplicate ID
    if (profile.commonActions.some((a) => a.id === action.id)) {
      return false;
    }

    profile.commonActions.push(action);
    this.saveProfile(profile);
    return true;
  }

  updateAction(profileId: string, actionId: string, updates: Partial<CommonAction>): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return false;
    }

    const index = profile.commonActions.findIndex((a) => a.id === actionId);
    if (index === -1) {
      return false;
    }

    profile.commonActions[index] = {
      ...profile.commonActions[index],
      ...updates,
      id: actionId, // Prevent ID from being changed
    };
    this.saveProfile(profile);
    return true;
  }

  removeAction(profileId: string, actionId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return false;
    }

    const index = profile.commonActions.findIndex((a) => a.id === actionId);
    if (index === -1) {
      return false;
    }

    profile.commonActions.splice(index, 1);
    // Also remove any vehicle bindings that reference this action
    profile.vehicleBindings = profile.vehicleBindings.filter((b) => b.commonActionId !== actionId);
    this.saveProfile(profile);
    return true;
  }

  // =============================================================================
  // Vehicle Binding Management
  // =============================================================================

  addBinding(profileId: string, binding: VehicleBinding): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return false;
    }

    // Check if binding already exists
    const exists = profile.vehicleBindings.some(
      (b) => b.vehicleId === binding.vehicleId && b.commonActionId === binding.commonActionId
    );
    if (exists) {
      // Update existing binding
      const index = profile.vehicleBindings.findIndex(
        (b) => b.vehicleId === binding.vehicleId && b.commonActionId === binding.commonActionId
      );
      profile.vehicleBindings[index] = binding;
    } else {
      profile.vehicleBindings.push(binding);
    }

    this.saveProfile(profile);
    return true;
  }

  removeBinding(profileId: string, vehicleId: string, commonActionId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return false;
    }

    const index = profile.vehicleBindings.findIndex(
      (b) => b.vehicleId === vehicleId && b.commonActionId === commonActionId
    );
    if (index === -1) {
      return false;
    }

    profile.vehicleBindings.splice(index, 1);
    this.saveProfile(profile);
    return true;
  }

  // =============================================================================
  // Helpers
  // =============================================================================

  getDefaultActions(): Omit<CommonAction, 'physicalInput'>[] {
    return DEFAULT_COMMON_ACTIONS;
  }

  getActionsByCategory(profileId: string, category: ActionCategory): CommonAction[] {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return [];
    }
    return profile.commonActions.filter((a) => a.category === category);
  }

  getBindingsForVehicle(profileId: string, vehicleId: string): VehicleBinding[] {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return [];
    }
    return profile.vehicleBindings.filter((b) => b.vehicleId === vehicleId);
  }

  // =============================================================================
  // Import/Export
  // =============================================================================

  /**
   * Export a profile to a JSON string for sharing
   */
  exportProfile(id: string): string | undefined {
    const profile = this.profiles.get(id);
    if (!profile) {
      return undefined;
    }

    const exportData = {
      version: 1,
      exportedAt: Date.now(),
      profile: {
        ...profile,
        id: undefined, // Remove ID so it gets regenerated on import
      },
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import a profile from a JSON string
   * Returns the imported profile or undefined if invalid
   */
  importProfile(jsonData: string, newName?: string): KeybindingProfile | undefined {
    try {
      const importData = JSON.parse(jsonData);

      // Validate structure
      if (!importData.profile || typeof importData.profile !== 'object') {
        console.error('Invalid import data: missing profile');
        return undefined;
      }

      const imported = importData.profile;

      // Create new profile with fresh ID
      const profile: KeybindingProfile = {
        id: this.generateId(),
        name: newName || imported.name || 'Imported Profile',
        description: imported.description,
        commonActions: imported.commonActions || [],
        vehicleBindings: imported.vehicleBindings || [],
        created: Date.now(),
        modified: Date.now(),
      };

      // Validate and fix action IDs
      for (const action of profile.commonActions) {
        if (!action.id) {
          action.id = this.generateId();
        }
      }

      this.saveProfile(profile);
      return profile;
    } catch (error) {
      console.error('Failed to import profile:', error);
      return undefined;
    }
  }

  /**
   * Create a backup of all profiles
   */
  createBackup(): { timestamp: number; profiles: KeybindingProfile[] } {
    return {
      timestamp: Date.now(),
      profiles: Array.from(this.profiles.values()),
    };
  }

  /**
   * Restore profiles from a backup (replaces all existing)
   */
  restoreFromBackup(backup: { timestamp: number; profiles: KeybindingProfile[] }): boolean {
    try {
      // Clear existing profiles
      for (const id of this.profiles.keys()) {
        const filePath = path.join(this.profilesDir, `${id}.json`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      this.profiles.clear();

      // Restore from backup
      for (const profile of backup.profiles) {
        this.saveProfile(profile);
      }

      return true;
    } catch (error) {
      console.error('Failed to restore from backup:', error);
      return false;
    }
  }
}

// Export singleton instance
export const keybindingProfileService = new KeybindingProfileService();
