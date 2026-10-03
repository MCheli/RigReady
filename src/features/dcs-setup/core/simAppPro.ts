import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import { err, ok, type Result } from '../../../core/result';

/**
 * WinWing SimAppPro: where it is, whether it runs, and its MFD plan file. RigReady reads
 * only GameExtendDisplay\MFD\DCS_config.json. %APPDATA%\SimAppPro\config.json holds the
 * user's WinWing account password and is never read, copied or shown.
 */

export const SIMAPPPRO_EXE = 'SimAppPro.exe';

export interface SimAppProInfo {
  installed: boolean;
  version?: string;
  exe?: string;
  running: boolean;
  /** The MFD plan SimAppPro keeps, when it exists. */
  planPath?: string;
}

const UNINSTALL = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

export async function findSimAppPro(ctx: CheckContext): Promise<SimAppProInfo> {
  const candidates: string[] = [];
  let version: string | undefined;
  const keys = await ctx.ports.registry.listKeys('HKCU', UNINSTALL);
  for (const key of keys.ok ? keys.value : []) {
    const values = await ctx.ports.registry.listValues('HKCU', `${UNINSTALL}\\${key}`);
    if (!values.ok) continue;
    const name = values.value['DisplayName'];
    if (name?.type !== 'string' || !/^SimAppPro\b/i.test(name.value)) continue;
    const display = values.value['DisplayVersion'];
    if (display?.type === 'string') version = display.value;
    for (const field of ['InstallLocation', 'DisplayIcon']) {
      const value = values.value[field];
      if (value?.type !== 'string' || !value.value) continue;
      // DisplayIcon may be quoted and carry an icon index: "C:\...\x.ico",0
      const raw = value.value.replace(/"/g, '').replace(/,-?\d+$/, '');
      const dir = field === 'DisplayIcon' ? path.dirname(raw) : raw;
      candidates.push(path.join(dir, SIMAPPPRO_EXE));
    }
  }
  candidates.push(
    path.join(ctx.ports.folders.localAppData(), 'Programs', 'SimAppPro', SIMAPPPRO_EXE)
  );
  let exe: string | undefined;
  for (const candidate of candidates) {
    if (await ctx.ports.files.exists(candidate)) {
      exe = candidate;
      break;
    }
  }
  const processes = await ctx.ports.processes.list();
  const running =
    processes.ok &&
    processes.value.some((p) => p.name.toLowerCase() === SIMAPPPRO_EXE.toLowerCase());
  const plan = simAppProPlanPath(ctx);
  return {
    installed: exe !== undefined || version !== undefined,
    ...(version ? { version } : {}),
    ...(exe ? { exe } : {}),
    running,
    ...((await ctx.ports.files.exists(plan)) ? { planPath: plan } : {}),
  };
}

export function simAppProPlanPath(ctx: CheckContext): string {
  return path.join(
    ctx.ports.folders.appData(),
    'SimAppPro',
    'GameExtendDisplay',
    'MFD',
    'DCS_config.json'
  );
}

export async function readSimAppProPlan(ctx: CheckContext): Promise<Result<unknown>> {
  const file = simAppProPlanPath(ctx);
  if (!(await ctx.ports.files.exists(file))) {
    return err('simapppro.noPlan', 'SimAppPro has no MFD screen plan on this PC.');
  }
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) return text;
  try {
    return ok(JSON.parse(text.value.replace(/^﻿/, '')));
  } catch (e) {
    return err('simapppro.plan', "SimAppPro's MFD screen plan is not readable.", String(e));
  }
}
