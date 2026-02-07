/**
 * Profile Service
 * CRUD for unified profiles stored as YAML in ~/.rigready/profiles/.
 * Follows the keybindingProfileService singleton pattern.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { Profile, ProfileSummary } from '../../shared/profileTypes';

class ProfileService {
  private configDir: string;
  private profilesDir: string;
  private profiles: Map<string, Profile> = new Map();
  private activeProfileId: string | null = null;

  constructor() {
    this.configDir = path.join(process.env.USERPROFILE || '', '.rigready');
    this.profilesDir = path.join(this.configDir, 'profiles');
    this.ensureDirectories();
    this.loadProfiles();
    this.loadActiveProfileId();
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
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          const filePath = path.join(this.profilesDir, file);
          try {
            const data = fs.readFileSync(filePath, 'utf-8');
            const profile = yaml.load(data) as Profile;
            if (profile && profile.id) {
              this.profiles.set(profile.id, profile);
            }
          } catch (err) {
            console.error(`Failed to parse profile ${file}:`, err);
          }
        }
      }
      console.log(`Loaded ${this.profiles.size} unified profiles`);
    } catch (error) {
      console.error('Failed to load profiles:', error);
    }
  }

  private loadActiveProfileId(): void {
    try {
      const stateFile = path.join(this.configDir, 'active-profile.json');
      if (fs.existsSync(stateFile)) {
        const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        if (data.activeProfileId && this.profiles.has(data.activeProfileId)) {
          this.activeProfileId = data.activeProfileId;
        }
      }
    } catch {
      // Ignore
    }
  }

  private saveActiveProfileId(): void {
    try {
      const stateFile = path.join(this.configDir, 'active-profile.json');
      fs.writeFileSync(stateFile, JSON.stringify({ activeProfileId: this.activeProfileId }));
    } catch (err) {
      console.error('Failed to save active profile ID:', err);
    }
  }

  private saveProfileToDisk(profile: Profile): void {
    try {
      const filePath = path.join(this.profilesDir, `${profile.id}.yaml`);
      const yamlContent = yaml.dump(profile, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
      });
      fs.writeFileSync(filePath, yamlContent);
      this.profiles.set(profile.id, profile);
    } catch (error) {
      console.error('Failed to save profile:', error);
      throw error;
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  }

  // =========================================================================
  // CRUD Operations
  // =========================================================================

  create(data: Omit<Profile, 'id' | 'createdAt' | 'lastUsed'>): Profile {
    const profile: Profile = {
      ...data,
      id: this.generateId(),
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };
    this.saveProfileToDisk(profile);
    return profile;
  }

  getById(id: string): Profile | undefined {
    return this.profiles.get(id);
  }

  list(): ProfileSummary[] {
    return Array.from(this.profiles.values()).map((p) => ({
      id: p.id,
      name: p.name,
      game: p.game,
      lastUsed: p.lastUsed,
      checklistItemCount: p.checklistItems.length,
      isActive: p.id === this.activeProfileId,
    }));
  }

  getAll(): Profile[] {
    return Array.from(this.profiles.values());
  }

  save(profile: Profile): void {
    profile.lastUsed = Date.now();
    this.saveProfileToDisk(profile);
  }

  delete(id: string): boolean {
    if (!this.profiles.has(id)) return false;
    try {
      const filePath = path.join(this.profilesDir, `${id}.yaml`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this.profiles.delete(id);
      if (this.activeProfileId === id) {
        this.activeProfileId = null;
        this.saveActiveProfileId();
      }
      return true;
    } catch (error) {
      console.error('Failed to delete profile:', error);
      return false;
    }
  }

  clone(id: string, newName: string): Profile | undefined {
    const original = this.profiles.get(id);
    if (!original) return undefined;

    const cloned: Profile = {
      ...JSON.parse(JSON.stringify(original)),
      id: this.generateId(),
      name: newName,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };
    this.saveProfileToDisk(cloned);
    return cloned;
  }

  // =========================================================================
  // Active Profile
  // =========================================================================

  setActive(id: string): boolean {
    if (!this.profiles.has(id)) return false;
    this.activeProfileId = id;
    this.saveActiveProfileId();
    return true;
  }

  getActive(): Profile | null {
    if (!this.activeProfileId) return null;
    return this.profiles.get(this.activeProfileId) || null;
  }

  getActiveId(): string | null {
    return this.activeProfileId;
  }
}

export const profileService = new ProfileService();
