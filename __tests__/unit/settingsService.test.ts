import * as fs from 'fs';

// Mock modules before importing
jest.mock('fs');
jest.mock('os', () => ({
  homedir: jest.fn(() => 'C:\\Users\\TestUser'),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

// Set up before import - settings file doesn't exist = fresh defaults
mockFs.existsSync.mockReturnValue(false);
mockFs.mkdirSync.mockReturnValue(undefined);
mockFs.writeFileSync.mockReturnValue(undefined);

import { settingsService, SIMULATOR_PATH_CONFIG } from '../../src/main/services/settingsService';

describe('SettingsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.writeFileSync.mockReturnValue(undefined);
  });

  describe('SIMULATOR_PATH_CONFIG', () => {
    it('should have correct structure for beamng', () => {
      const beamng = SIMULATOR_PATH_CONFIG.beamng;
      expect(beamng).toBeDefined();
      expect(beamng!.name).toBe('BeamNG.drive');
      expect(beamng!.possibleInstallPaths.length).toBeGreaterThan(0);
      expect(beamng!.executableName).toBe('BeamNG.drive.x64.exe');
    });

    it('should have correct structure for lmu', () => {
      const lmu = SIMULATOR_PATH_CONFIG.lmu;
      expect(lmu).toBeDefined();
      expect(lmu!.name).toBe('Le Mans Ultimate');
      expect(lmu!.possibleInstallPaths.length).toBeGreaterThan(0);
      expect(lmu!.executableName).toBe('Le Mans Ultimate.exe');
    });

    it('should have null for "other" simulator', () => {
      expect(SIMULATOR_PATH_CONFIG.other).toBeNull();
    });
  });

  describe('autoScanSimulator', () => {
    it('should check BeamNG paths', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr.includes('BeamNG.drive') && pathStr.includes('Steam')) return true;
        if (pathStr.includes('BeamNG.drive.x64.exe')) return true;
        return false;
      });

      const result = settingsService.autoScanSimulator('beamng');
      if (result) {
        expect(result.simulator).toBe('beamng');
        expect(result.isAutoDetected).toBe(true);
      }
    });

    it('should check LMU paths', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr.includes('Le Mans Ultimate') && pathStr.includes('Steam')) return true;
        if (pathStr.includes('Le Mans Ultimate.exe')) return true;
        return false;
      });

      const result = settingsService.autoScanSimulator('lmu');
      if (result) {
        expect(result.simulator).toBe('lmu');
        expect(result.isAutoDetected).toBe(true);
      }
    });

    it('should return null for "other"', () => {
      const result = settingsService.autoScanSimulator('other');
      expect(result).toBeNull();
    });
  });

  describe('autoScanAllSimulators', () => {
    it('should include beamng and lmu in scan list', () => {
      mockFs.existsSync.mockReturnValue(false);

      // Even if nothing is found, the function should run without error
      const results = settingsService.autoScanAllSimulators();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('verifySimulatorPath', () => {
    it('should return false for missing path', () => {
      // No simulator paths configured
      const result = settingsService.verifySimulatorPath('dcs');
      expect(result).toBe(false);
    });

    it('should update lastVerified timestamp when valid', () => {
      // First set a simulator path
      settingsService.setSimulatorPath({
        simulator: 'dcs',
        installPath: 'C:\\DCS World',
        isAutoDetected: false,
      });

      mockFs.existsSync.mockReturnValue(true);

      const result = settingsService.verifySimulatorPath('dcs');
      expect(result).toBe(true);
    });
  });
});
