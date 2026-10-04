import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { racingContract } from './contract';
import { acView } from './core/assettoCorsa';
import {
  backupNow,
  deleteBackup,
  fanatecBackupSource,
  listBackups,
  nameBackup,
  previewRestoreBackup,
  restoreBackup,
} from './core/backups';
import {
  bindingSetCheck,
  restoreBindingSetFix,
  setupsFor,
  stopUsingSet,
  useSetInSetup,
} from './core/bindingSets';
import {
  beamngView,
  copyBindingsToController,
  copyOlderBindings,
  previewCopyBindingsToController,
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
import { iracingView, previewRepairIracing, repairIracing } from './core/iracing/iracing';
import { lmuView, previewRepairLmu, repairLmu } from './core/lmu/lmu';

export default defineFeatureMain({
  id: 'racing',
  setup(ctx) {
    const rctx: RacingContext = { ports: ctx.ports, log: ctx.log, games: ctx.games };

    /** Adds the name the owner gave each device (ctx.names); the ids stay what they were. */
    const named = async <
      T extends {
        vendorId?: string | undefined;
        productId?: string | undefined;
        instanceGuid?: string;
      },
    >(
      devices: T[]
    ): Promise<(T & { givenName?: string })[]> => {
      const names = await ctx.names.devices();
      return devices.map((device) => {
        if (!device.vendorId || !device.productId) return device;
        const givenName = names.nameOf({
          vendorId: device.vendorId,
          productId: device.productId,
          ...(device.instanceGuid ? { guid: device.instanceGuid } : {}),
        });
        return givenName ? { ...device, givenName } : device;
      });
    };

    ctx.checks.registerCheck(wheelBaseCheck);
    ctx.checks.registerCheck(iracingDevicesCheck(ctx.games));
    ctx.checks.registerCheck(iracingServiceCheck);
    ctx.checks.registerCheck(wheelSettingsCheck(ctx.games));
    ctx.checks.registerCheck(bindingSetCheck(ctx.games));
    ctx.checks.registerRemediation(restoreBindingSetFix(ctx.games));
    ctx.checks.registerCapture(racingCapture(ctx.games));
    const setups = { profiles: ctx.profiles, clock: ctx.ports.clock };
    ctx.backupSources.register(fanatecBackupSource);

    return [
      bind(racingContract, {
        overview: async () => ok(await racingOverview(rctx)),
        async iracing() {
          const view = await iracingView(rctx);
          return ok({ ...view, devices: await named(view.devices) });
        },
        async iracingRepair({ mapping }) {
          const repaired = await repairIracing(rctx, mapping);
          return repaired.ok ? ok({ message: repaired.value.message }) : repaired;
        },
        iracingRepairPreview: ({ mapping }) => previewRepairIracing(rctx, mapping),
        async lmu() {
          const view = await lmuView(rctx);
          return ok({ ...view, devices: await named(view.devices) });
        },
        async lmuRepair() {
          const repaired = await repairLmu(rctx);
          return repaired.ok ? ok({ message: repaired.value.message }) : repaired;
        },
        lmuRepairPreview: () => previewRepairLmu(rctx),
        async beamng() {
          const view = await beamngView(rctx);
          return ok({ ...view, maps: await named(view.maps) });
        },
        beamngCopyOlder: ({ version }) => copyOlderBindings(rctx, version),
        beamngCopyOlderPreview: ({ version }) => previewCopyOlderBindings(rctx, version),
        beamngCopyToController: ({ file, to }) => copyBindingsToController(rctx, file, to),
        beamngCopyToControllerPreview: ({ file, to }) =>
          previewCopyBindingsToController(rctx, file, to),
        assettoCorsa: async () => ok(await acView(rctx)),
        async wheel() {
          const presets = await readPresets(rctx);
          return ok({
            status: (await named([await wheelStatus(rctx)]))[0]!,
            presets,
            parameters: TUNING_PARAMETERS,
            comparisons: await compareWheelSettings(rctx, presets),
          });
        },
        savePresets: (presets) =>
          presetStore(rctx).write({ ...presets, updatedAt: ctx.ports.clock.now().toISOString() }),
        backups: async ({ game }) => ok(await listBackups(rctx, game)),
        backup: ({ game, name }) => backupNow(rctx, game, name),
        nameBackup: ({ game, id, name }) => nameBackup(rctx, game, id, name),
        backupSetups: async ({ game }) => (game === 'fanatec' ? ok([]) : setupsFor(setups, game)),
        useBackupInSetup: ({ game, id, profileId }) =>
          useSetInSetup(rctx, setups, game, id, profileId),
        stopUsingBackup: ({ game, profileId }) => stopUsingSet(setups, game, profileId),
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
