/**
 * Unit tests for DCSKeybindingService
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');
jest.mock('os', () => ({
  homedir: jest.fn(() => '/mock/home'),
}));
jest.mock('../../src/main/services/dcsLuaParser', () => ({
  parseDCSBindingFile: jest.fn(() => ({ axisDiffs: {}, keyDiffs: {}, raw: '' })),
  extractAxisBindings: jest.fn(() => []),
  extractKeyBindings: jest.fn(() => []),
  extractDeviceGuidFromPath: jest.fn(() => '{test-guid}'),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

// We import DCSKeybindingService as a class so we can create fresh instances per test.
// The singleton at module scope would run the constructor immediately on import,
// so we import it after mocks are set up and create instances manually.
import { DCSKeybindingService } from '../../src/main/services/dcsKeybindingService';
import type { DCSDeviceBindings, DCSGuidMapping } from '../../src/shared/dcsTypes';

/**
 * Helper to create a DCSKeybindingService instance with the constructor's
 * detectSavedGamesPath() finding (or not finding) a DCS folder.
 */
function createService(detectedPath: string | null): InstanceType<typeof DCSKeybindingService> {
  // The constructor calls detectSavedGamesPath which checks fs.existsSync
  // for DCS.openbeta then DCS in ~/Saved Games
  if (detectedPath) {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      return String(p) === detectedPath;
    });
  } else {
    mockFs.existsSync.mockReturnValue(false);
  }
  return new DCSKeybindingService();
}

/**
 * Helper to create a mock fs.Dirent object
 */
function makeDirent(name: string, isDir: boolean, parentPath: string): fs.Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath,
    path: parentPath,
  } as fs.Dirent;
}

describe('DCSKeybindingService', () => {
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    jest.clearAllMocks();
    // Override USERPROFILE so that getAvailableBackups/createBackup/deleteBackup
    // use the mocked home directory consistently across platforms.
    process.env.USERPROFILE = '/mock/home';
  });

  afterEach(() => {
    process.env.USERPROFILE = originalUserProfile;
  });

  // =========================================================================
  // getSavedGamesPath
  // =========================================================================

  describe('getSavedGamesPath', () => {
    it('returns detected path when DCS folder exists', () => {
      const expectedPath = path.join('/mock/home', 'Saved Games', 'DCS.openbeta');
      const service = createService(expectedPath);

      expect(service.getSavedGamesPath()).toBe(expectedPath);
    });

    it('returns null when no DCS folder found', () => {
      const service = createService(null);

      expect(service.getSavedGamesPath()).toBeNull();
    });
  });

  // =========================================================================
  // setSavedGamesPath
  // =========================================================================

  describe('setSavedGamesPath', () => {
    it('sets path when directory exists', () => {
      const service = createService(null);

      // Now make the custom path exist
      mockFs.existsSync.mockReturnValue(true);
      const customPath = '/custom/dcs/path';

      const result = service.setSavedGamesPath(customPath);

      expect(result).toBe(true);
      expect(service.getSavedGamesPath()).toBe(customPath);
    });

    it('returns false for non-existent path', () => {
      const service = createService(null);

      mockFs.existsSync.mockReturnValue(false);
      const result = service.setSavedGamesPath('/nonexistent/path');

      expect(result).toBe(false);
      expect(service.getSavedGamesPath()).toBeNull();
    });
  });

  // =========================================================================
  // scanModules
  // =========================================================================

  describe('scanModules', () => {
    it('returns modules list when DCS path is set', () => {
      const dcsPath = path.join('/mock/home', 'Saved Games', 'DCS');
      const service = createService(dcsPath);

      const inputPath = path.join(dcsPath, 'Config', 'Input');
      const joystickPath = path.join(inputPath, 'FA-18C_hornet', 'joystick');

      // Configure existsSync for the scan flow
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s === inputPath) return true;
        if (s === joystickPath) return true;
        return false;
      });

      // readdirSync for the Input folder returns module directories
      (mockFs.readdirSync as any).mockImplementation((dir: string) => {
        if (dir === inputPath) {
          return [makeDirent('FA-18C_hornet', true, inputPath)];
        }
        // joystick folder has .diff.lua files
        if (dir === joystickPath) {
          return ['{some-guid}.diff.lua'];
        }
        return [];
      });

      const result = service.scanModules();

      expect(result.errors).toHaveLength(0);
      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].id).toBe('FA-18C_hornet');
      expect(result.modules[0].name).toBe('F/A-18C Hornet');
      expect(result.modules[0].deviceCount).toBe(1);
    });

    it('returns error when no DCS path is set', () => {
      const service = createService(null);

      const result = service.scanModules();

      expect(result.errors).toContain('DCS Saved Games path not found');
      expect(result.modules).toHaveLength(0);
    });
  });

  // =========================================================================
  // getModuleBindings
  // =========================================================================

  describe('getModuleBindings', () => {
    it('returns empty when no saved games path', () => {
      const service = createService(null);

      const result = service.getModuleBindings('FA-18C_hornet');

      expect(result).toEqual([]);
    });

    it('returns parsed bindings when files exist', () => {
      const dcsPath = path.join('/mock/home', 'Saved Games', 'DCS');
      const service = createService(dcsPath);

      const modulePath = path.join(dcsPath, 'Config', 'Input', 'FA-18C_hornet', 'joystick');

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        return String(p) === modulePath || String(p) === dcsPath;
      });

      (mockFs.readdirSync as any).mockReturnValue([
        '{ABCD1234-0000-0000-0000-000000000000}.diff.lua',
      ]);

      (mockFs.readFileSync as any).mockReturnValue('-- lua content');

      const result = service.getModuleBindings('FA-18C_hornet');

      expect(result).toHaveLength(1);
      expect(result[0].deviceGuid).toBe('{test-guid}');
      expect(result[0].module).toBe('FA-18C_hornet');
    });
  });

  // =========================================================================
  // getAvailableBackups
  // =========================================================================

  describe('getAvailableBackups', () => {
    it('returns list of backup directories', () => {
      const service = createService(null);

      const backupsDir = path.join('/mock/home', '.rigready', 'dcs-backups');

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        return String(p) === backupsDir;
      });

      (mockFs.readdirSync as any).mockReturnValue([
        makeDirent('my-backup-2024-01-01', true, backupsDir),
      ]);
      (mockFs.statSync as any).mockReturnValue({ mtimeMs: 1704067200000 });

      const result = service.getAvailableBackups();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('my-backup-2024-01-01');
      expect(result[0].timestamp).toBe(1704067200000);
      expect(result[0].path).toBe(path.join(backupsDir, 'my-backup-2024-01-01'));
    });

    it('returns empty when backup dir does not exist', () => {
      const service = createService(null);

      mockFs.existsSync.mockReturnValue(false);

      const result = service.getAvailableBackups();

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // deleteBackup
  // =========================================================================

  describe('deleteBackup', () => {
    it('removes directory and returns true', () => {
      const service = createService(null);
      const backupPath = '/mock/home/.rigready/dcs-backups/my-backup';

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        return String(p) === backupPath;
      });
      mockFs.rmSync.mockReturnValue(undefined);

      const result = service.deleteBackup(backupPath);

      expect(result).toBe(true);
      expect(mockFs.rmSync).toHaveBeenCalledWith(backupPath, { recursive: true });
    });
  });

  // =========================================================================
  // computeGuidMappings
  // =========================================================================

  describe('computeGuidMappings', () => {
    it('finds exact GUID matches', () => {
      const service = createService(null);

      const currentBindings: DCSDeviceBindings[] = [
        {
          deviceName: 'Throttle',
          deviceGuid: '{AAAA-1111}',
          filePath: '/current/path',
          module: 'FA-18C_hornet',
          axisBindings: [],
          keyBindings: [],
        },
      ];

      const backupBindings: DCSDeviceBindings[] = [
        {
          deviceName: 'Throttle',
          deviceGuid: '{AAAA-1111}',
          filePath: '/backup/path',
          module: 'FA-18C_hornet',
          axisBindings: [],
          keyBindings: [],
        },
      ];

      const result: DCSGuidMapping[] = service.computeGuidMappings(currentBindings, backupBindings);

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe('exact');
      expect(result[0].backupGuid).toBe('{AAAA-1111}');
      expect(result[0].currentGuid).toBe('{AAAA-1111}');
    });

    it('falls back to name match when GUIDs differ', () => {
      const service = createService(null);

      const currentBindings: DCSDeviceBindings[] = [
        {
          deviceName: 'Throttle',
          deviceGuid: '{NEW-GUID}',
          filePath: '/current/path',
          module: 'FA-18C_hornet',
          axisBindings: [],
          keyBindings: [],
        },
      ];

      const backupBindings: DCSDeviceBindings[] = [
        {
          deviceName: 'Throttle',
          deviceGuid: '{OLD-GUID}',
          filePath: '/backup/path',
          module: 'FA-18C_hornet',
          axisBindings: [],
          keyBindings: [],
        },
      ];

      const result = service.computeGuidMappings(currentBindings, backupBindings);

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe('name-match');
      expect(result[0].backupGuid).toBe('{OLD-GUID}');
      expect(result[0].currentGuid).toBe('{NEW-GUID}');
    });

    it('returns manual confidence when no match found', () => {
      const service = createService(null);

      const currentBindings: DCSDeviceBindings[] = [];

      const backupBindings: DCSDeviceBindings[] = [
        {
          deviceName: 'Old Device',
          deviceGuid: '{OLD-GUID}',
          filePath: '/backup/path',
          module: 'FA-18C_hornet',
          axisBindings: [],
          keyBindings: [],
        },
      ];

      const result = service.computeGuidMappings(currentBindings, backupBindings);

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe('manual');
      expect(result[0].currentGuid).toBe('');
    });
  });
});
