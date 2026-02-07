import * as fs from 'fs';
import {
  detectSimulatorInstallation,
  detectAllSimulators,
  scanSimulator,
  simulatorConfigService,
} from '../../src/main/services/simulatorConfigService';

jest.mock('fs');
jest.mock('os', () => ({
  homedir: jest.fn(() => '/mock/home'),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

beforeEach(() => {
  jest.clearAllMocks();
  simulatorConfigService.clearCache();
  mockFs.existsSync.mockReturnValue(false);
});

describe('detectSimulatorInstallation', () => {
  it('returns installed=false for simulator with null paths (iracing)', () => {
    const result = detectSimulatorInstallation('iracing');

    expect(result.simulator).toBe('iracing');
    expect(result.name).toBe('iRacing');
    expect(result.installed).toBe(false);
    expect(result.installPath).toBeUndefined();
    expect(result.configPath).toBeUndefined();
  });

  it('returns installed=true when install path exists', () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const pathStr = p.toString();
      if (pathStr.includes('SteamLibrary') || pathStr.includes('Steam')) return false;
      if (pathStr === 'C:\\Program Files\\Eagle Dynamics\\DCS World') return true;
      // Config path check - return false so configPath is undefined
      return false;
    });

    const result = detectSimulatorInstallation('dcs');

    expect(result.simulator).toBe('dcs');
    expect(result.installed).toBe(true);
    expect(result.installPath).toBe('C:\\Program Files\\Eagle Dynamics\\DCS World');
    // configPath should be undefined since the config directory doesn't exist
    expect(result.configPath).toBeUndefined();
  });

  it('returns installed=true when config path exists even without install path', () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const pathStr = p.toString();
      // No install paths exist
      if (
        pathStr.includes('Steam') ||
        pathStr.includes('SteamLibrary') ||
        pathStr.includes('Eagle Dynamics') ||
        pathStr.includes('DCS World')
      ) {
        // But allow the config path
        if (pathStr.includes('Saved Games')) {
          // DCS.openbeta config path exists
          if (pathStr.includes('DCS.openbeta')) return true;
          return false;
        }
        return false;
      }
      // DCS config path in Saved Games
      if (pathStr.includes('Saved Games') && pathStr.includes('DCS.openbeta')) return true;
      return false;
    });

    const result = detectSimulatorInstallation('dcs');

    expect(result.simulator).toBe('dcs');
    expect(result.installed).toBe(true);
    expect(result.installPath).toBeUndefined();
    expect(result.configPath).toBeDefined();
  });
});

describe('detectAllSimulators', () => {
  it('returns list of 6 simulators', () => {
    const results = detectAllSimulators();

    expect(results).toHaveLength(6);
    const simulatorIds = results.map((r) => r.simulator);
    expect(simulatorIds).toEqual(['dcs', 'msfs', 'xplane', 'il2', 'beamng', 'lmu']);
  });
});

describe('SimulatorConfigService', () => {
  it('scanSimulator returns cached result on second call', () => {
    // First call
    const result1 = simulatorConfigService.scanSimulator('iracing');
    // Second call - should use cache
    const result2 = simulatorConfigService.scanSimulator('iracing');

    expect(result1).toBe(result2); // Same reference = cached
    expect(result1.simulator).toBe('iracing');
    expect(result1.installation.installed).toBe(false);
  });

  it('scanSimulator refreshes when forceRefresh is true', () => {
    // First call - cache the result
    const result1 = simulatorConfigService.scanSimulator('iracing');
    // Second call with forceRefresh - should create a new result
    const result2 = simulatorConfigService.scanSimulator('iracing', true);

    // Both should have the same data but be different object references
    expect(result1).not.toBe(result2);
    expect(result2.simulator).toBe('iracing');
    expect(result2.installation.installed).toBe(false);
  });

  it('clearCache resets the cache', () => {
    // Populate cache
    const result1 = simulatorConfigService.scanSimulator('iracing');
    // Clear cache
    simulatorConfigService.clearCache();
    // Next call should create a new result (different object reference)
    const result2 = simulatorConfigService.scanSimulator('iracing');

    expect(result1).not.toBe(result2);
    expect(result2.simulator).toBe('iracing');
  });
});

describe('scanSimulator', () => {
  it('returns empty vehicles when config path not found', () => {
    // All fs.existsSync calls return false (default from beforeEach)
    const result = scanSimulator('dcs');

    expect(result.simulator).toBe('dcs');
    expect(result.vehicles).toEqual([]);
    expect(result.installation.installed).toBe(false);
    expect(result.errors).toEqual([]);
  });
});
