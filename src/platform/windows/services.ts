import type { ServiceProvider } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import type { ServiceInfo } from '../../shared/models';
import { CloseServiceHandle, EnumServicesStatusExW, OpenSCManagerW, wstrAt } from './win32';

/** Windows services and their state, through the service control manager. Read-only; no admin. */

const SC_MANAGER_CONNECT = 0x1;
const SC_MANAGER_ENUMERATE_SERVICE = 0x4;
const SC_ENUM_PROCESS_INFO = 0;
const SERVICE_WIN32 = 0x30;
const SERVICE_DRIVER = 0x0b;
const SERVICE_STATE_ALL = 0x3;
const ENTRY_SIZE = 56; // ENUM_SERVICE_STATUS_PROCESSW on x64

const STATES: Record<number, ServiceInfo['state']> = {
  1: 'stopped',
  2: 'starting',
  3: 'stopping',
  4: 'running',
  7: 'paused',
};

export function listServices(): ServiceInfo[] {
  const manager = BigInt(
    OpenSCManagerW(null, null, SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE) as bigint
  );
  if (manager === 0n) throw new Error('OpenSCManagerW failed');
  try {
    const services: ServiceInfo[] = [];
    const resume = [0];
    // Kernel drivers are included: HidHide and the ViGEm bus are driver services.
    const types = SERVICE_WIN32 | SERVICE_DRIVER;
    for (let round = 0; round < 64; round++) {
      const needed = [0];
      const returned = [0];
      const buffer = Buffer.alloc(256 * 1024);
      const success = EnumServicesStatusExW(
        manager,
        SC_ENUM_PROCESS_INFO,
        types,
        SERVICE_STATE_ALL,
        buffer,
        buffer.length,
        needed,
        returned,
        resume,
        null
      );
      for (let i = 0; i < returned[0]!; i++) {
        const offset = i * ENTRY_SIZE;
        const info: ServiceInfo = {
          name: wstrAt(buffer.readBigUInt64LE(offset)),
          displayName: wstrAt(buffer.readBigUInt64LE(offset + 8)),
          state: STATES[buffer.readUInt32LE(offset + 20)] ?? 'other',
        };
        const pid = buffer.readUInt32LE(offset + 44);
        if (pid > 0) info.pid = pid;
        services.push(info);
      }
      if (success) break;
      // Not everything fitted: call again, continuing from the resume handle.
      if (returned[0] === 0 || resume[0] === 0) throw new Error('EnumServicesStatusExW failed');
    }
    services.sort((a, b) => a.name.localeCompare(b.name));
    return services;
  } finally {
    CloseServiceHandle(manager);
  }
}

export class WindowsServiceProvider implements ServiceProvider {
  async list(): Promise<Result<ServiceInfo[]>> {
    try {
      return ok(listServices());
    } catch (e) {
      return err('service.list', 'Could not list Windows services.', String(e));
    }
  }

  async get(name: string): Promise<Result<ServiceInfo | undefined>> {
    const all = await this.list();
    if (!all.ok) return all;
    return ok(all.value.find((s) => s.name.toLowerCase() === name.toLowerCase()));
  }
}
