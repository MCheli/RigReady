import type { MainContext } from '../../../core/feature';
import type { CheckItem, Profile } from '../../../core/profile/schema';
import { err, type Result } from '../../../core/result';
import type { NewProfile } from '../contract';

type Ctx = Pick<MainContext, 'ports' | 'profiles'>;

/** Creates a profile from checks chosen in the capture screen. */
export async function createProfile(ctx: Ctx, input: NewProfile): Promise<Result<Profile>> {
  const id = await ctx.profiles.uniqueId(input.name);
  const now = ctx.ports.clock.now().toISOString();
  const checks: CheckItem[] = input.checks.map((check, index) => ({
    ...check,
    id: `c${index + 1}`,
  }));
  const profile: Profile = {
    schemaVersion: 1,
    id,
    name: input.name,
    createdAt: now,
    updatedAt: now,
    checks,
    ...(input.game ? { game: input.game } : {}),
    ...(input.launch ? { launch: input.launch } : {}),
  };
  return ctx.profiles.save(profile);
}

/** Saves edits to an existing profile. The id and creation time cannot change. */
export async function updateProfile(ctx: Ctx, profile: Profile): Promise<Result<Profile>> {
  const existing = await ctx.profiles.get(profile.id);
  if (!existing.ok) return existing;
  const ids = new Set(profile.checks.map((c) => c.id));
  if (ids.size !== profile.checks.length)
    return err('profile.invalid', 'Two checks have the same id.');
  return ctx.profiles.save({
    ...profile,
    createdAt: existing.value.createdAt,
    updatedAt: ctx.ports.clock.now().toISOString(),
  });
}
