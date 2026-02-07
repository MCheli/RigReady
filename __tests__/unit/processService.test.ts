import { exec } from 'child_process';
import {
  ProcessService,
  KNOWN_PROCESSES,
  processService,
} from '../../src/main/services/processService';

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const mockExec = exec as unknown as jest.Mock;

/**
 * Helper: make mockExec call its callback with the given stdout.
 * promisify(exec) passes (cmd, opts, callback) or (cmd, callback),
 * so we handle both signatures.
 */
function mockExecSuccess(stdout: string): void {
  mockExec.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1];
    if (typeof callback === 'function') {
      (callback as (...a: unknown[]) => void)(null, { stdout, stderr: '' });
    } else {
      const cb = args.length >= 3 ? args[2] : args[1];
      if (typeof cb === 'function') {
        (cb as (...a: unknown[]) => void)(null, { stdout, stderr: '' });
      }
    }
  });
}

function mockExecError(error: Error): void {
  mockExec.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1];
    if (typeof callback === 'function') {
      (callback as (...a: unknown[]) => void)(error, null);
    } else {
      const cb = args.length >= 3 ? args[2] : args[1];
      if (typeof cb === 'function') {
        (cb as (...a: unknown[]) => void)(error, null);
      }
    }
  });
}

describe('ProcessService', () => {
  let service: ProcessService;

  beforeEach(() => {
    service = new ProcessService();
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isProcessRunning', () => {
    it('returns running: true when process is found in tasklist output', async () => {
      const stdout = '"DCS.exe","12345","Console","1","500,000 K"\r\n';
      mockExecSuccess(stdout);

      const result = await service.isProcessRunning('DCS.exe');

      expect(result.processName).toBe('DCS.exe');
      expect(result.displayName).toBe('DCS World');
      expect(result.running).toBe(true);
      expect(result.pid).toBe(12345);
    });

    it('returns running: false when process is not found', async () => {
      const stdout = 'INFO: No tasks are running which match the specified criteria.\r\n';
      mockExecSuccess(stdout);

      const result = await service.isProcessRunning('DCS.exe');

      expect(result.processName).toBe('DCS.exe');
      expect(result.displayName).toBe('DCS World');
      expect(result.running).toBe(false);
      expect(result.pid).toBeUndefined();
    });

    it('returns running: false on exec error', async () => {
      mockExecError(new Error('Command failed'));

      const result = await service.isProcessRunning('DCS.exe');

      expect(result.processName).toBe('DCS.exe');
      expect(result.displayName).toBe('DCS World');
      expect(result.running).toBe(false);
      expect(result.pid).toBeUndefined();
    });
  });

  describe('getRunningProcesses', () => {
    it('parses CSV tasklist output correctly', async () => {
      const stdout = [
        '"System Idle Process","0","Services","0","8 K"',
        '"svchost.exe","1024","Services","0","25,600 K"',
        '"DCS.exe","5678","Console","1","1,200,000 K"',
      ].join('\n');
      mockExecSuccess(stdout);

      const processes = await service.getRunningProcesses();

      expect(processes).toHaveLength(3);
      expect(processes[0]).toEqual({ name: 'System Idle Process', pid: 0 });
      expect(processes[1]).toEqual({ name: 'svchost.exe', pid: 1024 });
      expect(processes[2]).toEqual({ name: 'DCS.exe', pid: 5678 });
    });

    it('returns empty array on error', async () => {
      mockExecError(new Error('tasklist failed'));

      const processes = await service.getRunningProcesses();

      expect(processes).toEqual([]);
    });
  });

  describe('launchProcess', () => {
    it('calls exec with correct command', async () => {
      mockExecSuccess('');

      const result = await service.launchProcess('C:\\Games\\DCS\\DCS.exe', ['--force']);

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        'start "" "C:\\Games\\DCS\\DCS.exe" "--force"',
        expect.objectContaining({ shell: 'cmd.exe' }),
        expect.any(Function)
      );
    });

    it('returns false on error', async () => {
      mockExecError(new Error('Failed to start'));

      const result = await service.launchProcess('C:\\Games\\DCS\\DCS.exe');

      expect(result).toBe(false);
    });
  });

  describe('findKnownProcesses', () => {
    it('returns matches from KNOWN_PROCESSES list', async () => {
      const stdout = [
        '"DCS.exe","9999","Console","1","1,000,000 K"',
        '"explorer.exe","1234","Console","1","50,000 K"',
        '"StreamDeck.exe","4567","Console","1","80,000 K"',
      ].join('\n');
      mockExecSuccess(stdout);

      const results = await service.findKnownProcesses();

      // Should have an entry for every known process
      expect(results).toHaveLength(Object.keys(KNOWN_PROCESSES).length);

      const dcs = results.find((r) => r.processName === 'DCS.exe');
      expect(dcs).toBeDefined();
      expect(dcs!.running).toBe(true);
      expect(dcs!.displayName).toBe('DCS World');
      expect(dcs!.pid).toBe(9999);

      const streamDeck = results.find((r) => r.processName === 'StreamDeck.exe');
      expect(streamDeck).toBeDefined();
      expect(streamDeck!.running).toBe(true);
      expect(streamDeck!.displayName).toBe('Stream Deck');
      expect(streamDeck!.pid).toBe(4567);

      // A process not in the tasklist output should be marked as not running
      const trackir = results.find((r) => r.processName === 'TrackIR5.exe');
      expect(trackir).toBeDefined();
      expect(trackir!.running).toBe(false);
      expect(trackir!.pid).toBeUndefined();
    });
  });

  describe('exports', () => {
    it('exports a singleton processService instance', () => {
      expect(processService).toBeInstanceOf(ProcessService);
    });
  });
});
