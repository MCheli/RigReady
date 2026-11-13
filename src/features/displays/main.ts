import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { displaysContract, type LayoutQuestion } from './contract';
import { LayoutApplier } from './core/applier';
import { createDeskLayoutStep, deskLayoutId } from './core/deskLayout';
import {
  adoptLayoutItem,
  createApplyLayoutRemediation,
  createDisplayCapture,
  createLayoutCheck,
  type LayoutDeps,
} from './core/layoutCheck';
import { RevertGuard, type Countdown } from './core/revertGuard';
import { DisplaysService } from './core/service';
import { MonitorNameStore, ProvenStore, RecoveryStore, UprightStore } from './core/stores';

export default defineFeatureMain({
  id: 'displays',
  setup(ctx) {
    const dataRoot = ctx.ports.folders.dataRoot();
    const names = new MonitorNameStore(ctx.ports.files, dataRoot);
    const recovery = new RecoveryStore(ctx.ports.files, dataRoot, ctx.ports.clock);
    // The changes a person has kept on this PC: Make ready and Stand down apply those
    // without the question (core/proven.ts says exactly which).
    const proven = new ProvenStore(ctx.ports.files, dataRoot, ctx.ports.clock);
    /** The question as the window shows it: how long, who asked, and whether it is asked once. */
    const question = (countdown: Countdown): LayoutQuestion => ({
      seconds: countdown.seconds,
      ...(countdown.askedBy ? { askedBy: countdown.askedBy } : {}),
      ...(applier.firstTime ? { firstTime: true } : {}),
    });
    const guard = new RevertGuard(ctx.ports.displays, {
      armed: (seconds, askedBy) =>
        ctx.emit(
          displaysContract,
          'applied',
          question(askedBy ? { seconds, askedBy } : { seconds })
        ),
      settled: (outcome) => {
        ctx.log.info(`display layout ${outcome}`);
        // Kept or reverted: nothing to offer after a restart any more.
        if (outcome !== 'revertFailed') void recovery.clear();
        ctx.emit(displaysContract, 'settled', { outcome });
      },
    });
    const applier: LayoutApplier = new LayoutApplier(
      ctx.ports.displays,
      guard,
      recovery,
      ctx.ports.window,
      {
        proven,
        unasked: () => ctx.emit(displaysContract, 'appliedKnown', {}),
        log: (line) => ctx.log.info(line),
      }
    );
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
        pending: async () => {
          const running = guard.running;
          return ok(
            running
              ? { pending: true, ...question(running) }
              : { pending: false, seconds: guard.seconds }
          );
        },
        // Through the applier: a person's "Keep it" is what makes a layout known to work.
        keep: async () => ok({ kept: await applier.keep() }),
        revert: () => guard.revertNow(),
        view: () => service.view(),
        identify: () => service.identify(),
        flip: ({ id }) => service.flip(id),
        turn: ({ id, arrow }) => service.turn(id, arrow),
        confirmUpright: () => service.confirmUpright(),
        setName: ({ id, name }) => service.setName(id, name),
        saveLayout: ({ name }) => service.saveLayout(name),
        newLayout: ({ name, stayOn }) => service.newLayout(name, stayOn),
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
