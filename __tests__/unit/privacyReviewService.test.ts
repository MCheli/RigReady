import * as os from 'os';

// Mock modules before importing
jest.mock('os');
jest.mock('../../src/main/services/profileService', () => ({
  profileService: {
    getById: jest.fn(),
  },
}));

const mockOs = os as jest.Mocked<typeof os>;

// Set up os mocks before import
mockOs.userInfo.mockReturnValue({
  username: 'TestUser',
  uid: -1,
  gid: -1,
  shell: null,
  homedir: 'C:\\Users\\TestUser',
});
mockOs.hostname.mockReturnValue('TEST-PC');
mockOs.homedir.mockReturnValue('C:\\Users\\TestUser');

import { privacyReviewService } from '../../src/main/services/privacyReviewService';
import { profileService } from '../../src/main/services/profileService';

const mockProfileService = profileService as jest.Mocked<typeof profileService>;

describe('PrivacyReviewService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return hasIssues: false when profile not found', () => {
    mockProfileService.getById.mockReturnValue(undefined);

    const result = privacyReviewService.reviewProfile('nonexistent');
    expect(result.hasIssues).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it('should detect username in executablePath', () => {
    mockProfileService.getById.mockReturnValue({
      id: 'test',
      name: 'Test',
      game: 'dcs',
      createdAt: 0,
      lastUsed: 0,
      checklistItems: [],
      trackedConfigurations: [],
      launchTarget: {
        executablePath: 'C:\\Users\\TestUser\\DCS\\DCS.exe',
        arguments: [],
        preScripts: [],
        postScripts: [],
      },
    });

    const result = privacyReviewService.reviewProfile('test');
    expect(result.hasIssues).toBe(true);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('should detect hostname in paths', () => {
    mockProfileService.getById.mockReturnValue({
      id: 'test',
      name: 'Test',
      game: 'dcs',
      createdAt: 0,
      lastUsed: 0,
      checklistItems: [],
      trackedConfigurations: [],
      launchTarget: {
        executablePath: 'C:\\TEST-PC\\share\\DCS.exe',
        arguments: [],
        preScripts: [],
        postScripts: [],
      },
    });

    const result = privacyReviewService.reviewProfile('test');
    expect(result.hasIssues).toBe(true);
  });

  it('should detect Windows user path pattern', () => {
    mockProfileService.getById.mockReturnValue({
      id: 'test',
      name: 'Test',
      game: 'dcs',
      createdAt: 0,
      lastUsed: 0,
      checklistItems: [],
      trackedConfigurations: [],
      launchTarget: {
        executablePath: 'C:\\Users\\SomeOtherUser\\DCS\\DCS.exe',
        arguments: [],
        preScripts: [],
        postScripts: [],
      },
    });

    const result = privacyReviewService.reviewProfile('test');
    expect(result.hasIssues).toBe(true);
    expect(result.findings.some((f) => f.description.includes('Windows user path'))).toBe(true);
  });

  it('should detect home directory in tracked configurations', () => {
    mockProfileService.getById.mockReturnValue({
      id: 'test',
      name: 'Test',
      game: 'dcs',
      createdAt: 0,
      lastUsed: 0,
      checklistItems: [],
      trackedConfigurations: [
        {
          name: 'DCS Config',
          path: 'C:\\Users\\TestUser\\Saved Games\\DCS\\Config\\test.lua',
        },
      ],
    });

    const result = privacyReviewService.reviewProfile('test');
    expect(result.hasIssues).toBe(true);
  });

  it('should return no issues for clean paths with variables', () => {
    mockProfileService.getById.mockReturnValue({
      id: 'test',
      name: 'Test',
      game: 'dcs',
      createdAt: 0,
      lastUsed: 0,
      checklistItems: [],
      trackedConfigurations: [
        {
          name: 'DCS Config',
          path: '{DCS_USER}\\Config\\test.lua',
        },
      ],
      launchTarget: {
        executablePath: '{PROGRAM_FILES}\\Eagle Dynamics\\DCS World\\bin\\DCS.exe',
        arguments: [],
        preScripts: [],
        postScripts: [],
      },
    });

    const result = privacyReviewService.reviewProfile('test');
    expect(result.hasIssues).toBe(false);
  });

  it('should check checklist item config filePaths', () => {
    mockProfileService.getById.mockReturnValue({
      id: 'test',
      name: 'Test',
      game: 'dcs',
      createdAt: 0,
      lastUsed: 0,
      checklistItems: [
        {
          id: 'cfg1',
          type: 'config',
          name: 'Config Check',
          isRequired: true,
          category: 'configuration',
          config: {
            filePath: 'C:\\Users\\TestUser\\AppData\\config.cfg',
          },
        },
      ],
      trackedConfigurations: [],
    });

    const result = privacyReviewService.reviewProfile('test');
    expect(result.hasIssues).toBe(true);
  });

  it('should check remediation executable paths', () => {
    mockProfileService.getById.mockReturnValue({
      id: 'test',
      name: 'Test',
      game: 'dcs',
      createdAt: 0,
      lastUsed: 0,
      checklistItems: [
        {
          id: 'proc1',
          type: 'process',
          name: 'Process Check',
          isRequired: true,
          category: 'software',
          config: { processName: 'test.exe' },
          remediation: {
            type: 'launchProcess',
            config: {
              executablePath: 'C:\\Users\\TestUser\\Apps\\test.exe',
            },
          },
        },
      ],
      trackedConfigurations: [],
    });

    const result = privacyReviewService.reviewProfile('test');
    expect(result.hasIssues).toBe(true);
  });
});
