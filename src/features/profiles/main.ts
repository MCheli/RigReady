import { captureCandidates } from '../../core/checks/engine';
import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { profilesContract } from './contract';
import { createProfile, updateProfile } from './core/profiles';

export default defineFeatureMain({
  id: 'profiles',
  setup(ctx) {
    return [
      bind(profilesContract, {
        list: () => ctx.profiles.list(),
        get: ({ id }) => ctx.profiles.get(id),
        save: (profile) => updateProfile(ctx, profile),
        remove: async ({ id }) => {
          const removed = await ctx.profiles.remove(id);
          return removed.ok ? ok({ removed: true }) : removed;
        },
        capture: async () => ok(await captureCandidates(ctx.checks, ctx)),
        create: (input) => createProfile(ctx, input),
      }),
    ];
  },
});
