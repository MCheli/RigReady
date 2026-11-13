import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { isToolBackup, racingContract, type BackupGame, type WheelView } from './contract';
import { racingBindingReaders } from './core/bindingReaders';
import { acView } from './core/assettoCorsa';
import { previewRepairAc, repairAc } from './core/acRepair';
import {
  backupNow,
  brandBackupSource,
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
import {
  iracingCalibrationCapture,
  iracingCalibrationCheck,
  type NamesFor,
} from './core/iracingCalibration';
import { wheelStatus } from './core/fanatec/fanatec';
import { wheelRotationCheck } from './core/wheelbases/rotation';
import { addMyWheel, removeMyWheel, unlistedView } from './core/wheelbases/unlisted';
import { wheelBaseCheck } from './core/wheelbases/wheel';
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

    /** The Wheel page: the base, its settings, and what "My wheel is not listed" can pick. */
    const wheelView = async (): Promise<WheelView> => {
      const presets = await readPresets(rctx);
      return {
        status: (await named([await wheelStatus(rctx)]))[0]!,
        presets,
        parameters: TUNING_PARAMETERS,
        comparisons: await compareWheelSettings(rctx, presets),
        ...(await unlistedView(rctx)),
      };
    };

    // What is bound in each racing game, for cheat sheets and the other features that ask.
    for (const reader of racingBindingReaders(rctx)) ctx.bindings.register(reader);
    /** Tells the features that show bindings that a game's binding files were changed. */
    const changed = <T extends { ok: boolean }>(game: BackupGame, result: T): T => {
      if (result.ok && !isToolBackup(game)) ctx.bindings.notifyChanged({ game });
      return result;
    };
    const restoreFix = restoreBindingSetFix(ctx.games);

    ctx.checks.registerCheck(wheelBaseCheck);
    ctx.checks.registerCheck(wheelRotationCheck);
    ctx.checks.registerCheck(iracingDevicesCheck(ctx.games));
    ctx.checks.registerCheck(iracingServiceCheck);
    ctx.checks.registerCheck(wheelSettingsCheck(ctx.games));
    ctx.checks.registerCheck(bindingSetCheck(ctx.games));
    ctx.checks.registerRemediation({
      ...restoreFix,
      run: async (params, checkCtx) => changed(params.game, await restoreFix.run(params, checkCtx)),
    });
    ctx.checks.registerCapture(racingCapture(ctx.games));
    // Whether iRacing will ask to calibrate the wheel or pedals (core/iracingCalibration.ts).
    const deviceNames: NamesFor = (present) => ctx.names.devices(present);
    ctx.checks.registerCheck(iracingCalibrationCheck(ctx.games, deviceNames));
    ctx.checks.registerCapture(iracingCalibrationCapture(ctx.games, deviceNames));
    const setups = { profiles: ctx.profiles, clock: ctx.ports.clock };
    ctx.backupSources.register(fanatecBackupSource);
    ctx.backupSources.register(brandBackupSource('logitech'));
    ctx.backupSources.register(brandBackupSource('simucube'));

    return [
      bind(racingContract, {
        overview: async () => ok(await racingOverview(rctx)),
        async iracing() {
          const view = await iracingView(rctx);
          return ok({ ...view, devices: await named(view.devices) });
        },
        async iracingRepair({ mapping, seen }) {
          const repaired = changed('iracing', await repairIracing(rctx, mapping, seen));
          return repaired.ok ? ok({ message: repaired.value.message }) : repaired;
        },
        iracingRepairPreview: ({ mapping }) => previewRepairIracing(rctx, mapping),
        async lmu() {
          const view = await lmuView(rctx);
          return ok({ ...view, devices: await named(view.devices) });
        },
        async lmuRepair() {
          const repaired = changed('lmu', await repairLmu(rctx));
          return repaired.ok ? ok({ message: repaired.value.message }) : repaired;
        },
        lmuRepairPreview: () => previewRepairLmu(rctx),
        async beamng() {
          const view = await beamngView(rctx);
          return ok({ ...view, maps: await named(view.maps) });
        },
        beamngCopyOlder: async ({ version }) =>
          changed('beamng', await copyOlderBindings(rctx, version)),
        beamngCopyOlderPreview: ({ version }) => previewCopyOlderBindings(rctx, version),
        beamngCopyToController: async ({ file, to }) =>
          changed('beamng', await copyBindingsToController(rctx, file, to)),
        beamngCopyToControllerPreview: ({ file, to }) =>
          previewCopyBindingsToController(rctx, file, to),
        async assettoCorsa() {
          const view = await acView(rctx);
          return ok({ ...view, controllers: await named(view.controllers) });
        },
        async acRepair({ choices }) {
          const repaired = changed('assetto-corsa', await repairAc(rctx, choices));
          return repaired.ok ? ok({ message: repaired.value.message }) : repaired;
        },
        acRepairPreview: ({ choices }) => previewRepairAc(rctx, choices),
        wheel: async () => ok(await wheelView()),
        async addWheel(input) {
          const added = await addMyWheel(rctx, input);
          return added.ok ? ok(await wheelView()) : added;
        },
        async removeWheel(ref) {
          const removed = await removeMyWheel(rctx, ref);
          return removed.ok ? ok(await wheelView()) : removed;
        },
        savePresets: (presets) =>
          presetStore(rctx).write({ ...presets, updatedAt: ctx.ports.clock.now().toISOString() }),
        backups: async ({ game }) => ok(await listBackups(rctx, game)),
        backup: ({ game, name }) => backupNow(rctx, game, name),
        nameBackup: ({ game, id, name }) => nameBackup(rctx, game, id, name),
        backupSetups: async ({ game }) => (isToolBackup(game) ? ok([]) : setupsFor(setups, game)),
        useBackupInSetup: ({ game, id, profileId }) =>
          useSetInSetup(rctx, setups, game, id, profileId),
        stopUsingBackup: ({ game, profileId }) => stopUsingSet(setups, game, profileId),
        restore: async ({ game, id, closeApp }) =>
          changed(game, await restoreBackup(rctx, game, id, { closeApp })),
        restorePreview: ({ game, id }) => previewRestoreBackup(rctx, game, id),
        async deleteBackup({ game, id }) {
          const deleted = await deleteBackup(rctx, game, id);
          return deleted.ok ? ok({ deleted: true }) : deleted;
        },
      }),
    ];
  },
});
