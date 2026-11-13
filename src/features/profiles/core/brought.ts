import { z } from 'zod';
import { profileExtension, type Profile } from '../../../core/profile/schema';

/** Where a setup brought over from RigReady 1 came from, in its extensions under "profiles". */
export const BroughtSchema = z.object({ broughtFrom: z.string().optional() });

/** The setups brought over from RigReady 1, by the name of the file each came from. */
export function broughtOverFiles(profiles: Profile[]): Map<string, Profile> {
  const found = new Map<string, Profile>();
  for (const profile of profiles) {
    const from = profileExtension(profile, 'profiles', BroughtSchema)?.broughtFrom;
    if (from && !found.has(from)) found.set(from, profile);
  }
  return found;
}
