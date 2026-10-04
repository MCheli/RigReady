import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import packageJson from '../../../package.json';
import { sharingContract } from './contract';
import { prepareExport, writeExport } from './core/exporter';
import { applyImport, openImport, undoImport } from './core/importer';

export default defineFeatureMain({
  id: 'sharing',
  setup(ctx) {
    return [
      bind(sharingContract, {
        profiles: async () => {
          const profiles = await ctx.profiles.list();
          if (!profiles.ok) return profiles;
          return ok(
            profiles.value.map((p) => ({
              id: p.id,
              name: p.name,
              ...(p.game ? { game: p.game } : {}),
            }))
          );
        },
        prepare: (input) => prepareExport(ctx, input),
        export: ({ decisions, notes, ...options }) =>
          writeExport(ctx, { ...options, decisions, notes, appVersion: packageJson.version }),
        openImport: () => openImport(ctx),
        import: ({ importId, parts, conflict }) => applyImport(ctx, importId, parts, conflict),
        undoImport: ({ groupId, force }) => undoImport(ctx, groupId, force),
      }),
    ];
  },
});
