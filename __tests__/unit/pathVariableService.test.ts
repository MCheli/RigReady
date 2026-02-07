import * as fs from 'fs';
import * as os from 'os';

// Mock modules before importing the service
jest.mock('fs');
jest.mock('os');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

// Set up os mocks before import
mockOs.homedir.mockReturnValue('C:\\Users\\TestUser');

// Now import the service (constructor runs resolveAll)
import { pathVariableService } from '../../src/main/services/pathVariableService';

describe('PathVariableService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.homedir.mockReturnValue('C:\\Users\\TestUser');
    process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming';
    process.env.LOCALAPPDATA = 'C:\\Users\\TestUser\\AppData\\Local';
    process.env['ProgramFiles'] = 'C:\\Program Files';
    process.env['ProgramFiles(x86)'] = 'C:\\Program Files (x86)';
  });

  describe('getVariables', () => {
    it('should return all expected variable names', () => {
      const vars = pathVariableService.getVariables();
      expect(vars).toHaveProperty('DCS_USER');
      expect(vars).toHaveProperty('DCS_INSTALL');
      expect(vars).toHaveProperty('APPDATA');
      expect(vars).toHaveProperty('LOCALAPPDATA');
      expect(vars).toHaveProperty('USERPROFILE');
      expect(vars).toHaveProperty('DOCUMENTS');
      expect(vars).toHaveProperty('SAVED_GAMES');
      expect(vars).toHaveProperty('STEAM');
      expect(vars).toHaveProperty('PROGRAM_FILES');
      expect(vars).toHaveProperty('PROGRAM_FILES_X86');
    });
  });

  describe('resolve', () => {
    it('should resolve USERPROFILE to home directory', () => {
      const result = pathVariableService.resolve('USERPROFILE');
      expect(result).toBe('C:\\Users\\TestUser');
    });
  });

  describe('expandPath', () => {
    it('should replace known variable tokens', () => {
      const result = pathVariableService.expandPath('{USERPROFILE}\\Documents');
      expect(result).toBe('C:\\Users\\TestUser\\Documents');
    });

    it('should preserve unknown variables as-is', () => {
      const result = pathVariableService.expandPath('{UNKNOWN_VAR}\\somepath');
      expect(result).toBe('{UNKNOWN_VAR}\\somepath');
    });
  });

  describe('tokenizePath', () => {
    it('should convert absolute path to tokenized form', () => {
      const result = pathVariableService.tokenizePath('C:\\Users\\TestUser\\Documents\\test.txt');
      // Should tokenize to the most specific match
      expect(result).toContain('{');
      expect(result).toContain('}');
      expect(result).toContain('test.txt');
    });

    it('should return original path when no match', () => {
      const result = pathVariableService.tokenizePath('Z:\\completely\\unknown\\path');
      expect(result).toBe('Z:\\completely\\unknown\\path');
    });
  });

  describe('refresh', () => {
    it('should update variables after environment changes', () => {
      pathVariableService.getVariables();
      pathVariableService.refresh();
      const varsAfter = pathVariableService.getVariables();
      // After refresh, USERPROFILE should still be present
      expect(varsAfter).toHaveProperty('USERPROFILE');
      expect(typeof varsAfter.USERPROFILE).toBe('string');
    });
  });

  describe('findSteamPath', () => {
    it('should return null when no Steam installed', () => {
      mockFs.existsSync.mockReturnValue(false);
      pathVariableService.refresh();
      const vars = pathVariableService.getVariables();
      expect(vars.STEAM).toBeNull();
    });
  });

  describe('findDCSSavedGames', () => {
    it('should return null when no DCS installed', () => {
      mockFs.existsSync.mockReturnValue(false);
      pathVariableService.refresh();
      const vars = pathVariableService.getVariables();
      expect(vars.DCS_USER).toBeNull();
    });
  });
});
