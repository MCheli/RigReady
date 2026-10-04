import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { profilesContract } from './contract';
import { captureRig } from './core/capture';
import { waitForPress } from './core/identify';
import {
  browse,
  cloneProfile,
  createProfile,
  describeTypes,
  detectedGames,
  openProfileFile,
  overview,
  pickers,
  prepareFix,
  updateProfile,
} from './core/profiles';

export default defineFeatureMain({
  id: 'profiles',
  setup(ctx) {
    return [
      bind(profilesContract, {
        list: () => ctx.profiles.list(),
        overview: () => overview(ctx),
        get: ({ id }) => ctx.profiles.get(id),
        edit: async ({ id }) => {
          const listed = await ctx.profiles.listDetailed();
          if (!listed.ok) return listed;
          const found = listed.value.profiles.find((p) => p.profile.id === id);
          if (found)
            return ok({ profile: found.profile, file: found.file, hasComments: found.hasComments });
          const loaded = await ctx.profiles.get(id);
          if (!loaded.ok) return loaded;
          return ok({ profile: loaded.value, file: ctx.profiles.fileFor(id), hasComments: false });
        },
        save: (profile) => updateProfile(ctx, profile),
        remove: async ({ id }) => {
          const removed = await ctx.profiles.remove(id);
          return removed.ok ? ok({ removed: true }) : removed;
        },
        use: async ({ id }) => {
          const found = await ctx.profiles.get(id);
          if (!found.ok) return found;
          const set = await ctx.profiles.setLastProfileId(id, ctx.ports.clock.now());
          return set.ok ? ok({ used: true }) : set;
        },
        clone: ({ id }) => cloneProfile(ctx, id),
        capture: async () => ok(await captureRig(ctx)),
        create: (input) => createProfile(ctx, input),
        types: async () => ok(describeTypes(ctx)),
        pickers: () => pickers(ctx),
        games: async () => ok(await detectedGames(ctx)),
        waitForPress: ({ timeoutSeconds }) => waitForPress(ctx.ports, timeoutSeconds * 1000),
        browse: ({ kind, title }) => browse(ctx, kind, title),
        prepareFix: ({ type, params }) => prepareFix(ctx, type, params),
        openFile: ({ id }) => openProfileFile(ctx, id, 'open'),
        showFile: ({ id }) => openProfileFile(ctx, id, 'show'),
      }),
    ];
  },
});
