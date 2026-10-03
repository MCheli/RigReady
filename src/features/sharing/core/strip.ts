import path from 'node:path';
import type { CheckItem, Profile } from '../../../core/profile/schema';

/** Something a setup wanted to run, removed before sharing or importing. */
export interface StrippedItem {
  kind: 'launch' | 'check' | 'fix';
  /** "check_vpn.py", "DCS.exe" */
  name: string;
  /** "Checks squadron VPN" */
  description: string;
}

/**
 * Check and fix types that run a program, a script or a command: a type segment that is
 * (or starts a camelCase word with) one of these words. "process.launch", "script.run",
 * "runScript" match; "process.running" and "service.running" do not.
 */
const RUNS_SOMETHING =
  /(^|\.)(script|scripts|command|shell|launch|exec|run|start|powershell|python|program)(?=$|\.|[A-Z])/;
/** Parameters that name something to run. */
const RUN_KEYS = ['exe', 'command', 'script', 'scriptPath', 'program', 'cmd', 'args', 'arguments'];

const nameIn = (params: Record<string, unknown>): string | undefined => {
  for (const key of ['script', 'scriptPath', 'program', 'exe', 'command', 'cmd']) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return path.win32.basename(value.trim());
  }
  return undefined;
};

const runsSomething = (type: string, params: Record<string, unknown>): boolean =>
  RUNS_SOMETHING.test(type) || RUN_KEYS.some((key) => key in params && key !== 'args');

/**
 * Removes everything runnable from a profile: the launch target, checks that run a
 * script or command, and fixes that start a program. Returns the clean profile and
 * what was removed, so the user can be shown the list. Used on export and again on
 * import (a hand-made file may carry them anyway).
 */
export function stripRunnable(profile: Profile): { profile: Profile; stripped: StrippedItem[] } {
  const stripped: StrippedItem[] = [];
  const { launch, ...rest } = profile;
  if (launch) {
    const exe = path.win32.basename(launch.exe);
    stripped.push({
      kind: 'launch',
      name: exe,
      description: `Launch ${exe}${launch.args.length ? ` ${launch.args.join(' ')}` : ''}`,
    });
  }
  const checks: CheckItem[] = [];
  for (const check of profile.checks) {
    const params = check.params;
    if (runsSomething(check.type, params)) {
      stripped.push({
        kind: 'check',
        name: nameIn(params) ?? check.type,
        description: check.title,
      });
      continue;
    }
    const remediation = check.remediation;
    if (remediation && runsSomething(remediation.type, remediation.params)) {
      const { remediation: _removed, ...kept } = check;
      stripped.push({
        kind: 'fix',
        name: nameIn(remediation.params) ?? remediation.type,
        description: `Fix for "${check.title}"`,
      });
      checks.push(kept);
      continue;
    }
    checks.push(check);
  }
  return { profile: { ...rest, checks }, stripped };
}
