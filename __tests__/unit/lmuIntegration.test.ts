import * as fs from 'fs';

// Mock modules before importing
jest.mock('fs');
jest.mock('os', () => ({
  homedir: jest.fn(() => 'C:\\Users\\TestUser'),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

import { lmuIntegration } from '../../src/main/services/lmuIntegration';

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

describe('LMUIntegrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detect', () => {
    it('should find LMU in Steam common path', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr.includes('Steam\\steamapps\\common\\Le Mans Ultimate')) return true;
        if (pathStr.includes('Documents\\Le Mans Ultimate')) return true;
        return false;
      });

      const result = lmuIntegration.detect();
      expect(result.installed).toBe(true);
      expect(result.installPath).toBeDefined();
    });

    it('should return not installed when not found', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = lmuIntegration.detect();
      expect(result.installed).toBe(false);
      expect(result.installPath).toBeUndefined();
    });
  });

  describe('getControllerConfigPath', () => {
    it('should return correct path when it exists', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        if (p.toString().includes('UserData\\Controller')) return true;
        return false;
      });

      const result = lmuIntegration.getControllerConfigPath();
      expect(result).toContain('UserData');
      expect(result).toContain('Controller');
    });

    it('should return null when controller path does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = lmuIntegration.getControllerConfigPath();
      expect(result).toBeNull();
    });
  });

  describe('getPlayerConfigPath', () => {
    it('should return correct path when it exists', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        if (p.toString().includes('player.JSON')) return true;
        return false;
      });

      const result = lmuIntegration.getPlayerConfigPath();
      expect(result).toContain('player.JSON');
    });

    it('should return null when player config does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = lmuIntegration.getPlayerConfigPath();
      expect(result).toBeNull();
    });
  });

  describe('backupControllerConfigs', () => {
    it('should copy files to backup dir', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.mkdirSync.mockReturnValue(undefined);
      (mockFs.readdirSync as jest.Mock).mockImplementation((_p: string, opts?: unknown) => {
        if (opts) {
          return [mockDirent('controller.json', false)];
        }
        return [mockDirent('controller.json', false)];
      });
      mockFs.copyFileSync.mockReturnValue(undefined);

      const result = lmuIntegration.backupControllerConfigs('test-backup');
      expect(result).toBeDefined();
      expect(result).toContain('lmu-backups');
    });

    it('should return null when no controller config path', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = lmuIntegration.backupControllerConfigs('test-backup');
      expect(result).toBeNull();
    });
  });

  describe('restoreControllerConfigs', () => {
    it('should copy files from backup', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.mkdirSync.mockReturnValue(undefined);
      (mockFs.readdirSync as jest.Mock).mockImplementation((_p: string, opts?: unknown) => {
        if (opts) {
          return [mockDirent('controller.json', false)];
        }
        return [mockDirent('controller.json', false)];
      });
      mockFs.copyFileSync.mockReturnValue(undefined);

      const result = lmuIntegration.restoreControllerConfigs('C:\\backup\\path');
      expect(result).toBe(true);
    });

    it('should return false when backup path does not exist', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr.includes('backup')) return false;
        return true;
      });

      const result = lmuIntegration.restoreControllerConfigs('C:\\nonexistent\\backup');
      expect(result).toBe(false);
    });
  });
});
