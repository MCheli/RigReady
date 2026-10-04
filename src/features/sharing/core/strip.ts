import path from 'node:path';
import type { CheckItem, LaunchAction, Profile } from '../../../core/profile/schema';

/** Something a setup wanted to run, removed before sharing or importing. */
export interface StrippedItem {
  kind: 'launch' | 'check' | 'fix' | 'action';
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

const PHASE_TEXT = {
  preLaunch: 'Step before launch',
  postLaunch: 'Step after launch',
  standDown: 'Step at Stand down',
} as const;

/**
 * Removes everything runnable from a profile: the launch target, checks that run a
 * script or command, fixes that start a program, and the steps around a launch and at
 * Stand down that do. Returns the clean profile and what was removed, so the user can
 * be shown the list. Used on export and again on import (a hand-made file may carry
 * them anyway).
 */
export function stripRunnable(profile: Profile): { profile: Profile; stripped: StrippedItem[] } {
  const stripped: StrippedItem[] = [];
  const { launch, actions: steps, ...rest } = profile;
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
  let actions = steps;
  if (actions) {
    const kept = { preLaunch: [], postLaunch: [], standDown: [] } as Record<
      keyof typeof PHASE_TEXT,
      LaunchAction[]
    >;
    for (const phase of Object.keys(PHASE_TEXT) as (keyof typeof PHASE_TEXT)[]) {
      for (const action of actions[phase] ?? []) {
        if (runsSomething(action.type, action.params)) {
          stripped.push({
            kind: 'action',
            name: nameIn(action.params) ?? action.type,
            description: `${PHASE_TEXT[phase]}: ${action.title}`,
          });
        } else kept[phase].push(action);
      }
    }
    actions = kept;
  }
  return { profile: { ...rest, checks, ...(actions ? { actions } : {}) }, stripped };
}

/**
 * The second lock on an imported setup. Whatever fix or step is still in it after
 * stripRunnable gets `requiresConfirmation: true` when it has such a setting or when its
 * type can run a program (`canRun`): nothing that came in through a file can ever run
 * without the user seeing the exact command first, whatever the file said.
 */
export function requireConfirmation(
  profile: Profile,
  canRun: (type: string) => boolean
): { profile: Profile; forced: number } {
  let forced = 0;
  const lock = (type: string, params: Record<string, unknown>): Record<string, unknown> => {
    if (!('requiresConfirmation' in params) && !canRun(type)) return params;
    if (params['requiresConfirmation'] !== true) forced++;
    return { ...params, requiresConfirmation: true };
  };
  const checks = profile.checks.map((check) =>
    check.remediation
      ? {
          ...check,
          remediation: {
            ...check.remediation,
            params: lock(check.remediation.type, check.remediation.params),
          },
        }
      : check
  );
  const actions = profile.actions
    ? {
        preLaunch: profile.actions.preLaunch.map((a) => ({ ...a, params: lock(a.type, a.params) })),
        postLaunch: profile.actions.postLaunch.map((a) => ({
          ...a,
          params: lock(a.type, a.params),
        })),
        standDown: profile.actions.standDown.map((a) => ({ ...a, params: lock(a.type, a.params) })),
      }
    : undefined;
  return { profile: { ...profile, checks, ...(actions ? { actions } : {}) }, forced };
}
