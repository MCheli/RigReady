import * as fs from 'fs';

// Mock modules before importing
jest.mock('fs');
jest.mock('os', () => ({
  homedir: jest.fn(() => 'C:\\Users\\TestUser'),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

import { beamngIntegration } from '../../src/main/services/beamngIntegration';

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

describe('BeamNGIntegrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detect', () => {
    it('should find BeamNG in Steam common path', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr.includes('Steam\\steamapps\\common\\BeamNG.drive')) return true;
        if (pathStr.includes('BeamNG.drive') && !pathStr.includes('Steam')) return true;
        return false;
      });

      (mockFs.readdirSync as jest.Mock).mockReturnValue([mockDirent('0.31', true)]);

      const result = beamngIntegration.detect();
      expect(result.installed).toBe(true);
      expect(result.installPath).toBeDefined();
    });

    it('should return not installed when not found', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = beamngIntegration.detect();
      expect(result.installed).toBe(false);
      expect(result.installPath).toBeUndefined();
    });
  });

  describe('getInputSettingsPath', () => {
    it('should return correct versioned path', () => {
      mockFs.existsSync.mockReturnValue(true);
      (mockFs.readdirSync as jest.Mock).mockReturnValue([mockDirent('0.31', true)]);

      const result = beamngIntegration.getInputSettingsPath('0.31');
      expect(result).toContain('0.31');
      expect(result).toContain('inputmaps');
    });

    it('should return null when config base does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = beamngIntegration.getInputSettingsPath('0.31');
      expect(result).toBeNull();
    });
  });

  describe('backupInputConfigs', () => {
    it('should copy files to backup dir', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.mkdirSync.mockReturnValue(undefined);
      (mockFs.readdirSync as jest.Mock).mockImplementation((p: string, opts?: unknown) => {
        if (opts) {
          return [mockDirent('config.json', false)];
        }
        return [mockDirent('config.json', false)];
      });
      mockFs.copyFileSync.mockReturnValue(undefined);

      const result = beamngIntegration.backupInputConfigs('test-backup', '0.31');
      expect(result).toBeDefined();
      expect(result).toContain('beamng-backups');
    });
  });

  describe('restoreInputConfigs', () => {
    it('should copy from backup to config dir', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.mkdirSync.mockReturnValue(undefined);
      // readdirSync with withFileTypes returns Dirents, without returns strings
      // copyDirectory calls readdirSync(src, { withFileTypes: true })
      // getInputSettingsPath calls detect() which calls readdirSync with withFileTypes
      (mockFs.readdirSync as jest.Mock).mockImplementation((p: string, opts?: unknown) => {
        const pathStr = p.toString();
        if (
          opts &&
          pathStr.includes('BeamNG.drive') &&
          !pathStr.includes('inputmaps') &&
          !pathStr.includes('backup')
        ) {
          // detect() version listing
          return [mockDirent('0.31', true)];
        }
        if (opts) {
          // copyDirectory calls - return only files to avoid infinite recursion
          return [mockDirent('inputmap.json', false)];
        }
        return [];
      });
      mockFs.copyFileSync.mockReturnValue(undefined);

      const result = beamngIntegration.restoreInputConfigs('C:\\backup\\dir', '0.31');
      expect(result).toBe(true);
    });

    it('should return false when backup path does not exist', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr.includes('backup')) return false;
        return true;
      });

      const result = beamngIntegration.restoreInputConfigs('C:\\nonexistent\\backup', '0.31');
      expect(result).toBe(false);
    });
  });
});
