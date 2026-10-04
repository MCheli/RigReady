import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { racingContract } from './contract';
import { acView } from './core/assettoCorsa';
import { backupNow, deleteBackup, listBackups, restoreBackup } from './core/backups';
import { beamngView, copyBindingsToController, copyOlderBindings } from './core/beamng/beamng';
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
    ctx.checks.registerCapture(racingCapture(ctx.games));

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
        async lmu() {
          const view = await lmuView(rctx);
          return ok({ ...view, devices: await named(view.devices) });
        },
        async beamng() {
          const view = await beamngView(rctx);
          return ok({ ...view, maps: await named(view.maps) });
        },
        beamngCopyOlder: ({ version }) => copyOlderBindings(rctx, version),
        beamngCopyToController: ({ file, to }) => copyBindingsToController(rctx, file, to),
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
        backup: ({ game }) => backupNow(rctx, game),
        restore: ({ game, id, closeApp }) => restoreBackup(rctx, game, id, { closeApp }),
        async deleteBackup({ game, id }) {
          const deleted = await deleteBackup(rctx, game, id);
          return deleted.ok ? ok({ deleted: true }) : deleted;
        },
      }),
    ];
  },
});
