import { profileActions, type Profile } from '../../../core/profile/schema';

/**
 * Which setups use a virtual controller profile. A setup uses one when a step before or
 * after launch, a Stand down step, or the fix of one of its checks is "Start a virtual
 * controller" with that profile's id. Deleting the profile breaks that step.
 */

export const START_TYPE = 'virtual-controller.start';

export interface SetupRef {
  id: string;
  name: string;
}

/** Every setup that starts a virtual controller, by the id of the profile it starts. */
export function setupsByPadProfile(setups: readonly Profile[]): Map<string, SetupRef[]> {
  const out = new Map<string, SetupRef[]>();
  for (const setup of setups) {
    const actions = profileActions(setup);
    const refs = [
      ...actions.preLaunch,
      ...actions.postLaunch,
      ...actions.standDown,
      ...setup.checks.flatMap((c) => (c.remediation ? [c.remediation] : [])),
    ];
    const ids = new Set<string>();
    for (const ref of refs) {
      const id = ref.type === START_TYPE ? ref.params['profile'] : undefined;
      if (typeof id === 'string') ids.add(id);
    }
    for (const id of ids) {
      out.set(id, [...(out.get(id) ?? []), { id: setup.id, name: setup.name }]);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * The setup with a renamed profile's name brought up to date. A step or a fix that starts a
 * profile keeps the profile's name beside its id, and the Play page reads the name there:
 * without this a renamed profile keeps its old name in every setup that starts it. A step
 * that stores no name is left as it is (its name is looked up when it is shown).
 * Undefined when nothing in the setup says another name.
 */
export function withPadProfileName(
  setup: Profile,
  profileId: string,
  name: string
): Profile | undefined {
  let changed = false;
  const named = <T extends { type: string; params: Record<string, unknown> }>(ref: T): T => {
    if (ref.type !== START_TYPE || ref.params['profile'] !== profileId) return ref;
    const stored = ref.params['profileName'];
    if (stored === undefined || stored === name) return ref;
    changed = true;
    return { ...ref, params: { ...ref.params, profileName: name } };
  };
  const checks = setup.checks.map((check) =>
    check.remediation ? { ...check, remediation: named(check.remediation) } : check
  );
  const actions = setup.actions && {
    preLaunch: setup.actions.preLaunch.map(named),
    postLaunch: setup.actions.postLaunch.map(named),
    standDown: setup.actions.standDown.map(named),
  };
  if (!changed) return undefined;
  return { ...setup, checks, ...(actions ? { actions } : {}) };
}

/** "Ace Combat 8", "A and B", "A, B and C": setup names in a sentence. */
export function setupNames(setups: readonly SetupRef[]): string {
  const names = setups.map((s) => `"${s.name}"`);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
