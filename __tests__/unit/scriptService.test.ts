import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

import { scriptService } from '../../src/main/services/scriptService';
import type { ScriptConfig } from '../../src/shared/scriptTypes';

function createMockProcess() {
  const proc = new EventEmitter() as ReturnType<typeof spawn>;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  (proc as unknown as Record<string, unknown>).stdout = stdout;
  (proc as unknown as Record<string, unknown>).stderr = stderr;
  (proc as unknown as Record<string, unknown>).kill = jest.fn();
  (proc as unknown as Record<string, unknown>).pid = 12345;
  return proc;
}

function makeConfig(overrides: Partial<ScriptConfig> = {}): ScriptConfig {
  return {
    id: 'test-script',
    name: 'Test Script',
    scriptPath: 'C:\\scripts\\test.ps1',
    arguments: [],
    timeout: 30,
    runHidden: false,
    successExitCodes: [0],
    ...overrides,
  };
}

describe('ScriptService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should run .ps1 scripts with powershell', async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const promise = scriptService.execute(makeConfig({ scriptPath: 'C:\\scripts\\test.ps1' }));

      // Simulate successful completion
      mockProc.emit('close', 0);

      const result = await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        'powershell',
        expect.arrayContaining([
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          'C:\\scripts\\test.ps1',
        ]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });

    it('should run .bat scripts with cmd.exe', async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const promise = scriptService.execute(makeConfig({ scriptPath: 'C:\\scripts\\test.bat' }));
      mockProc.emit('close', 0);

      await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd.exe',
        expect.arrayContaining(['/c', 'C:\\scripts\\test.bat']),
        expect.any(Object)
      );
    });

    it('should run .py scripts with python', async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const promise = scriptService.execute(makeConfig({ scriptPath: 'C:\\scripts\\test.py' }));
      mockProc.emit('close', 0);

      await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        'python',
        expect.arrayContaining(['C:\\scripts\\test.py']),
        expect.any(Object)
      );
    });

    it('should run unknown extensions directly', async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const promise = scriptService.execute(makeConfig({ scriptPath: 'C:\\scripts\\test.sh' }));
      mockProc.emit('close', 0);

      await promise;
      expect(mockSpawn).toHaveBeenCalledWith('C:\\scripts\\test.sh', [], expect.any(Object));
    });

    it('should inject RIGREADY environment variables', async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const promise = scriptService.execute(makeConfig(), {
        profileName: 'My Profile',
        gameName: 'DCS',
        profileId: 'abc123',
      });
      mockProc.emit('close', 0);

      await promise;
      const callArgs = mockSpawn.mock.calls[0];
      const spawnOpts = callArgs[2] as Record<string, Record<string, string>>;
      expect(spawnOpts.env.RIGREADY_PROFILE_NAME).toBe('My Profile');
      expect(spawnOpts.env.RIGREADY_GAME_NAME).toBe('DCS');
      expect(spawnOpts.env.RIGREADY_PROFILE_ID).toBe('abc123');
    });

    it('should merge custom env vars from config and options', async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const promise = scriptService.execute(
        makeConfig({
          environmentVariables: { CUSTOM_VAR: 'from-config' },
        }),
        {
          environmentOverrides: { OVERRIDE_VAR: 'from-options' },
        }
      );
      mockProc.emit('close', 0);

      await promise;
      const callArgs = mockSpawn.mock.calls[0];
      const spawnOpts = callArgs[2] as Record<string, Record<string, string>>;
      expect(spawnOpts.env.CUSTOM_VAR).toBe('from-config');
      expect(spawnOpts.env.OVERRIDE_VAR).toBe('from-options');
    });

    it('should set timedOut: true when timeout kills process', async () => {
      jest.useFakeTimers();
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const promise = scriptService.execute(makeConfig({ timeout: 1 })); // 1 second timeout

      // Advance time past the timeout
      jest.advanceTimersByTime(1100);

      // Process closes after being killed
      mockProc.emit('close', null);

      const result = await promise;
      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });

    it('should determine success by exit code matching successExitCodes', async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const promise = scriptService.execute(makeConfig({ successExitCodes: [0, 1] }));
      mockProc.emit('close', 1);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(1);
    });

    it('should use [0] as default success codes', async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const promise = scriptService.execute(makeConfig({ successExitCodes: [] }));
      mockProc.emit('close', 0);

      const result = await promise;
      expect(result.success).toBe(true);
    });

    it('should return success: false on spawn error', async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);

      const promise = scriptService.execute(makeConfig());
      mockProc.emit('error', new Error('ENOENT: command not found'));

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('ENOENT');
    });
  });
});
