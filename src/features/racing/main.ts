import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { racingContract } from './contract';
import { acView } from './core/assettoCorsa';
import {
  backupNow,
  deleteBackup,
  fanatecBackupSource,
  listBackups,
  previewRestoreBackup,
  restoreBackup,
} from './core/backups';
import {
  beamngView,
  copyBindingsToController,
  copyOlderBindings,
  previewCopyOlderBindings,
} from './core/beamng/beamng';
import {
  iracingDevicesCheck,
  iracingServiceCheck,
  racingCapture,
  racingOverview,
} from './core/checks';
import type { RacingContext } from './core/context';
import { wheelBaseCheck, wheelStatus } from './core/fanatec/fanatec';
import { TUNING_PARAMETERS } from './core/fanatec/recommended';
import {
  compareWheelSettings,
  presetStore,
  readPresets,
  wheelSettingsCheck,
} from './core/fanatec/wheelSettings';
import { iracingView, repairIracing } from './core/iracing/iracing';
import { lmuView } from './core/lmu/lmu';

export default defineFeatureMain({
  id: 'racing',
  setup(ctx) {
    const rctx: RacingContext = { ports: ctx.ports, log: ctx.log, games: ctx.games };

    ctx.checks.registerCheck(wheelBaseCheck);
    ctx.checks.registerCheck(iracingDevicesCheck(ctx.games));
    ctx.checks.registerCheck(iracingServiceCheck);
    ctx.checks.registerCheck(wheelSettingsCheck(ctx.games));
    ctx.checks.registerCapture(racingCapture(ctx.games));
    ctx.backupSources.register(fanatecBackupSource);

    return [
      bind(racingContract, {
        overview: async () => ok(await racingOverview(rctx)),
        iracing: async () => ok(await iracingView(rctx)),
        async iracingRepair({ mapping }) {
          const repaired = await repairIracing(rctx, mapping);
          return repaired.ok ? ok({ message: repaired.value.message }) : repaired;
        },
        lmu: async () => ok(await lmuView(rctx)),
        beamng: async () => ok(await beamngView(rctx)),
        beamngCopyOlder: ({ version }) => copyOlderBindings(rctx, version),
        beamngCopyOlderPreview: ({ version }) => previewCopyOlderBindings(rctx, version),
        beamngCopyToController: ({ file, to }) => copyBindingsToController(rctx, file, to),
        assettoCorsa: async () => ok(await acView(rctx)),
        async wheel() {
          const presets = await readPresets(rctx);
          return ok({
            status: await wheelStatus(rctx),
            presets,
            parameters: TUNING_PARAMETERS,
            comparisons: await compareWheelSettings(rctx, presets),
          });
        },
        savePresets: (presets) =>
          presetStore(rctx).write({ ...presets, updatedAt: ctx.ports.clock.now().toISOString() }),
        backups: async ({ game }) => ok(await listBackups(rctx, game)),
        backup: ({ game }) => backupNow(rctx, game),
        restore: ({ game, id, closeApp }) => restoreBackup(rctx, game, id, { closeApp }),
        restorePreview: ({ game, id }) => previewRestoreBackup(rctx, game, id),
        async deleteBackup({ game, id }) {
          const deleted = await deleteBackup(rctx, game, id);
          return deleted.ok ? ok({ deleted: true }) : deleted;
        },
      }),
    ];
  },
});
