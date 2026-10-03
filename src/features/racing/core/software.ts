import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { RegistryHive } from '../../../shared/models';
import type { RacingContext } from './context';

/** Installed programs (uninstall entries) and the helper apps racing setups use. */

export interface InstalledProgram {
  name: string;
  version?: string;
  location?: string;
}

const UNINSTALL: [RegistryHive, string][] = [
  ['HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
  ['HKLM', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
  ['HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
];

/** The first uninstall entry whose display name matches. */
export async function findProgram(
  ctx: CheckContext,
  name: RegExp
): Promise<InstalledProgram | undefined> {
  for (const [hive, root] of UNINSTALL) {
    const keys = await ctx.ports.registry.listKeys(hive, root);
    if (!keys.ok) continue;
    for (const key of keys.value) {
      const values = await ctx.ports.registry.listValues(hive, `${root}\\${key}`);
      if (!values.ok) continue;
      const display = values.value['DisplayName'];
      if (display?.type !== 'string' || !name.test(display.value)) continue;
      const version = values.value['DisplayVersion'];
      const location = values.value['InstallLocation'];
      return {
        name: display.value,
        ...(version?.type === 'string' && version.value ? { version: version.value } : {}),
        ...(location?.type === 'string' && location.value.trim()
          ? { location: location.value.trim() }
          : {}),
      };
    }
  }
  return undefined;
}

export interface HelperApp {
  id: 'fanatec-service' | 'simhub' | 'crewchief' | 'trophi';
  name: string;
  /** What it is for, in a few words. */
  purpose: string;
  process: string;
  installed: boolean;
  running: boolean;
  /** Where to start it from; undefined when unknown. */
  exe?: string;
}

/** Racing helper apps: found when installed or running. */
export async function helperApps(ctx: RacingContext): Promise<HelperApp[]> {
  const list = await ctx.ports.processes.list();
  const processes = list.ok ? list.value : [];
  const runningPath = (name: string): string | undefined =>
    processes.find((p) => p.name.toLowerCase() === name.toLowerCase())?.path;
  const isRunningNow = (name: string): boolean =>
    processes.some((p) => p.name.toLowerCase() === name.toLowerCase());
  const firstExisting = async (candidates: (string | undefined)[]): Promise<string | undefined> => {
    for (const c of candidates) if (c && (await ctx.ports.files.exists(c))) return c;
    return undefined;
  };
  const apps: HelperApp[] = [];

  const fanatec = await firstExisting([
    path.join(
      ctx.ports.folders.programFiles(),
      'Fanatec',
      'FanatecService',
      'Service',
      'FanatecService.exe'
    ),
  ]);
  const fanatecRunning = isRunningNow('FanatecService.exe');
  if (fanatec || fanatecRunning) {
    apps.push({
      id: 'fanatec-service',
      name: 'Fanatec Service',
      purpose: 'wheel LEDs, rim displays and game integration',
      process: 'FanatecService.exe',
      installed: true,
      running: fanatecRunning,
      ...((fanatec ?? runningPath('FanatecService.exe'))
        ? { exe: fanatec ?? runningPath('FanatecService.exe')! }
        : {}),
    });
  }

  const simhub = await findProgram(ctx, /^SimHub/i);
  const simhubExe = await firstExisting([
    simhub?.location ? path.join(simhub.location, 'SimHubWPF.exe') : undefined,
    path.join(ctx.ports.folders.programFilesX86(), 'SimHub', 'SimHubWPF.exe'),
  ]);
  if (simhub || simhubExe || isRunningNow('SimHubWPF.exe')) {
    const exe = simhubExe ?? runningPath('SimHubWPF.exe');
    apps.push({
      id: 'simhub',
      name: 'SimHub',
      purpose: 'dashboards, bass shakers and LEDs',
      process: 'SimHubWPF.exe',
      installed: true,
      running: isRunningNow('SimHubWPF.exe'),
      ...(exe ? { exe } : {}),
    });
  }

  const crew = await findProgram(ctx, /crew ?chief/i);
  const crewExe = await firstExisting([
    crew?.location ? path.join(crew.location, 'CrewChiefV4.exe') : undefined,
    path.join(
      ctx.ports.folders.programFilesX86(),
      'Britton IT Ltd',
      'CrewChiefV4',
      'CrewChiefV4.exe'
    ),
  ]);
  if (crew || crewExe || isRunningNow('CrewChiefV4.exe')) {
    const exe = crewExe ?? runningPath('CrewChiefV4.exe');
    apps.push({
      id: 'crewchief',
      name: 'Crew Chief',
      purpose: 'spotter and race engineer voice',
      process: 'CrewChiefV4.exe',
      installed: true,
      running: isRunningNow('CrewChiefV4.exe'),
      ...(exe ? { exe } : {}),
    });
  }

  const trophiExe = await firstExisting([
    path.join(ctx.ports.folders.localAppData(), 'trophi.ai', 'Game', 'trophi.ai.exe'),
  ]);
  if (trophiExe || isRunningNow('trophi.ai.exe')) {
    const exe = trophiExe ?? runningPath('trophi.ai.exe');
    apps.push({
      id: 'trophi',
      name: 'trophi.ai coach',
      purpose: 'AI driving coach',
      process: 'trophi.ai.exe',
      installed: true,
      running: isRunningNow('trophi.ai.exe'),
      ...(exe ? { exe } : {}),
    });
  }
  return apps;
}
