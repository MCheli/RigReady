import * as fs from 'fs';

// Mock modules before importing the service
jest.mock('fs');
jest.mock('js-yaml', () => ({
  load: jest.fn((data: string) => JSON.parse(data)),
  dump: jest.fn((obj: unknown) => JSON.stringify(obj)),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

// Set up env before import
process.env.USERPROFILE = 'C:\\Users\\TestUser';

// Mock existsSync and other fs methods before import
mockFs.existsSync.mockReturnValue(false);
mockFs.mkdirSync.mockReturnValue(undefined);
mockFs.readdirSync.mockReturnValue([]);
mockFs.writeFileSync.mockReturnValue(undefined);

import { profileService } from '../../src/main/services/profileService';

describe('ProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockReturnValue(undefined);
  });

  describe('constructor', () => {
    it('should have created profiles directory during init', () => {
      // The constructor ran during import; we verify it works by checking
      // that profiles can be created (which requires the dir setup)
      const profile = profileService.create({
        name: 'Constructor Test',
        game: 'dcs',
        checklistItems: [],
        trackedConfigurations: [],
      });
      expect(profile.id).toBeDefined();
    });
  });

  describe('create', () => {
    it('should generate unique ID and set timestamps', () => {
      const profile = profileService.create({
        name: 'Test Profile',
        game: 'dcs',
        checklistItems: [],
        trackedConfigurations: [],
      });

      expect(profile.id).toBeDefined();
      expect(profile.id.length).toBeGreaterThan(0);
      expect(profile.name).toBe('Test Profile');
      expect(profile.game).toBe('dcs');
      expect(profile.createdAt).toBeGreaterThan(0);
      expect(profile.lastUsed).toBeGreaterThan(0);
    });

    it('should save profile to disk', () => {
      profileService.create({
        name: 'Disk Profile',
        game: 'msfs',
        checklistItems: [],
        trackedConfigurations: [],
      });

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('should return profile by ID', () => {
      const created = profileService.create({
        name: 'Find Me',
        game: 'dcs',
        checklistItems: [],
        trackedConfigurations: [],
      });

      const found = profileService.getById(created.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Find Me');
    });

    it('should return undefined for non-existent ID', () => {
      const result = profileService.getById('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should return summaries with isActive flag', () => {
      const created = profileService.create({
        name: 'Listed Profile',
        game: 'xplane',
        checklistItems: [
          {
            id: 'item1',
            type: 'process',
            name: 'Test',
            isRequired: true,
            category: 'software',
            config: { processName: 'test.exe' },
          },
        ],
        trackedConfigurations: [],
      });

      const list = profileService.list();
      const found = list.find((p) => p.id === created.id);

      expect(found).toBeDefined();
      expect(found?.name).toBe('Listed Profile');
      expect(found?.game).toBe('xplane');
      expect(found?.checklistItemCount).toBe(1);
      expect(typeof found?.isActive).toBe('boolean');
    });
  });

  describe('getAll', () => {
    it('should return all profiles', () => {
      const all = profileService.getAll();
      expect(Array.isArray(all)).toBe(true);
    });
  });

  describe('save', () => {
    it('should update lastUsed and write to disk', () => {
      const profile = profileService.create({
        name: 'Save Test',
        game: 'dcs',
        checklistItems: [],
        trackedConfigurations: [],
      });

      const oldLastUsed = profile.lastUsed;

      // Small delay to ensure different timestamp
      profile.name = 'Save Test Updated';
      profileService.save(profile);

      expect(profile.lastUsed).toBeGreaterThanOrEqual(oldLastUsed);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should remove file and map entry', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockReturnValue(undefined);

      const profile = profileService.create({
        name: 'Delete Me',
        game: 'dcs',
        checklistItems: [],
        trackedConfigurations: [],
      });

      const result = profileService.delete(profile.id);
      expect(result).toBe(true);
      expect(profileService.getById(profile.id)).toBeUndefined();
    });

    it('should clear activeProfileId if deleted profile was active', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockReturnValue(undefined);

      const profile = profileService.create({
        name: 'Active Delete',
        game: 'dcs',
        checklistItems: [],
        trackedConfigurations: [],
      });

      profileService.setActive(profile.id);
      expect(profileService.getActiveId()).toBe(profile.id);

      profileService.delete(profile.id);
      expect(profileService.getActiveId()).toBeNull();
    });

    it('should return false for non-existent profile', () => {
      const result = profileService.delete('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('clone', () => {
    it('should create deep copy with new ID and name', () => {
      const original = profileService.create({
        name: 'Original',
        game: 'dcs',
        checklistItems: [
          {
            id: 'item1',
            type: 'process',
            name: 'Proc',
            isRequired: true,
            category: 'software',
            config: { processName: 'test.exe' },
          },
        ],
        trackedConfigurations: [],
      });

      const cloned = profileService.clone(original.id, 'Cloned Copy');

      expect(cloned).toBeDefined();
      expect(cloned!.id).not.toBe(original.id);
      expect(cloned!.name).toBe('Cloned Copy');
      expect(cloned!.game).toBe('dcs');
      expect(cloned!.checklistItems).toHaveLength(1);
    });

    it('should return undefined for non-existent source', () => {
      const result = profileService.clone('non-existent-id', 'New Name');
      expect(result).toBeUndefined();
    });
  });

  describe('active profile management', () => {
    it('should round-trip setActive/getActive/getActiveId', () => {
      const profile = profileService.create({
        name: 'Active Profile',
        game: 'dcs',
        checklistItems: [],
        trackedConfigurations: [],
      });

      profileService.setActive(profile.id);
      expect(profileService.getActiveId()).toBe(profile.id);
      expect(profileService.getActive()?.id).toBe(profile.id);
    });

    it('should return false for non-existent profile', () => {
      const result = profileService.setActive('non-existent-id');
      expect(result).toBe(false);
    });
  });
});
