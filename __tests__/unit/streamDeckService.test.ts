import * as fs from 'fs';
import * as path from 'path';

// Mock fs before anything else
jest.mock('fs');

const mockFs = fs as jest.Mocked<typeof fs>;

// Save original env
const originalEnv = { ...process.env };

// Set up env before importing the service (constructor reads process.env)
process.env.USERPROFILE = 'C:\\mock\\home';
process.env.APPDATA = 'C:\\mock\\home\\AppData\\Roaming';
process.env['ProgramFiles'] = 'C:\\mock\\ProgramFiles';
process.env['ProgramFiles(x86)'] = 'C:\\mock\\ProgramFiles86';
process.env.LOCALAPPDATA = 'C:\\mock\\home\\AppData\\Local';

// Constructor calls ensureBackupDir -> existsSync + mkdirSync
mockFs.existsSync.mockReturnValue(false);
mockFs.mkdirSync.mockReturnValue(undefined);

// Import after mocks are set up
import { streamDeckService } from '../../src/main/services/streamDeckService';

// Derive expected paths using path.join for platform-correct separators
const BACKUP_DIR = path.join('C:\\mock\\home', '.rigready', 'streamdeck-backups');

describe('StreamDeckService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USERPROFILE = 'C:\\mock\\home';
    process.env.APPDATA = 'C:\\mock\\home\\AppData\\Roaming';
    process.env['ProgramFiles'] = 'C:\\mock\\ProgramFiles';
    process.env['ProgramFiles(x86)'] = 'C:\\mock\\ProgramFiles86';
    process.env.LOCALAPPDATA = 'C:\\mock\\home\\AppData\\Local';
  });

  afterAll(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // detectInstallation
  // =========================================================================
  describe('detectInstallation', () => {
    it('should return installed=false when exe not found', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = streamDeckService.detectInstallation();

      expect(result.installed).toBe(false);
      expect(result.softwarePath).toBeUndefined();
    });

    it('should return installed=true with path when exe found', () => {
      const expectedExePath = path.join(
        'C:\\mock\\ProgramFiles',
        'Elgato',
        'StreamDeck',
        'StreamDeck.exe'
      );

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // StreamDeck.exe exists in ProgramFiles
        if (pathStr === expectedExePath) return true;
        // version.txt does not exist
        return false;
      });

      const result = streamDeckService.detectInstallation();

      expect(result.installed).toBe(true);
      expect(result.softwarePath).toBe(expectedExePath);
    });
  });

  // =========================================================================
  // getProfiles
  // =========================================================================
  describe('getProfiles', () => {
    it('should return empty array when no profiles path exists', () => {
      // Neither ProfilesV2 nor ProfilesV3 exist
      mockFs.existsSync.mockReturnValue(false);

      const result = streamDeckService.getProfiles();

      expect(result).toEqual([]);
    });

    it('should list .sdProfile directories', () => {
      const profilesV2Path = path.join(
        'C:\\mock\\home\\AppData\\Roaming',
        'Elgato',
        'StreamDeck',
        'ProfilesV2'
      );

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr === profilesV2Path) return true;
        // manifest.json does not exist
        return false;
      });

      const mockDirents = [
        {
          name: 'MyProfile.sdProfile',
          isDirectory: () => true,
          isFile: () => false,
        },
        {
          name: 'AnotherProfile.sdProfile',
          isDirectory: () => true,
          isFile: () => false,
        },
        {
          name: 'notaprofile.txt',
          isDirectory: () => false,
          isFile: () => true,
        },
      ] as unknown as fs.Dirent[];

      (mockFs.readdirSync as jest.Mock).mockReturnValue(mockDirents);
      (mockFs.statSync as jest.Mock).mockReturnValue({ mtimeMs: 1000 });

      const result = streamDeckService.getProfiles();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('MyProfile.sdProfile');
      expect(result[0].name).toBe('MyProfile');
      expect(result[0].deviceModel).toBe('Unknown');
      expect(result[1].id).toBe('AnotherProfile.sdProfile');
      expect(result[1].name).toBe('AnotherProfile');
    });
  });

  // =========================================================================
  // getBackups
  // =========================================================================
  describe('getBackups', () => {
    it('should return list of backup files', () => {
      // ensureBackupDir calls existsSync for BACKUP_DIR
      mockFs.existsSync.mockReturnValue(true);

      const backupFiles = [
        'my-backup-2024-01-15.streamDeckProfilesBackup',
        'another-backup-2024-02-20.streamDeckProfilesBackup',
        'unrelated-file.txt',
      ];

      (mockFs.readdirSync as jest.Mock).mockReturnValue(backupFiles);
      (mockFs.statSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes('my-backup')) {
          return { mtimeMs: 2000, size: 5000 };
        }
        return { mtimeMs: 3000, size: 8000 };
      });

      const result = streamDeckService.getBackups();

      expect(result).toHaveLength(2);
      // Sorted by timestamp descending, so "another-backup" (mtimeMs 3000) comes first
      expect(result[0].name).toBe('another-backup');
      expect(result[0].size).toBe(8000);
      expect(result[0].timestamp).toBe(3000);
      expect(result[1].name).toBe('my-backup');
      expect(result[1].size).toBe(5000);
      expect(result[1].timestamp).toBe(2000);
    });

    it('should return empty array when no backup files exist', () => {
      mockFs.existsSync.mockReturnValue(true);
      (mockFs.readdirSync as jest.Mock).mockReturnValue([]);

      const result = streamDeckService.getBackups();

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // deleteBackup
  // =========================================================================
  describe('deleteBackup', () => {
    it('should remove file and return true', () => {
      const backupPath = path.join(BACKUP_DIR, 'test.streamDeckProfilesBackup');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockReturnValue(undefined);

      const result = streamDeckService.deleteBackup(backupPath);

      expect(result).toBe(true);
      expect(mockFs.existsSync).toHaveBeenCalledWith(backupPath);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(backupPath);
    });

    it('should return false when file does not exist', () => {
      const backupPath = path.join(BACKUP_DIR, 'nonexistent.streamDeckProfilesBackup');
      mockFs.existsSync.mockReturnValue(false);

      const result = streamDeckService.deleteBackup(backupPath);

      expect(result).toBe(false);
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });
});
