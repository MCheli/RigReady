import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { displaysContract } from './contract';
import { LayoutApplier } from './core/applier';
import { createDeskLayoutStep, deskLayoutId } from './core/deskLayout';
import {
  adoptLayoutItem,
  createApplyLayoutRemediation,
  createDisplayCapture,
  createLayoutCheck,
  type LayoutDeps,
} from './core/layoutCheck';
import { RevertGuard } from './core/revertGuard';
import { DisplaysService } from './core/service';
import { MonitorNameStore, RecoveryStore, UprightStore } from './core/stores';

export default defineFeatureMain({
  id: 'displays',
  setup(ctx) {
    const dataRoot = ctx.ports.folders.dataRoot();
    const names = new MonitorNameStore(ctx.ports.files, dataRoot);
    const recovery = new RecoveryStore(ctx.ports.files, dataRoot, ctx.ports.clock);
    const guard = new RevertGuard(ctx.ports.displays, {
      armed: (seconds) => ctx.emit(displaysContract, 'applied', { seconds }),
      settled: (outcome) => {
        ctx.log.info(`display layout ${outcome}`);
        // Kept or reverted: nothing to offer after a restart any more.
        if (outcome !== 'revertFailed') void recovery.clear();
        ctx.emit(displaysContract, 'settled', { outcome });
      },
    });
    const applier = new LayoutApplier(ctx.ports.displays, guard, recovery, ctx.ports.window);
    const deps: LayoutDeps = { names: () => names.readOrEmpty(), layouts: ctx.layouts };
    // Other features (DCS screen setup) call monitors by the names given here.
    ctx.names.provideMonitors(() => names.readOrEmpty());
    const upright = new UprightStore(ctx.ports.files, dataRoot);
    const service = new DisplaysService(ctx, names, recovery, applier, upright);

    // The countdown length comes from the settings and follows changes to them.
    void ctx.settings.get().then((s) => {
      if (s.ok) guard.seconds = s.value.displayRevertSeconds;
    });
    ctx.settings.onChange((s) => (guard.seconds = s.displayRevertSeconds));

    ctx.checks.registerCheck({
      ...createLayoutCheck(deps),
      adopt: (item) => adoptLayoutItem(item, ctx.layouts),
      // Stand down puts back the layout from before Make ready changed it, unless a desk
      // layout is chosen in the settings: then the desk-layout step below applies that.
      async standDown() {
        if (await deskLayoutId(ctx)) return ok(null);
        if (!ctx.ports.displays.canRevert()) return ok(null);
        const reverted = await guard.revertNow();
        return reverted.ok ? ok('Restored the earlier monitor layout') : reverted;
      },
    });
    ctx.checks.registerRemediation(createApplyLayoutRemediation({ ...deps, applier }));
    ctx.checks.registerCapture(createDisplayCapture(deps));
    ctx.checks.registerStandDownStep(createDeskLayoutStep(ctx, applier, deps.names));

    return [
      bind(displaysContract, {
        read: () => ctx.ports.displays.read(),
        pending: async () => ok({ pending: guard.pending, seconds: guard.seconds }),
        keep: async () => {
          const was = guard.pending;
          guard.keep();
          return ok({ kept: was });
        },
        revert: () => guard.revertNow(),
        view: () => service.view(),
        identify: () => service.identify(),
        flip: ({ id }) => service.flip(id),
        confirmUpright: () => service.confirmUpright(),
        setName: ({ id, name }) => service.setName(id, name),
        saveLayout: ({ name }) => service.saveLayout(name),
        updateLayout: ({ id }) => service.updateLayout(id),
        editLayout: ({ id, displays }) => service.editLayout(id, displays),
        renameLayout: ({ id, name }) => service.renameLayout(id, name),
        removeLayout: ({ id }) => service.removeLayout(id),
        setDeskLayout: ({ id }) => service.setDeskLayout(id),
        preview: ({ id }) => service.preview(id),
        applyLayout: ({ id, withoutMissing }) => service.applyLayout(id, withoutMissing),
        recovery: () => service.recovery(),
        recover: ({ restore }) => service.recover(restore),
      }),
    ];
  },
});
