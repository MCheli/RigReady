import * as fs from 'fs';

// Mock modules before importing
jest.mock('fs');
jest.mock('../../src/main/services/profileService', () => ({
  profileService: {
    getAll: jest.fn().mockReturnValue([]),
    create: jest.fn().mockImplementation((data: Record<string, unknown>) => ({
      id: 'migrated-id',
      createdAt: Date.now(),
      lastUsed: Date.now(),
      ...data,
    })),
    save: jest.fn(),
  },
}));
jest.mock('../../src/main/services/settingsService', () => ({
  settingsService: {
    getSettings: jest.fn().mockReturnValue({}),
    updateSettings: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;

import { migrationService } from '../../src/main/services/migrationService';
import { profileService } from '../../src/main/services/profileService';
import { settingsService } from '../../src/main/services/settingsService';

const mockProfileService = profileService as jest.Mocked<typeof profileService>;
const mockSettingsService = settingsService as jest.Mocked<typeof settingsService>;

describe('MigrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettingsService.getSettings.mockReturnValue({
      version: 1,
      simulatorPaths: [],
      autoScanOnStartup: true,
      theme: 'dark',
      minimizeToTray: false,
      startWithWindows: false,
      checkForUpdates: false,
    });
    mockProfileService.getAll.mockReturnValue([]);
    mockFs.existsSync.mockReturnValue(false);
  });

  describe('migrateIfNeeded', () => {
    it('should skip when version >= MIGRATION_VERSION', () => {
      mockSettingsService.getSettings.mockReturnValue({
        version: 1,
        simulatorPaths: [],
        autoScanOnStartup: true,
        theme: 'dark',
        minimizeToTray: false,
        startWithWindows: false,
        checkForUpdates: false,
        profileMigrationVersion: 1,
      } as never);

      migrationService.migrateIfNeeded();
      expect(mockProfileService.create).not.toHaveBeenCalled();
    });

    it('should migrate game profiles from game-profiles.json', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        if (p.toString().includes('game-profiles.json')) return true;
        return false;
      });

      const gameProfiles = [
        {
          name: 'DCS Profile',
          executablePath: 'C:\\DCS World\\bin\\DCS.exe',
          arguments: [],
          workingDirectory: 'C:\\DCS World',
          preLaunchProcesses: ['TrackIR5.exe'],
          autoStartProcesses: [
            {
              name: 'SimAppPro',
              executablePath: 'C:\\SimAppPro\\SimAppPro.exe',
              arguments: [],
              waitSeconds: 5,
            },
          ],
        },
      ];

      mockFs.readFileSync.mockReturnValue(JSON.stringify(gameProfiles));

      migrationService.migrateIfNeeded();
      expect(mockProfileService.create).toHaveBeenCalled();
      expect(mockSettingsService.updateSettings).toHaveBeenCalled();
    });

    it('should skip profiles that already exist by name', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        if (p.toString().includes('game-profiles.json')) return true;
        return false;
      });

      const gameProfiles = [
        {
          name: 'Existing Profile',
          executablePath: 'C:\\test.exe',
          arguments: [],
          workingDirectory: '',
          preLaunchProcesses: [],
          autoStartProcesses: [],
        },
      ];

      mockFs.readFileSync.mockReturnValue(JSON.stringify(gameProfiles));
      mockProfileService.getAll.mockReturnValue([
        {
          id: 'existing-id',
          name: 'Existing Profile',
          game: 'dcs',
          createdAt: 0,
          lastUsed: 0,
          checklistItems: [],
          trackedConfigurations: [],
        },
      ]);

      migrationService.migrateIfNeeded();
      expect(mockProfileService.create).not.toHaveBeenCalled();
    });

    it('should convert preLaunchProcesses to checklist items', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        if (p.toString().includes('game-profiles.json')) return true;
        return false;
      });

      const gameProfiles = [
        {
          name: 'Test Profile',
          executablePath: 'C:\\test.exe',
          arguments: [],
          workingDirectory: '',
          preLaunchProcesses: ['TrackIR5.exe', 'opentrack.exe'],
          autoStartProcesses: [],
        },
      ];

      mockFs.readFileSync.mockReturnValue(JSON.stringify(gameProfiles));

      migrationService.migrateIfNeeded();

      const createCall = mockProfileService.create.mock.calls[0][0];
      expect(createCall.checklistItems).toHaveLength(2);
      expect(createCall.checklistItems[0].type).toBe('process');
      expect((createCall.checklistItems[0].config as { processName: string }).processName).toBe(
        'TrackIR5.exe'
      );
    });

    it('should convert autoStartProcesses with remediations', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        if (p.toString().includes('game-profiles.json')) return true;
        return false;
      });

      const gameProfiles = [
        {
          name: 'Auto Start Test',
          executablePath: 'C:\\test.exe',
          arguments: [],
          workingDirectory: '',
          preLaunchProcesses: [],
          autoStartProcesses: [
            {
              name: 'SimAppPro',
              executablePath: 'C:\\SimAppPro\\SimAppPro.exe',
              arguments: ['--silent'],
              waitSeconds: 3,
            },
          ],
        },
      ];

      mockFs.readFileSync.mockReturnValue(JSON.stringify(gameProfiles));

      migrationService.migrateIfNeeded();

      const createCall = mockProfileService.create.mock.calls[0][0];
      const autoItem = createCall.checklistItems[0];
      expect(autoItem.remediation).toBeDefined();
      expect(autoItem.remediation?.type).toBe('launchProcess');
      expect(
        (autoItem.remediation as { config: { executablePath: string } }).config.executablePath
      ).toBe('C:\\SimAppPro\\SimAppPro.exe');
    });
  });

  describe('guessSimulator', () => {
    // Access private method via prototype
    const guessSimulator = (
      (migrationService as unknown as { constructor: { prototype: unknown } }).constructor
        .prototype as unknown as { guessSimulator: (exe: string, name: string) => string }
    ).guessSimulator;

    it('should detect DCS', () => {
      expect(guessSimulator.call(migrationService, 'C:\\DCS World\\DCS.exe', '')).toBe('dcs');
    });

    it('should detect MSFS', () => {
      expect(guessSimulator.call(migrationService, 'C:\\FlightSimulator\\msfs.exe', '')).toBe(
        'msfs'
      );
    });

    it('should detect X-Plane', () => {
      expect(guessSimulator.call(migrationService, 'C:\\X-Plane 12\\X-Plane.exe', '')).toBe(
        'xplane'
      );
    });

    it('should detect iRacing', () => {
      expect(guessSimulator.call(migrationService, 'C:\\iRacing\\iRacingSim64DX11.exe', '')).toBe(
        'iracing'
      );
    });

    it('should detect ACC', () => {
      expect(guessSimulator.call(migrationService, '', 'Assetto Corsa Competizione')).toBe('acc');
    });

    it('should detect BeamNG', () => {
      expect(guessSimulator.call(migrationService, 'C:\\BeamNG.drive\\BeamNG.exe', '')).toBe(
        'beamng'
      );
    });

    it('should detect LMU', () => {
      expect(guessSimulator.call(migrationService, '', 'Le Mans Ultimate')).toBe('lmu');
    });

    it('should return other for unknown', () => {
      expect(guessSimulator.call(migrationService, 'C:\\unknown\\game.exe', 'Unknown Game')).toBe(
        'other'
      );
    });
  });

  describe('migratePreflightConfig', () => {
    it('should create "Migrated Pre-Flight Checks" when no profiles exist', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        if (p.toString().includes('preflight-config.json')) return true;
        return false;
      });

      const preflightConfig = {
        checks: [
          {
            id: 'check1',
            type: 'process',
            name: 'TrackIR Check',
            enabled: true,
            config: { processName: 'TrackIR5.exe' },
          },
        ],
      };

      mockFs.readFileSync.mockReturnValue(JSON.stringify(preflightConfig));
      mockProfileService.getAll.mockReturnValue([]);

      migrationService.migrateIfNeeded();

      const createCall = mockProfileService.create.mock.calls[0][0];
      expect(createCall.name).toBe('Migrated Pre-Flight Checks');
    });

    it('should attach checks to first profile when profiles exist', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        if (p.toString().includes('preflight-config.json')) return true;
        return false;
      });

      const preflightConfig = {
        checks: [
          {
            id: 'check1',
            type: 'process',
            name: 'TrackIR Check',
            enabled: true,
            config: { processName: 'TrackIR5.exe' },
          },
        ],
      };

      mockFs.readFileSync.mockReturnValue(JSON.stringify(preflightConfig));
      const existingProfile = {
        id: 'existing-id',
        name: 'Existing',
        game: 'dcs' as const,
        createdAt: 0,
        lastUsed: 0,
        checklistItems: [],
        trackedConfigurations: [],
      };
      mockProfileService.getAll.mockReturnValue([existingProfile]);

      migrationService.migrateIfNeeded();

      expect(mockProfileService.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'existing-id' })
      );
    });
  });

  describe('error handling', () => {
    it('should handle missing JSON files gracefully', () => {
      mockFs.existsSync.mockReturnValue(false);

      // Should not throw
      expect(() => migrationService.migrateIfNeeded()).not.toThrow();
    });
  });
});
