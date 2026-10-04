import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { createDcsChecks } from './core/checks';
import { DcsSetupService } from './core/service';
import { dcsSetupContract } from './contract';

export default defineFeatureMain({
  id: 'dcs-setup',
  setup(ctx) {
    const service = new DcsSetupService(ctx);
    const { checks, remediations, capture } = createDcsChecks(service);
    for (const check of checks) ctx.checks.registerCheck(check);
    for (const remediation of remediations) ctx.checks.registerRemediation(remediation);
    ctx.checks.registerCapture(capture);

    return [
      bind(dcsSetupContract, {
        overview: async () => ok(await service.overview()),
        screens: async () => ok(await service.screens()),
        importSimAppPro: ({ desktopId }) => service.importFromSimAppPro(desktopId),
        previewScreens: (input) => service.previewScreens(input),
        applyScreens: (input) => service.applyScreens(input),
        exportLua: async () => ok(await service.exportState()),
        previewExport: (action) => service.previewExport(action),
        applyExport: (action) => service.applyExport(action),
        acceptExport: () => service.acceptExport(),
        simAppPro: async () => ok(await service.simAppProState()),
        setRuntimeFeatures: ({ profileId, features }) =>
          service.setRuntimeFeatures(profileId, features),
        restoreManaged: async () => {
          const restored = await service.restoreManaged();
          return restored.ok ? ok({ message: restored.value, changes: [] }) : restored;
        },
        restoreManagedPreview: () => service.previewRestoreManaged(),
        markVerified: () => service.markVerified(),
      }),
    ];
  },
});
