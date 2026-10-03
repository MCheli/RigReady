import type { ProcessProvider, Shell } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import type { LaunchTarget, ProcessInfo } from '../../shared/models';
import {
  CloseHandle,
  CreateToolhelp32Snapshot,
  OpenProcess,
  Process32FirstW,
  Process32NextW,
  QueryFullProcessImageNameW,
  TerminateProcess,
  wstr,
} from './win32';

const TH32CS_SNAPPROCESS = 0x2;
const PROCESS_TERMINATE = 0x1;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
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

export class WindowsProcessProvider implements ProcessProvider {
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
