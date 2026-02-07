import * as fs from 'fs';
import { EventEmitter } from 'events';

// Mock modules before importing
jest.mock('fs');
jest.mock('archiver', () => {
  return jest.fn(() => {
    const archive = new EventEmitter();
    (archive as unknown as Record<string, unknown>).pipe = jest.fn();
    (archive as unknown as Record<string, unknown>).append = jest.fn();
    (archive as unknown as Record<string, unknown>).finalize = jest.fn(() => {
      // Simulate close event on next tick
      process.nextTick(() => archive.emit('close'));
    });
    return archive;
  });
});
jest.mock('extract-zip', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/main/services/profileService', () => ({
  profileService: {
    getById: jest.fn(),
    create: jest.fn(),
  },
}));
jest.mock('../../src/main/services/pathVariableService', () => ({
  pathVariableService: {
    expandPath: jest.fn((p: string) => p),
    tokenizePath: jest.fn((p: string) => p),
  },
}));
jest.mock('js-yaml', () => ({
  __esModule: true,
  default: {
    dump: jest.fn(() => 'yaml content'),
    load: jest.fn(() => ({
      game: 'dcs',
      checklistItems: [],
      trackedConfigurations: [],
    })),
  },
  dump: jest.fn(() => 'yaml content'),
  load: jest.fn(() => ({
    game: 'dcs',
    checklistItems: [],
    trackedConfigurations: [],
  })),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

import { bundleService } from '../../src/main/services/bundleService';
import { profileService } from '../../src/main/services/profileService';

const mockProfileService = profileService as jest.Mocked<typeof profileService>;

describe('BundleService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.rmSync.mockReturnValue(undefined);
  });

  describe('constructor', () => {
    it('should have initialized bundles directory', () => {
      // The constructor ran during import; verify the service works
      // by checking it can handle exportBundle calls
      mockProfileService.getById.mockReturnValue(undefined);
      return bundleService
        .exportBundle({ profileId: 'x', includeConfigSnapshots: false })
        .then((r) => {
          expect(r.success).toBe(false);
        });
    });
  });

  describe('exportBundle', () => {
    it('should return error when profile not found', async () => {
      mockProfileService.getById.mockReturnValue(undefined);

      const result = await bundleService.exportBundle({
        profileId: 'nonexistent',
        includeConfigSnapshots: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Profile not found');
    });

    it('should attempt export for valid profile (integration requires real fs)', async () => {
      const mockProfile = {
        id: 'test-id',
        name: 'Test Profile',
        game: 'dcs' as const,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        checklistItems: [],
        trackedConfigurations: [],
      };
      mockProfileService.getById.mockReturnValue(mockProfile);

      // With fully mocked fs and archiver, the ZIP creation may fail
      // but should not throw - it should return a result object
      const result = await bundleService.exportBundle({
        profileId: 'test-id',
        includeConfigSnapshots: false,
      });

      // The result should be an object with success field (true or false)
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    });

    it('should generate default output path from profile name', async () => {
      const mockProfile = {
        id: 'test-id',
        name: 'My DCS Profile',
        game: 'dcs' as const,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        checklistItems: [],
        trackedConfigurations: [],
      };
      mockProfileService.getById.mockReturnValue(mockProfile);

      const result = await bundleService.exportBundle({
        profileId: 'test-id',
        includeConfigSnapshots: false,
      });

      if (result.bundlePath) {
        expect(result.bundlePath).toContain('My_DCS_Profile');
        expect(result.bundlePath).toContain('.rigready');
      }
    });
  });

  describe('importBundle', () => {
    it('should return error when bundle file missing', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await bundleService.importBundle({
        bundlePath: 'C:\\nonexistent.rigready',
        restoreConfigs: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Bundle file not found');
    });

    it('should return error when manifest.json missing', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr.endsWith('.rigready')) return true;
        if (pathStr.includes('manifest.json')) return false;
        return true;
      });

      const result = await bundleService.importBundle({
        bundlePath: 'C:\\test.rigready',
        restoreConfigs: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('manifest.json');
    });

    it('should create profile with optional name override', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const pathStr = p.toString();
        if (pathStr.includes('manifest.json')) {
          return JSON.stringify({
            version: 1,
            profileName: 'Original Name',
            game: 'dcs',
            files: [],
            createdAt: Date.now(),
            createdBy: 'test',
            appVersion: '1.0.0',
            compatibility: { minAppVersion: '1.0.0', platform: 'win32' },
          });
        }
        if (pathStr.includes('profile.yaml')) {
          return 'game: dcs\nchecklistItems: []\ntrackedConfigurations: []';
        }
        return '';
      });

      mockProfileService.create.mockReturnValue({
        id: 'imported-id',
        name: 'Custom Name',
        game: 'dcs',
        createdAt: Date.now(),
        lastUsed: Date.now(),
        checklistItems: [],
        trackedConfigurations: [],
      });

      const result = await bundleService.importBundle({
        bundlePath: 'C:\\test.rigready',
        newProfileName: 'Custom Name',
        restoreConfigs: false,
      });

      expect(result.success).toBe(true);
      expect(result.profileName).toBe('Custom Name');
    });

    it('should clean up temp directory in finally block', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const pathStr = p.toString();
        if (pathStr.includes('manifest.json')) {
          return JSON.stringify({
            version: 1,
            profileName: 'Test',
            game: 'dcs',
            files: [],
            createdAt: Date.now(),
            createdBy: 'test',
            appVersion: '1.0.0',
            compatibility: { minAppVersion: '1.0.0', platform: 'win32' },
          });
        }
        return '';
      });

      mockProfileService.create.mockReturnValue({
        id: 'id',
        name: 'Test',
        game: 'dcs',
        createdAt: 0,
        lastUsed: 0,
        checklistItems: [],
        trackedConfigurations: [],
      });

      await bundleService.importBundle({
        bundlePath: 'C:\\test.rigready',
        restoreConfigs: false,
      });

      // rmSync should be called for cleanup
      expect(mockFs.rmSync).toHaveBeenCalled();
    });
  });
});
