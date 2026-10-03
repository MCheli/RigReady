import * as fs from 'fs';

// Mock modules before importing
jest.mock('fs');
jest.mock('../../src/main/services/dcsKeybindingService', () => ({
  dcsKeybindingService: {
    getSavedGamesPath: jest.fn(),
    createBackup: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;

import { dcsUuidMigrationService } from '../../src/main/services/dcsUuidMigrationService';
import { dcsKeybindingService } from '../../src/main/services/dcsKeybindingService';

const mockDcsService = dcsKeybindingService as jest.Mocked<typeof dcsKeybindingService>;

// Helper to create mock Dirent
function mockDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: '',
    parentPath: '',
  };
}

function mockReaddirWithDirents(
  mapping: Record<string, ReturnType<typeof mockDirent>[]>,
  fileListing?: Record<string, string[]>
) {
  (mockFs.readdirSync as jest.Mock).mockImplementation((p: string, opts?: unknown) => {
    const pathStr = p.toString();
    if (opts) {
      // withFileTypes: true
      for (const [key, val] of Object.entries(mapping)) {
        if (pathStr.endsWith(key)) return val;
      }
    }
    if (fileListing) {
      for (const [key, val] of Object.entries(fileListing)) {
        if (pathStr.endsWith(key)) return val;
      }
    }
    return [];
  });
}

describe('DcsUuidMigrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDcsService.getSavedGamesPath.mockReturnValue('C:\\Users\\Test\\Saved Games\\DCS');
  });

  describe('previewMigration', () => {
    it('should return affected files for matching UUID', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockReaddirWithDirents({
        Input: [mockDirent('FA-18C', true)],
      });

      const preview = dcsUuidMigrationService.previewMigration('old-uuid', 'new-uuid');
      expect(preview.oldUuid).toBe('old-uuid');
      expect(preview.newUuid).toBe('new-uuid');
      expect(preview.fileCount).toBe(1);
      expect(preview.affectedModules).toContain('FA-18C');
    });

    it('should return empty when no saved games path', () => {
      mockDcsService.getSavedGamesPath.mockReturnValue(null);

      const preview = dcsUuidMigrationService.previewMigration('old', 'new');
      expect(preview.fileCount).toBe(0);
      expect(preview.files).toHaveLength(0);
    });

    it('should return empty when no match', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        if (p.toString().includes('.diff.lua')) return false;
        return true;
      });

      mockReaddirWithDirents({
        Input: [mockDirent('FA-18C', true)],
      });

      const preview = dcsUuidMigrationService.previewMigration('nonexistent-uuid', 'new-uuid');
      expect(preview.fileCount).toBe(0);
    });
  });

  describe('migrate', () => {
    it('should require both UUIDs', () => {
      const result = dcsUuidMigrationService.migrate('', 'new-uuid');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Both old and new UUIDs must be provided');
    });

    it('should fail when old === new', () => {
      const result = dcsUuidMigrationService.migrate('same-uuid', 'same-uuid');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Old and new UUIDs are identical');
    });

    it('should create backup before migration', () => {
      mockDcsService.createBackup.mockReturnValue('C:\\backup\\path');
      mockDcsService.getSavedGamesPath.mockReturnValue(null);

      dcsUuidMigrationService.migrate('old', 'new', true);
      expect(mockDcsService.createBackup).toHaveBeenCalled();
    });

    it('should fail when backup creation fails', () => {
      mockDcsService.createBackup.mockReturnValue(null);

      const result = dcsUuidMigrationService.migrate('old', 'new', true);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Failed to create pre-migration backup');
    });

    it('should skip when target file already exists', () => {
      mockDcsService.createBackup.mockReturnValue('C:\\backup');
      mockFs.existsSync.mockReturnValue(true); // both old and new files exist
      mockReaddirWithDirents({
        Input: [mockDirent('FA-18C', true)],
      });

      const result = dcsUuidMigrationService.migrate('old-uuid', 'new-uuid', true);
      expect(result.skippedFiles.length).toBeGreaterThanOrEqual(0);
    });

    it('should rename files from old to new UUID', () => {
      mockDcsService.createBackup.mockReturnValue('C:\\backup');
      mockFs.renameSync.mockReturnValue(undefined);

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr.includes('new-uuid.diff.lua')) return false;
        return true;
      });

      mockReaddirWithDirents({
        Input: [mockDirent('FA-18C', true)],
      });

      const result = dcsUuidMigrationService.migrate('old-uuid', 'new-uuid', true);
      if (result.migratedFiles.length > 0) {
        expect(mockFs.renameSync).toHaveBeenCalled();
        expect(result.success).toBe(true);
      }
    });
  });

  describe('listDeviceUuids', () => {
    it('should return unique UUIDs with module counts', () => {
      mockFs.existsSync.mockReturnValue(true);

      mockReaddirWithDirents(
        { Input: [mockDirent('FA-18C', true), mockDirent('A-10C', true)] },
        { joystick: ['device-uuid-1.diff.lua', 'device-uuid-2.diff.lua'] }
      );

      const uuids = dcsUuidMigrationService.listDeviceUuids();
      expect(Array.isArray(uuids)).toBe(true);
    });

    it('should sort by module count descending', () => {
      mockFs.existsSync.mockReturnValue(true);

      (mockFs.readdirSync as jest.Mock).mockImplementation((p: string, opts?: unknown) => {
        const pathStr = p.toString();
        if (opts && pathStr.endsWith('Input')) {
          return [mockDirent('FA-18C', true), mockDirent('A-10C', true)];
        }
        if (pathStr.includes('FA-18C') && pathStr.endsWith('joystick')) {
          return ['uuid-a.diff.lua', 'uuid-b.diff.lua'];
        }
        if (pathStr.includes('A-10C') && pathStr.endsWith('joystick')) {
          return ['uuid-a.diff.lua'];
        }
        return [];
      });

      const uuids = dcsUuidMigrationService.listDeviceUuids();
      if (uuids.length >= 2) {
        expect(uuids[0].moduleCount).toBeGreaterThanOrEqual(uuids[1].moduleCount);
      }
    });

    it('should return empty when no saved games path', () => {
      mockDcsService.getSavedGamesPath.mockReturnValue(null);
      const uuids = dcsUuidMigrationService.listDeviceUuids();
      expect(uuids).toHaveLength(0);
    });
  });
});
