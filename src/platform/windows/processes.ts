import type { CloseOptions, ProcessProvider, Shell } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import type { LaunchTarget, ProcessInfo } from '../../shared/models';
import {
  CloseHandle,
  CreateToolhelp32Snapshot,
  FindWindowExW,
  GetWindowThreadProcessId,
  IsWindowVisible,
  OpenProcess,
  PostMessageW,
  Process32FirstW,
  Process32NextW,
  QueryFullProcessImageNameW,
  TerminateProcess,
  WaitForSingleObject,
  wstr,
} from './win32';

const TH32CS_SNAPPROCESS = 0x2;
const PROCESS_TERMINATE = 0x1;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const SYNCHRONIZE = 0x100000;
const WAIT_OBJECT_0 = 0;
const WM_CLOSE = 0x10;
const ENTRY_SIZE = 568; // PROCESSENTRY32W on x64
const INVALID_HANDLE = -1n;

function imagePath(pid: number): string | undefined {
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) as bigint | number;
  if (!handle || BigInt(handle) === 0n) return undefined;
  try {
    const buffer = Buffer.alloc(32768 * 2);
    const size = [32768];
    const success = QueryFullProcessImageNameW(handle, 0, buffer, size);
    return success ? buffer.toString('utf16le', 0, size[0]! * 2) : undefined;
  } finally {
    CloseHandle(handle);
  }
}

export function listProcesses(): ProcessInfo[] {
  const snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) as bigint | number;
  if (BigInt(snapshot) === INVALID_HANDLE) throw new Error('CreateToolhelp32Snapshot failed');
  const result: ProcessInfo[] = [];
  try {
    const entry = Buffer.alloc(ENTRY_SIZE);
    entry.writeUInt32LE(ENTRY_SIZE, 0);
    let more = Process32FirstW(snapshot, entry);
    while (more) {
      const pid = entry.readUInt32LE(8);
      const info: ProcessInfo = { pid, name: wstr(entry, 44, 520) };
      if (pid > 4) {
        const path = imagePath(pid);
        if (path) info.path = path;
      }
      result.push(info);
      more = Process32NextW(snapshot, entry);
    }
  } finally {
    CloseHandle(snapshot);
  }
  return result;
}

/** Top-level windows that belong to a process. */
export function windowsOf(pid: number): { handle: bigint; visible: boolean }[] {
  const found: { handle: bigint; visible: boolean }[] = [];
  let current = BigInt(FindWindowExW(0, 0, null, null) as bigint | number);
  for (let guard = 0; current !== 0n && guard < 100_000; guard++) {
    const owner = [0];
    GetWindowThreadProcessId(current, owner);
    if (owner[0] === pid) found.push({ handle: current, visible: IsWindowVisible(current) !== 0 });
    current = BigInt(FindWindowExW(0, current, null, null) as bigint | number);
  }
  return found;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class WindowsProcessProvider implements ProcessProvider {
  async close(
    pid: number,
    options: CloseOptions = {}
  ): Promise<Result<{ outcome: 'closed' | 'terminated' }>> {
    const waitMs = options.waitMs ?? 10_000;
    const handle = OpenProcess(SYNCHRONIZE | (options.force ? PROCESS_TERMINATE : 0), 0, pid) as
      bigint | number;
    if (!handle || BigInt(handle) === 0n) {
      return err('process.stop', `Could not open process ${pid} to close it.`);
    }
    try {
      const windows = windowsOf(pid);
      // The windows the user can see are what the X button would close. A program that
      // lives in the tray has none, so its hidden top-level windows are asked instead.
      const targets = windows.some((w) => w.visible) ? windows.filter((w) => w.visible) : windows;
      for (const window of targets) PostMessageW(window.handle, WM_CLOSE, 0, 0);
      const deadline = Date.now() + waitMs;
      for (;;) {
        if (WaitForSingleObject(handle, 0) === WAIT_OBJECT_0) return ok({ outcome: 'closed' });
        if (Date.now() >= deadline) break;
        await sleep(100);
      }
      if (!options.force) {
        return err(
          'process.stillRunning',
          targets.length === 0
            ? `Process ${pid} has no window to close and is still running.`
            : `Process ${pid} did not close within ${Math.round(waitMs / 1000)} s.`
        );
      }
      if (!TerminateProcess(handle, 0)) {
        return err('process.stop', `Windows refused to stop process ${pid}.`);
      }
      return ok({ outcome: 'terminated' });
    } finally {
      CloseHandle(handle);
    }
  }

  constructor(private readonly shell: Shell) {}

  async list(): Promise<Result<ProcessInfo[]>> {
    try {
      return ok(listProcesses());
    } catch (e) {
      return err('process.list', 'Could not list running programs.', String(e));
    }
  }

  start(target: LaunchTarget): Promise<Result<{ pid: number | undefined }>> {
    return this.shell.launch(target.exe, target.args, target.cwd ? { cwd: target.cwd } : {});
  }

  async stop(pid: number): Promise<Result<void>> {
    const handle = OpenProcess(PROCESS_TERMINATE, 0, pid) as bigint | number;
    if (!handle || BigInt(handle) === 0n) {
      return err('process.stop', `Could not open process ${pid} to stop it.`);
    }
    try {
      return TerminateProcess(handle, 0)
        ? ok(undefined)
        : err('process.stop', `Windows refused to stop process ${pid}.`);
    } finally {
      CloseHandle(handle);
    }
  }
}
