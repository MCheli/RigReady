import * as fs from 'fs';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Import the service after mocking
import { gameLaunchService } from '../../src/main/services/gameLaunchService';

describe('GameLaunchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectGames', () => {
    it('should detect DCS World when installed via Steam in default location', async () => {
      // Setup: Mock Steam library folders file exists and DCS exe exists
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // Steam libraryfolders.vdf exists
        if (pathStr.includes('libraryfolders.vdf')) return true;
        // Steam default path exists
        if (pathStr === 'C:\\Program Files (x86)\\Steam') return true;
        // DCS exe exists in Steam
        if (pathStr.includes('steamapps\\common\\DCSWorld\\bin\\DCS.exe')) return true;
        return false;
      });

      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const pathStr = p.toString();
        if (pathStr.includes('libraryfolders.vdf')) {
          return `
"libraryfolders"
{
  "0"
  {
    "path"    "C:\\\\Program Files (x86)\\\\Steam"
    "label"   ""
  }
}`;
        }
        if (pathStr.includes('game-profiles.json')) {
          return '[]';
        }
        return '';
      });

      const detected = await gameLaunchService.detectGames();

      expect(detected).toContainEqual({
        name: 'DCS World',
        path: expect.stringContaining('DCSWorld'),
      });
    });

    it('should detect DCS World when installed standalone', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // Standalone DCS exists
        if (pathStr === 'C:\\Program Files\\Eagle Dynamics\\DCS World\\bin\\DCS.exe') {
          return true;
        }
        return false;
      });

      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('game-profiles.json')) {
          return '[]';
        }
        return '';
      });

      const detected = await gameLaunchService.detectGames();

      expect(detected).toContainEqual({
        name: 'DCS World',
        path: 'C:\\Program Files\\Eagle Dynamics\\DCS World\\bin\\DCS.exe',
      });
    });

    it('should detect DCS in custom Steam library path', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr.includes('libraryfolders.vdf')) return true;
        if (pathStr === 'D:\\Games\\Steam') return true;
        if (pathStr === 'D:\\Games\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe') return true;
        return false;
      });

      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const pathStr = p.toString();
        if (pathStr.includes('libraryfolders.vdf')) {
          return `
"libraryfolders"
{
  "0"
  {
    "path"    "D:\\\\Games\\\\Steam"
    "label"   ""
  }
}`;
        }
        if (pathStr.includes('game-profiles.json')) {
          return '[]';
        }
        return '';
      });

      const detected = await gameLaunchService.detectGames();

      expect(detected).toContainEqual({
        name: 'DCS World',
        path: 'D:\\Games\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe',
      });
    });

    it('should return empty array when no games are found', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('game-profiles.json')) {
          return '[]';
        }
        return '';
      });

      const detected = await gameLaunchService.detectGames();

      expect(detected).toEqual([]);
    });

    it('should detect multiple games when installed', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // DCS standalone
        if (pathStr === 'C:\\Program Files\\Eagle Dynamics\\DCS World\\bin\\DCS.exe') return true;
        // X-Plane
        if (pathStr === 'C:\\X-Plane 12\\X-Plane.exe') return true;
        // iRacing
        if (pathStr === 'C:\\Program Files (x86)\\iRacing\\iRacingUI.exe') return true;
        return false;
      });

      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('game-profiles.json')) {
          return '[]';
        }
        return '';
      });

      const detected = await gameLaunchService.detectGames();

      expect(detected.length).toBe(3);
      expect(detected.map((g) => g.name)).toContain('DCS World');
      expect(detected.map((g) => g.name)).toContain('X-Plane 12');
      expect(detected.map((g) => g.name)).toContain('iRacing');
    });
  });
});
