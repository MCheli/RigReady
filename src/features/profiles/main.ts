import { rememberCandidate } from '../../core/checks/engine';
import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { profilesContract } from './contract';
import { captureRig } from './core/capture';
import { waitForPress } from './core/identify';
import { bringOverEarlier, planEarlier } from './core/versionOne';
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
import {
  createShortcut,
  previewShortcut,
  removeShortcut,
  removeShortcutIfAny,
  shortcutStatus,
} from './core/shortcut';

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
          // One action: the setup's desktop shortcut, then its file, undone together.
          const loaded = await ctx.profiles.get(id);
          if (!loaded.ok && loaded.error.code === 'profile.id') return loaded;
          const name = loaded.ok ? loaded.value.name : id;
          const group = ctx.ports.files.beginGroup(`Delete setup "${name}"`);
          const shortcuts = await removeShortcutIfAny(ctx, id, group);
          if (!shortcuts.ok) return shortcuts;
          const removed = await ctx.profiles.remove(id, group);
          if (!removed.ok) return removed;
          return ok({ removed: true, shortcutRemoved: shortcuts.value.length > 0 });
        },
        use: async ({ id }) => {
          const found = await ctx.profiles.get(id);
          if (!found.ok) return found;
          const set = await ctx.profiles.setLastProfileId(id, ctx.ports.clock.now());
          return set.ok ? ok({ used: true }) : set;
        },
        earlierPlan: async ({ id }) => {
          const planned = await planEarlier(ctx, id);
          return planned.ok ? ok(planned.value.view) : planned;
        },
        bringOver: ({ id, seen }) => bringOverEarlier(ctx, id, seen),
        clone: ({ id }) => cloneProfile(ctx, id),
        capture: async () => ok(await captureRig(ctx)),
        remember: ({ capture, key, on }) => rememberCandidate(ctx.checks, capture, key, on, ctx),
        create: (input) => createProfile(ctx, input),
        types: async () => ok(await describeTypes(ctx)),
        pickers: () => pickers(ctx),
        games: async () => ok(await detectedGames(ctx)),
        waitForPress: ({ timeoutSeconds }) => waitForPress(ctx.ports, timeoutSeconds * 1000),
        browse: ({ kind, title }) => browse(ctx, kind, title),
        prepareFix: ({ type, params }) => prepareFix(ctx, type, params),
        openFile: ({ id }) => openProfileFile(ctx, id, 'open'),
        showFile: ({ id }) => openProfileFile(ctx, id, 'show'),
        shortcut: ({ id }) => shortcutStatus(ctx, id),
        shortcutPreview: ({ id, action }) => previewShortcut(ctx, id, action),
        createShortcut: ({ id }) => createShortcut(ctx, id),
        removeShortcut: ({ id }) => removeShortcut(ctx, id),
      }),
    ];
  },
});
