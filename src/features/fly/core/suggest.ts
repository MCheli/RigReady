import { runChecks } from '../../../core/checks/engine';
import type { MainContext } from '../../../core/feature';
import type { CheckItem, Profile } from '../../../core/profile/schema';
import type { Suggestion } from '../contract';

/**
 * When the gear says otherwise: the setup on screen is missing a required device, and
 * every required device of another setup is connected. RigReady then offers that setup.
 * It only offers: nothing is switched by itself.
 */

type Ctx = Pick<MainContext, 'ports' | 'log' | 'checks' | 'profiles'>;

/** The device items that decide whether a setup's gear is here: required, switched on, and deciding readiness. */
function requiredDevices(ctx: Ctx, profile: Profile): CheckItem[] {
  return profile.checks.filter((item) => {
    const definition = ctx.checks.check(item.type);
    return (
      !item.disabled && item.required && definition?.group === 'devices' && !definition.advisory
    );
  });
}

/** What makes two items the same device: the same kind of check with the same parameters. */
const identity = (item: CheckItem): string => `${item.type}:${JSON.stringify(item.params)}`;

export async function suggestSetup(
  ctx: Ctx,
  activeId: string,
  options: { timeoutMs?: number } = {}
): Promise<Suggestion | null> {
  const listed = await ctx.profiles.listDetailed();
  if (!listed.ok) return null;
  const setups = listed.value.profiles.map((stored) => stored.profile);
  const active = setups.find((setup) => setup.id === activeId);
  if (!active) return null;
  const mine = requiredDevices(ctx, active);
  // A setup that needs no particular device is never contradicted by what is plugged in.
  if (mine.length === 0) return null;
  const others = setups
    .filter((setup) => setup.id !== activeId)
    .map((setup) => ({ setup, items: requiredDevices(ctx, setup) }))
    .filter((other) => other.items.length > 0);
  if (others.length === 0) return null;

  // One look at the machine for all of them: every device item of every setup as one list.
  const tagged = (setup: Profile, items: CheckItem[]): CheckItem[] =>
    items.map((item) => ({ ...item, id: `${setup.id}/${item.id}` }));
  const together: Profile = {
    ...active,
    checks: [...tagged(active, mine), ...others.flatMap((o) => tagged(o.setup, o.items))],
  };
  const report = await runChecks(together, ctx.checks, ctx, {
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  const here = new Set(report.results.filter((r) => r.status === 'pass').map((r) => r.itemId));
  const present = (setup: Profile, item: CheckItem): boolean => here.has(`${setup.id}/${item.id}`);

  const missing = mine.filter((item) => !present(active, item));
  if (missing.length === 0) return null;
  const lastUsed = await ctx.profiles.lastUsed();
  const complete = others
    .filter((other) => other.items.every((item) => present(other.setup, item)))
    // Of several, the one used most recently.
    .sort(
      (a, b) =>
        (lastUsed[b.setup.id] ?? '').localeCompare(lastUsed[a.setup.id] ?? '') ||
        a.setup.name.localeCompare(b.setup.name)
    );
  const best = complete[0];
  if (!best) return null;
  // The device that gives it away: part of that setup and not of this one.
  const known = new Set(mine.map(identity));
  const telling = best.items.find((item) => !known.has(identity(item))) ?? best.items[0]!;
  return {
    profileId: best.setup.id,
    name: best.setup.name,
    device: telling.title,
    missing: missing.length,
  };
}
