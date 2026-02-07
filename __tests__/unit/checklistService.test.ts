import * as fs from 'fs';

// Mock modules before importing the service
jest.mock('fs');
jest.mock('./../../src/main/services/processService', () => ({
  processService: {
    isProcessRunning: jest.fn(),
    launchProcess: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;

import { checklistService } from '../../src/main/services/checklistService';
import { processService } from '../../src/main/services/processService';
import type { Profile, ChecklistItem, Remediation } from '../../src/shared/profileTypes';

const mockProcessService = processService as jest.Mocked<typeof processService>;

function makeProfile(items: ChecklistItem[]): Profile {
  return {
    id: 'test-profile',
    name: 'Test Profile',
    game: 'dcs',
    createdAt: Date.now(),
    lastUsed: Date.now(),
    checklistItems: items,
    trackedConfigurations: [],
  };
}

describe('ChecklistService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('runChecklist', () => {
    it('should return pass when all items pass', async () => {
      mockProcessService.isProcessRunning.mockResolvedValue({
        processName: 'test.exe',
        displayName: 'Test',
        running: true,
        pid: 1234,
      });

      const profile = makeProfile([
        {
          id: 'proc1',
          type: 'process',
          name: 'Test Process',
          isRequired: true,
          category: 'software',
          config: { processName: 'test.exe' },
        },
      ]);

      const result = await checklistService.runChecklist(profile);
      expect(result.overallStatus).toBe('pass');
      expect(result.allRequiredPassed).toBe(true);
    });

    it('should return fail when required item fails', async () => {
      mockProcessService.isProcessRunning.mockResolvedValue({
        processName: 'test.exe',
        displayName: 'Test',
        running: false,
      });

      const profile = makeProfile([
        {
          id: 'proc1',
          type: 'process',
          name: 'Required Process',
          isRequired: true,
          category: 'software',
          config: { processName: 'test.exe' },
        },
      ]);

      const result = await checklistService.runChecklist(profile);
      expect(result.overallStatus).toBe('fail');
      expect(result.allRequiredPassed).toBe(false);
    });

    it('should return warn when optional item fails', async () => {
      // Device checks currently return 'warn'
      const profile = makeProfile([
        {
          id: 'dev1',
          type: 'device',
          name: 'Optional Device',
          isRequired: false,
          category: 'hardware',
          config: { deviceName: 'Test Device' },
        },
      ]);

      const result = await checklistService.runChecklist(profile);
      expect(result.overallStatus).toBe('warn');
    });
  });

  describe('runSingleCheck', () => {
    it('should call processService.isProcessRunning for process type', async () => {
      mockProcessService.isProcessRunning.mockResolvedValue({
        processName: 'test.exe',
        displayName: 'Test',
        running: true,
        pid: 5678,
      });

      const item: ChecklistItem = {
        id: 'proc1',
        type: 'process',
        name: 'Process Check',
        isRequired: true,
        category: 'software',
        config: { processName: 'test.exe' },
      };

      const result = await checklistService.runSingleCheck(item);
      expect(mockProcessService.isProcessRunning).toHaveBeenCalledWith('test.exe');
      expect(result.status).toBe('pass');
      expect(result.message).toContain('PID: 5678');
    });

    it('should set canRemediate when process check fails and remediation exists', async () => {
      mockProcessService.isProcessRunning.mockResolvedValue({
        processName: 'app.exe',
        displayName: 'App',
        running: false,
      });

      const item: ChecklistItem = {
        id: 'proc1',
        type: 'process',
        name: 'App Check',
        isRequired: true,
        category: 'software',
        config: { processName: 'app.exe' },
        remediation: {
          type: 'launchProcess',
          config: { executablePath: 'C:\\app.exe' },
        },
      };

      const result = await checklistService.runSingleCheck(item);
      expect(result.status).toBe('fail');
      expect(result.canRemediate).toBe(true);
    });

    it('should return warn for device checks', async () => {
      const item: ChecklistItem = {
        id: 'dev1',
        type: 'device',
        name: 'Device Check',
        isRequired: true,
        category: 'hardware',
        config: { deviceName: 'Test Device' },
      };

      const result = await checklistService.runSingleCheck(item);
      expect(result.status).toBe('warn');
    });

    it('should return warn for display check when displayManager not set', async () => {
      const item: ChecklistItem = {
        id: 'disp1',
        type: 'display',
        name: 'Display Check',
        isRequired: false,
        category: 'display',
        config: { configurationName: 'Triple Monitor' },
        remediation: {
          type: 'autoFixDisplay',
          config: { configurationName: 'Triple Monitor' },
        },
      };

      const result = await checklistService.runSingleCheck(item);
      expect(result.status).toBe('warn');
      expect(result.canRemediate).toBe(false);
    });

    it('should pass config check when file exists', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const item: ChecklistItem = {
        id: 'cfg1',
        type: 'config',
        name: 'Config Check',
        isRequired: true,
        category: 'configuration',
        config: { filePath: 'C:\\config\\test.cfg' },
      };

      const result = await checklistService.runSingleCheck(item);
      expect(result.status).toBe('pass');
    });

    it('should fail config check when file missing', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const item: ChecklistItem = {
        id: 'cfg1',
        type: 'config',
        name: 'Config Check',
        isRequired: true,
        category: 'configuration',
        config: { filePath: 'C:\\config\\missing.cfg' },
      };

      const result = await checklistService.runSingleCheck(item);
      expect(result.status).toBe('fail');
    });

    it('should pass config check with contentRegex when match', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('resolution=1920x1080');

      const item: ChecklistItem = {
        id: 'cfg1',
        type: 'config',
        name: 'Config Regex Check',
        isRequired: true,
        category: 'configuration',
        config: { filePath: 'C:\\config\\test.cfg', contentRegex: 'resolution=\\d+x\\d+' },
      };

      const result = await checklistService.runSingleCheck(item);
      expect(result.status).toBe('pass');
    });

    it('should fail config check with contentRegex when no match', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('some other content');

      const item: ChecklistItem = {
        id: 'cfg1',
        type: 'config',
        name: 'Config Regex Fail',
        isRequired: true,
        category: 'configuration',
        config: { filePath: 'C:\\config\\test.cfg', contentRegex: 'resolution=\\d+x\\d+' },
      };

      const result = await checklistService.runSingleCheck(item);
      expect(result.status).toBe('fail');
    });

    it('should fail script check when script file missing', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const item: ChecklistItem = {
        id: 'scr1',
        type: 'script',
        name: 'Script Check',
        isRequired: true,
        category: 'custom',
        config: {
          scriptPath: 'C:\\scripts\\missing.ps1',
          arguments: [],
          successExitCodes: [0],
          timeout: 30,
        },
      };

      const result = await checklistService.runSingleCheck(item);
      expect(result.status).toBe('fail');
      expect(result.message).toContain('Script not found');
    });

    it('should return skip for unknown check type', async () => {
      const item = {
        id: 'unk1',
        type: 'unknown' as never,
        name: 'Unknown Check',
        isRequired: false,
        category: 'custom' as const,
        config: {},
      };

      const result = await checklistService.runSingleCheck(item as ChecklistItem);
      expect(result.status).toBe('skip');
    });
  });

  describe('executeRemediation', () => {
    it('should call processService.launchProcess for launchProcess type', async () => {
      mockProcessService.launchProcess.mockResolvedValue(true);

      const remediation: Remediation = {
        type: 'launchProcess',
        config: {
          executablePath: 'C:\\test\\app.exe',
          arguments: ['--arg1'],
        },
      };

      const result = await checklistService.executeRemediation(remediation);
      expect(result.success).toBe(true);
      expect(mockProcessService.launchProcess).toHaveBeenCalledWith('C:\\test\\app.exe', [
        '--arg1',
      ]);
    });

    it('should copy file and create backup for restoreConfig type', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        if (pathStr.includes('source')) return true;
        if (pathStr.includes('target')) return true;
        return false;
      });
      mockFs.copyFileSync.mockReturnValue(undefined);

      const remediation: Remediation = {
        type: 'restoreConfig',
        config: {
          sourcePath: 'C:\\backup\\source.cfg',
          targetPath: 'C:\\config\\target.cfg',
        },
      };

      const result = await checklistService.executeRemediation(remediation);
      expect(result.success).toBe(true);
      expect(mockFs.copyFileSync).toHaveBeenCalledTimes(2); // backup + restore
    });

    it('should return message for notifyUser type', async () => {
      const remediation: Remediation = {
        type: 'notifyUser',
        config: {
          message: 'Please restart your controller',
        },
      };

      const result = await checklistService.executeRemediation(remediation);
      expect(result.success).toBe(true);
      expect(result.message).toBe('Please restart your controller');
    });
  });
});
